// n° 115 : import telepac guidé. Le ZIP telepac est FABRIQUÉ à partir des géométries anonymisées
// de fixtures/parcelles-fictives.* (aucune donnée réelle) ; PACAGE fictif « 099000000 ».
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {parseShpDbf} from './shapefile-fallback.js';
import {polygonShapefile} from './machine-export.js';
import {createZip} from './zip-lite.js';
import {applyImport, inspectFiles, importPreviewHtml} from './import-export.js';
import {emptyState} from './state.js';
import {isTelepacHeaders, telepacComparison, telepacParcelName, telepacPreviewHtml, telepacRows} from './telepac.js';
import {telepacStepsHtml} from './telepac-ui.js';

const read=ext=>{const b=fs.readFileSync(new URL(`./fixtures/parcelles-fictives${ext}`,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const fixture=parseShpDbf({shp:read('.shp'),dbf:read('.dbf'),prj:fs.readFileSync(new URL('./fixtures/parcelles-fictives.prj',import.meta.url),'utf8')}).geojson.features;
const FIELDS=[['PACAGE','C',9,0],['NUM_ILOT','N',3,0],['NUM_PARCEL','N',3,0],['CODE_CULTU','C',3,0],['SURF_ADM','N',10,2]];
const CODES=['BTH','ORH','PPH','MIS','CZH'];
async function telepacZip(features,codeFor=i=>CODES[i%CODES.length]){
  const items=features.map((f,i)=>({geometry:f.geometry,values:['099000000',Math.floor(i/3)+1,i%3+1,codeFor(i),Math.round(Number(f.properties.SURFACE)*100)/100]}));
  const files=polygonShapefile(items,FIELDS);
  const zip=await createZip(Object.entries(files).map(([ext,data])=>({name:`parcelles_graphiques.${ext}`,data:typeof data==='string'?new TextEncoder().encode(data):data})));
  const blob=zip instanceof Blob?zip:new Blob([zip]);
  return new File([await blob.arrayBuffer()],'telepac-2026.zip',{type:'application/zip'});
}
function fakeStore(initial){
  let current=initial;
  return{snapshot:()=>structuredClone(current),storage:{backupPut:async()=>{}},replaceState:async next=>{current=next;},get state(){return current;}};
}

test('colonnes telepac reconnues, nom îlot.parcelle', ()=>{
  assert.equal(isTelepacHeaders(['PACAGE','NUM_ILOT','NUM_PARCEL','CODE_CULTU','SURF_ADM']),true);
  assert.equal(isTelepacHeaders(['num_ilot','num_parcel','code_cultu']),true);
  assert.equal(isTelepacHeaders(['NOM_PARCEL','SURFACE','NUM_ILOT']),false);
  assert.equal(telepacParcelName('3','2'),'3.2');
  assert.equal(telepacParcelName(3.0,'02'),'3.2');
});

test('PACAGE retiré, culture traduite, surface admissible', ()=>{
  const geometry=fixture[0].geometry;
  const rows=telepacRows([{PACAGE:'099000000',NUM_ILOT:'3',NUM_PARCEL:'2',CODE_CULTU:'bth',SURF_ADM:'4,25',geometry,_feature:{properties:{PACAGE:'099000000'}}}]);
  assert.equal(rows[0].PACAGE,undefined);
  assert.equal(JSON.stringify(rows[0]).includes('099000000'),false);
  assert.equal(rows[0].NOM_PARCEL,'3.2');
  assert.equal(rows[0].ID_EXTERNE,'telepac:3.2');
  assert.equal(rows[0].CP_CULTU,'Blé tendre d’hiver');
  assert.equal(rows[0].SURFACE,4.25);
  const noSurface=telepacRows([{NUM_ILOT:1,NUM_PARCEL:1,CODE_CULTU:'ZZZ',geometry}]);
  assert.ok(noSurface[0].SURFACE>0,'surface calculée si SURF_ADM absente');
  assert.equal(noSurface[0].CP_CULTU,'ZZZ','code inconnu gardé tel quel');
});

test('ZIP telepac (fixture anonymisée) : aperçu reconnu, import sans PACAGE', async()=>{
  const file=await telepacZip(fixture.slice(0,9));
  const preview=await inspectFiles([file],emptyState());
  assert.equal(preview.invalid.length,0,JSON.stringify(preview.invalid));
  assert.ok(preview.telepac,'telepac détecté');
  assert.equal(preview.telepac.comparison,null,'premier import : pas de comparatif');
  assert.equal(preview.summary.parcels,9);
  assert.deepEqual(preview.rows.slice(0,4).map(r=>r.nom),['1.1','1.2','1.3','2.1']);
  assert.equal(preview.rows[0].culture,'Blé tendre d’hiver');
  assert.equal(preview.rows[0].pacCode,'BTH');
  assert.ok(preview.rows[0].declaredSurfaceHa>0);
  assert.equal(JSON.stringify(preview.rows.map(r=>r.raw)).includes('099000000'),false,'PACAGE absent des lignes');
  assert.equal(preview.sources[0].headers.includes('PACAGE'),false);
  assert.match(importPreviewHtml(preview),/Fichier telepac reconnu ✓/);
  const store=fakeStore(emptyState());
  const result=await applyImport(preview,store,'merge');
  assert.equal(result.created,9);
  const parcel=store.state.parcelles.find(p=>p.nom==='1.1');
  assert.equal(parcel.sourceId,'telepac:1.1');
  assert.equal(parcel.rpgCodeCulture,'BTH');
  assert.equal(parcel.declaredSurfaceHa,parcel.surfaceHa);
  assert.equal(JSON.stringify(store.state).includes('099000000'),false,'PACAGE jamais enregistré');
  // Réimport : comparatif avec l'import précédent, aucune nouveauté.
  const again=await inspectFiles([await telepacZip(fixture.slice(0,9))],store.state);
  assert.deepEqual(again.telepac.comparison.added,[]);
  assert.equal(again.summary.duplicates,9);
});

test('réimport l’année suivante : nouvelles, cultures changées, découpes', ()=>{
  const g=(x0,y0,w=0.01,h=0.01)=>({type:'Polygon',coordinates:[[[x0,y0],[x0+w,y0],[x0+w,y0+h],[x0,y0+h],[x0,y0]]]});
  const existing=[
    {nom:'1.1',sourceId:'telepac:1.1',culture:'Blé tendre d’hiver',geometry:g(5,46,0.02,0.01)},
    {nom:'1.2',sourceId:'telepac:1.2',culture:'Maïs',geometry:g(5.1,46)},
    {nom:'2.1',sourceId:'telepac:2.1',culture:'Prairie permanente',geometry:g(5.2,46)},
    {nom:'Pré perso',sourceId:null,culture:'',geometry:g(6,46)}
  ];
  const rows=[
    {nom:'1.1',sourceId:'telepac:1.1',culture:'Blé tendre d’hiver',geometry:g(5,46)},
    {nom:'1.3',sourceId:'telepac:1.3',culture:'Orge d’hiver',geometry:g(5.01,46)},
    {nom:'1.2',sourceId:'telepac:1.2',culture:'Colza d’hiver',geometry:g(5.1,46)},
    {nom:'3.1',sourceId:'telepac:3.1',culture:'Maïs',geometry:g(5.5,46)}
  ];
  const c=telepacComparison(existing,rows);
  assert.equal(c.previous,3);
  assert.deepEqual(c.splits,[{from:'1.1',to:['1.1','1.3']}]);
  assert.deepEqual(c.added,['3.1']);
  assert.deepEqual(c.removed,['2.1']);
  assert.deepEqual(c.cultureChanged,[{nom:'1.2',before:'Maïs',after:'Colza d’hiver'}]);
  const html=telepacPreviewHtml({comparison:c});
  assert.match(html,/1 découpe/);assert.match(html,/1 nouvelle/);assert.match(html,/1 culture changée/);
  assert.equal(telepacComparison([{nom:'X',sourceId:'abc'}],rows),null);
});

test('réimport après renumérotation : « telepac:3.2 » ne réécrit pas un autre champ', async()=>{
  const g=(x0,y0,w=0.01,h=0.01)=>({type:'Polygon',coordinates:[[[x0,y0],[x0+w,y0],[x0+w,y0+h],[x0,y0+h],[x0,y0]]]});
  const state=emptyState();
  state.parcelles=[
    {id:'p31',nom:'3.1',sourceId:'telepac:3.1',culture:'Blé tendre d’hiver',surfaceHa:2,geometry:g(5,46,0.02,0.01)},
    {id:'p32',nom:'3.2',sourceId:'telepac:3.2',culture:'Prairie permanente',surfaceHa:1,geometry:g(5.1,46)}
  ];
  const rows=[
    {nom:'3.1',sourceId:'telepac:3.1',culture:'Blé tendre d’hiver',surfaceHa:1,geometry:g(5,46)},
    {nom:'3.2',sourceId:'telepac:3.2',culture:'Blé tendre d’hiver',surfaceHa:1,geometry:g(5.01,46)},
    {nom:'3.3',sourceId:'telepac:3.3',culture:'Prairie permanente',surfaceHa:1,geometry:g(5.1,46)}
  ];
  const store=fakeStore(state);
  const result=await applyImport({rows,sources:[],summary:{surface:3}},store,'merge');
  const prairie=store.state.parcelles.find(p=>p.id==='p32');
  assert.equal(prairie.culture,'Prairie permanente','la prairie garde sa culture');
  assert.deepEqual(prairie.geometry,g(5.1,46),'la prairie garde sa géométrie');
  assert.equal(store.state.parcelles.find(p=>p.id==='p31').culture,'Blé tendre d’hiver');
  assert.equal(result.updated,1);
  assert.equal(result.created,2);
});

test('réimport à l’identique d’une parcelle concave (en L) : mise à jour, pas de doublon', async()=>{
  const L={type:'Polygon',coordinates:[[[5,46],[5.02,46],[5.02,46.002],[5.002,46.002],[5.002,46.02],[5,46.02],[5,46]]]};
  const state=emptyState();
  state.parcelles=[{id:'pL',nom:'3.2',sourceId:'telepac:3.2',culture:'Prairie permanente',surfaceHa:1,geometry:structuredClone(L)}];
  const store=fakeStore(state);
  const result=await applyImport({rows:[{nom:'3.2',sourceId:'telepac:3.2',culture:'Prairie permanente',surfaceHa:1,geometry:structuredClone(L)}],sources:[],summary:{surface:1}},store,'merge');
  assert.equal(result.updated,1);
  assert.equal(result.created,0);
  assert.equal(store.state.parcelles.filter(p=>!p.deletedAt).length,1);
  // Même L légèrement redessiné : toujours rapproché.
  const L2={type:'Polygon',coordinates:[[[5,46],[5.0201,46],[5.0201,46.002],[5.002,46.002],[5.002,46.0201],[5,46.0201],[5,46]]]};
  const again=await applyImport({rows:[{nom:'3.2',sourceId:'telepac:3.2',culture:'Prairie permanente',surfaceHa:1,geometry:L2}],sources:[],summary:{surface:1}},store,'merge');
  assert.equal(again.updated,1);
  assert.equal(again.created,0);
  assert.equal(store.state.parcelles.filter(p=>!p.deletedAt).length,1);
});

test('renumérotation après découpe oblique : la voisine qui partage la ligne de coupe n’écrase pas l’ancienne parcelle', async()=>{
  const poly=points=>({type:'Polygon',coordinates:[[...points,points[0]]]});
  const cas=[
    // Carré coupé en diagonale : emprises identiques.
    [poly([[5,46],[5,46.01],[5.01,46.01]]),poly([[5,46],[5.01,46],[5.01,46.01]])],
    // Coupe oblique en deux quadrilatères voisins.
    [poly([[5,46],[5.004,46],[5.008,46.01],[5,46.01]]),poly([[5.004,46],[5.01,46],[5.01,46.01],[5.008,46.01]])],
    // Voisins irréguliers aux sommets partagés.
    [poly([[5,46],[5.006,46],[5.004,46.005],[5.007,46.01],[5,46.01]]),poly([[5.006,46],[5.012,46.001],[5.011,46.01],[5.007,46.01],[5.004,46.005]])]
  ];
  for(const [ancien,voisin] of cas){
    const state=emptyState();
    state.parcelles=[{id:'p32',nom:'3.2',sourceId:'telepac:3.2',culture:'Prairie permanente',surfaceHa:1,geometry:ancien}];
    const store=fakeStore(state);
    const result=await applyImport({rows:[{nom:'3.2',sourceId:'telepac:3.2',culture:'Blé tendre d’hiver',surfaceHa:1,geometry:voisin}],sources:[],summary:{surface:1}},store,'merge');
    assert.equal(result.updated,0);
    assert.equal(result.created,1);
    assert.equal(store.state.parcelles.find(p=>p.id==='p32').culture,'Prairie permanente');
    // La même parcelle réimportée telle quelle reste rapprochée.
    const same=await applyImport({rows:[{nom:'3.2',sourceId:'telepac:3.2',culture:'Prairie permanente',surfaceHa:1,geometry:structuredClone(ancien)}],sources:[],summary:{surface:1}},fakeStore(Object.assign(emptyState(),{parcelles:[{id:'p32',nom:'3.2',sourceId:'telepac:3.2',culture:'Prairie permanente',surfaceHa:1,geometry:structuredClone(ancien)}]})),'merge');
    assert.equal(same.updated,1);
    assert.equal(same.created,0);
  }
});

test('guide en 3 étapes', ()=>{
  const html=telepacStepsHtml();
  for(const step of ['Déclaration','Téléchargements','Parcelles graphiques (SHP)'])assert.ok(html.includes(step));
});
