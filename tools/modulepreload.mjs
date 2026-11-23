#!/usr/bin/env node
// Préchargement des modules du démarrage (index.html). Sans lui, le navigateur ne découvre les imports qu'étage par
// étage (app.js, puis ses 126 imports, puis les leurs…) : un aller-retour réseau par étage au premier chargement.
// Usage : node tools/modulepreload.mjs          vérifie que le bloc d'index.html est à jour (code 1 sinon)
//         node tools/modulepreload.mjs --write  réécrit le bloc entre les deux marqueurs
// test-budget.mjs vérifie le bloc à chaque npm test.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const BEGIN = '<!-- modulepreload : début (node tools/modulepreload.mjs --write) -->';
export const END = '<!-- modulepreload : fin -->';
const IMPORT = /(?:^|[;\s}])(?:import|export)\s[^'"();]*?from\s*['"]\.\/([^'"]+\.js)['"]|(?:^|[;\s])import\s*['"]\.\/([^'"]+\.js)['"]/gm;

/** Modules importés statiquement depuis app.js (app.js exclu, déjà préchargé), étage par étage. */
export function preloadList(root) {
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  const seen = new Set(['app.js']), out = [];
  let frontier = ['app.js'];
  while (frontier.length) {
    const next = [];
    for (const file of frontier) for (const m of read(file).matchAll(IMPORT)) {
      const rel = m[1] || m[2];
      if (seen.has(rel)) continue;
      seen.add(rel); next.push(rel); out.push(rel);
    }
    frontier = next;
  }
  return out;
}

export function preloadBlock(root) {
  return [BEGIN, ...preloadList(root).map(rel => `  <link rel="modulepreload" href="./${rel}">`), `  ${END}`].join('\n');
}

/** Bloc actuel d'index.html (null s'il manque). */
export function currentBlock(html) {
  const start = html.indexOf(BEGIN), end = html.indexOf(END);
  return start < 0 || end < start ? null : html.slice(start, end + END.length);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = path.join(root, 'index.html'), html = fs.readFileSync(file, 'utf8'), block = preloadBlock(root);
  const current = currentBlock(html);
  if (process.argv.includes('--write')) {
    const next = current ? html.replace(current, block) : html.replace('  <title>', `  ${block}\n  <title>`);
    fs.writeFileSync(file, next);
    console.log(`index.html : ${preloadList(root).length} modules préchargés.`);
  } else if (current !== block) {
    console.error('Bloc modulepreload d’index.html périmé : lancer node tools/modulepreload.mjs --write');
    process.exit(1);
  } else console.log('Bloc modulepreload à jour.');
}
