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

import { goals, pickGoal, progressToward, type GoalSource } from "../goals";
import { KeyImageCache } from "../key-image";
import { PressTracker } from "../press";
import { renderGoalKey, renderGoalTitleKey, renderMessageKey } from "../render";
import { safely } from "../safety";
import { zevent } from "../zevent";

/** Ce qu’un appui déclenche. « none » laisse la touche inerte. */
export type GoalPressAction = "twitch" | "donation" | "title" | "none";

export type GoalSettings = {
	login?: string;
	/** L'identifiant Twitch : c'est par lui que se récupèrent les paliers. */
	twitchId?: string;
	/** Un rang précis, ou « next » pour suivre le prochain palier non atteint. */
	goalIndex?: number | "next";
	showAvatar?: boolean;
	/** D’où viennent les paliers. « auto » privilégie InGDoc et retombe sur l’officiel. */
	goalSource?: GoalSource;
	/** Appui court. « title » affiche le libellé du palier au lieu d’ouvrir un lien. */
	clickAction?: GoalPressAction;
	/** Appui long. */
	longPressAction?: GoalPressAction;
};

/**
 * Réglages d’une touche fraîchement posée. Le libellé du palier est ce qu’on
 * veut lire le plus souvent, et la page de don ce vers quoi on veut envoyer
 * les gens : ni l’un ni l’autre ne mérite d’être caché derrière un réglage.
 */
const DEFAULT_CLICK = "title" as const;
const DEFAULT_LONG_PRESS = "donation" as const;

/** Durée d’affichage du libellé, avant retour automatique. */
const TITLE_FLASH_MS = 5_000;

type AnyAction = KeyAction<GoalSettings> | DialAction<GoalSettings>;

@action({ UUID: "fr.quentinperou.zevent.goal" })
export class GoalAction extends SingletonAction<GoalSettings> {
	readonly #images = new KeyImageCache();
	/**
	 * Fiche suivie par chaque touche. Sans ce suivi, changer de streamer dans le
	 * Property Inspector laisserait l'ancienne fiche interrogée indéfiniment.
	 */
	readonly #watched = new Map<string, { twitchId: string; source: GoalSource }>();
	/** Derniers réglages connus de chaque touche, poussés par Stream Deck. */
	readonly #settings = new Map<string, GoalSettings>();
	/** Touches qui montrent le libellé de leur palier, et leur minuterie de retour. */
	readonly #flashing = new Map<string, NodeJS.Timeout>();
	readonly #presses = new PressTracker();

	override async onWillAppear(ev: WillAppearEvent<GoalSettings>): Promise<void> {
		zevent.retain();
		this.#images.forget(ev.action.id);
		this.#settings.set(ev.action.id, ev.payload.settings);
		this.#watch(ev.action.id, ev.payload.settings);
		await this.#render(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<GoalSettings>): void {
		zevent.release();
		this.#images.forget(ev.action.id);
		this.#settings.delete(ev.action.id);
		const flash = this.#flashing.get(ev.action.id);
		if (flash) {
			// La minuterie redessinerait une touche qui n’est plus à l’écran.
			clearTimeout(flash);
			this.#flashing.delete(ev.action.id);
		}
		this.#presses.forget(ev.action.id);
		this.#watch(ev.action.id, {});
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<GoalSettings>): Promise<void> {
		this.#settings.set(ev.action.id, ev.payload.settings);
		this.#watch(ev.action.id, ev.payload.settings);
		await this.#render(ev.action, ev.payload.settings);
	}

