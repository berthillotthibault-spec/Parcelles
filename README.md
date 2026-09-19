# Bibliothèques embarquées

Les versions déjà utilisées par le projet sont incluses localement pour éviter
qu’un CDN lent ou inaccessible bloque le premier affichage ou les imports.

- Leaflet 1.9.4 : CSS, JavaScript et marqueurs, provenant de cdnjs.
- SheetJS/XLSX 0.18.5 : xlsx.full.min.js, provenant de cdnjs.
- shpjs 6.2.0 : shp.min.js, provenant de unpkg.

Les URL exactes sont dans scripts/fetch-native-vendor.mjs. Les trois fichiers
LICENSE contiennent les licences distribuées avec ces versions sur unpkg.
Aucune montée de version de ces bibliothèques n’a été effectuée.
