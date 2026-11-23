// Itinéraire prévisionnel de la campagne suivante (campaign-itinerary.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {draftCampaignItinerary, nextCampaign, inputNeeds, itineraryEntities} from './campaign-itinerary.js';

const NOW = new Date(2026, 10, 14, 9).getTime(); // campagne 2026/27 : brouillon pour 2027/28
function farm() {
  const s = emptyState();
  s.parcelles = [{id: 'p1', nom: 'Les Noues', culture: 'Blé tendre', surfaceHa: 10}, {id: 'p2', nom: 'Le Haut', culture: 'Blé tendre', surfaceHa: 5},
    {id: 'p3', nom: 'Sans plan', culture: 'Colza', surfaceHa: 4}];
  s.stockItems = [{id: 's1', name: 'Fongix Fictif', category: 'Produit', unit: 'L', phyto: {amm: '9990001', maxDose: 1, doseUnit: 'L/ha', usages: [{culture: 'Blé', target: '', maxDose: 1, doseUnit: 'L/ha'}]}}];
  let n = 0;
  for (const [year, sowDay] of [[2023, 8], [2024, 12], [2025, 10]]) {
    const campaign = `${year}/${String(year + 1).slice(-2)}`;
    for (const p of ['p1', 'p2']) {
      s.rotations.push({id: `r${n++}`, parcelId: p, campaignId: campaign, culture: 'Blé tendre'});
      const sow = `${year}-10-${String(sowDay).padStart(2, '0')}`, after = d => new Date(Date.parse(`${sow}T12:00:00Z`) + d * 864e5).toISOString().slice(0, 10);
      s.interventions.push({id: `w${n++}`, parcelId: p, type: 'Semis', date: sow, status: 'Terminé', product: 'Semence blé', dose: 180, doseUnit: 'kg/ha'},
        {id: `w${n++}`, parcelId: p, type: 'Désherbage', date: after(21), status: 'Terminé', product: 'Herbix', dose: 1.5, doseUnit: 'L/ha'},
        {id: `w${n++}`, parcelId: p, type: 'Fongicide', isPhytosanitary: true, date: `${year + 1}-04-20`, status: 'Terminé', product: 'Fongix Fictif', amm: '9990001', dose: 0.8, doseUnit: 'L/ha'});
    }
  }
  s.rotations.push({id: 'n1', parcelId: 'p1', campaignId: '2027/28', culture: 'Blé tendre'}, {id: 'n2', parcelId: 'p2', campaignId: '2027/28', culture: 'Blé tendre'});
  return s;
}

test('campagne suivante', () => {
  assert.equal(nextCampaign('2026/27'), '2027/28');
  assert.equal(nextCampaign('x'), '');
});

test('brouillon : premier travail à sa date habituelle, puis enchaînement, intrants habituels', () => {
  const r = draftCampaignItinerary(farm(), {now: NOW});
  assert.equal(r.campaign, '2027/28');
  const p1 = r.works.filter(w => w.parcelId === 'p1');
  assert.deepEqual(p1.map(w => [w.type, w.plannedDate]), [['Semis', '2027-10-10'], ['Désherbage', '2027-10-31'], ['Fongicide', '2028-04-19']], 'délai médian de 171 jours ; 2028 est bissextile');
  assert.match(p1[0].reason, /habituellement vers le 10 oct\. \(3 campagnes\)/);
  assert.match(p1[1].reason, /21 jours après Semis \(6 fois\)/);
  assert.deepEqual([p1[1].product, p1[1].dose, p1[1].doseUnit], ['Herbix', 1.5, 'L/ha']);
  assert.equal(p1[0].status, 'À faire');
  assert.deepEqual(r.skipped.map(x => x.name), ['Sans plan']);
  assert.match(r.skipped[0].reason, /culture 2027\/28 non prévue/);
});

test('besoins en intrants, IFT prévisionnel, rien de reproposé si déjà prévu', () => {
  const r = draftCampaignItinerary(farm(), {now: NOW});
  const herbix = r.needs.find(n => n.product === 'Herbix');
  assert.deepEqual(herbix, {product: 'Herbix', unit: 'L', quantity: 22.5, parcels: 2});
  assert.ok(r.ift.total > 0, JSON.stringify(r.ift));
  const s = farm();
  s.interventions.push({id: 'x', parcelId: 'p1', type: 'Semis', plannedDate: '2027-10-05', date: '2027-10-05', status: 'À faire'});
  const again = draftCampaignItinerary(s, {now: NOW}).works.filter(w => w.parcelId === 'p1').map(w => w.type);
  assert.deepEqual(again, ['Désherbage', 'Fongicide']);
  assert.deepEqual(inputNeeds([{product: 'A', dose: 2, doseUnit: 'kg / ha', surfaceHa: 3}]), [{product: 'A', unit: 'kg', quantity: 6, parcels: 1}]);
});

test('écriture : champs de calcul retirés, raison gardée en note', () => {
  const [w] = itineraryEntities(draftCampaignItinerary(farm(), {now: NOW}).works.slice(0, 1));
  assert.equal(w.parcelName, undefined);
  assert.equal(w.reason, undefined);
  assert.match(w.note, /^Prévu d’après vos habitudes : habituellement vers le/);
  assert.equal(w.source, 'itineraire');
});

test('relecture : jour de semaine habituel, statut « Annulée », moisson à cheval sur le 1er août', () => {
  // Désherbage toujours un lundi : la date proposée est ramenée au lundi le plus proche.
  const s = farm();
  for (const w of s.interventions) if (w.type === 'Désherbage') { const d = new Date(Date.parse(`${w.date}T12:00:00Z`)); const diff = (1 - d.getUTCDay() + 7) % 7; w.date = new Date(d.getTime() + (diff > 3 ? diff - 7 : diff) * 864e5).toISOString().slice(0, 10); }
  const weeded = draftCampaignItinerary(s, {now: NOW}).works.find(w => w.parcelId === 'p1' && w.type === 'Désherbage');
  assert.equal(new Date(`${weeded.plannedDate}T12:00:00Z`).getUTCDay(), 1, weeded.plannedDate);
  // Un semis annulé (féminin) ne compte pas comme déjà prévu.
  const s2 = farm(); s2.interventions.push({id: 'c', parcelId: 'p2', type: 'Semis', plannedDate: '2027-10-05', date: '2027-10-05', status: 'Annulée'});
  assert.ok(draftCampaignItinerary(s2, {now: NOW}).works.some(w => w.parcelId === 'p2' && w.type === 'Semis'));
  // Moisson fin juillet (décalage 364-365) : proposée en fin de campagne, pas le 1er août de la campagne visée.
  const s3 = emptyState();
  s3.parcelles = [{id: 'o', nom: 'Orge', culture: 'Orge', surfaceHa: 3}];
  for (const [c, d] of [['2023/24', '2024-07-31'], ['2024/25', '2025-07-31']]) { s3.rotations.push({id: c, parcelId: 'o', campaignId: c, culture: 'Orge'}); s3.interventions.push({id: d, parcelId: 'o', type: 'Moisson', date: d, status: 'Terminé'}); }
  s3.rotations.push({id: 'n', parcelId: 'o', campaignId: '2026/27', culture: 'Orge'});
  const harvest = draftCampaignItinerary(s3, {now: new Date(2025, 10, 14).getTime()}).works[0];
  assert.equal(harvest.plannedDate, '2027-07-31');
});
