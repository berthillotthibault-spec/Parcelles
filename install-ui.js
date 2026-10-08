// n° 117 : feuille « Installer Parcelles », proposée au bon moment (2e jour d'ouverture ou premier travail saisi).
import {detectInstallState, onInstallStateChange, promptInstall, requestPersistentStorage, storageHealth} from './runtime.js';
import {installPromptDue, shownPatch, visitPatch} from './install-prompt.js';
import {localDay} from './home-priorities.js';

const SHARE_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ADD_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8.5v7M8.5 12h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

export function createInstallUI({store, modal, closeModal, toast, isBusy = () => false}) {
  let timer = null, opening = false, workSaved = false;
  const prefs = () => store.snapshot().preferences || {};
  const writable = () => !store.tabReadOnly && !store.schemaLock;
  // « Premier travail saisi » : un travail créé pendant cette session (pas les travaux déjà présents).
  const hasWork = () => workSaved;

  async function savePrompt(value) {
    if (!writable()) return false;
    try {await store.setPreferences({installPrompt: value});return true;} catch {return false;}
  }

  function canShowNow() {
    return document.documentElement.dataset.appReady === '1' && !document.getElementById('app-boot')
      && !document.getElementById('modal-root')?.classList.contains('has-modal') && !isBusy() && !document.hidden && writable();
  }

  async function check() {
    timer = null;
    if (opening || !installPromptDue({installState: detectInstallState(), preferences: prefs(), hasWork: hasWork()})) return;
    if (!canShowNow()) {schedule(4000);return;}
    await open({automatic: true});
  }
  function schedule(delay = 1500) {clearTimeout(timer);timer = setTimeout(check, delay);}

  async function boot() {
    const state = detectInstallState();
    if (state === 'standalone') return;
    const patch = visitPatch(prefs(), localDay());
    if (patch) await savePrompt(patch);
    store.subscribe?.((_, event) => {if (event?.entity === 'interventions' && event?.action === 'create') {workSaved = true;schedule();}});
    onInstallStateChange(() => schedule());
    schedule(2500);
  }

  function iosSteps() {
    return `<ol class="install-steps" aria-label="Deux étapes dans Safari">
      <li class="install-step"><span class="install-step-icon">${SHARE_ICON}</span><span><strong>1. Touchez Partager</strong><small>Le carré avec une flèche vers le haut, en bas de Safari (en haut sur iPad).</small></span></li>
      <li class="install-step"><span class="install-step-icon">${ADD_ICON}</span><span><strong>2. Choisissez « Sur l’écran d’accueil »</strong><small>Faites défiler la liste si besoin, puis touchez « Ajouter ».</small></span></li>
    </ol>`;
  }

  async function open({automatic = false} = {}) {
    const state = detectInstallState();
    if (opening) return;
    if (state === 'standalone') {toast('Parcelles est déjà installé sur cet appareil.');return;}
    opening = true;
    try {
      if (automatic) await savePrompt(shownPatch(prefs()));
      const persisted = Boolean((await storageHealth().catch(() => null))?.persisted);
      const ios = state === 'ios-safari', native = state === 'installable';
      const benefits = `<ul class="install-benefits">
        <li><strong>Marche sans réseau au champ</strong><small>Carte, parcelles et saisies restent disponibles hors connexion.</small></li>
        <li><strong>Vos données sont protégées</strong><small>${ios ? 'Installée, l’application garde ses données : Safari peut effacer celles d’un site non installé après 7 jours sans visite.' : 'Installée, l’application demande au navigateur de ne pas effacer ses données pour libérer de la place.'}</small></li>
        <li><strong>Une icône sur l’écran d’accueil</strong><small>Parcelles s’ouvre en plein écran, comme une application.</small></li>
      </ul>`;
      const storageNote = `<p class="install-storage form-note" role="status">${persisted ? 'Stockage protégé : activé sur cet appareil.' : 'Stockage protégé : pas encore accordé par le navigateur.'}</p>`;
      const other = !ios && !native ? '<p class="form-note">Dans le menu du navigateur, cherchez « Installer l’application » ou « Ajouter à l’écran d’accueil ».</p>' : '';
      const body = `<div class="install-sheet" id="install-sheet">${benefits}${ios ? iosSteps() : ''}${other}${storageNote}</div>`;
      const footer = `<button class="button secondary" type="button" data-action="close-modal">Plus tard</button>${native ? '<button class="button primary" type="button" id="install-native">Installer</button>' : `<button class="button primary" type="button" id="install-understood">J’ai compris</button>`}`;
      modal('Installer Parcelles', 'Gardez l’application à portée de main, même sans réseau.', body, footer, 'small');
      document.getElementById('install-native')?.addEventListener('click', async event => {
        event.currentTarget.disabled = true;
        const outcome = await promptInstall();
        closeModal();
        if (outcome === 'accepted') {
          const granted = await requestPersistentStorage();
          toast(granted ? 'Parcelles est installé et vos données sont protégées.' : 'Parcelles est installé sur l’écran d’accueil.');
        } else if (outcome === 'unavailable') toast('Installation indisponible ici : utilisez le menu du navigateur.', 'error');
      });
      document.getElementById('install-understood')?.addEventListener('click', async () => {
        closeModal();
        await requestPersistentStorage();
      });
    } finally {opening = false;}
  }

  return {boot, open, check};
}
