# Vérification avant production

## Tests automatisés de logique

- Créer une parcelle : `id`, `createdAt`, `updatedAt`, `version`, `source` et `sourceId` existent.
- Modifier l’intervention puis vérifier qu’une seule entité est mise à jour, journalisée et placée dans la file hors connexion.
- Supprimer puis restaurer une parcelle et une intervention.
- Recharger la page après création hors connexion : les données IndexedDB sont toujours présentes.
- Valider une sauvegarde correcte, puis refuser un JSON non conforme ou dont le checksum diffère.
- Tester les migrations v1 → v2 → v3 avec une sauvegarde ancienne anonymisée.

## Tests d’import

- CSV séparé par virgule et point-virgule, accents, décimales françaises, dates Excel ;
- Excel, GeoJSON, ZIP contenant SHP/SHX/DBF/PRJ ;
- ZIP incomplet, fichier vide, colonnes inconnues, projection absente, géométrie invalide ;
- doublon par sourceId puis par nom + commune, pour les quatre choix : fusionner, remplacer, ignorer, créer.

## Régression navigateur et écrans

- Chrome, Edge et Firefox Windows ; Safari iPhone/iPad ; Chrome Android et macOS ;
- 320, 360, 375, 390, 414, 768, 1024, 1280 et 1440 px ;
- carte : zoom, sélection, recherche, GPS simple, suivi puis arrêt, retour écran, rotation ;
- navigation clavier, focus visible, lecteurs d’écran et taille de cible tactile.

## Hors connexion et synchronisation

- créer une intervention hors connexion, fermer/réouvrir, puis vérifier la file ;
- vérifier qu’aucune position GPS n’est envoyée sans consentement ;
- avec Firebase réellement configuré : créer deux modifications concurrentes de la même entité et vérifier l’écran de conflit, puis créer deux entités différentes et vérifier qu’elles ne s’écrasent pas.
