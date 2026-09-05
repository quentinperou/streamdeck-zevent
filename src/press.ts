/**
 * Distinction entre appui court et appui long.
 *
 * Stream Deck n'envoie que `keyDown` et `keyUp` : l'appui long se déduit du
 * temps écoulé entre les deux. L'action longue se déclenche **au seuil**, pas
 * au relâchement — sans quoi rien ne dirait à l'utilisateur qu'il a assez
 * appuyé, et il n'aurait aucun moyen d'annuler en relâchant plus tôt.
 */

/** Seuil au-delà duquel un appui devient long. */
const LONG_PRESS_MS = 500;

export class PressTracker {
	#pending = new Map<string, NodeJS.Timeout>();
	#fired = new Set<string>();

	/** Début d'appui : arme le déclenchement de l'action longue. */
	down(id: string, onLong: () => void): void {
		this.forget(id);

		const timer = setTimeout(() => {
			this.#pending.delete(id);
			this.#fired.add(id);
			onLong();
		}, LONG_PRESS_MS);
		timer.unref?.();

		this.#pending.set(id, timer);
	}

	/**
	 * Fin d'appui. Renvoie `true` s'il s'agissait d'un appui court, c'est-à-dire
	 * si l'action longue n'a pas déjà été déclenchée.
	 */
	up(id: string): boolean {
		const timer = this.#pending.get(id);
		if (timer) {
			clearTimeout(timer);
			this.#pending.delete(id);
		}
		return !this.#fired.delete(id);
	}

	/** La touche disparaît : plus rien ne doit se déclencher en son nom. */
	forget(id: string): void {
		const timer = this.#pending.get(id);
		if (timer) {
			clearTimeout(timer);
			this.#pending.delete(id);
		}
		this.#fired.delete(id);
	}
}
