# Parcelles 5.0 — configuration cloud facultative

Parcelles fonctionne entièrement en local sans Firebase. Cette configuration est nécessaire uniquement pour la synchronisation multi-appareils et le travail en équipe.

## 1. Créer un projet Firebase

Dans la console Firebase :

1. créez un projet ;
2. ajoutez une application Web ;
3. activez **Authentication > Email/Password** ;
4. créez une base **Cloud Firestore** ;
5. activez **Cloud Storage** si vous souhaitez synchroniser photos/documents.

## 2. Déployer les règles

Les fichiers sont fournis dans :

```text
firebase/firestore.rules
firebase/storage.rules
firebase/firebase.json
```

Depuis un projet Firebase CLI configuré :

```bash
firebase deploy --only firestore:rules,storage
```

Ne laissez jamais Firestore ou Storage en mode test ouvert pour une utilisation réelle.

## 3. Configurer Parcelles

Copiez la configuration publique de l'application Web Firebase dans `config.js` :

```js
window.PARCELLES_FIREBASE_CONFIG = {
  apiKey: '...',
  authDomain: 'votre-projet.firebaseapp.com',
  projectId: 'votre-projet',
  storageBucket: 'votre-projet.appspot.com',
  appId: '...'
};
```

Cette configuration cliente Firebase n'est pas un mot de passe. La sécurité des données repose sur Firebase Authentication et les Rules.

## 4. Activer dans Parcelles

Dans `Plus > Paramètres > Données et confidentialité` :

- activez **Synchronisation multi-appareils** ;
- activez éventuellement **Synchroniser photos et documents**.

Puis ouvrez :

`Plus > Compte & équipe`

Vous pouvez :

- créer un compte ;
- créer une exploitation cloud ;
- choisir une exploitation liée au compte ;
- rejoindre une exploitation avec un code ;
- inviter un collaborateur ;
- choisir son rôle ;
- voir les appareils récents.

## Rôles

### Propriétaire

- lecture/écriture ;
- gestion des membres ;
- suppression définitive ;
- restauration ;
- synchronisation complète.

### Collaborateur

- lecture/écriture des données métier ;
- suppression vers la corbeille ;
- synchronisation ;
- pas de gestion des membres ;
- pas de purge définitive réservée au propriétaire.

### Lecture seule

- consultation ;
- export ;
- aucune modification métier synchronisable.

Les contrôles côté interface améliorent l'UX, mais les **Rules Firebase restent la barrière de sécurité réelle**.

## Première synchronisation

Lorsqu'une exploitation cloud vient d'être créée et qu'elle est vide, Parcelles envoie automatiquement les données locales existantes lors de la première synchronisation.

Si le cloud contient déjà des données et que l'appareil local possède une version différente du même objet, Parcelles crée un conflit au lieu d'écraser silencieusement une version.

## Pièces jointes

Si l'option est activée :

- les photos/documents locaux absents du cloud sont envoyés dans Firebase Storage ;
- un appareil qui possède la métadonnée mais pas le blob tente de télécharger le fichier ;
- limite proposée par les règles : **25 Mo par pièce jointe**.

## Invitations

Le propriétaire crée un code d'invitation associé à :

- une adresse email précise ;
- un rôle ;
- une exploitation ;
- une durée de validité applicative de 7 jours.

Le destinataire doit se connecter avec la même adresse email pour accepter le code.

## Assistant distant

L'assistant distant reste indépendant de Firebase. Dans Paramètres, indiquez un endpoint HTTPS de type Cloudflare Worker.

Le Worker reçoit un contexte métier réduit et une conversation locale limitée. Il peut retourner :

```json
{
  "answer": "...",
  "actions": [
    {
      "type": "create_work",
      "label": "Préparer ce travail",
      "payload": {
        "parcelId": "...",
        "type": "Fauche",
        "date": "2026-09-14",
        "status": "À faire"
      }
    }
  ]
}
```

Actions acceptées par Parcelles 5.0 :

- `create_work` ;
- `create_task` ;
- `open_parcel` ;
- `search`.

Une action d'écriture n'est **jamais exécutée directement** : l'utilisateur voit un récapitulatif et doit confirmer.

Ne placez jamais une clé Gemini/OpenAI privée dans `config.js`, `app.js` ou un autre fichier public GitHub Pages.
