# Services externes facultatifs

Parcelles fonctionne localement sans compte cloud.

## Assistant distant

Dans Paramètres, activez `Assistant distant` et indiquez un endpoint **HTTPS** de type Cloudflare Worker. Le navigateur n'envoie qu'un contexte métier réduit (parcelles, travaux récents, tâches et matériel), jamais les photos ou la position GPS brute par défaut. La clé du fournisseur IA doit rester côté Worker.

Le Worker doit accepter :

```json
{ "question": "...", "context": { }, "client": "Parcelles", "mode": "assistant" }
```

et répondre :

```json
{ "answer": "...", "actions": [] }
```

Les actions retournées par un service distant ne sont jamais exécutées automatiquement par la version livrée.

## Synchronisation

Le module de synchronisation est volontairement inactif tant qu'un fournisseur authentifié n'est pas configuré. Le modèle prévu synchronise les entités une par une et conserve les conflits. Les pièces jointes nécessitent un stockage objet séparé.

## Notifications push

La version statique peut afficher des notifications navigateur locales lorsque l'application est ouverte. Des notifications push en arrière-plan nécessitent un service push et un backend : elles ne sont pas simulées sans cette infrastructure.
