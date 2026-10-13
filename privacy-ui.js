// n° 123 : page Confidentialité en cartes « Ce qui reste sur votre téléphone » / « Ce qui part, vers qui, pourquoi ».
import {LOCAL_ITEMS, STATE_LABELS, isLocalOnly, ownLocalKeys, privacyServices, settingValue} from './privacy.js';
import {escapeHtml} from './utils.js';

const DATABASES = ['parcelles-app', 'parcelles-inbox'];
const FIREBASE_AUTH_DB = 'firebaseLocalStorageDb';
const WIPE_WORD = 'EFFACER';

export function createPrivacyUI({store, state, modal, closeModal, toast, getSync = () => null, nativeCapabilities = () => ({})}) {
  const $ = selector => document.querySelector(selector);

  function env() {
    const sync = getSync();
    return {firebaseConfigured: Boolean(globalThis.PARCELLES_FIREBASE_CONFIG?.projectId), satelliteEndpoint: globalThis.PARCELLES_SATELLITE_ENDPOINT || '', cloudConnected: Boolean(sync?.status?.connected)};
  }

  function serviceHtml(s, prefs) {
    const cloudOff = s.requires === 'cloud' && !prefs.syncEnabled;
    const toggle = s.setting ? `<label class="pv-switch"><input type="checkbox" data-privacy-setting="${s.setting}" ${settingValue(prefs, s) ? 'checked' : ''} ${cloudOff || (s.needsEndpoint && !settingValue(prefs, s)) ? 'disabled' : ''}><span>${s.settingLabel ? escapeHtml(s.settingLabel) : settingValue(prefs, s) ? 'Autorisé' : 'Refusé'}</span></label>` : s.manage ? `<button class="text-button" data-action="${s.manage}">Gérer</button>` : '';
    return `<article class="pv-service pv-${s.state}"><header><strong>${escapeHtml(s.name)}</strong><span class="pv-state">${STATE_LABELS[s.state] || s.state}</span></header>
      <dl><div><dt>Vers</dt><dd>${escapeHtml(s.recipient)}</dd></div><div><dt>Données</dt><dd>${escapeHtml(s.data)}</dd></div><div><dt>Quand</dt><dd>${escapeHtml(s.when)}</dd></div><div><dt>Pourquoi</dt><dd>${escapeHtml(s.why)}</dd></div>${s.note ? `<div><dt>Qui voit</dt><dd>${escapeHtml(s.note)}</dd></div>` : ''}</dl>
      ${toggle ? `<footer>${toggle}${cloudOff ? '<small>Activez d’abord la synchronisation.</small>' : s.needsEndpoint ? '<small>Renseignez l’adresse de votre service dans Paramètres › Assistant.</small>' : ''}</footer>` : ''}</article>`;
  }

  function open() {
    const prefs = state().preferences || {}, services = privacyServices(prefs, env()), c = nativeCapabilities() || {};
    const local = isLocalOnly(prefs);
    const body = `<div class="notice ${local ? 'success' : 'info'} pv-hero"><strong>${local ? '100 % local : vos données restent sur cet appareil.' : 'Vos données sont sur cet appareil et dans le cloud de votre exploitation.'}</strong><p>Aucun compte n’est nécessaire. Rien n’est stocké ailleurs sans votre accord ; seuls les services ci-dessous reçoivent des données, pour la raison indiquée.</p></div>
      <section class="pv-card"><h3>Ce qui reste sur votre téléphone</h3><ul>${LOCAL_ITEMS.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul><p class="form-note">Stockage du navigateur (IndexedDB) de cet appareil${c.native ? ` · application ${escapeHtml(c.platform || 'native')}` : ''}. ${prefs.biometricLock ? 'Verrouillage biométrique demandé.' : ''}</p></section>
      <section class="pv-card"><h3>Ce qui part, vers qui, pourquoi</h3><div class="pv-services">${services.map(s => serviceHtml(s, prefs)).join('')}</div></section>
      <section class="pv-card"><h3>Données sur des personnes</h3><ul><li><strong>Bailleurs (foncier)</strong> : noms et coordonnées, sur cet appareil et dans le cloud si la synchronisation est active. Informez vos bailleurs, limitez-vous au nécessaire et supprimez-les en fin de bail.</li><li><strong>Riverains et apiculteurs</strong> : nom, téléphone et e-mail seulement avec l’accord daté de la personne. Modifiez le point pour les effacer sur demande.</li><li><strong>Équipe</strong> : e-mail et rôle des membres, visibles par les membres de l’exploitation cloud.</li></ul></section>
      <section class="pv-card"><h3>Vos droits (RGPD)</h3><p>Vous êtes responsable des données que vous saisissez. Vous pouvez à tout moment les exporter dans un format ouvert, les corriger ou les effacer. L’effacement de cet appareil ne supprime pas l’exploitation cloud : quittez-la ou supprimez-la depuis Équipe & synchronisation.</p><div class="filter-row"><button class="button secondary" type="button" data-action="export-complete-backup">Exporter toutes mes données</button><button class="button danger" type="button" id="privacy-wipe">Tout effacer de cet appareil</button></div></section>`;
    modal('Confidentialité', 'Ce qui reste chez vous, ce qui part, vers qui et pourquoi.', body, `<button class="button secondary" data-action="open-settings">Tous les réglages</button><button class="button primary" data-action="close-modal">Fermer</button>`, 'large');
    document.querySelectorAll('[data-privacy-setting]').forEach(input => input.addEventListener('change', async () => {
      await store.setPreferences({[input.dataset.privacySetting]: input.checked});
      toast(input.checked ? 'Autorisation enregistrée.' : 'Envoi désactivé.');
      open();
    }));
    $('#privacy-wipe')?.addEventListener('click', openWipe);
  }

  function openWipe() {
    modal('Tout effacer de cet appareil', 'Action définitive sur cet appareil.', `<div class="notice danger"><strong>Toutes les données de Parcelles seront supprimées de cet appareil</strong> : parcelles, travaux, photos, sauvegardes automatiques, réglages et carte hors connexion. Les données déjà synchronisées restent dans l’exploitation cloud.</div><p>Exportez d’abord vos données si vous voulez les garder.</p><label class="field-label">Tapez ${WIPE_WORD} pour confirmer<input id="privacy-wipe-word" autocomplete="off" data-autofocus></label><p class="form-error hidden" id="privacy-wipe-error" role="alert"></p>`,
      `<button class="button secondary" type="button" data-action="export-complete-backup">Exporter d’abord</button><button class="button secondary" data-action="close-modal">Annuler</button><button class="button danger" type="button" id="privacy-wipe-confirm">Effacer</button>`, 'small');
    $('#privacy-wipe-confirm')?.addEventListener('click', async event => {
      const error = $('#privacy-wipe-error');
      if (String($('#privacy-wipe-word')?.value || '').trim().toUpperCase() !== WIPE_WORD) {error.textContent = `Tapez ${WIPE_WORD} pour confirmer.`; error.classList.remove('hidden'); return;}
      event.currentTarget.disabled = true;
      try {await wipeDevice(); location.reload();}
      catch (e) {error.textContent = e.message; error.classList.remove('hidden'); event.currentTarget.disabled = false;}
    });
  }

  async function wipeDevice() {
    // Ferme la session cloud : sinon le jeton Firebase survit et reconnecte l'ancien compte sans mot de passe.
    let signOutTimer;
    try {await Promise.race([getSync()?.signOut?.(), new Promise(resolve => {signOutTimer = setTimeout(resolve, 4000);})]);} catch {} finally {clearTimeout(signOutTimer);}
    try {store.storage?.db?.close?.(); if (store.storage) store.storage.db = null;} catch {}
    for (const area of [globalThis.localStorage, globalThis.sessionStorage]) {
      try {const keys = []; for (let i = 0; i < area.length; i++) keys.push(area.key(i)); ownLocalKeys(keys).forEach(k => area.removeItem(k));} catch {}
    }
    try {if ('caches' in globalThis) await Promise.all((await caches.keys()).map(k => caches.delete(k)));} catch {}
    for (const name of DATABASES) {
      await new Promise((resolve, reject) => {
        let req; try {req = indexedDB.deleteDatabase(name);} catch {resolve(); return;}
        req.onsuccess = () => resolve(); req.onerror = () => reject(new Error('Effacement impossible : réessayez.'));
        // Les autres onglets ferment leur connexion (onversionchange) ; sinon on abandonne après 6 s.
        const timer = setTimeout(() => reject(new Error('Fermez les autres onglets de Parcelles, puis réessayez.')), 6000);
        req.addEventListener('success', () => clearTimeout(timer)); req.addEventListener('error', () => clearTimeout(timer));
      });
    }
    // Persistance d'authentification Firebase : au mieux. Si le SDK garde la base ouverte, la suppression aboutit au rechargement.
    await new Promise(resolve => {
      let req; try {req = indexedDB.deleteDatabase(FIREBASE_AUTH_DB);} catch {resolve(); return;}
      const timer = setTimeout(resolve, 2000);
      req.onsuccess = req.onerror = req.onblocked = () => {clearTimeout(timer); resolve();};
    });
    try {const regs = await navigator.serviceWorker?.getRegistrations?.() || []; await Promise.all(regs.map(r => r.unregister()));} catch {}
  }

  // Badge « 100 % local » de l'en-tête.
  function renderBadge() {
    const local = isLocalOnly(state().preferences || {});
    document.querySelectorAll('.local-badge').forEach(badge => badge.classList.toggle('hidden', !local));
  }

  return {open, renderBadge};
}
