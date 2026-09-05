# CLAUDE.md

Repères pour travailler sur ce dépôt. Les règles destinées aux contributeurs
humains sont dans [CONTRIBUTING.md](CONTRIBUTING.md) ; ce fichier ne répète que
ce qui se perd facilement.

## Le projet

Plugin Stream Deck qui affiche les cagnottes du ZEvent sur les touches et ouvre
la chaîne Twitch du streamer au clic. TypeScript, bundlé par rollup vers
`fr.quentinperou.zevent.sdPlugin/bin/plugin.js`, exécuté par le runtime Node 20
que fournit Stream Deck.

## Commandes

```bash
npm run build        # bundle src/ -> bin/plugin.js
npm run typecheck    # couvre src/ et scripts/
npm run validate     # conformité du manifest au schéma Elgato
npm run check        # integrité du dossier .sdPlugin (ajouter --release avant publication)
npm run preview      # rend les visuels de touche en SVG dans .preview/, données réelles
npm run icons        # régénère les PNG depuis les tracés de scripts/make-icons.mjs
npx streamdeck restart fr.quentinperou.zevent   # recharge le plugin après un build
```

Avant de proposer quoi que ce soit : `sync-version -- --check`, `typecheck`,
`build`, `check`. C'est exactement ce que fait la CI.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `src/plugin.ts` | Enregistrement des actions, abonnement au store, ponts vers le Property Inspector |
| `src/zevent.ts` | Accès unique à l'API, cadence, cache des avatars |
| `src/goals.ts` | Paliers de dons : choix de la source, repli, cache par couple streamer/source |
| `src/ingdoc.ts` | Source alternative InGDoc : résolution de l'édition, décompte groupé, historiques |
| `src/render.ts` | Visuels de touche en SVG |
| `src/format.ts` | Nombres complets ou abrégés |
| `src/key-image.ts` | Évite de réenvoyer une image identique |
| `src/press.ts` | Distingue appui court et appui long, absents du SDK |
| `src/pi.ts` | Pousse le catalogue vers le Property Inspector |
| `ui/` | Property Inspectors, HTML/CSS/JS sans build |

## Contraintes qui ne se devinent pas

**L'API du ZEvent n'émet aucun en-tête CORS.** C'est la raison d'être du plugin
Node : ni un plugin HTML ni le Property Inspector ne peuvent l'appeler. Toute
donnée affichée dans l'interface doit transiter par `sendCatalogue()`.

**Une requête par minute, et seulement quand une touche est visible.** La
réponse pèse 157 ko ; le ZEvent la sert depuis un cache Cloudflare, donc c'est
la bande passante qui commande, pas la charge serveur. Ne pas accélérer.
`MIN_REFRESH_MS` (15 s, soit le `max-age` déclaré par le ZEvent) s'applique à
tout le monde, bouton *Rafraîchir* compris.

**Le moteur SVG de Stream Deck est limité** : `rect`, `image`, `text`
uniquement. Pas de `clipPath`, pas de filtre, pas de `foreignObject`. Ce qui
s'affiche dans un navigateur peut très bien ne rien donner sur la touche —
vérifier avec `npm run preview`.

**Les largeurs de texte sont estimées**, jamais mesurées : Stream Deck ne
renvoie pas les dimensions rendues. `GLYPH_WIDTHS` dans `render.ts` sert à
choisir la taille de police et à tronquer. Ajouter les caractères manquants
plutôt que de deviner.

**Les lignes de base SVG se calculent**, elles ne se codent pas en dur : la
taille de police varie avec la longueur du montant, donc une valeur fixe
décentre. Voir `centeredBaseline()`.

**Le cache d'images doit être vidé à `willAppear` et `willDisappear`.** Stream
Deck repose une touche sur l'image par défaut du manifest quand elle quitte
l'écran ; sans cet oubli, le redessin serait jugé inutile et la touche
resterait vide.

**`Nodejs.Debug` n'est pas un interrupteur.** Stream Deck passe sa valeur à Node
en **arguments de ligne de commande**. Seuls `"enabled"` et `"break"` sont
interprétés ; tout le reste part tel quel. Écrire `"disabled"` fait lancer
`node disabled plugin.js`, qui meurt instantanément **sans rien écrire dans les
journaux du plugin** — on ne voit qu'une boucle de relance, puis Stream Deck
déclare le plugin instable et le désactive. Pour ne pas déboguer : **omettre le
champ**. `npm run check` refuse désormais toute autre valeur — et c'est lui
seul : `streamdeck validate` laisse passer `"disabled"` sans broncher, puisque
le schéma autorise n'importe quelle chaîne. Les deux contrôles sont
complémentaires, garder les deux.

