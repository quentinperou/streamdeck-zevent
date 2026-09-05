/**
 * Fabrication des visuels de touche.
 *
 * Stream Deck accepte un SVG en data URI : c'est le seul moyen de composer une
 * image à la volée côté Node sans dépendance native. Le rendu reste volontairement
 * élémentaire (rect, image, text) car le moteur SVG de Stream Deck ne couvre pas
 * les fonctions avancées — pas de clipPath, pas de filtre, pas de foreignObject.
 */

const SIZE = 144;
/**
 * Marge latérale.
 *
 * Les montants sont dimensionnés pour occuper toute la largeur disponible :
 * chaque pixel de marge est donc un pixel de police en moins, et seuls les
 * nombres longs sont concernés — les autres plafonnent bien avant d'atteindre
 * la limite. Mesuré sur le rendu : 18 laisse 9 pixels d'encre au bord à la
 * taille réelle de la touche, contre 6 auparavant, pour trois points de police
 * sur un montant à six chiffres.
 */
const PADDING = 18;
const CONTENT_WIDTH = SIZE - PADDING * 2;

/**
 * Marge d'un paragraphe, plus serrée.
 *
 * Un montant est une ligne courte que l'air met en valeur ; un libellé de
 * palier est un bloc de texte qui remplit la touche, et chaque pixel repris sur
 * les côtés lui coûte une taille de police ou une ligne de plus. Les aérer
 * pareillement desservirait le second.
 */
const PARAGRAPH_PADDING = 10;
const PARAGRAPH_WIDTH = SIZE - PARAGRAPH_PADDING * 2;
const FONT = "Arial, Helvetica, sans-serif";

/**
 * Centre optique du montant, dans la bande laissée libre entre le pseudo et la
 * ligne des viewers. Sans cette dernière, la bande descend jusqu'au bandeau et
 * le centre suit.
 */
const AMOUNT_CENTER = 70;
const AMOUNT_CENTER_ALONE = 85;

/**
 * Palette relevée sur zevent.fr : vert #00BD00 en accent, noirs neutres en fond.
 * Le site réserve le blanc à ses grands compteurs et le vert aux montants de sa
 * liste de streamers — les touches reprennent cette répartition, et le vert y
 * signale aussi le direct, comme la pastille du site.
 */
const COLORS = {
	background: "#0B0B0B",
	/**
	 * Le vert de marque #00BD00 tient en aplat mais s'effondre en texte posé sur
	 * un avatar assombri. #66D766, autre valeur de la palette du site, conserve
	 * l'identité et redevient lisible à 72 pixels.
	 */
	amount: "#66D766",
	name: "#FFFFFF",
	nameOffline: "#8B8B8B",
	muted: "#C9C9C9",
	/** Le bandeau est un aplat : il garde le vert de marque. */
	live: "#00BD00",
	offline: "#242424",
	/** Rail de la barre de progression : lisible sur le fond sans le concurrencer. */
	track: "#2E2E2E",
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

/**
 * Hauteur de capitale d'Arial Bold, en fraction de la taille de police. Les
 * montants sont faits de chiffres et d'un « € », tous de pleine hauteur : c'est
 * elle, et non la hauteur de ligne, qui décrit ce que l'œil voit.
 */
const CAP_HEIGHT_RATIO = 0.716;

/**
 * Ligne de base qui centre optiquement un texte sur `center`.
 *
 * SVG positionne par la ligne de base, sous les glyphes : une valeur fixe
 * décentre dès que la taille de police change — et elle change, puisqu'elle
 * s'adapte à la longueur du montant.
 */
function centeredBaseline(center: number, size: number): number {
	return Math.round(center + (size * CAP_HEIGHT_RATIO) / 2);
}

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

/**
 * Fond : avatar assombri s'il est disponible, aplat sinon.
 *
 * L'opacité par défaut est calibrée pour qu'un montant vert reste lisible sur
 * n'importe quel avatar, y compris les portraits clairs ou très saturés. Un
 * texte dense en demande davantage.
 */
function background(avatar: string | null, overlay = 0.78): string {
	let body = `<rect width="${SIZE}" height="${SIZE}" fill="${COLORS.background}"/>`;
	if (avatar) {
		// `xlink:href` plutôt que `href` : l'image pèse à elle seule l'essentiel du
		// message envoyé à Stream Deck, on ne la duplique pas pour deux syntaxes.
		body +=
			`<image x="0" y="0" width="${SIZE}" height="${SIZE}" xlink:href="${avatar}"/>` +
			`<rect width="${SIZE}" height="${SIZE}" fill="#000000" opacity="${overlay}"/>`;
	}
	return body;
}

/**
 * Découpe en mots, en recollant la ponctuation orpheline.
 *
 * Le français fait précéder « ! » et « ? » d'une espace : « (promis juré !) »
 * se couperait sinon en « (promis juré » et « !) », laissant deux caractères
 * seuls sur une ligne.
 */
function splitWords(text: string): string[] {
	const words: string[] = [];

	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (words.length > 0 && /^[!?:;»)\]]+$/.test(word)) {
			words[words.length - 1] += ` ${word}`;
		} else {
			words.push(word);
		}
	}
	return words;
}

