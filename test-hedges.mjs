// n° 70 — haies et IAE : géométries, linéaire, surface pondérée, part de SAU et période de taille.
import test from 'node:test';
import assert from 'node:assert/strict';
import {geometryFromPoints,lineLengthM,measure,validateInfra,infraSummary,infraRules,validateRules,isHedgeTrimWork,inBanPeriod,trimCheck,infraCsv,infraGeoJson,INFRA_KIND} from './hedges.js';

const lat = 46.3, dLon = 100 / (111320 * Math.cos(lat * Math.PI / 180)), dLat = 100 / 111320;
const line = {type: 'LineString', coordinates: [[5, lat], [5 + dLon * 10, lat]]}; // ≈ 1 000 m
const rec = (id, x) => ({id, farmKind: INFRA_KIND, createdAt: 1, ...x});

test('géométries saisies et validation', () => {
  assert.equal(geometryFromPoints([{latitude: 46, longitude: 5}], 'point').type, 'Point');
  assert.throws(() => geometryFromPoints([{latitude: 46, longitude: 5}], 'line'));
  const poly = geometryFromPoints([{latitude: 46, longitude: 5}, {latitude: 46, longitude: 5.001}, {latitude: 46.001, longitude: 5.001}], 'area');
  assert.deepEqual(poly.coordinates[0][0], poly.coordinates[0].at(-1));
  assert.ok(Math.abs(lineLengthM(line.coordinates) - 1000) <= 2);
  assert.ok(validateInfra({type: 'haie', geometry: {type: 'Point', coordinates: [5, 46]}}).error);
  assert.ok(validateInfra({type: 'x', geometry: line}).error);
  assert.ok(validateInfra({type: 'bande', geometry: line, widthM: 500}).error);
  const v = validateInfra({type: 'haie', geometry: line, label: ' Haie nord ', sustainable: 'on'}).value;
  assert.equal(v.label, 'Haie nord'); assert.equal(v.sustainable, true);
});

test('mesures et compteur de l’exploitation', () => {
  const sq = {type: 'Polygon', coordinates: [[[5, lat], [5 + dLon, lat], [5 + dLon, lat + dLat], [5, lat + dLat], [5, lat]]]}; // ≈ 1 ha
  const s = {parcelles: [{id: 'p1', surfaceHa: 40}, {id: 'p2', surfaceHa: 60}], integrationImports: [
    rec('h', {type: 'haie', geometry: line}), rec('b', {type: 'bande', geometry: line, widthM: 5}),
    rec('m', {type: 'mare', geometry: {type: 'Point', coordinates: [5, lat]}, areaM2: 200}), rec('o', {type: 'bosquet', geometry: sq}), rec('a', {type: 'arbre', geometry: {type: 'Point', coordinates: [5, lat]}})]};
  const m = measure(s.integrationImports[1]);
  assert.ok(Math.abs(m.area - 5000) <= 10);
  const r = infraSummary(s);
  assert.equal(r.hedgeKm, 1); assert.equal(r.sauHa, 100);
  // 1000 × 20 + 5000 × 1,5 + 200 × 1,5 + ≈10 000 × 1,5 + 20 ≈ 42 820 m² → ≈ 4,3 % de la SAU.
  assert.ok(Math.abs(r.weightedHa - 4.28) < 0.05, String(r.weightedHa)); assert.equal(r.iaePct, 4.3);
  const custom = infraSummary({...s, preferences: {agroInfraRules: {coefficients: {haie: 10}}}});
  assert.ok(custom.weightedHa < r.weightedHa);
  assert.match(infraCsv(s), /^﻿Type;Nom/);
  assert.equal(infraGeoJson(s).features.length, 5);
});

test('période d’interdiction de taille (BCAE 8), paramétrable', () => {
  assert.equal(isHedgeTrimWork({type: 'Taille de haie'}), true);
  assert.equal(isHedgeTrimWork({type: 'Épareuse', product: ''}), true);
  assert.equal(isHedgeTrimWork({type: 'Taille de vigne'}), false);
  assert.equal(inBanPeriod('2026-03-16'), true); assert.equal(inBanPeriod('2026-08-15'), true);
  assert.equal(inBanPeriod('2026-03-15'), false); assert.equal(inBanPeriod('2026-08-16'), false);
  const c = trimCheck({type: 'Taille haies', date: '2026-05-02', status: 'Terminé'}, {});
  assert.equal(c.blocked, true); assert.match(c.message, /16\/03 au 15\/08/);
  assert.equal(trimCheck({type: 'Taille haies', date: '2026-05-02', status: 'Terminé', hedgeDerogation: true}, {}).blocked, false);
  assert.equal(trimCheck({type: 'Taille haies', date: '2026-09-02', status: 'Terminé'}, {}).blocked, false);
  assert.equal(trimCheck({type: 'Taille haies', date: '2026-02-01', plannedDate: '2026-04-01', status: 'À faire'}, {}).blocked, true);
  const st = {preferences: {agroInfraRules: {banStart: '04-01', banEnd: '07-31'}}};
  assert.equal(infraRules(st).banStart, '04-01');
  assert.equal(trimCheck({type: 'Taille haies', date: '2026-03-20', status: 'Terminé'}, st).blocked, false);
  assert.ok(validateRules({banStart: '3-16', banEnd: '08-15'}).error);
  assert.deepEqual(validateRules({banStart: '03-16', banEnd: '08-15', coef_haie: '20', coef_mare: '2'}).value.coefficients, {mare: 2});
});

