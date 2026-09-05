/**
 * Fabrication des visuels de touche.
 *
 * Stream Deck accepte un SVG en data URI : c'est le seul moyen de composer une
 * image à la volée côté Node sans dépendance native. Le rendu reste volontairement
 * élémentaire (rect, image, text) car le moteur SVG de Stream Deck ne couvre pas
 * les fonctions avancées — pas de clipPath, pas de filtre, pas de foreignObject.
 */

const SIZE = 144;
const PADDING = 6;
const CONTENT_WIDTH = SIZE - PADDING * 2;
const FONT = "Arial, Helvetica, sans-serif";

const COLORS = {
	background: "#12121A",
	amount: "#FFD447",
	name: "#FFFFFF",
	nameOffline: "#8D93A3",
	muted: "#A6ACBB",
	live: "#E4003C",
	offline: "#2A2A35",
	stale: "#F0A020",
};

/**
 * Largeurs d'Arial Bold, en millièmes de cadratin. Stream Deck ne renvoie
 * jamais les dimensions rendues : sans cette table, impossible de savoir si un
 * pseudo tient sur la touche, et les noms longs déborderaient silencieusement.
 */
const GLYPH_WIDTHS: Record<string, number> = {
	" ": 278, "!": 333, '"': 474, "#": 556, $: 556, "%": 889, "&": 722, "'": 238,
	"(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
	"0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
	"8": 556, "9": 556, ":": 333, ";": 333, "<": 584, "=": 584, ">": 584, "?": 611,
	"@": 975, A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
	I: 278, J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778,
	R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
	"[": 333, "\\": 278, "]": 333, "^": 584, _: 556, "`": 333,
	a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278,
	j: 278, k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389,
	s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
	"{": 389, "|": 280, "}": 389, "~": 584, "€": 556, "…": 1000, "·": 333,
};
const DEFAULT_GLYPH_WIDTH = 600;

function glyphUnits(text: string): number {
	let total = 0;
	for (const char of text) total += GLYPH_WIDTHS[char] ?? DEFAULT_GLYPH_WIDTH;
	return total;
}

/** Plus grande taille de police à laquelle le texte tient dans `maxWidth`. */
function fitFontSize(text: string, maxWidth: number, max: number, min: number): number {
	const units = glyphUnits(text);
	if (units === 0) return max;
	return Math.max(min, Math.min(max, Math.floor((maxWidth * 1000) / units)));
}

