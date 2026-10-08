// Carte de l'exploitation hors connexion (idée n° 40).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TILE_CAP_BYTES, bufferBbox, chunk, estimateBytes, evictionList, fitPlan, formatBytes, isIgnTileUrl, lonLatToTile, normalizeMeta, offlineSummary, planOfflineTiles, plannedUrls, tileCacheName, tileUrl} from './offline-map.js';
import {BASE_LAYERS} from './basemaps.js';

const sq=(x,y,d=0.004)=>({type:'Polygon',coordinates:[[[x,y],[x+d,y],[x+d,y+d*0.7],[x,y+d*0.7],[x,y]]]});
const farm=[[5.13,46.34],[5.136,46.34],[5.142,46.34],[5.13,46.345]].map(([x,y],i)=>({id:`p${i}`,geometry:sq(x,y)}));

test('conversion position → tuile Web Mercator',()=>{
  assert.deepEqual(lonLatToTile(0,0,1),{x:1,y:1});
  assert.deepEqual(lonLatToTile(5.13,46.34,12),{x:2106,y:1451});
  assert.deepEqual(lonLatToTile(-180,85.1,3),{x:0,y:0});
});

test('tampon de 500 m autour d’une emprise',()=>{
  const [a,b,c,d]=bufferBbox([5,46,5.01,46.01],500);
  assert.ok(Math.abs((46-b)*111320-500)<1);assert.ok(Math.abs((a-5)+(c-5.01))<1e-9);assert.ok(d>46.01);
});

test('plan de tuiles : zooms 12 à 17, dédoublonné, parcelles sans contour ignorées',()=>{
  const plan=planOfflineTiles([...farm,{id:'nogeo'},{id:'gone',geometry:sq(6,47),deletedAt:1}]);
  assert.equal(plan.parcelCount,4);assert.deepEqual(Object.keys(plan.perZoom).map(Number),[12,13,14,15,16,17]);
  assert.equal(plan.tiles.length,Object.values(plan.perZoom).reduce((a,b)=>a+b,0));
  assert.equal(new Set(plan.tiles.map(t=>`${t.z}/${t.x}/${t.y}`)).size,plan.tiles.length);
  assert.ok(plan.perZoom[12]>=1&&plan.perZoom[17]>plan.perZoom[16]);
  assert.equal(planOfflineTiles([]).tiles.length,0);
});

test('une exploitation éclatée ne télécharge pas l’espace entre ses îlots',()=>{
  const spread=[...farm,{id:'far',geometry:sq(5.4,46.2)}];
  const per=planOfflineTiles(spread).perZoom[17];
  const a=lonLatToTile(5.13,46.35,17),b=lonLatToTile(5.41,46.19,17),wholeBox=(b.x-a.x+1)*(b.y-a.y+1);
  assert.ok(per<wholeBox/20,`${per} tuiles au lieu de ${wholeBox}`);
});

test('URL des tuiles identiques à celles demandées par Leaflet',()=>{
  const photo=BASE_LAYERS.find(l=>l.id==='ign-photo').url;
  const url=tileUrl(photo,{z:15,x:16850,y:11610});
  assert.ok(url.startsWith('https://data.geopf.fr/wmts?')&&url.includes('TILEMATRIX=15&TILEROW=11610&TILECOL=16850'));
  assert.ok(isIgnTileUrl(url));assert.ok(!isIgnTileUrl('https://a.tile.openstreetmap.org/15/1/2.png'));assert.ok(!isIgnTileUrl('pas une url'));
  const plan=planOfflineTiles(farm),urls=plannedUrls(plan,{layer:'ign-plan',cadastre:true});
  assert.equal(urls.length,plan.tiles.length*2);
  assert.ok(urls.every(isIgnTileUrl),'aucune tuile OSM ou Esri n’est prévue au téléchargement');
  assert.ok(urls.some(u=>u.includes('PLANIGNV2'))&&urls.some(u=>u.includes('CADASTRALPARCELS')));
});

test('estimation, plafond de 150 Mo et réduction du zoom',()=>{
  assert.equal(estimateBytes(10,{layer:'ign-photo'}),10*30*1024);
  assert.ok(estimateBytes(10,{layer:'ign-photo',cadastre:true})>estimateBytes(10,{layer:'ign-photo'}));
  const small=fitPlan(farm);assert.equal(small.reduced,false);assert.equal(small.tooLarge,false);assert.deepEqual(small.zooms,[12,13,14,15,16,17]);
  const huge=Array.from({length:400},(_,i)=>({id:`h${i}`,geometry:sq(4+(i%20)*0.05,45+Math.floor(i/20)*0.05)}));
  const fitted=fitPlan(huge,{cadastre:true});
  assert.ok(fitted.reduced&&fitted.zooms.at(-1)<17&&fitted.estimatedBytes<=TILE_CAP_BYTES);
});

test('éviction des tuiles les plus anciennes au-delà du plafond',()=>{
  const rows=[{url:'c',size:60,cachedAt:3},{url:'a',size:60,cachedAt:1},{url:'b',size:60,cachedAt:2}];
  assert.deepEqual(evictionList(rows,100),['a','b']);assert.deepEqual(evictionList(rows,500),[]);
});

test('lots de 6 requêtes',()=>{assert.deepEqual(chunk([1,2,3,4,5,6,7,8],6),[[1,2,3,4,5,6],[7,8]]);});

test('indicateur « à jour le … » et métadonnées tolérantes',()=>{
  assert.equal(offlineSummary(null),'Pas encore téléchargée');
  const meta=normalizeMeta({at:new Date('2026-10-07T09:00:00').getTime(),layer:'ign-photo',cadastre:true,tiles:154,bytes:4.5*1024*1024});
  assert.equal(offlineSummary(meta),'À jour le 07/10 · Photo IGN + cadastre · 4,5 Mo');
  assert.equal(normalizeMeta({at:1,layer:'osm'}),null);assert.equal(normalizeMeta('x'),null);
  assert.equal(formatBytes(2048),'2 Ko');assert.equal(formatBytes(160*1024*1024),'160 Mo');
});

test('service worker : cache « tiles-v1 » indépendant de BUILD, hors de CORE, conservé à l’activation',()=>{
  const sw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8'),runtime=fs.readFileSync(new URL('./runtime.js',import.meta.url),'utf8'),app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
  assert.match(sw,/const TILES=`\$\{PREFIX\}tiles-v1`;/);
  assert.match(sw,/\[STATIC,RUNTIME,TILES\]\.includes\(k\)/);
  const core=sw.slice(sw.indexOf('const CORE=['),sw.indexOf('];',sw.indexOf('const CORE=[')));
  assert.ok(!core.includes('tiles')&&!core.includes('geopf'));
  assert.match(sw,/data\.geopf\.fr'&&url\.pathname==='\/wmts'/);
  assert.equal(tileCacheName('/Parcelles/'),'parcelles-%2FParcelles%2F-tiles-v1');
  for(const file of ['./offline-map.js','./offline-map-ui.js']){assert.ok(core.includes(`'${file}'`));assert.ok(runtime.includes(`'${file}'`));}
  assert.match(app,/data-action="open-offline-map"/);assert.match(app,/action==='open-offline-map'/);
});
