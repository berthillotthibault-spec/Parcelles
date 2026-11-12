// A5 — détection automatique des zones vulnérables (WFS Sandre, GML sans géométrie). Aucun réseau réel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  zvRequestUrl,parseZvGml,createZvCache,zvCacheKey,zvAutoFor,zvAutoResolver,detectZvForParcel,detectZvBatch,zvUpdaterSource,ZV_PENDING_TTL_MS,
  ZV_CACHE_KEY,ZV_TTL_MS
} from './zv-detect.js';

// Extrait réel (11/11/2026, bbox Beauce 48.20,1.60) : 2 entités, bassin G, arrêté 21.231.
const GML_IN=`<?xml version='1.0' encoding="UTF-8" ?>
<wfs:FeatureCollection xmlns:sa="http://xml.sandre.eaufrance.fr/" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:wfs="http://www.opengis.net/wfs/2.0" timeStamp="2026-11-12T00:22:39" numberMatched="2" numberReturned="2">
    <wfs:boundedBy><gml:Envelope srsName="urn:ogc:def:crs:EPSG::4326"><gml:lowerCorner>45.086339 -5.141277</gml:lowerCorner><gml:upperCorner>48.900972 4.611549</gml:upperCorner></gml:Envelope></wfs:boundedBy>
    <wfs:member>
      <sa:ZoneVuln_designation_FXX gml:id="ZoneVuln_designation_FXX.FRG_43">
        <sa:NomZoneVuln>désignation</sa:NomZoneVuln>
        <sa:DateMajZoneVuln gml:id="ZoneVuln_designation_FXX.FRG_43.DateMajZoneVuln"><gml:timePosition>2021-12-07</gml:timePosition></sa:DateMajZoneVuln>
        <sa:CdBassinDCE>G</sa:CdBassinDCE>
        <sa:NumTexteReglem>21.231</sa:NumTexteReglem>
        <sa:DatePubliTexteReglem gml:id="ZoneVuln_designation_FXX.FRG_43.DatePubliTexteReglem"><gml:timePosition>2021-08-30</gml:timePosition></sa:DatePubliTexteReglem>
      </sa:ZoneVuln_designation_FXX>
    </wfs:member>
    <wfs:member>
      <sa:ZoneVuln_designation_FXX gml:id="ZoneVuln_designation_FXX.FRG_ZV_2021_1">
        <sa:NomZoneVuln>désignation</sa:NomZoneVuln>
        <sa:DateMajZoneVuln gml:id="ZoneVuln_designation_FXX.FRG_ZV_2021_1.DateMajZoneVuln"><gml:timePosition>2024-09-04</gml:timePosition></sa:DateMajZoneVuln>
        <sa:CdBassinDCE>G</sa:CdBassinDCE>
        <sa:NumTexteReglem>21.231</sa:NumTexteReglem>
        <sa:DatePubliTexteReglem gml:id="ZoneVuln_designation_FXX.FRG_ZV_2021_1.DatePubliTexteReglem"><gml:timePosition>2021-08-30</gml:timePosition></sa:DatePubliTexteReglem>
      </sa:ZoneVuln_designation_FXX>
    </wfs:member>
</wfs:FeatureCollection>`;
// Extrait réel (bbox Alpes 45.10,6.10) : aucune entité.
const GML_OUT=`<?xml version='1.0' encoding="UTF-8" ?>
<wfs:FeatureCollection xmlns:sa="http://xml.sandre.eaufrance.fr/" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:wfs="http://www.opengis.net/wfs/2.0" timeStamp="2026-11-12T00:22:40" numberMatched="unknown" numberReturned="0">
</wfs:FeatureCollection>`;
const GML_ERR=`<?xml version="1.0" encoding="UTF-8"?>
<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1" version="2.0.0" xml:lang="en-US">
  <ows:Exception exceptionCode="InvalidParameterValue" locator="typename">
    <ows:ExceptionText>msWFSGetFeature(): WFS server error. TYPENAME 'Nope' doesn't exist in this server.</ows:ExceptionText>
  </ows:Exception>
</ows:ExceptionReport>`;

