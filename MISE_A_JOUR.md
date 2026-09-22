# Mettre à jour Parcelles 7.1.7 sur iPhone

Build attendu : `2026.09.22-v7.1.7`. Format de données conservé : v16.

## Publier la nouvelle version

L’icône sur l’écran d’accueil ouvre le site installé. Ouvrir le ZIP sur l’iPhone
ne suffit pas : il faut publier les fichiers sur l’hébergement de cette application.

1. Depuis l’application actuelle, exporter une **Sauvegarde complète** dans
   **Plus → Compte & application → Mes données**.
2. Extraire `Parcelles_7_1_7_Pret_a_deployer.zip` et publier **tous les fichiers
   extraits**, ensemble, à l’emplacement actuel de l’application. Ce ZIP est
   entièrement à plat : `index.html`, `sw.js`, `leaflet.min.js`,
   `leaflet.min.css`, `xlsx.full.min.js` et `shp.min.js` sont à la racine.
   Ne pas publier le ZIP lui-même comme s’il s’agissait du site.
3. Conserver le domaine et le chemin de l’application. Si `config.js` a été
   personnalisé sur l’hébergement, conserver ses paramètres. La livraison
   reprend ceux du projet fourni.
4. Ouvrir Parcelles depuis son icône, avec Internet. Accepter **Mettre à jour**
   si proposé, puis fermer complètement l’application et la rouvrir si nécessaire.
5. Vérifier le build `2026.09.22-v7.1.7` dans **Plus**, puis ouvrir **Mes données →
   Diagnostic** et vérifier l’absence de ressources manquantes.

Ne pas supprimer les données du site ni réinstaller l’icône : les données de
l’exploitation sont stockées sur cet appareil. Si l’ancien build persiste,
utiliser **Mise à jour** dans le diagnostic après la publication ; au besoin,
**Nettoyer cache** permet de recharger les fichiers applicatifs. Conserver la
sauvegarde exportée tant que la mise à jour et les données ne sont pas vérifiées.

## Animaux, assistant et travaux publics

- Toucher une parcelle sur la carte ou dans la liste pour voir les animaux
  présents. **Voir les animaux / Gérer le pâturage** ouvre les lots concernés.
  Les numéros/noms connus, les gestantes et les effectifs sans numéro restent
  distingués. La date d’entrée future n’est pas comptée comme présence au pré.
- Dans **Parcelles**, utiliser **Animaux au pré** ou **Sans animaux**. Dans
  **Plus → Production → Pâturage**, filtrer présence, parcelle, type d’animaux,
  composition du lot ou rechercher un numéro. **Sortir du pré** enregistre la
  sortie à la date du jour. Les lots sortis restent dans l’historique.
- La bulle **IA** ouvre l’assistant existant. Elle s’efface temporairement
  pendant les fenêtres et les outils de carte pour laisser leurs boutons libres.
- **Plus → Production → Travaux publics → Chantier TP** : nom, client,
  adresse, date, état et engin principal. Une parcelle agricole est facultative.
  Ouvrir **Réalisation** pour saisir date, engin, opérateur, heures, m³, tonnes
  et notes. Le journal est modifiable et ses totaux sont recalculés. Les filtres
  permettent de retrouver les chantiers par état, client, engin ou texte.
- Le bouton **Engins** utilise le matériel existant. Les heures TP saisies
  apparaissent aussi dans la fiche de l’engin ; le compteur mécanique n’est
  pas modifié automatiquement.

## Parcelles PAC/RPG et points de la carte

1. Ouvrir **Carte**, déplacer la carte vers la zone souhaitée puis ouvrir **Couches**.
2. Cocher **Parcelles PAC/RPG 2024**, choisir 5 ou 10 km puis **Appliquer**.
   Le compteur progresse page après page. Fermer la fenêtre annule le chargement.
3. Toucher le contour jaune d’une parcelle RPG puis **Ajouter cette parcelle**.
   Choisir **Mon exploitation**, **Client** ou **Prestation**. Pour un client ou
   une prestation, sélectionner le client ou en créer un dans ce formulaire.
