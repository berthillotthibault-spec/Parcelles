// n° 119 : carte « Bien démarrer » en tête d'Aujourd'hui.
import {gettingStartedSteps, gettingStartedProgress, shouldShowGettingStarted} from './getting-started.js';
import {detectInstallState} from './runtime.js';
import {escapeHtml as e} from './utils.js';

export function createGettingStartedUI({store, toast, doc = globalThis.document}) {
  const installed = () => { try { return detectInstallState() === 'standalone'; } catch { return false; } };
  function render(data) {
    const anchor = doc.querySelector('#view-today .today-welcome');
    if (!anchor) return;
    let root = doc.getElementById('getting-started');
    const steps = gettingStartedSteps(data, {installed: installed()});
    if (!shouldShowGettingStarted(data, steps) || store.tabReadOnly) { root?.remove(); return; }
    if (!root) { root = doc.createElement('section'); root.id = 'getting-started'; root.className = 'getting-started panel'; root.setAttribute('aria-labelledby', 'getting-started-title'); }
    // La mise en page large (wide-layout-ui.js) insère ses colonnes après l'en-tête : garder la carte en tête.
    if (root.previousElementSibling !== anchor) anchor.after(root);
    const p = gettingStartedProgress(steps);
    root.innerHTML = `<div class="gs-head"><div><h2 id="getting-started-title">Bien démarrer</h2><p>${p.done} sur ${p.total} étapes faites</p></div><button type="button" class="icon-button gs-hide" data-action="getting-started-hide" aria-label="Masquer la liste Bien démarrer">×</button></div>
      <div class="gs-bar" role="progressbar" aria-label="Progression" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}"><span style="width:${p.percent}%"></span></div>
      <ol class="gs-steps">${steps.map(step => `<li class="${step.done ? 'is-done' : ''}">${step.done
        ? `<span class="gs-row"><span class="gs-check" aria-hidden="true">✓</span><span><strong>${e(step.label)}</strong><small>Fait</small></span></span>`
        : `<button type="button" class="gs-row" data-action="${e(step.action)}" data-gs-step="${e(step.id)}"><span class="gs-check" aria-hidden="true"></span><span><strong>${e(step.label)}</strong><small>${e(step.detail)}</small></span><b aria-hidden="true">›</b></button>`}</li>`).join('')}</ol>`;
  }
  async function hide() {
    await store.setPreferences({gettingStartedHidden: true});
    toast('Liste « Bien démarrer » masquée.', 'success', {label: 'Annuler', run: () => store.setPreferences({gettingStartedHidden: false})});
  }
  return {render, hide};
}
