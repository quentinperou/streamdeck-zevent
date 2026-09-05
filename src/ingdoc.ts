/**
 * Source alternative pour les paliers : InGDoc (api.evenmorestats.fr).
 *
 * L'API officielle du ZEvent n'expose les paliers qu'une fiche à la fois, et
 * en oublie une partie — sur un échantillon de 60 streamers, 8 % sont annoncés
 * sans aucun palier alors qu'ils en ont une quinzaine. InGDoc les a, et offre
 * en prime un décompte groupé : un seul appel donne le nombre de paliers des
 * 338 participants, ce qu'aucune route officielle ne permet.
 *
 * En contrepartie c'est un service communautaire, sans en-tête de cache ni
 * limite de débit annoncée : on l'interroge avec la même retenue que le ZEvent,
 * et le repli sur l'officiel reste toujours possible.
 */

const BASE = "https://api.evenmorestats.fr";
/** Cache S3 des métriques : le seul endroit où vit l’historique. */
const METRICS = "https://evenmorestats-cache.s3.gra.io.cloud.ovh.net";
const USER_AGENT = "streamdeck-zevent/1.0 (+https://github.com/quentinperou)";

/** L'édition en cours ne change pas d'un jour à l'autre. */
const EVENT_TTL_MS = 3_600_000;
/** Le décompte groupé pèse 244 ko : on ne le recharge pas à la légère. */
const OVERVIEW_TTL_MS = 300_000;
/** Les paliers d'un streamer, même cadence que le reste du plugin. */
const GOALS_TTL_MS = 60_000;
/** L'historique n'avance que toutes les dix minutes : inutile de le relire plus vite. */
const HISTORY_TTL_MS = 300_000;

const TIMEOUT_MS = 15_000;

export type IngdocGoal = {
	title: string;
	/** En euros : l'API compte en centimes. */
	amount: number;
	category: string;
	reached: boolean;
	accomplished: boolean;
};

export type IngdocEntry = {
	participationId: string;
	/** Distinct de la participation : c’est lui qui indexe les métriques. */
	streamerId: string;
	twitchId: string;
	login: string;
	display: string;
	/** Nombre de paliers, toutes catégories confondues. */
	goalCount: number;
	/** En euros. */
	amountRaised: number;
};

type RawEvent = {
	id?: string;
	name?: string;
	schedule?: { start?: string; end?: string };
};

type RawOverview = {
	id?: string;
	name?: string;
	amount_raised?: number;
	donation_goals_count?: number;
	socials?: { twitch?: { id?: string; login?: string } };
	streamers?: { id?: string }[];
};

type RawMetrics = {
	graph?: { donations?: { labels?: number[]; values?: number[] } };
};

type RawGoal = {
	name?: string;
	amount?: number;
	category?: string;
	reached?: boolean;
	accomplished?: boolean;
};

type Cached<T> = { value: T; at: number };

async function getJson<T>(path: string): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		headers: { accept: "application/json", "user-agent": USER_AGENT },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return (await res.json()) as T;
}

/** Les montants d'InGDoc sont en centimes. */
function toEuros(cents: number | undefined): number {
	return Math.round(((cents ?? 0) / 100) * 100) / 100;
}

class IngdocSource {
	#event: Cached<string> | null = null;
	#overview: Cached<Map<string, IngdocEntry>> | null = null;
	#goals = new Map<string, Cached<IngdocGoal[]>>();
	#history = new Map<string, Cached<number[]>>();
	#inFlight = new Map<string, Promise<unknown>>();

	/** Déduplique les appels concurrents vers la même ressource. */
	async #once<T>(key: string, work: () => Promise<T>): Promise<T> {
		const running = this.#inFlight.get(key) as Promise<T> | undefined;
		if (running) return running;

		const task = work().finally(() => this.#inFlight.delete(key));
		this.#inFlight.set(key, task);
		return task;
	}

