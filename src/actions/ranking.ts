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

import { formatNumber, type NumberFormat } from "../format";
import { KeyImageCache } from "../key-image";
import { PressTracker } from "../press";
import { renderMessageKey, renderRankingKey, type RankingEntry } from "../render";
import { safely } from "../safety";
import { zevent } from "../zevent";

/** Ce sur quoi porte le classement. */
export type RankingSort = "donation" | "viewers";

/** Ce qu’un appui déclenche. « none » laisse la touche inerte. */
export type RankingPressAction = "toggle" | "site" | "donation" | "none";

export type RankingSettings = {
	sortBy?: RankingSort;
	numberFormat?: NumberFormat;
	/** Appui court. */
	clickAction?: RankingPressAction;
	/** Appui long. */
	longPressAction?: RankingPressAction;
};

/**
 * Quatre lignes : au-delà, les pseudos deviennent illisibles sur 72 pixels.
 */
const ROWS = 4;

const DEFAULT_SORT = "donation" as const;
const DEFAULT_CLICK = "toggle" as const;
const DEFAULT_LONG_PRESS = "site" as const;

/**
 * Les nombres complets ne laissent presque rien au pseudo — « 537 239 € » et
 * « Domingo » ne tiennent pas ensemble sur une ligne. L'abrègement est donc le
 * défaut ici, à rebours des autres actions.
 */
const DEFAULT_FORMAT = "short" as const;

type AnyAction = KeyAction<RankingSettings> | DialAction<RankingSettings>;

@action({ UUID: "fr.quentinperou.zevent.ranking" })
export class RankingAction extends SingletonAction<RankingSettings> {
	readonly #images = new KeyImageCache();
	/** Derniers réglages connus de chaque touche, poussés par Stream Deck. */
	readonly #settings = new Map<string, RankingSettings>();
	readonly #presses = new PressTracker();

	override async onWillAppear(ev: WillAppearEvent<RankingSettings>): Promise<void> {
		zevent.retain();
		// La touche revient sur l'image par défaut du manifest : ce qu'on croyait
		// lui avoir envoyé ne vaut plus rien.
		this.#images.forget(ev.action.id);
		this.#settings.set(ev.action.id, ev.payload.settings);
		await this.#render(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<RankingSettings>): void {
		zevent.release();
		this.#images.forget(ev.action.id);
		this.#settings.delete(ev.action.id);
		this.#presses.forget(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<RankingSettings>): Promise<void> {
		const settings = ev.payload.settings;
		this.#settings.set(ev.action.id, settings);
		await this.#render(ev.action, settings);
	}

	override onKeyDown(ev: KeyDownEvent<RankingSettings>): void {
		const settings = ev.payload.settings;
		this.#presses.down(ev.action.id, () => {
			safely(this.#run(ev.action, settings.longPressAction ?? DEFAULT_LONG_PRESS, settings), "appui long");
		});
	}

	override async onKeyUp(ev: KeyUpEvent<RankingSettings>): Promise<void> {
		// L'action longue s'est déjà déclenchée au seuil : le relâchement ne doit
		// pas en jouer une seconde.
		if (!this.#presses.up(ev.action.id)) return;

		const settings = ev.payload.settings;
		await this.#run(ev.action, settings.clickAction ?? DEFAULT_CLICK, settings);
	}

	async #run(
		target: KeyAction<RankingSettings>,
		what: RankingPressAction,
		settings: RankingSettings,
	): Promise<void> {
		if (what === "none") return;

		if (what === "toggle") {
			// La bascule écrit le réglage plutôt que de vivre en mémoire : le Property
			// Inspector, qui écoute les réglages, suit alors le changement au lieu
			// d'annoncer un critère que la touche n'affiche plus. La touche garde
			// aussi son critère au redémarrage.
			const next: RankingSettings = {
				...settings,
				sortBy: (settings.sortBy ?? DEFAULT_SORT) === "donation" ? "viewers" : "donation",
			};

			this.#settings.set(target.id, next);
			await this.#render(target, next);
			await target.setSettings(next);
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

	async #render(target: AnyAction, settings: RankingSettings): Promise<void> {
		if (!target.isKey()) return;

		if (!zevent.hasData) {
			await this.#images.apply(
				target,
				zevent.error ? renderMessageKey("ZEvent injoignable", "warning") : renderMessageKey("Chargement…"),
			);
			return;
		}

		const sortBy = settings.sortBy ?? DEFAULT_SORT;
		const format = settings.numberFormat ?? DEFAULT_FORMAT;

		// La liste du store est déjà triée par cagnotte : on ne la retrie que pour
		// l'autre critère, et sur une copie.
		const ranked =
			sortBy === "donation"
				? zevent.streamers
				: [...zevent.streamers].sort((a, b) => b.viewers - a.viewers);

		const entries: RankingEntry[] = ranked.slice(0, ROWS).map((streamer) => ({
			name: streamer.display,
			// Sans unité : le titre de la touche dit déjà ce qu'on compte.
			value: formatNumber(sortBy === "donation" ? streamer.donation : streamer.viewers, format),
		}));

		await this.#images.apply(
			target,
			renderRankingKey({
				title: sortBy === "donation" ? "CAGNOTTES" : "VIEWERS",
				entries,
				stale: zevent.isStale,
			}),
		);
	}
}
