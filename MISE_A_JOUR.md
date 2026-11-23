# Mettre à jour Parcelles 10.39.0

Build attendu : `2026.11.23-v10.39.0`. Format de données inchangé (v18) : aucune
migration, aucune réimportation.

## Publier la nouvelle version

Le dépôt est le site publié (GitHub Pages) : tous les fichiers servis sont à la
racine, sans dossier `js/`, `css/` ni `icons/`.

1. Depuis l’application actuelle, exporter une **Sauvegarde complète** dans
   **Profil → Mes données**.
2. Téléverser sur la branche `main` du dépôt GitHub **tous les fichiers modifiés,
   ensemble** (une version partielle mélangerait l’ancien et le nouveau code).
   Pour la 10.39.0 : `index.html`, `sw.js`, `utils.js`, `app.js`, `motion.js`,
   `motion.css`, `tokens.css`, `shell.css`, `components.css`, `screens.css`,
   `design-v3.css`, `personalization.css`, `sheet-swipe.js`, `count-up.js`,
   `count-up-ui.js`, `celebration-ui.js`, `next-action-ui.js`,
   `manifest.webmanifest`, `whatsnew.json`, `CHANGELOG.md` et ce fichier.
   Les fichiers `test-*.mjs` sont des outils de développement, sans effet sur le site.
3. Attendre la fin du déploiement GitHub Pages (une à deux minutes).
4. Ouvrir Parcelles depuis son icône, avec Internet. Accepter **Mettre à jour**
   si proposé, puis fermer complètement l’application et la rouvrir.
5. Vérifier le build `2026.11.23-v10.39.0` dans **Profil › Mes données ›
   Diagnostic** et l’absence de ressources manquantes.

Ne pas supprimer les données du site ni réinstaller l’icône : les données de
l’exploitation sont stockées sur cet appareil. Si l’ancien build persiste,
utiliser **Mise à jour** dans le diagnostic ; au besoin, **Nettoyer cache**
recharge les fichiers applicatifs sans toucher aux données.

## Ce qu’il faut constater après la mise à jour

- **Ouverture** : une parcelle se dessine, puis « Parcelles » apparaît en
  lettres fines ; l’accueil monte dès que l’application est prête. Une ouverture
  rapide raccourcit l’animation : elle ne fait jamais attendre.
- **Thème sombre ou Cabine de nuit** : plus d’éclair blanc à l’ouverture
  (à partir de la deuxième ouverture après la mise à jour, le temps que
  l’application mémorise le thème).
- **Synchronisation lente** : l’accueil s’affiche avec les données du téléphone,
  puis se met à jour quand le cloud répond.
- **Fenêtres** : sur téléphone, elles montent du bas et se referment en glissant,
  par la croix, le fond ou Échap.
- **Travaux et Parcelles** : changer d’onglet ou de filtre ne fait plus
  clignoter l’écran.
- **Réduire les animations** (réglage du téléphone) : aucun mouvement, ouverture
  immédiate.

## Vérifier avant de publier (développement)

Node est installé dans `~/.local/node/bin` :

```sh
export PATH=~/.local/node/bin:$PATH
npm test            # 2117 tests, dont build identique dans sw.js, index.html et utils.js
npm run serve       # http://localhost:8080, sans cache
npm run audit       # captures de la maquette (serveur lancé)
npm run parcours    # parcours complet facturation et messages
```

Pour tester sans l’ancien cache, utiliser une fenêtre privée ou
**Diagnostic › Nettoyer cache**.

## Limites

La validation a été faite dans Chromium à 390 × 844 px (téléphone simulé), en
thème clair et Cabine de nuit. Elle n’a pas été refaite sur un iPhone physique
ni en réseau lent réel.