/** Tronque au caractère près, en gardant les points de suspension lisibles. */
function truncate(text: string, maxWidth: number, fontSize: number): string {
	const limit = (maxWidth * 1000) / fontSize;
	if (glyphUnits(text) <= limit) return text;

	const ellipsis = GLYPH_WIDTHS["…"]!;
	let units = 0;
	let out = "";
	for (const char of text) {
		const width = GLYPH_WIDTHS[char] ?? DEFAULT_GLYPH_WIDTH;
		if (units + width + ellipsis > limit) break;
		units += width;
		out += char;
	}
	return `${out.trimEnd()}…`;
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

type TextOptions = {
	y: number;
	size: number;
	fill: string;
	weight?: "bold" | "normal";
	opacity?: number;
};

function text(content: string, { y, size, fill, weight = "bold", opacity }: TextOptions): string {
	const alpha = opacity === undefined ? "" : ` opacity="${opacity}"`;
	return (
		`<text x="${SIZE / 2}" y="${y}" font-family="${FONT}" font-size="${size}" ` +
		`font-weight="${weight}" fill="${fill}" text-anchor="middle"${alpha}>${escapeXml(content)}</text>`
	);
}

function toDataUri(body: string): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
		`width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** Fond : avatar assombri s'il est disponible, aplat sinon. */
function background(avatar: string | null): string {
	let body = `<rect width="${SIZE}" height="${SIZE}" fill="${COLORS.background}"/>`;
	if (avatar) {
		// `xlink:href` plutôt que `href` : l'image pèse à elle seule l'essentiel du
		// message envoyé à Stream Deck, on ne la duplique pas pour deux syntaxes.
		body +=
			`<image x="0" y="0" width="${SIZE}" height="${SIZE}" xlink:href="${avatar}"/>` +
			`<rect width="${SIZE}" height="${SIZE}" fill="#000000" opacity="0.72"/>`;
	}
	return body;
}

/** Bandeau bas : rouge en direct, gris sinon — l'état se lit sans lire le texte. */
function statusBar(color: string): string {
	return `<rect x="0" y="${SIZE - 5}" width="${SIZE}" height="5" fill="${color}"/>`;
}

/** Pastille ambre discrète : la donnée affichée n'est plus à jour. */
function staleDot(): string {
	return `<circle cx="${SIZE - 12}" cy="12" r="4" fill="${COLORS.stale}"/>`;
}

export type StreamerKeyOptions = {
	name: string;
	amount: string;
	viewers: string | null;
	online: boolean;
	avatar: string | null;
	stale: boolean;
};

export function renderStreamerKey(options: StreamerKeyOptions): string {
	const { name, amount, viewers, online, avatar, stale } = options;

	const nameSize = fitFontSize(name, CONTENT_WIDTH, 17, 11);
	const amountSize = fitFontSize(amount, CONTENT_WIDTH, 36, 14);

	let body = background(avatar);
	body += text(truncate(name, CONTENT_WIDTH, nameSize), {
		y: viewers ? 27 : 33,
		size: nameSize,
		fill: online ? COLORS.name : COLORS.nameOffline,
	});
	body += text(amount, {
		y: viewers ? 89 : 99,
		size: amountSize,
		fill: COLORS.amount,
	});
	if (viewers) {
		const size = fitFontSize(viewers, CONTENT_WIDTH, 15, 10);
		body += text(truncate(viewers, CONTENT_WIDTH, size), {
			y: 121,
			size,
			fill: COLORS.muted,
			weight: "normal",
		});
	}
	body += statusBar(online ? COLORS.live : COLORS.offline);
	if (stale) body += staleDot();

	return toDataUri(body);
}

export type TotalKeyOptions = {
	label: string;
	amount: string;
	viewers: string | null;
	stale: boolean;
};

export function renderTotalKey(options: TotalKeyOptions): string {
	const { label, amount, viewers, stale } = options;

	const labelSize = fitFontSize(label, CONTENT_WIDTH, 16, 10);
	const amountSize = fitFontSize(amount, CONTENT_WIDTH, 32, 12);

	let body = background(null);
	body += text(truncate(label, CONTENT_WIDTH, labelSize), {
		y: viewers ? 29 : 35,
		size: labelSize,
		fill: COLORS.amount,
		opacity: 0.85,
	});
	body += text(amount, {
		y: viewers ? 89 : 99,
		size: amountSize,
		fill: COLORS.name,
	});
	if (viewers) {
		const size = fitFontSize(viewers, CONTENT_WIDTH, 15, 10);
		body += text(truncate(viewers, CONTENT_WIDTH, size), {
			y: 121,
			size,
			fill: COLORS.muted,
			weight: "normal",
		});
	}
	body += statusBar(COLORS.live);
	if (stale) body += staleDot();

	return toDataUri(body);
}

/** Touche d'attente ou d'erreur : un message court, centré, sur trois lignes au plus. */
export function renderMessageKey(message: string, tone: "neutral" | "warning" = "neutral"): string {
	const size = 16;
	const limit = (CONTENT_WIDTH * 1000) / size;

	const lines: string[] = [];
	let current = "";
	for (const word of message.split(" ")) {
		const candidate = current ? `${current} ${word}` : word;
		if (glyphUnits(candidate) > limit && current) {
			lines.push(current);
			current = word;
		} else {
			current = candidate;
		}
	}
	if (current) lines.push(current);
	while (lines.length > 3) lines.pop();

	const fill = tone === "warning" ? COLORS.stale : COLORS.muted;
	const start = SIZE / 2 - ((lines.length - 1) * 20) / 2 + 6;

	let body = background(null);
	lines.forEach((line, index) => {
		body += text(truncate(line, CONTENT_WIDTH, size), {
			y: start + index * 20,
			size,
			fill,
		});
	});
	body += statusBar(COLORS.offline);

	return toDataUri(body);
}
