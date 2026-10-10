import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {HELP, FAQ, helpKeyFor, tipToShow, markTipSeen} from './help.js';

const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');

test('chaque fiche a un titre, 3 puces et un lien vers une action existante', () => {
  for (const [key, entry] of Object.entries(HELP)) {
    assert.ok(entry.title, key); assert.equal(entry.points.length, 3, key);
    if (entry.link) assert.ok(app.includes(`'${entry.link.action}'`), `${key} → ${entry.link.action}`);
  }
});

test('les modules avancés sont couverts par le titre de leur fenêtre', () => {
  const cases = {'Registre phytosanitaire': 'phyto-register', 'Catalogue phyto hors connexion': 'phyto-catalog', 'Indice de fréquence de traitement': 'ift', 'Azote : PPF et cahier': 'nitrogen', 'Assistant PAC': 'pac', 'Couverts et intercultures': 'covers', 'Recherche': 'search', 'Animaux au pré': 'grazing', 'Prêt pour un contrôle ?': 'compliance', 'Consignes & heures': 'team-work', 'Matériel': 'equipment'};
  for (const [title, key] of Object.entries(cases)) assert.equal(helpKeyFor(title), key, title);
  assert.equal(helpKeyFor('Confirmer l’action'), '');
  assert.equal(helpKeyFor(''), '');
  for (const sub of ['list', 'week', 'calendar', 'tasks', 'chantiers']) assert.ok(HELP[`work-${sub}`], sub);
});

test('aucun jargon de développeur dans l’aide', () => {
  const text = JSON.stringify({HELP: Object.values(HELP).map(({match, ...rest}) => rest), FAQ});
  for (const word of ['Capacitor', 'localement', 'IndexedDB', 'Firestore', 'Firebase', 'API', 'JSON', 'cache']) assert.ok(!text.includes(word), word);
  assert.deepEqual(FAQ.map(item => item.q), ['Je change de téléphone', 'Pas de réseau au champ', 'Qui voit mes données ?']);
  const ui = fs.readFileSync(new URL('./help-ui.js', import.meta.url), 'utf8');
  assert.ok(!/Capacitor|évaluées localement/.test(ui) && !/Capacitor|évaluées localement/.test(app.slice(app.indexOf('function openHelp'), app.indexOf('function openHelp') + 300)));
});

test('une astuce n’est montrée qu’une fois par fonction', () => {
  assert.ok(tipToShow('pac', []));
  const seen = markTipSeen(undefined, 'pac');
  assert.deepEqual(seen, ['pac']);
  assert.equal(tipToShow('pac', seen), '');
  assert.deepEqual(markTipSeen(seen, 'pac'), ['pac']);
  assert.deepEqual(markTipSeen(['inconnue', 'pac'], 'ift'), ['pac', 'ift']);
  assert.equal(tipToShow('work-week', []), '');
});
