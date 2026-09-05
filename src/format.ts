/**
 * Mise en forme des nombres affichés sur les touches.
 *
 * Une touche fait 72 pixels : au-delà de six ou sept chiffres, le montant
 * rétrécit jusqu'à devenir pénible à lire d'un coup d'œil. L'abrègement rend
 * cette place, au prix de la précision — d'où un réglage plutôt qu'un choix
 * imposé.
 */

export type NumberFormat = "full" | "short";

const UNITS = [
	{ threshold: 1e9, suffix: "G" },
	{ threshold: 1e6, suffix: "M" },
	{ threshold: 1e3, suffix: "K" },
];

/** 4038588 → « 4 038 588 ». Groupage manuel : l'ICU de Stream Deck n'est pas garantie. */
export function groupDigits(value: number): string {
	return Math.round(value)
		.toString()
		.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function strip(value: number, decimals: number): string {
	// « 1.00 » → « 1 », « 1.20 » → « 1.2 » : un zéro final n'apporte rien.
	return value.toFixed(decimals).replace(/\.?0+$/, "");
}

/** Deux décimales sous 10, une au-delà : « 1.25M » d'un côté, « 800.8K » de l'autre. */
function decimalsFor(mantissa: number): number {
	return Math.abs(mantissa) < 10 ? 2 : 1;
}

/** 4038588 → « 4.04M », 211084 → « 211.1K », 999 → « 999 ». */
export function abbreviate(value: number): string {
	const absolute = Math.abs(value);

	for (let index = 0; index < UNITS.length; index += 1) {
		const unit = UNITS[index]!;
		if (absolute < unit.threshold) continue;

		const mantissa = value / unit.threshold;
		const decimals = decimalsFor(mantissa);
		const rounded = Number(mantissa.toFixed(decimals));

		// L'arrondi peut franchir l'unité : 999 950 donnerait « 1000.0K », qui
		// n'abrège plus rien. On remonte alors d'un cran.
		if (Math.abs(rounded) >= 1000 && index > 0) {
			const larger = UNITS[index - 1]!;
			const promoted = value / larger.threshold;
			return strip(promoted, decimalsFor(promoted)) + larger.suffix;
		}

		return strip(rounded, decimals) + unit.suffix;
	}

	return groupDigits(value);
}

/**
 * Montant en euros. En mode complet on réutilise la chaîne du ZEvent plutôt que
 * de la recalculer : c'est elle qui fait foi sur le site.
 */
export function formatAmount(value: number, official: string, format: NumberFormat): string {
	return format === "short" ? `${abbreviate(value)} €` : official;
}

/**
 * Nombre nu, sans unité. Les classements portent l'unité dans leur titre : sur
 * une ligne partagée avec un pseudo, un « € » coûte une lettre et demie.
 */
export function formatNumber(value: number, format: NumberFormat): string {
	return format === "short" ? abbreviate(value) : groupDigits(value);
}

export function formatViewers(value: number, format: NumberFormat): string {
	return formatNumber(value, format);
}
