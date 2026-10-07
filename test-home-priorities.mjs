import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getHomeAgenda,getParcelWorkContext,matchesWorkTab,agendaDate,localDay} from './home-priorities.js';
import {filterMapParcels} from './personalization.js';
import {computeNotifications} from './notifications.js';
const today='2026-10-04';
test('a missed task outranks a future job and is never presented as a free day',()=>{
  const data={interventions:[{id:'w',status:'À faire',date:'2026-10-06'}],tasks:[{id:'t',status:'À faire',dueDate:'2026-10-03'}]};
  const result=getHomeAgenda(data,today);assert.equal(result.next.kind,'task');assert.equal(result.next.item.id,'t');assert.equal(result.overdueCount,1);assert.equal(result.overdueWorks,0);
});
test('ongoing work precedes overdue and today tasks without mutating records',()=>{
  const data={interventions:[{id:'w',status:'En cours',date:today}],tasks:[{id:'t',dueDate:'2026-10-02'}]};const before=structuredClone(data);
  assert.equal(getHomeAgenda(data,today).next.item.id,'w');assert.deepEqual(data,before);
});
test('today tasks outrank future work; undated tasks remain actionable',()=>{
  const future={id:'w',status:'Planifié',date:'2026-10-06'};
  assert.equal(getHomeAgenda({interventions:[future],tasks:[{id:'t',dueDate:today}]},today).next.item.id,'t');
  assert.equal(getHomeAgenda({interventions:[future],tasks:[{id:'t'}]},today).next.item.id,'t');
});
test('closed, deleted and historical legacy records do not become new priorities',()=>{
  const result=getHomeAgenda({interventions:[{id:'old',date:'2026-01-01'},{id:'cancel',status:'Annulé',date:today},{id:'removed',status:'À faire',date:today,deletedAt:1}],tasks:[{id:'done',status:'Terminé'},{id:'cancel',status:'Annulée'}]},today);
  assert.equal(result.next,null);assert.equal(result.overdueCount,0);
});
test('unfinished past work belongs to overdue, not to completed history',()=>{
  const work={id:'w',status:'À faire',date:'2026-10-01'};
  assert.equal(matchesWorkTab(work,'overdue',today),true);assert.equal(matchesWorkTab(work,'history',today),false);
  assert.equal(matchesWorkTab({...work,status:'Terminé'},'overdue',today),false);assert.equal(matchesWorkTab({...work,status:'Terminé'},'history',today),true);
});
test('planned date controls priority and date-less planned work stays reachable',()=>{
  const work={status:'Planifié',date:'2026-10-01',plannedDate:'2026-10-07T09:00:00'};
  assert.equal(agendaDate(work),'2026-10-07');assert.equal(matchesWorkTab(work,'upcoming',today),true);assert.equal(matchesWorkTab(work,'overdue',today),false);
  assert.equal(matchesWorkTab({status:'À faire'},'upcoming',today),true);
});
test('a past in-progress job stays an ongoing recommendation and counts as overdue',()=>{
  const result=getHomeAgenda({interventions:[{id:'w',status:'En cours',date:'2026-10-03'}]},today);
  assert.equal(result.next.item.id,'w');assert.equal(result.overdueCount,1);assert.equal(result.overdueWorks,1);
});

test('parcel context presents overdue work before future work and never as completed',()=>{
  const works=[{id:'future',status:'Planifié',date:'2026-10-08'},{id:'late',status:'À faire',date:'2026-10-01'}];
  const before=structuredClone(works),result=getParcelWorkContext(works,today);
  assert.equal(result.next.item.id,'late');assert.equal(result.next.overdue,true);assert.equal(result.last,null);assert.deepEqual(works,before);
});

test('parcel context only calls completed work the last performed job',()=>{
  const result=getParcelWorkContext([{id:'done',status:'Terminé',date:'2026-09-30'},{id:'cancelled',status:'Annulé',date:'2026-10-03'},{id:'deleted',status:'Terminé',date:today,deletedAt:1}],today);
  assert.equal(result.next,null);assert.equal(result.last.id,'done');
});

test('parcel context retains undated work and historical legacy records',()=>{
  const result=getParcelWorkContext([{id:'legacy',date:'2026-01-01'},{id:'undated',status:'À faire'}],today);
  assert.equal(result.next.item.id,'undated');assert.equal(result.next.date,'');assert.equal(result.last.id,'legacy');
});

test('parcel context explains why a parcel with a pending task is in the todo filter',()=>{
  const works=[{id:'done',status:'Terminé',date:'2026-10-01'},{id:'future',status:'Planifié',date:'2026-10-08'}];
  const result=getParcelWorkContext(works,today,[{id:'task',title:'Clôture',dueDate:'2026-10-03'}]);
  assert.equal(result.next.kind,'task');assert.equal(result.next.item.id,'task');assert.equal(result.next.overdue,true);assert.equal(result.last.id,'done');
});

test('todo parcels include legacy pending tasks but omit cancelled tasks and completed legacy work',()=>{
  const data={parcelles:[{id:'a'},{id:'b'},{id:'c'}],tasks:[{parcelId:'a'},{parcelId:'b',status:'Annulée'}],interventions:[{parcelId:'c',date:'2026-01-01'}]};
  assert.deepEqual(filterMapParcels(data,'todo').map(p=>p.id),['a']);
});

test('cancelled and completed records do not leave overdue notifications',()=>{
  const state={tasks:[{id:'a',status:'Annulée',dueDate:'2010-01-01'},{id:'b',status:'Terminée',dueDate:'2010-01-01'}],interventions:[{id:'c',date:'2010-01-01'},{id:'d',status:'Annulé',date:'2010-01-01'}]};
  assert.deepEqual(computeNotifications(state),[]);assert.equal(getHomeAgenda(state,today).overdueCount,0);
});

test('notifications use the same calendar date as the home and respect planned dates',()=>{
  const date=localDay(); // même date locale que l'application, pas UTC
  const state={tasks:[{id:'t',status:'À faire',dueDate:date+'T09:00:00'}],interventions:[{id:'w',status:'Planifié',date:'2010-01-01',plannedDate:date+'T10:00:00'}]};
  const rows=computeNotifications(state);
  assert.equal(rows.length,2);assert.ok(rows.every(row=>row.date===date&&!row.title.includes('retard')));
  assert.equal(getHomeAgenda(state,date).overdueCount,0);assert.equal(matchesWorkTab(state.interventions[0],'today',date),true);
});
