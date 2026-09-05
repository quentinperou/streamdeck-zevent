/** Banc d'essai : interroge le ZEvent et écrit les visuels de touche sur disque. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { formatAmount, formatNumber, formatViewers, type NumberFormat } from "../src/format";
import { goals, pickGoal, progressToward } from "../src/goals";
import { ingdoc } from "../src/ingdoc";
import {
	renderGoalKey,
	renderMessageKey,
	renderRankingKey,
	renderStreamerKey,
	renderTotalGraphKey,
	renderTotalKey,
} from "../src/render";
import { zevent } from "../src/zevent";

const OUT = process.argv[2] ?? ".";

/** « full » d'abord : c'est le réglage par défaut du plugin. */
const FORMATS: NumberFormat[] = ["full", "short"];

function write(name: string, dataUri: string): void {
	const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
	writeFileSync(join(OUT, `${name}.svg`), Buffer.from(base64, "base64"));
}

async function main(): Promise<void> {
	await zevent.refresh();

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
				`→ ${formatAmount(streamer.donation, streamer.donationText, "short").padStart(10)}  ` +
				`${streamer.online ? "live" : "off "}  avatar:${avatar ? `${Math.round(avatar.length / 1024)}ko` : "aucun"}`,
		);

		for (const format of FORMATS) {
			write(
				`key-${format}-${streamer.login}`,
				renderStreamerKey({
					name: streamer.display,
					amount: formatAmount(streamer.donation, streamer.donationText, format),
					viewers: streamer.online
						? `${formatViewers(streamer.viewers, format)} viewers`
						: "hors ligne",
					online: streamer.online,
					avatar,
					stale: false,
				}),
			);
		}
	}

	const totals = zevent.totals!;
	for (const format of FORMATS) {
		write(
			`key-${format}-total`,
			renderTotalKey({
				label: "ZEVENT",
				amount: formatAmount(totals.donation, totals.donationText, format),
				viewers: `${formatViewers(totals.viewers, format)} viewers`,
				stale: false,
			}),
		);
	}
	const globalPoints = await ingdoc.globalHistory().catch(() => null);
	console.log("historique  :", globalPoints ? `${globalPoints.length} points` : "indisponible");
	if (globalPoints && globalPoints.length > 1) {
		write(
			"key-total-graph",
			renderTotalGraphKey({
				label: "ZEVENT",
				amount: formatAmount(totals.donation, totals.donationText, "full"),
				points: globalPoints,
				viewers: `${formatViewers(totals.viewers, "full")} viewers`,
				stale: false,
			}),
		);
	}

	// Temps fort : la hausse est forcée ici, la détection ayant besoin d'une
	// dizaine de relevés espacés d'une minute pour se prononcer.
	const vedette = samples[1] ?? samples[0]!;
	write(
		"key-alerte",
		renderStreamerKey({
			name: vedette.display,
			amount: formatAmount(vedette.donation, vedette.donationText, "full"),
			viewers: `${formatViewers(vedette.viewers, "full")} viewers`,
			online: vedette.online,
			avatar: await zevent.avatar(vedette.login),
			stale: false,
			alert: "+11 400 €",
		}),
	);

	for (const [critere, titre] of [["donation", "CAGNOTTES"], ["viewers", "VIEWERS"]] as const) {
		const classes =
			critere === "donation"
				? zevent.streamers
				: [...zevent.streamers].sort((a, b) => b.viewers - a.viewers);
		for (const format of FORMATS) {
			write(
				`key-classement-${critere}-${format}`,
				renderRankingKey({
					title: titre,
					entries: classes.slice(0, 4).map((s) => ({
						name: s.display,
						value: formatNumber(critere === "donation" ? s.donation : s.viewers, format),
					})),
					stale: false,
				}),
			);
		}
	}

	write("key-empty", renderMessageKey("Choisir un streamer"));
	write("key-error", renderMessageKey("ZEvent injoignable", "warning"));

	// Paliers : un endpoint distinct, une fiche par streamer. Beaucoup de
	// participants n'en configurent aucun, d'où le sondage jusqu'à en trouver.
	let rendus = 0;
	for (const streamer of zevent.streamers.slice(0, 10)) {
		if (rendus >= 3) break;

		const data = await goals.preload(streamer.twitchId, "auto");
		if (!data || data.goals.length === 0) {
			console.log(`  ${streamer.display.padEnd(20)} aucun palier`);
			continue;
		}
		rendus += 1;

		const goal = pickGoal(data, "next");
		const fraction = goal ? progressToward(data, goal) : 1;
		console.log(
			`  ${streamer.display.padEnd(20)} palier ${goal ? `${data.goals.indexOf(goal) + 1}/${data.goals.length} ${goal.amountText}` : "tous atteints"}  ${Math.floor(fraction * 100)}%`,
		);

		write(
			`goal-${streamer.login}`,
			renderGoalKey({
				name: streamer.display,
				fraction,
				headline: `${Math.floor(fraction * 100)} %`,
				target: goal
					? `${data.goals.indexOf(goal) + 1}/${data.goals.length} · ${goal.amountText}`
					: "tous atteints",
				online: streamer.online,
				avatar: await zevent.avatar(streamer.login),
				stale: false,
			}),
		);
	}
}

void main();
