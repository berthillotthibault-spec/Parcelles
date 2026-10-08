# Bibliothèques embarquées

Les versions déjà utilisées par le projet sont incluses localement pour éviter
qu’un CDN lent ou inaccessible bloque le premier affichage ou les imports.

- Leaflet 1.9.4 : CSS, JavaScript et marqueurs, provenant de cdnjs.
- SheetJS/XLSX 0.18.5 : xlsx.full.min.js, provenant de cdnjs.
- shpjs 6.2.0 : shp.min.js, provenant de unpkg.
- Polices Instrument Sans (variable 400-700) et Instrument Serif 400 :
  instrument-*-latin.woff2 et instrument-*-latin-ext.woff2, sous-ensembles woff2
  de Google Fonts (fonts.gstatic.com), déclarés dans tokens.css. Licence OFL 1.1
  dans instrument-fonts-LICENSE.txt.

Les URL exactes sont dans scripts/fetch-native-vendor.mjs. Les trois fichiers
LICENSE contiennent les licences distribuées avec ces versions sur unpkg.
Aucune montée de version de ces bibliothèques n’a été effectuée.
