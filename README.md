# ZEvent pour Stream Deck

[![Build](https://github.com/quentinperou/streamdeck-zevent/actions/workflows/build.yml/badge.svg)](https://github.com/quentinperou/streamdeck-zevent/actions/workflows/build.yml)
[![Version](https://img.shields.io/badge/version-1.6.1-00BD00)](https://github.com/quentinperou/streamdeck-zevent/releases)
[![Licence](https://img.shields.io/badge/licence-MIT-00BD00)](LICENSE)

Affiche les cagnottes du [ZEvent](https://zevent.fr/) sur les touches d'un Stream Deck, et ouvre la
chaîne Twitch du streamer d'un simple appui.

BOURREZ LES DONS !!

![Un Stream Deck rempli de touches ZEvent : les cagnottes de Domingo, Mastu, mistermv et d'autres avec leur nombre de viewers, le total du ZEvent à 6 344 796 €, des jauges de progression vers des paliers de dons, un libellé de palier affiché en toutes lettres, un classement des quatre premières cagnottes, et la touche de mcflyetcarlito encadrée de blanc annonçant un temps fort à +19 073 €](.github/apercu.png)

## Installation

Récupérez le fichier `.streamDeckPlugin` de la
[dernière release](https://github.com/quentinperou/streamdeck-zevent/releases)
et double-cliquez dessus. Les actions apparaissent ensuite dans la catégorie
**ZEvent**.

## Actions

| Action | Touche |
| --- | --- |
| **Cagnotte streamer** | Pseudo, cagnotte, viewers, avatar en fond |
| **Cagnotte globale** | Total du ZEvent et viewers cumulés |
| **Palier de dons** | Avancement vers un palier, en barre de progression |
| **Classement** | Les quatre premiers, par cagnotte ou par viewers |

Le bandeau vert en bas de touche signale un stream en direct, et s'éteint
lorsque le streamer est hors ligne. Une pastille ambre apparaît si la donnée
affichée a plus de trois minutes.

### Appui court, appui long

Chaque touche déclenche une action au clic et une autre à l'appui maintenu
(500 ms). Les deux se règlent séparément, dans la même liste :

| | Cagnotte streamer | Cagnotte globale | Palier de dons | Classement |
| --- | --- | --- | --- | --- |
| Ouvrir la chaîne Twitch | ✓ | | ✓ | |
| Ouvrir la page de don | ✓ | ✓ | ✓ | ✓ |
| Ouvrir zevent.fr | | ✓ | | ✓ |
| Afficher / masquer le graphique | ✓ | ✓ | | |
| Afficher le nom du palier | | | ✓ | |
| Basculer cagnotte / viewers | | | | ✓ |
| Ne rien faire | ✓ | ✓ | ✓ | ✓ |

Réglages par défaut :

| Action | Appui court | Appui long |
| --- | --- | --- |
| **Cagnotte streamer** | Graphique | Chaîne Twitch |
| **Cagnotte globale** | Graphique | Page de don |
| **Palier de dons** | Nom du palier | Page de don |
| **Classement** | Bascule cagnotte / viewers | zevent.fr |

L'appui long se déclenche au seuil des 500 ms, pas au relâchement.

### Courbe des dons

Un appui bascule une touche **Cagnotte streamer** ou **Cagnotte globale** sur
la progression de sa cagnotte depuis le début de l'édition, et le même appui la
range. Le montant reste affiché au-dessus et se rafraîchit toutes les minutes.
Les barres avancent toutes les dix minutes, granularité de la source.

Cet historique vient d'InGDoc, l'API du ZEvent ne publiant que le montant
courant. Si le fichier ne répond pas, la touche garde son affichage normal.
Retirer l'option des deux menus d'appui ramène également la touche à la
normale.

### Classement

L'action **Classement** montre les quatre premiers du ZEvent, au choix par
cagnotte ou par nombre de viewers. Un appui bascule d'un critère à l'autre. La
bascule écrit le réglage, donc la touche garde son critère au redémarrage.

Les chiffres y sont abrégés par défaut, contrairement aux autres actions, et
les lignes ne portent pas le « € » : le titre de la touche indique déjà ce
qu'on compte.

### Temps forts

Quand un streamer reçoit cinq fois son rythme des vingt dernières minutes,
deux relevés de suite, sa touche s'entoure d'un cadre blanc et affiche la
hausse cumulée. Le cadre s'efface trois minutes après le dernier relevé
qualifiant.

Un plancher de 50 € par minute évite qu'une chaîne au repos s'allume au
premier don.

Il faut une dizaine de minutes de sondages avant le premier verdict, le temps
d'établir un rythme de référence. La case *Temps forts* désactive la détection.

### Format des chiffres

Chaque action propose deux écritures, montants et viewers compris :

| | Cagnotte | Viewers |
| --- | --- | --- |
| **Complets** (défaut) | `4 063 113 €` | `315 036 viewers` |
| **Abrégés** | `4.06M €` | `315K viewers` |

En abrégé : deux décimales sous 10, une au-delà, et les zéros inutiles
disparaissent. `1.25M`, `800.8K`, et `1.00M` s'écrit `1M`.

### Paliers de dons

L'action **Palier de dons** montre où en est un streamer sur l'un de ses
paliers : pourcentage, barre de progression, rang et montant visé. Le Property
Inspector propose soit le prochain palier à atteindre, la touche avançant alors
toute seule d'un palier au suivant, soit un palier précis choisi dans la liste.
Les paliers déjà tombés y sont marqués d'une coche.

L'avancement se mesure depuis le palier précédent, pas depuis le premier euro.
À 40 000 € pour un palier à 50 000 € qui suit celui de 40 000 €, la barre
affiche 0 % et non 80 %.

Tous les participants ne configurent pas de paliers. La touche le signale
plutôt que d'afficher une barre vide.

### Deux sources de paliers

Les paliers viennent au choix de l'API officielle du ZEvent ou d'**InGDoc**
([evenmorestats.fr](https://zevent.gdoc.fr/donation_goals/)), qui les publie
plus complètement : sur 60 streamers observés, 8 % sont annoncés sans aucun
palier par l'officiel alors qu'ils en ont une quinzaine.

| Réglage | Comportement |
| --- | --- |
| **Auto** *(défaut)* | InGDoc, et repli sur l'officiel dès qu'il ne répond pas |
| **InGDoc** | InGDoc seul, la touche signalant l'indisponibilité |
| **ZEvent** | L'API officielle seule |

Avec InGDoc, le menu déroulant annonce en prime le nombre de paliers de chaque
streamer. L'API officielle ne les expose que fiche par fiche, donc cette
annotation disparaît quand on impose cette source.

## Property Inspector

Le choix du streamer se fait par barre de recherche, insensible à la casse et
aux accents, couplée à un menu déroulant listant les 300+ participants avec
leur cagnotte et leur statut. La liste se trie par cagnotte, nom, viewers ou
« en direct d'abord ». La sélection courante reste toujours proposée, même
quand la recherche l'exclut.

Sur l'action **Palier de dons**, ce même menu annonce le nombre de paliers de
chaque streamer : `🟢 Zerator — 15 paliers`.

## Source des données

Les cagnottes viennent de l'API publique du ZEvent, `https://zevent.fr/api/`.
Elle n'émet aucun en-tête CORS, donc le Property Inspector ne peut pas
l'appeler. C'est le plugin Node qui l'interroge et lui pousse le catalogue.

Une seule requête alimente toutes les touches, une fois par minute, et
seulement tant qu'une touche est visible. La réponse pèse 157 ko. Le délai
minimal entre deux appels est de 15 secondes, bouton *Rafraîchir* compris,
soit le `cache-control: max-age=15` déclaré par le ZEvent.

En cas de panne, le dernier état connu reste affiché et les tentatives
s'espacent jusqu'à 5 minutes. Les avatars sont récupérés en 70×70 et gardés en
mémoire.

Les paliers ne figurent pas dans cette réponse. Deux routes les portent, selon
la source choisie :

| Route | Contenu | Poids |
| --- | --- | --- |
| `api.zevent.fr/streamer/<id>` | paliers d'un streamer, chez l'officiel | ~2 ko |
| `api.evenmorestats.fr/events` | éditions, pour trouver l'année en cours par ses dates | ~3 ko |
| `…/events/<id>/donation_goals/overview` | décompte des paliers des 338, en un appel | ~244 ko |
| `…/participations/<pid>/donation_goals` | paliers d'un streamer, chez InGDoc | ~3 ko |
| `evenmorestats-cache…/metrics/<ev>/streamers/<id>.json` | historique des dons d'un streamer, un point toutes les 10 min | ~9 ko |
| `evenmorestats-cache…/metrics/<ev>/global.json` | historique de la cagnotte globale, même cadence | ~27 ko |

Seuls les streamers posés sur une touche « palier » sont interrogés. L'édition
en cours se déduit des dates, elle n'est pas codée en dur.

InGDoc est un service communautaire, sans en-tête de cache ni limite de débit
annoncée. Le mode « auto » retombe sur l'officiel s'il ne répond pas.

## Développement

```bash
npm install
npm run icons      # régénère les PNG depuis les tracés SVG
npm run build      # bundle src/ vers fr.quentinperou.zevent.sdPlugin/bin/plugin.js
npm run link       # crée le lien symbolique vers le dossier Plugins de Stream Deck
```

Ensuite, `npm run watch` reconstruit et redémarre le plugin à chaque
modification.

| Commande | Rôle |
| --- | --- |
| `npm run preview` | Écrit les visuels de touche en SVG dans `.preview/`, sur données réelles |
| `npm run check` | Vérifie le dossier `.sdPlugin` : point d'entrée, icônes déclarées, Property Inspectors |
| `npm run pack` | Produit le `.streamDeckPlugin` distribuable |

### Versions

La version vit dans `package.json`. `npm version patch` la propage au `Version`
du manifest, que Stream Deck attend en quatre segments, et au badge du README,
via `scripts/sync-version.mjs`. La CI refuse toute divergence
(`npm run sync-version -- --check`).

### Publication

Un tag `v*` poussé sur le dépôt déclenche l'empaquetage et crée la release
GitHub avec le `.streamDeckPlugin` en pièce jointe.

`Nodejs.Debug` doit rester absent du manifest, et le job de publication refuse
un tag tant que le champ y figure. Voir [CONTRIBUTING.md](CONTRIBUTING.md) pour
le détail.

## Contribuer

Bugs, idées et pull requests sont les bienvenus. Voir
[CONTRIBUTING.md](CONTRIBUTING.md), qui détaille la mise en route et les
contraintes du plugin qui ne se lisent pas dans le code.

## Licence

[MIT](LICENSE), en gardant la mention de copyright.

## Crédits

- **[QuentinPerou](https://github.com/quentinperou)** — conception, développement
- **Claude Code** (Anthropic) — développement assisté

Les données proviennent de l'[API publique du ZEvent](https://zevent.fr/api/).
Merci à l'équipe du ZEvent de l'exposer ouvertement, et aux streamers qui
remplissent ces cagnottes.

Ce plugin est un projet indépendant : il n'est ni affilié, ni approuvé, ni
soutenu par le ZEvent, Twitch ou Elgato.
