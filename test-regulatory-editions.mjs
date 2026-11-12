// Chantier W4 : édition BCAE détectée (source auto-update) et couche WFS absente (HTTP 400) signalée à part.
import assert from 'node:assert/strict';
import test from 'node:test';
import {BCAE_EDITION_URL, REG_LAYERS, bcaeEditionSource, classifyWfsFailure, evaluateParcel, evaluationMessages, missingTypeResponse, parseBcaeMillesim, regLayersWithEditions} from './regulatory.js';
import {createRegulatoryUI} from './regulatory-ui.js';

const sq=(x0,y0,w=0.01,h=0.01)=>({type:'Polygon',coordinates:[[[x0,y0],[x0+w,y0],[x0+w,y0+h],[x0,y0+h],[x0,y0]]]});
const fc=features=>({type:'FeatureCollection',features});
const at=iso=>Date.parse(iso);
const millesim=v=>({type:'FeatureCollection',features:[{type:'Feature',properties:{millesim:v}}]});

test('parseBcaeMillesim : valide, absent, non numérique, futur', ()=>{
  const now=at('2026-11-12T10:00:00Z');
  assert.equal(parseBcaeMillesim(millesim('2026'),{now}),2026);
  assert.equal(parseBcaeMillesim(millesim(2025),{now}),2025);
  assert.equal(parseBcaeMillesim({features:[]},{now}),null);
  assert.equal(parseBcaeMillesim(null,{now}),null);
  assert.equal(parseBcaeMillesim(millesim('vingt'),{now}),null);
  assert.equal(parseBcaeMillesim(millesim('1999'),{now}),null);
  assert.equal(parseBcaeMillesim(millesim('2027'),{now}),null,'année future rejetée');
  assert.equal(parseBcaeMillesim(millesim('2027'),{now:at('2027-01-03T10:00:00Z')}),2027);
});

test('source bcae-edition : contrat du registre et check avec fetch simulé', async()=>{
  assert.equal(bcaeEditionSource.id,'bcae-edition');
  assert.equal(bcaeEditionSource.label,'Cours d’eau BCAE');
  assert.deepEqual(bcaeEditionSource.embedded.value,{year:2026});
  assert.ok([864e5,7*864e5].includes(bcaeEditionSource.ttlMs));
  const url=new URL(BCAE_EDITION_URL);
  assert.equal(url.hostname,'data.geopf.fr');
  assert.equal(url.searchParams.get('PROPERTYNAME'),'millesim');
  assert.equal(url.searchParams.get('COUNT'),'1');
  const calls=[];
  const fetch=async(u,opts)=>{calls.push({u,opts});return{ok:true,status:200,json:async()=>millesim('2026')};};
  const signal=new AbortController().signal;
  const result=await bcaeEditionSource.check({fetch,signal,now:()=>at('2026-11-12T10:00:00Z')});
  assert.deepEqual(result.value,{year:2026});assert.equal(result.version,'2026');
  assert.equal(calls.length,1);assert.equal(calls[0].u,BCAE_EDITION_URL);assert.equal(calls[0].opts.signal,signal);
  assert.equal(bcaeEditionSource.validate(result),true);
  assert.equal(bcaeEditionSource.validate({value:{year:'2026'}}),false);
  await assert.rejects(()=>bcaeEditionSource.check({fetch:async()=>({ok:false,status:503}),now:Date.now()}),/HTTP 503/);
  await assert.rejects(()=>bcaeEditionSource.check({fetch:async()=>({ok:true,json:async()=>millesim('abc')}),now:Date.now()}),/invalide/);
});

test('regLayersWithEditions : copie, REG_LAYERS non muté', ()=>{
  const before=JSON.stringify(REG_LAYERS);
  const layers=regLayersWithEditions(REG_LAYERS,{bcaeYear:2027});
  assert.equal(layers.find(l=>l.id==='bcae').date,'édition 2027');
  assert.equal(layers.find(l=>l.id==='pentes').date,'2017','pentes inchangées');
  assert.equal(JSON.stringify(REG_LAYERS),before);
  assert.equal(REG_LAYERS[0].date,'édition 2026');
  assert.notEqual(layers[0],REG_LAYERS[0]);
  assert.equal(regLayersWithEditions(REG_LAYERS,{bcaeYear:'x'})[0].date,'édition 2026','année invalide : libellé embarqué');
  assert.equal(regLayersWithEditions(REG_LAYERS)[0].date,'édition 2026');
});

test('classifyWfsFailure : HTTP 400 ou ExceptionReport, sinon réseau', ()=>{
  assert.equal(classifyWfsFailure({status:400}),'missing-type');
  assert.equal(classifyWfsFailure({status:200,body:'<ows:ExceptionReport>'}),'missing-type');
  assert.equal(classifyWfsFailure({status:503,body:'Service Unavailable'}),'network');
  assert.equal(classifyWfsFailure(),'network');
});