	/**
	 * L'édition en cours, déduite des dates plutôt que codée en dur : le
	 * plugin suivra les éditions suivantes sans qu'on y touche.
	 */
	async eventId(): Promise<string> {
		if (this.#event && Date.now() - this.#event.at < EVENT_TTL_MS) return this.#event.value;

		return this.#once("event", async () => {
			const events = await getJson<RawEvent[]>("/events");
			const zevents = events.filter((e) => e.id && /^z\s?event/i.test(e.name ?? ""));
			if (zevents.length === 0) throw new Error("aucune édition du ZEvent");

			const now = Date.now();
			const start = (e: RawEvent) => Date.parse(e.schedule?.start ?? "") || 0;
			const end = (e: RawEvent) => Date.parse(e.schedule?.end ?? "") || 0;

			// En pleine édition on la prend ; sinon la plus récente déjà commencée,
			// et à défaut la prochaine annoncée.
			const chosen =
				zevents.find((e) => start(e) <= now && now <= end(e)) ??
				zevents.filter((e) => start(e) <= now).sort((a, b) => start(b) - start(a))[0] ??
				zevents.sort((a, b) => start(a) - start(b))[0];

			const id = chosen?.id;
			if (!id) throw new Error("édition sans identifiant");

			this.#event = { value: id, at: Date.now() };
			return id;
		});
	}

	/**
	 * Décompte groupé, indexé par identifiant Twitch. Un seul appel couvre les
	 * 338 participants — c'est ce qui rend l'annotation du menu déroulant
	 * possible, là où l'API officielle exigerait 338 requêtes.
	 */
	async overview(): Promise<Map<string, IngdocEntry>> {
		if (this.#overview && Date.now() - this.#overview.at < OVERVIEW_TTL_MS) {
			return this.#overview.value;
		}

		return this.#once("overview", async () => {
			const id = await this.eventId();
			const raw = await getJson<RawOverview[]>(`/events/${id}/donation_goals/overview`);

			const map = new Map<string, IngdocEntry>();
			for (const entry of raw) {
				const twitchId = entry.socials?.twitch?.id;
				if (!twitchId || !entry.id) continue;

				map.set(twitchId, {
					participationId: entry.id,
					streamerId: entry.streamers?.[0]?.id ?? "",
					twitchId,
					login: entry.socials?.twitch?.login ?? "",
					display: entry.name ?? "",
					goalCount: entry.donation_goals_count ?? 0,
					amountRaised: toEuros(entry.amount_raised),
				});
			}

			this.#overview = { value: map, at: Date.now() };
			return map;
		});
	}

	/**
	 * Historique des dons d'un streamer, du début de l'édition à maintenant.
	 *
	 * Ni le ZEvent ni l'API d'InGDoc ne l'exposent : il vit dans le cache S3
	 * qu'alimente leur page de statistiques, un point toutes les dix minutes.
	 * C'est la seule source d'historique connue — sans elle, il faudrait que le
	 * plugin enregistre lui-même, et repartir de zéro à chaque redémarrage.
	 */
	async history(twitchId: string): Promise<number[] | null> {
		const entry = (await this.overview()).get(twitchId);
		const streamerId = entry?.streamerId;
		if (!streamerId) return null;

		const cached = this.#history.get(streamerId);
		if (cached && Date.now() - cached.at < HISTORY_TTL_MS) return cached.value;

		return this.#once(`history:${streamerId}`, async () => {
			const id = await this.eventId();
			const res = await fetch(
				`${METRICS}/metrics/${encodeURIComponent(id)}/streamers/${encodeURIComponent(streamerId)}.json`,
				{ headers: { accept: "application/json", "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) },
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);

			const raw = (await res.json()) as RawMetrics;
			const serie = raw.graph?.donations;
			const labels = serie?.labels ?? [];
			const values = serie?.values ?? [];

			// Les deux séries de ce fichier ne sont pas dans le même ordre : celle
			// des viewers arrive à l'envers. On trie plutôt que de faire confiance.
			const points = labels
				.map((at, index) => ({ at, value: values[index] }))
				.filter((p): p is { at: number; value: number } => typeof p.value === "number")
				.sort((a, b) => a.at - b.at)
				.map((p) => p.value);

			this.#history.set(streamerId, { value: points, at: Date.now() });
			return points;
		});
	}

	/** Paliers d'un streamer, désigné par son identifiant Twitch. */
	async goals(twitchId: string): Promise<{ entry: IngdocEntry; goals: IngdocGoal[] } | null> {
		const entry = (await this.overview()).get(twitchId);
		if (!entry) return null;

		const cached = this.#goals.get(entry.participationId);
		if (cached && Date.now() - cached.at < GOALS_TTL_MS) {
			return { entry, goals: cached.value };
		}

		const goals = await this.#once(`goals:${entry.participationId}`, async () => {
			const raw = await getJson<RawGoal[]>(
				`/participations/${encodeURIComponent(entry.participationId)}/donation_goals`,
			);

			const parsed = raw
				.filter((g) => typeof g.amount === "number")
				.map((g) => ({
					title: g.name?.trim() || "Palier",
					amount: toEuros(g.amount),
					category: g.category ?? "donation",
					reached: Boolean(g.reached),
					accomplished: Boolean(g.accomplished),
				}))
				.sort((a, b) => a.amount - b.amount);

			this.#goals.set(entry.participationId, { value: parsed, at: Date.now() });
			return parsed;
		});

		return { entry, goals };
	}
}

export const ingdoc = new IngdocSource();
