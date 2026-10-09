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
