// n° 110 — Feuille « Pourquoi ? » : un composant unique, chargé à la demande (LAZY_TRIGGERS de
// lazy-modules.js), ouvert par les boutons (i) [data-explain] des priorités de l’accueil, des alertes,
// des créneaux météo, des règles d’automatisation et des totaux du Pilotage.
// Les calculs viennent des modules purs, au format {value, why[], missing[], rule} : faits retenus,
// données manquantes ou exclues, lien vers la règle modifiable. Lecture seule : rien n’est enregistré.
import {escapeHtml as e} from './utils.js';
import {getHomeAgenda, weatherOpportunity, localDay} from './home-priorities.js';
import {marginModel} from './pilotage.js';
import {automationRuleLabel} from './automations.js';
import {explainAgendaEntry, explainDailySituation, explainNotification, explainMarginTotal, explainStockValue, MARGIN_TOTALS, explainAutomationRule} from './explain-model.js';
import {workWeatherSlot, SLOT_DISCLAIMER} from './work-weather.js';

const list = (rows, cls) => `<ul class="${cls}">${rows.map(row => `<li>${e(row)}</li>`).join('')}</ul>`;
function section(title, {why = [], missing = []} = {}, {showEmpty = true} = {}) {
  return `${title ? `<h3>${e(title)}</h3>` : ''}${why.length ? list(why, 'why-list') : ''}`
    + (missing.length ? `<h4>Données manquantes ou exclues</h4>${list(missing, 'why-missing')}`
      : showEmpty ? '<p class="why-complete">Aucune donnée manquante pour ce calcul.</p>' : '');
}

// Contenu de la feuille (fonction pure, testée) : valeur, faits, manques, sections annexes.
export function explainSheetHtml(result, {extra = []} = {}) {
  const r = result || {why: [], missing: []};
  return `<div class="why-sheet">${r.value !== null && r.value !== undefined ? `<p class="why-value"><small>Résultat</small><strong>${e(r.value)}</strong></p>` : ''}`
    + section('Ce qui est pris en compte', r)
    + extra.filter(Boolean).map(x => section(x.title, x, {showEmpty: false})).join('') + '</div>';
}

// Explication d’un bouton (i) d’après ses attributs data-* ; null si le type est inconnu.
export function explainFor(dataset, {state, weather = null, today = localDay(), now = Date.now(), agroWeather = null}) {
  const kind = dataset.explain, id = dataset.id || '';
  if (kind === 'agenda') {
    const agenda = getHomeAgenda(state, today), index = agenda.entries.findIndex(x => x.item.id === id), entry = agenda.entries[index];
    if (!entry) return {title: 'Priorité', result: {value: null, why: ['Cet élément n’est plus en attente : il a été terminé, annulé ou supprimé.'], missing: []}};
    const parcel = (state.parcelles || []).find(p => p.id === entry.item.parcelId && !p.deletedAt) || null;
    const result = explainAgendaEntry(entry, today, {parcel, position: index + 1, total: agenda.entries.length});
    const slot = entry.kind === 'work' ? workWeatherSlot(entry.item, weather, {now}) : null;
    const extra = slot?.why ? [{title: `Météo : ${slot.text}`, why: [...slot.why, SLOT_DISCLAIMER], missing: slot.missing || []}] : [];
    const label = entry.kind === 'work' ? entry.item.type || 'Travail' : entry.item.title || 'Tâche';
    return {title: `Pourquoi « ${label} » ?`, result: {...result, rule: {label: 'Ouvrir', action: entry.kind === 'work' ? 'edit-work' : 'edit-task', id}}, extra};
  }
  if (kind === 'day') return {title: 'Bilan de la journée', result: {...explainDailySituation(state, today), rule: {label: 'Voir la journée', action: 'calendar-day-overview'}}};
  if (kind === 'weather') {
    const result = weatherOpportunity(weather, state.preferences, new Date(now));
    return {title: 'Fenêtre de traitement', result: {value: result.window ? 'Fenêtre favorable' : result.stale ? 'Non calculée' : 'Pas de fenêtre', ...result,
      rule: result.stale ? {label: 'Actualiser la météo', action: 'refresh-weather'} : {label: 'Régler le seuil de vent', action: 'open-settings'}}};
  }
  if (kind === 'alert') return {title: 'Pourquoi cette alerte ?', result: explainNotification(state, id, {today})};
  if (kind === 'margin') {
    const key = dataset.key, result = explainMarginTotal(marginModel(state, {campaign: dataset.campaign || undefined}), key);
    return {title: MARGIN_TOTALS[key] || 'Total', result};
  }
  if (kind === 'stock') return {title: 'Valeur des stocks', result: explainStockValue(state)};
  if (kind === 'automation') {
    const rule = (state.automationRules || []).find(r => r.id === id && !r.deletedAt);
    return {title: rule ? automationRuleLabel(rule) : 'Automatisation', result: explainAutomationRule(rule, state, now, {weather, agroWeather})};
  }
  return null;
}

