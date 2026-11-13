// Rendu de l’accueil « qui raconte la journée » : salutation, phrase d’agenda, carte « Ce matin »,
// lecture à voix haute, prénom et position de l’exploitation. Lecture seule, sauf deux écritures
// explicites et confirmées par l’utilisateur : le prénom (préférences) et la position (exploitation).
import {escapeHtml, localIso} from './utils.js';
import {composeMorningBrief, dayStory, greetingTitle, typo} from './home-story.js';
import {decisionFeed, decisionCountLabel, stakesLabel} from './decision-feed.js';
import {recordFeedback, undoFeedback, alreadyRecorded, unhideAll, restoreHidden, hiddenLabel, laterDays} from './decision-feedback.js';
import {briefing} from './morning-brief.js';
// Sources du fil « À décider » (W3, W5, W6). Import en espace de noms : un export absent ne casse pas le chargement.
import * as inputNeedsModule from './input-needs.js';
import * as costDriftModule from './cost-drift.js';
import * as grazingRotationModule from './grazing-rotation.js';
import {farmGrassGrowth, growthOptions, grassShortfall} from './grass-growth.js';
import {isModuleActive} from './activity-modules.js';
import {publishedNdviPeers} from './ndvi-peers.js';
import {weatherRaces} from './weather-race.js';
import {SOIL_WATER_CACHE_KEY} from './soil-water.js';

const NAME_PROMPT_KEY = 'parcelles:name-prompt-dismissed';
const readFlag = key => {try {return globalThis.localStorage?.getItem(key) || '';} catch {return '';}};
const writeFlag = (key, value) => {try {globalThis.localStorage?.setItem(key, value);} catch {}};
const SPEAKER = '<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const STOP = '<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const CHEVRON = '<svg class="ui-icon story-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6"/></svg>';
const PIN = '<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>';

