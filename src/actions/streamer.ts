import streamDeck, { action, SingletonAction } from "@elgato/streamdeck";
import type {
	DialAction,
	DidReceiveSettingsEvent,
	KeyAction,
	KeyUpEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { formatAmount, formatViewers, type NumberFormat } from "../format";
import { KeyImageCache } from "../key-image";
import { renderMessageKey, renderStreamerKey } from "../render";
import { zevent } from "../zevent";

export type StreamerSettings = {
	login?: string;
	showAvatar?: boolean;
	showViewers?: boolean;
	numberFormat?: NumberFormat;
	clickAction?: "twitch" | "donation";
};

type AnyAction = KeyAction<StreamerSettings> | DialAction<StreamerSettings>;

@action({ UUID: "fr.quentinperou.zevent.streamer" })
export class StreamerAction extends SingletonAction<StreamerSettings> {
	readonly #images = new KeyImageCache();

	override async onWillAppear(ev: WillAppearEvent<StreamerSettings>): Promise<void> {
		zevent.retain();
		// La touche revient sur l'image par défaut du manifest : ce qu'on croyait
		// lui avoir envoyé ne vaut plus rien.
		this.#images.forget(ev.action.id);
		await this.#render(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<StreamerSettings>): void {
		zevent.release();
		this.#images.forget(ev.action.id);
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
