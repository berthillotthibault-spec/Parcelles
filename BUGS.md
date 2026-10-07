# Bugs — fiabilisation 10.10.9 (2026-10-07)

Chasse menée sur la branche `fiabilisation-v10.10.9`, build de départ `2026.10.06-v10.10.8-design3.7`.

## Méthode

- **Profil de test.** Navigateur Playwright vierge (iPhone 14 et 1280 × 800, clair et sombre), avec un jeu de données semé :
  - 4 parcelles ;
  - travaux, dont un en retard ;
  - tâches ;
  - un lot de 24 vaches au pré ;
  - un engin, un article de stock et un client.

  Les données réelles de l'utilisateur n'ont jamais été touchées.
- **Vérification.** Chaque constat a été reproduit indépendamment par un second script, chargé de le réfuter, avant d'être corrigé.
- **Statut** : ✅ corrigé · ⏸ non corrigé (raison donnée) · ✖ réfuté (pas un bug).

## Bloquant

| # | Écran | Problème | Cause | Statut |
|---|---|---|---|---|
| B1 | Hors connexion | Le service worker ne s'installait pas sur un serveur HTTP/1.1 : les 104 téléchargements du précache expiraient (« Cache incomplet »). L'application ne fonctionnait pas hors ligne. | `sw.js` `warmCore` : les corps n'étaient lus qu'une fois toutes les réponses reçues, si bien que les 6 connexions restaient occupées. | ✅ |
| B2 | Carte › Outils | « Dessiner » ne faisait rien. | `draw-parcel` sans `data-id` : `startParcelDrawing(undefined)` sortait sans rien faire. | ✅ Le tracé est libre ; « Terminer » ouvre « Nouvelle parcelle » avec la surface calculée. |
| B3 | Fiche › Pâturage | Modifier ou déplacer un lot enregistré avec un effectif seul échouait (« La liste des animaux est invalide. »). | `grazing-ui.js` réutilisait `row.animals`, indéfini. | ✅ |

## Fonctionnel

| # | Écran | Problème | Statut |
|---|---|---|---|
| F1 | Aujourd'hui, Travaux | Un travail en retard coché disparaissait au lieu de rester barré « Fait », et partait directement dans l'Historique. | ✅ Les travaux clos sont rangés à leur date de réalisation (`workDate`, `matchesWorkTab`). |
| F2 | Aujourd'hui | Une tâche en retard cochée disparaissait. | ✅ « Fait aujourd'hui » se lit sur la dernière modification. |
| F3 | Aujourd'hui | Rouvrir un travail terminé le datait d'aujourd'hui : l'échéance d'origine était perdue. | ✅ `finish-work` garde l'échéance dans `plannedDate` (champ existant), `reopen-work` la rétablit. |
| F4 | Aujourd'hui | `reopen-work` et `reopen-task` remettaient toujours « À faire ». | ✅ Le statut d'avant (« En cours ») est rétabli s'il est connu dans la session. Sinon, c'est « À faire » : aucun champ n'est ajouté au schéma. |
| F5 | Fiche › Pâturage | « Déplacer le lot » réécrivait la parcelle du passage : l'historique de la parcelle d'origine et la date d'entrée étaient perdus. | ✅ Le lot sort à la date choisie et un nouveau passage commence sur la destination, avec retour arrière en cas d'échec. |
| F6 | Fiche parcelle | Après « Placer dans la corbeille », la fiche restait affichée avec des actions mortes. | ✅ Retour à la liste. |
| F7 | Parcelles | Le tri « Distance » sans GPS gardait l'ordre de création (`Infinity - Infinity = NaN`). | ✅ Tri par nom en départage, avec le message « Position inconnue ». |
| F8 | Matériel | « Dernier entretien » était faux quand deux entretiens tombaient le même jour. | ✅ Départage par le compteur, puis par l'ordre de saisie. |
| F9 | Stocks | Une sortie supérieure au disponible levait une promesse rejetée non gérée (erreur technique). | ✅ Le message s'affiche dans le formulaire. |
| F10 | Carte › Couches | L'interrupteur « Noms des parcelles » n'avait rien à afficher : aucune étiquette n'était créée. | ✅ |
| F11 | Ordinateur | Le bouton IA recouvrait le zoom de la carte. | ✅ |
| F12 | Mise à jour PWA | L'invite « Mettre à jour » disparaissait après 5 s. | ✅ Elle reste affichée jusqu'au choix. |

## Cohérence

| # | Écran | Problème | Statut |
|---|---|---|---|
| C1 | Aujourd'hui | « animaux au pré » comptait les parcelles archivées, que le filtre ouvert par la carte ne montre pas. | ✅ |
| C2 | Fiche › Pâturage | « Sortir » : aucune confirmation, et la liste globale s'ouvrait sans filtre. | ✅ Toast, et on reste sur la fiche. |
| C3 | Matériel | Après « Nouvel entretien » lancé depuis la liste, l'app ouvrait la fiche de l'engin ; « Annuler » fermait tout. | ✅ Retour à l'écran d'origine. |
| C4 | Parcelles | Campagne affichée « 2026 » au lieu de « 2026/27 ». | ✅ `campaignFor()`. Aucune saisie ne produit d'année seule : les rotations proposent 2026/27, 2027/28 et 2028/29. |
| C5 | Mission machine | Le TASKDATA.XML n'avait qu'une TSK, rattachée à la première parcelle. | ✅ Une TSK par parcelle ; « Selon zones » refuse plusieurs parcelles. |
| C6 | Carte | Le masquage des noms n'était pas réappliqué après rechargement (lu avant `store.init()`). | ✅ |
| C7 | Carte | Le tracé de mesure restait sur la carte sans moyen de l'effacer. | ✅ « Effacer » dans le toast ; une nouvelle mesure l'efface aussi. |