const square=(lon,lat,d=0.002)=>({type:'Polygon',coordinates:[[[lon-d,lat-d],[lon+d,lat-d],[lon+d,lat+d],[lon-d,lat+d],[lon-d,lat-d]]]});
const parcel=(id,lon=1.6,lat=48.2)=>({id,nom:id,geometry:square(lon,lat)});
const memStorage=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),map:m};};
const okFetch=(body,calls=[])=>async(url,opts)=>{calls.push(url);return{ok:true,status:200,text:async()=>body};};
const T0=Date.UTC(2026,10,12,8);

test('zvRequestUrl : BBOX dans l’ordre lat,lon, attributs seulement, aucune géométrie', ()=>{
  const url=zvRequestUrl({latitude:48.2,longitude:1.6});
  assert.match(url,/^https:\/\/services\.sandre\.eaufrance\.fr\/geo\/zon\?SERVICE=WFS&VERSION=2\.0\.0&REQUEST=GetFeature/);
  assert.match(url,/TYPENAMES=sa:ZoneVuln_designation_FXX/);
  assert.match(url,/BBOX=48\.1995,1\.5995,48\.2005,1\.6005,urn:ogc:def:crs:EPSG::4326/);
  assert.match(url,/PROPERTYNAME=NomZoneVuln,CdBassinDCE,NumTexteReglem,DatePubliTexteReglem,DateMajZoneVuln/);
  assert.match(url,/COUNT=5/);
  assert.doesNotMatch(url,/geom|msGeometry|the_geom/i);
  assert.throws(()=>zvRequestUrl(null),/Centre/);
});

test('parseZvGml : extrait réel en zone (2 entités, bassin G, arrêté 21.231), hors zone, ExceptionReport', ()=>{
  const r=parseZvGml(GML_IN,null);
  assert.equal(r.inZone,true);
  assert.equal(r.zones.length,2);
  assert.deepEqual(r.zones[0],{nom:'désignation',bassin:'G',arrete:'21.231',datePubli:'2021-08-30',dateMaj:'2021-12-07'});
  assert.equal(r.zones[1].dateMaj,'2024-09-04');
  assert.deepEqual(parseZvGml(GML_OUT,null),{inZone:false,zones:[]});
  assert.throws(()=>parseZvGml(GML_ERR,null),/Sandre : msWFSGetFeature/);
  assert.throws(()=>parseZvGml('<html>panne</html>',null),/inattendue/);
});

test('parseZvGml : DOMParser injecté utilisé quand il existe', ()=>{
  // Faux DOMParser minimal : vérifie seulement le branchement et la lecture par localName.
  const el=(text)=>({textContent:text});
  const member={getElementsByTagNameNS:(_ns,name)=>({NomZoneVuln:[el(' désignation ')],CdBassinDCE:[el('G')],NumTexteReglem:[el('21.231')],DatePubliTexteReglem:[el('2021-08-30')],DateMajZoneVuln:[el('\n2021-12-07\n')]})[name]||[]};
  class FakeParser{parseFromString(){return{getElementsByTagName:()=>[],getElementsByTagNameNS:(_ns,name)=>name==='member'?[member]:[]};}}
  const r=parseZvGml(GML_IN,FakeParser);
  assert.equal(r.inZone,true);
  assert.deepEqual(r.zones,[{nom:'désignation',bassin:'G',arrete:'21.231',datePubli:'2021-08-30',dateMaj:'2021-12-07'}]);
});

test('cache : clé id + centre arrondi, stockage qui lève sans planter, une entrée par parcelle', ()=>{
  const p=parcel('p1');
  assert.equal(zvCacheKey(p),'p1:48.2000,1.6000');
  assert.equal(zvCacheKey({id:'x'}),null);
  const throwing={getItem(){throw new Error('bloqué');},setItem(){throw new Error('bloqué');}};
  const c=createZvCache(throwing);
  c.set('p1:1,1',{inZone:true});
  assert.deepEqual(c.get('p1:1,1'),{inZone:true});
  const s=memStorage(),c2=createZvCache(s);
  c2.set('p1:1,1',{inZone:true});c2.set('p1:2,2',{inZone:false});c2.set('p10:1,1',{inZone:true});
  assert.equal(c2.get('p1:1,1'),null,'ancien contour remplacé');
  assert.ok(c2.get('p10:1,1'),'p10 n’est pas confondu avec p1');
  assert.ok(JSON.parse(s.map.get(ZV_CACHE_KEY))['p1:2,2']);
  assert.equal(createZvCache(s).get('p1:2,2').inZone,false,'relu depuis le stockage');
});

