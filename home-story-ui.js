// Rendu de l’accueil « qui raconte la journée » : salutation, phrase d’agenda, carte « Ce matin »,
// lecture à voix haute, prénom et position de l’exploitation. Lecture seule, sauf deux écritures
// explicites et confirmées par l’utilisateur : le prénom (préférences) et la position (exploitation).
import {escapeHtml} from './utils.js';
import {composeMorningBrief, dayStory, greetingTitle, typo} from './home-story.js';

const NAME_PROMPT_KEY = 'parcelles:name-prompt-dismissed';
const readFlag = key => {try {return globalThis.localStorage?.getItem(key) || '';} catch {return '';}};
const writeFlag = (key, value) => {try {globalThis.localStorage?.setItem(key, value);} catch {}};
const SPEAKER = '<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const STOP = '<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const CHEVRON = '<svg class="ui-icon story-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6"/></svg>';
const PIN = '<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>';

export function createHomeStoryUI({store, modal, closeModal, toast, refreshWeather, now = () => Date.now()}) {
  let lastSpeech = '';
  const canSpeak = () => 'speechSynthesis' in globalThis && typeof globalThis.SpeechSynthesisUtterance === 'function';
  const coordinate = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value));
  const hasLocation = data => Boolean(String(data.exploitation?.commune || '').trim() || (coordinate(data.exploitation?.latitude) && coordinate(data.exploitation?.longitude)));

  function header(data, cockpit) {
    const date = new Date(now()), title = document.querySelector('#today-title'), subtitle = document.querySelector('#today-subtitle');
    const name = (data.preferences?.userName || data.preferences?.firstName || data.profile?.firstName || '').trim();
    if (title) title.textContent = greetingTitle(name, date);
    if (subtitle) subtitle.textContent = dayStory(cockpit, date);
    let prompt = document.querySelector('#story-name-prompt');
    const show = !name && !readFlag(NAME_PROMPT_KEY);
    if (!show) {prompt?.remove(); return;}
    if (!prompt && subtitle) {
      prompt = document.createElement('p');
      prompt.id = 'story-name-prompt';
      prompt.className = 'story-name-prompt';
      prompt.innerHTML = '<button type="button" class="text-button" data-story="name">Comment souhaitez-vous être salué ?</button><button type="button" class="story-dismiss" data-story="name-later" aria-label="Ne plus proposer de saisir le prénom">×</button>';
      subtitle.after(prompt);
    }
  }

  function weatherMeta(age) {
    const offline = globalThis.navigator?.onLine === false ? 'Hors connexion · ' : '';
    if (age.state === 'fresh') return `${offline}Météo actualisée ${age.label}`;
    if (age.state === 'stale' || age.state === 'old') return `${offline}Dernière actualisation météo ${age.label}`;
    return offline ? 'Hors connexion' : '';
  }

  function sentenceHtml(s) {
    const tone = s.tone ? ` is-${s.tone}` : '';
    if (s.story) return `<li><button type="button" class="story-line${tone}" data-story="${escapeHtml(s.story)}"><span>${escapeHtml(s.text)}</span>${CHEVRON}</button></li>`;
    if (!s.action) return `<li><p class="story-line is-static${tone}"><span>${escapeHtml(s.text)}</span></p></li>`;
    return `<li><button type="button" class="story-line${tone}" data-action="${escapeHtml(s.action)}"${s.id ? ` data-id="${escapeHtml(s.id)}"` : ''}><span>${escapeHtml(s.text)}</span>${CHEVRON}</button></li>`;
  }

  function renderBrief(root, {data, weather, cockpit}) {
    if (!root) return;
    const brief = composeMorningBrief(data, weather, {now: now(), cockpit, location: hasLocation(data)});
    lastSpeech = brief.speech;
    const meta = typo(weatherMeta(brief.weatherAge));
    const speaking = canSpeak() && globalThis.speechSynthesis.speaking;
    root.innerHTML = `<div class="story-card"><div class="story-head"><div><h2>${escapeHtml(brief.title)}</h2>${meta ? `<small class="story-meta">${escapeHtml(meta)}</small>` : ''}</div>${canSpeak() ? `<button type="button" class="button secondary story-listen" data-story="listen" aria-pressed="${speaking}" aria-label="${speaking ? 'Arrêter la lecture du briefing' : 'Écouter le briefing'}">${speaking ? STOP : SPEAKER}<span>${speaking ? 'Arrêter' : 'Écouter'}</span></button>` : ''}</div><ul class="story-list">${brief.sentences.map(sentenceHtml).join('')}</ul>${brief.indicative ? '<p class="story-note">Créneaux indicatifs, calculés sur les seuils météo de l’application : à confirmer sur le terrain. Ce n’est pas une autorisation réglementaire de traitement.</p>' : ''}</div>`;
  }

  // Carte Météo sans prévision : une ligne compacte plutôt qu’un grand bloc vide.
  function weatherEmpty(data) {
    if (hasLocation(data)) return '<div class="story-weather-empty"><span>Prévisions non chargées.</span><button type="button" class="button secondary" data-action="refresh-weather">Actualiser</button></div>';
    return `<div class="story-weather-empty"><span>Position de l’exploitation inconnue : pas de prévisions.</span><button type="button" class="button secondary" data-story="locate">${PIN}<span>Utiliser ma position</span></button></div>`;
  }

  function setListenButton(speaking) {
    const button = document.querySelector('[data-story="listen"]');
    if (!button) return;
    button.setAttribute('aria-pressed', String(speaking));
    button.setAttribute('aria-label', speaking ? 'Arrêter la lecture du briefing' : 'Écouter le briefing');
    button.innerHTML = `${speaking ? STOP : SPEAKER}<span>${speaking ? 'Arrêter' : 'Écouter'}</span>`;
  }
  function listen() {
    if (!canSpeak()) return toast('Lecture vocale non disponible sur cet appareil.', 'error');
    const synth = globalThis.speechSynthesis;
    if (synth.speaking) {synth.cancel(); setListenButton(false); return;}
    if (!lastSpeech) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(lastSpeech);
    utterance.lang = 'fr-FR';
    utterance.onend = utterance.onerror = () => setListenButton(false);
    synth.speak(utterance);
    setListenButton(true);
  }

  function openNameForm() {
    const current = (store.state.preferences?.userName || '').trim();
    modal('Votre prénom', 'Il sert uniquement à vous saluer sur l’écran Aujourd’hui.', `<form id="story-name-form" class="form-grid" novalidate><label class="span-2">Prénom *<input name="userName" value="${escapeHtml(current)}" autocomplete="given-name" maxlength="40" data-autofocus></label><p class="form-error span-2 hidden" id="story-name-error" role="alert"></p></form>`, '<button class="button primary story-full" id="save-story-name">Enregistrer</button>', 'small');
    const form = document.querySelector('#story-name-form'), error = document.querySelector('#story-name-error'), button = document.querySelector('#save-story-name');
    const save = async event => {
      event?.preventDefault();
      if (button.disabled) return;
      const value = String(form.elements.userName.value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!value) {error.textContent = 'Champ obligatoire : prénom'; error.classList.remove('hidden'); form.elements.userName.focus(); return;}
      button.disabled = true;
      try {await store.setPreferences({userName: value}); closeModal(); toast(`Enchanté, ${value}.`);}
      catch (e) {error.textContent = `Enregistrement impossible : ${e.message}`; error.classList.remove('hidden'); button.disabled = false;}
    };
    form.addEventListener('submit', save);
    button.onclick = save;
  }

  function locate() {
    const geo = globalThis.navigator?.geolocation;
    if (!geo) return toast('La localisation n’est pas disponible sur cet appareil. Renseignez la commune dans Plus › Paramètres.', 'error');
    const button = document.querySelector('[data-story="locate"]');
    if (button) button.disabled = true;
    geo.getCurrentPosition(async position => {
      const latitude = Math.round(position.coords.latitude * 10000) / 10000, longitude = Math.round(position.coords.longitude * 10000) / 10000;
      try {
        await store.setExploitation({latitude, longitude});
        if (globalThis.navigator?.onLine === false) toast('Position enregistrée. Les prévisions se chargeront au retour de la connexion.');
        else {toast('Position de l’exploitation enregistrée.'); await refreshWeather({silent: true});}
      } catch (e) {toast(`Enregistrement impossible : ${e.message}`, 'error');}
      finally {if (button?.isConnected) button.disabled = false;}
    }, error => {
      if (button?.isConnected) button.disabled = false;
      toast(error?.code === 1 ? 'Position refusée. Vous pouvez saisir la commune de l’exploitation dans Plus › Paramètres.' : 'Position introuvable pour le moment. Réessayez à l’extérieur ou saisissez la commune.', 'error');
    }, {enableHighAccuracy: false, timeout: 15000, maximumAge: 600000});
  }

  document.addEventListener('click', event => {
    const control = event.target.closest?.('[data-story]');
    if (!control) return;
    const action = control.dataset.story;
    if (action === 'listen') listen();
    else if (action === 'name') openNameForm();
    else if (action === 'name-later') {writeFlag(NAME_PROMPT_KEY, '1'); document.querySelector('#story-name-prompt')?.remove();}
    else if (action === 'locate') locate();
  });
  // Quitter l’écran coupe la lecture.
  globalThis.addEventListener?.('pagehide', () => {if (canSpeak()) globalThis.speechSynthesis.cancel();});

  return {header, renderBrief, weatherEmpty};
}
