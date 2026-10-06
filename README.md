# Handoff : Parcelles — refonte mobile

## Vue d'ensemble
Refonte mobile complète de l'application Parcelles (gestion d'exploitation agricole : parcelles, carte, travaux, pâturage, stocks, traçabilité, assistant IA). Dépôt cible : `berthillotthibault-spec/Parcelles` (branche `main`), application vanilla JS (`index.html`, `app.js`, `map.css`, modules `*-ui.js`).

## À propos des fichiers
`Parcelles v3.dc.html` est une **référence de design en HTML** : un prototype qui montre l'aspect et le comportement attendus, pas du code de production. La tâche est de **recréer ce design dans le code existant** (vues `#view-*` de `index.html`, fonctions `open*Form()` de `app.js`, carte Leaflet existante) en suivant ses conventions. Ouvrir le fichier dans un navigateur (il charge `support.js` à côté) ; la logique est dans la classe `Component` en bas du fichier.

## Fidélité
**Haute fidélité.** Couleurs, typographie, espacements, rayons et interactions sont définitifs. Cadre de référence : iPhone 390 × 844.

## Écrans (attribut `data-screen-label` dans le prototype)
| Écran | Source dans le dépôt | Rôle |
| --- | --- | --- |
| Aujourd'hui | `#view-today`, `home-priorities.js` | Date, résumé du jour, prochaine tâche, carte météo verte, blocs personnalisables |
| Carte | `#view-map`, `application-map.js` | Carte plein écran, recherche flottante, couches, outils (mesure/dessin), sélection multiple, fiche bas d'écran |
| Parcelles | `#view-parcels` | Liste, filtres en pastilles, tri, répartition des cultures, « consultées récemment » |
| Fiche parcelle | `#view-parcel` | En-tête teinté de la couleur de culture, historique, pâturage, documents ; barre fixe « Voir sur la carte » / « Nouveau travail » |
| Travaux | `#view-work`, `field-ops.js` | Sous-vues tâches / chantiers / matériel ; filtres jour |
| Plus | `#view-more` | Recherche d'outils, favoris, catégories |
| Catégorie / modules | `#view-more-category` | Feuille modale par module (voir ci-dessous) |
| Assistant IA | `#assistant-dock`, `farm-agent.js` | Bouton flottant sombre en bas à droite, panneau de conversation |

