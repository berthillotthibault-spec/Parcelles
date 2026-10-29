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

Navigation (n° 160, `nav-model.js`) : barre du bas Accueil (`today`) · Carte (`map`) · **+** (`new-work`, saisie en 3 étapes de `quick-work-ui.js`) · Parcelles (`parcels`) · Troupeau (`herd`, `herd-home-ui.js`) ; sans module Élevage, le 5e onglet redevient Travaux (`work`). La barre latérale ajoute Planning (`work`) et Modules. L'ancien onglet « Plus » est devenu le menu profil (`profile-menu.js` / `profile-menu-ui.js`, feuille ouverte par la pastille de profil, `data-view="more"` et `#more`) ; `#view-more` et `#more/<catégorie>` restent joignables. plus la fiche parcelle (`parcel`). `switchView()` change d'écran ; `renderAll()` redessine tout ; après une modification, `renderAfterStoreChange()` demande à `viewsForEvent()` (`render-scheduler.js`) quelles vues sont touchées par l'entité modifiée. Les écrans sont des chaînes HTML construites dans des fonctions `render*` / `open*`, toute valeur interpolée passant par `escapeHtml` (contrôlé par `test-safe-html.mjs`).

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

### Messages, SMS et e-mails (v13)

`messaging.js` (logique pure, `test-messaging.mjs`) et `messaging-ui.js` (module différé, clé `messaging`, boutons `[data-msg]` de `LAZY_TRIGGERS`, entrée Menu › Planifier › Messages & SMS).

