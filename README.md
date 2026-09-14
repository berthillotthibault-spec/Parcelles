# Parcelles 4.0

Application parcellaire agricole mobile-first, locale et PWA.

## Fonctions principales

- Aujourd'hui / Carte / Parcelles / Travaux / Plus ;
- import Geofolia CSV/Excel/SHP/GeoJSON/XML selon données compatibles ;
- parseur SHP interne de secours Lambert-93 + Windows-1252 ;
- sauvegarde ZIP complète avec pièces jointes ;
- carte, satellite, points, dessin, mesures, GPS, mode terrain ;
- travaux rapides, modèles, lots multi-parcelles, coûts et météo snapshot ;
- tâches, calendrier mois/semaine/liste, tournée du jour ;
- rotations/assolement, pilotage, économie, matériel/entretiens, pâturage, clients, stocks, observations ;
- rapports imprimables/PDF, CSV, GeoJSON ;
- recherche globale, assistant local, assistant distant facultatif ;
- diagnostic, corbeille, migrations, sauvegardes automatiques et PWA.

## Tests

```bash
npm test
npm run preflight
```

Le fichier `fixtures/Export_SHP_Le_Sougey.zip` est un test de non-régression permanent.
