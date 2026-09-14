# Parcelles 5.0 — Résultats de tests

Build : `2026.09.14-v5.0.0`  
Schéma : `7`

Tests automatisés exécutés :

- ✓ SHP réel : **110 parcelles**, DBF Windows-1252 et Lambert-93 ;
- ✓ ZIP interne : lecture fixture et sauvegarde/restauration ;
- ✓ utilitaires : dates FR, géométrie, distance et valeurs zéro ;
- ✓ fonctions 4.0 : migrations, notifications, rapports et ressources ;
- ✓ fonctions 4.1 : recherche intelligente, raccourcis, diagnostic et confidentialité GPS ;
- ✓ fonctions 4.2 : économie, stocks, mouvements, rapports et planification de campagne ;
- ✓ migration schéma v6 → v7 ;
- ✓ nouveaux tableaux `members`, `assistantMessages`, `devices` ;
- ✓ rôles Propriétaire / Collaborateur / Lecture seule ;
- ✓ blocage d'écriture métier en lecture seule ;
- ✓ application distante d'une entité sans altération de sa version cloud ;
- ✓ assistant : contexte conversationnel limité ;
- ✓ synchronisation : amorçage, push, pull, conflits, invitations et pièces jointes présents ;
- ✓ `permissions.js`, `config.js` et ressources 5.0 présents dans le runtime ;
- ✓ préflight de déploiement GitHub ;
- ✓ build GitHub à plat.

Commandes :

```bash
npm test
npm run release:check
```

Limite de test : les échanges réels Firebase/Auth/Storage nécessitent un projet Firebase configuré. Les tests livrés vérifient la logique locale, les migrations, les permissions et la présence des flux cloud sans effectuer de connexion à un compte externe.
