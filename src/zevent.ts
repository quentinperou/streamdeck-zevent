/**
 * Accès unique à l'API publique du ZEvent (https://zevent.fr/api/).
 *
 * Une seule requête sortante alimente toutes les touches, quel qu'en soit le
 * nombre : la charge imposée au ZEvent ne dépend pas du profil de l'utilisateur.
 * L'API n'émet aucun en-tête CORS, ce qui interdit un plugin HTML — d'où ce
 * plugin Node, qui parle directement à l'API sans passer par un navigateur.
 */

import { spikes } from "./spike";

const API_URL = "https://zevent.fr/api/";
const USER_AGENT = "streamdeck-zevent/1.0 (+https://github.com/quentinperou)";

/**
 * Cadence nominale, tant qu'au moins une touche est visible.
 *
 * La réponse du ZEvent pèse 157 ko — la liste complète des participants, dont
 * une touche n'utilise qu'une ligne. C'est ce poids, et non la charge serveur,
 * qui fixe la cadence : le ZEvent sert cette route depuis le cache Cloudflare,
 * nos appels n'atteignent jamais son origine. Une minute ramène le trafic à
 * ~9 Mo par heure et par utilisateur, contre ~28 Mo toutes les 20 secondes,
 * pour une information d'ambiance dont personne ne verra le retard.
 */
const POLL_INTERVAL_MS = 60_000;
/**
 * Garde-fou : jamais deux appels sortants rapprochés, demande manuelle comprise.
 * Calé sur le `max-age=15` que le ZEvent déclare lui-même — en deçà, on
 * retéléchargerait mot pour mot la réponse déjà servie par le cache.
 */
const MIN_REFRESH_MS = 15_000;
/** Plafond du recul exponentiel quand le ZEvent ne répond plus. */
const MAX_BACKOFF_MS = 300_000;
/**
 * Au-delà, la donnée affichée est signalée comme périmée. Trois minutes, soit
 * deux cycles manqués : un incident passager ne doit pas allumer le témoin.
 */
const STALE_AFTER_MS = 180_000;

/** Un avatar qui n'a pas pu être chargé n'est pas réessayé avant ce délai. */
const AVATAR_RETRY_MS = 300_000;
const AVATAR_MAX_BYTES = 512_000;

export type Streamer = {
	twitchId: string;
	login: string;
	display: string;
	avatarUrl: string | null;
	online: boolean;
	game: string;
	viewers: number;
	donation: number;
	donationText: string;
	donationUrl: string;
};

export type Totals = {
	donation: number;
	donationText: string;
	viewers: number;
	viewersText: string;
};

type RawStreamer = {
	twitch_id?: string;
	twitch?: string;
	display?: string;
	profileUrl?: string;
	online?: boolean;
	game?: string;
	donationUrl?: string;
	viewersAmount?: { number?: number; formatted?: string };
	donationAmount?: { number?: number; formatted?: string };
};

type RawPayload = {
	live?: RawStreamer[];
	donationAmount?: { number?: number; formatted?: string };
	viewersCount?: { number?: number; formatted?: string };
	globalDonationUrl?: string;
};

type AvatarEntry = { dataUri: string | null; at: number };

/**
 * Le ZEvent sépare ses milliers par des espaces fines insécables ; les moteurs
 * de rendu SVG les gèrent mal, on repasse sur des espaces ordinaires.
 */
export function normalizeSpaces(text: string): string {
	return text.replace(/[    ]/g, " ");
}

class ZeventStore {
	#byLogin = new Map<string, Streamer>();
	#order: string[] = [];
	#totals: Totals | null = null;
	#globalDonationUrl = "https://zevent.fr/don";
	#fetchedAt = 0;
	#error: string | null = null;
	#failures = 0;

	#timer: NodeJS.Timeout | null = null;
	#inFlight: Promise<void> | null = null;
	#watchers = 0;

	#listeners = new Set<() => void>();
	#avatars = new Map<string, AvatarEntry>();
	#avatarsInFlight = new Map<string, Promise<string | null>>();

	/** Streamers, cagnotte décroissante. */
	get streamers(): Streamer[] {
		return this.#order.map((login) => this.#byLogin.get(login)!).filter(Boolean);
	}

	get totals(): Totals | null {
		return this.#totals;
	}

	get globalDonationUrl(): string {
		return this.#globalDonationUrl;
	}

	get hasData(): boolean {
		return this.#fetchedAt > 0;
	}

	get isStale(): boolean {
		return this.#fetchedAt > 0 && Date.now() - this.#fetchedAt > STALE_AFTER_MS;
	}

	get error(): string | null {
		return this.#error;
	}

	find(login: string | undefined | null): Streamer | null {
		if (!login) return null;
		return this.#byLogin.get(login.toLowerCase()) ?? null;
	}

	/** Prévient à chaque changement d'état, succès comme échec. */
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Une touche devient visible : elle a besoin de données fraîches. */
	retain(): void {
		this.#watchers += 1;
		if (this.#watchers === 1) {
			void this.refresh().catch(() => {});
			this.#schedule();
		}
	}

