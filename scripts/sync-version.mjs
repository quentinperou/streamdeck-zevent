#!/usr/bin/env node
/**
 * Propage la version de `package.json` vers les endroits qui la répètent :
 * le `Version` du manifest Stream Deck et le badge du README.
 *
 * Stream Deck attend quatre segments là où npm en impose trois ; sans ce
 * script, les deux fichiers divergent silencieusement et le plugin s'installe
 * en annonçant une version qui n'est pas la sienne.
 *
 *   node scripts/sync-version.mjs            met à jour les fichiers
 *   node scripts/sync-version.mjs --check    vérifie sans écrire (utilisé en CI)
 *
 * Le hook npm `version` l'exécute automatiquement sur `npm version patch`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = "fr.quentinperou.zevent.sdPlugin";

const PACKAGE = join(ROOT, "package.json");
const MANIFEST = join(ROOT, PLUGIN, "manifest.json");
const README = join(ROOT, "README.md");

const CHECK_ONLY = process.argv.includes("--check");

/** Le badge du README, dont seule la version doit bouger. */
const BADGE = /(img\.shields\.io\/badge\/version-)([\d.]+)(-00BD00)/;

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const problems = [];
const changes = [];

const { version } = JSON.parse(readFileSync(PACKAGE, "utf8"));

if (!/^\d+\.\d+\.\d+$/.test(version)) {
	// Une préversion n'a pas de traduction fidèle en quatre segments : `1.2.0-rc.1`
	// deviendrait `1.2.0.x`, qui se classerait au-dessus de la 1.2.0 finale.
	console.error(`✗  Version invalide dans package.json : "${version}" — attendu X.Y.Z`);
	process.exit(1);
}

const target = `${version}.0`;

/**
 * Remplacement chirurgical plutôt que réécriture du JSON : `streamdeck pack`
 * reformate le manifest à sa façon, et une simple resérialisation créerait un
 * diff parasite à chaque passage.
 */
function syncManifest() {
	const source = readFileSync(MANIFEST, "utf8");
	const current = JSON.parse(source).Version;

	if (current === target) return;

	if (CHECK_ONLY) {
		problems.push(`manifest.json annonce ${current}, package.json ${version} (attendu ${target})`);
		return;
	}

	// Ancré sur la valeur courante : le manifest porte aussi un `"Version"` sous
	// `Nodejs`, qu'il ne faut surtout pas toucher.
	const pattern = new RegExp(`("Version"\\s*:\\s*)"${escapeRegExp(current)}"`);
	if (!pattern.test(source)) {
		console.error(`✗  Champ "Version" introuvable dans ${relative(ROOT, MANIFEST)}`);
		process.exit(1);
	}

	writeFileSync(MANIFEST, source.replace(pattern, `$1"${target}"`));
	changes.push(`manifest.json  ${current} → ${target}`);
}

function syncReadme() {
	const source = readFileSync(README, "utf8");
	const found = BADGE.exec(source);

	if (!found) return;
	if (found[2] === version) return;

	if (CHECK_ONLY) {
		problems.push(`README.md affiche ${found[2]}, package.json ${version}`);
		return;
	}

	writeFileSync(README, source.replace(BADGE, `$1${version}$3`));
	changes.push(`README.md      ${found[2]} → ${version}`);
}

syncManifest();
syncReadme();

if (CHECK_ONLY) {
	if (problems.length > 0) {
		console.error("✗  Versions désynchronisées :");
		for (const problem of problems) console.error(`     ${problem}`);
		console.error("\n   Lancez `npm run sync-version` puis committez le résultat.");
		process.exit(1);
	}
	console.log(`✓  Versions cohérentes (${version} / ${target})`);
} else if (changes.length > 0) {
	console.log(`🔖  Synchronisation sur ${version}`);
	for (const change of changes) console.log(`     ${change}`);
} else {
	console.log(`✓  Déjà à jour (${version} / ${target})`);
}
