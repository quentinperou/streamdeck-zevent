import streamDeck, { action, SingletonAction } from "@elgato/streamdeck";
import type {
	DialAction,
	DidReceiveSettingsEvent,
	KeyAction,
	KeyUpEvent,
	WillAppearEvent,
} from "@elgato/streamdeck";

import { renderMessageKey, renderTotalKey } from "../render";
import { zevent } from "../zevent";

export type TotalSettings = {
	label?: string;
	showViewers?: boolean;
	clickAction?: "donation" | "site";
};

type AnyAction = KeyAction<TotalSettings> | DialAction<TotalSettings>;

function formatCount(value: number): string {
	return Math.round(value)
		.toString()
		.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

@action({ UUID: "fr.quentinperou.zevent.total" })
export class TotalAction extends SingletonAction<TotalSettings> {
	override async onWillAppear(ev: WillAppearEvent<TotalSettings>): Promise<void> {
		zevent.retain();
		await this.#render(ev.action, ev.payload.settings);
	}

	override onWillDisappear(): void {
		zevent.release();
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
			await target.setImage(
				zevent.error ? renderMessageKey("ZEvent injoignable", "warning") : renderMessageKey("Chargement…"),
			);
			return;
		}

		await target.setImage(
			renderTotalKey({
				label: settings.label?.trim() || "ZEVENT",
				amount: totals.donationText,
				viewers: settings.showViewers === false ? null : `${formatCount(totals.viewers)} viewers`,
				stale: zevent.isStale,
			}),
		);
	}
}