4. Valider **Ajouter la parcelle**. Son contour et sa surface sont conservés.
   Un ajout répété du même identifiant RPG ne crée pas de doublon.
5. Toucher un point existant : **Modifier** permet de changer son nom, sa note
   et son rattachement ; **Déplacer** permet de toucher le nouvel emplacement
   puis de le confirmer ; **Supprimer** place le point dans la corbeille après
   confirmation. **Mes données → Corbeille** permet de le restaurer.

La croix de la fiche de parcelle permet de dégager la carte. Pour zoomer,
utiliser le pincement ou les boutons +/− ; le double appui est désactivé afin
d'éviter les zooms involontaires pendant les actions.

Le chargement RPG nécessite Internet. Les parcelles ajoutées et les points sont
enregistrés localement et restent utilisables hors connexion. Les contours RPG
simplement consultés sont rechargés à la demande ; ils ne sont pas tous ajoutés
automatiquement à votre exploitation.

## Vérifier la correction des formulaires

Après publication, ouvrir **Travaux → Nouveau travail**, puis toucher les listes
**Parcelle**, **Modèle** et **Statut**. La fenêtre doit rester ouverte pendant la
sélection et conserver la saisie. Le bouton **Enregistrer** valide le travail ;
**Annuler** ou la croix permettent de quitter le formulaire.

Cette correction ne nécessite aucune réimportation et ne modifie pas les données
déjà enregistrées. Le nouveau build force la mise à jour des fichiers applicatifs.

## Réparer les accents déjà enregistrés

La correction de l’import empêche les nouvelles pertes de caractères. Les textes
déjà stockés avec `�` ou `?` demandent une réparation distincte :

1. Aller dans **Plus → Compte & application → Mes données → Réparer les accents**.
2. Vérifier l’aperçu : par exemple `Ma�s grain` devient `Maïs grain` et
   `Prairie perm. p�t fauch�e` devient `Prairie perm. pât fauchée`.
3. Appuyer sur **Sauvegarder et réparer**. Une sauvegarde locale confirmée est
   obligatoire avant l’écriture. Les identifiants, surfaces, contours, notes,
   pièces jointes et travaux sont conservés.
4. Si des valeurs restent sans correspondance certaine, sélectionner le fichier
   d’origine dans cette même fenêtre. Pour un SHP, sélectionner le ZIP complet
   ou les fichiers associés, notamment SHP et DBF, ainsi que le CPG s’il existe.
   Le fichier sert à proposer les corrections des textes ; il ne réimporte pas
   les parcelles. Seuls les identifiants source uniques peuvent être rapprochés.

Les caractères perdus ne sont pas toujours déductibles. Un texte non reconnu ou
une correspondance ambiguë reste inchangé. La réparation ne devine pas les noms
et n’a pas besoin de réimporter l’exploitation entière.

La sauvegarde préalable se retrouve dans **Mes données → Sauvegardes automatiques**,
sous le libellé **Avant correction des accents**.

## Reconstruire les distributions

Dans le projet complet, avec Node.js et npm disponibles :

```sh
npm test
npm run preflight
npm run build:flat
npm run build:ios
npm run native:doctor
```

Les bibliothèques sont incluses dans le dossier source `vendor/` et copiées à
la racine des distributions. `node scripts/preflight.mjs dist-github-root --flat`
vérifie aussi la distribution à publier.

Le test navigateur se lance avec `npm run test:browser` si Playwright et un
navigateur sont installés. Variables optionnelles : `PLAYWRIGHT_MODULE`,
`BROWSER_TYPE=webkit`, `BROWSER_CHANNEL=msedge`,
`SITE_PATH=/dist-github-root/` et `SCREENSHOT_DIR`.

Après un chargement complet connecté, l’interface, les données locales, les
géométries et les bibliothèques carte/import sont disponibles hors connexion.
Les fonds cartographiques distants, la météo et le cloud nécessitent du réseau.

## Limites de livraison

Aucun hébergement de production n’a été modifié. La validation navigateur utilise
des dimensions et marges iPhone simulées, sans test sur un iPhone physique.
`dist-ios/` est fourni pour Capacitor ; compilation et signature natives
nécessitent Xcode sur Mac et n’ont pas été effectuées.
