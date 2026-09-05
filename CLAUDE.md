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
| `src/goals.ts` | Paliers de dons, fiche par fiche, seulement pour les streamers affichés |
| `src/render.ts` | Visuels de touche en SVG |
| `src/format.ts` | Nombres complets ou abrégés |
| `src/key-image.ts` | Évite de réenvoyer une image identique |
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

**Les icônes sont générées.** Modifier `scripts/make-icons.mjs`, pas les PNG.

**`bin/` n'est pas versionné.** C'est un artefact de build.

## Conventions

- Tout est en français : README, CONTRIBUTING, commentaires, interface, et les
  messages de commit.
- Commits au format Conventional Commits (`feat:`, `fix:`, `docs:`…), avec un
  corps qui dit *pourquoi*.
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
publication refuse de livrer tant que `Nodejs.Debug` vaut `"enabled"` dans le
manifest : cette valeur reste sur `"disabled"` dans les commits, et se bascule
localement le temps d'un débogage.

## Sources de données

| Endpoint | Contenu | Poids |
| --- | --- | --- |
| `https://zevent.fr/api/` | Tous les streamers, cagnottes, viewers, cagnotte globale | ~157 ko |
| `https://api.zevent.fr/streamer/<twitch_id>` | Paliers de dons d'un streamer (`donationGoal.goals`) | ~2 ko |

Le premier ne contient **pas** les paliers ; le second est le seul à les
exposer, une fiche à la fois.
