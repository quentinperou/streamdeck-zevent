/**
 * Détection des temps forts.
 *
 * Chaque sondage rapporte les 338 cagnottes d'un coup : la variation d'un
 * streamer se lit sans une requête de plus, et à la minute plutôt qu'aux dix
 * minutes de l'historique.
 *
 * Reste à décider ce qui mérite d'être signalé, et ce ne peut pas être un
 * montant fixe : sur les relevés d'une édition, le plus gros pic d'un petit
 * streamer (212 €/10 min) passe sous le rythme *ordinaire* d'un gros
 * (704 €/10 min). Un seuil en euros décorerait toujours les mêmes chaînes.
 * Chaque streamer est donc comparé à son propre rythme récent — les pics
 * observés sortent entre 19 et 239 fois au-dessus, il y a de la marge.
 */

import type { Streamer } from "./zevent";

/** Rythme retenu pour la comparaison. Assez court pour suivre la soirée. */
const WINDOW_MS = 1_200_000;
/**
 * Relevés nécessaires avant de qualifier quoi que ce soit. Au démarrage il n'y
 * a pas de rythme de référence : mieux vaut ne rien signaler que d'inventer.
 */
const WARMUP = 8;
/** Multiple du rythme ordinaire au-delà duquel on parle de temps fort. */
const MULTIPLE = 6;
/**
 * Plancher, en euros par minute. Sans lui, une chaîne dont le rythme est nul —
 * le cas de la plupart, la plupart du temps — s'allumerait au premier don de
 * deux euros.
 */
const FLOOR = 20;
/** Durée d'affichage après le dernier relevé qualifiant. */
const ALERT_MS = 180_000;
/**
 * Intervalles hors desquels on repart de zéro. Le plugin ne sonde que si une
 * touche est visible : au réveil, l'écart couvre parfois des heures, et la
 * hausse accumulée n'a plus rien d'un pic.
 */
const MIN_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 300_000;

export type Spike = {
	/** Hausse constatée sur l'intervalle, en euros. */
	delta: number;
	/** Combien de fois le rythme ordinaire du streamer. */
	ratio: number;
};

type Sample = { amount: number; at: number };
type Rate = { value: number; at: number };

class SpikeWatcher {
	#last = new Map<string, Sample>();
	#rates = new Map<string, Rate[]>();
	#alerts = new Map<string, Spike & { until: number }>();

	/** Un nouveau relevé du ZEvent : on en tire les variations. */
	observe(streamers: Streamer[], now = Date.now()): void {
		for (const streamer of streamers) {
			const previous = this.#last.get(streamer.login);
			this.#last.set(streamer.login, { amount: streamer.donation, at: now });
			if (!previous) continue;

			const interval = now - previous.at;
			if (interval < MIN_INTERVAL_MS) {
				// Trop rapproché pour mesurer quoi que ce soit — et on garde le
				// relevé précédent comme base plutôt que de comparer à un instant.
				this.#last.set(streamer.login, previous);
				continue;
			}
			if (interval > MAX_INTERVAL_MS) {
				this.#rates.delete(streamer.login);
				continue;
			}

			// L'API corrige parfois un montant à la baisse : ce n'est pas un temps
			// faible, c'est un ajustement.
			const delta = Math.max(0, streamer.donation - previous.amount);
			const rate = delta / (interval / 60_000);

			const history = this.#rates.get(streamer.login) ?? [];
			const window = history.filter((entry) => now - entry.at < WINDOW_MS);

			// Le rythme de référence exclut le relevé courant : on compare au passé,
			// pas à soi-même.
			if (window.length >= WARMUP) {
				const baseline = window.reduce((sum, entry) => sum + entry.value, 0) / window.length;
				if (rate >= FLOOR && rate >= baseline * MULTIPLE) {
					this.#alerts.set(streamer.login, {
						delta,
						ratio: baseline > 0 ? rate / baseline : Infinity,
						until: now + ALERT_MS,
					});
				}
			}

			window.push({ value: rate, at: now });
			this.#rates.set(streamer.login, window);
		}
	}

	/** Le temps fort en cours, s'il y en a un. */
	get(login: string, now = Date.now()): Spike | null {
		const alert = this.#alerts.get(login);
		if (!alert) return null;
		if (alert.until <= now) {
			this.#alerts.delete(login);
			return null;
		}
		return { delta: alert.delta, ratio: alert.ratio };
	}
}

export const spikes = new SpikeWatcher();
