/**
 * Paliers de dons, avec deux sources au choix.
 *
 * L'API officielle du ZEvent ne les expose pas dans sa liste principale : ils
 * vivent sur `api.zevent.fr/streamer/<twitch_id>`, une fiche à la fois. InGDoc
 * les publie aussi, plus complètement — sur 60 streamers observés, 8 % sont
 * annoncés sans aucun palier par l'officiel alors qu'ils en ont une quinzaine.
 *
 * Aucune des deux n'est garantie : le mode « auto » interroge InGDoc et retombe
 * sur l'officiel dès qu'il ne répond pas. Un choix explicite, lui, est respecté
 * — la touche affiche alors l'indisponibilité plutôt que des chiffres venus
 * d'ailleurs.
 */

import { groupDigits } from "./format";
import { ingdoc } from "./ingdoc";
import { normalizeSpaces } from "./zevent";

const ZEVENT_URL = (twitchId: string) =>
	`https://api.zevent.fr/streamer/${encodeURIComponent(twitchId)}`;
const USER_AGENT = "streamdeck-zevent/1.0 (+https://github.com/quentinperou)";

/** Même cadence que la liste principale, pour ne pas doubler le trafic sortant. */
const POLL_INTERVAL_MS = 60_000;
/** La fiche officielle déclare `max-age=10` ; en deçà on retéléchargerait la même réponse. */
const MIN_REFRESH_MS = 15_000;

/** Source demandée par l'utilisateur. */
export type GoalSource = "auto" | "zevent" | "ingdoc";
/** Source qui a effectivement répondu. */
export type ResolvedSource = "zevent" | "ingdoc";

export type Goal = {
	title: string;
	amount: number;
	amountText: string;
	reached: boolean;
};

export type StreamerGoals = {
	twitchId: string;
	source: ResolvedSource;
	donation: number;
	donationText: string;
	/** Triés par montant croissant : c'est l'ordre dans lequel ils tombent. */
	goals: Goal[];
};

type RawZeventGoal = {
	title?: string;
	amountRequired?: { number?: number; formatted?: string };
};

type RawZeventPayload = {
	donationAmount?: { number?: number; formatted?: string };
	donationGoal?: { goals?: RawZeventGoal[] };
};

type Entry = {
	twitchId: string;
	source: GoalSource;
	watchers: number;
	data: StreamerGoals | null;
	fetchedAt: number;
	failures: number;
	inFlight: Promise<void> | null;
};

function euros(amount: number): string {
	return `${groupDigits(amount)} €`;
}

/** Une entrée par couple streamer/source : deux touches peuvent diverger. */
function keyOf(twitchId: string, source: GoalSource): string {
	return `${source}:${twitchId}`;
}

class GoalStore {
	#entries = new Map<string, Entry>();
	#listeners = new Set<() => void>();
	#timer: NodeJS.Timeout | null = null;

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	get(twitchId: string | undefined | null, source: GoalSource): StreamerGoals | null {
		if (!twitchId) return null;
		return this.#entries.get(keyOf(twitchId, source))?.data ?? null;
	}

	failed(twitchId: string | undefined | null, source: GoalSource): boolean {
		if (!twitchId) return false;
		const entry = this.#entries.get(keyOf(twitchId, source));
		return Boolean(entry && entry.failures > 0 && entry.data === null);
	}

	/** Une touche affiche ce streamer : sa fiche entre dans la rotation. */
	retain(twitchId: string, source: GoalSource): void {
		const key = keyOf(twitchId, source);
		const entry = this.#entries.get(key) ?? {
			twitchId,
			source,
			watchers: 0,
			data: null,
			fetchedAt: 0,
			failures: 0,
			inFlight: null,
		};
		entry.watchers += 1;
		this.#entries.set(key, entry);

