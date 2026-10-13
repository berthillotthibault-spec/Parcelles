import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {feedbackPlan, isSaveMessage, beepNotes, SAVED_OVERLAY_MS} from './save-feedback.js';
import {haptic, HAPTIC_PATTERNS} from './motion.js';
import {normalizePersonalization} from './personalization.js';

test('messages d’enregistrement reconnus', () => {
  assert.equal(isSaveMessage('Observation enregistrée.'), true);
  assert.equal(isSaveMessage('Mise au pré enregistrée : 12 animaux'), true);
  assert.equal(isSaveMessage('Travail terminé.'), true);
  assert.equal(isSaveMessage('Mode plein soleil activé.'), false);
});

test('mode terrain : vibration, grande coche ; bip seulement si demandé', () => {
  const plan = feedbackPlan({type: 'success', message: 'Observation enregistrée.', fieldMode: true});
  assert.deepEqual([plan.haptic, plan.overlay, plan.beep], ['saved', true, null]);
  assert.equal(feedbackPlan({type: 'success', message: 'Observation enregistrée.', fieldMode: true, beep: true}).beep, 'saved');
  assert.equal(feedbackPlan({type: 'success', message: 'Observation enregistrée.', fieldMode: true, reducedMotion: true}).animate, false);
});

test('hors terrain : vibration sans coche ; plein champ : bip possible sans coche', () => {
  const plan = feedbackPlan({type: 'success', message: 'Travail enregistré.'});
  assert.deepEqual([plan.haptic, plan.overlay, plan.beep], ['saved', false, null]);
  const plein = feedbackPlan({type: 'success', message: 'Travail enregistré.', pleinChamp: true, beep: true});
  assert.deepEqual([plein.overlay, plein.beep], [false, 'saved']);
  assert.equal(feedbackPlan({type: 'success', message: 'Travail enregistré.', haptics: false}).haptic, null);
  assert.equal(feedbackPlan({type: 'success', message: 'Copié.'}).haptic, null);
});

test('erreur : vibration longue en contexte terrain uniquement', () => {
  assert.equal(feedbackPlan({type: 'error', message: 'Échec', fieldMode: true}).haptic, 'error');
  assert.equal(feedbackPlan({type: 'error', message: 'Échec'}).haptic, null);
  assert.equal(beepNotes('error').length, 2);
  assert.equal(SAVED_OVERLAY_MS, 600);
});

test('motifs de vibration : 30 ms enregistré, 80-60-80 erreur, natif fort pour l’erreur', async () => {
  assert.equal(HAPTIC_PATTERNS.saved, 30);
  assert.deepEqual(HAPTIC_PATTERNS.error, [80, 60, 80]);
  const calls = [], nav = {vibrate: p => {calls.push(p); return true;}};
  assert.equal(await haptic('saved', {nav}), true); assert.equal(calls.at(-1), 30);
  const native = {capabilities: {haptics: true}, haptic: async style => {calls.push(style); return true;}};
  await haptic('error', {native, nav}); assert.equal(calls.at(-1), 'heavy');
});

test('réglage du bip : désactivé par défaut, exposé dans Personnaliser, branché sur toast()', () => {
  assert.equal(normalizePersonalization({}).saveBeep, false);
  assert.equal(normalizePersonalization({saveBeep: true}).saveBeep, true);
  assert.match(readFileSync(new URL('./personalization-ui.js', import.meta.url), 'utf8'), /name="saveBeep"/);
  assert.match(readFileSync(new URL('./app.js', import.meta.url), 'utf8'), /saveFeedback\(\)\.onToast\(message,type\)/);
});
