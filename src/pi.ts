import streamDeck from "@elgato/streamdeck";

import { abbreviate, groupDigits } from "./format";
import { zevent } from "./zevent";

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
