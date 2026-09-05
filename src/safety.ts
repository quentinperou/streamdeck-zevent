import streamDeck from "@elgato/streamdeck";

/**
 * Filet de sécurité du processus.
 *
 * Depuis Node 15, une promesse rejetée sans capture arrête le processus avec le
 * code 1. Pour un plugin Stream Deck, la sanction est disproportionnée : une
 * requête qui expire ou une coupure réseau suffit à tuer le plugin, Stream Deck
 * le relance, l'échec se répète, et au bout de huit cycles il le déclare
 * « unstable » et le désactive. L'utilisateur se retrouve alors avec des touches
 * mortes, sans message, et un redémarrage n'y change rien.
 *
 * Rien de ce que fait ce plugin ne justifie d'abandonner le processus : au pire
 * une touche garde la valeur précédente une minute de plus.
 */
export function installSafetyNet(): void {
	process.on("unhandledRejection", (reason) => {
		streamDeck.logger.error("Promesse rejetée sans capture", reason);
	});

	process.on("uncaughtException", (error) => {
		streamDeck.logger.error("Exception non capturée", error);
	});
}

/**
 * Lance un travail de fond sans risquer d'abattre le processus s'il échoue.
 * À utiliser partout où l'on serait tenté d'écrire `void promesse()`.
 */
export function safely(work: Promise<unknown>, context: string): void {
	void work.catch((error) => {
		streamDeck.logger.error(`${context} : échec`, error);
	});
}