test('guardWork lit le formulaire : dérogation décochée et date saisie (vague 8)', async () => {
  const {createHedgesUI} = await import('./hedges-ui.js');
  globalThis.document ??= {addEventListener() {}};
  const ui = createHedgesUI({store: {snapshot: () => ({})}, modal() {}, toast() {}});
  const form = checked => ({elements: {hedgeDerogation: {checked}}});
  // Dérogation décochée sur un travail qui l'avait : false explicite et blocage.
  const e1 = {type: 'Taille haies', date: '2027-04-10', status: 'Terminé', hedgeDerogation: true};
  assert.ok(ui.guardWork(e1, form(false)));
  assert.equal(e1.hedgeDerogation, false);
  // Le contrôle porte sur la date effective stockée (plannedDate||date) : un report non modifié reste contrôlé.
  assert.ok(ui.guardWork({type: 'Taille haies', date: '2027-03-01', plannedDate: '2027-04-10', status: 'À faire'}, form(false)));
  assert.ok(ui.guardWork({type: 'Taille haies', date: '2027-09-01', plannedDate: '2027-08-10', status: 'À faire'}, form(false)));
  assert.equal(ui.guardWork({type: 'Taille haies', date: '2027-04-10', plannedDate: '2027-09-10', status: 'À faire'}, form(false)), '');
});

test('save-work aligne plannedDate sur la date saisie avant le contrôle haies (vague 8)', async () => {
  const fs = await import('node:fs');
  // n° 147 : formulaire Travail sorti d'app.js dans work-form-ui.js.
  const app = fs.readFileSync(new URL('./work-form-ui.js', import.meta.url), 'utf8');
  const save = app.slice(app.indexOf('async function save('));
  const rule = "if (v.status !== 'Terminé' && item.plannedDate && v.date !== item.date) entity.plannedDate = v.date;";
  assert.ok(save.includes(rule));
  assert.ok(save.indexOf(rule) < save.indexOf('hedgesUI?.guardWork(entity, form)'));
  // Même règle, appliquée comme dans save-work (entity={...item,...v}).
  const align = (item, v) => { const entity = {...item, ...v}; new Function('v', 'item', 'entity', rule)(v, item, entity); return entity; };
  const {createHedgesUI} = await import('./hedges-ui.js');
  const ui = createHedgesUI({store: {snapshot: () => ({})}, modal() {}, toast() {}});
  const form = {elements: {hedgeDerogation: {checked: false}}};
  const postponed = {type: 'Taille haies', date: '2027-03-01', plannedDate: '2027-04-10', status: 'À faire'};
  // Date affichée inchangée : le report du 10/04 est gardé et bloque.
  const kept = align(postponed, {type: 'Taille haies', date: '2027-03-01', status: 'À faire'});
  assert.equal(kept.plannedDate, '2027-04-10');
  assert.ok(ui.guardWork(kept, form));
  // Redaté au 01/09 : la date stockée devient la date saisie, plus de blocage.
  const moved = align({...postponed, plannedDate: '2027-08-10'}, {type: 'Taille haies', date: '2027-09-01', status: 'À faire'});
  assert.equal(moved.plannedDate, '2027-09-01');
  assert.equal(ui.guardWork(moved, form), '');
  // Redaté en pleine période : bloqué sur la nouvelle date.
  assert.ok(ui.guardWork(align({...postponed, plannedDate: '2027-09-10'}, {type: 'Taille haies', date: '2027-05-01', status: 'À faire'}), form));
  // Travail terminé : la date d'échéance (finish-work) n'est pas touchée.
  assert.equal(align({...postponed, status: 'Terminé', date: '2027-09-05', plannedDate: '2027-09-01'}, {type: 'Taille haies', date: '2027-09-06', status: 'Terminé'}).plannedDate, '2027-09-01');
});

test('Dupliquer un travail ne reprend pas la date d\'échéance de la source (vague 8)', async () => {
  const fs = await import('node:fs');
  const app = fs.readFileSync(new URL('./work-form-ui.js', import.meta.url), 'utf8');
  const item = app.slice(app.indexOf('function workItem('), app.indexOf('function essentialFields('));
  assert.ok(item.includes("date: duplicate ? today : (source.date || today), plannedDate: duplicate ? '' : (source.plannedDate || ''),"));
  assert.ok(app.includes('workItem(source, {duplicate, chosenParcel, data, recentWorks, today: ctx.todayIso()})'));
  // Copie d'une taille terminée (échéance 05/09/2025 gardée par finish-work), date proposée gardée.
  const {createHedgesUI} = await import('./hedges-ui.js');
  const ui = createHedgesUI({store: {snapshot: () => ({})}, modal() {}, toast() {}});
  const form = {elements: {hedgeDerogation: {checked: false}}};
  const copy = (source, today) => ({...source, date: today, plannedDate: '', status: 'À faire'});
  const done = {type: 'Taille haies', date: '2025-09-06', plannedDate: '2025-09-05', status: 'Terminé'};
  assert.ok(ui.guardWork(copy(done, '2026-04-01'), form));
  // Source dont l'échéance tombe en période : une copie d'octobre n'est pas bloquée.
  assert.equal(ui.guardWork(copy({...done, plannedDate: '2026-05-01'}, '2026-10-01'), form), '');
});
