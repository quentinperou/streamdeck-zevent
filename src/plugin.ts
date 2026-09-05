import streamDeck from "@elgato/streamdeck";

import { GoalAction } from "./actions/goal";
import { StreamerAction } from "./actions/streamer";
import { TotalAction } from "./actions/total";
import { goals, type GoalSource } from "./goals";
import { sendCatalogue, sendGoalCounts, sendGoals } from "./pi";
import { installSafetyNet, safely } from "./safety";
import { zevent } from "./zevent";

installSafetyNet();

const streamerAction = new StreamerAction();
const totalAction = new TotalAction();
const goalAction = new GoalAction();

streamDeck.actions.registerAction(streamerAction);
streamDeck.actions.registerAction(totalAction);
streamDeck.actions.registerAction(goalAction);

// Un seul appel au ZEvent alimente toutes les touches : chaque réponse les
// redessine d'un coup, et rafraîchit le Property Inspector s'il est ouvert.
zevent.subscribe(() => {
	safely(streamerAction.renderAll(), "redessin des cagnottes streamer");
	safely(totalAction.renderAll(), "redessin de la cagnotte globale");
	safely(goalAction.renderAll(), "redessin des paliers");
	safely(sendCatalogue(), "envoi du catalogue");
});

// Les paliers viennent d'un autre endpoint, à leur propre rythme : seules les
// touches « palier » ont besoin d'être redessinées quand ils bougent.
goals.subscribe(() => {
	safely(goalAction.renderAll(), "redessin des paliers");
});

// Le Property Inspector ne peut pas appeler l'API du ZEvent lui-même : le
// catalogue lui est poussé à l'ouverture, puis sur demande explicite.
streamDeck.ui.onDidAppear(() => {
	safely(
		zevent.refresh().then(() => sendCatalogue()),
		"ouverture du Property Inspector",
	);
});

streamDeck.ui.onSendToPlugin((ev) => {
	const payload = ev.payload as {
		event?: string;
		twitchId?: string;
		source?: GoalSource;
	} | null;

	if (payload?.event === "getGoals" && payload.twitchId) {
		safely(sendGoals(payload.twitchId, payload.source ?? "auto"), "envoi des paliers");
		return;
	}

	if (payload?.event === "getGoalCounts") {
		safely(sendGoalCounts(), "envoi du décompte des paliers");
		return;
	}

	const work =
		payload?.event === "refresh"
			? Promise.all([zevent.refresh(), goals.refresh()]).then(() => sendCatalogue())
			: sendCatalogue();
	safely(work, "demande du Property Inspector");
});

streamDeck.connect();
