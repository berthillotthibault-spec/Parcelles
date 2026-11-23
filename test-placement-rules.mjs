// Interdits de placement (placement-rules.js) et leur effet sur « Organise ma semaine » (week-planner.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {placementConstraints} from './placement-rules.js';
import {proposeWeek, checkPlacement} from './week-planner.js';

const tz = process.env.TZ; process.env.TZ = 'Europe/Paris';
test.after(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });

const PRODUCT = {id: 's1', name: 'Fongix Fictif', category: 'Produit', unit: 'L', quantity: 20, phyto: {amm: '9990001', maxDose: 1, doseUnit: 'L/ha', dar: 35, dre: 24}};
function farm(extra = {}) {
  const s = emptyState();
  s.parcelles = [{id: 'p1', nom: 'Les Noues', culture: 'Colza', surfaceHa: 10, zoneVulnerable: true},
    {id: 'p2', nom: 'Le Pré', culture: 'Prairie permanente', surfaceHa: 4, zoneVulnerable: false}];
  s.stockItems = [structuredClone(PRODUCT)];
  return Object.assign(s, extra);
}
const codes = list => list.map(r => `${r.code}:${r.level}`);

test('zone vulnérable : lisier sur colza interdit du 15/10 au 31/01, autorisé hors zone ou hors période', () => {
  const lisier = {id: 'w1', parcelId: 'p1', type: 'Épandage', kind: 'fertilize', product: 'Lisier de porc', status: 'À faire'};
  const banned = placementConstraints(farm(), lisier, '2026-11-20');
  assert.deepEqual(codes(banned), ['zv:refuse']);
  assert.match(banned[0].message, /épandage interdit en zone vulnérable .*jusqu’au/);
  assert.deepEqual(placementConstraints(farm(), lisier, '2026-03-10'), []);
  assert.deepEqual(placementConstraints(farm(), {...lisier, parcelId: 'p2'}, '2026-11-20'), []);
});

test('traitement : récolte prévue dans le DAR et animaux au pré', () => {
  const harvest = {id: 'h1', parcelId: 'p1', type: 'Moisson', plannedDate: '2026-07-10', date: '2026-07-10', status: 'À faire'};
  const spray = {id: 'w2', parcelId: 'p1', type: 'Fongicide', isPhytosanitary: true, product: 'Fongix Fictif', amm: '9990001', status: 'À faire'};
  assert.deepEqual(codes(placementConstraints(farm({interventions: [harvest]}), spray, '2026-06-20')), ['dar:refuse']);
  assert.deepEqual(placementConstraints(farm({interventions: [harvest]}), spray, '2026-05-20'), []);
  const grazed = farm({grazingSessions: [{id: 'g1', parcelId: 'p2', startDate: '2026-06-01', animals: [{number: '1'}, {number: '2'}]}]});
  const r = placementConstraints(grazed, {...spray, parcelId: 'p2'}, '2026-06-20');
  assert.deepEqual(codes(r), ['grazing:refuse']);
  assert.match(r[0].message, /2 animaux au pré sur Le Pré/);
});

test('récolte dans le DAR d’un traitement terminé ; délai de rentrée : journée perdue ou simple précision', () => {
  const done = {id: 't1', parcelId: 'p1', type: 'Fongicide', isPhytosanitary: true, product: 'Fongix Fictif', amm: '9990001', status: 'Terminé', date: '2026-06-01', startTime: '08:00', endTime: '09:00'};
  const s = farm({interventions: [done]});
  assert.deepEqual(codes(placementConstraints(s, {id: 'h', parcelId: 'p1', type: 'Moisson', status: 'À faire'}, '2026-06-20')), ['dar-harvest:refuse']);
  assert.deepEqual(placementConstraints(s, {id: 'h', parcelId: 'p1', type: 'Moisson', status: 'À faire'}, '2026-07-20'), []);
  // DRE 24 h : fin le 2 juin à 9 h → le 1er juin est perdu, le 2 juin reste possible après 9 h.
  const hoe = {id: 'x', parcelId: 'p1', type: 'Binage', status: 'À faire'};
  assert.deepEqual(codes(placementConstraints(s, hoe, '2026-06-01')), ['reentry:refuse']);
  const next = placementConstraints(s, hoe, '2026-06-02');
  assert.deepEqual(codes(next), ['reentry:warn']);
  assert.match(next[0].message, /^après 9 h \(délai de rentrée après Fongix Fictif\)/);
  assert.deepEqual(placementConstraints(s, hoe, '2026-06-03'), []);
  assert.deepEqual(placementConstraints(s, hoe, 'pas une date'), []);
});

