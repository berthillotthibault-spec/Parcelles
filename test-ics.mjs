import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {icsEscape,foldLine,buildCalendar,upcomingEvents,itemEvent,parseIcsEvents,icsUid,icsFileName} from './ics.js';

const stamp='20261008T060000Z';

test('échappement RFC 5545 : antislash, point-virgule, virgule et retour à la ligne', () => {
  assert.equal(icsEscape('a\\b;c,d\ne'),'a\\\\b\\;c\\,d\\ne');
  assert.equal(icsEscape(null),'');
});

test('pliage à 75 octets sans couper un caractère accentué', () => {
  const line='SUMMARY:'+'é'.repeat(80);
  const folded=foldLine(line);
  for(const part of folded.split('\r\n'))assert.ok(new TextEncoder().encode(part).length<=75);
  assert.equal(folded.replace(/\r\n /g,''),line);
});

test('événement horaire : DTSTART/DTEND flottants, alarme 30 min avant, UID stable', () => {
  const work={id:'w1',type:'Récolte maïs',plannedDate:'2026-10-08',date:'2026-10-08',status:'À faire',startTime:'08:30',duration:2,version:3};
  const ics=buildCalendar([itemEvent(work,'work',{parcelName:'Grand Champ, nord'})],{stamp});
  assert.match(ics,/^BEGIN:VCALENDAR\r\n/);assert.match(ics,/END:VCALENDAR\r\n$/);
  assert.ok(!/[^\r]\n/.test(ics),'toutes les lignes finissent par CRLF');
  const [e]=parseIcsEvents(ics);
  assert.equal(e.UID,icsUid('work','w1'));
  assert.equal(e.DTSTART,'20261008T083000');assert.equal(e.DTEND,'20261008T103000');
  assert.equal(e.SUMMARY,'Récolte maïs · Grand Champ, nord');assert.equal(e.SEQUENCE,'3');
  assert.ok(e.alarm);assert.match(ics,/BEGIN:VALARM\r\nACTION:DISPLAY\r\n.*\r\nTRIGGER:-PT30M\r\nEND:VALARM/);
  assert.match(e.DESCRIPTION,/pas répercutée/);
  // Réexport identique : même UID, pour que l'agenda mette à jour au lieu de dupliquer.
  assert.equal(parseIcsEvents(buildCalendar([itemEvent(work,'work')],{stamp}))[0].UID,e.UID);
});

