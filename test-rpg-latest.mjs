import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRpgLatestYear,rpgLatestSource,rpgTypeName,fetchRpgFeatures,rpgFeatureId,rpgFeatureToParcel,
  setRpgLatestYear,getRpgLatestYear,configureRpgYearCache,isRpgYearUnavailable,markRpgYearUnavailable,
  resetRpgYearCache,RPG_UNAVAILABLE_KEY,RPG_LATEST_CAPABILITIES_URL,readTextLimited
} from './rpg.js';
import {onboardingRpgYears} from './rpg-onboarding.js';

// Extrait réel du GetCapabilities NAMESPACE=RPG.LATEST (data.geopf.fr, novembre 2026).
const CAPS=`<?xml version="1.0" encoding="UTF-8"?><wfs:WFS_Capabilities version="2.0.0"><FeatureTypeList>
<FeatureType xmlns:RPG.LATEST="http://RPG.LATEST"><Name>RPG.LATEST:codes_cultures</Name><Title>Registre parcellaire graphique (RPG) 2024 : Codes des cultures</Title></FeatureType>
<FeatureType xmlns:RPG.LATEST="http://RPG.LATEST"><Name>RPG.LATEST:parcelles_graphiques</Name><Title>Registre parcellaire graphique (RPG) 2025 : Parcelles graphiques</Title><Abstract>zones de cultures déclarées par les exploitants en 2025</Abstract></FeatureType>
</FeatureTypeList></wfs:WFS_Capabilities>`;

