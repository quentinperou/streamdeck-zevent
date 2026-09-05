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

Il faut **Node 20 ou plus** et **Stream Deck 6.5 ou plus**.

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

**Commits.** Format [Conventional Commits](https://www.conventionalcommits.org)
(`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`). Le corps du message dit
pourquoi le changement a été fait.

**Versions.** Ne modifiez pas `manifest.json` à la main : `npm version patch`
propage la version depuis `package.json` vers le manifest et le badge du
README. La CI refuse toute divergence.

## Ce qu'il faut savoir avant de toucher au code

Quelques contraintes ne se devinent pas à la lecture.

**Ménagez les serveurs du ZEvent.** Une seule requête sortante alimente toutes
les touches, toutes les 20 secondes, et seulement tant qu'une touche du plugin
est visible. N'accélérez pas cette cadence : le plugin peut tourner sur des
milliers de machines pendant l'événement, et le ZEvent a mieux à faire que
d'absorber notre trafic. `MIN_REFRESH_MS` empêche par ailleurs deux appels
rapprochés, même déclenchés à la main.

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

**`Nodejs.Debug` reste sur `disabled` dans les commits.** Passez-le sur
`enabled` pour déboguer en local, mais ne le committez pas : le job de
publication refuse de livrer un plugin qui ouvrirait un port de débogage chez
les utilisateurs.

## Couleurs

La palette vient de zevent.fr : vert `#00BD00`, noirs neutres `#0B0B0B` et
`#242424`. Elle a été relevée sur le site, pas choisie. Si la charte du ZEvent
évolue, mettez à jour `COLORS` dans `src/render.ts`, les variables de
`ui/css/pi.css` et `scripts/make-icons.mjs` — et dites d'où vient la nouvelle
valeur.

## Licence

En contribuant, vous acceptez que votre code soit publié sous la
[licence MIT](LICENSE) du projet.
