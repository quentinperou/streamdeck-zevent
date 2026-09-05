import streamDeck, { action, SingletonAction } from "@elgato/streamdeck";
import type {
	DialAction,
	DidReceiveSettingsEvent,
	KeyAction,
	KeyUpEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { goals, pickGoal, progressToward, type GoalSource } from "../goals";
import { KeyImageCache } from "../key-image";
import { renderGoalKey, renderMessageKey } from "../render";
import { zevent } from "../zevent";

export type GoalSettings = {
	login?: string;
	/** L'identifiant Twitch : c'est par lui que se récupèrent les paliers. */
	twitchId?: string;
	/** Un rang précis, ou « next » pour suivre le prochain palier non atteint. */
	goalIndex?: number | "next";
	showAvatar?: boolean;
	/** D’où viennent les paliers. « auto » privilégie InGDoc et retombe sur l’officiel. */
	goalSource?: GoalSource;
	clickAction?: "twitch" | "donation";
};

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
		this.#watch(ev.action.id, {});
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<GoalSettings>): Promise<void> {
		this.#settings.set(ev.action.id, ev.payload.settings);
		this.#watch(ev.action.id, ev.payload.settings);
		await this.#render(ev.action, ev.payload.settings);
	}

	override async onKeyUp(ev: KeyUpEvent<GoalSettings>): Promise<void> {
		const login = ev.payload.settings.login?.trim();
		if (!login) {
			await ev.action.showAlert();
			return;
		}

		const streamer = zevent.find(login);
		const url =
			ev.payload.settings.clickAction === "donation"
				? (streamer?.donationUrl ?? `https://zevent.fr/don/${login}`)
				: `https://www.twitch.tv/${login}`;

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