test('Organise ma semaine : le jour interdit est écarté avec sa raison, l’avertissement manuel aussi', () => {
  // Lundi 12 octobre 2026 : lisier sur colza interdit à partir du jeudi 15.
  const now = new Date(2026, 9, 12, 7).getTime();
  const lisier = {id: 'w1', parcelId: 'p1', type: 'Épandage', kind: 'fertilize', product: 'Lisier de porc', status: 'À faire', createdAt: 1};
  const s = farm({interventions: [lisier]});
  const fill = Array.from({length: 3}, (_, i) => ({id: `f${i}`, parcelId: 'p2', type: 'Entretien', status: 'À faire', plannedDate: `2026-10-${12 + i}`, durationHours: 9, createdAt: 2}));
  s.interventions.push(...fill);
  const plan = proposeWeek(s, '2026-10-12', {now, capacity: 8});
  const item = plan.placed.find(p => p.work.id === 'w1');
  if (item) assert.ok(item.date < '2026-10-15', `placé le ${item.date}, jour interdit`);
  else assert.ok(plan.unplaced.find(u => u.work.id === 'w1').reasons.some(r => /zone vulnérable/.test(r)));
  // Sans jour libre avant le 15 : refusé avec la raison.
  const crowded = proposeWeek(s, '2026-10-19', {now});
  const u = crowded.unplaced.find(x => x.work.id === 'w1');
  assert.ok(u, 'aucun jour possible la semaine du 19');
  assert.ok(u.reasons.every(r => /zone vulnérable/.test(r)), u.reasons.join(' | '));
  // Déplacement à la main sur un jour interdit : avertissement.
  if (item) assert.ok(checkPlacement(s, plan, 'w1', '2026-10-16', {now}).some(w => /zone vulnérable/.test(w)));
});

test('relecture : traitement et récolte proposés ensemble, traitement prévu ou en cours, nom de parcelle intact', () => {
  const spray = {id: 'w2', parcelId: 'p1', type: 'Fongicide', isPhytosanitary: true, product: 'Fongix Fictif', amm: '9990001', status: 'À faire', createdAt: 1};
  const harvest = {id: 'h1', parcelId: 'p1', type: 'Moisson', status: 'À faire', createdAt: 2};
  // Proposés ensemble : la moisson ne tombe pas dans le DAR du fongicide placé avant elle.
  const now = new Date(2026, 5, 15, 7).getTime();
  const plan = proposeWeek(farm({interventions: [spray, harvest]}), '2026-06-15', {now});
  const s1 = plan.placed.find(p => p.work.id === 'w2'), h = plan.placed.find(p => p.work.id === 'h1');
  assert.ok(s1, 'fongicide placé');
  assert.ok(!h, `moisson non placée dans le DAR (placée le ${h?.date})`);
  assert.ok(plan.unplaced.find(u => u.work.id === 'h1').reasons.every(r => /délai avant récolte de 35 jours/.test(r)));
  // L'inverse : récolte déjà proposée, le traitement dans le DAR est refusé.
  const planned = new Map([['h1', {work: harvest, date: '2026-06-20'}]]);
  assert.deepEqual(codes(placementConstraints(farm({interventions: [spray, harvest]}), spray, '2026-06-16', {planned})), ['dar:refuse']);
  // Traitement prévu (pas encore fait) : la récolte dans son DAR est refusée ; pas de délai de rentrée (pas certain).
  const planned2 = {...spray, plannedDate: '2026-06-15', date: '2026-06-15'};
  assert.deepEqual(codes(placementConstraints(farm({interventions: [planned2]}), harvest, '2026-06-15')), ['dar-harvest:refuse']);
  assert.deepEqual(placementConstraints(farm({interventions: [planned2]}), {id: 'x', parcelId: 'p1', type: 'Binage'}, '2026-06-15'), []);
  // Traitement en cours : délai de rentrée et DAR comptent.
  const running = {...spray, status: 'En cours', date: '2026-06-01', startTime: '08:00', endTime: '09:00'};
  assert.deepEqual(codes(placementConstraints(farm({interventions: [running]}), {id: 'x', parcelId: 'p1', type: 'Binage'}, '2026-06-01')), ['reentry:refuse']);
  assert.deepEqual(codes(placementConstraints(farm({interventions: [running]}), harvest, '2026-06-10')), ['dar-harvest:refuse']);
  // Annulé : sans effet.
  assert.deepEqual(placementConstraints(farm({interventions: [{...running, status: 'Annulé'}]}), harvest, '2026-06-10'), []);
  // Message de récolte : commence par « délai », pas par un nom de parcelle déformé.
  const done = {...spray, status: 'Terminé', date: '2026-06-01'};
  const msg = placementConstraints(farm({interventions: [done]}), harvest, '2026-06-20')[0].message;
  assert.match(msg, /^délai avant récolte de 35 jours après Fongix Fictif du 1 juin 2026, jusqu’au 6 juil\. 2026$/);
});
