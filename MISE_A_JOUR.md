# Mettre à jour Parcelles 7.1.3

Build attendu : `2026.09.18-v7.1.3`. Format de données conservé : v16.

## Application iPhone ajoutée à l’écran d’accueil

L’icône ouvre le site installé. Ouvrir ce ZIP sur l’iPhone ne met pas
l’application à jour : les fichiers corrigés doivent être publiés sur son
hébergement actuel.

1. Exporter une sauvegarde depuis l’application avant la mise en production.
2. Publier **tout le contenu** de `dist-github-root/` dans le répertoire qui
   héberge déjà l’application, ou utiliser le ZIP prêt à déployer. `index.html`,
   `sw.js`, les fichiers JS/CSS et le dossier `vendor/` doivent rester ensemble.
3. Conserver le domaine, le chemin d’accès, le manifeste et le `config.js` de
   l’installation existante si celui-ci a été personnalisé. Le fichier fourni
   reprend celui du projet transmis.
4. Ouvrir Parcelles depuis son icône avec Internet. Appuyer sur **Mettre à jour**
   si le message apparaît. Au besoin, fermer complètement l’application puis
   la rouvrir après publication.
5. Vérifier en bas de **Plus** le build `2026.09.18-v7.1.3`, puis essayer
   Recherche, Notifications, Carte/Couches et une fenêtre en portrait/paysage.

La mise à jour remplace les fichiers applicatifs ; elle ne supprime pas la base
IndexedDB des parcelles. Ne pas effacer les données du site ou réinstaller
l’icône pour cette mise à jour, car les données sont stockées sur cet appareil.
Si le build reste ancien, ouvrir le diagnostic depuis les outils avancés de
l’application pour vérifier le déploiement et réinitialiser le cache applicatif.

Après un premier chargement complet connecté, l’interface, les données locales,
les géométries et les bibliothèques carte/import fonctionnent hors connexion.
Le fond cartographique distant, la météo et le cloud demandent encore du réseau.

## Reconstruire les distributions

```sh
npm test
npm run preflight
npm run build:flat
npm run build:ios
npm run native:doctor
```

`vendor/` est déjà inclus. Le test navigateur facultatif se lance avec
`npm run test:browser` après installation de Playwright et de ses navigateurs.
Variables optionnelles : `BROWSER_TYPE=webkit`, `BROWSER_CHANNEL=msedge`,
`SITE_PATH=/dist-github-root/` et `SCREENSHOT_DIR`. Par défaut : Chromium, sources.

## Enveloppe native et services facultatifs

`dist-ios/` est fourni pour Capacitor. Compiler et signer une application native
exige Xcode sur Mac ; cela n’a pas été réalisé ici. Les fichiers Firebase et le
serveur d’exemple sont conservés. Aucun hébergement ni service cloud de
production n’a été modifié par cette livraison.
