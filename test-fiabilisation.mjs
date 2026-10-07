import {test} from 'node:test';
import assert from 'node:assert/strict';
import {missionIsoxml} from './machine-export.js';
import {matchesWorkTab,localDay} from './home-priorities.js';

const square=(x,y)=>({type:'Polygon',coordinates:[[[x,y],[x+.004,y],[x+.004,y+.003],[x,y+.003],[x,y]]]});

test('mission machine : une TSK par parcelle et dose 150 kg/ha = DDI 0006 à 15000',()=>{
  const {xml,parcelCount}=missionIsoxml({parcels:[{nom:'A',geometry:square(5.1,46.3)},{nom:'B',geometry:square(5.2,46.3)},{nom:'C',geometry:square(5.3,46.3)}],operation:'Épandage',product:'Ammonitrate',dose:150,unit:'kg/ha'});
  assert.equal(parcelCount,3);
  assert.match(xml,/<ISO11783_TaskData /);
  const tasks=[...xml.matchAll(/<TSK A="(TSK\d+)"[^>]* E="(PFD\d+)"/g)].map(m=>[m[1],m[2]]);
  assert.deepEqual(tasks,[['TSK1','PFD1'],['TSK2','PFD2'],['TSK3','PFD3']]);
  for(const [,pfd] of tasks)assert.match(xml,new RegExp(`<PFD A="${pfd}"[^>]*><PLN A="1"><LSG A="1">(<PNT [^>]+/>){5}</LSG>`));
  assert.equal([...xml.matchAll(/<PDV A="0006" B="15000"/g)].length,3);
});

test('un travail en retard terminé aujourd’hui reste dans « Aujourd’hui », pas dans l’historique',()=>{
  const today=localDay();
  const done={status:'Terminé',date:today,plannedDate:'2020-01-01'};
  assert.equal(matchesWorkTab(done,'today',today),true);
  assert.equal(matchesWorkTab(done,'history',today),false);
  assert.equal(matchesWorkTab(done,'overdue',today),false);
  const yesterday={status:'Terminé',date:'2020-01-02',plannedDate:'2020-01-01'};
  assert.equal(matchesWorkTab(yesterday,'history',today),true);
  // Rouvert : l'échéance reprend le dessus.
  assert.equal(matchesWorkTab({status:'À faire',date:'2020-01-01',plannedDate:'2020-01-01'},'overdue',today),true);
});
