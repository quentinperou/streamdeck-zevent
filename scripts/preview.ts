/** Banc d'essai : interroge le ZEvent et écrit les visuels de touche sur disque. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderMessageKey, renderStreamerKey, renderTotalKey } from "../src/render";
import { zevent } from "../src/zevent";

const OUT = process.argv[2] ?? ".";

function write(name: string, dataUri: string): void {
	const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
	writeFileSync(join(OUT, `${name}.svg`), Buffer.from(base64, "base64"));
}

function formatCount(value: number): string {
	return Math.round(value)
		.toString()
		.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

async function main(): Promise<void> {
	await zevent.refresh(true);

	console.log("erreur      :", zevent.error ?? "aucune");
	console.log("streamers   :", zevent.streamers.length);
	console.log("en direct   :", zevent.streamers.filter((s) => s.online).length);
	console.log("totaux      :", JSON.stringify(zevent.totals));

	const live = zevent.streamers.filter((s) => s.online);
	const samples = [
		zevent.streamers[0],
		live[0],
		live.find((s) => s.display.length > 12),
		zevent.streamers.find((s) => !s.online),
	].filter((s): s is NonNullable<typeof s> => Boolean(s));

	for (const streamer of samples) {
		const avatar = await zevent.avatar(streamer.login);
		console.log(
			`  ${streamer.display.padEnd(20)} ${streamer.donationText.padStart(12)}  ` +
				`${streamer.online ? "live" : "off "}  avatar:${avatar ? `${Math.round(avatar.length / 1024)}ko` : "aucun"}`,
		);
		write(
			`key-${streamer.login}`,
			renderStreamerKey({
				name: streamer.display,
				amount: streamer.donationText,
				viewers: streamer.online ? `${formatCount(streamer.viewers)} viewers` : "hors ligne",
				online: streamer.online,
				avatar,
				stale: false,
			}),
		);
	}

	const totals = zevent.totals!;
	write(
		"key-total",
		renderTotalKey({
			label: "ZEVENT",
			amount: totals.donationText,
			viewers: `${formatCount(totals.viewers)} viewers`,
			stale: false,
		}),
	);
	write("key-empty", renderMessageKey("Choisir un streamer"));
	write("key-error", renderMessageKey("ZEvent injoignable", "warning"));
}

void main();
