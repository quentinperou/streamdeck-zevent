import streamDeck, { action, SingletonAction } from "@elgato/streamdeck";
import type {
	DialAction,
	DidReceiveSettingsEvent,
	KeyAction,
	KeyUpEvent,
	WillAppearEvent,
} from "@elgato/streamdeck";

import { renderMessageKey, renderStreamerKey } from "../render";
import { zevent } from "../zevent";

export type StreamerSettings = {
	login?: string;
	showAvatar?: boolean;
	showViewers?: boolean;
	clickAction?: "twitch" | "donation";
};

type AnyAction = KeyAction<StreamerSettings> | DialAction<StreamerSettings>;

/** Groupe les milliers sans dépendre de l'ICU embarquée par Stream Deck. */
function formatCount(value: number): string {
	return Math.round(value)
		.toString()
		.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

@action({ UUID: "fr.quentinperou.zevent.streamer" })
export class StreamerAction extends SingletonAction<StreamerSettings> {
	override async onWillAppear(ev: WillAppearEvent<StreamerSettings>): Promise<void> {
		zevent.retain();
		await this.#render(ev.action, ev.payload.settings);
	}

	override onWillDisappear(): void {
		zevent.release();
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<StreamerSettings>): Promise<void> {
		await this.#render(ev.action, ev.payload.settings);
	}

	override async onKeyUp(ev: KeyUpEvent<StreamerSettings>): Promise<void> {
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

	/** Redessine toutes les touches visibles de cette action. */
	async renderAll(): Promise<void> {
		for (const target of this.actions) {
			await this.#render(target, await target.getSettings());
		}
	}

	async #render(target: AnyAction, settings: StreamerSettings): Promise<void> {
		if (!target.isKey()) return;

		const login = settings.login?.trim();
		if (!login) {
			await target.setImage(renderMessageKey("Choisir un streamer"));
			return;
		}

		const streamer = zevent.find(login);
		if (!streamer) {
			// Tant que rien n'est arrivé, on ne peut pas distinguer un pseudo
			// inconnu d'un catalogue pas encore chargé : on ne l'affirme pas.
			if (!zevent.hasData) {
				await target.setImage(
					zevent.error
						? renderMessageKey("ZEvent injoignable", "warning")
						: renderMessageKey("Chargement…"),
				);
			} else {
				await target.setImage(renderMessageKey(`${login} hors ZEvent`, "warning"));
			}
			return;
		}

		const avatar = settings.showAvatar === false ? null : await zevent.avatar(streamer.login);
		const viewers =
			settings.showViewers === false
				? null
				: streamer.online
					? `${formatCount(streamer.viewers)} viewers`
					: "hors ligne";

		await target.setImage(
			renderStreamerKey({
				name: streamer.display,
				amount: streamer.donationText,
				viewers,
				online: streamer.online,
				avatar,
				stale: zevent.isStale,
			}),
		);
	}
}
