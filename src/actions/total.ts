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
import { ingdoc } from "../ingdoc";
import { KeyImageCache } from "../key-image";
import { PressTracker } from "../press";
import { renderMessageKey, renderTotalGraphKey, renderTotalKey } from "../render";
import { safely } from "../safety";
import { zevent } from "../zevent";

/** Ce qu’un appui déclenche. « none » laisse la touche inerte. */
export type TotalPressAction = "donation" | "site" | "graph" | "none";

export type TotalSettings = {
	label?: string;
	showViewers?: boolean;
	numberFormat?: NumberFormat;
	/** Appui court. */
	clickAction?: TotalPressAction;
	/** Appui long. */
	longPressAction?: TotalPressAction;
};

/**
 * Réglages d’une touche fraîchement posée, alignés sur ceux d’une cagnotte de
 * streamer : la courbe est ce qu’on regarde d’un coup d’œil, la page de don
 * se passe très bien d’être à un simple clic.
 */
const DEFAULT_CLICK = "graph" as const;
const DEFAULT_LONG_PRESS = "donation" as const;

type AnyAction = KeyAction<TotalSettings> | DialAction<TotalSettings>;

@action({ UUID: "fr.quentinperou.zevent.total" })
export class TotalAction extends SingletonAction<TotalSettings> {
	readonly #images = new KeyImageCache();
	/** Derniers réglages connus de chaque touche, poussés par Stream Deck. */
	readonly #settings = new Map<string, TotalSettings>();
	readonly #presses = new PressTracker();
	/**
	 * Touches basculées sur la courbe. L’état vit ici et non dans les réglages :
	 * c’est un coup d’œil, pas une préférence à conserver.
	 */
	readonly #graphing = new Set<string>();

	override async onWillAppear(ev: WillAppearEvent<TotalSettings>): Promise<void> {
		zevent.retain();
		// La touche revient sur l'image par défaut du manifest : ce qu'on croyait
		// lui avoir envoyé ne vaut plus rien.
		this.#images.forget(ev.action.id);
		this.#settings.set(ev.action.id, ev.payload.settings);
		await this.#render(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<TotalSettings>): void {
		zevent.release();
		this.#images.forget(ev.action.id);
		this.#settings.delete(ev.action.id);
		this.#presses.forget(ev.action.id);
		this.#graphing.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TotalSettings>): Promise<void> {
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

	override onKeyDown(ev: KeyDownEvent<TotalSettings>): void {
		const settings = ev.payload.settings;
		this.#presses.down(ev.action.id, () => {
			safely(this.#run(ev.action, settings.longPressAction ?? DEFAULT_LONG_PRESS, settings), "appui long");
		});
	}

	override async onKeyUp(ev: KeyUpEvent<TotalSettings>): Promise<void> {
		// L'action longue s'est déjà déclenchée au seuil : le relâchement ne doit
		// pas en jouer une seconde.
		if (!this.#presses.up(ev.action.id)) return;

		const settings = ev.payload.settings;
		await this.#run(ev.action, settings.clickAction ?? DEFAULT_CLICK, settings);
	}

	async #run(
		target: KeyAction<TotalSettings>,
		what: TotalPressAction,
		settings: TotalSettings,
	): Promise<void> {
		if (what === "none") return;

		if (what === "graph") {
			// Bascule : le même appui montre la courbe puis la range.
			if (this.#graphing.has(target.id)) this.#graphing.delete(target.id);
			else this.#graphing.add(target.id);

			await this.#render(target, settings);
			return;
		}

		const url = what === "site" ? "https://zevent.fr/" : zevent.globalDonationUrl;
		await streamDeck.system.openUrl(url);
	}

	/** Réglages pris dans le cache : `getSettings()` est un aller-retour, pas un accès local. */
	async renderAll(): Promise<void> {
		for (const target of this.actions) {
			const settings = this.#settings.get(target.id);
			if (!settings) continue;

			try {
				await this.#render(target, settings);
			} catch (error) {
				streamDeck.logger.warn(`Rendu impossible pour ${target.id}`, error);
			}
		}
	}

	async #render(target: AnyAction, settings: TotalSettings): Promise<void> {
		if (!target.isKey()) return;

		const totals = zevent.totals;
		if (!totals) {
			await this.#images.apply(
				target,
				zevent.error ? renderMessageKey("ZEvent injoignable", "warning") : renderMessageKey("Chargement…"),
			);
			return;
		}

		const format = settings.numberFormat ?? "full";
		const label = settings.label?.trim() || "ZEVENT";
		const amount = formatAmount(totals.donation, totals.donationText, format);
		const viewers =
			settings.showViewers === false ? null : `${formatViewers(totals.viewers, format)} viewers`;

		if (this.#graphing.has(target.id)) {
			// L'historique ne vient que d'InGDoc. S'il manque, on retombe sur la vue
			// normale plutôt que d'afficher une courbe vide.
			const points = await ingdoc.globalHistory().catch(() => null);
			if (points && points.length > 1) {
				await this.#images.apply(
					target,
					renderTotalGraphKey({ label, amount, points, viewers, stale: zevent.isStale }),
				);
				return;
			}
		}

		await this.#images.apply(
			target,
			renderTotalKey({ label, amount, viewers, stale: zevent.isStale }),
		);
	}
}