/** Découpe un texte en lignes qui tiennent dans `maxWidth` à cette taille. */
function wrapText(text: string, maxWidth: number, size: number): string[] {
	const limit = (maxWidth * 1000) / size;
	const lines: string[] = [];
	let current = "";

	for (const word of splitWords(text)) {
		const candidate = current ? `${current} ${word}` : word;
		if (glyphUnits(candidate) > limit && current) {
			lines.push(current);
			current = word;
		} else {
			current = candidate;
		}
	}
	if (current) lines.push(current);
	return lines;
}

/**
 * Tailles essayées pour un paragraphe, de la plus confortable à la plus dense.
 * On commence haut : la plupart des libellés tiennent largement, et rien
 * n'oblige à les afficher petit sous prétexte que d'autres sont longs.
 */
const PARAGRAPH_SIZES = [22, 20, 18, 17, 16, 15, 14, 13, 12, 11, 10];

/** Interligne confortable pour du texte dense. */
function lineHeightFor(size: number): number {
	return Math.round(size * 1.25);
}

/**
 * Plus grande taille à laquelle le texte tient dans la hauteur donnée. Les
 * titres de paliers sont des phrases entières, parfois longues : on réduit la
 * police et on multiplie les lignes d'abord, la troncature n'est qu'un dernier
 * recours. Raisonner en hauteur plutôt qu'en nombre de lignes est nécessaire —
 * six lignes tiennent à 10 pixels, pas à 16.
 */
function fitParagraph(
	text: string,
	maxWidth: number,
	maxHeight: number,
): { size: number; lines: string[]; lineHeight: number } {
	for (const size of PARAGRAPH_SIZES) {
		const lines = wrapText(text, maxWidth, size);
		const lineHeight = lineHeightFor(size);
		if (lines.length * lineHeight <= maxHeight) return { size, lines, lineHeight };
	}

	// Même au plus petit, ça déborde : on coupe et on le signale.
	const size = PARAGRAPH_SIZES[PARAGRAPH_SIZES.length - 1]!;
	const lineHeight = lineHeightFor(size);
	const lines = wrapText(text, maxWidth, size).slice(0, Math.floor(maxHeight / lineHeight));
	lines[lines.length - 1] = `${lines[lines.length - 1]!.trimEnd()}…`;
	return { size, lines, lineHeight };
}

/** Bandeau bas : vert en direct, gris sinon — l'état se lit sans lire le texte. */
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
		y: centeredBaseline(viewers ? AMOUNT_CENTER : AMOUNT_CENTER_ALONE, amountSize),
		size: amountSize,
		fill: COLORS.amount,
	});
	if (viewers) {
		const size = fitFontSize(viewers, CONTENT_WIDTH, 15, 10);
		body += text(truncate(viewers, CONTENT_WIDTH, size), {
			y: 121,
			size,
			fill: COLORS.muted,
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
	});
	body += text(amount, {
		y: centeredBaseline(viewers ? AMOUNT_CENTER : AMOUNT_CENTER_ALONE, amountSize),
		size: amountSize,
		fill: COLORS.name,
	});
	if (viewers) {
		const size = fitFontSize(viewers, CONTENT_WIDTH, 15, 10);
		body += text(truncate(viewers, CONTENT_WIDTH, size), {
			y: 121,
			size,
			fill: COLORS.muted,
		});
	}
	body += statusBar(COLORS.live);
	if (stale) body += staleDot();

	return toDataUri(body);
}

