import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSeries,lastUsable,ageDays,ageLabel,ndviTrend,ndviClass,ndviSummary,ndviColorInfo,legendRank,ageRange,refreshDue,nextRefreshAt,refreshOrder,runQueue,rasterFrames,timelineDates,curtainPercent,NDVI_NO_DATA,TREND_CLASSES,NDVI_CLASSES} from './ndvi-map.js';
import {pruneCache,trimImages,MAX_CACHE,SatelliteService} from './satellite.js';

const row=(date,ndvi,usable=true,extra={})=>({date,ndvi,usable,stdDev:null,cloudCoverage:usable?5:80,validFraction:usable?.95:.2,ndmi:null,...extra});
const NOW=Date.parse('2026-10-14T10:00:00');

test('fusion des séries : l’entrée la plus récente l’emporte pour une même date', ()=>{
  const a={savedAt:1,series:[row('2026-09-01',.5),row('2026-09-10',.6)]};
  const b={savedAt:2,series:[row('2026-09-10',.7),row('2026-09-20',.65,false)]};
  const s=mergeSeries([b,a]);
  assert.deepEqual(s.map(r=>r.date),['2026-09-01','2026-09-10','2026-09-20']);
  assert.equal(s[1].ndvi,.7);
  assert.equal(lastUsable(s).date,'2026-09-10');
  assert.equal(lastUsable([row('2026-09-01',null)]),null);
});

test('âge de la valeur en jours civils', ()=>{
  assert.equal(ageDays('2026-10-05',NOW),9);
  assert.equal(ageLabel('2026-10-05',NOW),'il y a 9 j');
  assert.equal(ageLabel('2026-10-14',NOW),'aujourd’hui');
  assert.equal(ageLabel('2026-10-13',NOW),'hier');
  assert.equal(ageLabel('n/a',NOW),'');
  assert.equal(ageRange([{age:2},{age:13},{age:null}]),'il y a 2 à 13 j');
  assert.equal(ageRange([{age:0},{age:4}]),'aujourd’hui à il y a 4 j');
  assert.equal(ageRange([]),'');
});

test('tendance 15 j : hausse, stable, baisse, historique insuffisant', ()=>{
  const base=[row('2026-09-20',.5),row('2026-09-25',.6,false)];
  assert.equal(ndviTrend([...base,row('2026-10-05',.62)]).kind,'up');
  assert.equal(ndviTrend([...base,row('2026-10-05',.52)]).kind,'flat');
  const down=ndviTrend([...base,row('2026-10-05',.3)]);
  assert.equal(down.kind,'down');assert.equal(down.delta,-.2);assert.equal(down.reference.date,'2026-09-20');
  // Référence trop éloignée de J-15 (± 7 j) : inconnue.
  assert.equal(ndviTrend([row('2026-08-01',.5),row('2026-10-05',.3)]).kind,'unknown');
  assert.equal(ndviTrend([]).kind,'unknown');
  // La plus proche de J-15 est choisie.
  assert.equal(ndviTrend([row('2026-09-14',.1),row('2026-09-19',.5),row('2026-10-04',.52)]).reference.date,'2026-09-19');
});

test('classes graduées de vigueur', ()=>{
  assert.equal(ndviClass(.1),NDVI_CLASSES[0]);
  assert.equal(ndviClass(.2),NDVI_CLASSES[1]);
  assert.equal(ndviClass(.59),NDVI_CLASSES[2]);
  assert.equal(ndviClass(.6),NDVI_CLASSES[3]);
  assert.equal(ndviClass(.95),NDVI_CLASSES[4]);
  assert.equal(ndviClass(-.4),NDVI_CLASSES[0]);
  assert.equal(ndviClass(null),null);
});

test('résumé et couleur : valeur, âge, anomalie, absence de donnée hachurée', ()=>{
  assert.equal(ndviSummary([]),null);
  const none=ndviColorInfo(null);assert.equal(none.label,NDVI_NO_DATA.label);assert.equal(none.hatch,true);
  const cloudy=ndviColorInfo(ndviSummary([{savedAt:1,series:[row('2026-10-01',.4,false)]}],{now:NOW}));
  assert.equal(cloudy.hatch,true);assert.match(cloudy.detail,/nuages/);
  const series=[row('2026-09-15',.8),row('2026-09-20',.78),row('2026-09-24',.82),row('2026-10-05',.45)];
  const s=ndviSummary([{savedAt:5,series}],{now:NOW});
  assert.equal(s.last.date,'2026-10-05');assert.equal(s.age,9);assert.equal(s.trend.kind,'down');
  assert.equal(s.signals[0].title,'Baisse du NDVI');
  const info=ndviColorInfo(s,'ndvi');
  assert.equal(info.label,NDVI_CLASSES[2].label);assert.equal(info.alert,true);
  assert.match(info.detail,/NDVI 0,45 · image du 05\/10\/2026 · il y a 9 j/);
  const trend=ndviColorInfo(s,'ndvitrend');
  assert.equal(trend.label,TREND_CLASSES.down.label);assert.equal(trend.color,TREND_CLASSES.down.color);
  assert.match(trend.detail,/−0,33 depuis le 20\/09\/2026/);
  // Signal ignoré : plus de pastille.
  const ignored=ndviSummary([{savedAt:5,series,ignored:['2026-10-05-drop']}],{now:NOW});
  assert.equal(ndviColorInfo(ignored).alert,false);
});

