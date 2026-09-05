import streamDeck from "@elgato/streamdeck";

import { abbreviate, groupDigits } from "./format";
import { goals, type GoalSource } from "./goals";
import { ingdoc } from "./ingdoc";
import { zevent } from "./zevent";

/**
 * Paliers d'un streamer, pour que le Property Inspector puisse les proposer.
 * Ils vivent sur un autre endpoint que la liste, d'où cet envoi séparé.
 */
export async function sendGoals(twitchId: string, source: GoalSource): Promise<void> {
	if (!streamDeck.ui.action) return;

	const data = await goals.preload(twitchId, source);
	if (!streamDeck.ui.action) return;

	await streamDeck.ui.sendToPropertyInspector({
		event: "goals",
		twitchId,
		found: data !== null,
		// La source qui a réellement répondu : en mode auto, ce n'est pas
		// forcément celle qu'on a demandée.
		source: data?.source ?? null,
		donation: data?.donationText ?? null,
		goals: (data?.goals ?? []).map((goal, index) => ({
			index,
			title: goal.title,
			amount: goal.amountText,
			reached: goal.reached,
		})),
	});
}

/**
 * Nombre de paliers par streamer, pour annoter le menu déroulant.
 *
 * Un seul appel à InGDoc couvre les 338 participants ; l'API officielle en
 * exigerait autant de requêtes. Un échec reste silencieux : l'annotation est
 * un confort de choix, pas une donnée dont dépend l'affichage.
 */
export async function sendGoalCounts(): Promise<void> {
	if (!streamDeck.ui.action) return;

	const counts: Record<string, number> = {};
	try {
		for (const [twitchId, entry] of await ingdoc.overview()) {
			counts[twitchId] = entry.goalCount;
		}
	} catch {
		return;
	}

	if (!streamDeck.ui.action) return;
	await streamDeck.ui.sendToPropertyInspector({ event: "goalCounts", counts });
}

/**
 * Le Property Inspector est une page web : l'API du ZEvent, dépourvue d'en-têtes
 * CORS, lui est inaccessible. C'est donc le plugin qui lui pousse le catalogue,
 * à l'ouverture puis à chaque rafraîchissement — les montants affichés dans la
 * liste restent ainsi vivants pendant que l'utilisateur choisit.
 *
 * Les deux mises en forme des nombres voyagent déjà calculées : la page n'a
 * alors aucune logique de formatage à dupliquer, et son aperçu ne peut pas
 * diverger de ce que la touche affichera.
 */
export async function sendCatalogue(): Promise<void> {
	if (!streamDeck.ui.action) return;

	const totals = zevent.totals;

	await streamDeck.ui.sendToPropertyInspector({
		event: "catalogue",
		ready: zevent.hasData,
		stale: zevent.isStale,
		error: zevent.error,
		totals: totals && {
			...totals,
			donationShort: `${abbreviate(totals.donation)} €`,
			viewersFull: groupDigits(totals.viewers),
			viewersShort: abbreviate(totals.viewers),
		},
		streamers: zevent.streamers.map((streamer) => ({
			login: streamer.login,
			// L'action « palier » en a besoin : les paliers se récupèrent par
			// identifiant Twitch, sur un endpoint distinct de la liste.
			twitchId: streamer.twitchId,
			display: streamer.display,
			avatar: streamer.avatarUrl,
			donation: streamer.donationText,
			donationShort: `${abbreviate(streamer.donation)} €`,
			donationValue: streamer.donation,
			viewers: streamer.viewers,
			viewersFull: groupDigits(streamer.viewers),
			viewersShort: abbreviate(streamer.viewers),
			online: streamer.online,
		})),
	});
}
