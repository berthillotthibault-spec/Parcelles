// n° 71 — « Mon exploitation en chiffres verts » : indicateurs, barèmes par thème HVE, CO2 et fiche.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GREEN_REFERENTIAL,CO2_FACTORS,pointsAtLeast,pointsAtMost,campaignWindow,campaignChoices,validateGreenSettings,greenSettings,
  cropDiversity,fuelUse,carbonEstimate,phytoTheme,irrigationTheme,greenIndicators,themeSentence,improvementTips,keyFigures,greenSheetHtml
} from './green-indicators.js';
import {INFRA_KIND} from './hedges.js';

const lat = 46.3, dLon = 100 / (111320 * Math.cos(lat * Math.PI / 180));
const line = {type: 'LineString', coordinates: [[5, lat], [5 + dLon * 10, lat]]}; // ≈ 1 000 m
const farm = () => ({
  exploitation: {nom: 'Ferme <des Essais>', commune: 'Bourg'},
  parcelles: [
    {id: 'a', nom: 'A', surfaceHa: 20, culture: 'Blé tendre'}, {id: 'b', nom: 'B', surfaceHa: 10, culture: 'Colza'},
    {id: 'c', nom: 'C', surfaceHa: 10, culture: 'Prairie permanente'}, {id: 'd', nom: 'D', surfaceHa: 5, culture: 'Féverole'},
    {id: 'x', nom: 'Voisin', surfaceHa: 50, culture: 'Maïs', ownershipType: 'contracted'}
  ],
  interventions: [
    {id: 'w1', parcelId: 'a', type: 'Fertilisation', product: 'Ammonitrate 33,5', dose: 150, doseUnit: 'kg/ha', date: '2026-03-01', status: 'Terminé', inputCost: 900},
    {id: 'w2', parcelId: 'a', type: 'Traitement', product: 'Inconnu', dose: 1, doseUnit: 'L/ha', date: '2026-02-01', status: 'Terminé', fuel: 30},
    {id: 'w3', parcelId: 'b', type: 'Irrigation', date: '2026-06-01', status: 'Terminé', dose: 25}
  ],
  integrationImports: [
    {id: 'f1', farmKind: 'fuel', entry: 'tank', litres: 1500, date: '2026-01-10'},
    {id: 'f2', farmKind: 'fuel', entry: 'tank', litres: 999, date: '2025-07-31'}, // campagne précédente
    {id: 'h', farmKind: INFRA_KIND, createdAt: 1, type: 'haie', geometry: line}
  ],
  preferences: {}
});

test('barèmes à seuils', () => {
  assert.equal(pointsAtLeast([[3, 1], [5, 2], [7, 3]], 2), 0);
  assert.equal(pointsAtLeast([[3, 1], [5, 2], [7, 3]], 5), 2);
  assert.equal(pointsAtLeast([[3, 1]], null), 0);
  assert.equal(pointsAtMost([[0.5, 3], [1, 2], [1.5, 1]], 0.5), 3);
  assert.equal(pointsAtMost([[0.5, 3], [1, 2], [1.5, 1]], 1.2), 1);
  assert.equal(pointsAtMost([[0.5, 3]], 4), 0);
});

test('campagnes et réglages', () => {
  assert.deepEqual(campaignWindow('2025/26'), {from: '2025-08-01', to: '2026-07-31'});
  assert.equal(campaignChoices('2026-10-18')[0], '2026/27');
  assert.equal(campaignChoices('2026-10-18').length, 3);
  assert.ok(validateGreenSettings({iftRefHerbicide: '25'}).error);
  assert.deepEqual(validateGreenSettings({iftRefHerbicide: '1,3', iftRefOther: ''}).value, {iftRefHerbicide: 1.3, iftRefOther: null});
  assert.deepEqual(greenSettings({preferences: {greenIndicators: {iftRefHerbicide: 1.3, iftRefOther: 'x'}}}), {iftRefHerbicide: 1.3, iftRefOther: null});
});

test('assolement : seules les parcelles en propriété ou en fermage comptent', () => {
  const d = cropDiversity(farm(), '2025/26', {today: '2026-05-01'});
  assert.equal(d.sau, 45);
  assert.equal(d.count, 3);
  assert.equal(d.main.culture, 'Blé tendre');
  assert.ok(Math.abs(d.ppShare - 10 / 45) < 1e-9);
  assert.equal(d.legumeArea, 5);
});

test('GNR : achats de la campagne en priorité, puis litres des travaux', () => {
  assert.deepEqual(fuelUse(farm(), '2025/26'), {litres: 1500, source: 'achats de GNR (cuve et pleins hors cuve)', count: 1});
  const s = farm(); s.integrationImports = [];
  assert.equal(fuelUse(s, '2025/26').litres, 30);
  assert.equal(fuelUse(s, '2024/25').litres, 0);
});

test('CO2 : facteurs fixes, datés et sourcés', () => {
  for (const k of ['gnr', 'mineralN', 'n2o']) assert.ok(CO2_FACTORS[k].source && CO2_FACTORS[k].value > 0);
  assert.match(CO2_FACTORS.date, /^\d{4}-\d{2}-\d{2}$/);
  const c = carbonEstimate({fuel: {litres: 1000}, nitrogen: {mineralKg: 100, organicKg: 100}, sau: 10});
  assert.equal(c.lines.find(l => l.key === 'gnr').kg, Math.round(1000 * CO2_FACTORS.gnr.value));
  assert.equal(c.lines.find(l => l.key === 'n2o').kg, Math.round(200 * CO2_FACTORS.n2o.value));
  assert.equal(c.perHa, Math.round((3170 + 350 + 858) / 10));
});

