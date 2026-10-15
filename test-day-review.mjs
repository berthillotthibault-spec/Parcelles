import test from 'node:test';
import assert from 'node:assert/strict';
import {composeDayReview,implicitStockExit,trackDay} from './day-review.js';

const now=new Date(2026,9,15,18,30);
const base=()=>({
  interventions:[
    {id:'w1',type:'Semis',status:'Prévu',plannedDate:'2026-10-15',parcelId:'p1'},
    {id:'w2',type:'Désherbage',status:'Terminé',date:'2026-10-15',plannedDate:'2026-10-15',product:'Glyphosate',dose:3,doseUnit:'L/ha',surfaceWorked:4,version:2},
    {id:'w3',type:'Labour',status:'Prévu',plannedDate:'2026-10-16'},
    {id:'w4',type:'Fauche',status:'Prévu',plannedDate:'2026-10-15',deletedAt:1},
    {id:'w5',type:'GPS',status:'Brouillon',date:'2026-10-15',gpsTrackId:'t2'}
  ],
  stockItems:[{id:'s1',name:'glyphosate',unit:'L',quantity:50}],
  gpsTracks:[
    {id:'t1',name:'Matin',startedAt:new Date(2026,9,15,8).getTime(),matchedParcels:[{parcelId:'p1',share:.9}]},
    {id:'t2',startedAt:new Date(2026,9,15,9).getTime()},
    {id:'t3',startedAt:new Date(2026,9,14,9).getTime()}
  ]
});

test('composeDayReview : faits, restants, traces non rattachées et sortie de stock', () => {
  const r=composeDayReview(base(),now);
  assert.equal(r.show,true);assert.equal(r.today,'2026-10-15');
  assert.deepEqual(r.done.map(w=>w.id),['w2']);
  assert.deepEqual(r.remaining.map(w=>w.id).sort(),['w1','w5']);
  assert.deepEqual(r.tracks,[{id:'t1',name:'Matin',parcelCount:1}]);
  assert.equal(r.stockExits.length,1);
  assert.deepEqual({...r.stockExits[0]},{workId:'w2',workVersion:2,stockItemId:'s1',stockName:'glyphosate',unit:'L',quantity:12,balance:50,balanceAfter:38,insufficient:false,alreadyOut:0});
});

test('composeDayReview : carte masquée avant 17 h, état vide toléré', () => {
  assert.equal(composeDayReview(base(),new Date(2026,9,15,16,59)).show,false);
  const r=composeDayReview({},now);assert.equal(r.empty,true);assert.equal(r.show,true);
});

test('implicitStockExit : unités hétérogènes, ambiguïté, déjà rapproché', () => {
  const work={id:'w',status:'Terminé',product:'Engrais',dose:200,doseUnit:'kg/ha',surfaceWorked:2};
  assert.equal(implicitStockExit(work,[{id:'a',name:'Engrais',unit:'L',quantity:10}]),null);
  assert.equal(implicitStockExit(work,[{id:'a',name:'Engrais',unit:'kg'},{id:'b',name:'ENGRAIS',unit:'kg'}]),null);
  assert.equal(implicitStockExit({...work,resourceEffects:{stockItemId:'a'}},[{id:'a',name:'Engrais',unit:'kg',quantity:1000}]),null);
  assert.equal(implicitStockExit({...work,status:'Prévu'},[{id:'a',name:'Engrais',unit:'kg',quantity:1000}]),null);
  const t=implicitStockExit(work,[{id:'a',name:'Engrais',unit:'t',quantity:0.1}]);
  assert.equal(t.quantity,0.4);assert.equal(t.insufficient,true);
});

test('trackDay : date ISO, horodatage, valeur absente', () => {
  assert.equal(trackDay({startedAt:'2026-10-15'}),'2026-10-15');
  assert.equal(trackDay({createdAt:new Date(2026,9,15,23).getTime()}),'2026-10-15');
  assert.equal(trackDay({}),'');
});

test('implicitStockExit : heures machine déjà rapprochées, rien à proposer (n° 105)', () => {
  const work={id:'w',status:'Terminé',date:'2026-10-15',product:'Glyphosate',dose:3,doseUnit:'L/ha',surfaceWorked:4,resourceEffects:{stockItemId:null,machineId:'m1',hours:3}};
  assert.equal(implicitStockExit(work,[{id:'s1',name:'glyphosate',unit:'L',quantity:50}]),null);
});

test('composeDayReview : sortie manuelle du jour signalée (alreadyOut, n° 105)', () => {
  const state=base();
  state.stockMovements=[
    {id:'m1',stockItemId:'s1',type:'Sortie',quantity:12,date:'2026-10-15'},
    {id:'m2',stockItemId:'s1',type:'Sortie',quantity:5,date:'2026-10-14'},
    {id:'m3',stockItemId:'s1',type:'Sortie',quantity:7,date:'2026-10-15',deletedAt:1},
    {id:'m4',stockItemId:'s1',type:'Entrée',quantity:9,date:'2026-10-15'}
  ];
  assert.equal(composeDayReview(state,now).stockExits[0].alreadyOut,12);
});