test('ordre de la légende graduée', ()=>{
  assert.ok(legendRank('ndvi',NDVI_CLASSES[4].label)<legendRank('ndvi',NDVI_CLASSES[0].label));
  assert.ok(legendRank('ndvi',NDVI_CLASSES[0].label)<legendRank('ndvi',NDVI_NO_DATA.label));
  assert.ok(legendRank('ndvitrend',TREND_CLASSES.up.label)<legendRank('ndvitrend',TREND_CLASSES.down.label));
  assert.ok(legendRank('ndvitrend',TREND_CLASSES.unknown.label)<legendRank('ndvitrend',NDVI_NO_DATA.label));
});

test('mise à jour globale au plus une fois par jour civil', ()=>{
  assert.equal(refreshDue(null,NOW),true);
  assert.equal(refreshDue(Date.parse('2026-10-14T06:00:00'),NOW),false);
  assert.equal(refreshDue(Date.parse('2026-10-13T23:59:00'),NOW),true);
  assert.equal(nextRefreshAt(Date.parse('2026-10-14T06:00:00'),NOW),Date.parse('2026-10-15T00:00:00'));
  assert.equal(nextRefreshAt(null,NOW),NOW);
});

test('ordre de la file : contours valides, données les plus anciennes d’abord', ()=>{
  const poly={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]};
  const parcels=[{id:'a',nom:'A',geometry:poly},{id:'b',nom:'B',geometry:poly},{id:'c',nom:'C',geometry:{type:'Point',coordinates:[0,0]}},{id:'d',nom:'D',geometry:poly,deletedAt:'x'},{id:'e',nom:'E'}];
  assert.deepEqual(refreshOrder(parcels,p=>({a:10,b:0})[p.id]).map(p=>p.id),['b','a']);
});

test('file limitée à 2 requêtes simultanées, progression et erreurs', async ()=>{
  let active=0,max=0;const progress=[];
  const result=await runQueue([1,2,3,4,5],async n=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;if(n===3)throw Error('HTTP 500');return n*2;},{concurrency:2,onProgress:p=>progress.push(p.done)});
  assert.equal(max,2);assert.equal(result.done,5);assert.equal(result.ok,4);assert.equal(result.failed,1);assert.equal(result.cancelled,false);
  assert.deepEqual(progress,[1,2,3,4,5]);assert.equal(result.results[1].value,4);
});

test('file annulable et arrêt sur erreur bloquante', async ()=>{
  const controller=new AbortController();let calls=0;
  const r=await runQueue([1,2,3,4,5,6],async(n,signal)=>{calls++;if(n===2)controller.abort();await new Promise(res=>setTimeout(res,2));if(signal.aborted){const e=Error('stop');e.name='AbortError';throw e;}return n;},{signal:controller.signal});
  assert.equal(r.cancelled,true);assert.ok(calls<=3,'aucune nouvelle requête après annulation');assert.equal(r.failed,0);
  let n=0;const s=await runQueue([1,2,3,4,5],async()=>{n++;throw Error('Compte non autorisé pour ce service satellite.');},{concurrency:1,stopOn:e=>/autoris/.test(e.message)});
  assert.equal(n,1);assert.ok(s.stopped);
  assert.equal((await runQueue([],async()=>1)).total,0);
});

test('frise : images en cache par date, ancienne clé sans date comprise', ()=>{
  const e1={savedAt:1,series:[row('2026-09-10',.5),row('2026-09-20',.6)],images:{indices:'data:A',rgb:'data:R'}};
  const e2={savedAt:2,series:[row('2026-09-20',.6),row('2026-10-01',.7)],images:{'indices@2026-10-01':'data:B','indices@2026-09-10':'data:C'}};
  assert.deepEqual(rasterFrames([e1,e2]).map(f=>[f.date,f.key]),[['2026-09-10','indices@2026-09-10'],['2026-09-20','indices'],['2026-10-01','indices@2026-10-01']]);
  assert.deepEqual(rasterFrames([e1,e2],'rgb').map(f=>f.date),['2026-09-20']);
  const t=timelineDates([e1,e2]);
  assert.deepEqual(t.map(d=>[d.date,d.cached]),[['2026-09-10',true],['2026-09-20',true],['2026-10-01',true]]);
  assert.deepEqual(timelineDates([{savedAt:1,series:[row('2026-09-10',.5),row('2026-09-12',.5,false)]}]).map(d=>[d.label,d.cached]),[['10/09/2026',false]]);
});

