import test from 'node:test';
import assert from 'node:assert/strict';
import {lateBannerHtml, todayListHtml, animalsOut, animalsCardHtml, recentListHtml, workDayLabel} from './home-view.js';

const names = new Map([['p1', 'Bois Brûlé'], ['p2', 'Pré du Moulin'], ['p3', 'Les Noues']]);
const parcels = new Map([['p1', {id: 'p1', nom: 'Bois Brûlé', surfaceHa: 10.2}], ['p3', {id: 'p3', nom: 'Les Noues', surfaceHa: 8.1}]]);

test('bandeau « En retard » : nombre, deux premiers, +N ; vide sans retard', () => {
  const late = [
    {kind: 'work', item: {id: 'a', type: 'Labour', parcelId: 'p1'}, overdue: true},
    {kind: 'task', item: {id: 'b', title: 'Clôture', parcelId: 'p2'}, overdue: true},
    {kind: 'task', item: {id: 'c', title: 'Vidange'}, overdue: true},
    {kind: 'work', item: {id: 'd', type: 'Semis'}, overdue: false}
  ];
  const out = String(lateBannerHtml(late, names));
  assert.match(out, /home-late-count" aria-hidden="true">3</);
  assert.match(out, /Labour à Bois Brûlé, Clôture à Pré du Moulin \+1/);
  assert.match(out, /data-target="overdue"/);
  assert.equal(lateBannerHtml(late.slice(3), names), '');
});

test('« Aujourd’hui » : retards exclus, tri par heure, fait barré avec reopen, échappement', () => {
  const out = String(todayListHtml({
    pending: [
      {kind: 'work', item: {id: 'w2', type: 'Traitement', parcelId: 'p3', startTime: '14:00'}},
      {kind: 'task', item: {id: 't1', title: '<b>Rentrer</b>', parcelId: 'p2'}},
      {kind: 'work', item: {id: 'w1', type: 'Fauche', parcelId: 'p1', startTime: '08:30'}},
      {kind: 'work', item: {id: 'w9', type: 'Labour', parcelId: 'p1'}, overdue: true}
    ],
    done: [{kind: 'work', item: {id: 'w5', type: 'Semis', parcelId: 'p1'}}]
  }, parcels));
  const ids = [...out.matchAll(/home-row-main" data-action="([a-z-]+)" data-id="(\w+)"/g)].map(m => `${m[1]}:${m[2]}`);
  assert.deepEqual(ids, ['finish-work:w1', 'finish-work:w2', 'finish-task:t1', 'reopen-work:w5']);
  assert.match(out, /Les Noues · 8,1 ha · à 14 h/);
  assert.ok(!out.includes('<b>Rentrer</b>') && out.includes('&lt;b&gt;Rentrer'));
  assert.match(out, /home-row is-done/);
  assert.equal(todayListHtml({pending: [], done: []}, parcels), '');
});

test('animaux au pré : sessions en cours seulement, regroupées par parcelle', () => {
  const data = {parcelles: [{id: 'p2', nom: 'Pré du Moulin'}, {id: 'p4', nom: 'La Croix'}], grazingSessions: [
    {id: 'g1', parcelId: 'p2', startDate: '2026-10-22', animalsCount: 32},
    {id: 'g2', parcelId: 'p4', startDate: '2026-10-17', animalsCount: 14},
    {id: 'g3', parcelId: 'p4', startDate: '2026-09-01', endDate: '2026-09-20', animalsCount: 9}
  ]};
  const out = animalsOut(data, new Date('2026-10-28T12:00:00'));
  assert.equal(out.total, 46);
  assert.deepEqual(out.groups.map(g => [g.name, g.n]), [['Pré du Moulin', 32], ['La Croix', 14]]);
  assert.match(String(animalsCardHtml(out)), /Pré du Moulin : 32 · La Croix : 14/);
  assert.match(String(animalsCardHtml({total: 0, groups: []})), /Tous au bâtiment/);
});

test('activité récente : trois lignes, date du jour en clair', () => {
  const works = [1, 2, 3, 4].map(i => ({id: `w${i}`, type: 'Récolte', parcelId: 'p1', date: `2026-10-2${i}`}));
  const out = String(recentListHtml(works, names, {today: '2026-10-21', dateOf: w => w.date, label: d => d.slice(5)}));
  assert.equal((out.match(/home-recent-row/g) || []).length, 3);
  assert.match(out, /Aujourd’hui/);
  assert.match(out, /10-22/);
});

test('intertitres du Planning', () => {
  assert.equal(workDayLabel('late', '2026-10-28'), 'En retard');
  assert.equal(workDayLabel('2026-10-28', '2026-10-28'), 'Aujourd’hui');
  assert.equal(workDayLabel('2026-10-29', '2026-10-28'), 'Demain · jeu. 29');
  assert.equal(workDayLabel('2026-10-27', '2026-10-28'), 'Hier · mar. 27');
  assert.equal(workDayLabel('2026-10-31', '2026-10-28'), 'Sam. 31 oct.');
  assert.equal(workDayLabel('2027-01-04', '2026-10-28'), 'Lun. 4 janv. 2027');
  assert.equal(workDayLabel('', '2026-10-28'), 'Sans date');
});