class MemoryStorage{
  constructor(){this.map=new Map();}
  getItem(k){return this.map.has(k)?this.map.get(k):null;}
  setItem(k,v){this.map.set(k,String(v));}
  removeItem(k){this.map.delete(k);}
}
const throwing={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');},removeItem(){throw new Error('denied');}};
const square={type:'Polygon',coordinates:[[[1,47],[1.1,47],[1.1,47.1],[1,47.1],[1,47]]]};
const latestFeature=(parcel,ilot)=>({type:'Feature',id:`parcelles_graphiques.${parcel}`,geometry:{type:'Polygon',coordinates:[[[1,47],[1.01,47],[1.01,47.01],[1,47]]]},properties:{num_parcel:String(parcel),num_ilot:String(ilot),surf_parc:1,code_cultu:'BTH'}});
const exception={ok:false,status:400,text:async()=>'<ows:ExceptionReport><ows:ExceptionText>Unknown namespace [RPG.2025]</ows:ExceptionText></ows:ExceptionReport>'};

test('parseRpgLatestYear : titre réel, absent, déformé', ()=>{
  assert.equal(parseRpgLatestYear(CAPS),2025,'année des parcelles graphiques, pas celle des codes cultures');
  assert.equal(parseRpgLatestYear(CAPS.replace(/<Title>Registre parcellaire graphique \(RPG\) 2025[^<]*<\/Title>/,'')),null);
  assert.equal(parseRpgLatestYear(CAPS.replace('(RPG) 2025 :','(RPG) 2025 -')),null);
  assert.equal(parseRpgLatestYear(CAPS.replace('(RPG) 2025 :','(RPG)\n  2025  :')),2025,'espaces tolérés');
  assert.equal(parseRpgLatestYear(''),null);assert.equal(parseRpgLatestYear(null),null);
  assert.equal(rpgTypeName('latest'),'RPG.LATEST:parcelles_graphiques');
  assert.equal(rpgTypeName(2024),'RPG.2024:parcelles_graphiques');
});

test('rpgLatestSource : contrat, fetch simulé, réponse trop grosse', async ()=>{
  assert.equal(rpgLatestSource.id,'rpg-latest');assert.equal(rpgLatestSource.label,'Registre parcellaire (RPG)');
  assert.equal(rpgLatestSource.ttlMs,7*24*3600*1000);
  assert.deepEqual(rpgLatestSource.embedded.value,{year:2024});assert.equal(rpgLatestSource.embedded.version,'2024');
  const urls=[];
  const result=await rpgLatestSource.check({fetch:async url=>{urls.push(url);return new Response(CAPS);}});
  assert.deepEqual(result,{value:{year:2025},version:'2025'});
  assert.equal(urls[0],RPG_LATEST_CAPABILITIES_URL);
  assert.equal(new URL(urls[0]).searchParams.get('NAMESPACE'),'RPG.LATEST');
  assert.ok(rpgLatestSource.validate(result));
  assert.ok(!rpgLatestSource.validate({value:{year:2014}}));
  assert.ok(!rpgLatestSource.validate({value:{year:new Date().getFullYear()+1}}));
  const big='x'.repeat(700*1024);
  await assert.rejects(rpgLatestSource.check({fetch:async()=>new Response(big)}),e=>e.code==='too-large');
  await assert.rejects(readTextLimited({headers:{get:()=>'9999999'},text:async()=>''},600),e=>e.code==='too-large');
  await assert.rejects(rpgLatestSource.check({fetch:async()=>new Response('<x/>')}),/introuvable/);
  await assert.rejects(rpgLatestSource.check({fetch:async()=>new Response('',{status:503})}),/503/);
});

test('fetchRpgFeatures : RPG.2025 absent, bascule sur RPG.LATEST, année réelle conservée', async ()=>{
  const storage=new MemoryStorage();configureRpgYearCache({storage});resetRpgYearCache();
  setRpgLatestYear(2025);
  const types=[];
  const fetchImpl=async url=>{
    const type=new URL(url).searchParams.get('TYPENAMES');types.push(type);
    if(type==='RPG.2025:parcelles_graphiques')return exception;
    const features=[latestFeature(1,10),latestFeature(1,11)];
    return{ok:true,json:async()=>({type:'FeatureCollection',features,numberMatched:2,totalFeatures:2,numberReturned:2})};
  };
  const data=await fetchRpgFeatures({geometry:square,year:2025,fetchImpl});
  assert.deepEqual(types,['RPG.2025:parcelles_graphiques','RPG.LATEST:parcelles_graphiques']);
  assert.equal(data.features.length,2,'même num_parcel dans deux îlots : pas de collision');
  assert.equal(data.rpg.year,2025);assert.equal(data.rpg.latest,true);
  const parcel=rpgFeatureToParcel(data.features[0],{year:data.rpg.year});
  assert.equal(parcel.sourceId,'rpg:2025:parcel:10-1');assert.equal(parcel.rpgYear,2025);
  assert.ok(!/LATEST/i.test(parcel.sourceId));
  assert.equal(isRpgYearUnavailable(2025),false,'le dernier millésime reste proposé');
  // Autre millésime absent : marqué indisponible, pas de bascule.
  await assert.rejects(fetchRpgFeatures({geometry:square,year:2026,fetchImpl:async()=>exception}),e=>e.code==='rpg-year-unavailable');
  assert.equal(isRpgYearUnavailable(2026),true);
  assert.deepEqual(onboardingRpgYears(new Date('2026-11-12'))[0],2025);
  setRpgLatestYear(null);assert.equal(getRpgLatestYear(),null);
  resetRpgYearCache();configureRpgYearCache({storage:null});
});

test('fetchRpgFeatures : après une bascule, les chargements suivants vont directement sur RPG.LATEST', async ()=>{
  const storage=new MemoryStorage();configureRpgYearCache({storage});resetRpgYearCache();
  setRpgLatestYear(2025);
  const types=[];
  const fetchImpl=async url=>{
    const type=new URL(url).searchParams.get('TYPENAMES');types.push(type);
    if(type==='RPG.2025:parcelles_graphiques')return exception;
    return{ok:true,json:async()=>({type:'FeatureCollection',features:[latestFeature(1,10)],numberMatched:1,totalFeatures:1,numberReturned:1})};
  };
  await fetchRpgFeatures({geometry:square,year:2025,fetchImpl});
  const second=await fetchRpgFeatures({geometry:square,year:2025,fetchImpl});
  assert.deepEqual(types,['RPG.2025:parcelles_graphiques','RPG.LATEST:parcelles_graphiques','RPG.LATEST:parcelles_graphiques'],'une seule requête en échec par session');
  assert.equal(second.rpg.latest,true);assert.equal(isRpgYearUnavailable(2025),false,'non persisté : réessayé à la session suivante');
  setRpgLatestYear(2026);setRpgLatestYear(2025);types.length=0;
  await fetchRpgFeatures({geometry:square,year:2025,fetchImpl});
  assert.equal(types[0],'RPG.2025:parcelles_graphiques','nouveau millésime LATEST : mémoire remise à zéro');
  setRpgLatestYear(null);resetRpgYearCache();configureRpgYearCache({storage:null});
});

test('années indisponibles : persistées 30 jours, stockage qui lève toléré', ()=>{
  let now=Date.parse('2026-11-12T08:00:00Z');
  const storage=new MemoryStorage();
  configureRpgYearCache({storage,now:()=>now});resetRpgYearCache();
  markRpgYearUnavailable(2026);
  const saved=JSON.parse(storage.getItem(RPG_UNAVAILABLE_KEY));
  assert.equal(saved.years['2026'],now);
  configureRpgYearCache({storage,now:()=>now}); // nouvelle session : relu depuis le stockage
  assert.equal(isRpgYearUnavailable(2026),true);
  now+=31*24*3600*1000;
  assert.equal(isRpgYearUnavailable(2026),false,'expiré après 30 jours');
  assert.equal(storage.getItem(RPG_UNAVAILABLE_KEY),null);
  storage.setItem(RPG_UNAVAILABLE_KEY,'{pas du json');
  configureRpgYearCache({storage,now:()=>now});
  assert.equal(isRpgYearUnavailable(2026),false);
  configureRpgYearCache({storage:throwing,now:()=>now});
  assert.doesNotThrow(()=>markRpgYearUnavailable(2027));
  assert.equal(isRpgYearUnavailable(2027),true,'gardé en mémoire pour la session');
  assert.doesNotThrow(()=>resetRpgYearCache());
  configureRpgYearCache({storage:null});
});

test('erreur réseau : aucune année marquée', async ()=>{
  const storage=new MemoryStorage();configureRpgYearCache({storage});resetRpgYearCache();
  const fetchImpl=async()=>{throw new TypeError('Failed to fetch');};
  await assert.rejects(fetchRpgFeatures({geometry:square,year:2024,fetchImpl}),/réseau/);
  await assert.rejects(fetchRpgFeatures({geometry:square,year:2023,fetchImpl:async()=>({ok:false,status:503,text:async()=>'Service Unavailable'})}),/indisponible/);
  assert.equal(isRpgYearUnavailable(2024),false);assert.equal(isRpgYearUnavailable(2023),false);
  assert.equal(storage.getItem(RPG_UNAVAILABLE_KEY),null);
  configureRpgYearCache({storage:null});
});

test('rpgFeatureId : îlot-parcelle pour LATEST, id_parcel inchangé pour 2024', ()=>{
  assert.equal(rpgFeatureId(latestFeature(35223,2751396),{year:2025}),'rpg:2025:parcel:2751396-35223');
  const y2024={type:'Feature',id:'parcelles_graphiques.10920',properties:{id_parcel:'6216443',num_ilot:'99',num_parcel:'3'}};
  assert.equal(rpgFeatureId(y2024,{year:2024}),'rpg:2024:parcel:6216443');
  const legacy={type:'Feature',properties:{num_parcel:'7'}};
  assert.equal(rpgFeatureId(legacy,{year:2024}),'rpg:2024:parcel:7','num_parcel seul : forme inchangée');
});