test('IFT non calculable : aucun point plutôt qu’un faux IFT nul', () => {
  const ift = {farm: {total: 0, herbicide: 0, other: 0, biocontrol: 0, treatments: 2, missing: 2, surface: 10}, parcels: [{surface: 10, ift: {treatments: 2}}]};
  const t = phytoTheme(ift, {iftRefHerbicide: null, iftRefOther: null}, 10);
  assert.equal(t.items.find(i => i.key === 'ift-herbicide').points, 0);
  assert.match(t.items.find(i => i.key === 'ift-herbicide').display, /non calculable/);
  const none = phytoTheme({farm: {...ift.farm, treatments: 0, missing: 0}, parcels: [{surface: 10, ift: {treatments: 0}}]}, {}, 10);
  // Aucun traitement enregistré : donnée absente, donc aucun point (ni IFT, ni surface non traitée).
  for (const key of ['ift-herbicide', 'ift-autre', 'non-traite']) {
    const i = none.items.find(x => x.key === key);
    assert.equal(i.points, 0, key);
    assert.equal(i.missing, true, key);
  }
  assert.equal(none.points, 0);
});

test('azote : sans apport enregistré, pas de point « azote total »', () => {
  const r = greenIndicators({parcelles: [{id: 'a', nom: 'A', surfaceHa: 10, culture: 'Blé tendre'}], interventions: []}, {today: '2026-05-01'});
  const n = r.themes.find(t => t.key === 'fertilisation').items.find(i => i.key === 'n-total');
  assert.equal(n.points, 0);
  assert.equal(n.missing, true);
  assert.equal(r.themes.find(t => t.key === 'phyto').points, 0);
});

test('IFT : la fiche du catalogue phyto est prise en compte, comme sur l’écran IFT', () => {
  const s = {parcelles: [{id: 'a', nom: 'A', surfaceHa: 10, culture: 'Blé tendre'}],
    interventions: [{id: 't', parcelId: 'a', type: 'Traitement', product: 'Désherbant X', dose: 1, doseUnit: 'L/ha', date: '2026-03-01', status: 'Terminé'}]};
  assert.equal(greenIndicators(s, {today: '2026-05-01'}).ift.farm.missing, 1);
  const catalog = ({name}) => name === 'Désherbant X' ? {name, category: 'herbicide', refDose: 2, doseUnit: 'L/ha'} : null;
  const r = greenIndicators(s, {today: '2026-05-01', catalog});
  assert.equal(r.ift.farm.missing, 0);
  assert.equal(r.ift.farm.herbicide, 0.5);
});

test('irrigation : thème non concerné sans travail d’irrigation', () => {
  assert.equal(irrigationTheme({works: 0, recorded: 0, located: 0}).na, true);
  const t = irrigationTheme({works: 2, recorded: 2, located: 1});
  assert.equal(t.points, 6 + 2);
  assert.equal(t.reached, false);
});

test('synthèse, phrases de jauge et pistes', () => {
  const r = greenIndicators(farm(), {today: '2026-05-01'});
  assert.equal(r.campaign, '2025/26');
  assert.equal(r.referential.version, GREEN_REFERENTIAL.version);
  assert.equal(r.themes.length, 4);
  assert.equal(r.scored, 4); // irrigation enregistrée
  assert.equal(r.fuelPerHa, Math.round(1500 / 45 * 10) / 10);
  assert.ok(r.iae.hedgeKm > 0.9);
  const bio = r.themes.find(t => t.key === 'biodiversite');
  assert.match(themeSentence(bio), new RegExp(`^${bio.points}/10 points biodiversité, il manque ${10 - bio.points} point`));
  assert.equal(themeSentence({...bio, points: 10, reached: true}), '10/10 points biodiversité, seuil atteint');
  const tips = improvementTips(r);
  assert.ok(tips.length > 0 && tips.length <= 5);
  for (let i = 1; i < tips.length; i++) assert.ok(tips[i - 1].gain >= tips[i].gain);
  assert.equal(keyFigures(r).length, 8);
  assert.equal(greenIndicators({parcelles: []}, {today: '2026-05-01'}).empty, true);
});

test('fiche imprimable : avertissement, version du référentiel, échappement', () => {
  const s = farm(), r = greenIndicators(s, {today: '2026-05-01'});
  const html = greenSheetHtml(r, {farm: s.exploitation});
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Auto-diagnostic, pas une certification/);
  assert.ok(html.includes(`version ${GREEN_REFERENTIAL.version}`));
  assert.ok(html.includes('Ferme &lt;des Essais&gt;'));
  assert.ok(!html.includes('<des Essais>'));
  // Le nom de l'exploitation n'entre pas dans la feuille de style (pied de page CSS).
  const css = greenSheetHtml(r, {farm: {...s.exploitation, nom: 'Ferme\r"X"'}}).match(/<style>[\s\S]*?<\/style>/)[0];
  assert.ok(!css.includes('Ferme') && !css.includes('\r'));
  assert.ok(html.includes(CO2_FACTORS.gnr.source.split(',')[0]));
});
