import assert from 'node:assert/strict';
import {test} from 'node:test';
import {workMeta,tomorrowIso,postponedWork,createSwipeTracker} from './work-list.js';

test('métadonnées sans date', () => {
  assert.deepEqual(workMeta({surfaceWorked:4.5,operator:'Paul'},{machineName:'Tracteur'}),['4,5 ha','Tracteur','Paul']);
  assert.deepEqual(workMeta({},{parcel:{surfaceHa:11.3}}),['11,3 ha']);
  assert.deepEqual(workMeta({}),[]);
});
test('report au lendemain', () => {
  assert.equal(tomorrowIso('2026-12-31'),'2027-01-01');assert.equal(tomorrowIso('2026-03-28'),'2026-03-29');
  const w=postponedWork({id:'w',plannedDate:'2026-10-12',date:'2026-10-12',status:'À faire'},'2026-10-12');
  assert.equal(w.plannedDate,'2026-10-13');assert.equal(w.status,'À faire');
});
test('balayage : verrouillage d\'axe et seuils', () => {
  const s=createSwipeTracker({threshold:100,lockPx:8});
  s.start(0,0);assert.equal(s.move(5,3).axis,null);
  const m=s.move(60,10);assert.equal(m.axis,'x');assert.equal(m.dx,60);assert.equal(m.crossed,null);
  assert.equal(s.move(120,40).crossed,'done');assert.equal(s.end(),'done');
  s.start(0,0);s.move(-120,0);assert.equal(s.end(),'postpone');
  s.start(0,0);s.move(2,12);const v=s.move(150,20);assert.equal(v.axis,'y');assert.equal(v.dx,0);assert.equal(s.end(),null);
  s.start(0,0);s.move(50,0);assert.equal(s.end(),null);
  assert.equal(s.end(),null);
});
