import streamDeck from "@elgato/streamdeck";

import { GoalAction } from "./actions/goal";
import { StreamerAction } from "./actions/streamer";
import { TotalAction } from "./actions/total";
import { goals } from "./goals";
import { sendCatalogue, sendGoals } from "./pi";
import { zevent } from "./zevent";

const streamerAction = new StreamerAction();
const totalAction = new TotalAction();
const goalAction = new GoalAction();

streamDeck.actions.registerAction(streamerAction);
streamDeck.actions.registerAction(totalAction);
streamDeck.actions.registerAction(goalAction);

// Un seul appel au ZEvent alimente toutes les touches : chaque réponse les
// redessine d'un coup, et rafraîchit le Property Inspector s'il est ouvert.
zevent.subscribe(() => {
	void streamerAction.renderAll();
	void totalAction.renderAll();
	void goalAction.renderAll();
	void sendCatalogue();
});

// Les paliers viennent d'un autre endpoint, à leur propre rythme : seules les
// touches « palier » ont besoin d'être redessinées quand ils bougent.
goals.subscribe(() => {
	void goalAction.renderAll();
});

// Le Property Inspector ne peut pas appeler l'API du ZEvent lui-même : le
// catalogue lui est poussé à l'ouverture, puis sur demande explicite.
streamDeck.ui.onDidAppear(async () => {
	await zevent.refresh();
	await sendCatalogue();
});

streamDeck.ui.onSendToPlugin(async (ev) => {
	const payload = ev.payload as { event?: string; twitchId?: string } | null;

	if (payload?.event === "getGoals" && payload.twitchId) {
		await sendGoals(payload.twitchId);
		return;
	}

	if (payload?.event === "refresh") {
		await zevent.refresh();
		await goals.refresh();
	}
	await sendCatalogue();
});

streamDeck.connect();
