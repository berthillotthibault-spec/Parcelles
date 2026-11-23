// Budget rapide (sans navigateur), complémentaire de tools/perf-budget.mjs (Playwright, CI non bloquante).
// Bloque toute dérive du poids chargé au démarrage et du coût des écritures sur une grosse exploitation.
// Seuils : valeur mesurée le 2026-11-13 + 5 % pour les octets, marge large (x10) pour les temps (machines CI lentes).
// Une baisse réelle doit être suivie d'une baisse du seuil, pour garder le gain.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {emptyState,planCollections} from './state.js';
import {preloadBlock,currentBlock} from './tools/modulepreload.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

export const BUDGET={
  staticGraphBytes:2925300,   // mesuré 2 785 938 o (223 modules) le 2026-11-14, notes vocales différées
  staticGraphModules:234,
  appJsBytes:436300,          // mesuré 416 929 o
  designCssBytes:350300,      // mesuré 333 560 o
  cloneMs:60,                 // mesuré 6,3 ms (400 parcelles, 8 000 interventions)
  planMs:20                   // mesuré 1,6 ms
};

// Modules chargés avant le premier affichage : imports statiques seulement (les import() sont paresseux).
export function staticGraph(entry='app.js'){
  const seen=new Set();let bytes=0;
  const visit=rel=>{
    if(seen.has(rel))return;seen.add(rel);
    const src=read(rel);bytes+=Buffer.byteLength(src);
    for(const m of src.matchAll(/(?:^|[;\s}])(?:import|export)\s[^'"();]*?from\s*['"]\.\/([^'"]+\.js)['"]|(?:^|[;\s])import\s*['"]\.\/([^'"]+\.js)['"]/gm))visit(m[1]||m[2]);
  };
  visit(entry);
  return {modules:seen.size,bytes};
}

export function bigFarm(parcels=400,works=8000){
  const st=emptyState();
  for(let i=0;i<parcels;i++)st.parcelles.push({id:`p${i}`,name:`Parcelle ${i}`,area:5,geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]].map(([x,y])=>[x+i*0.001,y])]}});
  for(let i=0;i<works;i++)st.interventions.push({id:`w${i}`,parcelId:`p${i%parcels}`,type:'traitement',date:'2026-05-01',notes:'Passage de printemps, conditions correctes',products:[{name:'Produit A',dose:1}]});
  return st;
}
const bench=(fn,runs=10)=>{fn();const t=performance.now();for(let i=0;i<runs;i++)fn();return (performance.now()-t)/runs;};

test('budget : poids chargé au démarrage', ()=>{
  const g=staticGraph();
  assert.ok(g.bytes<=BUDGET.staticGraphBytes,`Graphe statique d’app.js : ${g.bytes} o > ${BUDGET.staticGraphBytes} o. Charger le nouveau module à la demande (lazy-modules.js) ou relever le seuil en le justifiant.`);
  assert.ok(g.modules<=BUDGET.staticGraphModules,`${g.modules} modules statiques > ${BUDGET.staticGraphModules}`);
  const app=fs.statSync(path.join(root,'app.js')).size;
  assert.ok(app<=BUDGET.appJsBytes,`app.js : ${app} o > ${BUDGET.appJsBytes} o`);
  const css=fs.statSync(path.join(root,'design-v3.css')).size;
  assert.ok(css<=BUDGET.designCssBytes,`design-v3.css : ${css} o > ${BUDGET.designCssBytes} o`);
});

test('budget : copie et empreintes de l’état sur une grosse exploitation', ()=>{
  const st=bigFarm();
  const cloneMs=bench(()=>structuredClone(st));
  const planMs=bench(()=>planCollections(st,null));
  assert.ok(cloneMs<=BUDGET.cloneMs,`Copie de l’état : ${cloneMs.toFixed(1)} ms > ${BUDGET.cloneMs} ms`);
  assert.ok(planMs<=BUDGET.planMs,`Empreintes des collections : ${planMs.toFixed(1)} ms > ${BUDGET.planMs} ms`);
});

test('budget : tous les modules du démarrage sont préchargés (index.html)', ()=>{
  assert.equal(currentBlock(read('index.html')),preloadBlock(root),'Bloc modulepreload périmé : node tools/modulepreload.mjs --write');
});