- **Données** : aucun nouveau type d'entité. Contacts libres (`farmKind:'contact'` : téléphones E.164, e-mail, rôle, canal préféré, groupes, noms de « Confier à… » rattachés, accord SMS / e-mail daté), modèles personnalisés (`'messageTemplate'`, une copie d'un modèle fourni garde sa `key`) et journal (`'message'` : canal, destinataires, objet, extrait, statut `prepare` / `envoye` / `echec` / `attente` / `programme`, contexte lié) sont des `integrationImports`. Le carnet unifié (`messageContacts`) y ajoute les clients et les membres du cloud. `team-work.js` (`knownPeople`) propose les contacts de l'équipe dans « Confier à… ».
- **Envoi par le téléphone** (par défaut, sans serveur) : liens `sms:` (iOS `sms:n1,n2&body=`, Android `sms:n1;n2?body=`, ailleurs RFC 5724), `https://wa.me/`, `mailto:` (copie cachée si le texte n'est pas personnalisé) ou `navigator.share` avec fichiers. L'application ne sait pas si le message est parti : elle note « Préparé » et demande « Envoyé ? ».
- **Passerelle facultative** : URL HTTPS + jeton saisis dans Messages › Réglages d'envoi (préférences `messagingGatewayEnabled`, `messagingGatewayUrl` ; jeton dans `localStorage` par espace, hors sauvegardes). `POST /send` avec une clé d'idempotence par destinataire (`messageIdempotencyKey`) ; hors connexion ou erreur 429 / 5xx, le message reste « En attente » et la file de cet appareil (`outboxDue`) est réessayée au retour du réseau, avec délai croissant. Exemple de Worker : `tools/worker-messages.example.js` (non servi : Brevo, indications OVH / Twilio, empreintes de jetons, débit, validation, journal sans contenu, envoi programmé chiffré au repos et Cron Trigger).
- **Confier** : menu d’un travail › « Confier à… » (`data-team="assign"` avec `data-kind` / `data-id`, travail présélectionné) ou Consignes & heures › « Confier un travail ».
- **Planning du jour** : `dayPlanText` / `dayPlanMessage` (heure, parcelle, surface, produit et dose, matériel, consigne, lien de position) ; « Envoyer le planning » depuis Travaux, l'accueil, Consignes & heures et la fiche d'un contact (un SMS prérempli par personne) ; « Envoyer la consigne » d'un travail ou d'une tâche confiés. Rappel du soir (`planReminderEnabled`, `planReminderHour`) : proposé à la première ouverture après l'heure, ou à l'heure dite si l'application est ouverte (notification si autorisée). Un envoi réellement automatique, application fermée, passe par la passerelle (« Programmer » le planning de demain) et son Cron Trigger.
- **Rôles** : lecteur, aucun envoi ; opérateur terrain, envoie (planning, consignes) et ne voit que ses propres messages, jamais ceux de la facturation, sans modifier carnet ni modèles ; comptabilité, écrit le journal (envoi des factures) mais pas le carnet ; gestion (propriétaire, responsable, collaborateur), tout. Même découpage en écriture dans `permissions.js` (`DIRECTORY_KINDS`, `MESSAGE_LOG_KINDS`, `messageWritable`) et `firestore.rules` (`directoryKind`, `messageLogKind`, `messageWritable`, testés par `tools/test-rules.mjs`) : l'opérateur terrain n'écrit que ses propres messages (`authorUid`) et jamais un message de la facturation (`finance`) ; la comptabilité écrit ses messages et ceux de la facturation. En lecture, la restriction n'est qu'un masquage à l'écran (`canSeeMessage`), comme pour les factures : la règle de `data` reste « membre de l'exploitation », car la synchronisation lit toute la collection et Firestore refuserait la requête entière au premier document interdit. Tout membre synchronisé reçoit donc le journal complet dans son appareil.
- **RGPD** : une opposition notée sur un contact bloque l'envoi par ce canal ; rien ne part sans geste de l'utilisateur ou passerelle configurée ; les deux circuits figurent dans la page Confidentialité (`privacy.js`).
- **Facturation** : `BILLING_TEMPLATE_KEYS` donne les modèles d'envoi et de relance (variables `{numero}`, `{montant}`, `{echeance}`, `{lien}`) ; la facturation obtient le composeur par `messaging()` du contexte d'`app.js` (`initContext`, `app-context.js`), qui charge le module à la demande, puis appelle `openComposer({recipients, channel, subject, body, files, context, templateKey})`, qui résout `{sent, channel, recordId}` à la fermeture.

## 3. État et Store

- **Un seul objet d'état** (`emptyState()` dans `state.js`) : un tableau par type de `ENTITY_TYPES` (`utils.js`), plus `campagnes`, `preferences`, `metadata`, `queue` (file de sync) et `journal`. Chaque fiche porte `id`, `createdAt`, `updatedAt`, `version`, `source`, `sourceId` (`normalizeEntity`).
- **Persistance** : `storage.js`, base IndexedDB `parcelles-app` (magasins `app`, `blobs`, `backups`, `history`, `syncBase`). Clé `state` pour l'espace local, `state:workspace:<id>` pour une ferme du cloud (`Store.workspaceStorageKey`). Depuis le n° 137 (étape 2), l'état d'un espace est rangé par collection : `<clé>/meta` (format, liste des clés, révision) et `<clé>/c/<nom>` pour chaque clé de premier niveau (`storage.readState` / `writeState` / `deleteState`). L'ancienne forme (un seul objet sous `<clé>`) est lue en repli, puis retirée dans la transaction qui écrit la nouvelle forme (instantané « Avant mise à jour du format » conservé avant). En mémoire, l'état reste un seul objet ; sauvegardes et exports aussi.
- **Écritures sérialisées** : toute écriture passe par `Store.enqueueWrite`, qui enchaîne les opérations sur une seule promesse. API : `store.mutate(label, fn, options)`, `store.upsert(type, entity, {label})` (fusionne avec la fiche existante, valide, puis appelle `_mutate`), `upsertMany`.
- **Gardes** : `assertTabWritable()` (onglet en lecture seule ou données d'une version plus récente → `TabReadOnlyError` / `SchemaVersionError`), puis `writeGuard` (rôle, branché par `store.setWriteGuard` sur `sync.canWriteEntity`). En cas d'erreur, l'état précédent est restauré.
- **Onglets** (`tab-coordinator.js`) : un seul onglet tient le Web Lock `parcelles-writer` ; les autres passent en lecture seule (`store.setTabReadOnly`, bandeau « Utiliser ici »). Après chaque enregistrement, `store.onPersisted` diffuse un message sur `BroadcastChannel('parcelles-state')` ; les autres onglets appellent `store.reloadFromStorage()`.
- **Contrôle d'écriture concurrente** : `_writeState` écrit via `storage.writeState` (ou `setIfCurrent` sur l'ancienne forme), qui refuse si l'empreinte stockée (`stateStamp` : révision et date, lue dans la méta) a changé depuis la dernière lecture (`StaleStateError`). Vérification, collections modifiées (détectées par empreinte JSON, `planCollections`) et méta sont écrites dans une seule transaction readwrite. `_mutate` recharge alors et rejoue la modification une fois.
- **Sauvegardes** : `persist()` écrit chaque jour des copies `auto_daily`, `auto_weekly`, `auto_monthly` (élaguées à 7 / 4 / 3) si `preferences.autoBackup`, jamais en démonstration ; un échec n'annule pas l'écriture principale. `_backupBeforeMigration` garde une copie avant toute migration (`PRE_MIGRATION_BACKUP_LIMIT`).
- **Historique des fiches** : `_recordHistory`, écrit après un enregistrement réussi dans le magasin `history` ; une copie en mémoire sert à « Annuler ».
- **Migrations** : `APP_VERSION` (`utils.js`, actuellement 18) est la version du schéma. `migrateData()` applique les étapes `if(data.version<N)` et doit rester compatible avec les anciennes sauvegardes. Des données d'une version plus récente sont affichées sans jamais être réécrites (`schemaLock`, `isNewerSchema`).

## 4. Synchronisation Firebase

Facultative, avec la configuration publique de `config.js` et le SDK « compat » chargé à l'exécution.

- **Stockage distant** : `workspaces/{workspaceId}/data/{entityType}__{entityId}`. Seuls les types de `CLOUD_ENTITY_TYPES` sont envoyés (`ENTITY_TYPES` sans `syncConflicts`, `devices`, `members`, `assistantMessages`, `automationRuns`, `platformJobs`, `platformEvents`).
- **Encodage** : Firestore refuse les tableaux imbriqués (coordonnées GeoJSON). `encodeCloudPayload` les sérialise sous une étiquette et le document porte `payloadEncoding:'nested-arrays-v1'` ; `decodeCloudDocument` fait l'inverse. Les fiches locales gardent leur forme.
- **Heure serveur** : chaque écriture (`writeRemoteEntity`) ajoute `serverUpdatedAt = FieldValue.serverTimestamp()` ; les règles n'acceptent que `request.time`. Le pull suit ce curseur serveur (`metadata.syncServerCursors`), avec repli sur l'horloge de l'appareil (`updatedAt`, `syncCursors`) quand l'heure serveur est absente (`serverMillis`, `remoteChangedSinceLastPull`).
- **Cycle** (`SyncService.sync`) : `bootstrapWorkspace` → `pushPending` → `pullRemote` → pièces jointes. Les statuts de file sont appliqués par lots de `SYNC_WRITE_BATCH` ; un échec est retenté avec délai croissant (`syncRetryMax`, `syncRetryBaseSeconds`).
- **Conflits** : si la fiche distante a changé depuis le dernier pull et diffère de la locale, `suggestMerge` tente une fusion à trois voies (`sync-merge.js`, base = dernière version synchronisée dans le magasin `syncBase`). Fusion sûre et `syncAutoMerge` actif → écrite (`auto-merge`) ; sinon une fiche `syncConflicts` est créée et la personne choisit (`sync-conflict-ui.js`). Rien n'est écrasé en silence.
- **Temps réel** (`live-sync.js`) : au premier plan et en ligne, un `onSnapshot` suit les documents au-delà du curseur serveur ; ils passent par le même chemin que le pull.
- **Déclenchement** : `backgroundSync()` d'`app.js` (au démarrage, au retour en ligne, périodiquement quand la page est visible), jamais en lecture seule, sous verrou de version ou si `autoSync` est désactivé.
- **Sécurité** : `permissions.js` adapte l'interface aux rôles (`owner`, `manager`, `editor`, `operator`, `accountant`, `advisor`, `viewer`), mais la **vraie frontière** est `firestore.rules` / `storage.rules` : appartenance à l'espace, rôle par type d'entité (`canWriteData`), forme du document (`validEntityDoc`), `modifiedBy == request.auth.uid`. `tools/test-rules.mjs` les teste contre l'émulateur (hors `npm test`).
- **Lecture : aucun cloisonnement par rôle, sauf pour le conseiller / technicien (n° 129, §11).** Les rôles ne limitent que l'**écriture**. Tout membre d'un espace lit toutes ses fiches (`allow read: if isMember(workspaceId)`), et la synchronisation les copie dans l'IndexedDB de son appareil. Cela vaut aussi pour les factures et devis (noms, adresses, SIREN, e-mails des clients, montants), le carnet de contacts (téléphones, consentements) et le texte de tous les messages envoyés. Masquer la facturation au lecteur et à l'opérateur terrain (`canSeeBilling`), ou limiter le journal de l'opérateur à ses propres messages, reste un confort d'interface : ce n'est pas une confidentialité. Une sauvegarde JSON ou un accès direct au SDK les révèle. N'inviter dans un espace que des personnes autorisées à voir ces données. Un vrai cloisonnement demanderait une collection ou un préfixe à part, avec une lecture filtrée par rôle dans les règles et dans le pull.

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
3. Budget de performance : `npm run perf` (`tools/perf-budget.mjs`, Playwright, avec son propre serveur local) mesure la médiane de 3 chargements à froid (iPhone 14, processeur ×4, Fast 3G) et compare à `perf-budget.json` : temps jusqu'à `appReady`, octets JS initiaux, tâches longues et taille d'`app.js`. Il rapporte aussi, sans bloquer, la part de JS chargé mais jamais exécuté au démarrage (couverture CDP `Profiler.startPreciseCoverage`, sur un chargement supplémentaire non ralenti). Code de sortie 1 en cas de dépassement ; `--update` réécrit le budget (mesure + 5 %), `--measured` rafraîchit seulement la section `measured`. Ce contrôle n'est pas lancé par `release`, mais par le job « perf » de la CI (non bloquant, tableau dans le résumé de l'Action).
4. La personne téléverse le dossier sur `main` (GitHub Pages). Les utilisateurs reçoivent la mise à jour via le service worker (voir `MISE_A_JOUR.md`).
5. Vérification minimale après publication, dans une fenêtre privée : l'écran Aujourd'hui est stylé, le statut réseau ne reste pas sur « Initialisation », la Carte s'ouvre, `Menu › Mes données › Diagnostic` indique que le déploiement est correct, un import SHP s'analyse, et l'application reste consultable hors connexion une fois les ressources installées. En cas de cache incohérent : Diagnostic › Nettoyer le cache.

