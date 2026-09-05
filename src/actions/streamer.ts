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

import { formatAmount, formatViewers, type NumberFormat } from "../format";
import { KeyImageCache } from "../key-image";
import { PressTracker } from "../press";
import { renderMessageKey, renderStreamerKey } from "../render";
import { safely } from "../safety";
import { zevent } from "../zevent";

/** Ce qu’un appui déclenche. « none » laisse la touche inerte. */
export type StreamerPressAction = "twitch" | "donation" | "none";

export type StreamerSettings = {
	login?: string;
	showAvatar?: boolean;
	showViewers?: boolean;
	numberFormat?: NumberFormat;
	/** Appui court. */
	clickAction?: StreamerPressAction;
	/** Appui long, inerte par défaut pour ne rien changer aux touches existantes. */
	longPressAction?: StreamerPressAction;
};

type AnyAction = KeyAction<StreamerSettings> | DialAction<StreamerSettings>;

@action({ UUID: "fr.quentinperou.zevent.streamer" })
export class StreamerAction extends SingletonAction<StreamerSettings> {
	readonly #images = new KeyImageCache();
	/** Derniers réglages connus de chaque touche, poussés par Stream Deck. */
	readonly #settings = new Map<string, StreamerSettings>();
	readonly #presses = new PressTracker();

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
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<StreamerSettings>): Promise<void> {
		this.#settings.set(ev.action.id, ev.payload.settings);
		await this.#render(ev.action, ev.payload.settings);
	}

	override onKeyDown(ev: KeyDownEvent<StreamerSettings>): void {
		const settings = ev.payload.settings;
		this.#presses.down(ev.action.id, () => {
			safely(this.#run(ev.action, settings.longPressAction ?? "none", settings), "appui long");
		});
	}

	override async onKeyUp(ev: KeyUpEvent<StreamerSettings>): Promise<void> {
		// L'action longue s'est déjà déclenchée au seuil : le relâchement ne doit
		// pas en jouer une seconde.
		if (!this.#presses.up(ev.action.id)) return;

		const settings = ev.payload.settings;
		await this.#run(ev.action, settings.clickAction ?? "twitch", settings);
	}

	async #run(
		target: KeyAction<StreamerSettings>,
		what: StreamerPressAction,
		settings: StreamerSettings,
	): Promise<void> {
		if (what === "none") return;

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
		const viewers =
			settings.showViewers === false
				? null
				: streamer.online
					? `${formatViewers(streamer.viewers, format)} viewers`
					: "hors ligne";

		await this.#images.apply(
			target,
			renderStreamerKey({
				name: streamer.display,
				amount: formatAmount(streamer.donation, streamer.donationText, format),
				viewers,
				online: streamer.online,
				avatar,
				stale: zevent.isStale,
			}),
		);
	}
}
