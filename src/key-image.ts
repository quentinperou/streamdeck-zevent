/**
 * Évite de réenvoyer une image de touche identique à la précédente.
 *
 * Chaque visuel embarque l'avatar du streamer en base64 : environ 16 ko par
 * touche. Sans ce filtre, chaque cycle de rafraîchissement les réexpédie tous,
 * y compris ceux des streamers hors ligne dont la cagnotte ne bouge plus de la
 * soirée. Comparer deux chaînes coûte infiniment moins cher que de traverser
 * la liaison avec Stream Deck pour rien.
 */

/** Le strict nécessaire d'une touche : de quoi tester sans instancier le SDK. */
type Target = {
	readonly id: string;
	setImage(image?: string): Promise<void>;
};

export class KeyImageCache {
	#sent = new Map<string, string>();

	/** Envoie l'image, sauf si cette touche affiche déjà exactement celle-là. */
	async apply(target: Target, image: string): Promise<void> {
		if (this.#sent.get(target.id) === image) return;

		await target.setImage(image);
		this.#sent.set(target.id, image);
	}

	/**
	 * À appeler dès qu'une touche apparaît ou disparaît.
	 *
	 * Stream Deck détruit le contexte d'une touche qui quitte l'écran et la
	 * recrée sur l'image par défaut du manifest. Garder le souvenir de ce qu'on
	 * lui avait envoyé la laisserait vide au retour, l'envoi étant considéré
	 * comme inutile — c'est la seule façon dont cette optimisation pourrait
	 * casser l'affichage, et elle est écartée ici.
	 */
	forget(id: string): void {
		this.#sent.delete(id);
	}

	/** Nombre de touches suivies. Sert aux tests. */
	get size(): number {
		return this.#sent.size;
	}
}