export function createHomeStoryUI({store, modal, closeModal, toast, refreshWeather, now = () => Date.now(), zvAuto = null, onLateData = null, canBill = () => true}) {
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
      prompt.innerHTML = '<button type="button" class="text-button" data-story="name">Comment souhaitez-vous être salué&nbsp;?</button><button type="button" class="story-dismiss" data-story="name-later" aria-label="Ne plus proposer de saisir le prénom">×</button>';
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

  // Fil « À décider » : au plus 7 cartes classées par enjeu ; rien si la liste est vide.
  const source = fn => {try {const rows = fn(); return Array.isArray(rows) ? rows : [];} catch {return [];}};
  // treasury.js (et invoices.js) restent hors du démarrage : chargés seulement si la trésorerie est paramétrée ; la carte paraît au rendu suivant.
  let treasuryModule = null, treasuryLoading = false;
  const treasuryForecastFor = data => {
    if (treasuryModule || treasuryLoading || !data?.preferences?.treasury) return treasuryModule?.treasuryForecast || null;
    treasuryLoading = true;
    import('./treasury.js').then(m => {treasuryModule = m;}, () => {treasuryLoading = false;});
    return null;
  };
  // forage.js (bilan fourrager) reste hors du démarrage : chargé seulement si l’hivernage a des lots paramétrés.
  let forageModule = null, forageLoading = false;
  const forageBalanceFor = (data, today) => {
    const lots = data?.preferences?.forageWinter?.lots;
    if (!Array.isArray(lots) || !lots.length) return null;
    if (!forageModule) {
      if (!forageLoading) {forageLoading = true; import('./forage.js').then(m => {forageModule = m; try {onLateData?.();} catch {}}, () => {forageLoading = false;});}
      return null;
    }
    try {return forageModule.forageBalance(data, {today});} catch {return null;}
  };
  // Hivernage paramétré : chargement lancé dès la création ; l’accueil est redessiné à son arrivée (onLateData).
  if (store?.state?.preferences?.forageWinter?.lots?.length) forageBalanceFor(store.state, localIso(new Date(now())));
  // Idée 13 : billing-actions.js (relances, factures à préparer) reste hors du démarrage : chargé seulement s’il y a des
  // clients ou des factures et que le rôle voit la facturation ; les cartes paraissent au rendu suivant (onLateData).
  let billingModule = null, billingLoading = false;
  const billingFor = (data, today) => {
    let allowed = false;
    // Clients enregistrés, ou factures sans fiche client (relances regroupées par nom).
    const live = list => (list || []).some(x => x && !x.deletedAt);
    try {allowed = !!canBill() && (live(data?.clients) || live((data?.integrationImports || []).filter(r => r?.farmKind === 'invoice')));} catch {allowed = false;}
    if (!allowed) return [];
    if (!billingModule) {
      if (!billingLoading) {billingLoading = true; import('./billing-actions.js').then(m => {billingModule = m; try {onLateData?.();} catch {}}, () => {billingLoading = false;});}
      return [];
    }
    try {return billingModule.billingDecisions(data, {today});} catch {return [];}
  };
  // agro : prévisions agronomiques (agroWeather.get(), avec days[]) ; le cache météo d’accueil (daily.time) ne convient pas aux risques.
  // Cartes du dernier rendu, pour retrouver kind, gravité et délai au clic sur « Fait / Plus tard / Pas pertinent ».
  const shownDecisions = new Map();
  function decisionsHtml(data, weather, agro) {
    const today = localIso(new Date(now()));
    let rows = [];
    const stats = {hidden: 0};
    let growth = null;
    const livestock = isModuleActive('livestock', data.preferences?.activeModules);
    try {growth = farmGrassGrowth(data, {today, agro});} catch {growth = null;}
    try {
      rows = decisionFeed(data, {today, now: now(), stats, weather: agro?.days?.length ? agro : weather?.days?.length ? weather : null,
        inputNeeds: source(() => inputNeedsModule.inputNeeds?.(data, {today})),
        costDrifts: source(() => costDriftModule.farmCostDrift?.(data, {})),
        grazingAdvice: source(() => grazingRotationModule.grazingRotationAdvice?.(data, {today, ...growthOptions(growth)})),
        // Cartes d’élevage seulement si le module Élevage est actif (outils masqués sinon).
        forage: livestock ? forageBalanceFor(data, today) : null,
        grassShortfall: livestock ? (() => {try {return grassShortfall(data, growth, {today});} catch {return null;}})() : null,
        // Prévision horaire (créneaux de traitement) et détection automatique des zones vulnérables, si disponibles.
        morning: (() => {
          const hourly = weather?.hourly?.time?.length ? weather : null;
          try {return briefing(data, {today, now: now(), agro: agro?.days?.length ? agro : null, weather: hourly, zvAuto});} catch {return [];}
        })(),
        // Idée 10 : NDVI en retard sur les parcelles de même culture (cache satellite publié par satellite-ui.js).
        ndviPeers: source(() => publishedNdviPeers()),
        billing: billingFor(data, today),
        // Idée 6 : course contre la météo (prévision agronomique et bilan hydrique en cache, lecture seule).
        weatherRace: source(() => weatherRaces(data, {today, agro: agro?.days?.length ? agro : null, soil: (() => {
          try {const c = JSON.parse(globalThis.localStorage?.getItem(SOIL_WATER_CACHE_KEY) || 'null'); return c?.days?.length ? c : null;} catch {return null;}
        })()})),
        treasuryForecast: treasuryForecastFor(data)});
    } catch {rows = [];}
    shownDecisions.clear();
    for (const d of rows) shownDecisions.set(d.id, d);
    const hiddenHtml = stats.hidden ? `<p class="decision-hidden"><span>${escapeHtml(hiddenLabel(stats.hidden))}</span><button type="button" class="text-button" data-story="decision-unhide">Réafficher</button></p>` : '';
    if (!rows.length) return hiddenHtml ? `<section class="decision-feed" aria-label="À décider">${hiddenHtml}</section>` : '';
    const feedbackHtml = d => {
      const id = escapeHtml(d.id), title = escapeHtml(typo(d.title));
      const button = (verdict, label, aria) => `<button type="button" class="decision-fb" data-story="decision-fb" data-verdict="${verdict}" data-decision="${id}" aria-label="${aria} : ${title}">${label}</button>`;
      return `<div class="decision-feedback" role="group" aria-label="Votre avis sur cette alerte">${button('done', 'Fait', 'Déjà fait')}${button('later', 'Plus tard', 'Revoir plus tard')}${button('no', 'Pas pertinent', 'Pas pertinent')}</div>`;
    };
    const card = d => {
      const stakes = stakesLabel(d.stakes), a = d.action || {};
      const extra = (a.payload?.entity ? ` data-entity="${escapeHtml(a.payload.entity)}"` : '') + (['create-task-prefill', 'plan-habit-work'].includes(a.type) && a.payload ? ` data-payload="${escapeHtml(JSON.stringify(a.payload))}"` : '');
      return `<li class="decision-card is-${escapeHtml(d.level)}"><div class="decision-main"><strong>${escapeHtml(typo(d.title))}</strong>${stakes ? `<small class="decision-stakes">${escapeHtml(stakes)}</small>` : ''}<details class="decision-why"><summary>Pourquoi&nbsp;? · Votre avis</summary><ul>${d.why.map(w => `<li>${escapeHtml(typo(w))}</li>`).join('')}</ul>${feedbackHtml(d)}</details></div><button type="button" class="button secondary decision-action" data-action="${escapeHtml(a.type)}" data-id="${escapeHtml(a.id ?? '')}"${extra}>${escapeHtml(a.label || 'Voir')}</button></li>`;
    };
    return `<section class="decision-feed" aria-labelledby="decision-feed-title"><h2 id="decision-feed-title" tabindex="-1">${escapeHtml(decisionCountLabel(rows.length))}</h2><ul class="decision-list">${rows.map(card).join('')}</ul>${hiddenHtml}</section>`;
  }

  // Retour sur une carte : enregistré dans les préférences de l’appareil (non synchronisé), annulable depuis le toast.
  const FEEDBACK_TOAST = {
    done: () => 'Noté : carte masquée 7 jours.',
    later: d => laterDays(d) === 1 ? 'Carte reportée à demain.' : 'Carte reportée de 3 jours.',
    no: () => 'Noté : carte masquée 14 jours. Si vous écartez encore ce type d’alerte, il passera après les autres.'
  };
  const currentFeedback = () => store.state.preferences?.decisionFeedback ?? null;
  const todayIso = () => localIso(new Date(now()));
  // La carte quitte le DOM au rendu suivant : le focus revient au titre du fil (ou à « Réafficher »), pas en haut de page.
  const refocusFeed = () => requestAnimationFrame(() => (document.querySelector('#decision-feed-title') || document.querySelector('[data-story="decision-unhide"]'))?.focus({preventScroll: true}));
  async function decisionFeedback(id, verdict) {
    const d = shownDecisions.get(id);
    if (!d || !FEEDBACK_TOAST[verdict]) return;
    shownDecisions.delete(id); // double appui : le second clic ne trouve plus la carte
    const today = todayIso();
    if (alreadyRecorded(currentFeedback(), id, verdict, {today})) return;
    try {
      await store.setPreferences({decisionFeedback: recordFeedback(currentFeedback(), d, verdict, {today})});
      refocusFeed();
      toast(FEEDBACK_TOAST[verdict](d), 'success', {label: 'Annuler', run: () => store.setPreferences({decisionFeedback: undoFeedback(currentFeedback(), d, verdict, {today})})});
    } catch (e) {shownDecisions.set(id, d); toast(`Enregistrement impossible : ${e.message}`, 'error');}
  }
  async function decisionUnhide() {
    const before = currentFeedback();
    try {
      await store.setPreferences({decisionFeedback: unhideAll(before, {today: todayIso()})});
      refocusFeed();
      toast('Alertes masquées réaffichées.', 'success', {label: 'Annuler', run: () => store.setPreferences({decisionFeedback: restoreHidden(currentFeedback(), before, {today: todayIso()})})});
    } catch (e) {toast(`Enregistrement impossible : ${e.message}`, 'error');}
  }

  function renderBrief(root, {data, weather, cockpit, agro = null}) {
    if (!root) return;
    const brief = composeMorningBrief(data, weather, {now: now(), cockpit, location: hasLocation(data)});
    lastSpeech = brief.speech;
    const meta = typo(weatherMeta(brief.weatherAge));
    const speaking = canSpeak() && globalThis.speechSynthesis.speaking;
    root.innerHTML = `${decisionsHtml(data, weather, agro)}<div class="story-card"><div class="story-head"><div><h2>${escapeHtml(brief.title)}</h2>${meta ? `<small class="story-meta">${escapeHtml(meta)}</small>` : ''}</div>${canSpeak() ? `<button type="button" class="button secondary story-listen" data-story="listen" aria-pressed="${speaking}" aria-label="${speaking ? 'Arrêter la lecture du briefing' : 'Écouter le briefing'}">${speaking ? STOP : SPEAKER}<span>${speaking ? 'Arrêter' : 'Écouter'}</span></button>` : ''}</div><ul class="story-list">${brief.sentences.map(sentenceHtml).join('')}</ul>${brief.indicative ? '<p class="story-note">Créneaux indicatifs, calculés sur les seuils météo de l’application : à confirmer sur le terrain. Ce n’est pas une autorisation réglementaire de traitement.</p>' : ''}</div>`;
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
    if (!geo) return toast('La localisation n’est pas disponible sur cet appareil. Renseignez la commune dans Menu › Paramètres.', 'error');
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
      toast(error?.code === 1 ? 'Position refusée. Vous pouvez saisir la commune de l’exploitation dans Menu › Paramètres.' : 'Position introuvable pour le moment. Réessayez à l’extérieur ou saisissez la commune.', 'error');
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
    else if (action === 'decision-fb') decisionFeedback(control.dataset.decision, control.dataset.verdict);
    else if (action === 'decision-unhide') decisionUnhide();
  });
  // Quitter l’écran coupe la lecture.
  globalThis.addEventListener?.('pagehide', () => {if (canSpeak()) globalThis.speechSynthesis.cancel();});

  return {header, renderBrief, weatherEmpty};
}