	override onKeyDown(ev: KeyDownEvent<GoalSettings>): void {
		const settings = ev.payload.settings;
		this.#presses.down(ev.action.id, () => {
			safely(this.#run(ev.action, settings.longPressAction ?? DEFAULT_LONG_PRESS, settings), "appui long");
		});
	}

	override async onKeyUp(ev: KeyUpEvent<GoalSettings>): Promise<void> {
		// L'action longue s'est déjà déclenchée au seuil : le relâchement ne doit
		// pas en jouer une seconde.
		if (!this.#presses.up(ev.action.id)) return;

		const settings = ev.payload.settings;
		await this.#run(ev.action, settings.clickAction ?? DEFAULT_CLICK, settings);
	}

	async #run(
		target: KeyAction<GoalSettings>,
		what: GoalPressAction,
		settings: GoalSettings,
	): Promise<void> {
		if (what === "none") return;
		if (what === "title") {
			await this.#flashTitle(target, settings);
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
	 * Montre le libellé du palier, puis rend la main à l'affichage normal.
	 *
	 * Tant que la touche est dans cet état, `#render` la laisse tranquille :
	 * sans quoi le rafraîchissement périodique effacerait le texte au bout de
	 * quelques secondes, au hasard de la cadence.
	 */
	async #flashTitle(target: KeyAction<GoalSettings>, settings: GoalSettings): Promise<void> {
		const source = settings.goalSource ?? "auto";
		const data = goals.get(settings.twitchId, source);
		const goal = data ? pickGoal(data, settings.goalIndex ?? "next") : null;

		if (!goal) {
			await target.showAlert();
			return;
		}

		// Un nouvel appui repart pour cinq secondes plutôt que d'en écourter
		// l'affichage en cours.
		const running = this.#flashing.get(target.id);
		if (running) clearTimeout(running);

		const restore = setTimeout(() => {
			this.#flashing.delete(target.id);
			const current = this.#settings.get(target.id);
			if (current) safely(this.#render(target, current), "retour à l'affichage du palier");
		}, TITLE_FLASH_MS);
		restore.unref?.();
		this.#flashing.set(target.id, restore);

		const streamer = zevent.find(settings.login ?? "");
		await this.#images.apply(
			target,
			renderGoalTitleKey({
				title: goal.title,
				amount: goal.amountText,
				online: Boolean(streamer?.online),
				avatar: settings.showAvatar === false ? null : await zevent.avatar(settings.login ?? ""),
			}),
		);
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

	/** Bascule la fiche suivie par une touche, en libérant la précédente. */
	#watch(actionId: string, settings: GoalSettings): void {
		const twitchId = settings.twitchId;
		const source = settings.goalSource ?? "auto";
		const previous = this.#watched.get(actionId);
		if (previous && previous.twitchId === twitchId && previous.source === source) return;

		if (previous) goals.release(previous.twitchId, previous.source);
		if (twitchId) {
			goals.retain(twitchId, source);
			this.#watched.set(actionId, { twitchId, source });
		} else {
			this.#watched.delete(actionId);
		}
	}

	async #render(target: AnyAction, settings: GoalSettings): Promise<void> {
		if (!target.isKey()) return;
		// La touche montre son libellé : on la laisse finir.
		if (this.#flashing.has(target.id)) return;

		const login = settings.login?.trim();
		if (!login || !settings.twitchId) {
			await this.#images.apply(target, renderMessageKey("Choisir un streamer"));
			return;
		}

		const source = settings.goalSource ?? "auto";
		const data = goals.get(settings.twitchId, source);
		if (!data) {
			await this.#images.apply(
				target,
				goals.failed(settings.twitchId, source)
					? renderMessageKey("Paliers indisponibles", "warning")
					: renderMessageKey("Chargement…"),
			);
			return;
		}

		if (data.goals.length === 0) {
			await this.#images.apply(target, renderMessageKey(`${login} n'a pas de palier`, "warning"));
			return;
		}

		const streamer = zevent.find(login);
		const avatar = settings.showAvatar === false ? null : await zevent.avatar(login);
		const goal = pickGoal(data, settings.goalIndex ?? "next");

		// Aucun palier retenu : soit ils sont tous tombés, soit le rang choisi a
		// disparu de la liste. Dans les deux cas la barre est pleine.
		if (!goal) {
			await this.#images.apply(
				target,
				renderGoalKey({
					name: streamer?.display ?? login,
					fraction: 1,
					headline: "100 %",
					target: "tous atteints",
					online: Boolean(streamer?.online),
					avatar,
					stale: zevent.isStale,
				}),
			);
			return;
		}

		const fraction = progressToward(data, goal);
		const rank = data.goals.indexOf(goal) + 1;

		await this.#images.apply(
			target,
			renderGoalKey({
				name: streamer?.display ?? login,
				fraction,
				headline: `${Math.floor(fraction * 100)} %`,
				target: `${rank}/${data.goals.length} · ${goal.amountText}`,
				online: Boolean(streamer?.online),
				avatar,
				stale: zevent.isStale,
			}),
		);
	}
}
