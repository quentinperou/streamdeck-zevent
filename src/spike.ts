/**
 * Détection des temps forts.
 *
 * La règle tient en une phrase : **un streamer qui reçoit cinq fois son rythme
 * des vingt dernières minutes, deux relevés de suite**. Chaque sondage rapporte
 * les 338 cagnottes d'un coup, donc tout se lit sans une requête de plus, et à
 * la minute plutôt qu'aux dix minutes de l'historique.
 *
 * Deux choses ont été apprises en rejouant de vraies soirées, et méritent de ne
 * pas être refaites :
 *
 * — **C'est la durée qui fait le travail.** Une première version sans elle
 *   encadrait 14,5 touches sur 340 en permanence. Une minute isolée au-dessus
 *   du seuil, c'est une grosse donation ; un temps fort, ça dure.
 *
 * — **Comparer en part du flux global est une fausse bonne idée.** Elle avait
 *   été essayée pour qu'une vague soulevant tout le ZEvent ne compte pas comme
 *   un exploit personnel — mais la durée s'en charge déjà, et la part a un
 *   défaut propre : elle monte toute seule quand le flux global baisse. Un
 *   streamer à son rythme habituel pendant que le ZEvent ralentit voyait sa
 *   part grimper sans avoir rien fait. Sur les mêmes relevés, la part allume
 *   moitié plus de touches que les euros bruts.
 */

import type { Streamer } from "./zevent";

/** Rythme de référence. Assez court pour suivre la soirée. */
const WINDOW_MS = 1_200_000;
/**
 * Relevés nécessaires avant de qualifier quoi que ce soit. Au démarrage il n'y
 * a pas de rythme de référence : mieux vaut ne rien signaler que d'inventer.
 */
const WARMUP = 8;
/** Multiple du rythme habituel au-delà duquel le relevé compte. */
const MULTIPLE = 5;
/**
 * Relevés consécutifs au-dessus du seuil avant d'allumer. C'est le réglage le
 * plus lourd de tous : sans lui, dix fois plus de touches encadrées.
 */
const STREAK = 2;
/**
 * Plancher, en euros par minute. Il ne change presque rien aux grosses
 * cagnottes ; il empêche une chaîne endormie de s'allumer pour deux dons, son
 * rythme habituel étant alors nul.
 */
const FLOOR = 50;
/** Durée d'affichage après le dernier relevé qualifiant. */
const ALERT_MS = 180_000;
/**
 * Intervalles hors desquels on repart de zéro. Le plugin ne sonde que si une
 * touche est visible : au réveil, l'écart entre deux relevés couvre parfois des
 * heures, et la hausse accumulée n'a plus rien d'un pic.
 */
const MIN_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 300_000;

export type Spike = {
	/** Hausse cumulée depuis le début du temps fort, en euros. */
	delta: number;
	/** Combien de fois son rythme habituel. */
	ratio: number;
};

type Sample = { amount: number; at: number };
/** Un relevé de débit, en euros par minute. */
type Beat = { rate: number; at: number };
type Streak = {
	samples: number;
	total: number;
	/** Rythme de référence figé au début de la rafale. */
	baseline: number;
};

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

class SpikeWatcher {
	#last = new Map<string, Sample>();
	#beats = new Map<string, Beat[]>();
	#streaks = new Map<string, Streak>();
	#alerts = new Map<string, Spike & { until: number }>();
	#global = 0;

	/** Un nouveau relevé du ZEvent : on en tire les variations. */
	observe(streamers: Streamer[], total: number, now = Date.now()): void {
		// Le ZEvent ne rafraîchit ses montants qu'environ toutes les minutes. Un
		// relevé identique au précédent n'apporte aucune information, et ses zéros
		// tireraient tous les rythmes de référence vers le bas.
		if (total === this.#global) return;
		this.#global = total;

		for (const streamer of streamers) {
			const previous = this.#last.get(streamer.login);
			this.#last.set(streamer.login, { amount: streamer.donation, at: now });
			if (!previous) continue;

			const interval = now - previous.at;
			if (interval < MIN_INTERVAL_MS) {
				// Trop rapproché pour mesurer : on garde le relevé précédent comme
				// base plutôt que de comparer à un instant.
				this.#last.set(streamer.login, previous);
				continue;
			}
			if (interval > MAX_INTERVAL_MS) {
				this.#beats.delete(streamer.login);
				this.#streaks.delete(streamer.login);
				continue;
			}

			// L'API corrige parfois un montant à la baisse : ce n'est pas un temps
			// faible, c'est un ajustement.
			const delta = Math.max(0, streamer.donation - previous.amount);
			const rate = delta / (interval / 60_000);

			const history = this.#beats.get(streamer.login) ?? [];
			const window = history.filter((beat) => now - beat.at < WINDOW_MS);

			this.#judge(streamer.login, delta, rate, window, now);

			window.push({ rate, at: now });
			this.#beats.set(streamer.login, window);
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

	/** Décide si ce relevé prolonge un temps fort, et allume au bout de `STREAK`. */
	#judge(login: string, delta: number, rate: number, window: Beat[], now: number): void {
		// Une rafale en cours garde le rythme du calme qui la précédait. Sans ça
		// son premier relevé entre dans la moyenne, relève le seuil, et le
		// deuxième échoue — aucune rafale ne tiendrait jamais deux relevés.
		const running = this.#streaks.get(login);
		const baseline = running?.baseline ?? mean(window.map((beat) => beat.rate));

		const qualifies = rate >= FLOOR && window.length >= WARMUP && rate >= baseline * MULTIPLE;

		if (!qualifies) {
			this.#streaks.delete(login);
			return;
		}

		const streak: Streak = {
			samples: (running?.samples ?? 0) + 1,
			total: (running?.total ?? 0) + delta,
			baseline,
		};
		this.#streaks.set(login, streak);

		if (streak.samples < STREAK) return;

		this.#alerts.set(login, {
			// La hausse annoncée couvre tout le temps fort, pas seulement sa
			// dernière minute : c'est l'ampleur du moment qui intéresse.
			delta: streak.total,
			ratio: baseline > 0 ? rate / baseline : Infinity,
			until: now + ALERT_MS,
		});
	}
}

export const spikes = new SpikeWatcher();
