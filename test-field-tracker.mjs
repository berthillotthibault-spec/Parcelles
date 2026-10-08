import test from 'node:test';
import assert from 'node:assert/strict';
import {FieldTracker, gpsQuality, parcelAtPosition, formatPresence, suggestWorkTypes, defaultsForType, workFromProposal, finishPlannedFromProposal, visitToProposal, chantierForParcel, FINISH_KEYS} from './field-tracker.js';

const sq=(x,y,d=0.004)=>({type:'Polygon',coordinates:[[[x,y],[x+d,y],[x+d,y+d*0.7],[x,y+d*0.7],[x,y]]]});
const parcels=[
  {id:'p1',nom:'Les Noues',surfaceHa:11.3,geometry:sq(5.13,46.34)},
  {id:'p2',nom:'Grand Champ',surfaceHa:8.2,geometry:sq(5.136,46.34)}
];
const IN1={latitude:46.3414,longitude:5.132,accuracy:8};
const IN2={latitude:46.3414,longitude:5.138,accuracy:8};
const walk=m=>({...IN1,longitude:m%2?5.1323:5.131});
const OUT={latitude:46.36,longitude:5.20,accuracy:8};
const MIN=60000,T0=Date.UTC(2026,9,7,8,0);
const day=n=>{const d=new Date(Date.now()+n*864e5);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

function run(tracker,steps){const all=[];for(const [pos,t] of steps)all.push(...tracker.sample(pos,parcels,t).events);return all;}

test('qualité GPS : seuils et libellés', ()=>{
  assert.equal(gpsQuality(5).level,'good');
  assert.equal(gpsQuality(25).level,'fair');
  assert.equal(gpsQuality(40).level,'poor');
  assert.equal(gpsQuality(120).label,'GPS trop imprécis');
  assert.equal(gpsQuality(null).level,'none');
});

test('parcelle sous la position, superposition ambiguë', ()=>{
  assert.equal(parcelAtPosition(IN1,parcels).parcel.id,'p1');
  assert.equal(parcelAtPosition(OUT,parcels).parcel,null);
  const overlap=[...parcels,{id:'p9',geometry:sq(5.13,46.34)}];
  assert.deepEqual(parcelAtPosition(IN1,overlap),{parcel:null,ambiguous:true});
  assert.equal(parcelAtPosition(IN1,[{...parcels[0],deletedAt:1}]).parcel,null);
});

test('présence mesurée de l’entrée à la dernière position dans la parcelle', ()=>{
  const t=new FieldTracker();
  const steps=[];for(let m=0;m<=47;m+=1)steps.push([walk(m),T0+m*MIN]);
  steps.push([OUT,T0+48*MIN]);
  let events=run(t,steps);
  assert.deepEqual(events.map(e=>e.type),['enter'],'une seule position dehors ne suffit pas à sortir');
  events=run(t,[[OUT,T0+48.5*MIN]]);
  assert.equal(events.length,1);
  assert.equal(events[0].type,'exit');assert.equal(events[0].eligible,true);
  assert.equal(events[0].visit.parcelId,'p1');
  assert.equal(events[0].visit.durationMs,47*MIN);
  assert.equal(formatPresence(events[0].visit.durationMs),'47\u00a0min');
  assert.equal(formatPresence(65*MIN),'1\u00a0h\u00a005');
});

test('passage direct d’une parcelle à l’autre : sortie puis entrée', ()=>{
  const t=new FieldTracker();
  const steps=[];for(let m=0;m<=10;m++)steps.push([walk(m),T0+m*MIN]);
  steps.push([IN2,T0+11*MIN],[IN2,T0+11.5*MIN]);
  const events=run(t,steps);
  assert.deepEqual(events.map(e=>e.type),['enter','exit','enter']);
  assert.equal(events[2].parcelId,'p2');assert.equal(events[2].at,T0+11*MIN);
  assert.equal(t.current.parcelId,'p2');
});

test('présence trop courte ou positions imprécises : aucune proposition', ()=>{
  const t=new FieldTracker();
  let events=run(t,[[IN1,T0],[IN1,T0+MIN],[IN1,T0+2*MIN],[OUT,T0+3*MIN],[OUT,T0+3.2*MIN]]);
  assert.equal(events.find(e=>e.type==='exit').eligible,false);
  const t2=new FieldTracker();
  events=run(t2,[[{...IN1,accuracy:80},T0],[{...IN1,accuracy:80},T0+10*MIN]]);
  assert.equal(events.length,0);assert.equal(t2.current,null);assert.equal(t2.lastAccuracy,80);
});

test('trou de signal : la présence est close à la dernière position reçue', ()=>{
  const t=new FieldTracker();
  const steps=[];for(let m=0;m<=6;m++)steps.push([IN1,T0+m*MIN]);
  steps.push([IN1,T0+20*MIN]);
  const events=run(t,steps);
  const exit=events.find(e=>e.type==='exit');
  assert.ok(exit);assert.equal(exit.visit.end,T0+6*MIN);assert.equal(exit.eligible,true);
  assert.equal(t.current.start,T0+20*MIN,'une nouvelle présence démarre après le trou');
});

test('arrêt automatique conseillé après 30 min sans mouvement, signalé une seule fois', ()=>{
  const t=new FieldTracker();
  const steps=[];for(let m=0;m<=40;m++)steps.push([IN1,T0+m*MIN]);
  const idle=run(t,steps).filter(e=>e.type==='idle');
  assert.equal(idle.length,1);assert.equal(idle[0].at,T0+30*MIN);
});

test('finish() clôt la présence en cours', ()=>{
  const t=new FieldTracker();
  run(t,[0,1,2,3,4,5,6].map(m=>[walk(m),T0+m*MIN]));
  const closed=t.finish();
  assert.equal(closed.type,'exit');assert.equal(closed.eligible,true);assert.equal(t.current,null);
  assert.equal(t.finish(),null);
});

test('types proposés : travail prévu, chantier, récent sur l’exploitation, dernier sur la parcelle', ()=>{
  const data={
    interventions:[
      {id:'w1',parcelId:'p1',type:'Fauche',status:'À faire',plannedDate:day(0),date:day(0)},
      {id:'w2',parcelId:'p2',type:'Fanage',status:'Terminé',date:day(-2)},
      {id:'w3',parcelId:'p2',type:'Fanage',status:'Terminé',date:day(-3)},
      {id:'w4',parcelId:'p1',type:'Semis',status:'Terminé',date:day(-200)},
      {id:'w5',parcelId:'p1',type:'Labour',status:'Terminé',date:day(-1),deletedAt:1}
    ],
    chantiers:[{id:'c1',type:'Pressage',parcelIds:['p1','p2'],status:'Planifié'}]
  };
  const rows=suggestWorkTypes(data,'p1');
  assert.deepEqual(rows.map(r=>r.type),['Fauche','Pressage','Fanage','Semis']);
  assert.equal(rows[0].workId,'w1');assert.equal(rows[1].chantierId,'c1');
  assert.deepEqual(suggestWorkTypes({interventions:[]},'p1'),[]);
});

test('chantier de la parcelle : ignore les parcelles déjà faites, terminés et travaux publics', ()=>{
  const data={interventions:[{id:'w',parcelId:'p1',chantierId:'c1',status:'Terminé',type:'Fauche'}],chantiers:[
    {id:'c1',type:'Fauche',parcelIds:['p1','p2'],status:'En cours'},
    {id:'c2',type:'TP',kind:'tp',parcelIds:['p2'],status:'En cours'},
    {id:'c3',type:'Vieux',parcelIds:['p2'],status:'Terminé'}]};
  assert.equal(chantierForParcel(data,'p1'),null);
  const row=chantierForParcel(data,'p2');assert.equal(row.chantier.id,'c1');assert.equal(row.done,1);assert.equal(row.total,2);
});

test('travail construit depuis une présence : terminé, daté, heures et note explicites', ()=>{
  const start=new Date(2026,9,7,14,2).getTime(),end=start+47*MIN;
  const proposal=visitToProposal({parcelId:'p1',start,end,samples:40,durationMs:47*MIN});
  const data={materiels:[{id:'m1',nom:'Tracteur'}],preferences:{defaultOperator:'Paul'},interventions:[{id:'old',type:'fauche',status:'Terminé',date:'2026-06-01',equipmentId:'m1',operator:'Luc'}]};
  const defaults=defaultsForType(data,'Fauche');
  assert.deepEqual(defaults,{equipmentId:'m1',operator:'Luc'});
  assert.deepEqual(defaultsForType({preferences:{defaultOperator:'Paul'},interventions:[]},'Fauche'),{equipmentId:'',operator:'Paul'});
  const work=workFromProposal(proposal,parcels[0],'Fauche',defaults);
  assert.equal(work.status,'Terminé');assert.equal(work.date,'2026-10-07');assert.equal(work.campaignId,'2026/27');
  assert.equal(work.startTime,'14:02');assert.equal(work.endTime,'14:49');assert.equal(work.duration,0.78);
  assert.equal(work.surfaceWorked,11.3);assert.equal(work.equipmentId,'m1');
  assert.match(work.note,/suivi GPS\s: 47\smin \(14:02–14:49\)/);
  assert.deepEqual(work.gpsPresence,{start,end,samples:40});
  assert.throws(()=>workFromProposal(proposal,parcels[0],''));
});

test('clôture d’un travail prévu : l’échéance reste dans plannedDate, rien d’autre n’est perdu', ()=>{
  const start=new Date(2026,9,7,9,0).getTime();
  const proposal={parcelId:'p1',start,end:start+30*MIN,durationMs:30*MIN,samples:20};
  const planned={id:'w1',parcelId:'p1',type:'Fauche',status:'À faire',date:'2026-10-05',note:'Bordures',equipmentId:'m1',cost:12};
  const done=finishPlannedFromProposal(planned,proposal,parcels[0]);
  assert.equal(done.status,'Terminé');assert.equal(done.date,'2026-10-07');assert.equal(done.plannedDate,'2026-10-05');
  assert.equal(done.equipmentId,'m1');assert.equal(done.cost,12);assert.match(done.note,/^Bordures\n/);
  for(const key of Object.keys(done))if(done[key]!==planned[key])assert.ok(FINISH_KEYS.includes(key),`clé ${key} modifiée mais non restaurable par l’annulation`);
});
