# Changelog

## 10.10.1 · design v3 — 2026-10-06

- refonte visuelle mobile selon `design_handoff_parcelles_mobile` : nouvelle feuille `design-v3.css`, chargée en dernier, sans changement de logique ;
- polices Instrument Sans / Instrument Serif, fond crème, cartes arrondies, pastilles sombres pour les filtres et onglets ;
- en-tête avec pastille de synchronisation (À jour / à synchroniser / Hors connexion) ; en-tête masqué sur la carte et la fiche parcelle ;
- Aujourd’hui : carte « prochaine action » sombre, chiffres du jour, carte météo verte ; fiche parcelle teintée de la couleur de culture ;
- carte : recherche et boutons flottants, bouton Outils vert, panneaux de mesure/dessin et sélection multiple sombres ; bouton IA sombre en bas à droite ;
- couleurs de culture du design (blé, colza, maïs, orge, prairies, tournesol, jachère) ; cache hors connexion mis à jour.

## 7.1.8 — 2026-10-03

- ouverture animée avec le symbole Parcelles et suivi des quatre étapes réelles du démarrage, sans attente artificielle ;
- apparitions progressives des écrans, fenêtres, notifications et indicateurs métier ; retours visuels sur les boutons et la navigation ;
- indicateur commun pour les imports, la météo, les sauvegardes, la synchronisation manuelle et l’assistant distant ; progression mesurée du chargement RPG lorsque le total est connu ;
- gestion des opérations simultanées, des erreurs et de l’annulation RPG ; délai maximal de 15 secondes pour la météo ;
- respect de la réduction des mouvements, y compris si la préférence change pendant une animation ; ressources incluses dans le cache hors connexion ;
- dix tests ciblés exécutables à la racine publiée : `node test-motion.mjs` ou `npm run test:motion`. Les anciens scripts de test ciblent l’arborescence source `tests/` et `js/`, absente de cette publication à plat.

## 4.0.0 — 2026-09-14

- architecture de publication canonique et diagnostic de déploiement ;
- service worker versionné et mise à jour contrôlée ;
- navigation quotidienne Aujourd'hui / Carte / Parcelles / Travaux / Plus ;
- import SHP renforcé, fallback interne, ZIP interne, mapping et rollback d'import ;
- sauvegardes automatiques quotidiennes/hebdomadaires/mensuelles et ZIP complet ;
- carte plein écran, satellite, mesures, GPS, dessin de parcelle, points et tournée ;
- tâches et calendrier mois/semaine/liste ;
- météo détaillée et météo par parcelle ;
- assolement, rotations, pilotage et économie ;
- matériel avec historique d'entretien ;
- pâturage, clients/prestation, observations et stocks ;
- photos/documents liés aux parcelles et travaux ;
- recherche globale, assistant local, voix et endpoint IA facultatif ;
- accessibilité, thème sombre, contraste renforcé et responsive ;
- rapports exploitation/parcelle/client/matériel.

## 4.1 — Qualité & Terrain

- Build `2026.09.14-v4.1.0`.
- Raccourcis intelligents sur l'écran Aujourd'hui à partir des travaux récents.
- Recherche globale améliorée : catégories, requêtes comme `parcelles maïs > 5`, tolérance à une petite faute.
- Résultats de recherche regroupés par Parcelles, Travaux, Tâches, Matériel, Clients, etc.
- Parcelles enrichies avec prochain/dernier travail et distance GPS quand disponible.
- Nouveau tri Parcelles par distance.
- Mode terrain : plus aucun déclenchement automatique du GPS à l'ouverture.
- Mode Plein soleil dans le mode terrain.
- Mode terrain utilisable depuis une parcelle sélectionnée même avant activation du GPS.
- Diagnostic transformé en écran Santé de l'application.
- Journal local des 100 dernières erreurs JavaScript.
- État déploiement, IndexedDB, service worker, sauvegardes, stockage et erreurs regroupés dans le diagnostic.
- Nouveau test automatisé `test-v41.mjs`.

## 4.2 — Pilotage

- Build `2026.09.14-v4.2.0`.
- Schéma de données v6.
- Économie désormais historisable par campagne avec `economicsByCampaign`.
- Nouveau moteur `pilotage.js` : produit brut, charges, marge totale et €/ha par culture/parcelle.
- Comparaison de campagnes sans réutiliser silencieusement les données économiques de la campagne courante.
- Stocks : catégorie, prix unitaire, valorisation et seuils.
- Nouveau journal de mouvements de stock : entrée, sortie et ajustement.
- Prix moyen pondéré sur les entrées de stock.
- Sortie de stock impossible si quantité insuffisante, avec rollback atomique.
- Planificateur de campagne en série depuis l'écran Assolement.
- Rapports imprimables/PDF Pilotage et Stocks.
- Coûts matériel enrichis : travaux + entretiens + assurance + amortissement.
- Correction de la lecture des champs `duration`/`fuel` dans les statistiques et rapports.
- Nouveaux tests automatisés `test-v42.mjs`.

## 5.0 — Multi-appareils & Intelligence

- Build `2026.09.14-v5.0.0`.
- Schéma de données v7.
- Nouveaux états locaux : `members`, `assistantMessages`, `devices`.
- Nouvelle entrée **Compte & équipe**.
- Authentification Firebase Email/Password facultative.
- Exploitations cloud indépendantes et sélection d'espace de travail.
- Rôles Propriétaire / Collaborateur / Lecture seule.
- Permissions locales cohérentes avec les rôles cloud.
- Invitations par code liées à une adresse email et à un rôle.
- Liste des membres et changement de rôle par le propriétaire.
- Appareils enregistrés, dernière présence et renommage de l'appareil courant.
- Synchronisation bidirectionnelle par entité.
- Amorçage automatique d'un espace cloud vide avec les données locales existantes.
- Conflit créé lors d'une première synchronisation si local/cloud diffèrent au lieu d'écraser silencieusement.
- Curseur de synchronisation indépendant par exploitation cloud.
- Synchronisation facultative des blobs photos/documents avec Firebase Storage.
- Journal d'activité cloud.
- Synchronisation automatique périodique lorsque l'application est ouverte et connectée.
- Assistant 5.0 avec historique local facultatif.
- Contexte conversationnel réduit envoyé au Worker IA facultatif.
- Liste blanche d'actions IA distantes.
- Confirmation obligatoire avant toute création de travail ou tâche via IA.
- Lecture vocale de la dernière réponse et option d'activation des commandes vocales.
- Diagnostic enrichi avec rôle, compte, appareil et espace cloud.
- Règles Firestore/Storage fournies dans `firebase/`.
- Nouveau test automatisé `test-v50.mjs`.