**Une promesse rejetée sans capture tue le processus.** Node sort avec le code
1, Stream Deck relance, et après huit cycles il désactive le plugin — l'utilisateur
n'a plus que des touches mortes. Ne jamais écrire `void promesse()` : passer par
`safely()` de `src/safety.ts`. Un filet global attrape le reste.

**Ne jamais appeler `getSettings()` dans une boucle de rendu.** C'est un
aller-retour vers Stream Deck qui peut expirer. Les réglages sont mis en cache
depuis `willAppear` et `didReceiveSettings`, que Stream Deck pousse déjà.

**Un test qui s'arrête à l'enregistrement ne prouve rien.** Pour reproduire un
plantage, le faux hôte doit aussi envoyer les `willAppear` : sans eux, tout le
code de rendu reste inexploré.

**Les icônes sont générées.** Modifier `scripts/make-icons.mjs`, pas les PNG.

**`bin/` n'est pas versionné.** C'est un artefact de build.

## Conventions

- Tout est en français : README, CONTRIBUTING, commentaires, interface, et les
  messages de commit.
- Commits au format Conventional Commits (`feat:`, `fix:`, `docs:`…), avec un
  corps qui dit *pourquoi*.
- **Attendre la validation de Quentin avant chaque commit.** Modifier, construire
  et recharger le plugin sans demander ; s'arrêter avant `git commit`.
- Commentaires qui expliquent le pourquoi, jamais la paraphrase du code.
- TypeScript strict, tabulations, pas de `any`.

## Versions et publication

La version vit dans `package.json`. `npm version patch|minor` la propage au
`Version` du manifest (quatre segments) et au badge du README via
`scripts/sync-version.mjs` ; la CI refuse toute divergence.

- **patch** — correctif, ajustement visuel, optimisation
- **minor** — nouvelle option ou nouvelle action
- **major** — rupture

Pousser un tag `v*` empaquette le plugin et crée la release GitHub. Le job de
publication refuse de livrer tant que `Nodejs.Debug` figure dans le manifest :
le champ reste **absent** des commits et se pose localement le temps d'un
débogage — jamais sur `"disabled"`, qui empêche le plugin de démarrer.

## Sources de données

| Endpoint | Contenu | Poids |
| --- | --- | --- |
| `https://zevent.fr/api/` | Tous les streamers, cagnottes, viewers, cagnotte globale | ~157 ko |
| `https://api.zevent.fr/streamer/<twitch_id>` | Paliers de dons d'un streamer (`donationGoal.goals`) | ~2 ko |
| `https://api.evenmorestats.fr/events` | Éditions, pour résoudre l'année en cours par les dates | ~3 ko |
| `.../events/<id>/donation_goals/overview` | Décompte des paliers des 338, en un appel | ~244 ko |
| `.../participations/<pid>/donation_goals` | Paliers d'un streamer chez InGDoc (montants **en centimes**) | ~3 ko |
| `evenmorestats-cache.s3…/metrics/<ev>/streamers/<id>.json` | Historique des dons d'un streamer, un point toutes les 10 min | ~9 ko |
| `evenmorestats-cache.s3…/metrics/<ev>/global.json` | Historique de la cagnotte globale, dons ventilés LAN/distanciel | ~27 ko |

La liste principale du ZEvent ne contient **pas** les paliers. L'officiel ne les
expose qu'une fiche à la fois, et en oublie une partie : sur 60 streamers
observés, 8 % y figurent sans aucun palier alors qu'ils en ont une quinzaine.
InGDoc les a, et son `overview` est la **seule** route qui donne le décompte des
338 en un appel — d'où l'annotation du menu déroulant, impossible autrement.

InGDoc est un service communautaire, sans en-tête de cache ni limite de débit
annoncée : le mode « auto » retombe toujours sur l'officiel s'il ne répond pas.

**L’historique des dons n’existe nulle part ailleurs.** Il vit dans un cache S3,
pas dans une API documentée — plus fragile encore que le reste d’InGDoc. Ces
fichiers portent plusieurs séries dont **une seule est chronologique** : celle
des viewers arrive à l’envers. Trier par horodatage, ne pas se fier à l’ordre
reçu.

**Les deux fichiers de métriques n’ont pas la même forme.** Chez un streamer,
`graph.donations` porte directement `labels`/`values` ; dans `global.json`, les
dons sont ventilés en `remote`, `lan` et `all` — seul `all` correspond au total
affiché par le ZEvent. Le fichier global s’atteint en revanche sans passer par
l’`overview` : une touche globale seule ne télécharge pas les 244 ko.
