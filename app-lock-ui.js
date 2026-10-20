// Verrouillage de Parcelles (n° 140) : réglages, suivi d'inactivité et écran de déverrouillage.
import {html, raw} from './safe-html.js';
import {suspendModalDialog} from './utils.js';
import {LOCK_STORAGE_KEY, LOCK_ACTIVITY_KEY, LOCK_MINUTES, normalizeLockConfig, validPin, createPinRecord, verifyPin, shouldLock,
  registerFailure, resetFailures, waitSeconds, platformAuthAvailable, registerPlatformCredential, unlockWithPlatform} from './app-lock.js';

export function createAppLockUI({modal, closeModal, toast, storage = globalThis.localStorage, doc = globalThis.document, win = globalThis} = {}) {
  let locked = false, timer = null, lastWrite = 0, inertNodes = [];
  const read = () => { try { return normalizeLockConfig(JSON.parse(storage.getItem(LOCK_STORAGE_KEY) || 'null')); } catch { return normalizeLockConfig(null); } };
  const write = config => { try { storage.setItem(LOCK_STORAGE_KEY, JSON.stringify(config)); } catch {} };
  const lastActive = () => { try { return Number(storage.getItem(LOCK_ACTIVITY_KEY)) || 0; } catch { return 0; } };
  const touch = (force = false) => { if (locked) return; const now = Date.now(); if (!force && now - lastWrite < 15000) return; lastWrite = now; try { storage.setItem(LOCK_ACTIVITY_KEY, String(now)); } catch {} };
  const check = () => { if (!locked && shouldLock(read(), lastActive())) lock(); };

  function install() {
    const config = read();
    if (config.enabled && shouldLock(config, lastActive())) lock(); else touch(true);
    for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) doc.addEventListener(type, () => touch(), {passive: true, capture: true});
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') check(); else touch(true); });
    clearInterval(timer); timer = setInterval(check, 30000);
  }

  function setInert(on) {
    // n° 154 : la fenêtre <dialog> modale passerait au-dessus de l’écran de verrouillage et le rendrait inerte.
    if (on) suspendModalDialog(true, doc);
    if (on) { inertNodes = [...doc.body.children].filter(n => n.id !== 'app-lock' && !n.inert); inertNodes.forEach(n => { n.inert = true; }); }
    else { inertNodes.forEach(n => { n.inert = false; }); inertNodes = []; suspendModalDialog(false, doc); }
  }

  function lock() {
    const config = read(); if (!config.enabled || locked) return;
    locked = true;
    const box = doc.createElement('div'); box.id = 'app-lock'; box.className = 'app-lock'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'app-lock-title');
    box.innerHTML = html`<form class="app-lock-card" id="app-lock-form" autocomplete="off">
      <h2 id="app-lock-title">Parcelles est verrouillé</h2>
      <p class="form-note">Saisissez votre code pour continuer.</p>
      ${config.credentialId ? html`<button type="button" class="button primary" id="app-lock-bio">Face ID / empreinte</button>` : ''}
      <label class="field-label">Code<input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" minlength="6" maxlength="12" autocomplete="off" required></label>
      <p class="form-error" id="app-lock-error" role="alert" hidden></p>
      <button type="submit" class="button ${raw(config.credentialId ? 'secondary' : 'primary')}">Déverrouiller</button>
    </form>`;
    doc.body.append(box); setInert(true);
    const error = msg => { const e = box.querySelector('#app-lock-error'); e.textContent = msg; e.hidden = !msg; };
    box.querySelector('#app-lock-form').addEventListener('submit', async event => {
      event.preventDefault();
      let current = read(); const wait = waitSeconds(current);
      if (wait) return error(`Trop d’essais : réessayez dans ${wait} s.`);
      const input = box.querySelector('[name=pin]');
      if (await verifyPin(current, input.value)) { write(resetFailures(current)); unlock(); return; }
      current = registerFailure(current); write(current); input.value = '';
      const next = waitSeconds(current);
      error(next ? `Code incorrect. Réessayez dans ${next} s.` : 'Code incorrect.');
    });
    box.querySelector('#app-lock-bio')?.addEventListener('click', async () => {
      if (await unlockWithPlatform(read())) { write(resetFailures(read())); unlock(); }
      else { error('Face ID / empreinte indisponible ou refusé : utilisez votre code.'); box.querySelector('[name=pin]')?.focus(); }
    });
    box.querySelector('[name=pin]')?.focus();
  }

  function unlock() { locked = false; doc.getElementById('app-lock')?.remove(); setInert(false); touch(true); }

  async function openSettings() {
    const config = read(), bioAvailable = await platformAuthAvailable();
    modal('Verrouillage de Parcelles', 'Demande un code après une période sans utilisation.', html`
      <div class="notice info">Protection d’accès à l’écran de cet appareil, utile si le téléphone ou l’ordinateur est prêté ou oublié. Ce n’est pas un chiffrement : vos données ne sont pas chiffrées sur le disque. Pour un fichier protégé, utilisez la sauvegarde chiffrée.</div>
      <form id="app-lock-settings" class="form-grid">
        <label class="span-2 check-row"><input type="checkbox" name="enabled" ${raw(config.enabled ? 'checked' : '')}> Verrouiller Parcelles</label>
        <label class="span-2">Après<select name="minutes">${LOCK_MINUTES.map(m => html`<option value="${m}" ${raw(m === config.minutes ? 'selected' : '')}>${m} minute${m > 1 ? 's' : ''} d’inactivité</option>`)}</select></label>
        <label>${config.pinHash ? 'Nouveau code (facultatif)' : 'Code (6 à 12 chiffres)'}<input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" minlength="6" maxlength="12" autocomplete="new-password"></label>
        <label>Confirmer le code<input name="confirm" type="password" inputmode="numeric" pattern="[0-9]*" minlength="6" maxlength="12" autocomplete="new-password"></label>
        ${bioAvailable ? html`<label class="span-2 check-row"><input type="checkbox" name="bio" ${raw(config.credentialId ? 'checked' : '')}> Déverrouiller aussi avec Face ID / Touch ID / empreinte</label>` : html`<p class="span-2 form-note">Face ID / empreinte n’est pas disponible dans ce navigateur : le code suffit.</p>`}
        <p class="span-2 form-note">Le code reste obligatoire : il sert de secours si Face ID ou l’empreinte échoue. Notez-le : sans lui, il faudrait effacer les données du site dans le navigateur (gardez une sauvegarde à jour).</p>
        <p class="span-2 form-error" id="app-lock-settings-error" role="alert" hidden></p>
      </form>`, html`<button class="button secondary" data-action="close-modal">Annuler</button>${config.enabled ? html`<button class="button secondary" id="app-lock-now">Verrouiller maintenant</button>` : ''}<button class="button primary" id="app-lock-save">Enregistrer</button>`, 'small');
    const form = doc.getElementById('app-lock-settings'), fail = msg => { const e = doc.getElementById('app-lock-settings-error'); e.textContent = msg; e.hidden = !msg; };
    doc.getElementById('app-lock-now')?.addEventListener('click', () => { closeModal(); lock(); });
    doc.getElementById('app-lock-save').addEventListener('click', async () => {
      const values = Object.fromEntries(new FormData(form)); let next = {...read(), enabled: Boolean(values.enabled), minutes: Number(values.minutes)};
      if (values.pin || values.confirm || (next.enabled && !next.pinHash)) {
        if (!validPin(values.pin)) return fail('Le code doit comporter 6 à 12 chiffres.');
        if (values.pin !== values.confirm) return fail('Les deux codes sont différents.');
        next = {...next, ...await createPinRecord(values.pin), failedAttempts: 0, blockedUntil: 0};
      }
      if (!values.bio) next.credentialId = '';
      else if (!next.credentialId) {
        try { next.credentialId = await registerPlatformCredential(); }
        catch { next.credentialId = ''; toast('Face ID / empreinte non activé : le code seul sera demandé.'); }
      }
      write(next); touch(true); closeModal();
      toast(read().enabled ? `Verrouillage activé après ${next.minutes} min d’inactivité.` : 'Verrouillage désactivé.');
    });
  }

  return {install, lock, unlock, openSettings, get locked() { return locked; }};
}