const RULE_ATTRS = ['id', 'entity', 'campaign'];
function ruleButton(rule, canEdit) {
  if (!rule?.action) return '';
  // Lecture seule : pas de lien vers une règle à modifier.
  if (!canEdit && ['edit-automation', 'open-settings'].includes(rule.action)) return '';
  // Lien d’écriture (rule.edit) vers une fiche consultable : libellé neutre en lecture seule.
  const label = !canEdit && rule.edit ? 'Ouvrir l’élément' : rule.label;
  return `<button type="button" class="button secondary" data-action="${e(rule.action)}"${RULE_ATTRS.filter(k => rule[k]).map(k => ` data-${k}="${e(rule[k])}"`).join('')}>${e(label)}</button>`;
}

export function createExplainUI({state, weather = () => null, agroWeather = () => null, canEdit = () => true, doc = globalThis.document} = {}) {
  let dialog = null, opener = null;
  function close() {
    if (!dialog?.open) return;
    dialog.close();
  }
  function ensure() {
    if (dialog?.isConnected) return dialog;
    dialog = doc.createElement('dialog');
    dialog.className = 'why-dialog';
    dialog.setAttribute('aria-labelledby', 'why-title');
    dialog.addEventListener('click', event => {
      if (event.target === dialog || event.target.closest('[data-why-close]')) { close(); return; }
      // Un lien de règle ferme la feuille puis laisse le délégué d’app.js traiter l’action.
      if (event.target.closest('[data-action]')) close();
    });
    dialog.addEventListener('close', () => { const back = opener; opener = null; if (back?.isConnected) back.focus({preventScroll: true}); });
    doc.body.append(dialog);
    return dialog;
  }
  function open(dataset, control = null) {
    let found = null;
    try { found = explainFor(dataset, {state: state(), weather: weather(), agroWeather: agroWeather()}); }
    catch (error) { console.warn('[Parcelles] explication', error); found = {title: 'Pourquoi ?', result: {value: null, why: ['Explication indisponible pour le moment.'], missing: []}}; }
    if (!found) return false;
    const node = ensure();
    opener = control;
    node.innerHTML = `<header class="why-head"><h2 id="why-title">${e(found.title)}</h2><button type="button" class="modal-close" data-why-close aria-label="Fermer">×</button></header>`
      + `<div class="why-body">${explainSheetHtml(found.result, {extra: found.extra})}</div>`
      + `<footer class="why-foot">${ruleButton(found.result?.rule, canEdit())}<button type="button" class="button primary" data-why-close>Fermer</button></footer>`;
    if (!node.open) { if (typeof node.showModal === 'function') node.showModal(); else node.setAttribute('open', ''); }
    node.querySelector('.why-foot [data-why-close]')?.focus({preventScroll: true});
    return true;
  }
  // Tant que la feuille est ouverte, le clavier lui appartient : écoute en capture sur le document pour
  // que le gestionnaire global d’app.js (Échap → closeModal, « n », « / », Ctrl+K, « g x ») ne voie rien,
  // même quand le focus a quitté les boutons (clic sur le texte). Échap ferme seulement la feuille,
  // Tab reste dans la feuille.
  doc?.addEventListener('keydown', event => {
    if (!dialog?.open) return;
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const nodes = [...dialog.querySelectorAll('button:not([disabled]),a[href]')], first = nodes[0], last = nodes.at(-1), active = doc.activeElement;
    if (!dialog.contains(active)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
    else if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
  }, true);
  doc?.addEventListener('click', event => {
    const b = event.target?.closest?.('[data-explain]');
    if (!b) return;
    event.preventDefault();
    open({...b.dataset}, b);
  });
  return {open, close};
}