test('detectZvForParcel : réseau, puis cache frais sans fetch, puis TTL de 30 jours', async ()=>{
  const cache=createZvCache(memStorage()),calls=[];let t=T0;
  const p=parcel('p1');
  const r=await detectZvForParcel({parcel:p,fetch:okFetch(GML_IN,calls),cache,now:()=>t,online:()=>true});
  assert.equal(r.origin,'reseau');assert.equal(r.inZone,true);assert.equal(r.checkedAt,T0);assert.equal(calls.length,1);
  assert.match(calls[0],/BBOX=48\.1995,1\.5995/);
  t=T0+ZV_TTL_MS-1;
  const r2=await detectZvForParcel({parcel:p,fetch:okFetch(GML_IN,calls),cache,now:()=>t,online:()=>true});
  assert.equal(r2.origin,'cache');assert.equal(calls.length,1,'cache frais : pas de fetch');
  t=T0+ZV_TTL_MS+1;
  await detectZvForParcel({parcel:p,fetch:okFetch(GML_OUT,calls),cache,now:()=>t,online:()=>true});
  assert.equal(calls.length,2);
  assert.equal(zvAutoFor(p,cache).inZone,false);
  assert.equal(zvAutoResolver(cache,id=>id==='p1'?p:null)('p1').inZone,false);
  assert.equal(zvAutoResolver(cache,()=>null)('zz'),null);
});

test('detectZvForParcel : une erreur conserve la valeur, sans cache le statut reste inconnu', async ()=>{
  const cache=createZvCache(memStorage()),p=parcel('p1');
  await detectZvForParcel({parcel:p,fetch:okFetch(GML_IN),cache,now:()=>T0,online:()=>true});
  const fail=async()=>({ok:false,status:503,text:async()=>''});
  const kept=await detectZvForParcel({parcel:p,fetch:fail,cache,now:()=>T0+1,force:true,online:()=>true});
  assert.equal(kept.inZone,true,'jamais « hors zone » sur une erreur');assert.equal(kept.origin,'cache');assert.match(kept.error,/503/);
  const exc=await detectZvForParcel({parcel:p,fetch:okFetch(GML_ERR),cache,now:()=>T0+2,force:true,online:()=>true});
  assert.equal(exc.inZone,true);
  const off=await detectZvForParcel({parcel:p,fetch:()=>assert.fail('pas de fetch hors ligne'),cache,now:()=>T0+3,force:true,online:()=>false});
  assert.equal(off.inZone,true);assert.match(off.error,/Hors ligne/);
  const fresh=createZvCache(memStorage());
  const none=await detectZvForParcel({parcel:p,fetch:fail,cache:fresh,now:()=>T0,online:()=>true});
  assert.equal(none.inZone,null);assert.equal(none.origin,'aucun');
  assert.equal(fresh.entries().length,0,'aucune valeur inventée');
  const noGeom=await detectZvForParcel({parcel:{id:'x'},fetch:()=>assert.fail('pas de fetch'),cache:fresh,online:()=>true});
  assert.equal(noGeom.inZone,null);
});

test('detectZvForParcel : délai dépassé, requête abandonnée', async ()=>{
  const cache=createZvCache(memStorage());let aborted=false;
  const hang=(url,{signal})=>new Promise(()=>{signal?.addEventListener('abort',()=>{aborted=true;});});
  const r=await detectZvForParcel({parcel:parcel('p1'),fetch:hang,cache,now:()=>T0,timeoutMs:20,online:()=>true});
  assert.equal(r.inZone,null);assert.match(r.error,/délai/);assert.equal(aborted,true);
});

