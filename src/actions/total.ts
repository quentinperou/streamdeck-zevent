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
import { renderMessageKey, renderTotalKey } from "../render";
import { zevent } from "../zevent";

export type TotalSettings = {
	label?: string;
	showViewers?: boolean;
	numberFormat?: NumberFormat;
	clickAction?: "donation" | "site";
};

type AnyAction = KeyAction<TotalSettings> | DialAction<TotalSettings>;

@action({ UUID: "fr.quentinperou.zevent.total" })
export class TotalAction extends SingletonAction<TotalSettings> {
	readonly #images = new KeyImageCache();

	override async onWillAppear(ev: WillAppearEvent<TotalSettings>): Promise<void> {
		zevent.retain();
		// La touche revient sur l'image par défaut du manifest : ce qu'on croyait
		// lui avoir envoyé ne vaut plus rien.
		this.#images.forget(ev.action.id);
		await this.#render(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<TotalSettings>): void {
		zevent.release();
		this.#images.forget(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TotalSettings>): Promise<void> {
		await this.#render(ev.action, ev.payload.settings);
	}

	override async onKeyUp(ev: KeyUpEvent<TotalSettings>): Promise<void> {
		const url =
			ev.payload.settings.clickAction === "site" ? "https://zevent.fr/" : zevent.globalDonationUrl;
		await streamDeck.system.openUrl(url);
	}

	async renderAll(): Promise<void> {
		for (const target of this.actions) {
			await this.#render(target, await target.getSettings());
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

		await this.#images.apply(
			target,
			renderTotalKey({
				label: settings.label?.trim() || "ZEVENT",
				amount: formatAmount(totals.donation, totals.donationText, format),
				viewers:
					settings.showViewers === false
						? null
						: `${formatViewers(totals.viewers, format)} viewers`,
				stale: zevent.isStale,
			}),
		);
	}
}
