// Index par parcelle de l'écran Parcelles (selectors.js) : mêmes résultats que le filtrage par parcelle, en un passage.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupByParcel,parcelIndex,memoize} from './selectors.js';
import {summarizeParcelGrazing} from './grazing.js';
import {emptyState} from './state.js';

function farm(){
  const s=emptyState();
  s.parcelles=[{id:'p1',nom:'A'},{id:'p2',nom:'B'}];
  s.interventions=[{id:'w1',parcelId:'p1',date:'2026-03-01'},{id:'w2',parcelId:'p2'},{id:'w3',parcelId:'p1',deletedAt:1},{id:'w4',parcelId:'p1',date:'2026-04-01'},{id:'w5'}];
  s.tasks=[{id:'t1',parcelId:'p2'}];
  s.grazingSessions=[{id:'g1',parcelId:'p1',startDate:'2026-01-01',animals:[{number:'1'}]},{id:'g2',parcelId:'p2',startDate:'2026-01-01',deletedAt:5}];
  return s;
}

test('regroupement : ordre conservé, supprimés et sans parcelle écartés', ()=>{
  const m=groupByParcel(farm().interventions);
  assert.deepEqual(m.get('p1').map(w=>w.id),['w1','w4']);
  assert.deepEqual(m.get('p2').map(w=>w.id),['w2']);
  assert.equal(m.size,2);
  assert.equal(groupByParcel(null).size,0);
});

test('index : identique au filtrage par parcelle, pâturage compris', ()=>{
  const s=farm(),idx=parcelIndex(s);
  for(const p of s.parcelles){
    assert.deepEqual(idx.works.get(p.id)||[],s.interventions.filter(w=>!w.deletedAt&&w.parcelId===p.id));
    assert.deepEqual(idx.tasks.get(p.id)||[],s.tasks.filter(t=>!t.deletedAt&&t.parcelId===p.id));
    const date=new Date('2026-05-01');
    assert.deepEqual(summarizeParcelGrazing(idx.grazing.get(p.id)||[],p.id,{date}),summarizeParcelGrazing(s.grazingSessions,p.id,{date}));
  }
});

test('index : mémoïsé par objet, recalculé quand la révision change', ()=>{
  const s=farm(),a=parcelIndex(s);
  assert.equal(parcelIndex(s),a);
  s.interventions.push({id:'w6',parcelId:'p2'});s.metadata.revision+=1;
  const b=parcelIndex(s);
  assert.notEqual(b,a);assert.equal(b.works.get('p2').length,2);
  assert.equal(parcelIndex(structuredClone(s)).works.get('p2').length,2);
  assert.equal(parcelIndex(null).works.size,0);
});

test('memoize : une seule évaluation par clé', ()=>{
  let calls=0;const f=memoize(k=>{calls+=1;return k*2;});
  assert.equal(f(2),4);assert.equal(f(2),4);assert.equal(f(3),6);assert.equal(calls,2);
});
