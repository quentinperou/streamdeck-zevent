/**
 * Pont minimal entre le Property Inspector et Stream Deck.
 *
 * Stream Deck appelle `connectElgatoStreamDeckSocket` au chargement de la page ;
 * tout le reste passe par une simple WebSocket locale.
 */
(function () {
	"use strict";

	const handlers = new Map();

	let socket = null;
	let uuid = null;
	let actionUUID = null;
	let queue = [];

	const PI = {
		/** Réglages courants de la touche en cours d'édition. */
		settings: {},

		/** Appelé à chaque réception de réglages, y compris au tout premier. */
		onSettings: null,

		/** Écoute un message `event` envoyé par le plugin. */
		on(event, handler) {
			handlers.set(event, handler);
		},

		setSettings(settings) {
			PI.settings = settings;
			send({ event: "setSettings", context: uuid, payload: settings });
		},

		sendToPlugin(payload) {
			send({ event: "sendToPlugin", context: uuid, action: actionUUID, payload: payload });
		},

		openUrl(url) {
			send({ event: "openUrl", payload: { url: url } });
		},

		connect(port, inUUID, registerEvent, info, actionInfo) {
			uuid = inUUID;

			let parsed = actionInfo;
			if (typeof parsed === "string") {
				try {
					parsed = JSON.parse(parsed);
				} catch (error) {
					parsed = null;
				}
			}
			actionUUID = parsed && parsed.action;
			PI.settings = (parsed && parsed.payload && parsed.payload.settings) || {};

			socket = new WebSocket("ws://127.0.0.1:" + port);

			socket.onopen = function () {
				send({ event: registerEvent, uuid: inUUID });
				// Les réglages arrivent avec `actionInfo` : la page peut s'afficher
				// tout de suite, sans attendre un aller-retour supplémentaire.
				if (typeof PI.onSettings === "function") PI.onSettings(PI.settings);
				const pending = queue;
				queue = [];
				pending.forEach(send);
			};

			socket.onmessage = function (message) {
				let data;
				try {
					data = JSON.parse(message.data);
				} catch (error) {
					return;
				}

				if (data.event === "didReceiveSettings") {
					PI.settings = (data.payload && data.payload.settings) || {};
					if (typeof PI.onSettings === "function") PI.onSettings(PI.settings);
					return;
				}

				if (data.event === "sendToPropertyInspector") {
					const payload = data.payload || {};
					const handler = handlers.get(payload.event);
					if (handler) handler(payload);
				}
			};
		},
	};

	function send(message) {
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(message));
		} else {
			queue.push(message);
		}
	}

	window.PI = PI;
	window.connectElgatoStreamDeckSocket = PI.connect;
})();
