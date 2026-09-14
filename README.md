# Parcelles 5.0 — Multi-appareils & Intelligence

Parcelles 5.0 conserve toutes les fonctions de la 4.2 et ajoute une couche de collaboration et de continuité entre appareils, tout en restant **100 % utilisable localement sans compte**.

## Nouveautés principales

- schéma métier **v7** ;
- espace cloud par exploitation ;
- authentification Firebase facultative ;
- rôles **Propriétaire / Collaborateur / Lecture seule** ;
- invitations par code limitées à une adresse email ;
- liste des appareils connectés et renommage de l'appareil courant ;
- synchronisation bidirectionnelle par entité ;
- file hors connexion compacte ;
- protection des conflits de première synchronisation ;
- résolution manuelle des conflits local/cloud ;
- amorçage automatique du cloud lorsqu'un nouvel espace est vide ;
- synchronisation facultative des photos et documents via Firebase Storage ;
- historique d'activité cloud ;
- permissions appliquées côté application et prévues côté règles Firebase ;
- assistant 5.0 avec historique local facultatif ;
- contexte conversationnel réduit pour l'IA distante ;
- actions distantes filtrées par liste blanche et **toujours confirmées avant écriture** ;
- lecture vocale de la dernière réponse ;
- commandes vocales activables/désactivables ;
- diagnostic enrichi avec l'état cloud.

## Fonctionnement sans cloud

Aucun compte n'est obligatoire. Avec `syncEnabled = false`, Parcelles continue de fonctionner comme avant : IndexedDB, PWA, import, sauvegardes, terrain, météo, pilotage, stocks et rapports restent disponibles.

## Build

- Build : `2026.09.14-v5.0.0`
- Schéma métier : `7`

## Déploiement GitHub Pages

Pour le site public, utilisez uniquement le contenu de `dist-github-root` ou l'archive `Parcelles_5_0_GitHub.zip` générée à la fin du release check.

`config.js` est inclus avec une valeur cloud nulle. Si vous activez Firebase, remplacez uniquement le contenu de ce fichier par la configuration publique de votre projet.

## Vérifications

```bash
npm test
npm run preflight
npm run build:flat
# ou
npm run release:check
```

La fixture SHP réelle de **110 parcelles** reste un test obligatoire de non-régression.

## Cloud

La configuration cloud est documentée dans `CLOUD_SETUP.md`. Les règles proposées se trouvent dans `firebase/`.

Ne placez jamais une clé privée Gemini/OpenAI dans GitHub Pages.
