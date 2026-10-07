import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BASE_LAYERS,normalizeBaseLayer,baseLayerDefinition,ignWmtsUrl,CADASTRE_OVERLAY,normalizeCadastreOpacity,DEFAULT_CADASTRE_OPACITY,cadastreQueryUrl,parseCadastreResponse,cadastreReference,cadastreInfoToParcel} from './basemaps.js';
import {Store} from './state.js';
import {addCadastreParcel} from './map-records.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

const square=[[[5.2,46.2],[5.201,46.2],[5.201,46.201],[5.2,46.201],[5.2,46.2]]];
const apiResponse={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'MultiPolygon',coordinates:[square]},properties:{numero:'0123',feuille:1,section:'AB',code_dep:'01',nom_com:'Bourg-en-Bresse',code_com:'053',com_abs:'000',code_arr:'000',idu:'01053000AB0123',code_insee:'01053',contenance:12345}}]};

test('quatre fonds de carte, les anciens noms restent valides', ()=>{
  assert.deepEqual(BASE_LAYERS.map(l=>l.id),['ign-photo','ign-plan','satellite','osm']);
  assert.equal(normalizeBaseLayer('satellite'),'satellite');
  assert.equal(normalizeBaseLayer('osm'),'osm');
  assert.equal(normalizeBaseLayer('ign-photo'),'ign-photo');
  for(const bad of [undefined,null,'','google','__proto__'])assert.equal(normalizeBaseLayer(bad),'osm');
  assert.equal(baseLayerDefinition('inconnu').id,'osm');
  for(const layer of BASE_LAYERS){assert.ok(layer.label&&layer.hint&&layer.attribution,`${layer.id} incomplet`);assert.match(layer.url,/^https:\/\//);}
});

test('les couches IGN utilisent le WMTS public de la Géoplateforme avec attribution', ()=>{
  const photo=baseLayerDefinition('ign-photo');
  assert.match(photo.url,/^https:\/\/data\.geopf\.fr\/wmts\?/);
  assert.match(photo.url,/LAYER=ORTHOIMAGERY\.ORTHOPHOTOS/);
  assert.match(photo.url,/FORMAT=image%2Fjpeg/);
  assert.match(photo.url,/TILEMATRIXSET=PM&TILEMATRIX=\{z\}&TILEROW=\{y\}&TILECOL=\{x\}$/);
  assert.match(baseLayerDefinition('ign-plan').url,/LAYER=GEOGRAPHICALGRIDSYSTEMS\.PLANIGNV2/);
  assert.match(CADASTRE_OVERLAY.url,/LAYER=CADASTRALPARCELS\.PARCELLAIRE_EXPRESS&STYLE=PCI\+vecteur/);
  assert.match(CADASTRE_OVERLAY.attribution,/IGN/);
  assert.doesNotMatch(ignWmtsUrl({layer:'X'}),/apikey|key=/i,'aucune clé dans les URL servies');
});

test('opacité du cadastre bornée entre 20 et 100 %', ()=>{
  assert.equal(normalizeCadastreOpacity(undefined),DEFAULT_CADASTRE_OPACITY);
  assert.equal(normalizeCadastreOpacity('abc'),DEFAULT_CADASTRE_OPACITY);
  assert.equal(normalizeCadastreOpacity(0),0.2);
  assert.equal(normalizeCadastreOpacity(5),1);
  assert.equal(normalizeCadastreOpacity(0.55),0.55);
});

test('requête API Carto cadastre au point touché', ()=>{
  const url=new URL(cadastreQueryUrl(46.2005,5.2005));
  assert.equal(url.origin+url.pathname,'https://apicarto.ign.fr/api/cadastre/parcelle');
  assert.deepEqual(JSON.parse(url.searchParams.get('geom')),{type:'Point',coordinates:[5.2005,46.2005]});
  assert.throws(()=>cadastreQueryUrl(120,5),/Position invalide/);
  assert.throws(()=>cadastreQueryUrl('x',5),/Position invalide/);
});

test('lecture de la réponse cadastrale', ()=>{
  const info=parseCadastreResponse(apiResponse);
  assert.equal(info.section,'AB');assert.equal(info.numero,'0123');assert.equal(info.commune,'Bourg-en-Bresse');
  assert.equal(info.idu,'01053000AB0123');assert.equal(info.inseeCode,'01053');assert.equal(info.contenanceM2,12345);
  assert.equal(info.geometry.type,'MultiPolygon');
  assert.equal(cadastreReference(info),'Section AB · n° 0123');
  assert.equal(parseCadastreResponse({type:'FeatureCollection',features:[]}),null);
  assert.equal(parseCadastreResponse(null),null);
  // IDU reconstitué quand l'API ne le fournit pas ; contenance absente = inconnue (pas 0).
  const partial=parseCadastreResponse({features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[5,46],[6,46,0]]]},properties:{section:'B',numero:'45',code_dep:'01',code_com:'053'}}]});
  assert.equal(partial.idu,'01053000 B0045'.replace(' ','0'));
  assert.equal(partial.contenanceM2,null);
  assert.equal(partial.geometry,null,'contour invalide ignoré');
  assert.throws(()=>cadastreInfoToParcel(partial),/contour cadastral/);
});

