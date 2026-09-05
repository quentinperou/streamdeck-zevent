# Contribuer

Merci de l'intérêt porté à ce plugin. Les contributions sont bienvenues :
correction de bug, nouvelle action, traduction, amélioration du rendu des
touches.

## Signaler un bug

Ouvrez une [issue](https://github.com/quentinperou/streamdeck-zevent/issues) en
joignant :

- la version du plugin (visible dans `manifest.json`, ou sur la touche depuis
  Stream Deck) et celle de Stream Deck ;
- votre système et sa version ;
- le contenu de `fr.quentinperou.zevent.sdPlugin/logs/`, qui contient le
  journal du plugin ;
- ce que vous attendiez et ce qui s'est produit.

Précisez si le ZEvent était en cours ou non : hors événement, l'API renvoie des
données figées, ce qui change beaucoup de comportements.

## Mise en route

Il faut **Node 20 ou plus** et **Stream Deck 6.9 ou plus**.

```bash
npm install
npm run icons      # génère les PNG à partir des tracés SVG
npm run build      # bundle src/ vers fr.quentinperou.zevent.sdPlugin/bin/plugin.js
npm run link       # lie le dossier plugin à Stream Deck
```

Ensuite, `npm run watch` reconstruit et redémarre le plugin à chaque
modification : c'est la boucle de travail normale.

Pour itérer sur l'apparence des touches sans repasser par Stream Deck,
`npm run preview` interroge le vrai ZEvent et écrit les visuels en SVG dans
`.preview/`, dans les deux formats de nombres.

## Avant de proposer une pull request

```bash
npm run sync-version -- --check   # versions cohérentes
npm run typecheck                 # types
npm run build                     # bundle
npm run check                     # intégrité du dossier plugin
```

C'est exactement ce que fait la CI : si ces quatre commandes passent chez vous,
elles passeront sur GitHub.

## Conventions

**Code.** TypeScript en mode strict, indentation par tabulations, pas de `any`.
Les commentaires expliquent *pourquoi* le code est ainsi, pas ce qu'il fait :
une ligne qui se lit seule n'a pas besoin d'être paraphrasée, une contrainte
non évidente mérite d'être écrite.

**Commits.** En français, comme le reste du projet. Format
[Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`,
`docs:`, `refactor:`, `chore:`). Le corps du message dit pourquoi le changement
a été fait.

**Versions.** Ne modifiez pas `manifest.json` à la main : `npm version patch`
propage la version depuis `package.json` vers le manifest et le badge du
README. La CI refuse toute divergence.

## Ce qu'il faut savoir avant de toucher au code

Quelques contraintes ne se devinent pas à la lecture.

**N'accélérez pas la cadence.** Une seule requête sortante alimente toutes les
touches, une fois par minute, et seulement tant qu'une touche du plugin est
visible.

Ce n'est pas la charge serveur qui commande : le ZEvent sert cette route depuis
le cache Cloudflare, nos appels n'atteignent jamais son origine. C'est le poids
de la réponse — **157 ko**, la liste complète des participants alors qu'une
touche n'en lit qu'une ligne. À une minute, cela représente environ 9 Mo par
heure et par utilisateur ; à 20 secondes, 28 Mo. Multipliez par le nombre de
personnes qui font tourner le plugin pendant l'événement.

`MIN_REFRESH_MS` interdit par ailleurs deux appels à moins de 15 secondes
d'intervalle, bouton *Rafraîchir* compris. Cette valeur n'est pas arbitraire :
c'est le `max-age=15` que le ZEvent déclare dans ses en-têtes. En deçà, on
retéléchargerait mot pour mot une réponse déjà servie par le cache.

**InGDoc mérite encore plus d'égards.** La seconde source des paliers
(`api.evenmorestats.fr`) est un projet communautaire qui n'annonce **ni cache ni
limite de débit** — aucun en-tête ne nous guide, contrairement au ZEvent. Son
décompte groupé pèse 244 ko : il est mis en cache cinq minutes et ne doit pas
être rechargé à chaque ouverture d'une fenêtre.

**Et il doit pouvoir tomber sans conséquence.** Le mode « auto » retombe sur
l'API officielle dès qu'InGDoc échoue ; c'est la règle à préserver dans toute
modification de `src/goals.ts`. Un choix explicite d'InGDoc, en revanche, ne
bascule pas en douce : la touche signale l'indisponibilité, sinon le sélecteur
de source ne voudrait rien dire.

**Le Property Inspector ne peut pas appeler l'API.** C'est une page web, et
`zevent.fr/api/` n'émet aucun en-tête CORS. Toute donnée qu'il affiche doit
transiter par le plugin, via `sendCatalogue()`. C'est aussi pourquoi les deux
mises en forme des nombres y arrivent déjà calculées : la page n'a aucune
logique de formatage, donc son aperçu ne peut pas diverger de la touche.

**Le moteur SVG de Stream Deck est limité.** Les visuels de touche
(`src/render.ts`) s'en tiennent à `rect`, `image` et `text`. Pas de
`clipPath`, pas de filtre, pas de `foreignObject` : ce qui s'affiche
correctement dans un navigateur peut très bien ne rien donner sur la touche.
Vérifiez toujours avec `npm run preview`, et si possible sur un vrai boîtier.

**Les largeurs de texte sont estimées, pas mesurées.** Stream Deck ne renvoie
jamais les dimensions rendues. `src/render.ts` s'appuie sur une table de
largeurs de glyphes pour choisir la taille de police. En ajoutant des
caractères inhabituels, pensez à compléter cette table.

**Les icônes sont générées.** Ne retouchez pas les PNG de `imgs/` : modifiez
les tracés dans `scripts/make-icons.mjs` puis relancez `npm run icons`.

**`bin/` n'est pas versionné.** Le bundle est un artefact de build, produit par
la CI au moment de la publication.

**`Nodejs.Debug` est absent du manifest, et doit le rester.** Ce champ n'est pas
un interrupteur : Stream Deck en passe la valeur à Node **en arguments de ligne
de commande**. Seuls `"enabled"` et `"break"` sont interprétés — écrire
`"disabled"` fait lancer `node disabled plugin.js`, qui meurt aussitôt sans rien
écrire dans les journaux du plugin, et Stream Deck finit par le désactiver pour
instabilité. L'erreur a déjà été commise, `npm run check` la refuse désormais.

Ajoutez le champ avec la valeur `enabled` le temps d'un débogage local, sans le
committer : le job de publication refuse de livrer un plugin qui ouvrirait un
port de débogage chez les utilisateurs.

## Couleurs

La palette vient de zevent.fr : vert `#00BD00`, noirs neutres `#0B0B0B` et
`#242424`. Elle a été relevée sur le site, pas choisie. Si la charte du ZEvent
évolue, mettez à jour `COLORS` dans `src/render.ts`, les variables de
`ui/css/pi.css` et `scripts/make-icons.mjs` — et dites d'où vient la nouvelle
valeur.

## Licence

En contribuant, vous acceptez que votre code soit publié sous la
[licence MIT](LICENSE) du projet.
