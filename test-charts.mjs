import test from 'node:test';
import assert from 'node:assert/strict';
import {donutChart, cropSegments, grazingTimeline, sparkline, homeKpiSeries, ndviChart} from './charts.js';

const color = c => ({'Blé tendre': '#d9a441', 'Maïs grain': '#e0873a'}[c] || '#6fb37a');

test('anneau : segments par culture, total au centre, aria-label textuel', () => {
  const seg = cropSegments([{culture: 'Blé tendre', surfaceHa: 10}, {culture: 'Maïs grain', surfaceHa: 5}, {culture: 'Blé tendre', surfaceHa: 2}, {culture: 'Colza', surfaceHa: 3, archived: true}], color);
  assert.deepEqual(seg.map(s => [s.label, s.value]), [['Blé tendre', 12], ['Maïs grain', 5]]);
  const svg = donutChart(seg);
  assert.equal((svg.match(/<path /g) || []).length, 2);
  assert.match(svg, /class="chart-total"[^>]*>17</);
  assert.match(svg, /aria-label="Assolement : 17 ha au total\. Blé tendre 12 ha \(71 %\), Maïs grain 5 ha \(29 %\)\."/);
  assert.match(svg, /pathLength="1"/);
  assert.match(svg, /stroke="#d9a441"/);
  assert.match(donutChart([{label: 'Prairie', value: 4, color: '#6fb37a'}]), /<path /);
  assert.match(donutChart([]), /aucune surface/);
});

test('frise de pâturage : barres datées, session en cours, mois', () => {
  const svg = grazingTimeline([{label: 'Pré', sessions: [{start: '2026-04-01', end: '2026-04-30', count: 24, type: 'Vaches'}, {start: '2026-09-20', end: '', count: 10, type: 'Brebis'}]}], {from: '2025-10-10', to: '2026-10-09', today: '2026-10-09'});
  assert.equal((svg.match(/class="chart-bar/g) || []).length, 2);
  assert.match(svg, /is-current/);
  assert.match(svg, /24 Vaches du 1 avr\. au 30 avr\. \(30 j\)/);
  assert.match(svg, /aujourd’hui/);
  assert.match(grazingTimeline([{label: 'Pré', sessions: []}], {from: '2025-10-10', to: '2026-10-09'}), /Aucun pâturage/);
});

test('sparkline : 7 valeurs, aria-label avec les jours', () => {
  const svg = sparkline([1, 2, 3, 2, 4, 0, 5], {label: 'En retard', days: ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']});
  assert.match(svg, /aria-label="En retard, 7 derniers jours : 3 oct\. 1, .*9 oct\. 5"/);
  assert.equal(sparkline([3]), '');
  assert.ok(!/NaN/.test(sparkline([2, 2, 2, 2, 2, 2, 2])));
});

test('séries des KPI : prévus, retards reconstitués, animaux au pré', () => {
  const s = homeKpiSeries({
    interventions: [{plannedDate: '2026-10-09', date: '2026-10-01', status: 'À faire'}, {plannedDate: '2026-10-04', date: '2026-10-07', status: 'Terminé'}],
    tasks: [{dueDate: '2026-10-05', status: 'À faire'}],
    grazingSessions: [{startDate: '2026-10-06', animalsCount: 20}, {startDate: '2026-09-01', endDate: '2026-10-05', animalsCount: 5}],
  }, '2026-10-09');
  assert.equal(s.days[0], '2026-10-03');
  assert.deepEqual(s.today, [0, 1, 1, 0, 0, 0, 1]);
  // Travail du 4 terminé le 7 : en retard les 5 et 6 (plus le jour où il est fait) ; tâche du 5 en retard dès le 6.
  assert.deepEqual(s.overdue, [0, 0, 1, 2, 1, 1, 1]);
  assert.deepEqual(s.grazing, [5, 5, 0, 20, 20, 20, 20]);
});

test('NDVI : images exploitables seulement, résumé textuel', () => {
  const svg = ndviChart([{date: '2026-04-01', ndvi: 0.3, usable: true}, {date: '2026-05-01', ndvi: 0.8, usable: true}, {date: '2026-05-10', ndvi: 0.1, usable: false}, {date: '2026-06-01', ndvi: 0.6, usable: true}]);
  assert.equal((svg.match(/class="chart-dot"/g) || []).length, 3);
  assert.match(svg, /3 images exploitables : 0\.30 au départ, maximum 0\.80 le 1 mai, 0\.60 à la dernière image/);
  assert.equal(ndviChart([{date: '2026-04-01', ndvi: 0.3, usable: true}]), '');
});