test('detectZvBatch : séquentiel, 10 parcelles au plus par passage, jamais vues d’abord', async ()=>{
  const cache=createZvCache(memStorage()),calls=[];let inFlight=0,maxInFlight=0;
  const parcels=Array.from({length:14},(_,i)=>parcel(`p${i}`,1.6+i*0.01,48.2));
  parcels.push({id:'sans-contour'},{...parcel('supprimee'),deletedAt:1});
  const f=async url=>{calls.push(url);inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await new Promise(r=>setTimeout(r,1));inFlight--;return{ok:true,status:200,text:async()=>GML_IN};};
  const r=await detectZvBatch(parcels,{fetch:f,cache,now:()=>T0,online:()=>true});
  assert.equal(calls.length,10);assert.equal(maxInFlight,1);
  assert.deepEqual({checked:r.checked,inZone:r.inZone,known:r.known,remaining:r.remaining},{checked:10,inZone:10,known:10,remaining:4});
  const r2=await detectZvBatch(parcels,{fetch:f,cache,now:()=>T0+1000,online:()=>true});
  assert.equal(r2.checked,4);assert.equal(calls.length,14);assert.equal(r2.remaining,0);
  const r3=await detectZvBatch(parcels,{fetch:f,cache,now:()=>T0+2000,online:()=>true});
  assert.equal(r3.checked,0,'tout est frais');
});

test('zvUpdaterSource : source agrégée conforme au registre (value, version, note)', async ()=>{
  const cache=createZvCache(memStorage()),parcels=[parcel('a'),parcel('b',6.1,45.1)];
  const src=zvUpdaterSource({getParcels:()=>parcels,cache});
  assert.equal(src.id,'zones-vulnerables');assert.equal(src.label,'Zones vulnérables (Sandre)');
  const f=async url=>({ok:true,status:200,text:async()=>/BBOX=48/.test(url)?GML_IN:GML_OUT});
  const r=await src.check({fetch:f,now:()=>T0});
  assert.equal(r.value.checked,2);assert.equal(r.value.inZone,1);assert.equal(r.version,'1/2');
  assert.ok(src.validate(r));
  const failing=zvUpdaterSource({getParcels:()=>[parcel('c')],cache:createZvCache(memStorage())});
  await assert.rejects(failing.check({fetch:async()=>({ok:false,status:500}),now:T0}),/injoignable/);
});

test('zvUpdaterSource : un passage sur 0 parcelle ne bloque pas 12 h les parcelles ajoutées ensuite', async ()=>{
  const cache=createZvCache(memStorage()),parcels=[];
  const src=zvUpdaterSource({getParcels:()=>parcels,cache,now:()=>T0});
  assert.equal(src.ttlMs,12*3600*1000,'rien à vérifier : durée normale');
  parcels.push(parcel('a'));
  assert.equal(src.ttlMs,ZV_PENDING_TTL_MS,'parcelle sans résultat : revérifiée après 10 min');
  await src.check({fetch:async()=>({ok:true,status:200,text:async()=>GML_IN}),now:()=>T0});
  assert.equal(src.ttlMs,12*3600*1000,'résultat frais : durée normale');
});

test('revue : le repli sans DOMParser décode les entités numériques (accents)', ()=>{
  const xml=GML_IN.replace('<sa:NomZoneVuln>désignation</sa:NomZoneVuln>','<sa:NomZoneVuln>d&#233;signation &#xE9;t&#xe9; &amp; co</sa:NomZoneVuln>');
  const r=parseZvGml(xml,null);
  assert.equal(r.zones[0].nom,'désignation été & co');
  assert.equal(r.zones[0].dateMaj,'2021-12-07');
});

test('revue : le signal du registre interrompt la requête en cours, sans attendre le délai', async ()=>{
  const cache=createZvCache(memStorage()),ctrl=new AbortController();let aborted=false,calls=0;
  const hang=(url,{signal})=>{calls++;return new Promise(()=>{signal?.addEventListener('abort',()=>{aborted=true;});});};
  setTimeout(()=>ctrl.abort(),15);
  const t=Date.now();
  const r=await detectZvBatch([parcel('a'),parcel('b',1.7,48.2)],{fetch:hang,cache,now:()=>T0,timeoutMs:5000,online:()=>true,signal:ctrl.signal});
  assert.ok(Date.now()-t<2000,'pas d’attente du délai de 5 s');
  assert.equal(aborted,true);assert.equal(calls,1,'la parcelle suivante n’est pas lancée');
  assert.deepEqual({checked:r.checked,errors:r.errors,known:r.known},{checked:0,errors:1,known:0});
  assert.equal(cache.entries().length,0,'aucune valeur inventée');
});
