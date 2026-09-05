# ZEvent pour Stream Deck

Affiche les cagnottes du ZEvent sur les touches d'un Stream Deck, et ouvre la
chaîne Twitch du streamer d'un simple appui.

## Actions

| Action | Touche | Appui |
| --- | --- | --- |
| **Cagnotte streamer** | Pseudo, cagnotte, viewers, avatar en fond | Ouvre `twitch.tv/<pseudo>` (ou la page de don) |
| **Cagnotte globale** | Total du ZEvent et viewers cumulés | Ouvre la page de don (ou `zevent.fr`) |

Le bandeau rouge en bas de touche signale un stream en direct ; il s'éteint
lorsque le streamer est hors ligne. Une pastille ambre apparaît si la donnée
affichée a plus de deux minutes.

## Property Inspector

Le choix du streamer se fait par **barre de recherche** (insensible à la casse
et aux accents) couplée à un **menu déroulant** listant les 300+ participants
avec leur cagnotte et leur statut. La liste se trie par cagnotte, nom, viewers
ou « en direct d'abord », et la sélection courante reste toujours proposée même
quand la recherche l'exclut.

## Source des données

Tout vient de l'API publique du ZEvent, `https://zevent.fr/api/` — celle
qu'utilise le site lui-même. Elle n'émet aucun en-tête CORS : un Property
Inspector, qui est une page web, ne peut pas l'appeler. C'est donc le plugin
Node qui interroge le ZEvent et pousse le catalogue vers l'interface.

Une seule requête sortante alimente toutes les touches, toutes les 20 secondes
et seulement tant qu'une touche du plugin est visible. En cas de panne, le
dernier état connu reste affiché et les tentatives s'espacent progressivement
(jusqu'à 5 minutes). Les avatars sont récupérés en 70×70 — la variante que
Twitch expose déjà — et gardés en mémoire.

## Développement

```bash
npm install
npm run icons      # régénère les PNG depuis les tracés SVG
npm run build      # bundle src/ vers fr.quentinperou.zevent.sdPlugin/bin/plugin.js
npm run link       # crée le lien symbolique vers le dossier Plugins de Stream Deck
```

Ensuite, `npm run watch` reconstruit et redémarre le plugin à chaque
modification.

`npm run preview` interroge le vrai ZEvent et écrit les visuels de touche en SVG
dans `.preview/` : de quoi itérer sur le rendu sans repasser par Stream Deck.

`npm run pack` produit le `.streamDeckPlugin` distribuable.

> `manifest.json` laisse `Nodejs.Debug` sur `enabled`, pratique en développement.
> À passer sur `disabled` avant toute diffusion.