## Visuel et contraste

| # | Problème | Statut |
|---|---|---|
| V1 | Mode sombre : texte blanc sur les boutons principaux et sur « Outils », vert clair (2,35:1). | ✅ Jeton `--on-brand`, 6,8:1. |
| V2 | Mode sombre : « Légende · Culture » invisible (1,08:1). | ✅ |
| V3 | Mode sombre : boutons favori et « ··· » de la fiche presque invisibles. | ✅ |
| V4 | Mode sombre : libellés gris et filet du panneau Couches codés en dur. | ✅ |
| V5 | Libellés de la barre d'onglets sous 4,5:1. | ✅ 5,8:1 en clair, 7,1:1 en sombre. |
| V6 | Texte de 12 px en `--text-tertiary` (3:1). | ✅ `--text-secondary`. |
| V7 | Rouge « en retard » à 4,49:1. | ✅ `#a83c26`, 5,1:1. |
| V8 | Initiales des pastilles de culture peu lisibles. | ✅ |
| V9 | L'étoile favori de la fiche n'avait pas d'état visuel. | ✅ `aria-pressed`, étoile pleine. |
| V10 | Ordinateur : raccourcis d'Aujourd'hui coupés. | ✅ Passage à la ligne à partir de 1024 px. |

## Texte

| # | Problème | Statut |
|---|---|---|
| T1 | Le sous-titre d'Aujourd'hui comptait les travaux comme des « tâches ». | ✅ « 2 travaux et 1 tâche aujourd'hui ». |
| T2 | « 1 animaux au pré », « 0 parcelles ». | ✅ |
| T3 | « (s) » et « (aux) » dans 73 messages générés (« 2 travail(aux) », « ressource(s) … sont »). | ✅ Vrais accords, verbes compris. |
| T4 | `!==1 ? 's'` : en français, 0 prend le singulier. | ✅ 31 occurrences. |
| T5 | Message d'erreur RPG en anglais (« Failed to fetch »). | ✅ |
| T6 | Distance en km avec un point décimal ; surfaces de l'aperçu d'import « 5.7537323 ha ». | ✅ Format français. |

## Outillage et tests

| # | Problème | Statut |
|---|---|---|
| O1 | 8 fichiers `test-*.mjs` sur 12 importaient `../js/`, une arborescence qui n'existe plus. | ✅ Chemins corrigés à la racine. Les numéros de build et de format figés sont remplacés par des contrôles de forme, et l'assertion sur le libellé « Assistant 5.0 », retiré de l'interface, est supprimée. |
| O2 | `test-home-priorities.mjs` échouait entre minuit et 2 h : il calculait « aujourd'hui » en UTC. | ✅ `localDay()`. |
| O3 | `test-static.mjs` vérifiait l'ancienne arborescence `css/` et `js/`. | ✅ Réécrit : précache complet sur le graphe d'imports, build identique aux 3 endroits. |
| O4 | Fichiers `Export_Spécifique (SHP)…` vus comme non suivis sur macOS. | ✅ Réindexés en Unicode NFC, sans renommage. |
| O5 | `npm test` pointait vers `tests/` et `scripts/`, absents. | ✅ `npm test` lance `node --check` puis 13 fichiers de tests. |

## Constats réfutés

- **Barre d'assolement et filtres.** La barre résume l'exploitation entière, par conception, pas la liste filtrée.
- **Couche RPG non persistée.** Non reproduit : le réglage est bien conservé.
- **Gestionnaires `show-point` et `new-grazing` jamais déclenchés.** Ils sont appelés depuis des modules `*-ui.js` ou par la recherche.
- **Tâche future cochée qui « disparaît ».** Elle ne figurait pas dans la liste du jour.

## Parcours vérifiés sans anomalie

- **Création et persistance.** Créer un travail, une tâche, une observation, un client, un article de stock, un engin, une rotation, une parcelle ou un lot au pré, puis recharger : l'élément est toujours là.
- **Import et export.** Import SHP réel : 110 parcelles, 280,05 ha, Lambert-93, accents intacts. Exports JSON, ZIP complet, CSV et GeoJSON. Une sauvegarde JSON restaurée dans un profil vierge reprend des volumes identiques à la source.
- **Hors connexion.** 104 entrées en cache ; rechargement hors ligne avec `design-v3.css`, pastille « Hors connexion », les 5 vues sans erreur.
- **Mise à jour PWA.** Le nouveau BUILD s'installe ; « Mettre à jour » l'active puis recharge la page.
- **Exploration systématique.** 107 actions `data-action` cliquées sur les 5 vues et un niveau de modale : aucune erreur JavaScript.
- **Volume.** Avec 300 parcelles et 3 000 travaux : démarrage en 3,6 s (écran d'ouverture compris), chaque vue en 125 ms au plus, recherche en 16 ms.
