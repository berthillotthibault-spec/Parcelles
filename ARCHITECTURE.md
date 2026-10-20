# Architecture de Parcelles

Vue d'ensemble pour qui reprend le code. Tout ce qui suit renvoie à un fichier ou un symbole du dépôt ; en cas de doute, le code fait foi. Les commandes (`npm test`, `npm run serve`…) sont décrites dans `package.json`.

## 1. Principes

- PWA hors connexion d'abord, publiée telle quelle sur GitHub Pages : **le dépôt est le site**. Tous les fichiers servis sont à la racine, sans bundler ni framework : modules ES chargés directement par le navigateur.
- Aucune dépendance d'exécution. `node_modules/` (Playwright, http-server) sert uniquement aux outils et tests.
- Les bibliothèques tierces sont embarquées (`leaflet.min.js`, `xlsx.full.min.js`, `shp.min.js`, voir `VENDOR-README.md`) ; seul le SDK Firebase est chargé depuis gstatic, et seulement si la synchronisation est utilisée.

## 2. Carte des modules

| Rôle | Fichiers |
|---|---|
| Point d'entrée | `index.html` charge les bibliothèques globales, `config.js`, puis `app.js` comme module. |
| Orchestrateur | `app.js` : importe la plupart des modules, rend les écrans, porte le délégué de clics et le démarrage (`init`). |
| État | `state.js` (`emptyState`, `migrateData`, `Store`), `storage.js` (IndexedDB), `tab-coordinator.js` (onglets). |
| Outils communs | `utils.js` (`APP_VERSION`, `BUILD_ID`, `ENTITY_TYPES`, `uid`, dates), `ui.js` (`modal`, `toast`…), `safe-html.js`, `permissions.js`. |
| Synchronisation | `sync.js` (`SyncService`), `sync-merge.js` (fusion à trois voies), `live-sync.js` (temps réel), `sync-conflict*.js`, `sync-status*.js`. |
| Rendu | `render-scheduler.js` : seule la vue visible est redessinée, les autres sont marquées « à refaire ». |
| Carte | `map.js` (`ParcelMap`, Leaflet), `rpg.js` (couche PAC/RPG), `basemaps.js`. |
| Imports | `import-export.js`, avec `shapefile-fallback.js` et `zip-lite.js` en secours de `shp.min.js`. |
| Hors connexion | `sw.js` (service worker, liste `CORE`), `runtime.js` (enregistrement, `REQUIRED_ASSETS`). |
| Chargement différé | `lazy-modules.js` (`LAZY_MODULES`, `LAZY_ACTIONS`, `LAZY_TRIGGERS`, `createAppLoader`). |
| Actions et contexte | `actions.js` (registre `registerAction` / `runAction`), `app-context.js` (objet `ctx` partagé), `work-actions.js`, `parcel-actions.js`. |

### Écrans

Cinq onglets : Aujourd'hui (`today`), Carte (`map`), Parcelles (`parcels`), Travaux (`work`) et Plus, plus la fiche parcelle (`parcel`). `switchView()` change d'écran ; `renderAll()` redessine tout ; après une modification, `renderAfterStoreChange()` demande à `viewsForEvent()` (`render-scheduler.js`) quelles vues sont touchées par l'entité modifiée. Les écrans sont des chaînes HTML construites dans des fonctions `render*` / `open*`, toute valeur interpolée passant par `escapeHtml` (contrôlé par `test-safe-html.mjs`).

### Paires `foo.js` / `foo-ui.js`

Chaque fonctionnalité sépare :

- `foo.js` : logique pure, sans DOM, testée par `test-foo.mjs` (`node:test`), inscrit dans le script `test` de `package.json` ;
- `foo-ui.js` : une fabrique `createFooUI(deps)` qui reçoit ses dépendances (`store`, `state`, `modal`, `toast`…) et rend l'interface.

Exemples : `costs` / `costs-ui`, `grazing`, `public-works`, `measured-yield`, `compliance`.

### Modules différés

`app.js` dépasse son budget de taille ; les écrans secondaires ne sont donc pas importés statiquement. `LAZY_MODULES` (`lazy-modules.js`) associe une clé à un `import('./foo-ui.js')` littéral. Le chargeur créé par `createAppLoader` :