test('proposition de parcelle depuis le cadastre', ()=>{
  const parcel=cadastreInfoToParcel(parseCadastreResponse(apiResponse));
  assert.equal(parcel.nom,'Cadastre AB 0123');
  assert.equal(parcel.surfaceHa,1.2345);
  assert.equal(parcel.source,'cadastre');assert.equal(parcel.sourceId,'cadastre:01053000AB0123');
  assert.equal(parcel.cadastreSection,'AB');assert.equal(parcel.cadastreNumero,'0123');assert.equal(parcel.commune,'Bourg-en-Bresse');
});

class MemoryStorage{
  constructor(){this.value=null;}
  async init(){}
  async get(){return this.value;}
  async set(_k,v){this.value=structuredClone(v);}
  async backupPut(){}
  async pruneBackups(){}
  async blobDelete(){}
}

test('création d’une parcelle cadastrale, sans doublon, avec contrôle des droits', async()=>{
  const store=new Store(new MemoryStorage());await store.init();await store.setPreferences({autoBackup:false,syncEnabled:true});
  const info=parseCadastreResponse(apiResponse);
  const first=await addCadastreParcel(store,info,{nom:'  Champ du bas ',culture:'Blé'});
  assert.equal(first.created,true);
  assert.equal(first.parcel.nom,'Champ du bas');assert.equal(first.parcel.culture,'Blé');assert.equal(first.parcel.surfaceHa,1.2345);
  assert.equal(first.parcel.ownershipType,'own');assert.equal(first.parcel.geometry.type,'MultiPolygon');
  assert.ok(store.state.queue.some(item=>item.entity==='parcelles'&&item.entityId===first.parcel.id&&item.action==='create'),'création mise en file de synchronisation');
  const again=await addCadastreParcel(store,info,{nom:'Autre nom'});
  assert.equal(again.created,false);assert.equal(again.parcel.id,first.parcel.id);
  assert.equal(store.state.parcelles.length,1);
  // Sans contenance, la surface est calculée depuis le contour (jamais inventée).
  const noArea={...info,idu:'01053000AB0124',numero:'0124',contenanceM2:null};
  const second=await addCadastreParcel(store,noArea,{nom:'Calculée'});
  assert.ok(second.parcel.surfaceHa>0.5&&second.parcel.surfaceHa<1.5,`surface calculée : ${second.parcel.surfaceHa}`);
  await assert.rejects(()=>addCadastreParcel(store,{...info,idu:'01053000AB0125'},{nom:''}),/Nom de parcelle manquant/);
  await assert.rejects(()=>addCadastreParcel(store,{...info,idu:'01053000AB0126'},{nom:'Client',ownershipType:'client'}),/client/i);
  const withClient=await addCadastreParcel(store,{...info,idu:'01053000AB0127'},{nom:'Prestation',ownershipType:'service',newClientName:'GAEC Voisin'});
  assert.ok(withClient.parcel.clientId);assert.equal(store.state.clients.length,1);
  store.setWriteGuard(()=>false);
  await assert.rejects(()=>addCadastreParcel(store,{...info,idu:'01053000AB0128'},{nom:'Interdit'}),/rôle/);
});

test('le module est précaché et branché sur le panneau Couches', ()=>{
  const core=new Set([...read('sw.js').match(/const CORE=\[([\s\S]*?)\];/)[1].matchAll(/'(\.\/[^']*)'/g)].map(m=>m[1]));
  assert.ok(core.has('./basemaps.js'));
  const app=read('app.js');
  assert.match(app,/data-ly="cadastre"|sw\('cadastre'/);
  assert.match(app,/action==='add-cadastre-parcel'/);
});