		void this.#load(key).catch(() => {});
		this.#schedule();
	}

	release(twitchId: string, source: GoalSource): void {
		const entry = this.#entries.get(keyOf(twitchId, source));
		if (!entry) return;

		entry.watchers = Math.max(0, entry.watchers - 1);
		if ([...this.#entries.values()].every((e) => e.watchers === 0)) this.#stop();
	}

	/**
	 * Charge une fiche sans l'inscrire à la rotation : le Property Inspector a
	 * besoin des paliers pour les proposer, mais une fenêtre ouverte ne doit pas
	 * laisser derrière elle une fiche interrogée à vie.
	 */
	async preload(twitchId: string, source: GoalSource): Promise<StreamerGoals | null> {
		const key = keyOf(twitchId, source);
		if (!this.#entries.has(key)) {
			this.#entries.set(key, {
				twitchId,
				source,
				watchers: 0,
				data: null,
				fetchedAt: 0,
				failures: 0,
				inFlight: null,
			});
		}
		await this.#load(key);
		return this.get(twitchId, source);
	}

	async refresh(): Promise<void> {
		const watched = [...this.#entries.entries()].filter(([, e]) => e.watchers > 0);
		await Promise.all(watched.map(([key]) => this.#load(key)));
	}

	async #load(key: string): Promise<void> {
		const entry = this.#entries.get(key);
		if (!entry) return;
		if (entry.inFlight) return entry.inFlight;
		if (Date.now() - entry.fetchedAt < MIN_REFRESH_MS) return;

		entry.inFlight = this.#fetch(entry).finally(() => {
			entry.inFlight = null;
		});
		return entry.inFlight;
	}

	async #fetch(entry: Entry): Promise<void> {
		try {
			const data = await this.#resolve(entry.twitchId, entry.source);
			if (data) {
				entry.data = data;
				entry.failures = 0;
				entry.fetchedAt = Date.now();
			} else {
				entry.failures += 1;
			}
		} catch {
			// La dernière fiche connue reste affichée : un palier ne bouge pas vite.
			entry.failures += 1;
		}
		this.#notify();
	}

	/** Applique le choix de source, repli compris. */
	async #resolve(twitchId: string, source: GoalSource): Promise<StreamerGoals | null> {
		if (source === "zevent") return this.#fromZevent(twitchId);
		if (source === "ingdoc") return this.#fromIngdoc(twitchId);

		// Mode automatique : InGDoc d'abord, l'officiel dès qu'il flanche. Aucune
		// panne d'InGDoc ne doit se voir sur la touche.
		try {
			const data = await this.#fromIngdoc(twitchId);
			if (data) return data;
		} catch {
			// on bascule
		}
		return this.#fromZevent(twitchId);
	}

	async #fromZevent(twitchId: string): Promise<StreamerGoals | null> {
		const res = await fetch(ZEVENT_URL(twitchId), {
			headers: { accept: "application/json", "user-agent": USER_AGENT },
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const data = (await res.json()) as RawZeventPayload;
		const donation = data.donationAmount?.number ?? 0;

		return {
			twitchId,
			source: "zevent",
			donation,
			donationText: normalizeSpaces(data.donationAmount?.formatted ?? "0 €"),
			goals: (data.donationGoal?.goals ?? [])
				.filter((raw): raw is RawZeventGoal & { amountRequired: { number: number } } =>
					typeof raw.amountRequired?.number === "number",
				)
				.map((raw) => ({
					title: raw.title?.trim() || "Palier",
					amount: raw.amountRequired.number,
					amountText: normalizeSpaces(
						raw.amountRequired.formatted ?? euros(raw.amountRequired.number),
					),
					reached: raw.amountRequired.number <= donation,
				}))
				.sort((a, b) => a.amount - b.amount),
		};
	}

	async #fromIngdoc(twitchId: string): Promise<StreamerGoals | null> {
		const found = await ingdoc.goals(twitchId);
		if (!found) return null;

		return {
			twitchId,
			source: "ingdoc",
			donation: found.entry.amountRaised,
			donationText: euros(found.entry.amountRaised),
			goals: found.goals.map((goal) => ({
				title: goal.title,
				amount: goal.amount,
				amountText: euros(goal.amount),
				reached: goal.reached,
			})),
		};
	}

	#schedule(): void {
		if (this.#timer) return;
		this.#timer = setInterval(() => void this.refresh().catch(() => {}), POLL_INTERVAL_MS);
		this.#timer.unref?.();
	}

	#stop(): void {
		if (!this.#timer) return;
		clearInterval(this.#timer);
		this.#timer = null;
	}

	#notify(): void {
		for (const listener of this.#listeners) {
			try {
				listener();
			} catch {
				// Un abonné qui échoue ne prive pas les autres de la mise à jour.
			}
		}
	}
}

export const goals = new GoalStore();

/**
 * Le palier à afficher : celui qu'on vise encore, ou celui que l'utilisateur a
 * choisi explicitement. `null` quand tout est atteint et qu'aucun n'est imposé.
 */
export function pickGoal(data: StreamerGoals, index: number | "next"): Goal | null {
	if (index !== "next") return data.goals[index] ?? null;
	return data.goals.find((goal) => !goal.reached) ?? null;
}

/**
 * Avancement vers un palier, en tenant compte du précédent : une barre qui
 * repart de zéro à chaque palier franchi dit mieux l'effort restant qu'une
 * barre mesurée depuis le premier euro.
 */
export function progressToward(data: StreamerGoals, goal: Goal): number {
	const previous = data.goals.filter((g) => g.amount < goal.amount).pop();
	const floor = previous?.amount ?? 0;
	const span = goal.amount - floor;
	if (span <= 0) return goal.reached ? 1 : 0;

	return Math.max(0, Math.min(1, (data.donation - floor) / span));
}
