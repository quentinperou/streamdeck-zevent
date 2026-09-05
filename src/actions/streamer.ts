import streamDeck, { action, SingletonAction } from "@elgato/streamdeck";
import type {
	DialAction,
	DidReceiveSettingsEvent,
	KeyAction,
	KeyDownEvent,
	KeyUpEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { formatAmount, formatViewers, groupDigits, type NumberFormat } from "../format";
import { ingdoc } from "../ingdoc";
import { KeyImageCache } from "../key-image";
import { PressTracker } from "../press";
import { renderMessageKey, renderStreamerGraphKey, renderStreamerKey } from "../render";
import { safely } from "../safety";
import { spikes } from "../spike";
import { zevent } from "../zevent";

/** Ce qu’un appui déclenche. « none » laisse la touche inerte. */
export type StreamerPressAction = "twitch" | "donation" | "graph" | "none";

export type StreamerSettings = {
	login?: string;
	showAvatar?: boolean;
	showViewers?: boolean;
	/** Signaler les temps forts par un cadre. */
	showSpikes?: boolean;
	numberFormat?: NumberFormat;
	/** Appui court. */
	clickAction?: StreamerPressAction;
	/** Appui long. */
	longPressAction?: StreamerPressAction;
};

/**
 * Réglages d’une touche fraîchement posée. La courbe est ce qu’on regarde le
 * plus volontiers d’un coup d’œil ; la chaîne, elle, se passe très bien d’être
 * à un simple clic.
 */
const DEFAULT_CLICK = "graph" as const;
const DEFAULT_LONG_PRESS = "twitch" as const;

type AnyAction = KeyAction<StreamerSettings> | DialAction<StreamerSettings>;

@action({ UUID: "fr.quentinperou.zevent.streamer" })
export class StreamerAction extends SingletonAction<StreamerSettings> {
	readonly #images = new KeyImageCache();
	/** Derniers réglages connus de chaque touche, poussés par Stream Deck. */
	readonly #settings = new Map<string, StreamerSettings>();
	readonly #presses = new PressTracker();
	/**
	 * Touches basculées sur la courbe des dons. L’état vit ici et non dans les
	 * réglages : c’est un coup d’œil, pas une préférence à conserver.
	 */
	readonly #graphing = new Set<string>();

	override async onWillAppear(ev: WillAppearEvent<StreamerSettings>): Promise<void> {
		zevent.retain();
		// La touche revient sur l'image par défaut du manifest : ce qu'on croyait
		// lui avoir envoyé ne vaut plus rien.
		this.#images.forget(ev.action.id);
		this.#settings.set(ev.action.id, ev.payload.settings);
		await this.#render(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<StreamerSettings>): void {
		zevent.release();
		this.#images.forget(ev.action.id);
		this.#settings.delete(ev.action.id);
		this.#presses.forget(ev.action.id);
		this.#graphing.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<StreamerSettings>): Promise<void> {
		const settings = ev.payload.settings;
		this.#settings.set(ev.action.id, settings);

		// Plus aucun appui ne mène à la courbe : une touche restée dessus n'aurait
		// plus aucun moyen d'en sortir.
		const reachable =
			(settings.clickAction ?? DEFAULT_CLICK) === "graph" ||
			(settings.longPressAction ?? DEFAULT_LONG_PRESS) === "graph";
		if (!reachable) this.#graphing.delete(ev.action.id);

		await this.#render(ev.action, settings);
	}

	override onKeyDown(ev: KeyDownEvent<StreamerSettings>): void {
		const settings = ev.payload.settings;
		this.#presses.down(ev.action.id, () => {
			safely(this.#run(ev.action, settings.longPressAction ?? DEFAULT_LONG_PRESS, settings), "appui long");
		});
	}

	override async onKeyUp(ev: KeyUpEvent<StreamerSettings>): Promise<void> {
		// L'action longue s'est déjà déclenchée au seuil : le relâchement ne doit
		// pas en jouer une seconde.
		if (!this.#presses.up(ev.action.id)) return;

		const settings = ev.payload.settings;
		await this.#run(ev.action, settings.clickAction ?? DEFAULT_CLICK, settings);
	}

	async #run(
		target: KeyAction<StreamerSettings>,
		what: StreamerPressAction,
		settings: StreamerSettings,
	): Promise<void> {
		if (what === "none") return;

		if (what === "graph") {
			// Bascule : le même appui montre la courbe puis la range.
			if (this.#graphing.has(target.id)) this.#graphing.delete(target.id);
			else this.#graphing.add(target.id);

			await this.#render(target, settings);
			return;
		}

		const login = settings.login?.trim();
		if (!login) {
			await target.showAlert();
			return;
		}

		const streamer = zevent.find(login);
		const url =
			what === "donation"
				? (streamer?.donationUrl ?? `https://zevent.fr/don/${login}`)
				: `https://www.twitch.tv/${login}`;

		await streamDeck.system.openUrl(url);
	}

	/**
	 * Redessine toutes les touches visibles de cette action.
	 *
	 * Les réglages viennent du cache et non de `getSettings()` : cet appel est
	 * un aller-retour vers Stream Deck, et il en faudrait un par touche à chaque
	 * cycle pour relire des valeurs que Stream Deck nous a déjà poussées.
	 */
	async renderAll(): Promise<void> {
		for (const target of this.actions) {
			const settings = this.#settings.get(target.id);
			if (!settings) continue;

			try {
				await this.#render(target, settings);
			} catch (error) {
				// Une touche en échec ne doit pas priver les autres de leur mise à jour.
				streamDeck.logger.warn(`Rendu impossible pour ${target.id}`, error);
			}
		}
	}

	async #render(target: AnyAction, settings: StreamerSettings): Promise<void> {
		if (!target.isKey()) return;

		const login = settings.login?.trim();
		if (!login) {
			await this.#images.apply(target, renderMessageKey("Choisir un streamer"));
			return;
		}

		const streamer = zevent.find(login);
		if (!streamer) {
			// Tant que rien n'est arrivé, on ne peut pas distinguer un pseudo
			// inconnu d'un catalogue pas encore chargé : on ne l'affirme pas.
			if (!zevent.hasData) {
				await this.#images.apply(
					target,
					zevent.error
						? renderMessageKey("ZEvent injoignable", "warning")
						: renderMessageKey("Chargement…"),
				);
			} else {
				await this.#images.apply(target, renderMessageKey(`${login} hors ZEvent`, "warning"));
			}
			return;
		}

		const format = settings.numberFormat ?? "full";
		const avatar = settings.showAvatar === false ? null : await zevent.avatar(streamer.login);

		// Une hausse brutale par rapport au rythme propre du streamer : la touche
		// le dit, et dit de combien.
		const spike = settings.showSpikes === false ? null : spikes.get(streamer.login);
		const alert = spike
			? `+${formatAmount(spike.delta, `${groupDigits(spike.delta)} €`, format)}`
			: null;
		const viewers =
			settings.showViewers === false
				? null
				: streamer.online
					? `${formatViewers(streamer.viewers, format)} viewers`
					: "hors ligne";

		if (this.#graphing.has(target.id)) {
			// L'historique ne vient que d'InGDoc. S'il manque, on retombe sur la vue
			// normale plutôt que d'afficher une courbe vide.
			const points = await ingdoc.history(streamer.twitchId).catch(() => null);
			if (points && points.length > 1) {
				await this.#images.apply(
					target,
					renderStreamerGraphKey({
						name: streamer.display,
						amount: formatAmount(streamer.donation, streamer.donationText, format),
						points,
						caption: viewers,
						online: streamer.online,
						avatar,
						stale: zevent.isStale,
						alert,
					}),
				);
				return;
			}
		}

		await this.#images.apply(
			target,
			renderStreamerKey({
				name: streamer.display,
				amount: formatAmount(streamer.donation, streamer.donationText, format),
				viewers,
				online: streamer.online,
				avatar,
				stale: zevent.isStale,
				alert,
			}),
		);
	}
}
