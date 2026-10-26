// Centre « Facturation » (vague 13, chantier B) : point d’entrée unique (Plus › Gestion, recherche, accueil,
// fiche client, action historique « open-invoices »). Module différé (lazy-modules.js, clé « billingHub »).
// Onglets : Suivi (tableau de bord filtré), À faire (relances groupées, devis à suivre, prestations non
// facturées, récurrences dues, doublons, clients à risque), Clients, Catalogue, Récurrences, Réglages.
// Les documents (liste, fiche, saisie, paiement, envoi) appartiennent à l’écran des documents (clé
// « billingDocs », createBillingDocsUI) : on ne l’appelle que par openDocument / openNew / openList /
// openPayment / openSend ; s’il ne se charge pas, un message « écran indisponible » propose l’ancien écran.
// Boutons repérés par data-bh : un seul écouteur délégué, installé une fois.
import {html, raw} from './safe-html.js';
import {canMutate, normalizeRole} from './permissions.js';
import {active} from './farm-memory.js';
import {DOC_LABELS, dateFr, isoDay, patchEmitted} from './invoices.js';
import {recordReminder, logSent} from './billing.js';
import {groupedReminderMessage, quoteFollowUpMessage} from './billing-messages.js';
import {HUB_TABS, hubTab, PERIODS, hubDashboard, revenueChartSvg, forecastChartSvg, hubTodo, dupKey, clientBilling, clientsOverview, RISK_LABELS, money, moneyShort, plural, monthLabel} from './billing-hub.js';
import {createHubCatalogUI} from './billing-hub-catalog-ui.js';
import {createHubSettingsUI} from './billing-hub-settings-ui.js';
import {FEC_DISCLAIMER, billingFecText, billingLinesCsv} from './billing-export.js';
import {download} from './utils.js';
import {loadSheet} from './lazy-styles.js';

// Feuille du centre, hors d'index.html : le module n'est livré (lazy.load) qu'une fois la feuille appliquée.
await loadSheet('billing-hub.css');

const DISMISS_KEY = 'parcelles:billing-duplicates-ignored';
const TONE = {payee: 'ok', accepte: 'ok', converti: 'ok', retard: 'bad', refuse: 'bad', expire: 'muted', annulee: 'muted', brouillon: 'warn'};
// Dernière instance créée : l'écran des documents (chantier A) peut appeler open(tab) sur le module lui-même.
let current = null;
export const openHub = (tab, options) => current?.open(tab, options);
export {openHub as open};
export const openSettings = section => current?.openSettings(section);
// Pièces de facturation : l'e-mail d'abord (objet, trace écrite), sinon le canal préféré du contact.
const channelOf = msg => (msg.recipients?.some(r => r.email) ? 'email' : 'auto');
const pill = (status, label) => html`<span class="bh-pill is-${TONE[status] || 'info'}">${label}</span>`;