### Structure commune
- Barre d'état 46 px, puis en-tête 56 px : logo 36 × 36 (rayon 11, fond `#286a4a`), « Parcelles » 15/700 + nom de l'exploitation 12 px `#5f6862` ; à droite une pastille de synchronisation (28 px, rayon 14), Recherche et Notifications (40 × 40, rayon 20, survol `#ebe8e1`, badge 16 px `#b4432c`).
- Contenu défilant : marge 4 px 20 px 100 px (la barre d'onglets reste dégagée).
- Titres de vue : Instrument Serif 44 px, interligne 1. Sur-titres : 13 px, 600, MAJUSCULES, espacement .06em, `#5f6862`.
- Cartes : fond `#fff`, rayon 22, bordure 1 px `#ebe8e1`, lignes 14 × 16 px séparées par `#f0ede7`.
- Bouton principal : hauteur 44–48, rayon = moitié de la hauteur, `#286a4a` / blanc, 14–15/600. Secondaire : blanc, bordure `#d9d5cc`.
- Feuilles flottantes sur la carte : `#fff`, rayon 24, ombre `0 10px 30px rgba(0,0,0,.2)`, 10 px des bords. Version sombre (outils, sélection multiple) : `#1d2420`, action d'accent `#8fd1a8` sur `#10261a`.

## Modules (Plus → feuille)
Chaque module affiche un sous-titre, des lignes (titre, détail, pastille d'état) et un bouton d'action. Correspondance avec `app.js` :
- Assolement → formulaire rotation (`openRotationForm`)
- Pâturage → entrée au pré (`grazing-ui.js openForm`) ; déplacement de lot depuis la fiche
- Observations → `openObservationForm`
- Travaux publics → `public-works-ui.js openForm`
- Stocks → mouvement (`openStockMovementForm`) + ligne « Nouvel article » (`openStockForm`)
- Matériel (onglet Travaux) → toucher un engin = nouvel entretien (`openMaintenanceForm`) ; « + » = `openEquipmentForm`
- Clients → `openClientForm` ; Documents → `openAttachmentForm` ; Automatisations → `openAutomationRuleForm`
- Pilotage → rapport imprimable ; Rapports → PDF / CSV / GeoJSON
- Pilotage avancé → « Nouvelle mission » : parcelles, opération, produit, dose, modulation → téléchargement `TASKDATA.XML` (ISO 11783, squelette PFD/TSK à compléter côté code) ; zones → carte ; campagne 2027 → rotation
- Intégrations → import de fichier ; Mes données → import (SHP/ZIP, GeoJSON, KML, CSV, Excel) et sauvegarde JSON
- Équipe → invitation d'un membre ; Paramètres ; Corbeille (vider)

## Interactions
- **Formulaires** : une feuille unique pilotée par `formDef(key)` (champs `text`, `area`, `chips` à choix unique, `multi`, `file`). Champs `*` obligatoires : message « Champ obligatoire : … » au-dessus du bouton. Pastilles : sélectionnée `#1d2420`/blanc, sinon blanc, bordure `#e3dfd7`.
- **Toasts** de confirmation après chaque enregistrement.
- **Carte** : toucher une parcelle → fiche en bas ; « ✓+ » active la sélection multiple → barre sombre (Infos / Tâche / Travail groupé). Outils : mesure de distance / surface avec relevé en Instrument Serif 28 px, « Annuler le point », « Quitter », « Terminer ».
- **Synchronisation** : la pastille passe par « À jour » / « Synchronisation… » / « Hors connexion ».
- **Persistance** : l'état du prototype est stocké en `localStorage` ; « Réinitialiser » dans Paramètres le vide.

## État (à mapper sur le `store` existant)
`tab`, `wview`, `detail`, `sheet`, `module`, `form {key, ctx, v}`, `tasks[]`, `extra{module: rows[]}`, `extraMat[]`, `maintDone{}`, `msel[]`, `multi`, `archived[]`, `trash[]`, `homeHide[]`, `sync`. Côté code réel : `store.upsert(...)` des collections existantes (`rotations`, `maintenanceRecords`, `stockItems`, `grazingSessions`, `observations`, `chantiers`, etc.).

## Design tokens
**Couleurs**
- Marque `#286a4a` · survol lien `#1d4f37` · accent sur fond sombre `#8fd1a8` / texte `#10261a`
- Encre `#1d2420` · texte secondaire `#5f6862`
- Fond app `#f7f5f0` · fond hors cadre `#e8e5de` · surface `#fff`
- Lignes / bordures `#ebe8e1`, `#efece6`, `#f0ede7`, `#e3dfd7`, `#d9d5cc` · fond survol / bouton neutre `#ebe8e1`, `#f1efe9`
- États : vert `#286a4a` sur `#e3eee7` · ambre `#8a5a12` sur `#f8eedb` · rouge `#b4432c` sur `#f7e3dd`
- Couleurs de culture : table `CULT` dans le prototype

**Typographie** — Instrument Sans (400/500/600/700) pour l'interface ; Instrument Serif pour les titres et les grands chiffres. Tailles : 44 (titres), 28 (relevés), 18 (titre de fiche), 16, 15 (corps), 14, 13 (secondaire), 12 (pastilles), 10 (badges).

**Rayons** — 52/42 (cadre), 26 (carte météo), 24 (feuilles), 22 (cartes), 18–23 (boutons pilules), 14 (vignettes), 11 (logo), 10 (pastilles).

**Ombres** — flottants carte `0 4px 16px rgba(0,0,0,.15)` ; feuilles `0 10px 30px rgba(0,0,0,.2)` ; bouton principal `0 6px 18px rgba(40,106,74,.4)`.

**Espacements** — marge latérale 20 px ; écarts 6 / 8 / 10 / 12 / 14 / 16 / 20 px.

## Assets
- Icônes : traits SVG 24 × 24 (stroke 1,9, extrémités arrondies) repris de l'application d'origine.
- Carte : Leaflet 1.9.4 (déjà utilisé dans le dépôt).
- Polices : Google Fonts (Instrument Sans, Instrument Serif).
- Aucune image bitmap.

## Fichiers
- `Parcelles v3.dc.html` — prototype de référence (gabarit + logique)
- `support.js` — moteur d'exécution du prototype (inutile en production)
