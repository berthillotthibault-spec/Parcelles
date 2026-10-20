// n° 18 : vibration, grande coche verte plein écran (600 ms) et bip optionnel après un enregistrement terrain.
// Réutilise haptic() de motion.js (plugin natif sinon navigator.vibrate ; iOS Safari l'ignore sans effet).
import {haptic} from './motion.js';
import {overlayHost} from './utils.js';
import {SAVED_OVERLAY_MS, beepNotes, feedbackPlan} from './save-feedback.js';

const CHECK = '<svg viewBox="0 0 24 24" width="96" height="96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7"/></svg>';

export function createSaveFeedbackUI({preferences = () => ({}), native = () => null, fieldMode = () => false}) {
  let audio = null, overlayTimer = null;
  const reduced = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

  function beep(kind) {
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext; if (!Ctx) return;
      audio ||= new Ctx();
      if (audio.state === 'suspended') audio.resume?.();
      let t = audio.currentTime;
      for (const note of beepNotes(kind)) {
        const osc = audio.createOscillator(), gain = audio.createGain();
        osc.frequency.value = note.freq; osc.type = 'sine';
        gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, t + note.ms / 1000);
        osc.connect(gain).connect(audio.destination); osc.start(t); osc.stop(t + note.ms / 1000 + 0.02);
        t += note.ms / 1000 + 0.04;
      }
    } catch {}
  }

  function showCheck(animate) {
    let layer = document.getElementById('saved-check');
    if (!layer) {
      layer = document.createElement('div'); layer.id = 'saved-check'; layer.className = 'saved-check';
      layer.setAttribute('role', 'status'); layer.setAttribute('aria-live', 'polite');
      layer.innerHTML = `<span class="saved-check-disc">${CHECK}</span><span class="sr-only">Enregistré</span>`;
    }
    // n° 154 : au-dessus de la fenêtre <dialog> ouverte (couche supérieure), sinon dans la page.
    const host = overlayHost(); if (host && layer.parentNode !== host) host.append(layer);
    layer.classList.toggle('is-static', !animate);
    layer.classList.remove('is-visible'); void layer.offsetWidth; layer.classList.add('is-visible');
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => layer.classList.remove('is-visible'), SAVED_OVERLAY_MS);
  }

  // Appelé par toast() : décide seul s'il faut réagir (contexte terrain, message d'enregistrement).
  function onToast(message, type) {
    const prefs = preferences() || {};
    const plan = feedbackPlan({type, message, fieldMode: fieldMode(), pleinChamp: prefs.pleinChamp === true, reducedMotion: reduced(), haptics: prefs.nativeHaptics !== false, beep: prefs.saveBeep === true});
    if (plan.haptic) haptic(plan.haptic, {native: native()});
    if (plan.overlay) showCheck(plan.animate);
    if (plan.beep) beep(plan.beep);
    return plan;
  }

  return {onToast, showCheck, beep};
}
