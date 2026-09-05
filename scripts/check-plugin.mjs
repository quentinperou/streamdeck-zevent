#!/usr/bin/env node
/**
 * Contrôle l'intégrité du dossier `.sdPlugin` avant publication.
 *
 * Stream Deck complète lui-même l'extension des images et charge le Property
 * Inspector à l'ouverture : un chemin erroné ne se voit ni à la compilation ni
 * au build, seulement le jour où quelqu'un installe le plugin et tombe sur une
 * touche vide. Ce script fait remonter ces erreurs en CI.
 *
 *   node scripts/check-plugin.mjs             contrôles de base
 *   node scripts/check-plugin.mjs --release    y ajoute les exigences de publication
 */
import { existsSync, statSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = "fr.quentinperou.zevent.sdPlugin";
const RELEASE = process.argv.includes("--release");

const errors = [];
const notes = [];

function resolve(relativePath) {
	return join(ROOT, PLUGIN, relativePath);
}

function requireFile(relativePath, why) {
	if (!existsSync(resolve(relativePath))) {
		errors.push(`${relativePath} — ${why}`);
		return false;
	}
	if (statSync(resolve(relativePath)).size === 0) {
		errors.push(`${relativePath} — fichier vide`);
		return false;
	}
	return true;
}

const manifest = JSON.parse(readFileSync(resolve("manifest.json"), "utf8"));

// ── Code ──────────────────────────────────────────────────────────────────────
requireFile(manifest.CodePath, "point d'entrée déclaré par le manifest (lancez `npm run build`)");

// ── Images ────────────────────────────────────────────────────────────────────
// Les chemins du manifest sont donnés sans extension : Stream Deck cherche
// `<chemin>.png` et sa variante `@2x`. Les deux doivent exister.
const images = [manifest.Icon, manifest.CategoryIcon];
for (const action of manifest.Actions ?? []) {
	images.push(action.Icon, ...(action.States ?? []).map((state) => state.Image));
}

for (const image of images.filter(Boolean)) {
	requireFile(`${image}.png`, "icône déclarée par le manifest");
	requireFile(`${image}@2x.png`, "variante haute densité de l'icône");
}
notes.push(`${images.filter(Boolean).length} icônes déclarées`);

// ── Property Inspectors ───────────────────────────────────────────────────────
for (const action of manifest.Actions ?? []) {
	if (action.PropertyInspectorPath) {
		requireFile(action.PropertyInspectorPath, `Property Inspector de « ${action.Name} »`);
	}
}
notes.push(`${(manifest.Actions ?? []).length} actions`);

// ── Exigences propres à une version publiée ───────────────────────────────────
if (RELEASE) {
	if (manifest.Nodejs?.Debug === "enabled") {
		errors.push(
			'manifest.json — `Nodejs.Debug` vaut "enabled" : à réserver au développement, ' +
				"le port de débogage ne doit pas être ouvert chez les utilisateurs",
		);
	}
	if (!/^\d+\.\d+\.\d+\.\d+$/.test(manifest.Version ?? "")) {
		errors.push(`manifest.json — Version "${manifest.Version}" : quatre segments attendus`);
	}
}

// ── Verdict ───────────────────────────────────────────────────────────────────
if (errors.length > 0) {
	console.error(`✗  ${PLUGIN} — ${errors.length} problème(s) :`);
	for (const error of errors) console.error(`     ${error}`);
	process.exit(1);
}

console.log(`✓  ${PLUGIN} complet — ${notes.join(", ")}${RELEASE ? ", prêt à publier" : ""}`);
