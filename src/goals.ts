/**
 * Paliers de dons, streamer par streamer.
 *
 * L'API principale du ZEvent ne les expose pas : ils vivent sur
 * `api.zevent.fr/streamer/<twitch_id>`, une fiche à la fois. On n'interroge
 * donc que les streamers réellement affichés sur une touche, jamais les 338.
 * Chaque fiche pèse environ 2 ko, contre 157 ko pour la liste complète.
 */

const API_URL = (twitchId: string) =>
	`https://api.zevent.fr/streamer/${encodeURIComponent(twitchId)}`;
const USER_AGENT = "streamdeck-zevent/1.0 (+https://github.com/quentinperou)";

/** Même cadence que la liste principale, pour ne pas doubler le trafic sortant. */
const POLL_INTERVAL_MS = 60_000;
/** La fiche déclare `max-age=10` ; en deçà on retéléchargerait la même réponse. */
const MIN_REFRESH_MS = 15_000;

export type Goal = {
	title: string;
	amount: number;
	amountText: string;
	reached: boolean;
};

export type StreamerGoals = {
	twitchId: string;
	donation: number;
	donationText: string;
	/** Triés par montant croissant : c'est l'ordre dans lequel ils tombent. */
	goals: Goal[];
};

type RawGoal = {
	title?: string;
	amountRequired?: { number?: number; formatted?: string };
};

type RawPayload = {
	donationAmount?: { number?: number; formatted?: string };
	donationGoal?: { goals?: RawGoal[] };
};

type Entry = {
	watchers: number;
	data: StreamerGoals | null;
	fetchedAt: number;
	failures: number;
	inFlight: Promise<void> | null;
};

function normalizeSpaces(text: string): string {
	return text.replace(/[    ]/g, " ");
}

class GoalStore {
	#entries = new Map<string, Entry>();
	#listeners = new Set<() => void>();
	#timer: NodeJS.Timeout | null = null;

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	get(twitchId: string | undefined | null): StreamerGoals | null {
		if (!twitchId) return null;
		return this.#entries.get(twitchId)?.data ?? null;
	}

	failed(twitchId: string | undefined | null): boolean {
		if (!twitchId) return false;
		const entry = this.#entries.get(twitchId);
		return Boolean(entry && entry.failures > 0 && entry.data === null);
	}

	/** Une touche affiche ce streamer : sa fiche entre dans la rotation. */
	retain(twitchId: string): void {
		const entry = this.#entries.get(twitchId) ?? {
			watchers: 0,
			data: null,
			fetchedAt: 0,
			failures: 0,
			inFlight: null,
		};
		entry.watchers += 1;
		this.#entries.set(twitchId, entry);

		void this.#load(twitchId);
		this.#schedule();
	}

	release(twitchId: string): void {
		const entry = this.#entries.get(twitchId);
		if (!entry) return;

		entry.watchers -= 1;
		if (entry.watchers <= 0) {
			// La fiche n'intéresse plus personne : on cesse de la suivre, mais on
			// garde sa dernière valeur au cas où la touche revienne.
			entry.watchers = 0;
		}
		if ([...this.#entries.values()].every((e) => e.watchers === 0)) {
			this.#stop();
		}
	}

	/**
	 * Charge une fiche sans l'inscrire à la rotation : le Property Inspector a
	 * besoin de la liste des paliers pour la proposer, mais une fenêtre ouverte
	 * ne doit pas laisser derrière elle une fiche interrogée à vie.
	 */
	async preload(twitchId: string): Promise<StreamerGoals | null> {
		if (!this.#entries.has(twitchId)) {
			this.#entries.set(twitchId, {
				watchers: 0,
				data: null,
				fetchedAt: 0,
				failures: 0,
				inFlight: null,
			});
		}
		await this.#load(twitchId);
		return this.get(twitchId);
	}

	async refresh(): Promise<void> {
		const watched = [...this.#entries.entries()].filter(([, e]) => e.watchers > 0);
		await Promise.all(watched.map(([id]) => this.#load(id)));
	}

	async #load(twitchId: string): Promise<void> {
		const entry = this.#entries.get(twitchId);
		if (!entry) return;
		if (entry.inFlight) return entry.inFlight;
		if (Date.now() - entry.fetchedAt < MIN_REFRESH_MS) return;

		entry.inFlight = this.#fetch(twitchId, entry).finally(() => {
			entry.inFlight = null;
		});
		return entry.inFlight;
	}

	async #fetch(twitchId: string, entry: Entry): Promise<void> {
		try {
			const res = await fetch(API_URL(twitchId), {
				headers: { accept: "application/json", "user-agent": USER_AGENT },
				signal: AbortSignal.timeout(15_000),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);

			entry.data = this.#parse(twitchId, (await res.json()) as RawPayload);
			entry.failures = 0;
			entry.fetchedAt = Date.now();
		} catch {
			// La dernière fiche connue reste affichée : un palier ne bouge pas vite.
			entry.failures += 1;
		}
		this.#notify();
	}

	#parse(twitchId: string, data: RawPayload): StreamerGoals {
		const donation = data.donationAmount?.number ?? 0;

		const goals = (data.donationGoal?.goals ?? [])
			.filter((raw): raw is RawGoal & { amountRequired: { number: number } } =>
				typeof raw.amountRequired?.number === "number",
			)
			.map((raw) => ({
				title: raw.title?.trim() || "Palier",
				amount: raw.amountRequired.number,
				amountText: normalizeSpaces(raw.amountRequired.formatted ?? `${raw.amountRequired.number} €`),
				reached: raw.amountRequired.number <= donation,
			}))
			.sort((a, b) => a.amount - b.amount);

		return {
			twitchId,
			donation,
			donationText: normalizeSpaces(data.donationAmount?.formatted ?? "0 €"),
			goals,
		};
	}

	#schedule(): void {
		if (this.#timer) return;
		this.#timer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
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
