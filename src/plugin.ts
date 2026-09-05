import streamDeck from "@elgato/streamdeck";

import { StreamerAction } from "./actions/streamer";
import { TotalAction } from "./actions/total";
import { sendCatalogue } from "./pi";
import { zevent } from "./zevent";

const streamerAction = new StreamerAction();
const totalAction = new TotalAction();

streamDeck.actions.registerAction(streamerAction);
streamDeck.actions.registerAction(totalAction);

// Un seul appel au ZEvent alimente toutes les touches : chaque réponse les
// redessine d'un coup, et rafraîchit le Property Inspector s'il est ouvert.
zevent.subscribe(() => {
	void streamerAction.renderAll();
	void totalAction.renderAll();
	void sendCatalogue();
});

// Le Property Inspector ne peut pas appeler l'API du ZEvent lui-même : le
// catalogue lui est poussé à l'ouverture, puis sur demande explicite.
streamDeck.ui.onDidAppear(async () => {
	await zevent.refresh();
	await sendCatalogue();
});

streamDeck.ui.onSendToPlugin(async (ev) => {
	const payload = ev.payload as { event?: string } | null;
	if (payload?.event === "refresh") {
		await zevent.refresh();
	}
	await sendCatalogue();
});

streamDeck.connect();
