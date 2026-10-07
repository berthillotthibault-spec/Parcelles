import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Publication à plat : index.html, modules, CSS et icônes sont tous à la racine.
const root=path.dirname(fileURLToPath(import.meta.url));
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const html=read('index.html');
const sw=read('sw.js');
const core=new Set([...sw.match(/const CORE=\[([\s\S]*?)\];/)[1].matchAll(/'(\.\/[^']*)'/g)].map(m=>m[1]));

// Chaque entrée du précache doit exister, sinon l'installation du service worker échoue.
for(const ref of core){if(ref==='./')continue;assert.ok(fs.existsSync(path.join(root,ref)),`CORE référence ${ref}, absent du dépôt`);}

// Chaque ressource locale d'index.html doit exister et être précachée.
const htmlRefs=[...html.matchAll(/(?:src|href)=["']\.\/([^"'#?]+)/g)].map(m=>m[1]);
for(const rel of htmlRefs){
  assert.ok(fs.existsSync(path.join(root,rel)),`index.html référence ./${rel}, absent du dépôt`);
  assert.ok(core.has(`./${rel}`),`./${rel} (index.html) doit figurer dans CORE de sw.js`);
}

// Tous les modules atteignables depuis app.js (imports statiques et dynamiques) sont précachés.
const seen=new Set();
const visit=rel=>{
  if(seen.has(rel))return;seen.add(rel);
  const src=read(rel);
  for(const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]\.\/([^'"]+\.js)['"]/g)){
    assert.ok(fs.existsSync(path.join(root,m[1])),`${rel} importe ./${m[1]}, absent du dépôt`);
    assert.ok(core.has(`./${m[1]}`),`./${m[1]} (importé par ${rel}) doit figurer dans CORE de sw.js`);
    visit(m[1]);
  }
};
visit('app.js');
assert.ok(seen.size>20,'le graphe de modules doit être parcouru');

// Le numéro de build est identique aux trois endroits.
const build=sw.match(/const BUILD='([^']+)'/)[1];
assert.equal(html.match(/<meta name="parcelles-build" content="([^"]+)"/)[1],build,'meta parcelles-build ≠ BUILD de sw.js');
assert.equal(read('utils.js').match(/BUILD_ID = '([^']+)'/)[1],build,'BUILD_ID de utils.js ≠ BUILD de sw.js');

// design-v3.css reste la dernière feuille chargée.
const sheets=[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>m[1]);
assert.match(sheets.at(-1),/^\.\/design-v3\.css/);
console.log(`✓ Publication à plat : ${core.size} entrées CORE, ${seen.size} modules précachés, build ${build} cohérent.`);
