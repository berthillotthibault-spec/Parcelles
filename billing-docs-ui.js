// Documents de facturation (v13, chantier A) : listes par type, fiche d'un document émis, éditeur et actions.
// Module différé (clé « billingDocs » de lazy-modules.js). createBillingDocsUI(host) renvoie
// {openDocument(id), openNew({docType, clientId, lines, fromQuoteId, extra}), openList(type, {filter}), openPayment(id), openSend(id, {purpose})}.
// host est facultatif : ce qui manque est lu dans le contexte partagé d'app.js (app-context.js : store, modal,
// closeModal, toast, lazy, messaging). Le tableau de bord (clé « billingHub », chantier B) n'est appelé que par
// lazy.load('billingHub') puis open(tab) ; s'il manque, un message « écran indisponible » le remplace.
// Boutons repérés par data-bdoc : un seul écouteur délégué pour tout le module (les boutons affichés hors du module,
// fiche client par exemple, chargent le module par LAZY_TRIGGERS puis rejouent le clic).
import {ctx} from './app-context.js';
import {LAZY_MODULES} from './lazy-modules.js';
import {canSeeBilling} from './permissions.js';
import {html, raw} from './safe-html.js';
import {DOC_LABELS, STATUS_LABELS, DOC_TYPES, docTypeOf, isoDay, invoiceSettings, numberingIssues, settingsReady, dateFr} from './invoices.js';
import {LIST_TYPES, STATUS_FILTERS, SORTS, docRows, filterRows, filterClients, listSummary, rowActions, actionLabel, newLabel, money, plural, docAdvice, listTypeLabel} from './billing-docs-view.js';
import {createDocsEditor} from './billing-docs-editor.js';
import {createDocsActions} from './billing-docs-actions.js';
import {loadSheet} from './lazy-styles.js';

// Feuille des documents, hors d'index.html : le module n'est livré (lazy.load) qu'une fois la feuille appliquée.
await loadSheet('billing-docs.css');

const FINANCE = new Set(['invoice', 'quote']);
const TYPE_KEYS = new Set(LIST_TYPES.map(([k]) => k));
const LIST_PREF = 'parcelles:billing-docs:list';
const readPref = () => { try { return JSON.parse(globalThis.localStorage?.getItem(LIST_PREF) || '{}') || {}; } catch { return {}; } };
const writePref = v => { try { globalThis.localStorage?.setItem(LIST_PREF, JSON.stringify(v)); } catch { /* stockage indisponible : préférence non gardée */ } };

