# Mettre à jour Parcelles 10.40.0

Build attendu : `2026.11.23-v10.40.0`. Format de données inchangé (v18) : aucune
migration, aucune réimportation.

## Publier la nouvelle version

Le dépôt est le site publié (GitHub Pages) : tous les fichiers servis sont à la
racine, sans dossier `js/`, `css/` ni `icons/`.

1. Depuis l’application actuelle, exporter une **Sauvegarde complète** dans
   **Profil → Mes données**.
2. Téléverser sur la branche `main` du dépôt GitHub **tous les fichiers modifiés,
   ensemble** (une version partielle mélangerait l’ancien et le nouveau code).
   Pour la 10.40.0 :
   - nouveau : `design-v4.css` ;
   - feuilles et coquille : `tokens.css`, `index.html`, `sw.js`, `runtime.js`, `utils.js` ;
   - écrans : `app.js`, `home-story-ui.js`, `satellite-ui.js`, `sync-status.js`,
     `margin-ui.js`, `pilotage.js`, `crop-margins-ui.js`, `herd-economics-ui.js`,
     `diagnostic-ui.js`, `fuel-ui.js`, `billing-hub.js`, `billing-hub-ui.js` ;
   - textes : `whatsnew.json`, `CHANGELOG.md` et ce fichier.

   Les fichiers `test-*.mjs` (dont le nouveau `test-design-v4.mjs`) sont des
   outils de développement, sans effet sur le site.
3. Attendre la fin du déploiement GitHub Pages (une à deux minutes).
4. Ouvrir Parcelles depuis son icône, avec Internet. Accepter **Mettre à jour**
   si proposé, puis fermer complètement l’application et la rouvrir.
5. Vérifier le build `2026.11.23-v10.40.0` dans **Profil › Mes données ›
   Diagnostic** et l’absence de ressources manquantes (`design-v4.css` fait
   partie des fichiers obligatoires).

Ne pas supprimer les données du site ni réinstaller l’icône : les données de
l’exploitation sont stockées sur cet appareil. Si l’ancien build persiste,
utiliser **Mise à jour** dans le diagnostic ; au besoin, **Nettoyer cache**
recharge les fichiers applicatifs sans toucher aux données.

## Ce qu’il faut constater après la mise à jour

- **Barres et fenêtres en verre** : en-tête, navigation (onglet actif en pastille
  de verre), haut et bas des fenêtres, boutons flottants, menus et messages.
- **Plus de bordures grises** : cartes à ombre douce ; dans les fenêtres, les
  sections sont des groupes à plat, sans cadres dans des cadres ni pointillés.
- **Formulaires** : champs remplis, dates en taille normale, choix courts en
  boutons segmentés (Devis / Facture / Pro forma), bas de fenêtre plus court.
- **Chiffres** : grands chiffres en serif ; une valeur manquante affiche
  « À compléter » et sa raison. Pilotage, Économie du troupeau, Facturation et
  Diagnostic en tuiles sur fond coloré.
- **Accueil** : l’action des cartes de décision passe sous le texte ;
  « Pourquoi ? · Votre avis » tient sur une ligne ; Satellite n’affiche plus
  « hétérogèneImage du ».
- **Pastille de synchronisation** courte (« À jour »), détail au toucher.
- **Réglages du téléphone** « Réduire la transparence » ou « Augmenter le
  contraste », et mode plein champ : le verre devient opaque.

## Vérifier avant de publier (développement)

Node est installé dans `~/.local/node/bin` :

```sh
export PATH=~/.local/node/bin:$PATH
npm test            # 2122 tests, dont build identique dans sw.js, index.html et utils.js
npm run serve       # http://localhost:8080, sans cache
npm run audit       # captures de la maquette (serveur lancé)
npm run parcours    # parcours complet facturation et messages
```

Pour tester sans l’ancien cache, utiliser une fenêtre privée ou
**Diagnostic › Nettoyer cache**.

## Limites

- La validation a été faite dans Chromium à 390 × 844 px (téléphone simulé), en
  thème clair, sombre et Cabine de nuit. Elle n’a pas été refaite sur un iPhone
  physique (rendu du flou Safari, plein soleil).
- Bas de fenêtre à trois boutons ou plus : les actions secondaires partagent une
  rangée et peuvent être tronquées (« Enregistrer et dessiner »).
- Diagnostic › Réinitialiser demande encore confirmation par une boîte système.