export function createBillingHubUI(host = {}) {
  const {store, modal, closeModal, toast, lazy = null, bindChipChoices = () => {}, doc = globalThis.document} = host;
  const data = () => (typeof host.state === 'function' ? host.state() : null) || store.state;
  const role = () => normalizeRole((typeof host.role === 'function' ? host.role() : host.role) || 'owner');
  const visible = () => !['viewer', 'operator'].includes(role());
  const canWrite = (farmKind = 'invoice') => !store.tabReadOnly && canMutate(role(), {entity: 'integrationImports', action: 'update', farmKind});
  const today = () => isoDay(typeof host.now === 'function' ? new Date(host.now()) : new Date());
  const local = (() => { try { return globalThis.localStorage; } catch { return null; } })();
  const readDismissed = () => { try { return JSON.parse(local?.getItem(DISMISS_KEY) || '[]'); } catch { return []; } };
  const writeDismissed = list => { try { local?.setItem(DISMISS_KEY, JSON.stringify(list.slice(-200))); } catch { /* stockage indisponible */ } };
  let tab = 'suivi', filters = {period: '12m', clientId: ''}, installed = false, panelView = null;
  const $ = sel => doc.querySelector(sel);
  const panel = () => doc.getElementById('bh-panel');

  // ——— Écran des documents (chantier A) ———
  // Interface attendue : openDocument(id), openNew({docType, clientId, lines, fromQuoteId, extra}),
  // openList(docType | 'all', {filter}) avec filter = {clientId, clientName, status ('due' | 'retard' |
  // 'payee'…), aged (tranche de la balance âgée), from, to}, openPayment(id), openSend(id, {purpose}).
  // Instance fournie par app.js (host.docsUI), sinon module « billingDocs » (fabrique ou fonctions exportées).
  let docsUI = null;
  async function docs(fallback = null) {
    if (docsUI) return docsUI;
    try {
      const given = typeof host.docsUI === 'function' ? host.docsUI() : null;
      if (given) return (docsUI = given);
      if (!lazy) throw new Error('chargeur absent');
      const m = await lazy.load('billingDocs');
      docsUI = (typeof host.docsUI === 'function' && host.docsUI()) || (typeof m.openList === 'function' ? m : m.createBillingDocsUI(host));
      return docsUI;
    } catch (error) {
      console.warn('[Parcelles] écran des documents indisponible.', error);
      toast('Écran des documents indisponible pour le moment.', 'error', host.legacy ? {label: 'Ancien écran', run: async () => { const old = await host.legacy(); return fallback ? fallback(old) : old.legacyOpen?.(); }} : null);
      return null;
    }
  }
  const LEGACY_FILTERS = {due: 'due', retard: 'retard', payee: 'payee', brouillon: 'brouillon'};
  const withDocs = async (fn, fallback) => { const d = await docs(fallback); return d ? fn(d) : null; };
  const openList = (docType, filter = {}) => withDocs(d => d.openList(docType, {filter}), old => old.legacyOpen?.(docType === 'avoir' ? 'avoir' : LEGACY_FILTERS[filter.status] || 'all'));
  const openDocument = id => withDocs(d => d.openDocument(id), old => old.view?.(id));
  const openNew = (values = {}) => withDocs(d => d.openNew(values), old => old.legacyPrepare?.(values.clientId || ''));
  const openSend = (id, options = {}) => withDocs(d => d.openSend(id, options), old => old.view?.(id));

  const shared = {store, data, today, toast, modal, closeModal, bindChipChoices, canWrite, role, doc, html, raw, openDocument, openNew, openList, openSend, refresh: () => paint(), back: () => paint(), host,
    setView: view => { panelView = view; }};
  const catalog = createHubCatalogUI(shared);
  const settings = createHubSettingsUI(shared);

  // ——— Coque : onglets accessibles (tablist, flèches) ———
  function tabsHtml(todoCount) {
    return html`<div class="bh-tabs" role="tablist" aria-label="Sections de la facturation">${HUB_TABS.map(([k, label]) => html`<button type="button" role="tab" class="bh-tab${k === tab ? ' is-on' : ''}" id="bh-tab-${k}" aria-selected="${k === tab}" aria-controls="bh-panel" tabindex="${k === tab ? 0 : -1}" data-bh="tab" data-value="${k}">${label}${k === 'afaire' && todoCount ? html`<span class="bh-count" aria-label="${plural(todoCount, 'élément', 'éléments')}">${todoCount}</span>` : ''}</button>`)}</div>`;
  }
  function footerHtml() {
    const w = canWrite('invoice');
    return String(w ? html`<button type="button" class="button secondary" data-bh="new" data-doc="devis">Nouveau devis</button><button type="button" class="button primary" data-bh="new" data-doc="facture">Nouvelle facture</button>` : html`<button type="button" class="button secondary" data-bh="list" data-doc="all">Toutes les pièces</button>`);
  }
  // name : onglet, éventuellement suivi d'une précision (« reglages:modele », « clients:<id> »,
  // « catalogue:nouveau », « recurrences:nouveau ») pour les liens directs et les contrôles automatiques.
  function open(name, {section = ''} = {}) {
    if (!visible()) { toast('La facturation est réservée à la gestion et à la comptabilité.', 'info'); return; }
    // Feuille en échec au chargement du module : nouvel essai à chaque ouverture (sans effet si déjà liée).
    loadSheet('billing-hub.css');
    const [wanted, detail = ''] = String(name || '').split(':');
    tab = hubTab(wanted || data().preferences?.billingHubTab || 'suivi');
    panelView = null;
    install();
    const todo = safeTodo();
    modal('Facturation', 'Suivi, relances, catalogue et réglages', String(html`<div class="bh" data-bh-root>${tabsHtml(todo.count)}<div id="bh-panel" class="bh-panel" role="tabpanel" aria-labelledby="bh-tab-${tab}" tabindex="-1"></div></div>`), footerHtml(), 'large');
    paint({section: section || (tab === 'reglages' ? detail : '')});
    revealTab();
    if (tab === 'clients' && detail) openClient(detail);
    else if (detail === 'nouveau' && tab === 'catalogue' && canWrite('billingItem')) catalog.handle('cat-new', {dataset: {}});
    else if (detail === 'nouveau' && tab === 'recurrences' && canWrite('billingSchedule')) catalog.handle('rec-new', {dataset: {}});
  }
  // Onglet actif visible dans la barre défilante (téléphone).
  function revealTab() {
    const t = doc.querySelector('.bh-tab.is-on'), bar = t?.parentElement;
    if (bar && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = Math.max(0, t.offsetLeft - (bar.clientWidth - t.offsetWidth) / 2);
  }
  function safeTodo() { try { return hubTodo(data(), {today: today(), dismissed: readDismissed()}); } catch (error) { console.warn('[Parcelles] « À faire » indisponible.', error); return {count: 0, reminders: [], quotes: [], recurring: [], unbilled: [], duplicates: [], risky: [], lateTotal: 0}; } }
  function selectTab(next, {focus = false} = {}) {
    tab = hubTab(next); panelView = null;
    doc.querySelectorAll('.bh-tab').forEach(b => { const on = b.dataset.value === tab; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    panel()?.setAttribute('aria-labelledby', `bh-tab-${tab}`);
    paint();
    revealTab();
  }
  function paint({section = ''} = {}) {
    const box = panel();
    if (!box) return;
    // Focus dans le panneau (ou perdu) avant le rendu : il y revient après, jamais sur <body> derrière la fenêtre.
    const hadFocus = box.contains(doc.activeElement) || !doc.activeElement || doc.activeElement === doc.body;
    try { draw(box, section); } finally {
      markForms(box);
      updateBadge();
      if (hadFocus && !box.contains(doc.activeElement)) box.focus({preventScroll: true});
    }
  }
  function draw(box, section) {
    if (panelView) { panelView(box); return; }
    try {
      if (tab === 'suivi') renderDashboard(box);
      else if (tab === 'afaire') renderTodo(box);
      else if (tab === 'clients') renderClients(box);
      else if (tab === 'catalogue') catalog.renderCatalog(box);
      else if (tab === 'recurrences') catalog.renderSchedules(box);
      else settings.render(box, section);
    } catch (error) {
      console.error('[Parcelles] facturation', error);
      box.innerHTML = String(html`<p class="bh-empty">Affichage impossible : ${error.message}</p>`);
    }
  }
  // Compteur de l'onglet « À faire » : texte et nom accessible à jour, retiré à zéro.
  function updateBadge() {
    const t = doc.getElementById('bh-tab-afaire');
    if (!t) return;
    const count = safeTodo().count;
    let badge = t.querySelector('.bh-count');
    if (!count) { badge?.remove(); return; }
    if (!badge) { badge = doc.createElement('span'); badge.className = 'bh-count'; t.append(badge); }
    badge.textContent = String(count);
    badge.setAttribute('aria-label', plural(count, 'élément', 'éléments'));
  }
  // Saisies non enregistrées : les formulaires marqués data-bh-guard gardent leur état initial ; quitter
  // (onglet, section, retour) demande confirmation s'il a changé.
  const formState = form => JSON.stringify([...new FormData(form)].filter(([k, v]) => typeof v === 'string' && k !== 'previewType'));
  function markForms(box) { box.querySelectorAll('form[data-bh-guard]').forEach(f => { if (f.dataset.bhInitial === undefined) f.dataset.bhInitial = formState(f); }); }
  function leaveOk() {
    const form = panel()?.querySelector('form[data-bh-guard]');
    if (!form || form.dataset.bhInitial === undefined || formState(form) === form.dataset.bhInitial) return true;
    const ok = globalThis.confirm?.('Modifications non enregistrées. Les abandonner ?') ?? true;
    if (!ok) form.querySelector('input:not([type="hidden"]),select,textarea')?.focus();
    return ok;
  }

  // ——— Suivi ———
  const filterAttr = f => JSON.stringify(f || {});
  function renderDashboard(box) {
    const d = hubDashboard(data(), {today: today(), ...filters});
    const clients = active(data(), 'clients').filter(c => !c.archived).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
    const maxAged = Math.max(1, ...d.aged.map(a => a.amount));
    box.innerHTML = String(html`<form class="bh-filters" data-bh-form="filters" aria-label="Filtres du tableau de bord">
        <div class="field-label"><span id="bh-period-label">Période</span><input type="hidden" name="period" value="${filters.period}"><div class="chip-choices" data-chip-target="period" aria-labelledby="bh-period-label">${PERIODS.map(([k, l]) => html`<button type="button" class="choice-chip${k === filters.period ? ' is-on' : ''}" data-value="${k}" aria-pressed="${k === filters.period}">${l}</button>`)}</div></div>
        <label class="bh-client-filter">Client<select name="clientId"><option value="">Tous les clients</option>${clients.map(c => html`<option value="${c.id}"${c.id === filters.clientId ? raw(' selected') : ''}>${c.name}</option>`)}</select></label><button type="button" class="text-button bh-all" data-bh="list" data-doc="all" data-filter="${filterAttr(filters.clientId ? {clientId: filters.clientId} : {})}">Toutes les pièces</button></form>
      <div class="bh-kpis">${d.kpis.map(k => html`<button type="button" class="bh-kpi${k.tone ? ` is-${k.tone}` : ''}" data-bh="list" data-doc="${k.link[0]}" data-filter="${filterAttr(k.link[1])}" data-kpi="${k.key}"><span class="bh-kpi-label">${k.label}</span><strong class="bh-kpi-value">${k.value}</strong><small>${k.hint}</small></button>`)}</div>
      <section class="bh-card" aria-labelledby="bh-ca-title"><div class="bh-card-head"><h3 id="bh-ca-title">Chiffre d’affaires par mois</h3><p class="bh-legend" aria-hidden="true"><span class="bh-key is-invoiced"></span>Facturé HT <span class="bh-key is-collected"></span>Encaissé</p></div>
        ${raw(revenueChartSvg(d.series))}
        <details class="bh-figures"><summary>Voir les chiffres</summary><table class="bh-table"><caption class="sr-only">Chiffre d’affaires mensuel</caption><thead><tr><th scope="col">Mois</th><th scope="col" class="n">Facturé HT</th><th scope="col" class="n">Encaissé</th><th scope="col" class="n">Pièces</th></tr></thead><tbody>${d.series.map(r => html`<tr><th scope="row">${monthLabel(r.month)}</th><td class="n">${money(r.invoicedHt)}</td><td class="n">${money(r.collected)}</td><td class="n">${r.count}</td></tr>`)}</tbody><tfoot><tr><th scope="row">Total</th><td class="n">${money(d.totals.invoicedHt)}</td><td class="n">${money(d.totals.collected)}</td><td class="n">${d.totals.count}</td></tr></tfoot></table></details></section>
      <div class="bh-grid2">
        <section class="bh-card" aria-labelledby="bh-aged-title"><div class="bh-card-head"><h3 id="bh-aged-title">Balance âgée</h3><strong>${moneyShort(d.agedTotal)}</strong></div>
          <ul class="bh-rows">${d.aged.map(a => html`<li><button type="button" class="bh-row" data-bh="list" data-doc="facture" data-filter="${filterAttr(a.link[1])}"><span>${a.label}</span><span class="bh-meter" aria-hidden="true"><i style="width:${Math.round(a.amount / maxAged * 100)}%" class="${a.key === 'aEchoir' ? '' : 'is-late'}"></i></span><strong>${moneyShort(a.amount)}</strong></button></li>`)}</ul></section>
        <section class="bh-card" aria-labelledby="bh-top-title"><div class="bh-card-head"><h3 id="bh-top-title">Meilleurs clients</h3><small>HT sur la période</small></div>
          ${d.top.length ? html`<ul class="bh-rows">${d.top.map(c => html`<li><button type="button" class="bh-row" ${c.clientId ? raw(`data-bh="client" data-id="${String(html`${c.clientId}`)}"`) : raw(`data-bh="list" data-doc="all" data-filter="${String(html`${filterAttr(c.link[1])}`)}"`)}><span>${c.name}</span><small>${c.due ? `${moneyShort(c.due)} dû${c.late ? `, dont ${moneyShort(c.late)} en retard` : ''}` : 'à jour'}</small><strong>${moneyShort(c.invoicedHt)}</strong></button></li>`)}</ul>` : html`<p class="bh-empty">Aucune facture émise sur la période.</p>`}</section>
      </div>
      <section class="bh-card" aria-labelledby="bh-fc-title"><div class="bh-card-head"><h3 id="bh-fc-title">Encaissements attendus</h3><strong>${moneyShort(d.forecast.next4)} sur 4 semaines</strong></div>
        ${raw(forecastChartSvg(d.forecast.weeks))}
        <details class="bh-figures"><summary>Voir les semaines</summary><table class="bh-table"><caption class="sr-only">Encaissements attendus par semaine</caption><thead><tr><th scope="col">Semaine du</th><th scope="col" class="n">Attendu</th><th scope="col" class="n">Dont retard</th></tr></thead><tbody>${d.forecast.weeks.map(w => html`<tr><th scope="row">${dateFr(w.week)}</th><td class="n">${money(w.amount)}</td><td class="n">${w.late ? money(w.late) : '—'}</td></tr>`)}</tbody></table></details>
        <p class="bh-note">Ces montants alimentent le prévisionnel de trésorerie (reste dû par échéance, paiements partiels et avoirs déduits). <button type="button" class="text-button" data-action="open-treasury">Voir la trésorerie</button></p></section>
      <section class="bh-card" aria-labelledby="bh-exp-title"><div class="bh-card-head"><h3 id="bh-exp-title">Exports comptables</h3><small>Pièces émises du ${dateFr(d.from)} au ${dateFr(d.today)}, tous clients</small></div>
        <div class="bh-actions"><button type="button" class="button secondary" data-bh="export-fec" data-from="${d.from}" data-to="${d.today}">Journal des ventes (FEC)</button><button type="button" class="button secondary" data-bh="export-csv" data-from="${d.from}" data-to="${d.today}">Lignes facturées (CSV)</button><button type="button" class="text-button" data-action="open-accounting-export">Pour mon comptable</button></div>
        <p class="bh-note">${FEC_DISCLAIMER}</p></section>`);
    const form = box.querySelector('[data-bh-form="filters"]');
    bindChipChoices(form);
    form.querySelector('.chip-choices')?.addEventListener('click', event => { if (event.target.closest('.choice-chip')) { filters = {...filters, period: form.elements.period.value}; renderDashboard(box); box.querySelector(`.choice-chip[data-value="${filters.period}"]`)?.focus(); } });
    form.elements.clientId.addEventListener('change', () => { filters = {...filters, clientId: form.elements.clientId.value}; renderDashboard(box); box.querySelector('select[name="clientId"]')?.focus(); });
    form.addEventListener('submit', event => event.preventDefault());
  }

  // ——— À faire ———
  function renderTodo(box) {
    const t = safeTodo(), w = canWrite('invoice');
    const section = (title, count, body, id) => html`<section class="bh-card" aria-labelledby="bh-todo-${id}"><div class="bh-card-head"><h3 id="bh-todo-${id}">${title}</h3><span class="bh-count">${count}</span></div>${body}</section>`;
    const parts = [];
    if (t.reminders.length) parts.push(section('Factures à relancer', t.reminders.length, html`<ul class="bh-todo">${t.reminders.map(g => html`<li class="bh-todo-item"><div class="bh-todo-main"><strong>${g.name}</strong><small>${plural(g.items.length, 'facture', 'factures')} · ${money(g.total)} · jusqu’à ${g.maxDays}${' '}j de retard</small>
        <ul class="bh-docs">${g.items.map(i => html`<li><button type="button" class="text-button" data-bh="doc" data-id="${i.invoice.id}">${i.invoice.number}</button> échéance ${dateFr(i.invoice.dueDate)} · ${money(i.due)} · relance ${i.level} due</li>`)}</ul></div>
        <div class="bh-todo-actions"><span class="bh-pill is-${g.level >= 3 ? 'bad' : 'warn'}">Relance ${g.level}${g.items.length > 1 ? ' groupée' : ''}</span>${w ? html`<button type="button" class="button primary" data-bh="remind" data-key="${g.key}">Relancer</button>` : ''}</div></li>`)}</ul>`, 'relances'));
    if (t.quotes.length) parts.push(section('Devis à suivre', t.quotes.length, html`<ul class="bh-todo">${t.quotes.map(q => html`<li class="bh-todo-item"><div class="bh-todo-main"><strong>${q.quote.clientName || 'Client'} · devis ${q.quote.number || ''}</strong><small>${q.expiring ? (q.days < 0 ? 'expiré' : q.days === 0 ? 'expire aujourd’hui' : `expire dans ${plural(q.days, 'jour', 'jours')}`) : `envoyé il y a ${plural(q.days, 'jour', 'jours')}, sans réponse`} · ${money(Math.abs(q.quote.totals?.ttc || 0))} TTC</small></div>
        <div class="bh-todo-actions"><button type="button" class="button secondary" data-bh="doc" data-id="${q.quote.id}">Ouvrir</button>${w ? html`<button type="button" class="button primary" data-bh="quote-follow" data-id="${q.quote.id}">Relancer</button>` : ''}</div></li>`)}</ul>`, 'devis'));
    if (t.unbilled.length) parts.push(section('Prestations réalisées non facturées', t.unbilled.length, html`<ul class="bh-todo">${t.unbilled.map(u => html`<li class="bh-todo-item"><div class="bh-todo-main"><strong>${u.client.name}</strong><small>${plural(u.count, 'prestation', 'prestations')} depuis le ${dateFr(u.oldest)} · ${money(u.amountHt)} HT${u.unpriced ? ` · ${u.unpriced} sans prix` : ''}</small></div>
        <div class="bh-todo-actions">${w ? html`<button type="button" class="button primary" data-bh="bill-client" data-id="${u.client.id}">Créer la facture</button>` : ''}</div></li>`)}</ul>`, 'oublis'));
    if (t.recurring.length) parts.push(section('Factures récurrentes dues', t.recurring.length, html`<ul class="bh-todo">${t.recurring.map(r => html`<li class="bh-todo-item"><div class="bh-todo-main"><strong>${r.schedule.label}</strong><small>${r.client.name} · échéance du ${dateFr(r.dates[0])}${r.dates.length > 1 ? ` · ${r.dates.length} périodes en attente` : ''}</small></div>
        <div class="bh-todo-actions">${w ? html`<button type="button" class="button primary" data-bh="rec-generate" data-id="${r.schedule.id}">Préparer le brouillon</button>` : ''}</div></li>`)}</ul>`, 'recurrences'));
    if (t.duplicates.length) parts.push(section('Doublons probables', t.duplicates.length, html`<ul class="bh-todo">${t.duplicates.map(d => html`<li class="bh-todo-item"><div class="bh-todo-main"><strong>${d.reason}</strong><small><button type="button" class="text-button" data-bh="doc" data-id="${d.a.id}">${d.a.number || `${DOC_LABELS[d.a.docType] || 'Document'} (brouillon)`}</button> et <button type="button" class="text-button" data-bh="doc" data-id="${d.b.id}">${d.b.number || `${DOC_LABELS[d.b.docType] || 'Document'} (brouillon)`}</button></small></div>
        <div class="bh-todo-actions"><button type="button" class="button secondary" data-bh="dup-ignore" data-key="${dupKey(d)}">Ce n’est pas un doublon</button></div></li>`)}</ul>`, 'doublons'));
    if (t.risky.length) parts.push(section('Clients à surveiller', t.risky.length, html`<ul class="bh-todo">${t.risky.map(r => html`<li class="bh-todo-item"><div class="bh-todo-main"><strong>${r.name}</strong><small>${RISK_LABELS[r.level]} · ${plural(r.overdue, 'facture en retard', 'factures en retard')}${r.overdueAmount ? ` (${money(r.overdueAmount)})` : ''} · ${plural(r.paidLate, 'paiement tardif', 'paiements tardifs')}, ${r.averageLateDays}${' '}j en moyenne</small></div>
        <div class="bh-todo-actions">${r.clientKey.startsWith('nom:') ? '' : html`<button type="button" class="button secondary" data-bh="client" data-id="${r.clientKey}">Fiche</button>`}</div></li>`)}</ul>`, 'risque'));
    box.innerHTML = String(parts.length ? html`<p class="bh-lead">${t.count ? `${plural(t.count, 'point', 'points')} à traiter${t.lateTotal ? ` · ${money(t.lateTotal)} en retard` : ''}.` : 'Aucune action urgente.'} Rien ne part sans votre confirmation.</p>${parts}` : html`<div class="bh-empty-state"><strong>Tout est à jour.</strong><p>Aucune relance due, aucun devis en attente, aucune prestation oubliée.</p></div>`);
  }

  // Composeur fermé par Échap : la promesse se résout pendant la touche, avant l'événement « cancel » de la
  // fenêtre native, qui refermerait aussitôt le centre rouvert. On reprend à la tâche suivante.
  const afterClose = () => new Promise(resolve => setTimeout(resolve, 0));
  async function remindGroup(key) {
    const group = safeTodo().reminders.find(g => g.key === key);
    if (!group) { toast('Cette relance n’est plus due.', 'info'); paint(); return; }
    let msg;
    try { msg = groupedReminderMessage(data(), group.items.map(i => i.invoice), {level: group.level, today: today()}); } catch (error) { toast(error.message, 'error'); return; }
    if (!msg.recipients.length) toast('Client sans e-mail ni téléphone : choisissez le destinataire dans le message.', 'info');
    const messaging = await host.messaging?.();
    if (!messaging) { toast('Messagerie indisponible pour le moment.', 'error'); return; }
    const result = await messaging.openComposer({recipients: msg.recipients, channel: channelOf(msg), subject: msg.subject, templateKey: msg.templateKey, body: msg.body, context: msg.context});
    await afterClose();
    const save = async channel => {
      const before = group.items.map(i => ({id: i.invoice.id, reminders: [...(store.get('integrationImports', i.invoice.id)?.reminders || [])], sentLog: [...(store.get('integrationImports', i.invoice.id)?.sentLog || [])]}));
      for (const i of group.items) await recordReminder(store, i.invoice.id, {level: i.level, date: today(), channel, recipients: msg.recipients, fee: i.fee, recordId: result?.recordId || null});
      toast(`Relance enregistrée sur ${plural(group.items.length, 'facture', 'factures')}.`, 'success', {label: 'Annuler', run: async () => { for (const b of before) await patchEmitted(store, b.id, {reminders: b.reminders, sentLog: b.sentLog}, {label: 'Relance annulée'}); toast('Relance retirée des factures.'); if (doc.getElementById('bh-panel')) paint(); }});
    };
    try {
      if (result?.sent) await save(result.channel || 'email');
      else toast('Message préparé mais non confirmé : rien n’est noté sur les factures.', 'info', {label: 'Noter comme envoyée', run: () => save(result?.channel || 'email').catch(error => toast(error.message, 'error'))});
    } catch (error) { toast(error.message, 'error'); }
    open('afaire');
  }
  async function followQuote(id) {
    const quote = store.get('integrationImports', id);
    if (!quote) return;
    let msg;
    try { msg = quoteFollowUpMessage(data(), quote, {today: today()}); } catch (error) { toast(error.message, 'error'); return; }
    const messaging = await host.messaging?.();
    if (!messaging) { toast('Messagerie indisponible pour le moment.', 'error'); return; }
    const result = await messaging.openComposer({recipients: msg.recipients, channel: channelOf(msg), subject: msg.subject, templateKey: msg.templateKey, body: msg.body, context: msg.context});
    await afterClose();
    if (result?.sent) { try { await logSent(store, id, {date: today(), channel: result.channel || 'email', recipients: msg.recipients, purpose: 'suivi', recordId: result.recordId}); toast('Suivi du devis noté.'); } catch (error) { toast(error.message, 'error'); } }
    open('afaire');
  }
  function billClient(clientId) {
    const b = clientBilling(data(), clientId, {today: today()});
    if (!b.unbilled.count) { toast('Plus rien à facturer pour ce client.', 'info'); return; }
    openNew({docType: 'facture', clientId, lines: b.unbilled.lines, extra: {}});
  }

  // Exports de la période du tableau de bord : journal façon FEC (lettré, encaissements) et CSV par ligne.
  function exportBooks(kind, from, to) {
    const period = {from, to}, name = `${from}_${to}`;
    if (kind === 'fec') download(`journal-ventes-${name}.txt`, billingFecText(data(), period), 'text/plain;charset=utf-8');
    else download(`factures-lignes-${name}.csv`, billingLinesCsv(data(), period), 'text/csv;charset=utf-8');
    toast(kind === 'fec' ? 'Journal des ventes exporté.' : 'Lignes facturées exportées.', 'success');
  }

  // ——— Clients ———
  let clientQuery = '', lastClient = '';
  function renderClients(box) {
    const list = clientsOverview(data(), {today: today(), query: clientQuery});
    const addClient = canMutate(role(), {entity: 'clients', action: 'create'}) && !store.tabReadOnly;
    box.innerHTML = String(html`<div class="bh-client-tools"><form class="bh-search" role="search" data-bh-form="clients"><label>Rechercher un client<input type="search" name="q" value="${clientQuery}" autocomplete="off"></label></form>${addClient ? html`<button type="button" class="button secondary" data-bh="client-new">+ Nouveau client</button>` : ''}</div>
      ${list.length ? html`<ul class="bh-rows bh-client-list">${list.map(c => html`<li><button type="button" class="bh-row" data-bh="client" data-id="${c.id}"><span><strong>${c.name}</strong><small>${plural(c.docs, 'pièce', 'pièces')}${c.unbilled ? ` · ${plural(c.unbilled, 'prestation à facturer', 'prestations à facturer')}` : ''}</small></span>${c.risk !== 'faible' ? pill(c.risk === 'eleve' ? 'retard' : 'brouillon', RISK_LABELS[c.risk]) : ''}<span class="bh-amounts"><strong>${c.due ? moneyShort(c.due) : 'À jour'}</strong>${c.late ? html`<small class="is-late">${moneyShort(c.late)} en retard</small>` : ''}</span></button></li>`)}</ul>` : html`<p class="bh-empty">${clientQuery ? 'Aucun client ne correspond.' : 'Aucun client pour le moment.'}</p>`}`);
    const input = box.querySelector('input[name="q"]');
    input.addEventListener('input', () => { clientQuery = input.value; const pos = input.selectionStart; renderClients(box); const again = box.querySelector('input[name="q"]'); again.focus(); again.setSelectionRange(pos, pos); });
    box.querySelector('form').addEventListener('submit', event => event.preventDefault());
  }
  function clientSheetHtml(clientId, {compact = false} = {}) {
    const b = clientBilling(data(), clientId, {today: today()}), w = canWrite('invoice');
    if (!b.client) return html`<p class="bh-empty">Client introuvable.</p>`;
    const figures = [['Solde dû', moneyShort(b.due), b.due ? ['facture', {clientId, status: 'due'}] : null], ['En retard', moneyShort(b.late), b.late ? ['facture', {clientId, status: 'retard'}] : null], ['Facturé HT (12 mois)', moneyShort(b.invoiced12), ['all', {clientId}]], ['Délai moyen de paiement', b.averageDays === null ? '—' : `${b.averageDays} j`, null]];
    return html`<div class="bh-client-sheet">
      <div class="bh-kpis is-small">${figures.map(([label, value, link]) => link ? html`<button type="button" class="bh-kpi" data-bh="list" data-doc="${link[0]}" data-filter="${filterAttr(link[1])}"><span class="bh-kpi-label">${label}</span><strong class="bh-kpi-value">${value}</strong></button>` : html`<div class="bh-kpi"><span class="bh-kpi-label">${label}</span><strong class="bh-kpi-value">${value}</strong></div>`)}</div>
      <p class="bh-risk">${pill(b.risk.level === 'eleve' ? 'retard' : b.risk.level === 'moyen' ? 'brouillon' : 'payee', RISK_LABELS[b.risk.level])} ${b.risk.invoices ? `${b.risk.overdue ? `${plural(b.risk.overdue, 'facture en retard', 'factures en retard')} · ` : ''}${plural(b.risk.paidLate, 'paiement tardif', 'paiements tardifs')} sur ${plural(b.risk.invoices, 'facture', 'factures')}` : 'Aucune facture émise.'}${b.openQuotes ? ` · ${plural(b.openQuotes, 'devis en attente', 'devis en attente')}` : ''}${b.schedules.length ? ` · ${plural(b.schedules.length, 'facturation récurrente', 'facturations récurrentes')}` : ''}</p>
      ${w ? html`<div class="bh-actions"><button type="button" class="button secondary" data-bh="new" data-doc="devis" data-client="${clientId}">Nouveau devis</button><button type="button" class="button primary" data-bh="new" data-doc="facture" data-client="${clientId}">Nouvelle facture</button>${b.unbilled.count ? html`<button type="button" class="button secondary" data-bh="bill-client" data-id="${clientId}">Facturer ${plural(b.unbilled.count, 'prestation', 'prestations')} (${moneyShort(b.unbilled.amountHt)} HT)</button>` : ''}${b.lateCount ? html`<button type="button" class="button secondary" data-bh="remind-client" data-id="${clientId}">Relancer</button>` : ''}</div>` : ''}
      <h3 class="bh-h">Documents</h3>
      ${b.rows.length ? html`<ul class="bh-rows">${b.rows.slice(0, compact ? 6 : 30).map(r => html`<li><button type="button" class="bh-row" data-bh="doc" data-id="${r.id}"><span><strong>${r.label} ${r.number}</strong><small>${dateFr(r.date)}</small></span>${pill(r.status, r.statusLabel)}<strong>${money(r.ttc)}</strong></button></li>`)}</ul>${b.rows.length > (compact ? 6 : 30) ? html`<button type="button" class="text-button" data-bh="list" data-doc="all" data-filter="${filterAttr({clientId})}">Voir les ${b.rows.length} pièces</button>` : ''}` : html`<p class="bh-empty">Aucun document pour ce client.</p>`}</div>`;
  }
  function openClient(clientId) {
    const c = store.get('clients', clientId);
    if (!c || !visible()) return;
    if (!panel()) open('clients');
    tab = 'clients'; lastClient = clientId;
    panelView = box => { box.innerHTML = String(html`<button type="button" class="text-button bh-back" data-bh="back">‹ Tous les clients</button><h3 class="bh-title">${c.name}</h3>${clientSheetHtml(clientId)}`); };
    paint();
    panel()?.focus();
  }
  // Section « Facturation » de la fiche client (app.js, openClientDetail).
  function clientSection(el, clientId) {
    if (!el) return;
    if (!visible()) { el.hidden = true; return; }
    install();
    el.hidden = false;
    el.innerHTML = String(html`<h3>Facturation</h3>${clientSheetHtml(clientId, {compact: true})}<button type="button" class="text-button" data-bh="open-client" data-id="${clientId}">Ouvrir dans le centre Facturation</button>`);
  }

  // ——— Délégué ———
  async function onClick(event) {
    const el = event.target.closest('[data-bh]');
    if (!el || el.disabled) return;
    const a = el.dataset.bh, id = el.dataset.id || '';
    try {
      // Quitter un formulaire par un onglet, une section ou le lien de retour (pas son bouton Annuler).
      if ((a === 'tab' || a === 'set-section' || a === 'back') && !el.closest('form[data-bh-guard]') && !leaveOk()) return;
      if (a === 'tab') selectTab(el.dataset.value);
      else if (a === 'back') { const from = tab === 'clients' && panelView ? lastClient : ''; panelView = null; paint(); if (from) panel()?.querySelector(`[data-bh="client"][data-id="${CSS.escape(from)}"]`)?.focus(); }
      else if (a === 'list') openList(el.dataset.doc || 'all', el.dataset.filter ? JSON.parse(el.dataset.filter) : {});
      else if (a === 'doc') openDocument(id);
      else if (a === 'new') openNew({docType: el.dataset.doc || 'facture', ...(el.dataset.client ? {clientId: el.dataset.client} : {})});
      else if (a === 'client') openClient(id);
      else if (a === 'client-new') await withDocs(d => d.openClientForm?.({onSaved: c => { open('clients'); openClient(c.id); }, onCancel: () => open('clients')}));
      else if (a === 'open-client') open('clients') || openClient(id);
      else if (a === 'remind') await remindGroup(el.dataset.key);
      else if (a === 'remind-client') { const g = safeTodo().reminders.find(x => x.clientId === id); if (g) await remindGroup(g.key); else toast('Aucune relance due pour ce client (délai du prochain niveau non atteint).', 'info'); }
      else if (a === 'quote-follow') await followQuote(id);
      else if (a === 'bill-client') billClient(id);
      else if (a === 'export-fec' || a === 'export-csv') exportBooks(a === 'export-fec' ? 'fec' : 'csv', el.dataset.from || '', el.dataset.to || today());
      else if (a === 'dup-ignore') { const key = el.dataset.key, list = readDismissed(); writeDismissed([...list, key]); paint(); toast('Doublon ignoré.', 'success', {label: 'Annuler', run: () => { writeDismissed(readDismissed().filter(k => k !== key)); if (panel()) paint(); }}); }
      else if (a.startsWith('cat-') || a.startsWith('rec-')) await catalog.handle(a, el, event);
      else if (a.startsWith('set-')) await settings.handle(a, el, event);
    } catch (error) {
      console.error('[Parcelles] facturation', error);
      toast(error?.message || 'Action impossible.', 'error');
    }
  }
  function onKey(event) {
    const t = event.target.closest?.('.bh-tab');
    if (!t || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    // Écouteur en capture : le gestionnaire global des onglets (app.js) ne reçoit pas la touche et ne
    // déplace pas le focus sur un autre onglet que celui sélectionné ici.
    event.preventDefault(); event.stopPropagation();
    if (!leaveOk()) return;
    const keys = HUB_TABS.map(([k]) => k), i = keys.indexOf(t.dataset.value);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
    selectTab(keys[next], {focus: true});
  }
  function install() {
    if (installed) return;
    installed = true;
    doc.addEventListener('click', event => { onClick(event); });
    doc.addEventListener('keydown', onKey, true);
  }

  const api = {
    open,
    openSettings: (section = '') => open('reglages', {section}),
    openClient: id => { open('clients'); openClient(id); },
    clientSection,
    newInvoice: clientId => (clientId ? billClientOrNew(clientId) : openNew({docType: 'facture'})),
    // Tests et outils : vues de l’instance.
    get tab() { return tab; }, $
  };
  current = api;
  return api;
  function billClientOrNew(clientId) {
    const b = clientBilling(data(), clientId, {today: today()});
    return openNew({docType: 'facture', clientId, ...(b.unbilled.count ? {lines: b.unbilled.lines} : {})});
  }
}
