import streamDeck from "@elgato/streamdeck";

import { zevent } from "./zevent";

/**
 * Le Property Inspector est une page web : l'API du ZEvent, dépourvue d'en-têtes
 * CORS, lui est inaccessible. C'est donc le plugin qui lui pousse le catalogue,
 * à l'ouverture puis à chaque rafraîchissement — les montants affichés dans la
 * liste restent ainsi vivants pendant que l'utilisateur choisit.
 */
export async function sendCatalogue(): Promise<void> {
	if (!streamDeck.ui.action) return;

	await streamDeck.ui.sendToPropertyInspector({
		event: "catalogue",
		ready: zevent.hasData,
		stale: zevent.isStale,
		error: zevent.error,
		totals: zevent.totals,
		streamers: zevent.streamers.map((streamer) => ({
			login: streamer.login,
			display: streamer.display,
			avatar: streamer.avatarUrl,
			donation: streamer.donationText,
			donationValue: streamer.donation,
			viewers: streamer.viewers,
			online: streamer.online,
		})),
	});
}