### Lint et vérification de types

Outils de développement uniquement (devDependencies) : rien n'est chargé par l'application, rien n'entre dans `CORE` ni dans `REQUIRED_ASSETS`. Ils tournent dans la CI (`.github/workflows/tests.yml`) avant `npm test`, mais pas dans `npm test` lui-même, qui reste rapide.

- `npm run lint` : ESLint (`eslint.config.js`, flat config) sur les modules servis, `sw.js`, les tests et `tools/`. Base `@eslint/js` recommandée, globales `globals` du navigateur, du service worker ou de Node selon le fichier, plus les globales posées par les scripts vendus et `config.js` (`L`, `XLSX`, `shp`, `firebase`, `PARCELLES_*`). Ignorés : vendors (`*.min.js`), `support.js`, le prototype `Parcelles v3.dc.html`, `node_modules/`, `audit/`.
  - Erreurs bloquantes : `no-undef` (variable non déclarée = bug), `no-restricted-globals` (`name`, `status`, `event`… pris pour une variable alors que ce sont des globales du navigateur), `eqeqeq` en mode `smart` (seul `== null` admis), `no-implicit-globals`.
  - Avertissements : `no-unused-vars`, `no-shadow`, `prefer-const` et quelques règles de style du jeu recommandé. Leur nombre est figé par `--max-warnings` dans `package.json` : un nouvel avertissement casse la CI. Quand on en corrige, baisser le plafond d'autant.
  - `no-restricted-syntax` (n° 152, avertissement) : signale `` innerHTML = `…${x}…` `` (et `outerHTML`) écrit en gabarit littéral brut. Le gabarit étiqueté `` html`…` `` de `safe-html.js` n'est pas signalé. Son introduction a ajouté 77 avertissements sur le code existant : le plafond est passé de 162 à 239 (160 + 77, marge de 2 inchangée). Chaque écran migré vers `html` doit faire baisser ce plafond.
- `npm run typecheck` : `tsc --noEmit -p jsconfig.json`. `checkJs` reste à `false` : seuls les fichiers de `jsconfig.json` marqués `// @ts-check` en première ligne sont vérifiés (`state.js`, `utils.js`, `history.js`, `personalization.js`, `grazing.js`, `yield.js`, `public-works.js`, `home-priorities.js`, `text-encoding.js`). Mode non strict : on vise les vraies incohérences (propriété inexistante, mauvais type d'argument), pas l'exhaustivité.
- `types.js` : `@typedef` JSDoc du schéma (`Parcelle`, `Intervention`, `Task`, `GrazingSession`, `Equipment`, `Observation`, `AppState`…) d'après `emptyState()` et `normalizeEntity()`. Aucun code exécuté et aucun import réel : on s'y réfère dans les commentaires par l'alias `parcelles/types` de `jsconfig.json` (`paths`), `/** @param {import('parcelles/types').Parcelle} parcel */`, ce qui en fait un fichier non servi. Ne pas écrire `import('./types.js')`, même en commentaire : le graphe d'imports de `tools/release.mjs` et de `test-static.mjs` le prendrait pour un vrai import et l'ajouterait à `CORE`. Changer le schéma (et `APP_VERSION`) demande de mettre ces types à jour ; `test-dev-tooling.mjs` vérifie que chaque clé d'`AppState` existe dans `emptyState()`.
- Ajouter un module pur à la vérification : `// @ts-check` en première ligne (en respectant sa fin de ligne), l'ajouter à `files` dans `jsconfig.json`, puis corriger par des annotations JSDoc, sans changer le comportement.

### Régression visuelle

`npm run visual` (`tests-visual/`, `@playwright/test`, configuration `tests-visual/playwright.config.mjs`) capture Aujourd'hui, Carte, Parcelles, Travaux, Plus, la fiche parcelle et le formulaire Travail dans quatre projets : `iphone14-clair`, `iphone14-sombre`, `bureau-clair`, `bureau-sombre` (1280×800). La configuration lance son propre serveur statique (`tests-visual/serveur.mjs`, port 8310, `PORT_VISUEL` pour en changer). Rendu déterministe : profil vierge semé par `tools/seed-demo.mjs` (le même jeu que `npm run audit`), horloge figée au 12 mai 2026 9 h 30 (`page.clock`), tuiles de carte remplacées par une image grise, tout autre accès extérieur coupé, service worker bloqué, `reducedMotion` et une feuille qui coupe animations, transitions et toasts. Tolérance : `maxDiffPixelRatio` 0,002.

- Références : `tests-visual/__screenshots__/<vue>-<projet>-<plateforme>.png`. Après un changement visuel voulu, `npm run visual:update`, vérifier les PNG modifiés, puis relancer `npm run visual` (deux fois au moins) avant de les livrer avec le changement. `test-static.mjs` n'admet dans `tests-visual/` que des `.mjs` et ces PNG ; `.resultats/` et `.rapport/` (sorties, diffs) sont ignorés par git.
- Plateformes : le rendu des polices diffère entre macOS (`-darwin`, générées en local) et Linux (`-linux`, CI). Le job `visuel` de `.github/workflows/tests.yml` reste non bloquant tant qu'aucune référence `-linux` n'est versionnée. Pour les créer : lancer le workflow, télécharger l'artefact `references-visuelles-linux` (captures écrites par Playwright faute de référence) et les copier dans `tests-visual/__screenshots__/` ; ou, en local avec Docker : `docker run --rm -v "$PWD":/w -w /w mcr.microsoft.com/playwright:v1.63.0-noble npx playwright test -c tests-visual/playwright.config.mjs --update-snapshots` (même version que `@playwright/test`). Dès qu'elles sont présentes, le job devient bloquant.
- Refonte CSS (n° 153) : ces captures, claires et sombres, servent de filet ; un écart attendu se régénère, un écart inattendu se corrige. Elles couvrent aussi le menu d'actions et l'édition d'une parcelle, Menu › Compte et Paramètres, Personnaliser, la recherche, la feuille Pourquoi ?, un toast, le panneau Couches de la carte et le mode gants (Aujourd'hui, Travaux).

### Feuilles de style et couches

Les feuilles sont liées par `index.html`, chacune avec un `?v=` (cache des navigateurs ; `npm run release` monte celui des feuilles modifiées). `tokens.css` est chargée la première : elle déclare l'ordre des couches `@layer reset, tokens, base, components, screens, features, theme, overrides;`. Une couche plus loin dans la liste l'emporte sur les précédentes quelle que soit la spécificité ; les styles hors couche (attribut `style`, `<style>` injecté) l'emportent sur toutes ; entre déclarations `!important`, l'ordre s'inverse (la couche la plus basse gagne).

