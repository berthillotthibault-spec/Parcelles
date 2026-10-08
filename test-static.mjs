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

// Pas de doublon ni de trou (« ,, ») dans CORE : ce serait le signe d'une fusion mal résolue.
const coreSrc=sw.match(/const CORE=\[([\s\S]*?)\];/)[1];
const coreList=[...coreSrc.matchAll(/'([^']*)'/g)].map(m=>m[1]);
assert.equal(coreList.length,core.size,`CORE contient des doublons : ${coreList.filter((x,i)=>coreList.indexOf(x)!==i).join(', ')}`);
assert.ok(!/,\s*,/.test(coreSrc),'CORE contient une entrée vide (« ,, »)');

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
// Le dépôt EST le site publié : seules des extensions de site sont admises à la racine.
// Un export de parcellaire (.shp, .dbf, .zip…) ou un tableur ne doit jamais y réapparaître.
const SERVED_EXT=new Set(['.html','.js','.mjs','.css','.json','.webmanifest','.md','.txt','.rules','.png','.svg','.ico','.jpg','.jpeg','.webp','.woff','.woff2']);
const ROOT_DIRS=new Set(['tools','fixtures','node_modules','audit','dist-github-root']);
for(const entry of fs.readdirSync(root,{withFileTypes:true})){
  if(entry.name.startsWith('.'))continue;
  const isDir=entry.isDirectory()||(entry.isSymbolicLink()&&fs.statSync(path.join(root,entry.name)).isDirectory());
  if(isDir){assert.ok(ROOT_DIRS.has(entry.name),`dossier inattendu à la racine publiée : ${entry.name}/`);continue;}
  const ext=path.extname(entry.name).toLowerCase();
  assert.ok(SERVED_EXT.has(ext),`${entry.name} : extension ${ext||'(aucune)'} interdite à la racine publiée (données réelles ou fichier non servi ?)`);
}
// Données géographiques, archives et tableurs : uniquement la fixture anonymisée explicitement autorisée
// (générée par tools/make-fixture.mjs), nulle part ailleurs dans les dossiers publiés.
const DATA_EXT=/\.(shp|shx|dbf|prj|cpg|qmd|sbn|sbx|zip|geojson|kml|kmz|gpx|csv|xlsx?|ods|xml)$/i;
const FIXTURES=new Set(['fixtures/parcelles-fictives.shp','fixtures/parcelles-fictives.shx','fixtures/parcelles-fictives.dbf','fixtures/parcelles-fictives.prj','fixtures/parcelles-fictives.zip']);
const walk=dir=>fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>{
  const rel=dir?`${dir}/${e.name}`:e.name;
  if(e.isDirectory()||(e.isSymbolicLink()&&fs.statSync(path.join(root,rel)).isDirectory()))return['node_modules','audit','dist-github-root','.git'].includes(rel)?[]:walk(rel);
  return[rel];
});
const dataFiles=walk('').filter(rel=>DATA_EXT.test(rel));
for(const rel of dataFiles)assert.ok(FIXTURES.has(rel.normalize('NFC')),`${rel} : fichier de données publié hors fixture anonymisée autorisée`);
for(const rel of FIXTURES)assert.ok(fs.existsSync(path.join(root,rel)),`fixture anonymisée ${rel} absente (tools/make-fixture.mjs)`);
console.log(`✓ Publication à plat : ${core.size} entrées CORE, ${seen.size} modules précachés, build ${build} cohérent.`);
