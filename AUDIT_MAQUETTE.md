# Audit de conformité — maquette v3 (build 2026.10.06-v10.10.8-design3.7)

## Fichiers servis par GitHub Pages
- Pages publie la **racine à plat** de `main` (`index.html`, `app.js`, `design-v3.css`…). Il n'y a pas de workflow `.github/workflows`.
- `SOURCE_*` et `build-flat.mjs` sont **obsolètes** : le script attend des dossiers `js/`, `css/` et `icons/` qui n'existent plus. Les tests `test-v41/42/50.mjs` ciblent aussi `../js/`. Rien n'a été modifié dans ces fichiers.
- Incohérence corrigée : avant cette version, `sw.js` était en `…v10.10.7-design3.6` alors que `index.html` (meta) et `utils.js` (`BUILD_ID`, utilisé pour l'URL du service worker et le pied de « Plus ») étaient restés en `2026.10.05-v10.10.1`. Les trois sont désormais en `2026.10.06-v10.10.8-design3.7`.

## Méthode
- Audit à 390 × 844 dans un navigateur, avec un serveur local sans cache et des données de test : 4 parcelles, 3 travaux (dont un en retard), 2 tâches, un lot de 24 vaches au pré, un tracteur, un article de stock et la météo réelle d'Open-Meteo pour Montrevel. Ces données vivent dans un profil de navigateur de test, jamais dans les données de l'utilisateur.
- Node n'est pas installé sur ce poste : `node --check` et Playwright n'ont pas pu tourner. À la place :
  - chaque module modifié a été chargé avec `import()` dans le navigateur (aucune erreur de syntaxe) ;
  - `sw.js` a été analysé avec `new Function` ;
  - les contrôles de `tools/audit-maquette.mjs` ont été rejoués dans la page.
- Après correction : **49/49 contrôles OK**, aucune erreur JavaScript.

## Tableau écran par écran
✅ conforme · 🔧 corrigé dans cette version · ⚠️ écart restant

### Commun
| Point | État |
|---|---|
| Fond et `theme-color` `#f7f5f0`, Instrument Sans + Instrument Serif | ✅ |
| En-tête 56 px, logo, pastille de synchronisation, Recherche, Notifications avec badge | ✅ |
| 5 onglets, onglet actif sur pastille `#e3eee7` | ✅ |
| Bouton IA flottant sombre | ✅ |
| Build cohérent aux 3 endroits (`sw.js`, meta `index.html`, `utils.js`) | 🔧 |
| Mode sombre lisible | 🔧 Les cartes de résumé, les pastilles, la carte « Prochaine action », le panneau Couches et les pastilles d'échéance codés en blanc ont maintenant une version sombre. |

### Aujourd'hui (`renderToday`, `renderDailyBrief`, `renderWeatherCard`)
| Point | État |
|---|---|
| Date en majuscules, « Bonjour », phrase « N tâche(s) · M en retard » | ✅ |
| « + Travail » puis « Personnaliser » | 🔧 Ordre corrigé dans `index.html`. |
| Prochaine action : « Marquer comme fait » sur une ligne, « Carte » en largeur automatique | 🔧 |
| Résumé en 3 cartes cliquables | 🔧 Nouvelle action `today-summary-open` : « à faire » ouvre Travaux › Aujourd'hui, « en retard » ouvre Travaux › En retard, « animaux » ouvre Parcelles › Animaux au pré. |
| Raccourcis en pastilles juste sous le résumé | ✅ |
| Carte météo verte | 🔧 Lieu · ciel (code météo), température, Vent / Pluie 24 h / Humidité, 6 créneaux horaires, « Fenêtre de traitement favorable » affichée seulement si `weatherOpportunity` la fournit. Aucune valeur codée en dur. |
| « À faire maintenant » : case ronde de 28 px **à gauche** comme dans la maquette, pastille d'échéance, élément fait barré et conservé | 🔧 Une tâche affiche maintenant sa parcelle au lieu de « Tâche ». |
| Recocher un élément fait | 🔧 Nouvelles actions `reopen-work` et `reopen-task` : l'élément est remis « à faire », avec un toast « Annuler ». « Tâche terminée » propose aussi « Annuler ». |
| « Autres tâches » : bloc date (jour de la semaine + numéro) et case à cocher | 🔧 |
| « Activité récente » : liste sobre (heure ou date, puis type · parcelle) | 🔧 |
| « Bilan de la journée » : barre de progression faits/total, accord singulier/pluriel | 🔧 |
| Blocs masquables dans Personnaliser | ✅ Logique conservée. |

### Carte (`map.js`, `renderMapSheet`, `openMapTools`, `openMapLayers`)
| Point | État |
|---|---|
| Recherche flottante, Couches, ✓+, Me localiser, Outils vert | ✅ |
| Couleurs de culture de la table `CULT` | 🔧 `cultureColor` dans `map.js` utilisait une palette arbitraire. |
| Cadrage sur les parcelles à la première ouverture | 🔧 Auparavant, la carte restait sur le centre par défaut. |
| Fiche bas d'écran : pastille de culture 48 px, « Dernier travail », « Ouvrir la fiche » / « Nouveau travail » / Itinéraire | 🔧 Le bloc pâturage n'apparaît que s'il y a des animaux. Les boutons flottants se décalent selon la hauteur réelle de la fiche. |
| Sélection multiple : barre sombre « N parcelles · X ha », Infos / Tâche / Travail | 🔧 Mise en page sur deux lignes à 390 px (le texte débordait). Testé : « 2 parcelles · 19,5 ha ». |
| Outils : Distance, Surface, **Dessiner**, Repère | 🔧 « Dessiner » ajouté (action `draw-parcel` existante). |
| Couches sans bouton « Appliquer » : effet immédiat, RPG, Satellite/Plan, Noms des parcelles | ✅ Testé. Le titre passe en 20/700. |

### Parcelles (`renderParcels`)
| Point | État |
|---|---|
| « N parcelles · X ha · campagne AAAA » | 🔧 |
| Tuiles Importer / Assolement / Pâturage / Documents | 🔧 Plus de césure (« Assole-ment »). |
| Filtres en pastilles, bloc Assolement, « Tri : » cyclique | ✅ Testé : Nom → Surface ↓. |
| « Consultées récemment » | ✅ |
| Ligne de parcelle : pastille 44 px aux initiales (ou code/îlot), étoile favori, surface en grand à droite | 🔧 |

### Fiche parcelle
| Point | État |
|---|---|
| En-tête teinté, onglets existants conservés | ✅ |
| Barre fixe « Voir sur la carte » + « Nouveau travail » | 🔧 Observation et Animaux restent dans le menu « ··· » (ajoutés à `openParcelActions`). Aucune fonction n'est retirée. |
| Lot au pré : carte verte, nombre de jours en Serif 40, « Entrés le … », « Déplacer le lot » / « Sortir » ; sinon « Pas d'animaux sur cette parcelle » + « Mettre au pré » | 🔧 `grazing-ui.js` |

### Travaux
| Point | État |
|---|---|
| Titre, sous-ligne, sous-vues, filtres, bandeau de retard | ✅ |
| Ligne : heure et échéance à gauche, bordure colorée (vert / rouge / gris si fait), case à droite sur une ligne | 🔧 Une règle `#work-list` de `personalization.css` empilait les boutons. |
| Fait aujourd'hui : reste dans « Aujourd'hui » et ne passe dans « Historique » que le lendemain | 🔧 `matchesWorkTab` dans `home-priorities.js` (le test existant reste vrai). |
| Matériel : toucher un engin ouvre « Nouvel entretien » ; pastille Disponible / Entretien dû ; « Fiche » conservée | 🔧 |
| Nouvel entretien : Opération en pastilles (Vidange…Autre), « Champ obligatoire : Opération » | 🔧 Testé : la ligne affiche ensuite le dernier entretien. |

### Plus et modules
| Point | État |
|---|---|
| Carte Assistant IA avec une vraie parcelle (« Qu'est-ce que je sème sur Les Noues ? ») | 🔧 |
| En-tête Favoris + « Personnaliser », tuiles avec sous-titre | 🔧 Le titre « Toutes les fonctions » était coupé en deux lignes. |
| Pied « Parcelles 10.10 · build … » + mention hors connexion | 🔧 |
| Stocks : ligne « Nouvel article / Créer » + bouton principal « Mouvement de stock » (choix de l'article), type en pastilles | 🔧 |
| Assolement : bouton principal « Ajouter une rotation » (Parcelle *, Campagne en pastilles au format `2026/27`, Culture *) | 🔧 |
| Pilotage avancé : « Nouvelle mission » → `TASKDATA.XML` ISO 11783 | 🔧 Nouveau `missionIsoxml` dans `machine-export.js`, accessible par Plus › Planifier › « Nouvelle mission machine ». Il produit une PFD avec contour par parcelle, une TSK, une PDT, et une dose uniforme en DDI 0006, 0001 ou 000B. Testé : 150 kg/ha → 15000 mg/m². « Selon zones » renvoie vers les zones de modulation existantes. |
| Assistant : suggestions en pastilles, « Masquer l'assistant » | 🔧 |
| Aucun toast « bientôt disponible » | ✅ Vérifié par recherche dans le code. |
| Observations, Clients, Documents, Automatisations, Corbeille | ✅ Boutons déjà branchés. |

## Vérifications automatiques
- Syntaxe : `app.js`, `map.js`, `grazing-ui.js`, `home-priorities.js`, `machine-export.js`, `utils.js` et `sw.js` se chargent sans erreur.
- Actions `data-action` sans gestionnaire : **aucune**.
- ID utilisés par `$('#…')` et absents d'`index.html` : uniquement des éléments créés dans des modales (`#maintenance-form`, `#rotation-form`…). C'est normal.
- Précache `sw.js` : tous les fichiers référencés par `index.html` et tous les modules importés y figurent.

## Écarts restants et propositions
1. **Hors connexion et service worker non testés** : le navigateur intégré refuse l'enregistrement de tout service worker, y compris la version d'origine. → À vérifier sur téléphone après déploiement (fermer l'app puis la rouvrir deux fois).
2. **Calendrier, Chantiers et Tâches** s'ouvrent en feuilles modales, et non en sous-vues dans la page comme dans la maquette. → Possible prochaine étape : les intégrer dans `#view-work`.
3. **Formulaires** : seuls Entretien, Mouvement de stock, Rotation et Mission utilisent les pastilles et le message « Champ obligatoire ». Les autres (`openWorkForm`, `openTaskForm`…) gardent des `<select>` et `reportValidity`. → Réutiliser `bindChipChoices` formulaire par formulaire.
4. **« Parcelles affichées »** dans Outils reste un `<select>`, alors que la maquette utilise des pastilles.
5. **Vent sans direction** sur la carte météo : la requête Open-Meteo ne demande pas `wind_direction_10m`. → Ajouter ce paramètre à la requête dans `refreshWeather`.
6. **Tests Node** : `test-*.mjs` n'ont pas pu être lancés (Node absent). Les anciens `test-v41/42/50` ciblent `../js/` et sont obsolètes.
7. **Script Playwright** : `tools/audit-maquette.mjs` est prêt (`--seed` pour un profil vierge), mais n'a pas pu être lancé ici.
