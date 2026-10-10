// n° 128 : feuille « Nouveautés » après une mise à jour, et mise à jour sans perte de saisie.
import {entriesSince, whatsNewDecision, resumeTarget, versionFromBuild} from './whats-new.js';
import {DRAFT_PREFIX, readDraft} from './form-drafts.js';
import {escapeHtml as e} from './utils.js';

const RESUME_KEY = 'parcelles:update-resume';

export function createWhatsNewUI({store, modal, closeModal, toast, buildId, openers = {}, doc = globalThis.document, win = globalThis.window, fetchImpl = (...args) => globalThis.fetch(...args)}) {
  let pending = null, waitingForm = null;
  const modalRoot = () => doc.getElementById('modal-root');
  const writable = () => !store.tabReadOnly && !store.schemaLock;

  // Formulaire modifié : toute saisie (champ ou pastille) dans la fenêtre ouverte.
  const mark = event => { const form = event.target?.closest?.('#modal-root form'); if (form && (event.type !== 'click' || event.target.closest('.choice-chip'))) form.dataset.edited = '1'; };
  for (const type of ['input', 'change', 'click']) doc.addEventListener(type, mark, true);
  const dirtyForm = () => modalRoot()?.classList.contains('has-modal') ? modalRoot().querySelector('form[data-edited="1"]') : null;

  async function catalog() {
    try { const response = await fetchImpl('./whatsnew.json', {cache: 'no-cache'}); return response.ok ? await response.json() : null; } catch { return null; }
  }
  function sheet(entries, {title = 'Nouveautés'} = {}) {
    const body = entries.map(entry => `<section class="whatsnew-version"><h3>${e(entry.title || 'Version ' + entry.version)} <small>${e(entry.version)}</small></h3><ul>${entry.items.map(item => `<li>${e(item)}</li>`).join('')}</ul></section>`).join('');
    modal(title, `Parcelles ${e(versionFromBuild(buildId) || '')} est installé. Vos données sont conservées.`, `<div class="whatsnew">${body}</div>`, '<button class="button primary" data-action="close-modal">C’est noté</button>', 'small');
  }
  // Après rechargement : brouillon à rouvrir, puis « Nouveautés » si le build a changé.
  async function boot() {
    let resumed = false;
    try {
      const key = win.sessionStorage?.getItem(RESUME_KEY);
      if (key) { win.sessionStorage.removeItem(RESUME_KEY); resumed = resume(key); }
    } catch {}
    const prefs = store.snapshot().preferences || {}, decision = whatsNewDecision(prefs, buildId);
    if (decision === 'none' || !writable()) return;
    if (decision === 'first') { await store.setPreferences({lastSeenBuild: buildId}); return; }
    const entries = entriesSince(await catalog(), prefs.lastSeenBuild, buildId, {max: prefs.lastSeenBuild ? 2 : 1});
    if (!entries.length) { await store.setPreferences({lastSeenBuild: buildId}); return; }
    if (resumed || modalRoot()?.classList.contains('has-modal')) {
      toast('Parcelles a été mis à jour.', 'success', {label: 'Nouveautés', run: () => open()});
      return;
    }
    await store.setPreferences({lastSeenBuild: buildId});
    sheet(entries);
  }
  async function open() {
    const prefs = store.snapshot().preferences || {};
    let entries = entriesSince(await catalog(), prefs.lastSeenBuild && prefs.lastSeenBuild !== buildId ? prefs.lastSeenBuild : '', buildId);
    if (!entries.length) { toast('Aucune nouveauté à afficher.'); return; }
    if (writable() && prefs.lastSeenBuild !== buildId) await store.setPreferences({lastSeenBuild: buildId});
    sheet(entries);
  }
  function resume(key) {
    const target = resumeTarget([key]);
    if (!target || !readDraft(target.key) || typeof openers[target.type] !== 'function') return false;
    openers[target.type](target.id);
    doc.querySelector('#modal-root [data-draft="resume"]')?.click();
    toast('Votre saisie a été reprise après la mise à jour.');
    return true;
  }
  function newestDraftKey(since) {
    let best = null;
    try {
      const storage = win.localStorage;
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i); if (!key?.startsWith(DRAFT_PREFIX)) continue;
        const draft = readDraft(key); if (draft && draft.savedAt >= since && (!best || draft.savedAt > best.savedAt)) best = {key, savedAt: draft.savedAt};
      }
    } catch {}
    return best?.key || null;
  }
  // Remplace update.activate : demande quoi faire si une saisie est en cours.
  function offer(update) {
    pending = update;
    toast('Une nouvelle version de Parcelles est prête.', 'success', {label: 'Mettre à jour', run: () => activate()}, {persist: true});
  }
  function activate() {
    if (!pending) return;
    const form = dirtyForm();
    if (!form) { pending.activate(); return; }
    form.querySelector('.update-guard')?.remove();
    const banner = doc.createElement('div');
    banner.className = 'update-guard'; banner.setAttribute('role', 'alert');
    banner.innerHTML = '<p><strong>Une saisie est en cours.</strong> La mise à jour recharge l’application.</p><div class="update-guard-actions"><button type="button" class="button secondary" data-update-guard="later">Terminer d’abord</button><button type="button" class="button primary" data-update-guard="draft">Garder le brouillon et mettre à jour</button></div>';
    form.prepend(banner);
    banner.querySelector('[data-update-guard="draft"]')?.focus();
    banner.addEventListener('click', event => {
      const choice = event.target.closest('[data-update-guard]')?.dataset.updateGuard;
      if (choice === 'later') { banner.remove(); waitForClose(form); }
      if (choice === 'draft') saveAndActivate();
    });
  }
  function waitForClose(form) {
    waitingForm = form;
    const check = () => { if (waitingForm && !waitingForm.isConnected) { waitingForm = null; observer.disconnect(); offer(pending); } };
    const observer = new MutationObserver(check);
    observer.observe(modalRoot(), {childList: true, subtree: false});
  }
  function saveAndActivate() {
    const since = Date.now() - 1000;
    // persistFormDraft enregistre le brouillon sur « pagehide ».
    win.dispatchEvent(new Event('pagehide'));
    const key = newestDraftKey(since);
    try { if (key) win.sessionStorage.setItem(RESUME_KEY, key); } catch {}
    toast(key ? 'Brouillon enregistré. Mise à jour…' : 'Mise à jour…');
    pending.activate();
  }
  return {boot, open, offer, activate, dirtyForm};
}