/** Alignée sur la marge du texte : une jauge plus large que les mots au-dessus se verrait. */
const BAR = { x: PADDING, y: 84, width: CONTENT_WIDTH, height: 12, radius: 3 };

/**
 * Barre de progression. Deux rectangles, pas de dégradé ni de masque : c'est
 * tout ce que le moteur de Stream Deck rend de façon fiable.
 */
function progressBar(fraction: number): string {
	const clamped = Math.max(0, Math.min(1, fraction));
	const filled = Math.round(BAR.width * clamped);

	let out =
		`<rect x="${BAR.x}" y="${BAR.y}" width="${BAR.width}" height="${BAR.height}" ` +
		`rx="${BAR.radius}" fill="${COLORS.track}"/>`;
	if (filled > 0) {
		out +=
			`<rect x="${BAR.x}" y="${BAR.y}" width="${filled}" height="${BAR.height}" ` +
			`rx="${BAR.radius}" fill="${COLORS.amount}"/>`;
	}
	return out;
}

export type GoalKeyOptions = {
	name: string;
	/** Avancement vers le palier, de 0 à 1. */
	fraction: number;
	/** Ce qui est écrit en grand : un pourcentage, ou l'état si tout est atteint. */
	headline: string;
	/** Ligne du bas : le montant du palier visé. */
	target: string | null;
	online: boolean;
	avatar: string | null;
	stale: boolean;
};

export function renderGoalKey(options: GoalKeyOptions): string {
	const { name, fraction, headline, target, online, avatar, stale } = options;

	const nameSize = fitFontSize(name, CONTENT_WIDTH, 15, 10);
	const headlineSize = fitFontSize(headline, CONTENT_WIDTH, 34, 13);

	let body = background(avatar);
	body += text(truncate(name, CONTENT_WIDTH, nameSize), {
		y: 24,
		size: nameSize,
		fill: online ? COLORS.name : COLORS.nameOffline,
	});
	body += text(headline, {
		y: centeredBaseline(56, headlineSize),
		size: headlineSize,
		fill: COLORS.amount,
	});
	body += progressBar(fraction);
	if (target) {
		const size = fitFontSize(target, CONTENT_WIDTH, 14, 10);
		body += text(truncate(target, CONTENT_WIDTH, size), {
			y: 121,
			size,
			fill: COLORS.muted,
		});
	}
	body += statusBar(online ? COLORS.live : COLORS.offline);
	if (stale) body += staleDot();

	return toDataUri(body);
}

export type GoalTitleKeyOptions = {
	title: string;
	amount: string;
	online: boolean;
	avatar: string | null;
};

/**
 * Le libellé d'un palier, en entier, le temps d'un appui.
 *
 * Ces titres sont des phrases — « Je vous offre une maison (promis juré !) » —
 * qu'aucune touche ne peut afficher en permanence. Les montrer à la demande
 * évite d'avoir à ouvrir le Property Inspector pour savoir ce qu'on vise.
 */
export function renderGoalTitleKey(options: GoalTitleKeyOptions): string {
	const { title, amount, online, avatar } = options;

	// Marges resserrées : chaque pixel rendu au texte permet une police plus
	// grande, et le libellé n'est à l'écran que cinq secondes.
	const TOP = 8;
	const BOTTOM = 112;
	const { size, lines, lineHeight } = fitParagraph(title, PARAGRAPH_WIDTH, BOTTOM - TOP);

	// Fond plus sombre qu'à l'accoutumée : un paragraphe demande plus de calme
	// qu'un montant de trois chiffres.
	let body = background(avatar, 0.88);

	const block = lines.length * lineHeight;
	const start = TOP + (BOTTOM - TOP - block) / 2 + size;

	lines.forEach((line, index) => {
		body += text(line, {
			y: Math.round(start + index * lineHeight),
			size,
			fill: COLORS.name,
			weight: "normal",
		});
	});

	const amountSize = fitFontSize(amount, CONTENT_WIDTH, 17, 11);
	body += text(amount, { y: 128, size: amountSize, fill: COLORS.amount });
	body += statusBar(online ? COLORS.live : COLORS.offline);

	return toDataUri(body);
}

/** Touche d'attente ou d'erreur : un message court, centré, sur trois lignes au plus. */
export function renderMessageKey(message: string, tone: "neutral" | "warning" = "neutral"): string {
	const size = 16;
	const limit = (PARAGRAPH_WIDTH * 1000) / size;

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