test('journée entière : DATE et alarme à 7 h le jour même', () => {
  const ics=buildCalendar([itemEvent({id:'t1',title:'Réparer clôture',dueDate:'2026-12-31',status:'À faire'},'task')],{stamp});
  assert.match(ics,/DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.match(ics,/TRIGGER:PT7H/);
});

test('30 prochains jours : à faire seulement, retards, terminés et supprimés exclus', () => {
  const state={parcelles:[{id:'p1',nom:'Les Noues'}],
    interventions:[{id:'a',type:'Semis',plannedDate:'2026-10-10',status:'À faire',parcelId:'p1'},{id:'b',type:'Vieux',plannedDate:'2026-10-01',status:'À faire'},{id:'c',type:'Fait',date:'2026-10-12',status:'Terminé'},{id:'d',type:'Loin',plannedDate:'2026-12-01',status:'À faire'},{id:'e',type:'Supprimé',plannedDate:'2026-10-11',status:'À faire',deletedAt:'x'}],
    tasks:[{id:'t',title:'Clôture',dueDate:'2026-10-08',status:'À faire'}]};
  const rows=upcomingEvents(state,{from:'2026-10-08',days:30});
  assert.deepEqual(rows.map(r=>r.id),['t','a']);
  assert.equal(rows[1].location,'Les Noues');
});

test('sans date, pas d’événement ; nom de fichier sans accent', () => {
  assert.equal(itemEvent({id:'x',type:'Sans date',status:'À faire'},'work'),null);
  assert.equal(icsFileName('travail-Récolte maïs · Grand Champ'),'travail-recolte-mais-grand-champ.ics');
});

test('rappels du service worker : résumé du jour et des retards', () => {
  const context={};vm.createContext(context);
  vm.runInContext(readFileSync(new URL('./sw-reminders.js',import.meta.url),'utf8'),context);
  const {computeReminders}=context.ParcellesReminders;
  const state={interventions:[{id:'a',type:'Semis',plannedDate:'2026-10-08',status:'À faire',startTime:'08:00'},{id:'b',type:'Retard',plannedDate:'2026-10-01',status:'En cours'},{id:'c',type:'Demain',plannedDate:'2026-10-09',status:'À faire'},{id:'d',type:'Fini',date:'2026-10-08',status:'Terminé'}],tasks:[{id:'t',title:'Clôture',dueDate:'2026-10-08',status:'À faire'}]};
  const summary=computeReminders(state,'2026-10-08');
  assert.equal(summary.count,3);assert.equal(summary.tag,'parcelles-rappel-2026-10-08');
  assert.match(summary.title,/2 à faire aujourd’hui · 1 en retard/);
  assert.match(summary.body,/^Retard \(retard\)\n08:00 Semis/);
  assert.equal(computeReminders({interventions:[]},'2026-10-08'),null);
});

// n° 17 : échéances de computeNotifications utiles, communes aux rappels et à l'agenda.
const dueState=()=>({parcelles:[{id:'p1',nom:'Les Noues'}],
  materiels:[{id:'m1',nom:'Tracteur',maintenanceDate:'2026-10-20'},{id:'m2',nom:'Télescopique',currentMeter:520,maintenanceDue:500},{id:'m3',nom:'Herse',currentMeter:100,maintenanceDue:300}],
  stockItems:[{id:'s1',name:'Fongix',phyto:{dar:21,dre:48}}],
  interventions:[{id:'t1',type:'Traitement fongicide',status:'Terminé',date:'2026-10-07',endTime:'10:00',parcelId:'p1',product:'Fongix'},
    {id:'t2',type:'Désherbage',status:'Terminé',date:'2026-10-08',startTime:'09:00',parcelId:'p1',phytoLimits:{dar:3,dre:null}},
    {id:'t3',type:'Désherbage',status:'À faire',plannedDate:'2026-10-09',parcelId:'p1',product:'Fongix'}],
  automationRules:[{id:'r1',enabled:true,kind:'grazing_duration',threshold:7}],
  grazingSessions:[{id:'g1',parcelId:'p1',startDate:'2026-10-01'},{id:'g2',parcelId:'p1',startDate:'2026-10-05',endDate:'2026-10-12'},{id:'g3',parcelId:'p1',startDate:'2026-09-01',endDate:'2026-09-10'}]});

test('échéances : entretien à date et au compteur, fins de DAR et de DRE, lots à rentrer', () => {
  const context={};vm.createContext(context);
  vm.runInContext(readFileSync(new URL('./sw-reminders.js',import.meta.url),'utf8'),context);
  const rows=context.ParcellesReminders.dueDates(dueState(),{today:'2026-10-08'}).map(r=>`${r.kind}:${r.id}:${r.day}${r.time?' '+r.time:''}`);
  assert.deepEqual([...rows],['reentry:t2:2026-10-08 15:00','maintenance:m2-meter:2026-10-08','grazing:g1:2026-10-08','reentry:t1:2026-10-09 10:00','dar:t2:2026-10-11','grazing:g2:2026-10-12','maintenance:m1-date:2026-10-20','dar:t1:2026-10-28']);
  const summary=context.ParcellesReminders.computeReminders(dueState(),'2026-10-08');
  assert.match(summary.body,/Rentrer le lot · Les Noues/);
  assert.match(summary.body,/Entretien dû · Télescopique/);
  assert.match(summary.body,/15:00 Fin du délai de rentrée · Les Noues/);
  assert.doesNotMatch(summary.body+summary.title,/Herse|délai avant récolte/,'fin de DAR d’un autre jour et entretien non dû absents');
});

test('échéances : lot à sortie prévue rappelé le jour même, pas une sortie saisie ce jour-là', () => {
  const context={};vm.createContext(context);
  vm.runInContext(readFileSync(new URL('./sw-reminders.js',import.meta.url),'utf8'),context);
  const state={parcelles:[{id:'p1',nom:'Les Noues'}],grazingSessions:[{id:'g2',parcelId:'p1',startDate:'2026-10-05',endDate:'2026-10-12',updatedAt:'2026-10-06T08:00:00.000Z'},{id:'g4',parcelId:'p1',startDate:'2026-10-05',endDate:'2026-10-12',updatedAt:'2026-10-12T10:00:00.000Z'}]};
  assert.match(context.ParcellesReminders.computeReminders(state,'2026-10-12').body,/Rentrer le lot · Les Noues/);
  assert.equal(context.ParcellesReminders.dueDates(state,{today:'2026-10-12'}).filter(r=>r.kind==='grazing').map(r=>r.id).join(),'g2');
  assert.equal(context.ParcellesReminders.computeReminders(state,'2026-10-13'),null,'sortie passée : plus de rappel');
});

test('agenda : échéances datées exportées avec alarme et avertissement ; entretien au compteur exclu', () => {
  const rows=upcomingEvents(dueState(),{from:'2026-10-08',days:30});
  assert.deepEqual(rows.map(r=>r.uid.replace(/@.*/,'')),['parcelles-reentry-t2','parcelles-grazing-g1','parcelles-reentry-t1','parcelles-work-t3','parcelles-dar-t2','parcelles-grazing-g2','parcelles-maintenance-m1-date','parcelles-dar-t1']);
  const ics=buildCalendar(rows,{stamp}),events=parseIcsEvents(ics),reentry=events.find(e=>e.UID.startsWith('parcelles-reentry-t1'));
  assert.equal(reentry.DTSTART,'20261009T100000');assert.equal(reentry.CATEGORIES,'Délai de rentrée');assert.ok(reentry.alarm);
  assert.match(ics,/TRIGGER:-PT0M/,'alarme à l’heure de fin du délai');
  const dar=events.find(e=>e.UID.startsWith('parcelles-dar-t1'));
  assert.equal(dar.DTSTART,'20261028');assert.match(dar.DESCRIPTION,/DAR de 21 j[^]*pas répercutée/);
  assert.ok(!events.some(e=>/Télescopique/.test(e.SUMMARY)),'entretien au compteur : rappel seulement');
});
