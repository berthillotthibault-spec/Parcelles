// n° 48 : couches réglementaires et évaluation indicative (géométries synthétiques, réponses WFS simulées).
import assert from 'node:assert/strict';
import test from 'node:test';
import {BUFFER_GROUP, REG_LAYERS, distanceToLines, evaluateParcel, evaluationMessages, evaluationRequests, excludeWaterBuffer, normalizeRegLayers, pointDistanceToLines, regulatoryRules, wfsUrl} from './regulatory.js';
import {createRegulatoryUI} from './regulatory-ui.js';

const sq=(x0,y0,w=0.01,h=0.01)=>({type:'Polygon',coordinates:[[[x0,y0],[x0+w,y0],[x0+w,y0+h],[x0,y0+h],[x0,y0]]]});
const line=coords=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:coords}});
const fc=features=>({type:'FeatureCollection',features});
const metersLon=m=>m/(111320*Math.cos(46.005*Math.PI/180));

test('couches publiques sans clé, HTTPS, datées et sourcées', ()=>{
  assert.deepEqual(REG_LAYERS.map(l=>l.id),['bcae','hydro','natura-sic','natura-zps','zv','pentes']);
  for(const layer of REG_LAYERS){
    assert.match(layer.url,/^https:\/\/(data\.geopf\.fr|services\.sandre\.eaufrance\.fr)\//);
    assert.ok(!/apikey|key=/i.test(layer.url));
    assert.ok(layer.date&&layer.source&&layer.attribution);
  }
  assert.match(REG_LAYERS[0].url,/LAYER=HYDROGRAPHY\.BCAE\.LATEST.*TILEMATRIXSET=PM_6_17.*\{z\}/);
  assert.deepEqual(normalizeRegLayers(['zv','inconnu','bcae']),['bcae','zv']);
  assert.deepEqual(normalizeRegLayers('x'),[]);
});

test('requêtes WFS : CRS:84, emprise élargie, Natura sans géométrie', ()=>{
  const url=new URL(wfsUrl('BDTOPO_V3:troncon_hydrographique',[5,46,5.01,46.01]));
  assert.equal(url.hostname,'data.geopf.fr');
  assert.equal(url.searchParams.get('BBOX'),'5.000000,46.000000,5.010000,46.010000,CRS:84');
  const requests=evaluationRequests(sq(5,46));
  assert.deepEqual(requests.map(r=>r.key),['bcae','hydro','sic','zps']);
  assert.equal(new URL(requests[2].url).searchParams.get('PROPERTYNAME'),'nom_site,url_fiche');
  assert.ok(Number(new URL(requests[0].url).searchParams.get('BBOX').split(',')[0])<5);
});

test('distance contour – cours d’eau', ()=>{
  const g=sq(5,46);
  const east=[[5.01+metersLon(12),45.99],[5.01+metersLon(12),46.02]];
  assert.ok(Math.abs(distanceToLines(g,[east])-12)<0.5);
  assert.equal(distanceToLines(g,[[[5.005,45.99],[5.005,46.02]]]),0,'traverse la parcelle');
  assert.equal(distanceToLines(g,[]),null);
  assert.ok(Math.abs(pointDistanceToLines(5.01,46.005,[east])-12)<0.5);
});

test('évaluation et bandeau : BCAE à 12 m, Natura 2000, partiel', ()=>{
  const parcel={id:'p1',geometry:sq(5,46)};
  const bcae=fc([line([[5.01+metersLon(12),45.99],[5.01+metersLon(12),46.02]])]);
  const sic=fc([{type:'Feature',geometry:null,properties:{nom_site:'Site fictif',url_fiche:'https://inpn.mnhn.fr/site/natura2000/FR0000000'}}]);
  const ev=evaluateParcel(parcel,{bcae,hydro:fc([]),sic,zps:null},{at:1});
  assert.equal(Math.round(ev.bcaeM),12);
  assert.equal(ev.partial,true);
  const messages=evaluationMessages(ev);
  assert.match(messages[0].text,/Cours d’eau BCAE à 12 m : bande tampon de 5 m et ZNT 5 m minimum, 20, 50, 100 m selon le produit/);
  assert.match(messages[1].text,/Natura 2000 : Site fictif/);
  assert.equal(messages[1].links[0].url,'https://inpn.mnhn.fr/site/natura2000/FR0000000');
  assert.ok(messages.some(m=>/partielle/.test(m.text)));
  const far=evaluateParcel(parcel,{bcae:fc([]),hydro:fc([]),sic:fc([]),zps:fc([])});
  assert.deepEqual(evaluationMessages(far).map(m=>m.level),['info']);
});

test('valeurs indicatives modifiables et bornées', ()=>{
  const r=regulatoryRules({zntMinM:20,zntOptionsM:[50,'x',20,20],bcaeBufferM:-3,date:'2027-01'});
  assert.equal(r.zntMinM,20);assert.deepEqual(r.zntOptionsM,[20,50]);assert.equal(r.bcaeBufferM,5);assert.equal(r.date,'2027-01');assert.equal(r.custom,true);
  assert.equal(regulatoryRules().custom,false);
});

test('préconisation : bande exclue le long du cours d’eau, réversible', ()=>{
  const cells=[];for(let i=0;i<10;i++)cells.push({id:`${i}:0`,group:'A',enabled:true,areaHa:0.01,geometry:sq(5+i*metersLon(10),46,metersLon(10),0.00009)});
  const zones={parcelId:'p1',cells};
  const water=[[[5-metersLon(1),45.99],[5-metersLon(1),46.01]]]; // à 1 m à l'ouest de la première cellule
  const {zones:out,excluded}=excludeWaterBuffer(zones,water,20);
  assert.equal(excluded,2,'centres à 6 m et 16 m');
  assert.deepEqual(out.cells.slice(0,3).map(c=>c.group),[BUFFER_GROUP,BUFFER_GROUP,'A']);
  const back=excludeWaterBuffer(out,[],1).zones;
  assert.ok(back.cells.every(c=>c.group==='A'));
});

test('UI : hors connexion, la dernière évaluation mémorisée reste affichée', async()=>{
  const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
  let calls=0,isOnline=true;
  const fetchImpl=async url=>{calls++;const type=new URL(url).searchParams.get('TYPENAMES');return{ok:true,json:async()=>type.startsWith('HYDROGRAPHY.BCAE')?fc([line([[5.01+metersLon(12),45.99],[5.01+metersLon(12),46.02]])]):fc([])};};
  const ui=createRegulatoryUI({state:()=>({preferences:{}}),store:{},parcelMap:{},toast(){},modal(){},fetchImpl,storage,doc:{querySelector:()=>null},online:()=>isOnline});
  const parcel={id:'p1',geometry:sq(5,46)};
  const ev=await ui.evaluate(parcel);
  assert.equal(calls,4);assert.equal(Math.round(ev.bcaeM),12);assert.ok(ev.lines.length>=1);
  isOnline=false;
  const html=ui.parcelHtml(parcel);
  assert.match(html,/Cours d’eau BCAE à 12 m/);assert.match(html,/indicatif/);
  assert.equal((await ui.waterLines(parcel)).length,ev.lines.length,'lignes en cache hors connexion');
  await assert.rejects(()=>ui.waterLines({id:'p2',geometry:sq(6,46)}),/connectez-vous/);
});

test('préconisation : une cellule traversée par le cours d’eau loin de son centre passe en ZNT', ()=>{
  const cell={id:'0:0',group:'A',enabled:true,areaHa:0.09,geometry:sq(5,46,metersLon(30),0.00027)};
  const water=[[[5+metersLon(23),45.99],[5+metersLon(23),46.01]]]; // traverse la cellule à 8 m de son centre
  const {zones:out,excluded}=excludeWaterBuffer({parcelId:'p1',cells:[cell]},water,5);
  assert.equal(excluded,1);assert.equal(out.cells[0].group,BUFFER_GROUP);
});

test('UI : cours d’eau injoignables, Natura joignable, les lignes connues ne sont pas effacées', async()=>{
  const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
  let waterDown=false;
  const fetchImpl=async url=>{const type=new URL(url).searchParams.get('TYPENAMES');if(waterDown&&/^(HYDROGRAPHY|BDTOPO)/.test(type))throw new Error('timeout');return{ok:true,json:async()=>type.startsWith('HYDROGRAPHY.BCAE')?fc([line([[5.01+metersLon(12),45.99],[5.01+metersLon(12),46.02]])]):fc([])};};
  const ui=createRegulatoryUI({state:()=>({preferences:{}}),store:{},parcelMap:{},toast(){},modal(){},fetchImpl,storage,doc:{querySelector:()=>null},online:()=>true});
  const parcel={id:'p1',geometry:sq(5,46)};
  const known=(await ui.evaluate(parcel)).lines;assert.ok(known.length>=1);
  waterDown=true;
  assert.deepEqual(await ui.waterLines(parcel),known,'lignes de la dernière évaluation');
  assert.deepEqual(await ui.waterLines(parcel),known,'cache non écrasé');
  await assert.rejects(()=>ui.waterLines({id:'p2',geometry:sq(6,46)}),/connectez-vous/);
});