	/** Plus aucune touche visible : on cesse d'interroger le ZEvent. */
	release(): void {
		this.#watchers = Math.max(0, this.#watchers - 1);
		if (this.#watchers === 0 && this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
	}

	/**
	 * Le garde-fou s'applique à tout le monde, y compris au bouton « Rafraîchir »
	 * du Property Inspector : sans quoi un clic répété relancerait un
	 * téléchargement de 157 ko toutes les trois secondes. L'appel programmé, lui,
	 * arrive toujours bien après le délai minimal et n'est jamais bloqué.
	 */
	async refresh(): Promise<void> {
		if (this.#inFlight) return this.#inFlight;
		if (Date.now() - this.#fetchedAt < MIN_REFRESH_MS) return;

		this.#inFlight = this.#load().finally(() => {
			this.#inFlight = null;
		});
		return this.#inFlight;
	}

	async #load(): Promise<void> {
		try {
			const res = await fetch(API_URL, {
				headers: { accept: "application/json", "user-agent": USER_AGENT },
				signal: AbortSignal.timeout(15_000),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);

			this.#apply((await res.json()) as RawPayload);
			this.#error = null;
			this.#failures = 0;
			this.#fetchedAt = Date.now();
		} catch (error) {
			// Une donnée périmée reste plus utile qu'une touche vide : on garde le
			// dernier état connu et on signale seulement qu'il vieillit.
			this.#failures += 1;
			this.#error = error instanceof Error ? error.message : String(error);
		}
		this.#notify();
	}

	#apply(data: RawPayload): void {
		const list = (data.live ?? []).filter(
			(raw): raw is RawStreamer & { twitch: string } => Boolean(raw.twitch),
		);

		this.#byLogin.clear();
		for (const raw of list) {
			const login = raw.twitch.toLowerCase();
			this.#byLogin.set(login, {
				twitchId: raw.twitch_id ?? "",
				login,
				display: raw.display || raw.twitch,
				avatarUrl: raw.profileUrl ?? null,
				online: Boolean(raw.online),
				game: raw.game ?? "",
				viewers: raw.viewersAmount?.number ?? 0,
				donation: raw.donationAmount?.number ?? 0,
				donationText: normalizeSpaces(raw.donationAmount?.formatted ?? "0 €"),
				donationUrl: raw.donationUrl || `https://zevent.fr/don/${login}`,
			});
		}

		this.#order = [...this.#byLogin.values()]
			.sort((a, b) => b.donation - a.donation || a.display.localeCompare(b.display, "fr"))
			.map((streamer) => streamer.login);

		this.#totals = {
			donation: data.donationAmount?.number ?? 0,
			donationText: normalizeSpaces(data.donationAmount?.formatted ?? "—"),
			viewers: data.viewersCount?.number ?? 0,
			viewersText: normalizeSpaces(data.viewersCount?.formatted ?? "—"),
		};
		if (data.globalDonationUrl) this.#globalDonationUrl = data.globalDonationUrl;

		// Les variations se lisent ici, au moment où le relevé arrive : c'est le
		// seul endroit qui voit l'état précédent et le suivant.
		spikes.observe(this.streamers, this.#totals.donation);
	}

	#schedule(): void {
		if (this.#timer) clearTimeout(this.#timer);
		if (this.#watchers === 0) {
			this.#timer = null;
			return;
		}

		const delay =
			this.#failures === 0
				? POLL_INTERVAL_MS
				: Math.min(MAX_BACKOFF_MS, POLL_INTERVAL_MS * 2 ** this.#failures);

		this.#timer = setTimeout(() => {
			void this.refresh()
				.finally(() => this.#schedule())
				.catch(() => {
					/* #load absorbe déjà les échecs ; ceci couvre le reste. */
				});
		}, delay);
		this.#timer.unref?.();
	}

	#notify(): void {
		for (const listener of this.#listeners) {
			try {
				listener();
			} catch {
				// Un abonné qui échoue ne doit pas priver les autres de la mise à jour.
			}
		}
	}

	/**
	 * Avatar du streamer, en data URI prêt à être inséré dans le SVG de la touche.
	 * Twitch sert la même image en plusieurs tailles : on prend la 70×70, seule
	 * utile sur une touche, et quatre fois plus légère que l'originale.
	 */
	async avatar(login: string): Promise<string | null> {
		const key = login.toLowerCase();

		const cached = this.#avatars.get(key);
		if (cached && (cached.dataUri !== null || Date.now() - cached.at < AVATAR_RETRY_MS)) {
			return cached.dataUri;
		}

		const pending = this.#avatarsInFlight.get(key);
		if (pending) return pending;

		const url = this.#byLogin.get(key)?.avatarUrl;
		if (!url) return null;

		const task = this.#loadAvatar(url)
			.catch(() => null)
			.then((dataUri) => {
				this.#avatars.set(key, { dataUri, at: Date.now() });
				this.#avatarsInFlight.delete(key);
				return dataUri;
			});

		this.#avatarsInFlight.set(key, task);
		return task;
	}

	async #loadAvatar(url: string): Promise<string | null> {
		const small = url.replace(/-(?:150x150|300x300|600x600)\.(png|jpe?g)$/i, "-70x70.$1");

		const res = await fetch(small, {
			headers: { "user-agent": USER_AGENT },
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const buffer = Buffer.from(await res.arrayBuffer());
		if (buffer.byteLength === 0 || buffer.byteLength > AVATAR_MAX_BYTES) return null;

		const type = res.headers.get("content-type")?.split(";")[0]?.trim();
		const mime = type?.startsWith("image/") ? type : "image/png";
		return `data:${mime};base64,${buffer.toString("base64")}`;
	}
}

export const zevent = new ZeventStore();