Exception : les feuilles d'écrans différés (`billing-docs.css`, `billing-hub.css`) ne sont pas dans `index.html`, pour ne pas bloquer le premier rendu. `lazy-styles.js` les liste avec leur `?v=` (`LAZY_SHEETS`, monté par `npm run release` comme ceux d'`index.html`) ; `loadSheet(file)` insère le `<link>` une seule fois, à leur ancienne place (avant `design-v3.css`, dans l'ordre de `LAZY_SHEETS`) : même couche, même rang dans la cascade. Le module de l'écran attend la feuille par un `await` de premier niveau (au plus 2,5 s) : `lazy.load` ne le livre qu'une fois la feuille appliquée, sans écran non stylé. Ces feuilles ne contiennent que des classes `bd-`/`bh-` de leurs écrans ; ce qu'affichent l'accueil et la fiche client (carte des factures en retard, bloc Facturation, `.is-late`) est dans `personalization.css` (`test-css-layers.mjs`). Elles restent dans `CORE` et `REQUIRED_ASSETS`.

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
- `design-v3.css` : les correctifs v3.1 à v3.8 sont rangés sous l'écran qu'ils corrigent (Aujourd'hui, Parcelles, Fiche parcelle, Travaux, Plus, Feuilles, Carte), après la section de base de cet écran et dans leur ordre d'origine ; les lots numérotés (n° …) restent à la suite, un par fonction. Déplacer une règle de la même couche peut changer le gagnant à spécificité égale : vérifier l'ordre (conflits potentiels) et comparer les styles calculés avant et après, à zéro écart.

## 8. Garde-fous à connaître

- Fins de ligne : LF partout depuis le n° 155 (`.gitattributes`, `.editorconfig`) ; `test-line-endings.mjs` échoue si un CRLF revient, par exemple après un téléversement par le web depuis Windows. Le commit de normalisation est listé dans `.git-blame-ignore-revs` (`git config blame.ignoreRevsFile .git-blame-ignore-revs`).
- Aucune donnée réelle d'exploitation dans le dépôt (public) : seules les fixtures anonymisées de `fixtures/` sont admises (`test-static.mjs`).
- Aucune clé privée dans un fichier servi ; les actions d'écriture de l'assistant distant (`remote-ai.js`) demandent toujours une confirmation.
- Interface, commentaires et messages de commit en français.

## 9. Facturation (vague 13)

### Modules

| Fichier | Rôle | Chargement |
|---|---|---|
| `invoices-core.js` | Noyau du premier rendu : soldes et statuts (factures en retard), prestations à facturer, montant d'une ligne et d'un document | statique (accueil, carte de campagne) : n'importe que `farm-memory.js` et `farm-records.js` |
| `invoices.js` | Moteur : types de documents, lignes, totaux, statuts, soldes, numérotation, mentions, émission, paiements, avoirs, impression A4 ; réexporte le noyau | à la demande (écrans de facturation, trésorerie, exports) : il n'importe **aucun** `billing-*.js` |
| `billing.js` | Devis (acceptation, refus), acomptes, facture de solde, duplication, catalogue, récurrences, relances, journal des envois, report de trop-perçu | à la demande |
| `billing-insights.js` | Tableau de bord, balance âgée, DSO, relances dues, prévision par semaine, prix suggéré, oublis, doublons, clients à risque, saisie rapide | à la demande |
| `billing-export.js` | Factur-X (XML CII EN 16931) et son contrôle, journal façon FEC lettré, CSV détaillé, QR de virement SEPA (`qr.js`) | à la demande |
| `billing-messages.js` | `documentMessage(state, doc, {purpose})` → `{subject, body, recipients, context, templateKey, attachmentName, amountDue}` pour `messaging-ui.js` (`openComposer`) | à la demande |
| `invoices-ui.js` | Ancien écran (factures et avoirs) : `open`, `prepare` et `settings` relaient vers le centre Facturation ; `legacyOpen`, `legacyPrepare`, `legacySettings` restent en repli | `import()` d'`app.js` |
| `billing-docs-ui.js` | Documents (chantier A) : `createBillingDocsUI(host)` → `{openDocument, openNew, openList, openPayment, openSend}`, listes par type, délégué `[data-bdoc]` | clé `billingDocs` |
| `billing-docs-editor.js`, `billing-docs-actions.js` | Éditeur de brouillon ; fiche d’un document émis et actions selon l’état (importés par `billing-docs-ui.js`) | avec `billingDocs` |
| `billing-docs-view.js` | Fonctions de vue pures (listes, filtres, actions possibles, frise, éditeur, clients, conformité), `test-billing-docs.mjs` | avec `billingDocs` |
| `billing-hub.js` | Vues pures du centre Facturation : tableau de bord filtré, graphiques SVG, « À faire », fiche client, catalogue (CSV), récurrences, réglages (`sectionValues`, aperçus) | à la demande |
| `billing-hub-ui.js` (+ `billing-hub-catalog-ui.js`, `billing-hub-settings-ui.js`, `billing-hub.css`) | Centre Facturation, `createBillingHubUI(host)` → `{open(tab), openSettings(section)}` | clé lazy `billingHub` |
| `lazy-styles.js` | `LAZY_SHEETS` (`billing-docs.css`, `billing-hub.css` et leur `?v=`), `loadSheet(file)` : feuille liée à la première ouverture de l'écran, attendue par `billing-docs-ui.js` et `billing-hub-ui.js` | avec `billingDocs` ou `billingHub` |

Tous les nouveaux fichiers sont dans `CORE` (`sw.js`) et `REQUIRED_ASSETS` (`runtime.js`). Tests : `test-invoices.mjs` (historique), `test-billing.mjs` et `test-billing-docs.mjs` ; parcours et captures dans `tests-visual/facturation-documents.spec.mjs`.

### Documents : listes, éditeur et actions (chantier A)

- **Entrées** : boutons `[data-bdoc]` (déclencheur de `LAZY_TRIGGERS`, comme `[data-msg]`) : fiche client d’`app.js` (« Documents », « Devis »), tableau de bord de la facturation (chantier B, qui appelle `lazy.load('billingDocs')` puis les fonctions ci-dessus). Le module n’appelle le tableau de bord que par `lazy.load('billingHub')` puis `open(tab)` (`dashboard`, `settings`, `catalog`) ; sans lui, message « écran indisponible ». `host` est facultatif : ce qui manque (store, modal, toast, lazy, messaging) est lu dans `app-context.js`.
- **Listes** : un type par onglet (devis, factures, acomptes, avoirs, pro forma, tout), recherche (numéro, client, objet, désignation, montant), filtres (statut calculé par `docStatus`, client, période, montant TTC), tri, reste dû, deux actions rapides par ligne, saisie rapide (`parseQuickEntry`) qui ouvre un brouillon avec les lignes proposées à valider.
- **Éditeur** : l’état `ed` est la source de vérité ; enregistrement automatique (`saveDraft`, 700 ms après la dernière saisie, à la fermeture, en arrière-plan) et copie de sécurité dans `form-drafts.js` tant que l’enregistrement n’a pas réussi (client non choisi, erreur, version changée) : « Reprendre la saisie » à la réouverture. Un document neuf n’est écrit qu’une fois le client choisi. Client par recherche floue (fautes, initiales, SIREN, e-mail ; `fuzzyClients`) ou création rapide avec les champs de facturation (`siren`, `vatNumber`, `kind`, `billingAddress`, `deliveryAddress`, `billingEmail`, `paymentDays`, `discountPct` sur la fiche `clients`, aussi éditables dans le formulaire client d’`app.js`) ; un document neuf reprend l’échéance, la remise et l’adresse de livraison de la fiche (`clientTerms`). Lignes libres, catalogue (prix du client), travaux non facturés (`billableItems`), sections, sous-totaux, commentaires, remise et TVA par ligne (motif obligatoire à 0 %), déplacement par glisser-déposer, boutons ou Alt + flèche, duplication et suppression (avec Annuler). Totaux par taux, conformité (`complianceReport` + `emissionProblems`) avec un bouton « Corriger » par point, prix suggéré (`suggestPrice`) discret.
- **Aperçu** : `invoiceHtmlWithQr` dans un panneau (iframe `sandbox`, sans script) sur un écran d’au moins 1 180 px, en plein écran (`showPrintable`) ailleurs ; impression et PDF par `openPrintable` (repli iframe iOS) et `invoice-pdf.js`.
- **Actions** : émettre (numéro annoncé par `allocateNumber`, immutabilité rappelée), envoyer (`documentMessage` → `openComposer` avec le PDF et, pour une pièce comptable, le Factur-X joints, puis `logSent` avec le `recordId`), encaisser (partiel, moyen, référence ; trop-perçu reporté par `transferOverpayment` ou remboursé), relancer (niveau proposé par le retard et les relances faites ; `recordReminder`, ou « Consigner sans message »), avoir total ou partiel (lignes et quantités), accepter ou refuser un devis, acompte en % ou en montant, facture ou facture de solde (`convertQuote`), dupliquer vers un autre type, Factur-X contrôlé (`validateFacturX`), écritures de la pièce, frise de l’historique. Paiement, acceptation, refus, suppression d’un brouillon ou d’une ligne : toast « Annuler ».
- **Limites** : un lien `mailto:` ne transporte pas de pièce jointe ; le composeur propose le partage natif avec fichiers quand l’appareil le permet, sinon le PDF et le XML se téléchargent pour être joints à la main. Le XML Factur-X n’est pas incorporé au PDF (pas de PDF/A-3).

### Données (aucun changement de schéma, `APP_VERSION` 17)

Tout est enregistrement générique `integrationImports` distingué par `farmKind` :

- `invoice` : facture (`docType` absent ou `facture`), facture d'acompte (`acompte`), avoir (`avoir`) ;
- `quote` : devis (`devis`) et facture pro forma (`proforma`, jamais numérotée, sans valeur comptable) ;
- `billingItem` : article ou prestation du catalogue (code, désignation, unité, prix HT, TVA, catégorie, compte, archivé, prix par client) ;
- `billingSchedule` : modèle de facturation récurrente (client, lignes, périodicité, prochaine date, fin, mode brouillon ou émission).

Ces quatre `farmKind` sont dans `FINANCE_KINDS` (`permissions.js`) et `financeKind()` (`firestore.rules`, cas dans `tools/test-rules.mjs`) : comptabilité, responsable, collaborateur et propriétaire écrivent ; opérateur terrain et lecteur non.

Champs d'un document : `clientId`, `docType`, `number`, `status`, `issueDate`, `dueDate`, `deliveryDate`, `validUntil`, `lines[]`, `totals{ht, tva, ttc, byRate, parTaux, …}`, `payments[]`, `installments[]`, `reminders[]`, `sentLog[]` (date, canal, destinataires, objet, `recordId` du message), `discount`, `shipping`, `quoteId`/`quoteNumber`, `creditOf`/`creditOfNumber`, `scheduleId`, `seller` (identité figée), `legalMentions`, `fingerprint`. Une ligne a un `kind` : `item` (défaut), `section`, `subtotal`, `comment`, `deduction` (acompte déduit). Les documents anciens (sans `docType`, `payments`, `parTaux`, empreinte) restent lus tels quels : `paidAt` seul vaut paiement intégral, `totals.byRate` suffit.

### Règles du moteur

- Montants : ligne arrondie au centime (remise de ligne comprise), puis base et TVA par taux ; remise globale (% ou montant) répartie au prorata des taux ; frais de port ou de déplacement avec leur taux ; l'arrondi est symétrique (un avoir total est l'opposé exact de sa facture).
- Statuts : devis `brouillon` → `envoye` → `accepte` (date, signataire, « Bon pour accord ») / `refuse` / `expire` (calculé) → `converti` ; facture `brouillon` → `emise` / `partielle` / `retard` / `payee` / `annulee` (avoir total), tous calculés à partir des paiements, échéances et avoirs.
- Émission : contrôles bloquants (`emissionProblems`, `complianceReport`), numéro attribué **seulement** à ce moment, identité du vendeur et mentions figées, empreinte `fingerprint`. Ensuite seuls paiements, relances, envois et réponse au devis changent (`patchEmitted`) ; on corrige par un avoir (total ou partiel, plafonné au reste de la facture). Un brouillon se supprime, jamais une pièce émise.
- Acomptes : % ou montant TTC d'un devis accepté, ventilés par taux ; leur somme ne dépasse jamais le devis. La facture de solde reprend le devis et déduit les acomptes émis (lignes `deduction`, par taux). Chaque déduction reprend exactement la base HT de l'acompte, et sa TVA (`vatAmount`) ; la TVA du solde vaut, par taux, « TVA du devis − TVA des acomptes » (`documentTotals`, tant que l'écart avec base × taux reste d'un centime, règle BR-S-09). Acomptes + solde = HT, TVA et TTC du devis, sans retoucher aucun montant déduit.
- Numérotation : format à jetons `{PREFIXE}{AAAA}{AA}{MM}{NUM:n}` par type (facture, acompte et avoir partagent la série `F` par défaut ; devis en `D`), remise à zéro annuelle ou non, numéro de départ ; contrôle des doublons et des trous (`numberingIssues`) et de la chronologie (pas d'émission datée avant la dernière pièce de la série). L'attribution se fait dans la file d'écriture du Store (`enqueueWrite`) : deux émissions simultanées sur un appareil reçoivent deux numéros successifs. **Limite** : deux appareils hors ligne peuvent attribuer le même numéro ; la synchronisation garde les deux pièces et `numberingIssues` signale le doublon (corriger par un avoir et une nouvelle émission).
- Récurrences : une occurrence échue prépare un brouillon (`generateFromSchedule`) ; l'émission n'a lieu qu'avec `generateAndIssue(…, {confirmEmission:true})`, appelé après confirmation de l'utilisateur. Fin de mois respectée (31 janvier + 1 mois = 28 février).
- Intelligence locale : tout résultat (prix suggéré, saisie rapide, doublon, risque) est une proposition ; rien n'est écrit sans action de l'utilisateur.
- Dates : jours civils en heure locale (`isoDay`), jamais `toISOString`.
- Trésorerie (n° 86) : `treasuryFlows` lit `expectedReceipts` (reste dû par échéance, paiements partiels et avoirs déduits).

### Exports

- Factur-X : `facturXml()` produit le XML CII du profil EN 16931 (types 380, 386, 381 ; avoir en montants positifs ; catégories S, Z, E, AE, K, G, O avec motif VATEX ; cadre B1/S1/M1 ; notes REG, PMD, PMT, AAB) ; `validateFacturX()` vérifie l'ordre des éléments, les champs obligatoires et les règles de calcul BR-CO-10 à 16. **Limite** : pas d'incorporation dans un PDF/A-3 (conversion PDF/A trop lourde sans bibliothèque) ; on remet le PDF lisible et le XML en deux fichiers.
- Journal façon FEC (`billingJournal`, `billingFecText`) : ventes (411 / 706x / 44571), acomptes en 4191, acomptes déduits, remises (709), frais (7085), encaissements (512, 530, compensation en OD), lettrage des pièces soldées. Ce n'est pas le FEC légal de l'entreprise.
- CSV détaillé par ligne (`billingLinesCsv`), aligné sur les comptes de `accounting-export.js`.
- QR de virement SEPA (EPC069-12) sur le reste dû, si l'IBAN est valide et que le modèle l'active (`template.showQr`).

### Mentions légales couvertes

| Mention | Où |
|---|---|
| Identité du vendeur : raison sociale, forme, capital, RCS, adresse, SIRET, TVA intracommunautaire | paramètres validés (`validateSettings`), avertissements capital et RCS (`complianceReport`), figée à l'émission |
| Client : nom, adresse de facturation ; SIREN et TVA pour un professionnel (SIREN obligatoire au 1er septembre 2027) | `emissionProblems`, `complianceReport` |
| Numéro unique, chronologique, sans trou, par série | `allocateNumber`, `numberingIssues`, contrôle de chronologie |
| Date d'émission, date de livraison ou de prestation, échéance (ou échéancier) | `validateDraft`, `complianceReport` |
| Pénalités de retard, indemnité forfaitaire de 40 € (professionnel), escompte | `legalMentions`, erreur si 40 € absent pour un client professionnel |
| Franchise en base (art. 293 B du CGI), autoliquidation, exonérations (art. 261, 262 I, 262 ter I), hors champ, remboursement forfaitaire agricole (art. 298 quater) | `VAT_EXEMPTIONS`, régime du vendeur, motif obligatoire pour une ligne à 0 % |
| TVA sur les débits (option) ou les encaissements | phrase « Opération : … », code de date d'exigibilité Factur-X |
| Réforme 2026-2027 : SIREN du client, adresse de livraison si différente, nature biens / services / mixte, option sur les débits | `legalMentions`, `facturXml` |
| Devis : durée de validité, « Bon pour accord », acceptation datée et signée | `invoiceView`, `acceptQuote` |
| Pro forma : sans valeur comptable | `legalMentions` |

Non couvert : signature électronique qualifiée, transmission par une plateforme agréée (PA), archivage à valeur probante, e-reporting.

### Centre Facturation (`billingHub`)

- **Entrée unique** : Menu › Gestion › Facturation, recherche (`spotlight.js`), carte d'accueil, fiche client et actions historiques `open-invoices` / `new-invoice` (listées dans `LAZY_ACTIONS`). `open('reglages:modele')`, `open('clients:<id>')`, `open('catalogue:nouveau')` ouvrent directement une section.
- **Onglets** : Suivi (CA facturé et encaissé sur 12 mois, en-cours, retard, balance âgée, DSO, transformation des devis, meilleurs clients, prévision par semaine reliée à la trésorerie n° 86 ; filtres période et client ; chaque indicateur ouvre la liste filtrée), À faire (relances groupées par client avec `groupedReminderMessage` → `openComposer` → `recordReminder`, devis à suivre, prestations non facturées, récurrences dues, doublons, clients à risque), Clients, Catalogue (import CSV/XLSX : `catalogImportPreview` puis `importCatalogItems`, annulable par `undoCatalogImport`), Récurrences (brouillon seulement ; émission après clic explicite), Réglages (sections enregistrées une à une par `saveSettings(…, {partial: true})`, aperçu du modèle dans un cadre isolé sans script).
- **Documents** : liste, fiche, saisie, paiement et envoi appartiennent à l'écran des documents (clé `billingDocs`, `createBillingDocsUI`) ; le centre ne l'appelle que par `openList(docType, {filter})`, `openDocument`, `openNew`, `openPayment`, `openSend`. Filtre transmis : `{clientId, clientName, status ('due' | 'retard' | 'payee'), aged, from, to}`. Si le module manque, un toast « Écran des documents indisponible » propose l'ancien écran.
- **Rôles** : lecteur et opérateur terrain ne voient ni le centre, ni la carte d'accueil, ni la section de la fiche client (ni ses boutons « Documents », « Devis », « Facturer ») ; écriture selon `FINANCE_KINDS`. Ce masquage n'est pas une confidentialité : en espace cloud, tout membre lit et synchronise les documents de facturation (§4, « Lecture »).
- **Carte d'accueil** : `billingHomeModel` (`campaign-card.js`), préférence `billingHomeCard` (Réglages › Accueil, ou « Masquer » avec Annuler).
- **Clients** : « + Nouveau client » ouvre la fiche de facturation de l’écran des documents (`openClientForm`), puis la fiche du client dans le centre.
- **Exports comptables** (carte du Suivi) : journal des ventes façon FEC (`billingFecText`) et lignes facturées en CSV (`billingLinesCsv`) sur la période du tableau de bord, tous clients ; lien vers « Pour mon comptable » (`accounting-export-ui.js`). Un acompte déduit solde le compte 4191 au montant HT exact de l’acompte, et les ventes égalent les lignes de la pièce. Une facture de solde émise avant ce correctif peut porter une déduction décalée d’un centime : cet écart reste en ventes, comme sur la pièce.
- **Réglages et rôles** : les réglages de facturation (`exploitation.invoicing`) sont propres à l’appareil (l’objet `exploitation` n’est pas synchronisé) ; la comptabilité peut les modifier (`setExploitation(patch, {farmKind: 'invoice'})`, `canMutate` : `exploitation` + `FINANCE_KINDS`), pas le reste de l’exploitation. Menu › Gestion masque l’entrée Facturation au lecteur et à l’opérateur terrain (`canSeeBilling`).
- **Tests** : `test-billing-hub.mjs` ; `tests-visual/facturation.spec.mjs` (captures Suivi, À faire, Catalogue, Modèle visuel et parcours complet, jeu `tests-visual/semis-facturation.mjs`) ; fenêtres du centre dans `tools/a11y-check.mjs`.
- **Parcours complet** (`npm run parcours`, aussi lancé par `npm run visual`) : `tests-visual/parcours-complet.spec.mjs`, profil vierge, quatre projets (téléphone tactile et ordinateur, clair et sombre), sans capture. Facturation depuis Menu › Gestion : réglages (identité, TVA, IBAN, numérotation, relances, logo et couleur, aperçu), client professionnel, catalogue (3 saisis, 2 importés en CSV), devis libre (sections, remise, deux taux) avec aperçu et envoi (lien `mailto:` et partage natif avec le PDF), acceptation signée, acompte 30 %, solde, paiement partiel, tableau de bord, accueil et fiche client concordants, relance par SMS depuis « À faire » (lien `sms:`), avoir partiel, Factur-X validé, journal FEC et CSV, récurrence mensuelle en brouillon, saisie rapide, prestations de l’application non facturées. Équipe : contact chauffeur avec accord SMS, deux travaux (menu du travail › « Confier à… ») et une tâche confiés, « Envoyer le planning » (texte exact du SMS), rappel du soir. Rôles opérateur terrain, lecteur et comptabilité (espace cloud hors ligne : `preferences.cloudRole`). Hors connexion : devis émis et message préparé, puis retour en ligne. Les liens `mailto:` / `sms:` sont lus puis bloqués ; `navigator.share` est simulé.

## 10. Troupeau bovin (n° 79)

- **Modules** : `herd.js` (logique pure, `test-herd.mjs`) et `herd-ui.js` (module différé, clé `herd`, actions `open-herd` et `open-herd-animal` de `LAZY_ACTIONS`, entrée Menu › Production › Troupeau, outil du module Élevage dans `TOOL_MODULES`). Les projections lues au démarrage (vêlages attendus `expectedCalvings`, naissances à notifier `pendingBdni`, constantes `GESTATION_DAYS` = 283, `BDNI_DAYS` = 7, `BDNI_REMINDER_DAYS` = 5) sont dans `home-priorities.js`, déjà statique : l'accueil (carte « Vêlages à venir », `data-home-card="calvings"`), le calendrier (`calendarEventData`) et la conformité (`bdniCheck`) n'importent pas `herd.js`.
- **Données (`APP_VERSION` 18)** : deux collections. `animals` (numéro national `FR` + 10 chiffres, unique parmi les fiches vivantes ; nom, sexe, race, naissance, mère `motherId` ou `motherNationalId` hors troupeau, entrée / sortie et motif, lot noté `sessionId`, `origin`) et `animalEvents` (`insemination` / `mating` avec `expectedCalvingDate` = date + 283 j, `calving` avec `calfId`, `bdniDeadline`, `bdniTaskId`, `bdniNotifiedAt`, `weighing` avec `weightKg`). Collections plutôt qu'`integrationImports` : la fiche animal est une entité de premier rang (historique, corbeille, synchronisation, droits par type), comme `vetTreatments`. La migration v18 crée seulement les listes vides : les numéros déjà saisis dans les lots de pâturage sont proposés dans Troupeau › « Voir et reprendre » (`grazingCandidates`, action explicite).
- **Vêlage** (`calvingPlan`) : une seule mutation écrit l'événement, le veau prérempli (mère, naissance, race, lot de la mère, `origin:'birth'`) et la tâche « Notifier la naissance à l’EDE/BDNI avant le JJ/MM » (`dueDate` J+7, `remindOn` J+5, `kind:'bdni'`). `remindOn` est générique : `computeNotifications` affiche un rappel à partir de cette date. La case « Notifié » (`bdniNotifiedAt`) termine la tâche ; terminer la tâche suffit aussi. **L'application ne notifie jamais la BDNI** (`BDNI_NOTICE`) : aucun appel réseau dans `herd*.js` (contrôlé par `test-herd.mjs`).
- **Soins** : ils restent dans le carnet sanitaire ; la fiche animal liste ceux dont le champ « Animal » cite le numéro, le n° de travail (4 derniers chiffres) ou le nom (`animalTreatments`).
- **Lots** : `grazing.js` (`animalNumberKey`, `linkGrazingAnimals`) relie les lignes d'un lot aux fiches (`animalId`) ; le formulaire Pâturage propose « Choisir dans le troupeau » et la fiche animal change de lot (`lotAssignment`, retrait des autres lots en cours). Le lot actuel est déduit (`animalLot`) : lot en cours qui liste l'animal, sinon lot noté sur la fiche. Un veau n'est pas ajouté d'office à la liste du lot de sa mère (l'opérateur terrain n'écrit pas `grazingSessions`).
- **Import CSV** : `readHerdCsv` (lecteur de `phyto-catalog.js`), `guessColumns`, aperçu `herdImportPreview` (création, complément d'une fiche de même numéro, lignes ignorées avec la raison), `herdImportEntities` (mères reliées par numéro, `source:'herd-csv'`, `sourceId` = numéro). Écriture comme `rpg-onboarding.js` : point de restauration `preimport_…`, fiche `importSessions` (annulation depuis Historique des imports ou le toast).
- **Rôles** : gestion (propriétaire, responsable, collaborateur) : tout ; opérateur terrain : vêlage et pesée (`animalEvents` de `kind` `calving` / `weighing`) et veau né sur place (`animals` d'`origin` `birth`), sans corbeille ni réécriture d'une autre fiche (`herdOperatorRecord` de `permissions.js`, `herdOperatorDoc` de `firestore.rules`, testé par `tools/test-rules.mjs`) ; comptabilité et lecture seule : rien. Suppression : rôles qui ont déjà `delete`.

## 11. Accès conseiller ou technicien (n° 129)

- **Rôle `advisor`** (« Conseiller / technicien ») : `permissions.js` (`ROLES`, `ROLE_CAPABILITIES` : `read`, `write`, `sync`, sans `delete`, `export`, `import`), `team-roles.js` (même niveau que l'opérateur et la comptabilité, attribuable par le propriétaire et le responsable, ligne « Commentaires et préconisations » et « Voir l'économie et la facturation » du tableau), `firestore.rules` (`validRole`, `invitableRole`, `lowerThanManager`). Il n'écrit que ses commentaires de parcelle : ni travail, ni tâche, ni parcelle.
- **Lecture réellement cloisonnée.** `allow read` de `data/{docId}` refuse au conseiller tout document hors `advisorReadable` : collections `ADVISOR_READ_ENTITIES` (parcelles, travaux, tâches, rotations, observations, photos, points, stations météo, produits, pâturage, commentaires), fiches `integrationImports` de `farmKind` `ADVISOR_READ_FARM_KINDS` (analyses de sol, zonages, préconisations de modulation, décisions, haies) et `documents` des catégories `ADVISOR_READ_DOCUMENT_CATEGORIES`. Le journal `audit` lui est fermé ; `storage.rules` ne lui sert que les photos et les pièces jointes des documents de ces catégories (lues sur `data/documents__{id}`).
- **Synchronisation compatible.** Les règles Firestore ne filtrent pas : une requête qui pourrait renvoyer un document interdit est refusée en bloc. Pour ce rôle, `sync.js` remplace la lecture de toute la collection par trois requêtes bornées (`readFilters` de `permissions.js`, `scopedQueries` / `collectScoped`) : `entityType in [...]`, `entityType == 'integrationImports' && payload.farmKind in [...]`, `entityType == 'documents' && payload.category in [...]`, chacune avec le même curseur (`updatedAt`, `serverUpdatedAt`) ; le temps réel (`liveQuery`, `live-sync.js`) ouvre un abonnement par requête ; `bootstrapWorkspace` ne sonde ni n'amorce rien. Ces requêtes demandent les index composites de `firestore.indexes.json` (référencé par `firebase.json`, à déployer avec `firebase deploy --only firestore:indexes`). `farmKind` et `category` sont à la racine du payload, jamais échappés par `encodeCloudPayload`.
- **Limites connues.** (1) Le cloisonnement est par document, pas par champ : un travail ou une tâche (`interventions`, `tasks`) porte ses coûts, doses, intervenants (`assigneeName`, `assigneeId`) et heures pointées (`timeLog` : nom, début, fin), un produit son prix ; le conseiller les reçoit, et le résumé du rôle (`ROLE_SUMMARY.advisor`) le dit. Les masquer demanderait de sortir les pointages dans une collection hors `advisorReadable`. (2) Un document dont la catégorie passe d'agronomique à « Facture » reste sur son appareil dans sa dernière version lisible. (3) Un membre rétrogradé en conseiller garde sur son appareil ce qu'il avait déjà synchronisé (l'interface masque l'économie, rien n'est effacé). À l'inverse, un conseiller promu repart d'un pull complet : le périmètre de lecture est noté avec les curseurs (`metadata.syncCursorScopes`) et, s'il s'élargit, `syncCursor` / `serverCursor` valent 0 jusqu'à la synchronisation suivante. (4) Les règles de requêtes sont rejouées contre l'émulateur par le job « regles » de la CI (`tools/test-rules.mjs`).
- **Interface** : `actionVisibleForRole` (`ECONOMY_ACTIONS`, `canSeeEconomy`, plus `canSeeBilling` et `canSeeTreasury` pour le lecteur et l'opérateur) filtre Plus, la recherche de Plus et la recherche globale (`spotlight.js`) ; la carte de campagne et la carte Facturation de l'accueil sont masquées ; la fiche parcelle n'a ni onglet Économie ni Foncier, et « Commenter » y remplace « Nouveau travail ».
- **Commentaires de parcelle** : collection `parcelComments` (`parcel-comments.js`, `parcel-comments-ui.js`, module différé `parcelComments`, boutons `[data-pc]`). Fiche : `parcelId`, `text` (2 000 caractères au plus), `kind` (`preco` / `comment`), `workId`, `taskId`, `authorUid`, `authorName`, `authorEmail`, `authorRole`, `editedAt`. Section « Commentaires et préconisations » du Résumé de la fiche parcelle ; l'auteur modifie et met à la corbeille le sien, la gestion modère et « Transforme en tâche » (tâche préremplie, échéance déduite du texte par `dueDateHint`, liens `commentId` / `taskId`). Écriture : gestion partout ; opérateur, comptabilité et conseiller seulement leurs commentaires, sous leur rôle et leur adresse (`authorUid`, `authorRole`, `authorEmail` contrôlés par `parcelCommentWritable` dans `permissions.js` et `firestore.rules`, document écrit et document existant ; `authorName` reste déclaratif), et seulement connectés à leur compte (sans uid, `buildComment` refuse) ; lecteur, rien.
- **Notification** : `newParcelComments` (`home-priorities.js`) compte les commentaires d'autres membres de moins de 30 jours pas encore lus sur cet appareil (`preferences.parcelCommentsSeen` : identifiant du commentaire → heure de lecture, oublié après 90 jours). La lecture est notée par commentaire et non par date : un commentaire écrit hors ligne avant la dernière ouverture, reçu après, reste nouveau ; `computeNotifications(state, {uid})` en fait « 2 nouvelles préconisations », qui ouvre la liste (`openInbox`). Ouvrir la fiche d'une parcelle vaut lecture.
- **Données** : `APP_VERSION` 18 (même étape que le troupeau, aucune version publiée entre-temps) : `parcelComments` vide et `preferences.parcelCommentsSeen` réparée si besoin. Fixture `fixtures/backups/v18-actuelle.json` complétée. Tests : `test-parcel-comments.mjs`, `test-team-roles.mjs`, `test-donnees.mjs`, `tools/test-rules.mjs` (émulateur).

## 12. Mise en service du cloud, CI et vérifications manuelles

Cette section remplace `DEPLOYMENT.md`, `CLOUD_SETUP.md`, `TEST_PLAN.md` et `TEST_RESULTS.md`, qui décrivaient l'ancienne arborescence (`js/`, `css/`, `firebase/`, `build:flat`, `preflight`). Ils ont été supprimés ; leur historique reste dans git.

### Activer la synchronisation Firebase (facultatif)

Parcelles fonctionne entièrement en local sans Firebase. Le cloud ne sert qu'à la synchronisation entre appareils et au travail en équipe.

1. Console Firebase : créer un projet et une application Web, activer **Authentication › E-mail/Mot de passe**, créer **Cloud Firestore**, et activer **Cloud Storage** pour les photos, documents et instantanés.
2. Déployer depuis la racine du dépôt (`firebase.json` y référence `firestore.rules`, `firestore.indexes.json` et `storage.rules`) : `firebase deploy --only firestore:rules,firestore:indexes,storage`. Ne jamais laisser Firestore ou Storage en mode test ouvert.
3. Copier la configuration publique de l'application Web dans `config.js` (`window.PARCELLES_FIREBASE_CONFIG`, ou `null` pour rester local). Ce n'est pas un secret : la sécurité repose sur Firebase Authentication et les règles. Aucune clé privée (IA, satellite, E-Phy) ne va dans un fichier servi : elles restent dans les secrets des Workers.
4. Dans l'app : Paramètres › Données et confidentialité (synchronisation, puis éventuellement photos et documents), puis Menu › Compte & équipe (compte, exploitation cloud, invitations).

À retenir :

- Rôles : `ROLES` de `permissions.js` (propriétaire, responsable, collaborateur, opérateur, comptabilité, conseiller, lecteur). L'interface les applique, mais seules les règles sont une vraie barrière.
- Première synchronisation : une exploitation cloud vide reçoit les données locales. Si le même objet diffère des deux côtés, un conflit est créé (`syncConflicts`) au lieu d'écraser.
- Pièces jointes : moins de 25 Mo chacune (`storage.rules`). Instantanés du propriétaire : moins de 50 Mo.
- Invitations : liées à une adresse, un rôle et une exploitation, valables 7 jours, avec une fin d'accès facultative (`memberExpiresAt`). Le destinataire se connecte avec la même adresse pour les accepter.

### Ce que lance la CI (`.github/workflows/tests.yml`)

| Job | Contenu | Bloquant |
|---|---|---|
| `tests` | `npm run lint`, `npm run typecheck`, `npm test`, nom de parcelle piégé (`tests-visual/securite-xss.spec.mjs`, n° 152), `npm run a11y`, `npm run audit` | oui |
| `visuel` | `npm run visual` (références `-linux`) | seulement si des références Linux sont versionnées |
| `regles` | Java 21 et `firebase-tools` dans un dossier temporaire (`RULES_TOOLS_DIR`, rien dans `package.json`), puis `firebase emulators:exec --only firestore,storage --project demo-parcelles "node --test tools/test-rules.mjs"` (n° 143) | oui |
| `hors-ligne` | `npm run offline-check` (n° 149), jusqu'à 3 essais car ces tests de service worker sont parfois instables | oui |
| `perf` | `npm run perf` (n° 150), tableau dans `$GITHUB_STEP_SUMMARY` | non, tant que `perf-budget.json` n'est pas recalé sur la machine de CI |

### Vérifications manuelles avant une grosse version

Les tests automatisés couvrent la logique, les migrations (`fixtures/backups/`), les imports et les règles. Restent à vérifier à la main :

- navigateurs : Chrome, Edge et Firefox sous Windows, Safari sur iPhone et iPad, Chrome sur Android et macOS ;
- largeurs : 320, 360, 375, 390, 414, 768, 1024, 1280 et 1440 px ;
- carte : zoom, sélection, recherche, GPS simple, suivi puis arrêt, retour à l'écran, rotation ;
- clavier, focus visible, lecteur d'écran et taille des cibles tactiles ;
- aucune position GPS envoyée sans consentement ;
- avec un vrai projet Firebase : deux modifications concurrentes de la même fiche ouvrent l'écran de conflit, et deux fiches différentes ne s'écrasent pas.
