import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchRpgFeatures,rpgPageUrl,geometryBbox,rpgFeatureId,isRpgYearUnavailable,resetRpgYearCache,configureRpgYearCache} from './rpg.js';
import {onboardingRpgYears} from './rpg-onboarding.js';

const square={type:'Polygon',coordinates:[[[1,47],[1.1,47],[1.1,47.1],[1,47.1],[1,47]]]};
const feature=(n)=>({type:'Feature',id:`parcelles_graphiques.${n}`,geometry:{type:'Polygon',coordinates:[[[1,47],[1.01,47],[1.01,47.01],[1,47]]]},properties:{num_parcel:String(n),surf_parc:1,code_cultu:'BTH'}});

test('URL WFS Géoplateforme par millésime', ()=>{
  const url=new URL(rpgPageUrl({year:2024,bbox:geometryBbox(square),start:1000}));
  assert.equal(url.origin+url.pathname,'https://data.geopf.fr/wfs/ows');
  assert.equal(url.searchParams.get('TYPENAMES'),'RPG.2024:parcelles_graphiques');
  assert.equal(url.searchParams.get('BBOX'),'1.000000,47.000000,1.100000,47.100000,CRS:84');
  assert.equal(url.searchParams.get('STARTINDEX'),'1000');
  assert.equal(rpgFeatureId(feature(7),{year:2024}),'rpg:2024:parcel:7');
});

test('pagination STARTINDEX jusqu’au total annoncé', async ()=>{
  const calls=[];
  const fetchImpl=async url=>{
    const start=Number(new URL(url).searchParams.get('STARTINDEX'));calls.push(start);
    const features=start===0?Array.from({length:1000},(_,i)=>feature(i)):[feature(1000),feature(1001)];
    return{ok:true,json:async()=>({type:'FeatureCollection',features,numberMatched:1002,totalFeatures:1002,numberReturned:features.length})};
  };
  const data=await fetchRpgFeatures({geometry:square,year:2024,fetchImpl});
  assert.equal(data.features.length,1002);assert.deepEqual(calls,[0,1000]);
});

test('millésime pas encore publié : écarté puis année précédente', async ()=>{
  configureRpgYearCache({storage:null});resetRpgYearCache();
  const fetchImpl=async()=>({ok:false,status:400,text:async()=>'<ows:ExceptionText>Unknown namespace [RPG.2026]</ows:ExceptionText>'});
  await assert.rejects(fetchRpgFeatures({geometry:square,year:2026,fetchImpl}),e=>e.code==='rpg-year-unavailable');
  assert.ok(isRpgYearUnavailable(2026));
  const years=onboardingRpgYears(new Date('2026-11-11T08:00:00'),null);
  assert.deepEqual(years,[2025,2024,2023],'2026 écarté, au plus 3 essais');
  assert.equal(onboardingRpgYears(new Date('2026-11-11T08:00:00'),null,{limit:0}).at(-1),2015);
  resetRpgYearCache();
});
