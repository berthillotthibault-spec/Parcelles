# Parcelles 2.0 — livraison restructurée

Cette version remplace le fichier monolithique par une application modulaire :

- `css/` : socle, composants, carte et adaptation mobile ;
- `js/state.js` : source de vérité v3, migrations, identifiants stables, versions, corbeille, journal et file hors connexion ;
- `js/storage.js` : IndexedDB (avec repli temporaire) ;
- `js/import-export.js` : aperçu/validation des imports, doublons, sauvegarde contrôlée et exports ;
- `js/map.js` : couches Leaflet, sélection et GPS local ;
- `js/sync.js` : contrat de synchronisation par entité, volontairement désactivé sans authentification Firebase ;
- `sw.js` et `manifest.webmanifest` : PWA et cache versionné.

## Démarrer

Servez ce dossier depuis un serveur HTTP local ou un hébergement HTTPS, puis ouvrez `index.html`. Un double-clic (`file://`) ne permet pas à tous les navigateurs de charger les modules JavaScript ni le service worker.

## Migration de l’ancienne application

1. Ouvrez l’ancienne version et créez sa sauvegarde JSON.
2. Dans cette version, ouvrez **Centre de données → Restaurer**.
3. Vérifiez l’aperçu et l’intégrité, puis confirmez. Le moteur migre les anciens formats vers le modèle v3 quand les champs correspondants sont présents.

## Synchronisation et confidentialité

La synchronisation distante est coupée par défaut. Pour l’activer proprement, l’hébergeur doit fournir Firebase Auth et Firestore, une authentification utilisateur et des règles limitant strictement l’accès à `users/{uid}/…`. Les opérations doivent être envoyées entité par entité, avec comparaison de `version`/`updatedAt` et résolution visible des conflits. Une clé de configuration ou un identifiant d’appareil ne constitue pas une authentification.

Les photos et documents sont conservés localement dans IndexedDB. Ils demandent un stockage cloud distinct et explicite pour être présents sur d’autres appareils.

## Limites à valider avant mise en production

- saisir la configuration Firebase et ses règles de sécurité ;
- fournir de vraies icônes PWA ;
- exécuter `node tests/core.mjs`, puis la matrice de `tests/TEST_PLAN.md` sur les navigateurs et appareils cibles ;
- tester des ZIP SHP/SHX/DBF/PRJ représentatifs de vos exports Geofolia.
