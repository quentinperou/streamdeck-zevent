/**
 * Détection des temps forts.
 *
 * Chaque sondage rapporte les 338 cagnottes d'un coup : la variation d'un
 * streamer se lit sans une requête de plus, et à la minute plutôt qu'aux dix
 * minutes de l'historique.
 *
 * Ce qu'on cherche, c'est **sortir du lot**, pas monter avec lui. Deux mesures
 * s'en chargent, et il a fallu les relevés d'une vraie soirée pour le voir :
 *
 * — On compare la **part du flux global** que capte le streamer, pas son débit.
 *   Quand le ZEvent entier s'emballe, tout le monde monte ensemble : à débit
 *   brut, toutes les touches s'allument à la fois. Ramené à sa part, un
 *   streamer qui suit la vague ne bouge pas.
 *
 * — Il faut **deux relevés consécutifs**. C'est ce qui compte le plus : sur les
 *   mêmes relevés, la seule part du flux déclenchait 101 fois, la durée ramène
 *   à 11. Une minute isolée au-dessus, c'est une grosse donation ; un temps
 *   fort, ça dure.
 */

import type { Streamer } from "./zevent";

/** Rythme de référence. Assez court pour suivre la soirée. */
const WINDOW_MS = 1_200_000;
/**
 * Relevés nécessaires avant de qualifier quoi que ce soit. Au démarrage il n'y
 * a pas de référence : mieux vaut ne rien signaler que d'inventer.
 */
const WARMUP = 8;
/** Multiple de la part habituelle au-delà duquel le relevé compte. */
const MULTIPLE = 5;
/** Relevés consécutifs au-dessus du seuil avant d'allumer. */
const STREAK = 2;
/**
 * Plancher, en euros par minute. Il ne change presque rien aux grosses
 * cagnottes ; il empêche une chaîne endormie de s'allumer pour deux dons, sa
 * part habituelle étant alors nulle.
 */
const FLOOR = 50;
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
	/** Hausse cumulée depuis le début du temps fort, en euros. */
	delta: number;
	/** Combien de fois la part habituelle du streamer. */
	ratio: number;
};

type Sample = { amount: number; at: number };
/** Un relevé : le débit du streamer et celui du ZEvent au même instant. */
type Beat = { rate: number; global: number; at: number };
type Streak = {
	samples: number;
	total: number;
	/** Part de référence figée au début de la rafale. */
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
	#global: Sample | null = null;

	/** Un nouveau relevé du ZEvent : on en tire les variations. */
	observe(streamers: Streamer[], total: number, now = Date.now()): void {
		// Le ZEvent ne rafraîchit ses montants qu'environ toutes les minutes. Un
		// relevé identique au précédent n'apporte aucune information, et ses zéros
		// tireraient toutes les références vers le bas.
		if (this.#global?.amount === total) return;

		const previousGlobal = this.#global;
		this.#global = { amount: total, at: now };

		const minutes = previousGlobal ? (now - previousGlobal.at) / 60_000 : 0;
		const globalRate =
			previousGlobal && minutes > 0 ? Math.max(0, total - previousGlobal.amount) / minutes : 0;

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

			this.#judge(streamer.login, delta, rate, globalRate, window, now);

			window.push({ rate, global: globalRate, at: now });
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

	/**
	 * Décide si ce relevé prolonge un temps fort, et allume au bout de `STREAK`.
	 *
	 * La part de référence exclut le relevé courant : un pic ne doit pas se
	 * comparer à lui-même.
	 */
	#judge(
		login: string,
		delta: number,
		rate: number,
		globalRate: number,
		window: Beat[],
		now: number,
	): void {
		const shares = window.filter((beat) => beat.global > 0).map((beat) => beat.rate / beat.global);
		const share = globalRate > 0 ? rate / globalRate : 0;

		// Une rafale en cours garde la référence du calme qui la précédait. Sans
		// ça son premier relevé entre dans la moyenne, relève le seuil, et le
		// deuxième échoue — aucune rafale ne tiendrait jamais deux relevés.
		const running = this.#streaks.get(login);
		const baseline = running?.baseline ?? mean(shares);

		const qualifies =
			rate >= FLOOR && globalRate > 0 && shares.length >= WARMUP && share >= baseline * MULTIPLE;

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
			ratio: baseline > 0 ? share / baseline : Infinity,
			until: now + ALERT_MS,
		});
	}
}

export const spikes = new SpikeWatcher();