test('rideau : position de la ligne dans l’image', ()=>{
  assert.equal(curtainPercent(150,100,200),25);
  assert.equal(curtainPercent(50,100,200),0);
  assert.equal(curtainPercent(400,100,200),100);
  assert.equal(curtainPercent(10,0,0),50);
});

test('cache satellite : une série par parcelle, images limitées aux entrées récentes', ()=>{
  const now=Date.now();
  const entries=Array.from({length:30},(_,i)=>({key:'k'+i,parcelId:'p'+i,period:'30',savedAt:now-i*1000,series:[row('2026-10-01',.5)],images:i<12?{'indices@2026-10-01':'data:x'}:{}}));
  const kept=pruneCache(entries,now);
  assert.equal(kept.length,30,'les 30 séries restent en cache');
  assert.equal(kept.filter(e=>Object.keys(e.images).length).length,MAX_CACHE);
  assert.ok(Object.keys(kept[0].images).length,'la plus récente garde son image');
  assert.equal(pruneCache([{savedAt:now-31*86400000,series:[]}],now).length,0);
  // Budget mémoire dépassé : les images sautent avant les séries.
  const big={key:'big',parcelId:'big',savedAt:now,series:[],images:{'indices@2026-10-01':'x'.repeat(5000000)}};
  const big2={key:'big2',parcelId:'big2',savedAt:now-1,series:[row('2026-10-01',.5)],images:{'indices@2026-10-01':'x'.repeat(2000000)}};
  const pruned=pruneCache([big,big2],now);
  assert.equal(pruned.length,2);assert.deepEqual(pruned[1].images,{});
});

test('images datées : conversion de l’ancienne clé et limite par type', ()=>{
  assert.deepEqual(trimImages({indices:'A',rgb:'R'},'2026-10-01'),{'indices@2026-10-01':'A','rgb@2026-10-01':'R'});
  assert.deepEqual(trimImages({indices:'A'},null),{indices:'A'});
  const many=Object.fromEntries(Array.from({length:9},(_,i)=>[`indices@2026-09-0${i+1}`,'u'+i]));
  assert.deepEqual(Object.keys(trimImages(many,null,6)),['indices@2026-09-04','indices@2026-09-05','indices@2026-09-06','indices@2026-09-07','indices@2026-09-08','indices@2026-09-09']);
});

test('mise à jour globale : une coupure réseau est une erreur, pas un cache « actualisé » (vague 9)', async ()=>{
  const desc=Object.getOwnPropertyDescriptor(globalThis,'navigator');let online=true,requests=0;
  Object.defineProperty(globalThis,'navigator',{value:{get onLine(){return online;}},configurable:true,writable:true});
  try{
    const sq=x=>({type:'Polygon',coordinates:[[[x,46.34],[x+.004,46.34],[x+.004,46.3428],[x,46.3428],[x,46.34]]]});
    const parcels=[1,2,3].map(i=>({id:'p'+i,geometry:sq(5.13+i*.01)})),today=new Date().toISOString().slice(0,10),yesterday=Date.now()-864e5;
    const svc=new SatelliteService({storage:{get:async()=>null,set:async()=>{},usingFallback:true},scope:()=>['local'],endpoint:()=>'https://sat.example.workers.dev',token:async()=>'tok',
      fetcher:async()=>{requests++;online=false;return new Response(JSON.stringify({series:[{date:today,ndvi:.7,usable:true}]}),{headers:{'content-type':'application/json'}});}});
    await svc.init();
    for(const p of parcels)svc.entries.push({key:svc.identity(p),parcelId:p.id,period:'30',savedAt:yesterday,range:{},series:[],ignored:[],images:{}});
    const result=await runQueue(parcels,p=>svc.load(p,'30',{refresh:true,fallback:false}),{concurrency:1,stopOn:e=>/Hors connexion/.test(e.message)});
    assert.equal(requests,1);
    assert.equal(result.ok,1);assert.ok(result.stopped,'arrêt sur la coupure : pas d’horodatage global');
    // Actualisation d'une seule parcelle hors connexion : le cache reste affiché.
    assert.equal((await svc.load(parcels[2],'30',{refresh:true})).savedAt,yesterday);
  }finally{if(desc)Object.defineProperty(globalThis,'navigator',desc);else delete globalThis.navigator;}
});
