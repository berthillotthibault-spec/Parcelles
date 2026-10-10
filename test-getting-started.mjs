import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gettingStartedSteps, gettingStartedProgress, shouldShowGettingStarted} from './getting-started.js';
import {emptyState} from './state.js';

test('profil vierge : 6 étapes, aucune faite, carte visible', () => {
  const data = emptyState(), steps = gettingStartedSteps(data);
  assert.deepEqual(steps.map(s => s.id), ['parcels', 'work', 'grazing', 'install', 'backup', 'team']);
  assert.equal(gettingStartedProgress(steps).done, 0);
  assert.equal(shouldShowGettingStarted(data), true);
  for (const s of steps) assert.match(s.action, /^[a-z-]+$/);
});

test('les étapes sont vérifiées d’après les données, sans compter la corbeille', () => {
  const data = emptyState();
  data.parcelles = [{id: 'p1'}]; data.interventions = [{id: 'w1', deletedAt: 1}];
  data.grazingSessions = [{id: 'g1'}]; data.metadata.lastExternalBackupAt = Date.now();
  data.preferences.teamInvitedAt = Date.now();
  const steps = gettingStartedSteps(data, {installed: false}), done = Object.fromEntries(steps.map(s => [s.id, s.done]));
  assert.deepEqual(done, {parcels: true, work: false, grazing: true, install: false, backup: true, team: true});
  assert.deepEqual(gettingStartedProgress(steps), {done: 4, total: 6, percent: 67, complete: false});
});

test('l’étape élevage (et équipe) ne s’affiche que si le module est actif', () => {
  const data = emptyState(); data.preferences.activeModules = ['crops'];
  assert.deepEqual(gettingStartedSteps(data).map(s => s.id), ['parcels', 'work', 'install', 'backup']);
  data.preferences.activeModules = ['livestock'];
  assert.ok(gettingStartedSteps(data).some(s => s.id === 'grazing'));
});

test('la carte disparaît une fois terminée ou masquée', () => {
  const data = emptyState(); data.preferences.activeModules = ['crops'];
  data.parcelles = [{id: 'p'}]; data.interventions = [{id: 'w'}]; data.metadata.lastExternalBackupAt = 1;
  assert.equal(shouldShowGettingStarted(data, gettingStartedSteps(data, {installed: true})), false);
  assert.equal(shouldShowGettingStarted(data, gettingStartedSteps(data, {installed: false})), true);
  data.preferences.gettingStartedHidden = true;
  assert.equal(shouldShowGettingStarted(data), false);
  assert.equal(gettingStartedProgress([]).complete, true);
});