test('evaluateParcel : 400 sur sic/zps donne unavailable natura2000 et un message explicite', ()=>{
  const parcel={id:'p1',geometry:sq(5,46)};
  const ev=evaluateParcel(parcel,{bcae:fc([]),hydro:fc([]),sic:missingTypeResponse(400),zps:missingTypeResponse(400)},{at:1});
  assert.ok(ev.unavailable.includes('natura2000'));
  assert.deepEqual(ev.missingTypes.sort(),['sic','zps']);
  assert.equal(ev.natura,undefined);assert.equal(ev.partial,true);
  const texts=evaluationMessages(ev).map(m=>m.text);
  assert.ok(texts.some(t=>/contrôle Natura 2000 indisponible \(couche absente du service IGN, HTTP 400\)/.test(t)),texts.join('|'));
  const net=evaluateParcel(parcel,{bcae:fc([]),hydro:null,sic:fc([]),zps:fc([])});
  assert.deepEqual(net.unavailable,['hydro']);assert.deepEqual(net.missingTypes,[]);
  assert.ok(evaluationMessages(net).some(m=>/cours d’eau BD TOPO indisponible \(service IGN injoignable\)/.test(m.text)));
  const full=evaluateParcel(parcel,{bcae:fc([]),hydro:fc([]),sic:fc([]),zps:fc([])});
  assert.deepEqual(full.unavailable,[]);
  // Ancienne évaluation en cache, sans unavailable : message générique conservé.
  assert.ok(evaluationMessages({partial:true}).some(m=>/un service public n’a pas répondu/.test(m.text)));
});

test('UI : HTTP 400 distingué de la panne réseau, édition BCAE dans le panneau Couches', async()=>{
  const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
  const fetchImpl=async url=>{const type=new URL(url).searchParams.get('TYPENAMES');
    if(type.startsWith('patrinat_sic'))return{ok:false,status:400,text:async()=>'<ows:ExceptionReport>Unknown type</ows:ExceptionReport>'};
    if(type.startsWith('patrinat_zps'))throw new Error('timeout');
    return{ok:true,json:async()=>fc([])};};
  const ui=createRegulatoryUI({state:()=>({preferences:{}}),store:{},parcelMap:{},toast(){},modal(){},fetchImpl,storage,doc:{querySelector:()=>null},online:()=>true,bcaeYear:()=>2027});
  const ev=await ui.evaluate({id:'p1',geometry:sq(5,46)});
  assert.deepEqual(ev.missingTypes,['sic']);assert.deepEqual(ev.unavailable,['natura2000']);
  assert.match(ui.layersHtml(),/Bandes tampons obligatoires \(BCAE 4\) · édition 2027/);
  const fallback=createRegulatoryUI({state:()=>({preferences:{}}),store:{},parcelMap:{},toast(){},modal(){},fetchImpl,storage,doc:{querySelector:()=>null},online:()=>true,bcaeYear:()=>{throw new Error('pas de registre');}});
  assert.match(fallback.layersHtml(),/édition 2026/);
  const allMissing=createRegulatoryUI({state:()=>({preferences:{}}),store:{},parcelMap:{},toast(){},modal(){},fetchImpl:async()=>({ok:false,status:400,text:async()=>''}),storage,doc:{querySelector:()=>null},online:()=>true});
  await assert.rejects(()=>allMissing.evaluate({id:'p2',geometry:sq(6,46)}),/absentes du service IGN \(HTTP 400\)/);
});

test('UI : ExceptionReport servi en HTTP 200 compté comme couche absente, pas comme panne réseau', async()=>{
  const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
  const fetchImpl=async url=>{const type=new URL(url).searchParams.get('TYPENAMES');
    if(type.startsWith('patrinat_sic'))return{ok:true,status:200,text:async()=>'<?xml version="1.0"?><ows:ExceptionReport>Unknown type</ows:ExceptionReport>'};
    return{ok:true,status:200,text:async()=>JSON.stringify(fc([]))};};
  const ui=createRegulatoryUI({state:()=>({preferences:{}}),store:{},parcelMap:{},toast(){},modal(){},fetchImpl,storage,doc:{querySelector:()=>null},online:()=>true});
  const ev=await ui.evaluate({id:'p9',geometry:sq(5,46)});
  assert.deepEqual(ev.missingTypes,['sic']);
});

test('evaluationMessages : Natura 2000 incomplet quand un seul des services SIC/ZPS répond', ()=>{
  const parcel={id:'p3',geometry:sq(5,46)};
  const site={type:'Feature',geometry:sq(5,46),properties:{nom_site:'Vallée test',url_fiche:'https://inpn.mnhn.fr/site/natura2000/FR0000000'}};
  const ev=evaluateParcel(parcel,{bcae:fc([]),hydro:fc([]),sic:missingTypeResponse(400),zps:fc([site])});
  assert.deepEqual(ev.unavailable,['natura2000']);
  const texts=evaluationMessages(ev).map(m=>m.text);
  assert.ok(texts.some(t=>/Natura 2000 : Vallée test/.test(t)));
  assert.ok(texts.some(t=>/contrôle Natura 2000 incomplet \(couche absente du service IGN, HTTP 400\)/.test(t)),texts.join('|'));
  assert.ok(!texts.some(t=>/Natura 2000 indisponible/.test(t)));
});
