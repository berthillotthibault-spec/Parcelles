# Déploiement Parcelles 4.0 sur GitHub Pages

## Méthode recommandée

1. Exécuter `npm test`.
2. Exécuter `npm run preflight`.
3. Publier **tout le contenu du projet**, avec les dossiers `js/`, `css/` et `icons/`.
4. Vérifier dans `Plus > Mes données > Diagnostic` que toutes les ressources répondent.

## Méthode GitHub racine simplifiée

Exécuter :

```bash
npm run build:flat
```

Puis publier **le contenu** de `dist-github-root/` à la racine du dépôt. Ne publiez pas le dossier lui-même dans un sous-dossier et ne déposez pas seulement l'archive ZIP.

## Mise à jour

Le service worker porte un BUILD_ID. Lorsqu'une nouvelle version est détectée, l'application propose `Mettre à jour`. En cas de cache incohérent, utiliser `Plus > Mes données > Diagnostic > Nettoyer le cache`.

## Vérification minimale après publication

- l'écran Aujourd'hui est stylé ;
- le statut réseau ne reste pas bloqué sur `Initialisation` ;
- Carte s'ouvre ;
- Diagnostic indique `déploiement OK` ;
- un import SHP peut être analysé ;
- l'application reste consultable après passage hors connexion une fois les ressources installées.


## Configuration cloud facultative

Le build GitHub contient `config.js` avec le cloud désactivé. Pour activer la synchronisation, renseignez la configuration publique Firebase dans ce fichier et déployez les règles de `firebase/`.