// Pastilles de choix (repli si l'hôte ne fournit pas bindChipChoices) : même comportement que celui d'app.js.
function bindChipsFallback(root) {
  root?.querySelectorAll('.chip-choices[data-chip-target]').forEach(group => {
    const input = root.querySelector(`input[name="${group.dataset.chipTarget}"]`);
    if (!group.hasAttribute('role')) group.setAttribute('role', 'group');
    group.querySelectorAll('.choice-chip:not([aria-pressed])').forEach(c => c.setAttribute('aria-pressed', String(c.classList.contains('is-on'))));
    group.addEventListener('click', event => {
      const chip = event.target.closest('.choice-chip'); if (!chip || !input) return;
      input.value = chip.dataset.value;
      group.querySelectorAll('.choice-chip').forEach(c => { const on = c === chip; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', String(on)); });
      root.querySelector('.form-error')?.classList.add('hidden');
    });
  });
}

/** Pastille de statut calculé (styles .inv-pill de design-v3.css). */
export const statusPill = status => html`<span class="inv-pill is-${status}">${STATUS_LABELS[status] || status}</span>`;
/** Groupe de pastilles à choix unique relié à un champ caché (bindChipChoices). */
export function chipGroup(name, list, value, label, {extra = ''} = {}) {
  return html`<input type="hidden" name="${name}" value="${value ?? ''}"><div class="chip-choices${extra ? ` ${extra}` : ''}" data-chip-target="${name}" role="group" aria-label="${label}">${list.map(([v, l]) => html`<button type="button" class="choice-chip${String(v) === String(value ?? '') ? ' is-on' : ''}" data-value="${v}" aria-pressed="${String(String(v) === String(value ?? ''))}">${l}</button>`)}</div>`;
}
/** Message d'erreur en ligne d'un formulaire (.form-error), champ en cause marqué et focalisé. */
export function showFormError(form, message, field = null) {
  const box = form?.querySelector('.form-error');
  form?.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));
  if (box) { box.textContent = message; box.classList.remove('hidden'); }
  const el = typeof field === 'string' ? form?.querySelector(`[name="${field}"]`) : field;
  if (el) { el.setAttribute('aria-invalid', 'true'); el.focus?.({preventScroll: false}); }
  else box?.scrollIntoView?.({block: 'nearest'});
  return null;
}
export const clearFormError = form => { form?.querySelector('.form-error')?.classList.add('hidden'); form?.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid')); };

let current = null;
const instance = () => current || (createBillingDocsUI(), current);
// Une instance par hôte : un appelant qui recrée l'interface à chaque ouverture retrouve la même (écouteurs uniques).
const byHost = new WeakMap();

export function createBillingDocsUI(host = {}) {
  if (byHost.has(host)) { current = byHost.get(host).ui; return byHost.get(host).api; }
  const get = key => host[key] ?? ctx[key];
  const listState = {type: 'facture', filter: {}, ...readPref()};
  if (!TYPE_KEYS.has(listState.type)) listState.type = 'facture';
  listState.filter = {sort: listState.filter?.sort || 'recent'};
  let hubUI = null;
  // Longues listes : lignes calculées une fois par ouverture, puis filtrées ; rendu par pages de PAGE lignes.
  const PAGE = 50;
  let rowCache = null, shown = PAGE;
  const allRows = () => {
    const data = ui.state(), t = listState.type, n = (data.integrationImports || []).length;
    if (!rowCache || rowCache.data !== data || rowCache.type !== t || rowCache.n !== n) rowCache = {data, type: t, n, rows: docRows(data, t)};
    return rowCache.rows;
  };
  // Liste filtrée sur un client qui a une fiche : « Nouvelle … » prépare le document pour lui.
  const clientOfFilter = () => { const k = String(listState.filter.client || ''); return k && !k.startsWith('nom:') && ui.store()?.get('clients', k) ? k : ''; };
  const currentRows = () => filterRows(allRows(), listState.filter);
  const clientName = key => filterClients(ui.state(), listState.type, key).find(c => c.key === key)?.name || '';

  const ui = {
    host,
    store: () => get('store'),
    state: () => { const s = get('store'); return s?.state || s?.snapshot?.() || {}; },
    settings: () => invoiceSettings(ui.state()),
    today: () => isoDay(),
    modal: (...args) => get('modal')(...args),
    closeModal: () => get('closeModal')?.(),
    toast: (...args) => get('toast')?.(...args),
    lazy: () => get('lazy'),
    bindChips: root => (host.bindChipChoices || ctx.bindChipChoices || bindChipsFallback)(root),
    role: () => globalThis.document?.documentElement?.dataset.role || 'owner',
    // Comme billingHubUI.open : lecteur et opérateur terrain n'ouvrent ni la liste ni la fiche d'un document.
    seesBilling: () => canSeeBilling(ui.role()),
    denied: () => { ui.toast('La facturation est réservée à la gestion et à la comptabilité.', 'info'); },
    canWrite: (kind = 'invoice', action = 'update') => { const s = ui.store(); return !s?.writeGuard || Boolean(s.writeGuard({entity: 'integrationImports', action, farmKind: kind})); },
    canWriteClients: () => { const s = ui.store(); return !s?.writeGuard || Boolean(s.writeGuard({entity: 'clients', action: 'update'})); },
    doc: id => { const d = id ? ui.store()?.get('integrationImports', id) : null; return d && !d.deletedAt && FINANCE.has(d.farmKind) ? d : null; },
    hubAvailable: () => Boolean(LAZY_MODULES.billingHub),
    handlers: {},
    listState,
    // Composeur de messages (messaging-ui.js, différé) : hôte, sinon contexte d'app.js.
    async messaging() {
      try {
        if (typeof host.messaging === 'function') return await host.messaging();
        if (typeof ctx.messaging === 'function') return await ctx.messaging();
      } catch (error) { console.warn('[Parcelles] messagerie indisponible', error); }
      return null;
    },
    // Tableau de bord de la facturation (chantier B) : chargé à la demande, sinon message clair.
    async hub(tab = 'dashboard') {
      try {
        const lazy = ui.lazy();
        if (!lazy || !LAZY_MODULES.billingHub) throw Error('Module billingHub absent');
        const m = await lazy.load('billingHub');
        if (typeof m.open === 'function') return await m.open(tab);
        hubUI ??= m.createBillingHubUI(host);
        return await hubUI.open(tab);
      } catch (error) {
        console.warn('[Parcelles] tableau de bord de la facturation indisponible', error);
        ui.toast(tab === 'settings' ? 'Écran indisponible : les paramètres de facturation n’ont pas pu s’ouvrir. Vérifiez la connexion puis réessayez.' : 'Écran indisponible : le tableau de bord de la facturation n’a pas pu s’ouvrir.', 'error');
        return null;
      }
    },
    // Exécute une action d'écriture : message d'erreur lisible plutôt qu'une exception.
    async run(fn, {fallback = 'Action impossible.'} = {}) {
      try { return await fn(); } catch (error) { ui.toast(error?.message || fallback, 'error'); return undefined; }
    },
    focusSoon(selector) { setTimeout(() => globalThis.document?.querySelector(selector)?.focus?.({preventScroll: false}), 30); },
    openList, openDocument, openNew: o => editor.openNew(o), openEditor: (id, o) => editor.open(id, o),
    statusPill, chipGroup, showFormError, clearFormError
  };
  const editor = createDocsEditor(ui);
  const actions = createDocsActions(ui);
  ui.editor = editor; ui.actions = actions;
  current = ui;

  // ---------- Liste ----------
  function filterCount(f) { return ['status', 'client', 'from', 'to', 'min', 'max'].filter(k => f[k] && f[k] !== 'all').length; }
  function rowHtml(row, write) {
    const d = row.doc, meta = [
      row.draft ? `préparé, daté du ${dateFr(row.issueDate)}` : dateFr(row.issueDate),
      row.type === 'devis' && row.validUntil && !row.draft ? `valable jusqu’au ${dateFr(row.validUntil)}` : '',
      ['facture', 'acompte'].includes(row.type) && row.dueDate && !row.draft && row.status !== 'payee' && row.status !== 'annulee' ? `échéance ${dateFr(row.dueDate)}` : '',
      row.lateDays ? `retard ${plural(row.lateDays, 'jour', 'jours')}` : '',
      d.subject ? d.subject : ''
    ].filter(Boolean).join(' · ');
    const quick = write ? rowActions(ui.state(), d, {canWrite: true}) : [];
    const label = `${row.typeLabel} ${row.number || (row.draft ? 'en brouillon' : '')}, ${row.clientName}, ${money(row.ttc)} TTC, ${row.statusLabel}`;
    return html`<li class="bd-row is-${row.status}">
      <button type="button" class="bd-row-main" data-bdoc="open" data-id="${row.id}" aria-label="${label}">
        <span class="bd-row-title"><strong>${row.title}</strong>${listState.type === 'all' ? html`<span class="bd-row-type">${row.typeLabel}</span>` : ''}</span>
        <span class="bd-row-client">${row.clientName}</span>
        <span class="bd-row-meta">${meta}</span>
      </button>
      <span class="bd-row-end"><strong class="bd-row-amount">${money(row.ttc)}</strong>${row.due !== null && row.due > 0.005 && row.due < Math.abs(row.ttc) - 0.005 ? html`<small>reste ${money(row.due)}</small>` : ''}${statusPill(row.status)}</span>
      ${quick.length ? html`<span class="bd-row-actions">${quick.map(k => html`<button type="button" class="small-button" data-bdoc="act" data-act="${k}" data-id="${row.id}" aria-label="${`${actionLabel(k, d, ui.state())} : ${row.title} (${row.clientName})`}">${actionLabel(k, d, ui.state())}</button>`)}</span>` : ''}
    </li>`;
  }
  function rowsHtml(rows, write) {
    if (rows.length) {
      const rest = rows.length - shown;
      return html`${rows.slice(0, shown).map(r => rowHtml(r, write))}${rest > 0 ? html`<li class="bd-more"><button type="button" class="button secondary" data-bdoc="more">${`Afficher plus (${plural(rest, 'document restant', 'documents restants')})`}</button></li>` : ''}`;
    }
    const f = listState.filter, only = f.client && filterCount(f) === 1 && !String(f.query || '').trim() ? clientName(f.client) : '';
    if (only) return html`<li class="bd-empty empty-state">${`Aucun document pour ${only}${listState.type === 'all' ? '' : ` (${listTypeLabel(listState.type).toLowerCase()})`}.`}</li>`;
    const any = allRows().length;
    return html`<li class="bd-empty empty-state">${any ? 'Aucun document ne correspond à ces critères.' : listState.type === 'devis' ? 'Aucun devis pour l’instant : un devis accepté se convertit ensuite en acompte ou en facture, sans ressaisie.' : 'Aucun document pour l’instant.'}</li>`;
  }
  function summaryText(sum) {
    const parts = [plural(sum.count, 'document', 'documents'), `${money(sum.ttc)} TTC`];
    if (sum.due > 0.005) parts.push(`reste dû ${money(sum.due)}`);
    if (sum.late) parts.push(`${plural(sum.late, 'en retard', 'en retard')} (${money(sum.lateDue)})`);
    if (sum.drafts) parts.push(plural(sum.drafts, 'brouillon', 'brouillons'));
    return parts.join(' · ');
  }
  function openList(type = listState.type, {filter = null, focus = null} = {}) {
    if (!ui.seesBilling()) return ui.denied();
    if (editor.isOpen()) editor.flush();
    listState.type = TYPE_KEYS.has(type) ? type : 'facture';
    if (filter) listState.filter = {sort: listState.filter.sort || 'recent', ...filter};
    writePref({type: listState.type, filter: {sort: listState.filter.sort}});
    rowCache = null; shown = PAGE;
    const data = ui.state(), write = ui.canWrite(), f = listState.filter, t = listState.type;
    const rows = currentRows(), sum = listSummary(rows), clients = filterClients(data, t, f.client), issues = numberingIssues(data);
    const statuses = STATUS_FILTERS[t] || STATUS_FILTERS.all, nf = filterCount(f);
    const body = html`<div class="bd-screen bd-list-screen">
      ${settingsReady(data) ? '' : html`<div class="notice warning bd-notice"><p>Complétez vos paramètres de facturation (raison sociale, adresse, SIRET) avant d’émettre un document.</p>${ui.hubAvailable() && write ? html`<button type="button" class="small-button" data-bdoc="hub" data-tab="settings">Paramètres</button>` : ''}</div>`}
      ${issues.duplicates.length ? html`<div class="notice danger bd-notice"><p>Numéro${issues.duplicates.length > 1 ? 's' : ''} en double : ${issues.duplicates.join(', ')}. Annulez le doublon par un avoir.</p></div>` : ''}
      ${write ? '' : html`<p class="notice info bd-notice">Consultation seule : votre rôle ne permet pas de créer ni de modifier les documents de facturation.</p>`}
      <div class="bd-types chip-choices" role="group" aria-label="Type de document">${LIST_TYPES.map(([k, l]) => html`<button type="button" class="choice-chip${k === t ? ' is-on' : ''}" data-bdoc="type" data-type="${k}" aria-pressed="${String(k === t)}">${l}</button>`)}</div>
      ${write ? html`<form class="bd-quick" id="bd-quick-list" novalidate><label class="bd-quick-label">Saisie rapide<input name="quick" autocomplete="off" placeholder="devis Dupont 3 h de pelle à 65 € et 12 t de cailloux à 18 €" aria-describedby="bd-quick-help"></label><button type="button" class="button secondary" data-bdoc="quick-new">Préparer</button><small id="bd-quick-help">Écrivez comme vous parlez : les lignes proposées sont à valider dans le brouillon.</small></form>` : ''}
      <div class="bd-toolbar">
        <label class="bd-search">Rechercher<input type="search" name="q" value="${f.query || ''}" autocomplete="off" placeholder="Numéro, client, désignation, montant"></label>
        <label class="bd-sort">Trier<select name="sort">${SORTS.map(([k, l]) => html`<option value="${k}"${raw((f.sort || 'recent') === k ? ' selected' : '')}>${l}</option>`)}</select></label>
      </div>
      <details class="bd-filters"${raw(nf ? ' open' : '')}><summary>Filtres${nf ? ` (${nf})` : ''}</summary>
        <div class="bd-status chip-choices" role="group" aria-label="Statut">${statuses.map(([k, l]) => html`<button type="button" class="choice-chip${(f.status || 'all') === k ? ' is-on' : ''}" data-bdoc="status" data-value="${k}" aria-pressed="${String((f.status || 'all') === k)}">${l}</button>`)}</div>
        <div class="bd-filter-grid">
          <label>Client<select name="client"><option value="">Tous les clients</option>${clients.map(c => html`<option value="${c.key}"${raw(f.client === c.key ? ' selected' : '')}>${c.name}</option>`)}</select></label>
          <label>Du<input type="date" name="from" value="${f.from || ''}"></label><label>Au<input type="date" name="to" value="${f.to || ''}"></label>
          <label>Montant min. (€ TTC)<input name="min" inputmode="decimal" value="${f.min ?? ''}"></label><label>Montant max. (€ TTC)<input name="max" inputmode="decimal" value="${f.max ?? ''}"></label>
        </div>
        <button type="button" class="small-button" data-bdoc="clear-filters">Effacer les filtres</button>
      </details>
      <p class="bd-count" id="bd-count" role="status">${summaryText(sum)}</p>
      <ul class="bd-rows" id="bd-rows" aria-label="${listTypeLabel(t)}">${rowsHtml(rows, write)}</ul>
    </div>`;
    const creatable = t === 'all' || t === 'acompte' || t === 'avoir' ? 'facture' : t;
    const forClient = clientOfFilter();
    const footer = html`${ui.hubAvailable() ? html`<button type="button" class="button secondary" data-bdoc="hub" data-tab="dashboard">Tableau de bord</button>` : ''}${write ? html`<button type="button" class="button primary" data-bdoc="new" data-type="${creatable}" data-client="${forClient}">${newLabel(creatable)}</button>` : ''}`;
    ui.modal(listTypeLabel(t) === 'Tout' ? 'Documents de facturation' : listTypeLabel(t), t === 'acompte' ? 'Un acompte se crée depuis un devis accepté.' : t === 'avoir' ? 'Un avoir se crée depuis la facture à corriger.' : 'Recherche, filtres et actions rapides', String(body), String(footer), 'large bd-modal');
    bindList();
    if (focus) ui.focusSoon(focus);
  }
  function bindList() {
    const root = globalThis.document?.querySelector('.bd-list-screen'); if (!root) return;
    let timer = null;
    const refresh = ({more = false} = {}) => {
      if (!more) shown = PAGE;
      const add = globalThis.document?.querySelector('[data-bdoc="new"][data-client]'); if (add) add.dataset.client = clientOfFilter();
      const rows = currentRows(), list = root.querySelector('#bd-rows'), count = root.querySelector('#bd-count');
      if (list) list.innerHTML = String(rowsHtml(rows, ui.canWrite()));
      if (count) count.textContent = summaryText(listSummary(rows));
      const n = filterCount(listState.filter), s = root.querySelector('.bd-filters summary'); if (s) s.textContent = `Filtres${n ? ` (${n})` : ''}`;
      writePref({type: listState.type, filter: {sort: listState.filter.sort}});
    };
    root.addEventListener('input', event => {
      const el = event.target, name = el.name; if (!name || name === 'quick') return;
      if (name === 'q') listState.filter.query = el.value; else listState.filter[name] = el.value;
      clearTimeout(timer); timer = setTimeout(refresh, name === 'q' ? 120 : 0);
    });
    root.addEventListener('change', event => { const el = event.target; if (el.name && el.name !== 'quick' && el.name !== 'q') { listState.filter[el.name] = el.value; refresh(); } });
    root.querySelector('#bd-quick-list')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); root.querySelector('[data-bdoc="quick-new"]')?.click(); } });
    ui.refreshList = refresh;
  }

  // ---------- Fiche d'un document ----------
  function openDocument(id) {
    if (!ui.seesBilling()) return ui.denied();
    const d = ui.doc(id);
    if (!d) { ui.toast('Document introuvable : il a peut-être été supprimé.', 'error'); return openList(); }
    if (d.status === 'brouillon' && ui.canWrite(d.farmKind)) return editor.open(id);
    return actions.view(id);
  }

  // ---------- Délégué de clics ----------
  Object.assign(ui.handlers, {
    list: c => openList(c.dataset.type || listState.type, {filter: c.dataset.client ? {client: c.dataset.client} : null}),
    type: c => openList(c.dataset.type, {focus: `.bd-types [data-type="${c.dataset.type}"]`}),
    more: () => { const from = shown; shown += PAGE; ui.refreshList?.({more: true}); ui.focusSoon(`#bd-rows > li:nth-child(${from + 1}) .bd-row-main, #bd-rows .bd-row-main`); },
    status: c => { listState.filter.status = c.dataset.value; c.parentElement.querySelectorAll('.choice-chip').forEach(x => { const on = x === c; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); }); ui.refreshList?.(); },
    'clear-filters': () => { listState.filter = {sort: listState.filter.sort || 'recent'}; openList(undefined, {focus: '.bd-filters summary'}); },
    open: c => openDocument(c.dataset.id),
    back: () => openList(),
    hub: c => ui.hub(c.dataset.tab || 'dashboard'),
    new: c => editor.openNew({docType: c.dataset.type || 'facture', clientId: c.dataset.client || ''}),
    'quick-new': () => {
      const input = globalThis.document?.querySelector('#bd-quick-list [name="quick"]'), value = input?.value.trim();
      if (!value) { input?.focus(); ui.toast('Écrivez par exemple « devis Dupont 3 h de pelle à 65 € ».', 'info'); return; }
      editor.openNew({quick: value});
    },
    act: c => actions.run(c.dataset.act, c.dataset.id)
  });
  const api = {
    openDocument, openList,
    openNew: (options = {}) => editor.openNew(options),
    openPayment: id => actions.run('pay', id),
    openSend: (id, {purpose = 'envoi'} = {}) => actions.send(id, {purpose}),
    openEditor: id => editor.open(id),
    // Fiche de facturation d'un client (création si id absent) ; onSaved(client) / onCancel() au retour.
    openClientForm: (options = {}) => actions.clientForm(options)
  };
  // Feuille en échec au chargement du module : nouvel essai à chaque ouverture (sans effet si déjà liée).
  for (const [name, fn] of Object.entries(api)) api[name] = (...args) => { loadSheet('billing-docs.css'); return fn(...args); };
  byHost.set(host, {ui, api});
  return api;
}

// Raccourcis du module, pour un appelant qui ne garde pas d'instance : (await lazy.load('billingDocs')).openDocument(id).
export const openDocument = id => instance().openDocument(id);
export const openList = (type, options) => instance().openList(type, options);
export const openNew = options => instance().openNew(options);
export const openPayment = id => instance().actions.run('pay', id);
export const openSend = (id, options = {}) => instance().actions.send(id, options);
export const openClientForm = (options = {}) => instance().actions.clientForm(options);
export {clientBillingValues} from './billing-docs-view.js';

// Un seul écouteur pour tout le module : les instances successives partagent l'instance courante.
if (globalThis.document && !globalThis.__parcellesBillingDocs) {
  globalThis.__parcellesBillingDocs = true;
  document.addEventListener('click', event => {
    const control = event.target?.closest?.('[data-bdoc]');
    if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true') return;
    const ui = instance(), fn = ui.handlers[control.dataset.bdoc];
    if (!fn) return;
    event.preventDefault();
    Promise.resolve().then(() => fn(control, event)).catch(error => ui.toast(error?.message || 'Action impossible.', 'error'));
  });
}
export {DOC_TYPES, DOC_LABELS, docTypeOf, docAdvice};