- `lazy.onLoad(clé, m => fooUI = m.createFooUI({...}))` : crée l'instance à l'arrivée du module (enregistré dans `init` d'`app.js`) ;
- `gateClicks` : un clic sur un `data-action` listé dans `LAZY_ACTIONS` (ou un sélecteur de `LAZY_TRIGGERS`) est retenu, le module chargé, puis le clic rejoué ;
- `lazy.wait(clés, réessai)` à l'ouverture d'un écran, `lazy.soon(clés, redessin)` pour une section d'écran déjà affiché, `lazy.run`, `lazy.need` ;
- `lazy.prefetch()` : préchargement un par un pendant les temps morts après le démarrage ;
- un échec d'import est oublié (nouvelle tentative possible, avec `?essai=n`) et signalé par un toast.

Un module de logique pure peut aussi être différé quand il ne sert qu'à un enregistrement, un import ou un outil (`mapRecords`, `integrations`, `measureLib`) : `(await lazy.load('clé')).f(…)` dans un `try`, ou `lazy.need` / `lazy.wait` puis `lazy.get('clé')`. C'est ainsi que le n° 147 a compensé ses nouveaux modules statiques : le graphe de démarrage garde le même nombre de modules.

`test-lazy-modules.mjs` vérifie qu'aucun module différé n'est atteint par les imports statiques d'`app.js`, que chaque module est rattaché à `app.js` et que chaque action de `LAZY_ACTIONS` a son gestionnaire `action==='…'`.

## 3. État et Store

- **Un seul objet d'état** (`emptyState()` dans `state.js`) : un tableau par type de `ENTITY_TYPES` (`utils.js`), plus `campagnes`, `preferences`, `metadata`, `queue` (file de sync) et `journal`. Chaque fiche porte `id`, `createdAt`, `updatedAt`, `version`, `source`, `sourceId` (`normalizeEntity`).
- **Persistance** : `storage.js`, base IndexedDB `parcelles-app` (magasins `app`, `blobs`, `backups`, `history`, `syncBase`). Clé `state` pour l'espace local, `state:workspace:<id>` pour une ferme du cloud (`Store.workspaceStorageKey`). Depuis le n° 137 (étape 2), l'état d'un espace est rangé par collection : `<clé>/meta` (format, liste des clés, révision) et `<clé>/c/<nom>` pour chaque clé de premier niveau (`storage.readState` / `writeState` / `deleteState`). L'ancienne forme (un seul objet sous `<clé>`) est lue en repli, puis retirée dans la transaction qui écrit la nouvelle forme (instantané « Avant mise à jour du format » conservé avant). En mémoire, l'état reste un seul objet ; sauvegardes et exports aussi.
- **Écritures sérialisées** : toute écriture passe par `Store.enqueueWrite`, qui enchaîne les opérations sur une seule promesse. API : `store.mutate(label, fn, options)`, `store.upsert(type, entity, {label})` (fusionne avec la fiche existante, valide, puis appelle `_mutate`), `upsertMany`.
- **Gardes** : `assertTabWritable()` (onglet en lecture seule ou données d'une version plus récente → `TabReadOnlyError` / `SchemaVersionError`), puis `writeGuard` (rôle, branché par `store.setWriteGuard` sur `sync.canWriteEntity`). En cas d'erreur, l'état précédent est restauré.
- **Onglets** (`tab-coordinator.js`) : un seul onglet tient le Web Lock `parcelles-writer` ; les autres passent en lecture seule (`store.setTabReadOnly`, bandeau « Utiliser ici »). Après chaque enregistrement, `store.onPersisted` diffuse un message sur `BroadcastChannel('parcelles-state')` ; les autres onglets appellent `store.reloadFromStorage()`.
- **Contrôle d'écriture concurrente** : `_writeState` écrit via `storage.writeState` (ou `setIfCurrent` sur l'ancienne forme), qui refuse si l'empreinte stockée (`stateStamp` : révision et date, lue dans la méta) a changé depuis la dernière lecture (`StaleStateError`). Vérification, collections modifiées (détectées par empreinte JSON, `planCollections`) et méta sont écrites dans une seule transaction readwrite. `_mutate` recharge alors et rejoue la modification une fois.
- **Sauvegardes** : `persist()` écrit chaque jour des copies `auto_daily`, `auto_weekly`, `auto_monthly` (élaguées à 7 / 4 / 3) si `preferences.autoBackup`, jamais en démonstration ; un échec n'annule pas l'écriture principale. `_backupBeforeMigration` garde une copie avant toute migration (`PRE_MIGRATION_BACKUP_LIMIT`).
- **Historique des fiches** : `_recordHistory`, écrit après un enregistrement réussi dans le magasin `history` ; une copie en mémoire sert à « Annuler ».
- **Migrations** : `APP_VERSION` (`utils.js`, actuellement 17) est la version du schéma. `migrateData()` applique les étapes `if(data.version<N)` et doit rester compatible avec les anciennes sauvegardes. Des données d'une version plus récente sont affichées sans jamais être réécrites (`schemaLock`, `isNewerSchema`).

## 4. Synchronisation Firebase

Facultative, avec la configuration publique de `config.js` et le SDK « compat » chargé à l'exécution.

- **Stockage distant** : `workspaces/{workspaceId}/data/{entityType}__{entityId}`. Seuls les types de `CLOUD_ENTITY_TYPES` sont envoyés (`ENTITY_TYPES` sans `syncConflicts`, `devices`, `members`, `assistantMessages`, `automationRuns`, `platformJobs`, `platformEvents`).
- **Encodage** : Firestore refuse les tableaux imbriqués (coordonnées GeoJSON). `encodeCloudPayload` les sérialise sous une étiquette et le document porte `payloadEncoding:'nested-arrays-v1'` ; `decodeCloudDocument` fait l'inverse. Les fiches locales gardent leur forme.
- **Heure serveur** : chaque écriture (`writeRemoteEntity`) ajoute `serverUpdatedAt = FieldValue.serverTimestamp()` ; les règles n'acceptent que `request.time`. Le pull suit ce curseur serveur (`metadata.syncServerCursors`), avec repli sur l'horloge de l'appareil (`updatedAt`, `syncCursors`) quand l'heure serveur est absente (`serverMillis`, `remoteChangedSinceLastPull`).
- **Cycle** (`SyncService.sync`) : `bootstrapWorkspace` → `pushPending` → `pullRemote` → pièces jointes. Les statuts de file sont appliqués par lots de `SYNC_WRITE_BATCH` ; un échec est retenté avec délai croissant (`syncRetryMax`, `syncRetryBaseSeconds`).
- **Conflits** : si la fiche distante a changé depuis le dernier pull et diffère de la locale, `suggestMerge` tente une fusion à trois voies (`sync-merge.js`, base = dernière version synchronisée dans le magasin `syncBase`). Fusion sûre et `syncAutoMerge` actif → écrite (`auto-merge`) ; sinon une fiche `syncConflicts` est créée et la personne choisit (`sync-conflict-ui.js`). Rien n'est écrasé en silence.
- **Temps réel** (`live-sync.js`) : au premier plan et en ligne, un `onSnapshot` suit les documents au-delà du curseur serveur ; ils passent par le même chemin que le pull.
- **Déclenchement** : `backgroundSync()` d'`app.js` (au démarrage, au retour en ligne, périodiquement quand la page est visible), jamais en lecture seule, sous verrou de version ou si `autoSync` est désactivé.
- **Sécurité** : `permissions.js` adapte l'interface aux rôles (`owner`, `manager`, `editor`, `operator`, `accountant`, `viewer`), mais la **vraie frontière** est `firestore.rules` / `storage.rules` : appartenance à l'espace, rôle par type d'entité (`canWriteData`), forme du document (`validEntityDoc`), `modifiedBy == request.auth.uid`. `tools/test-rules.mjs` les teste contre l'émulateur (hors `npm test`).

## 5. Service worker et `CORE`

- `sw.js` : `BUILD` nomme les caches (`parcelles-<portée>-static-<BUILD>`, `runtime-<BUILD>`, `tiles-v1` indépendant du build). À l'installation, `warmCore()` télécharge **toute** la liste `CORE` ; un seul fichier manquant fait échouer l'installation (mise à jour atomique). L'activation supprime les anciens caches.
- Navigation : `index.html` vient toujours du cache statique installé, pour que HTML et modules appartiennent à la même version. Fichiers `CORE` : cache d'abord ; autres fichiers du site et CDN de dépendances : `staleWhileRevalidate` ; tuiles IGN : cache `tiles-v1`.
- `runtime.js` enregistre `sw.js?build=<BUILD_ID>` et vérifie `REQUIRED_ASSETS`.
- **Tout fichier servi doit être dans `CORE`** (y compris les modules différés) : `test-static.mjs` parcourt le graphe d'imports statiques et dynamiques depuis `app.js` et échoue sinon. Il vérifie aussi que `BUILD`, `<meta name="parcelles-build">` et `BUILD_ID` sont identiques.

## 6. Cycle de vie d'une action

1. **Clic** : un seul écouteur `document.addEventListener('click', …)` dans `bindEvents` d'`app.js` repère le `[data-action]` le plus proche (et `data-view`, `data-work-tab`…). Si l'action dépend d'un module différé absent, `gateClicks` l'a déjà retenue en phase de capture et la rejouera après chargement.
2. **Répartition** : le délégué consulte d'abord le registre d'`actions.js` (`hasAction` / `runAction`), après la sortie des modes de carte et la navigation, dans le même `try` ; sinon une chaîne `if(action==='…')` d'`app.js`. Le gestionnaire lit `data-id` et ouvre un formulaire (`modal`) ou appelle directement le Store.
3. **Store** : `store.upsert` / `store.mutate` → file `enqueueWrite` → gardes (onglet, version, rôle) → modification → `metadata.revision += 1`.
4. **Journal** : `store.log` ajoute une entrée à `state.journal` (500 au plus, auteur si connu).
5. **File de sync** : `store.queue` ajoute ou remplace l'opération en attente pour cette fiche dans `state.queue`, si `preferences.syncEnabled` et hors démonstration.
6. **Enregistrement** : `persist()` → `writeState` (collections modifiées seulement) → annonce aux autres onglets → sauvegarde du jour → historique de la fiche.
7. **Rendu** : `store.notify` appelle l'abonné `store.subscribe` d'`app.js` → `renderAfterStoreChange` (vues touchées seulement) et `scheduleAutomationEvent`.
8. **Envoi** : au prochain `backgroundSync()`, `pushPending` envoie l'opération.

Une erreur remonte jusqu'au délégué : lecture seule et version plus récente donnent un toast avec l'action utile (« Utiliser ici », « Mettre à jour »), le reste passe par `friendlyErrors().show`.

## 7. Recettes

### Ajouter une entité

1. Ajouter le type dans `ENTITY_TYPES` (`utils.js`) et son tableau vide dans `emptyState()` (`state.js`). `ensureArrays()` crée le tableau manquant au chargement d'anciennes données : un ajout pur ne demande pas de migration. Toute transformation de données existantes demande en revanche d'augmenter `APP_VERSION` et d'ajouter une étape dans `migrateData()`.
2. Normalisation et validation propres au type, si besoin, dans `normalizeEntity` / `validate` (`state.js`).
3. Vues à redessiner : `viewsForEvent` et, si l'entité se dessine sur la carte, `mapSignature` (`render-scheduler.js`).
4. Synchronisation : le type est envoyé par défaut ; l'exclure de `CLOUD_ENTITY_TYPES` (`sync.js`) s'il reste local. Ouvrir les droits par rôle dans `permissions.js` **et** `canWriteData` de `firestore.rules`.
5. Noms de champs compatibles Firestore ; les tableaux imbriqués sont gérés par `encodeCloudPayload`.
6. Tests : logique pure dans `test-foo.mjs` ; `npm test`.

### Ajouter une action

1. Dans le module d'actions du domaine (`work-actions.js`, `parcel-actions.js`, ou un nouveau `foo-actions.js` de moins de 400 lignes) : `'mon-action'({id, control, event}) { … }`. Tout ce qui vient d'`app.js` passe par `ctx` (`app-context.js`) ; une valeur qui change pendant la session (store, carte, filtres) y est un accesseur, à ajouter dans `initContext({...})` au début d'`init`.
2. Un nouveau module d'actions est enregistré dans `init` par `registerActions(fooActions)`, ajouté à `ACTION_MODULES` de `test-actions.mjs`, à `CORE` (`sw.js`) et à `REQUIRED_ASSETS` (`runtime.js`).
3. Une action qui ouvre un module différé reste une branche d'`app.js` listée dans `LAZY_ACTIONS` (`gateClicks`) ; le registre n'en accepte pas.
4. `test-actions.mjs` vérifie que chaque `data-action` affiché (index.html et gabarits des fichiers servis) a un gestionnaire : registre, branche d'`app.js` ou écouteur d'un module. Une exception légitime s'inscrit dans `EXCEPTIONS`, avec sa raison.

### Ajouter un écran différé

1. `foo.js` (logique pure) + `test-foo.mjs`, ajouté au script `test` de `package.json`.
2. `foo-ui.js` exportant `createFooUI(deps)`.
3. `lazy-modules.js` : `foo: () => import('./foo-ui.js')` dans `LAZY_MODULES`, et les `data-action` qui l'ouvrent dans `LAZY_ACTIONS` (`...actions('foo', 'open-foo')`).
4. `app.js`, en quelques centaines d'octets : une variable `fooUI=null`, `lazy.onLoad('foo', m => fooUI = m.createFooUI({...}))` dans `init`, et `else if(action==='open-foo'){fooUI?.open();}` dans le délégué. Rien dans le premier rendu ; pour une section d'écran, `lazy.soon('foo', redessin)`.
5. `sw.js` : `'./foo.js'` et `'./foo-ui.js'` dans `CORE` (`test-static.mjs` échoue sinon).
6. `npm test` (`test-lazy-modules.mjs` contrôle le branchement).

### Publier

1. `npm run release -- X.Y.Z` (`tools/release.mjs`, idempotent ; `--dry-run` pour voir sans écrire) : écrit le build `AAAA.MM.JJ-vX.Y.Z` dans `sw.js`, `index.html` et `utils.js`, complète `CORE` et `REQUIRED_ASSETS` d'après le graphe d'imports, monte le `?v=` de chaque feuille CSS liée par `index.html` qui a changé depuis `origin/main` (une seule fois par publication), prépare les entrées de `CHANGELOG.md` et `whatsnew.json` (à compléter : « À COMPLÉTER »), puis lance `npm test`.
2. `--upload-dir` prépare en plus `~/Downloads/Parcelles-a-uploader-<build>/` et son ZIP : uniquement les fichiers qui diffèrent de la référence, sans les fichiers d'agents ni `node_modules/` (`UPLOAD_EXCLUDE`), avec la liste des fichiers à supprimer à la main sur GitHub.
3. Budget de performance : `npm run perf` (`tools/perf-budget.mjs`, Playwright, avec son propre serveur local) mesure la médiane de 3 chargements à froid (iPhone 14, processeur ×4, Fast 3G) et compare à `perf-budget.json` : temps jusqu'à `appReady`, octets JS initiaux, tâches longues et taille d'`app.js`. Code de sortie 1 en cas de dépassement ; `--update` réécrit le budget (mesure + 5 %). Ce contrôle n'est pas lancé par `release`.
4. La personne téléverse le dossier sur `main` (GitHub Pages). Les utilisateurs reçoivent la mise à jour via le service worker (voir `MISE_A_JOUR.md`).

### Lint et vérification de types

Outils de développement uniquement (devDependencies) : rien n'est chargé par l'application, rien n'entre dans `CORE` ni dans `REQUIRED_ASSETS`. Ils tournent dans la CI (`.github/workflows/tests.yml`) avant `npm test`, mais pas dans `npm test` lui-même, qui reste rapide.

- `npm run lint` : ESLint (`eslint.config.js`, flat config) sur les modules servis, `sw.js`, les tests et `tools/`. Base `@eslint/js` recommandée, globales `globals` du navigateur, du service worker ou de Node selon le fichier, plus les globales posées par les scripts vendus et `config.js` (`L`, `XLSX`, `shp`, `firebase`, `PARCELLES_*`). Ignorés : vendors (`*.min.js`), `support.js`, le prototype `Parcelles v3.dc.html`, `node_modules/`, `audit/`.
  - Erreurs bloquantes : `no-undef` (variable non déclarée = bug), `no-restricted-globals` (`name`, `status`, `event`… pris pour une variable alors que ce sont des globales du navigateur), `eqeqeq` en mode `smart` (seul `== null` admis), `no-implicit-globals`.
  - Avertissements : `no-unused-vars`, `no-shadow`, `prefer-const` et quelques règles de style du jeu recommandé. Leur nombre est figé par `--max-warnings` dans `package.json` : un nouvel avertissement casse la CI. Quand on en corrige, baisser le plafond d'autant.
- `npm run typecheck` : `tsc --noEmit -p jsconfig.json`. `checkJs` reste à `false` : seuls les fichiers de `jsconfig.json` marqués `// @ts-check` en première ligne sont vérifiés (`state.js`, `utils.js`, `history.js`, `personalization.js`, `grazing.js`, `yield.js`, `public-works.js`, `home-priorities.js`, `text-encoding.js`). Mode non strict : on vise les vraies incohérences (propriété inexistante, mauvais type d'argument), pas l'exhaustivité.
- `types.js` : `@typedef` JSDoc du schéma (`Parcelle`, `Intervention`, `Task`, `GrazingSession`, `Equipment`, `Observation`, `AppState`…) d'après `emptyState()` et `normalizeEntity()`. Aucun code exécuté et aucun import réel : on s'y réfère dans les commentaires par l'alias `parcelles/types` de `jsconfig.json` (`paths`), `/** @param {import('parcelles/types').Parcelle} parcel */`, ce qui en fait un fichier non servi. Ne pas écrire `import('./types.js')`, même en commentaire : le graphe d'imports de `tools/release.mjs` et de `test-static.mjs` le prendrait pour un vrai import et l'ajouterait à `CORE`. Changer le schéma (et `APP_VERSION`) demande de mettre ces types à jour ; `test-dev-tooling.mjs` vérifie que chaque clé d'`AppState` existe dans `emptyState()`.
- Ajouter un module pur à la vérification : `// @ts-check` en première ligne (en respectant sa fin de ligne), l'ajouter à `files` dans `jsconfig.json`, puis corriger par des annotations JSDoc, sans changer le comportement.

### Régression visuelle

`npm run visual` (`tests-visual/`, `@playwright/test`, configuration `tests-visual/playwright.config.mjs`) capture Aujourd'hui, Carte, Parcelles, Travaux, Plus, la fiche parcelle et le formulaire Travail dans quatre projets : `iphone14-clair`, `iphone14-sombre`, `bureau-clair`, `bureau-sombre` (1280×800). La configuration lance son propre serveur statique (`tests-visual/serveur.mjs`, port 8310, `PORT_VISUEL` pour en changer). Rendu déterministe : profil vierge semé par `tools/seed-demo.mjs` (le même jeu que `npm run audit`), horloge figée au 12 mai 2026 9 h 30 (`page.clock`), tuiles de carte remplacées par une image grise, tout autre accès extérieur coupé, service worker bloqué, `reducedMotion` et une feuille qui coupe animations, transitions et toasts. Tolérance : `maxDiffPixelRatio` 0,002.

- Références : `tests-visual/__screenshots__/<vue>-<projet>-<plateforme>.png`. Après un changement visuel voulu, `npm run visual:update`, vérifier les PNG modifiés, puis relancer `npm run visual` (deux fois au moins) avant de les livrer avec le changement. `test-static.mjs` n'admet dans `tests-visual/` que des `.mjs` et ces PNG ; `.resultats/` et `.rapport/` (sorties, diffs) sont ignorés par git.
- Plateformes : le rendu des polices diffère entre macOS (`-darwin`, générées en local) et Linux (`-linux`, CI). Le job `visuel` de `.github/workflows/tests.yml` reste non bloquant tant qu'aucune référence `-linux` n'est versionnée. Pour les créer : lancer le workflow, télécharger l'artefact `references-visuelles-linux` (captures écrites par Playwright faute de référence) et les copier dans `tests-visual/__screenshots__/` ; ou, en local avec Docker : `docker run --rm -v "$PWD":/w -w /w mcr.microsoft.com/playwright:v1.63.0-noble npx playwright test -c tests-visual/playwright.config.mjs --update-snapshots` (même version que `@playwright/test`). Dès qu'elles sont présentes, le job devient bloquant.
- Refonte CSS (n° 153) : ces captures, claires et sombres, servent de filet ; un écart attendu se régénère, un écart inattendu se corrige. Elles couvrent aussi le menu d'actions et l'édition d'une parcelle, Plus › Compte et Paramètres, Personnaliser, la recherche, la feuille Pourquoi ?, un toast, le panneau Couches de la carte et le mode gants (Aujourd'hui, Travaux).

### Feuilles de style et couches

Les feuilles sont liées par `index.html`, chacune avec un `?v=` (cache des navigateurs ; `npm run release` monte celui des feuilles modifiées). `tokens.css` est chargée la première : elle déclare l'ordre des couches `@layer reset, tokens, base, components, screens, features, theme, overrides;`. Une couche plus loin dans la liste l'emporte sur les précédentes quelle que soit la spécificité ; les styles hors couche (attribut `style`, `<style>` injecté) l'emportent sur toutes ; entre déclarations `!important`, l'ordre s'inverse (la couche la plus basse gagne).

| Couche | Contenu |
|---|---|
| `reset` | `leaflet.min.css` (enveloppé dans la couche, à refaire si Leaflet change), remises à zéro de `base.css` et `shell.css`, `html`/`body`/`a` du thème (en tête de `design-v3.css`) |
| `tokens` | `tokens.css` : toutes les variables de `:root`, une seule variante sombre (`:root.theme-dark`), contraste renforcé, Plein champ, cabine de nuit, palette fixe `--c-*` |
| `base` | le reste de `base.css` |
| `components` | `components.css`, `map.css`, `shell.css` |
| `screens` | `screens.css`, `responsive.css`, `accessibility.css` |
| `features` | `assistant-launcher.css`, `grazing.css`, `public-works.css`, `motion.css`, `personalization.css` |
| `theme` | `design-v3.css` |
| `overrides` | repli global « mouvement réduit » (`accessibility.css`) : en `!important` dans la dernière couche, il cède à tout `!important` explicite |

- Une règle d'une couche basse plus spécifique que celle de `design-v3.css` qu'elle contredit ne gagne plus : de telles dérogations sont regroupées en fin de feuille dans un bloc `@layer theme{…}` (ou `screens`) commenté « n° 153 : dérogations ». Pas de `@layer x{}` imbriqué dans une autre couche (il créerait une sous-couche).
- Couleurs : une nouvelle couleur passe par un jeton de `tokens.css` (sémantique avec sa valeur sombre, ou palette fixe `--c-*`). `test-css-layers.mjs` vérifie l'ordre des couches, qu'aucune règle n'est hors couche, les `?v=`, l'absence de variables globales hors de `tokens.css`, et un cliquet sur le nombre de couleurs hexadécimales hors `tokens.css` (`MAX_HEX`, à abaisser quand il baisse).
- Reste à faire : `design-v3.css` empile encore ses correctifs datés (v3.1 à v3.8, puis les lots numérotés) ; les regrouper par écran demande de déplacer des règles de même couche, donc de vérifier l'ordre à spécificité égale règle par règle.

## 8. Garde-fous à connaître

- Fins de ligne : LF partout depuis le n° 155 (`.gitattributes`, `.editorconfig`) ; `test-line-endings.mjs` échoue si un CRLF revient, par exemple après un téléversement par le web depuis Windows. Le commit de normalisation est listé dans `.git-blame-ignore-revs` (`git config blame.ignoreRevsFile .git-blame-ignore-revs`).
- Aucune donnée réelle d'exploitation dans le dépôt (public) : seules les fixtures anonymisées de `fixtures/` sont admises (`test-static.mjs`).
- Aucune clé privée dans un fichier servi ; les actions d'écriture de l'assistant distant (`remote-ai.js`) demandent toujours une confirmation.
- Interface, commentaires et messages de commit en français.
