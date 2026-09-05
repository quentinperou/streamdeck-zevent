/**
 * Génère les PNG du plugin à partir de tracés SVG.
 *
 * Stream Deck exige des PNG (avec variante @2x) à des tailles précises. Les
 * dessiner ici, en chemins purs, évite d'embarquer des binaires dans le dépôt
 * et garantit un rendu net à chaque taille — aucune police n'est nécessaire.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IMGS = join(ROOT, "fr.quentinperou.zevent.sdPlugin", "imgs");

const DARK = "#12121A";
const GOLD = "#FFD447";

/** Le Z du ZEvent, tracé dans une boîte de 100×100. */
const Z_PATH = "M18 20 H82 V34 L44 66 H82 V80 H18 V66 L56 34 H18 Z";
/** Un cœur : la cagnotte, pas la marque. */
const HEART_PATH = "M50 84 C18 61 10 44 21 31 C31 20 46 23 50 35 C54 23 69 20 79 31 C90 44 82 61 50 84 Z";

function svg(body) {
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${body}</svg>`,
		"utf8",
	);
}

/** Icône de liste ou de catégorie : silhouette blanche sur fond transparent. */
function glyph(path) {
	return svg(`<path d="${path}" fill="#FFFFFF"/>`);
}

/** Vignette carrée : le tracé doré sur le fond sombre des touches. */
function tile(path) {
	return svg(
		`<rect width="100" height="100" rx="16" fill="${DARK}"/><path d="${path}" fill="${GOLD}"/>`,
	);
}

const TARGETS = [
	{ file: "plugin-icon", size: 72, source: tile(Z_PATH) },
	{ file: "category-icon", size: 28, source: glyph(Z_PATH) },
	{ file: "actions/streamer/action-icon", size: 20, source: glyph(Z_PATH) },
	{ file: "actions/streamer/key", size: 72, source: tile(Z_PATH) },
	{ file: "actions/total/action-icon", size: 20, source: glyph(HEART_PATH) },
	{ file: "actions/total/key", size: 72, source: tile(HEART_PATH) },
];

for (const { file, size, source } of TARGETS) {
	const target = join(IMGS, file);
	await mkdir(dirname(target), { recursive: true });

	for (const [suffix, scale] of [["", 1], ["@2x", 2]]) {
		const pixels = size * scale;
		await sharp(source, { density: 384 })
			.resize(pixels, pixels, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
			.png()
			.toFile(`${target}${suffix}.png`);
		console.log(`${file}${suffix}.png  ${pixels}×${pixels}`);
	}
}
