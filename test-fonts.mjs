import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Polices Instrument Sans / Serif auto-hébergées : elles doivent rester disponibles hors connexion.
const root=path.dirname(fileURLToPath(import.meta.url));
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const html=read('index.html');
const tokens=read('tokens.css');
const core=new Set([...read('sw.js').match(/const CORE=\[([\s\S]*?)\];/)[1].matchAll(/'(\.\/[^']*)'/g)].map(m=>m[1]));
const faces=[...tokens.matchAll(/@font-face\{([^}]*)\}/g)].map(m=>m[1]);

test('index.html ne dépend plus de Google Fonts', ()=>{
  assert.doesNotMatch(html,/fonts\.(googleapis|gstatic)\.com/);
});

test('chaque @font-face pointe vers un woff2 local, valide et précaché', ()=>{
  assert.equal(faces.length,4);
  for(const face of faces){
    assert.match(face,/font-display:swap/);
    const src=face.match(/src:url\('(\.\/[^']+\.woff2)'\) format\('woff2'\)/);
    assert.ok(src,`src woff2 local attendu : ${face}`);
    const file=path.join(root,src[1]);
    assert.ok(fs.existsSync(file),`${src[1]} absent du dépôt`);
    assert.equal(fs.readFileSync(file).subarray(0,4).toString('latin1'),'wOF2',`${src[1]} n’est pas un woff2`);
    assert.ok(core.has(src[1]),`${src[1]} doit figurer dans CORE de sw.js`);
  }
});

test('les deux familles couvrent le latin et les graisses utilisées', ()=>{
  const sans=faces.filter(f=>f.includes("'Instrument Sans'"));
  const serif=faces.filter(f=>f.includes("'Instrument Serif'"));
  assert.equal(sans.length,2);assert.equal(serif.length,2);
  for(const f of sans)assert.match(f,/font-weight:400 700/);
  // Le sous-ensemble latin couvre œ, les guillemets « » et l’espace fine insécable.
  for(const f of [...sans,...serif].filter(f=>f.includes('-latin.woff2')))assert.match(f,/U\+0000-00FF.*U\+0152-0153.*U\+2000-206F/);
});

test('les polices préchargées existent et sont déclarées en CORS', ()=>{
  const preloads=[...html.matchAll(/<link rel="preload" href="(\.\/[^"]+\.woff2)" as="font" type="font\/woff2" crossorigin>/g)].map(m=>m[1]);
  assert.equal(preloads.length,2);
  for(const p of preloads){assert.ok(fs.existsSync(path.join(root,p)));assert.ok(core.has(p));}
});

test('la licence OFL accompagne les polices', ()=>{
  const lic=read('instrument-fonts-LICENSE.txt');
  assert.match(lic,/Instrument Sans Project Authors/);
  assert.match(lic,/Instrument Serif Project Authors/);
  assert.match(lic,/SIL OPEN FONT LICENSE Version 1\.1/);
});
