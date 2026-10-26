// Éditeur de documents de facturation (v13, chantier A) : devis, facture, pro forma, acompte et avoir en brouillon.
// L'état de l'éditeur (ed) est la source de vérité : chaque saisie le met à jour, rafraîchit totaux, sous-totaux et
// conformité, puis le brouillon est enregistré automatiquement (saveDraft, après 700 ms de calme). Une copie de la
// saisie reste sur l'appareil (form-drafts.js) tant qu'elle n'est pas enregistrée : fermeture, appel, application
// suspendue ou client encore à choisir ne font rien perdre (« Reprendre la saisie » à la réouverture).
import {html, raw} from './safe-html.js';
import {DOC_LABELS, UNITS, MORE_UNITS, VAT_EXEMPTIONS, OPERATION_NATURES, vatRatesOf, addDays, daysBetween, validDay, createDraft, saveDraft, deleteDraft,
  runningSubtotals, lineKind} from './invoices.js';
import {catalogItems, catalogLine, convertQuote, createDepositInvoice} from './billing.js';
import {parseQuickEntry} from './billing-insights.js';
import {invoiceHtmlWithQr} from './billing-export.js';
import {draftKey, readDraft, writeDraft, removeDraft, draftTimeLabel} from './form-drafts.js';
import {showPrintable, assetBase} from './dossier-ui.js';
import {EDITABLE_TYPES, TERM_CHOICES, VALIDITY_CHOICES, editorState, draftValues, workingDoc, applyClient, catalogMatches, billablePicks, priceHint, clientBalance,
  fuzzyClients, complianceItems, newLine, moveLine, duplicateLine, removeLine, lineAmount, discountInvalid, restoreEditor, termOf, money, rateLabel, plural, newLabel, actionLabel, isQuoteType, newLineId} from './billing-docs-view.js';

const SAVE_DELAY = 700;
const ALL_UNITS = [...UNITS, ...MORE_UNITS];
const WIDE = '(min-width: 1180px)';
const PREVIEW_PREF = 'parcelles:billing-docs:preview';
const prefPreview = () => { try { return globalThis.localStorage?.getItem(PREVIEW_PREF) !== 'off'; } catch { return true; } };
const setPrefPreview = on => { try { globalThis.localStorage?.setItem(PREVIEW_PREF, on ? 'on' : 'off'); } catch { /* préférence non gardée */ } };
const wide = () => { try { return globalThis.matchMedia?.(WIDE).matches || false; } catch { return false; } };
const hhmm = at => { const d = new Date(at), p = n => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; };
const noToolbar = doc => String(doc).replace('</head>', '<style>.dz-toolbar,#print{display:none!important}body{margin:0}</style></head>');
const $ = (sel, root = globalThis.document) => root?.querySelector(sel) || null;

export function createDocsEditor(ui) {
  let ed = null, stored = null, dirty = false, timer = null, liveTimer = null, previewTimer = null, saving = null, observer = null;
  let panel = '', quick = null, clientOpen = false, clientIndex = -1, showPreview = prefPreview(), prevClient = null;
  const CLIENT_KEYS = ['clientId', 'clientName', 'clientAddress', 'clientSiren', 'clientVat', 'clientKind', 'clientEmail', 'clientPhone'];

  const settings = () => ui.settings();
  const customRates = () => settings().customVatRates || [];
  const backupKey = () => draftKey('billing-doc', ed?.id || `nouveau-${ed?.docType || 'facture'}`);
  const work = () => workingDoc(ed, {stored, customRates: customRates()});
  const form = () => $('#bd-editor');
  const isOpen = () => Boolean(form());

  // ---------- Ouverture ----------
  function open(id, {focus = null} = {}) {
    const d = ui.doc(id);
    if (!d) { ui.toast('Brouillon introuvable : il a peut-être été supprimé.', 'error'); return ui.openList(); }
    if (d.status !== 'brouillon' || !ui.canWrite(d.farmKind)) return ui.actions.view(id);
    if (!ed || ed.id !== id || !dirty) { ed = editorState(d, {settings: settings()}); dirty = false; panel = ''; quick = null; prevClient = null; }
    stored = d;
    render({focus});
  }
  // Document neuf : rien n'est écrit tant que le client n'est pas choisi et qu'aucune saisie n'a eu lieu.
  async function openNew({docType = 'facture', clientId = '', lines = null, fromQuoteId = null, extra = {}, quick: quickText = ''} = {}) {
    if (isOpen()) await flush();
    if (!ui.canWrite(isQuoteType(docType) ? 'quote' : 'invoice', 'create')) { ui.toast('Votre rôle ne permet pas de créer de document de facturation.', 'info'); return; }
    if (fromQuoteId) {
      const made = await ui.run(() => docType === 'acompte' ? createDepositInvoice(ui.store(), fromQuoteId, {percent: extra?.percent ?? settings().depositPct, amount: extra?.amount ?? null}) : convertQuote(ui.store(), fromQuoteId));
      if (made) open(made.id);
      return;
    }
    if (docType === 'avoir' && extra?.creditOf) return ui.actions.run('credit', extra.creditOf);
    const type = EDITABLE_TYPES.some(([k]) => k === docType) ? docType : 'facture';
    ed = editorState({docType: type}, {settings: settings()}); stored = null; dirty = false; panel = ''; quick = null; prevClient = null;
    for (const k of ['subject', 'reference', 'note', 'deliveryDate', 'deliveryAddress', 'terms']) if (extra?.[k]) ed[k] = String(extra[k]);
    if (Array.isArray(lines) && lines.length) { ed.lines = lines.map(l => ({...l, id: newLineId()})); dirty = true; }
    const client = clientId ? ui.store()?.get('clients', clientId) : null;
    if (client) ed = applyClient(ed, client, {settings: settings(), fresh: true});
    if (quickText) runQuick(quickText, {apply: true});
    render({focus: ed.clientName ? (ed.lines.length ? null : '[data-bdoc="line-add"]') : '#bd-client-q'});
    prefillClientQuery();
    if (dirty) schedule();
  }

  // ---------- Rendu ----------
  function render({focus = null} = {}) {
    const w = work(), t = ed.docType, title = ed.id ? `${DOC_LABELS[t]} en brouillon` : newLabel(t);
    const desc = ed.clientName ? `${ed.clientName} · modifiable jusqu’à l’émission` : 'Choisissez le client, puis ajoutez les lignes';
    const preview = wide() && showPreview;
    const body = html`<div class="bd-editor-layout${preview ? ' has-preview' : ''}">
      <form id="bd-editor" class="bd-editor" novalidate data-type="${t}">
        <p class="bd-save-state" id="bd-save-state" role="status">${ed.id ? 'Brouillon enregistré.' : 'Nouveau document : il sera enregistré dès le client choisi.'}</p>
        <div id="bd-resume"></div>
        ${headHtml()}
        ${datesHtml()}
        ${coordsHtml()}
        <section class="bd-sec" aria-labelledby="bd-lines-h"><h3 class="bd-h3" id="bd-lines-h">Lignes</h3>
          ${quickHtml()}
          <ol class="bd-lines" id="bd-lines" aria-labelledby="bd-lines-h">${linesInner()}</ol>
          <div id="bd-addbar">${addBarHtml()}</div>
          <div id="bd-panel">${panelHtml()}</div>
        </section>
        ${adjustHtml()}
        <section class="bd-sec" aria-labelledby="bd-totals-h"><h3 class="bd-h3" id="bd-totals-h">Totaux</h3><div id="bd-totals">${totalsHtml(w.doc)}</div></section>
        ${notesHtml()}
        <div id="bd-compliance">${complianceHtml(w)}</div>
        <p class="form-error hidden" role="alert"></p>
      </form>
      ${preview ? html`<aside class="bd-preview" aria-label="Aperçu du document"><iframe class="bd-preview-frame" title="${`Aperçu : ${DOC_LABELS[t]} en brouillon`}" sandbox="allow-same-origin"></iframe></aside>` : ''}
    </div>`;
    const footer = html`<button type="button" class="button secondary" data-bdoc="editor-back">Retour</button>${ed.id ? html`<button type="button" class="button danger" data-bdoc="draft-delete">Supprimer</button>` : ''}<button type="button" class="button secondary" data-bdoc="preview" aria-pressed="${wide() ? String(showPreview) : 'false'}">Aperçu</button><button type="button" class="button primary" data-bdoc="emit">${actionLabel('emit', {docType: t})}…</button>`;
    ui.modal(title, desc, String(body), String(footer), `large bd-modal${preview ? ' bd-wide' : ''}`);
    bind();
    offerResume();
    if (preview) refreshPreview(0);
    if (focus) ui.focusSoon(focus);
  }
  function headHtml() {
    const t = ed.docType, data = ui.state();
    const typeChoice = !ed.id && EDITABLE_TYPES.some(([k]) => k === t) ? html`<div class="bd-field"><span class="bd-label" id="bd-type-l">Type de document</span>${ui.chipGroup('docType', EDITABLE_TYPES, t, 'Type de document')}</div>` : '';
    const link = ed.creditOf ? html`<p class="bd-link-note">Avoir sur la facture <button type="button" class="text-button" data-bdoc="open" data-id="${ed.creditOf}">${ed.creditOfNumber || 'd’origine'}</button>.</p>`
      : ed.quoteId ? html`<p class="bd-link-note">Issu du devis <button type="button" class="text-button" data-bdoc="open" data-id="${ed.quoteId}">${ed.quoteNumber || 'd’origine'}</button>.</p>` : '';
    let client;
    if (ed.clientName) {
      const bal = ed.clientId ? clientBalance(data, ed.clientId) : null, c = ed.clientId ? ui.store()?.get('clients', ed.clientId) : null;
      const ids = [ed.clientSiren && `SIREN ${ed.clientSiren}`, ed.clientVat && `TVA ${ed.clientVat}`, ed.clientEmail].filter(Boolean).join(' · ');
      const fixed = t === 'avoir' || Boolean(ed.quoteId);
      client = html`<div class="bd-client-card"><div class="bd-client-id"><small>${t === 'avoir' ? 'Avoir pour' : 'Client'}</small><strong>${ed.clientName}</strong>${ed.clientAddress ? html`<small>${ed.clientAddress.replace(/\s*\n\s*/g, ', ')}</small>` : html`<small class="bd-missing">Adresse de facturation à compléter</small>`}${ids ? html`<small>${ids}</small>` : ''}
        ${bal && bal.open ? html`<small class="bd-client-balance${bal.late ? ' is-late' : ''}">Encours : ${money(bal.due)}${bal.late ? ` · ${plural(bal.late, 'facture en retard', 'factures en retard')}` : ''}</small>` : ''}</div>
        <div class="bd-client-tools">${c && ui.canWriteClients() ? html`<button type="button" class="small-button" data-bdoc="client-edit">Fiche de facturation</button>` : ''}${fixed ? '' : html`<button type="button" class="small-button" data-bdoc="client-change">Changer</button>`}</div></div>`;
    } else client = clientPickerHtml();
    return html`<section class="bd-sec" aria-labelledby="bd-head-h"><h3 class="bd-h3" id="bd-head-h">Document</h3>${typeChoice}${link}${client}
      <div class="bd-grid-2"><label>Objet<input name="subject" maxlength="200" value="${ed.subject}" placeholder="Ex. Terrassement de la cour"></label><label>Référence du client<input name="reference" maxlength="200" value="${ed.reference}" placeholder="Bon de commande, n° de dossier…"></label></div></section>`;
  }
  function clientPickerHtml() {
    const keep = prevClient?.clientName ? html`<button type="button" class="small-button" data-bdoc="client-keep">${`Garder ${prevClient.clientName}`}</button>` : '';
    return html`<div class="bd-client-picker"><div class="bd-client-label"><label for="bd-client-q">Client *</label>${keep}${ui.canWriteClients() ? html`<button type="button" class="small-button" data-bdoc="client-new">+ Nouveau client</button>` : ''}</div>
      <div class="bd-combo"><input id="bd-client-q" name="clientQuery" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="bd-client-list" autocomplete="off" placeholder="Nom, SIREN, e-mail, commune…" aria-describedby="bd-client-help">
      <ul id="bd-client-list" class="bd-client-list" role="listbox" aria-label="Clients" hidden></ul></div>
      <small id="bd-client-help">Les fautes de frappe et les initiales sont reconnues.</small></div>`;
  }
  function clientOptions(query) {
    const data = ui.state(), list = fuzzyClients((data.clients || []).filter(c => !c.deletedAt), query, {limit: 8});
    return list.map((c, i) => { const b = clientBalance(data, c.id), place = String(c.billingAddress || c.address || '').split('\n').pop();
      return html`<li role="option" id="bd-client-opt-${i}" class="bd-client-opt${i === clientIndex ? ' is-active' : ''}" aria-selected="${String(i === clientIndex)}" data-bdoc="client-pick" data-id="${c.id}"><strong>${c.name}</strong><small>${[place, c.siren && `SIREN ${c.siren}`, b.open ? `encours ${money(b.due)}` : ''].filter(Boolean).join(' · ')}</small></li>`; });
  }
  function renderClientList(query) {
    const list = $('#bd-client-list'), input = $('#bd-client-q'); if (!list || !input) return;
    const options = clientOptions(query), q = String(query || '').trim();
    // Dernière option : créer la fiche avec le nom tapé (ou le signaler si aucun client ne correspond).
    const create = q && ui.canWriteClients() ? html`<li role="option" id="bd-client-opt-${options.length}" class="bd-client-opt is-create${clientIndex === options.length ? ' is-active' : ''}" aria-selected="${String(clientIndex === options.length)}" data-bdoc="client-new"><strong>${options.length ? `Créer « ${q} »` : `Aucun client trouvé : créer « ${q} »`}</strong><small>Nouvelle fiche avec SIREN, TVA et adresse de facturation</small></li>` : '';
    list.innerHTML = String(html`${options}${create}`);
    const show = clientOpen && (options.length > 0 || Boolean(create));
    list.hidden = !show; input.setAttribute('aria-expanded', String(show));
    if (clientIndex >= 0 && show) input.setAttribute('aria-activedescendant', `bd-client-opt-${clientIndex}`); else input.removeAttribute('aria-activedescendant');
  }
  function datesHtml() {
    const t = ed.docType, quote = isQuoteType(t);
    const validity = t === 'devis' && validDay(ed.validUntil) && validDay(ed.issueDate) ? daysBetween(ed.issueDate, ed.validUntil) : '';
    return html`<fieldset class="bd-sec bd-fieldset"><legend class="bd-h3">Dates et conditions</legend>
      <div class="bd-grid-2"><label>Date d’émission *<input type="date" name="issueDate" value="${ed.issueDate}"></label><label>Livraison ou prestation<input type="date" name="deliveryDate" value="${ed.deliveryDate}" aria-describedby="bd-delivery-help"></label></div>
      <small id="bd-delivery-help" class="bd-help">Date de la vente ou de la fin de la prestation, si elle diffère de la date d’émission.</small>
      ${!quote && t !== 'avoir' ? html`<div class="bd-field"><span class="bd-label">Délai de paiement</span>${ui.chipGroup('term', [...TERM_CHOICES, ['autre', 'Autre date']], ed.term ?? 'autre', 'Délai de paiement')}</div>
        <label class="bd-due">Échéance *<input type="date" name="dueDate" value="${ed.dueDate}"></label>` : ''}
      ${t === 'devis' ? html`<div class="bd-field"><span class="bd-label">Durée de validité</span>${ui.chipGroup('validity', VALIDITY_CHOICES.map(d => [d, `${d} jours`]), VALIDITY_CHOICES.includes(validity) ? validity : '', 'Durée de validité du devis')}</div>
        <label>Valable jusqu’au *<input type="date" name="validUntil" value="${ed.validUntil}"></label>` : ''}
    </fieldset>`;
  }
  function coordsHtml() {
    const missing = !ed.clientAddress || (ed.clientKind === 'pro' && !ed.clientSiren);
    return html`<details class="bd-sec bd-coords"${raw(missing && ed.clientName ? ' open' : '')}><summary class="bd-h3">Coordonnées du client sur ce document</summary>
      <div class="bd-grid-2"><label class="bd-span-2">Adresse de facturation *<textarea name="clientAddress" rows="2">${ed.clientAddress}</textarea></label>
      <label class="bd-span-2">Adresse de livraison<textarea name="deliveryAddress" rows="2" placeholder="Si elle diffère de l’adresse de facturation">${ed.deliveryAddress}</textarea></label>
      <div class="bd-field bd-span-2"><span class="bd-label">Type de client</span>${ui.chipGroup('clientKind', [['pro', 'Professionnel'], ['particulier', 'Particulier'], ['', 'Non précisé']], ed.clientKind, 'Type de client')}</div>
      <label>SIREN ou SIRET<input name="clientSiren" inputmode="numeric" value="${ed.clientSiren}" autocomplete="off"></label><label>N° de TVA intracommunautaire<input name="clientVat" value="${ed.clientVat}" autocomplete="off"></label>
      <label class="bd-span-2">E-mail de facturation<input type="email" name="clientEmail" value="${ed.clientEmail}" autocomplete="off"></label></div>
      <small class="bd-help">Ces coordonnées sont figées sur le document à l’émission ; la fiche du client n’est pas modifiée.</small></details>`;
  }
  function quickHtml() {
    return html`<details class="bd-quick-box" id="bd-quick-box"${raw(quick ? ' open' : '')}><summary>Saisie rapide</summary>
      <label>Décrivez les lignes<textarea name="quickText" rows="2" placeholder="3 h de pelle à 65 € ; 12 t de cailloux à 18 € HT">${quick?.input || ''}</textarea></label>
      <button type="button" class="small-button" data-bdoc="quick">Proposer les lignes</button>
      <div id="bd-quick-result" aria-live="polite">${quickResultHtml()}</div></details>`;
  }
  function quickResultHtml() {
    if (!quick) return '';
    const r = quick.result;
    return html`${r.warnings.length ? html`<ul class="bd-warnings">${r.warnings.map(w => html`<li>${w}</li>`)}</ul>` : ''}
      ${!ed.clientName && r.candidates.length > 1 ? html`<div class="bd-candidates" role="group" aria-label="Clients possibles">${r.candidates.slice(0, 5).map(c => html`<button type="button" class="small-button" data-bdoc="client-pick" data-id="${c.id}">${c.name}</button>`)}</div>` : ''}
      ${r.lines.length ? html`<fieldset class="bd-proposals"><legend>${plural(r.lines.length, 'ligne proposée', 'lignes proposées')}${r.client && !ed.clientName ? ` · client : ${r.client.name}` : ''}</legend>
        ${r.lines.map((l, i) => html`<label class="bd-proposal"><input type="checkbox" name="quickPick" value="${i}" checked><span><strong>${l.label}</strong><small>${String(l.quantity).replace('.', ',')} ${l.unit} × ${l.unitPrice === null ? 'prix à saisir' : money(l.unitPrice)} HT · TVA ${rateLabel(l.vatRate)} · ${l.basis}</small></span></label>`)}
        <button type="button" class="button secondary" data-bdoc="quick-apply">Ajouter les lignes cochées</button></fieldset>` : ''}`;
  }
  // Saisie rapide sans client reconnu : le nom tapé est repris dans la recherche, « Créer « … » » est à un appui.
  function prefillClientQuery(name = quick?.result?.clientQuery) {
    const input = $('#bd-client-q'); if (!input || ed?.clientName || !name || input.value) return;
    input.value = name; clientOpen = true; clientIndex = -1; renderClientList(name);
  }
  function runQuick(text, {apply = false} = {}) {
    const result = parseQuickEntry(text, ui.state());
    quick = {input: text, result};
    if (!ed.id && !result.docTypeGuessed && EDITABLE_TYPES.some(([k]) => k === result.docType)) { ed.docType = result.docType; if (ed.docType === 'devis' && !ed.validUntil) ed.validUntil = addDays(ed.issueDate, settings().quoteValidityDays); if (isQuoteType(ed.docType)) { ed.dueDate = ''; ed.term = null; } }
    if (apply && result.client && !ed.clientName) ed = applyClient(ed, result.client, {settings: settings(), fresh: !ed.id});
    return result;
  }

  // ---------- Lignes ----------
  const unitOptions = u => html`${(ALL_UNITS.some(([v]) => v === u) || !u ? ALL_UNITS : [...ALL_UNITS, [u, u]]).map(([v, l]) => html`<option value="${v}"${raw(v === (u || 'u') ? ' selected' : '')}>${l}</option>`)}`;
  const vatOptions = r => html`${vatRatesOf(settings()).map(v => html`<option value="${v}"${raw(Number(r) === v ? ' selected' : '')}>${rateLabel(v)}</option>`)}`;
  const exemptionOptions = x => html`<option value="">Choisir le motif…</option>${Object.entries(VAT_EXEMPTIONS).map(([k, v]) => html`<option value="${k}"${raw(x === k ? ' selected' : '')}>${v.label}</option>`)}`;
  function toolsHtml(i, count, n, {locked = false} = {}) {
    return html`<div class="bd-line-tools" role="group" aria-label="${`Ligne ${n}`}">
      <button type="button" class="icon-button bd-tool" data-bdoc="line-move" data-dir="-1" aria-label="${`Monter la ligne ${n}`}"${raw(i === 0 ? ' disabled' : '')}>&#8593;</button>
      <button type="button" class="icon-button bd-tool" data-bdoc="line-move" data-dir="1" aria-label="${`Descendre la ligne ${n}`}"${raw(i === count - 1 ? ' disabled' : '')}>&#8595;</button>
      ${locked ? '' : html`<button type="button" class="icon-button bd-tool" data-bdoc="line-dup" aria-label="${`Dupliquer la ligne ${n}`}">&#10697;</button><button type="button" class="icon-button bd-tool bd-tool-del" data-bdoc="line-del" aria-label="${`Supprimer la ligne ${n}`}">&#10005;</button>`}</div>`;
  }
  function lineHtml(l, i, subtotals, count) {
    const k = lineKind(l), n = i + 1, drag = html`<span class="bd-drag" draggable="true" title="Glisser pour déplacer" aria-hidden="true">&#10303;</span>`;
    if (k === 'section') return html`<li class="bd-line is-section" data-line="${l.id}"><div class="bd-line-head">${drag}<strong class="bd-line-no">Section</strong>${toolsHtml(i, count, n)}</div><label>Titre de section<input data-f="label" value="${l.label || ''}" maxlength="200" placeholder="Ex. Terrassement"></label></li>`;
    if (k === 'subtotal') return html`<li class="bd-line is-subtotal" data-line="${l.id}"><div class="bd-line-head">${drag}<strong class="bd-line-no">Sous-total</strong><span class="bd-line-amount" data-subtotal>${money(subtotals.get(l.id) ?? 0)} HT</span>${toolsHtml(i, count, n)}</div><label>Libellé<input data-f="label" value="${l.label || ''}" maxlength="200"></label></li>`;
    if (k === 'comment') return html`<li class="bd-line is-comment" data-line="${l.id}"><div class="bd-line-head">${drag}<strong class="bd-line-no">Commentaire</strong>${toolsHtml(i, count, n)}</div><label>Texte imprimé sur le document<textarea data-f="description" rows="2" maxlength="2000">${l.description || l.label || ''}</textarea></label></li>`;
    if (k === 'deduction') return html`<li class="bd-line is-deduction" data-line="${l.id}"><div class="bd-line-head">${drag}<strong class="bd-line-no">Acompte déduit</strong><span class="bd-line-amount">${money(lineAmount(l))} HT</span>${toolsHtml(i, count, n, {locked: true})}</div><p class="bd-line-text">${l.label}</p></li>`;
    const hint = priceHint(ui.state(), l, ed.clientId);
    const zero = Number(String(l.vatRate ?? '').replace(',', '.')) === 0;
    return html`<li class="bd-line" data-line="${l.id}"><div class="bd-line-head">${drag}<strong class="bd-line-no">Ligne ${n}</strong>${l.basis ? html`<small class="bd-basis">${l.basis}</small>` : ''}<span class="bd-line-amount" data-amount>${money(lineAmount(l))} HT</span>${toolsHtml(i, count, n)}</div>
      <div class="bd-line-grid">
        <label class="bd-f-label">Désignation *<input data-f="label" value="${l.label || ''}" maxlength="200"></label>
        <label class="bd-f-qty">Quantité<input data-f="quantity" inputmode="decimal" value="${l.quantity ?? ''}"></label>
        <label class="bd-f-unit">Unité<select data-f="unit">${unitOptions(l.unit)}</select></label>
        <label class="bd-f-price">Prix unitaire HT<input data-f="unitPrice" inputmode="decimal" value="${l.unitPrice ?? ''}" placeholder="À saisir"></label>
        <label class="bd-f-disc">Remise %<input data-f="discountPct" inputmode="decimal" value="${l.discountPct ?? ''}" aria-invalid="${String(discountInvalid(l.discountPct))}"></label>
        <label class="bd-f-vat">TVA<select data-f="vatRate">${vatOptions(l.vatRate)}</select></label>
        <label class="bd-f-exo"${raw(zero ? '' : ' hidden')}>Motif du taux 0 %<select data-f="vatExemption">${exemptionOptions(l.vatExemption)}</select></label>
      </div>
      <details class="bd-line-more"${raw(l.description || l.date ? ' open' : '')}><summary>Description et date</summary><div class="bd-grid-2"><label class="bd-span-2">Description<textarea data-f="description" rows="2" maxlength="2000">${l.description || ''}</textarea></label><label>Date de la prestation<input type="date" data-f="date" value="${l.date || ''}"></label></div></details>
      <p class="bd-hint" data-hint>${hint ? html`<span>Prix suggéré : ${hint.text}</span> <button type="button" class="text-button" data-bdoc="price-apply" data-price="${hint.price}">Appliquer</button>` : ''}</p></li>`;
  }
  function linesInner() {
    const lines = ed.lines, subs = runningSubtotals(lines);
    return lines.length ? html`${lines.map((l, i) => lineHtml(l, i, subs, lines.length))}` : html`<li class="bd-empty empty-state">Aucune ligne : ajoutez une prestation, un article du catalogue${ed.docType === 'facture' ? ' ou des travaux non facturés' : ''}.</li>`;
  }
  function addBarHtml() {
    const picks = billablePicks(ui.state(), ed), cat = catalogItems(ui.state()).length;
    return html`<div class="bd-add" role="group" aria-label="Ajouter au document">
      <button type="button" class="button secondary" data-bdoc="line-add" data-kind="item">+ Ligne</button>
      <button type="button" class="button secondary" data-bdoc="panel" data-panel="catalog" aria-expanded="${String(panel === 'catalog')}">Catalogue${cat ? ` (${cat})` : ''}</button>
      ${picks.length ? html`<button type="button" class="button secondary" data-bdoc="panel" data-panel="billable" aria-expanded="${String(panel === 'billable')}">Non facturé (${picks.length})</button>` : ''}
      <button type="button" class="small-button" data-bdoc="line-add" data-kind="section">Section</button><button type="button" class="small-button" data-bdoc="line-add" data-kind="subtotal">Sous-total</button><button type="button" class="small-button" data-bdoc="line-add" data-kind="comment">Commentaire</button></div>`;
  }
  function panelHtml() {
    if (panel === 'catalog') {
      const empty = !catalogItems(ui.state()).length;
      return html`<div class="bd-panel" role="region" aria-label="Catalogue"><div class="bd-panel-head"><strong>Catalogue</strong><button type="button" class="small-button" data-bdoc="panel" data-panel="">Fermer</button></div>
        ${empty ? html`<p class="bd-help">Catalogue vide : enregistrez vos prestations et articles habituels (code, prix, TVA, prix par client) pour les ajouter en un geste.${ui.hubAvailable() ? html` <button type="button" class="text-button" data-bdoc="hub" data-tab="catalog">Ouvrir le catalogue</button>` : ''}</p>`
        : html`<label>Rechercher par code ou désignation<input type="search" name="catalogQuery" autocomplete="off" placeholder="Ex. PEL ou pelle"></label><ul class="bd-pick-list" id="bd-cat-list">${catalogListHtml('')}</ul>`}</div>`;
    }
    if (panel === 'billable') {
      const picks = billablePicks(ui.state(), ed);
      return html`<div class="bd-panel" role="region" aria-label="Prestations non facturées"><div class="bd-panel-head"><strong>Travaux, chantiers et carburant non facturés</strong><button type="button" class="small-button" data-bdoc="panel" data-panel="">Fermer</button></div>
        ${picks.length ? html`<fieldset class="bd-proposals"><legend>${plural(picks.length, 'prestation', 'prestations')} au tarif du client</legend>${picks.map(it => { const a = lineAmount(it.line); return html`<label class="bd-proposal"><input type="checkbox" name="billPick" value="${it.key}" checked><span><strong>${it.line.label}</strong><small>${it.date ? new Date(`${String(it.date).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : ''} · ${a === null ? 'prix à saisir' : `${money(a)} HT`}</small></span></label>`; })}
          <button type="button" class="button secondary" data-bdoc="billable-add">Ajouter la sélection</button></fieldset>` : html`<p class="bd-help">Tout est déjà facturé.</p>`}</div>`;
    }
    return '';
  }
  function catalogListHtml(query) {
    const found = catalogMatches(ui.state(), query, {clientId: ed.clientId || null});
    return found.length ? html`${found.map(({item, price, basis}) => html`<li><button type="button" class="bd-pick" data-bdoc="catalog-pick" data-item="${item.id}"><strong>${item.label}</strong><small>${[item.code, item.unit, price === null ? 'prix à saisir' : `${money(price)} HT`, basis === 'Prix du client' ? 'prix du client' : ''].filter(Boolean).join(' · ')}</small></button></li>`)}`
      : html`<li class="bd-help">Aucun article ne correspond.</li>`;
  }
  function adjustHtml() {
    return html`<fieldset class="bd-sec bd-fieldset"><legend class="bd-h3">Remise globale et frais</legend>
      <div class="bd-grid-2"><div class="bd-field"><span class="bd-label">Remise sur le total</span>${ui.chipGroup('discountType', [['pct', 'En %'], ['amount', 'En € HT']], ed.discountType, 'Type de remise')}</div>
      <label>Remise<input name="discountValue" inputmode="decimal" value="${ed.discountValue ?? ''}" placeholder="0"></label>
      <label>Frais (port, déplacement)<input name="shippingLabel" maxlength="120" value="${ed.shippingLabel}"></label>
      <label>Montant des frais HT (€)<input name="shippingAmount" inputmode="decimal" value="${ed.shippingAmount ?? ''}" placeholder="0"></label>
      <label>TVA des frais<select name="shippingVat">${vatOptions(ed.shippingVat)}</select></label></div></fieldset>`;
  }
  const totalsHtml = doc => ui.actions.totalsHtml(doc);
  function notesHtml() {
    const t = ed.docType;
    return html`<section class="bd-sec" aria-labelledby="bd-notes-h"><h3 class="bd-h3" id="bd-notes-h">Mentions et notes</h3>
      <div class="bd-field"><span class="bd-label">Nature de l’opération</span>${ui.chipGroup('operationNature', [['', 'Selon les paramètres'], ...OPERATION_NATURES], ed.operationNature, 'Nature de l’opération')}</div>
      <label>Note imprimée<textarea name="note" rows="2" maxlength="1000">${ed.note}</textarea></label>
      ${isQuoteType(t) ? html`<label>Conditions particulières<textarea name="terms" rows="3" maxlength="4000" placeholder="Délais, modalités d’intervention, conditions de paiement…">${ed.terms}</textarea></label>` : ''}
      ${t === 'devis' ? html`<label class="bd-check"><input type="checkbox" name="goodForAgreement"${raw(ed.goodForAgreement ? ' checked' : '')}><span>Zone de signature « Bon pour accord » sur le devis</span></label>` : ''}</section>`;
  }
  function complianceHtml(w) {
    const c = complianceItems(ui.state(), w.doc), state = c.errors ? 'error' : c.warnings ? 'warn' : 'ok';
    const lead = c.errors ? `${plural(c.errors, 'point bloque', 'points bloquent')} l’émission${c.warnings ? `, ${plural(c.warnings, 'avertissement', 'avertissements')}` : ''}.` : c.warnings ? `Prêt à émettre, avec ${plural(c.warnings, 'avertissement', 'avertissements')}.` : 'Prêt à émettre : les mentions obligatoires sont présentes.';
    const fix = f => f ? html` <button type="button" class="small-button" data-bdoc="fix" data-fix-type="${f.type}" data-fix-field="${f.field || ''}" data-fix-index="${f.index ?? ''}">Corriger</button>` : '';
    return html`<section class="bd-compliance is-${state}" aria-labelledby="bd-comp-h"><h3 class="bd-h3" id="bd-comp-h">Conformité</h3><p class="bd-comp-lead">${lead}</p>
      ${w.error ? html`<p class="bd-comp-item is-error"><span class="bd-comp-tag">À corriger</span><span>${w.error}</span></p>` : ''}
      ${c.items.length ? html`<ul class="bd-comp-list">${c.items.map(i => html`<li class="bd-comp-item is-${i.level}"><span class="bd-comp-tag">${i.level === 'error' ? 'Bloquant' : 'À vérifier'}</span><span>${i.text}</span>${fix(i.fix)}</li>`)}</ul>` : ''}
      ${c.mentions?.length ? html`<details class="bd-mentions"><summary>Mentions imprimées (${c.mentions.length})</summary><ul>${c.mentions.map(m => html`<li>${m}</li>`)}</ul></details>` : ''}</section>`;
  }

  // ---------- Saisie ----------
  const TOP_FIELDS = new Set(['subject', 'reference', 'issueDate', 'deliveryDate', 'dueDate', 'validUntil', 'clientAddress', 'deliveryAddress', 'clientSiren', 'clientVat', 'clientEmail', 'discountValue', 'shippingLabel', 'shippingAmount', 'shippingVat', 'note', 'terms']);
  function bind() {
    const f = form(); if (!f) return;
    ui.bindChips(f);
    f.addEventListener('input', event => onField(event.target, false));
    f.addEventListener('change', event => onField(event.target, true));
    f.addEventListener('click', event => { const chip = event.target.closest('.choice-chip'), group = chip?.closest('[data-chip-target]'); if (chip && group) queueMicrotask(() => onChip(group.dataset.chipTarget, chip.dataset.value)); });
    f.addEventListener('keydown', onKey);
    f.addEventListener('focusout', event => { if (event.target.id === 'bd-client-q') setTimeout(() => { if (!$('#bd-client-list')?.contains(globalThis.document.activeElement)) { clientOpen = false; renderClientList($('#bd-client-q')?.value || ''); } }, 150); });
    f.addEventListener('focusin', event => { if (event.target.id === 'bd-client-q') { clientOpen = true; renderClientList(event.target.value); } });
    // Le champ garde le focus pendant le choix d'une option (combobox).
    f.querySelector('#bd-client-list')?.addEventListener('mousedown', event => event.preventDefault());
    bindDrag(f);
    watchClose();
  }
  function onKey(event) {
    const el = event.target;
    if (el.id === 'bd-client-q') {
      const n = $('#bd-client-list')?.querySelectorAll('[role="option"]').length || 0;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); clientOpen = true; clientIndex = n ? (clientIndex + (event.key === 'ArrowDown' ? 1 : -1) + n) % n : -1; renderClientList(el.value); }
      else if (event.key === 'Enter') { event.preventDefault(); const opt = $(`#bd-client-opt-${Math.max(0, clientIndex)}`); if (opt?.dataset.bdoc === 'client-new') opt.click(); else if (opt) pickClient(opt.dataset.id); }
      else if (event.key === 'Escape' && clientOpen) { event.stopPropagation(); event.preventDefault(); clientOpen = false; renderClientList(el.value); }
      return;
    }
    if (el.name === 'catalogQuery' && event.key === 'Enter') { event.preventDefault(); $('#bd-cat-list [data-bdoc="catalog-pick"]')?.click(); return; }
    if (el.name === 'quickText' && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('[data-bdoc="quick"]')?.click(); return; }
    // Alt + flèche sur un champ de ligne : déplace la ligne (alternative clavier au glisser-déposer).
    const li = el.closest?.('[data-line]');
    if (li && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); moveBy(li.dataset.line, event.key === 'ArrowUp' ? -1 : 1, `[data-line="${li.dataset.line}"] [data-f="${el.dataset.f || 'label'}"]`); }
  }
  function onField(el, committed) {
    if (!ed || !el) return;
    // Liste des clients : seulement à la frappe (le « change » du départ du champ la redessinerait sous le clic).
    if (el.id === 'bd-client-q') { if (!committed) { clientIndex = -1; clientOpen = true; renderClientList(el.value); } return; }
    if (el.name === 'catalogQuery') { const list = $('#bd-cat-list'); if (list && !committed) list.innerHTML = String(catalogListHtml(el.value)); return; }
    if (['quickText', 'quickPick', 'billPick', 'docType', 'term', 'validity', 'discountType', 'clientKind', 'operationNature'].includes(el.name)) return;
    const li = el.closest('[data-line]');
    if (li && el.dataset.f) {
      const l = ed.lines.find(x => x.id === li.dataset.line); if (!l) return;
      const fkey = el.dataset.f;
      l[fkey] = el.value;
      if (fkey === 'discountPct') el.setAttribute('aria-invalid', String(discountInvalid(el.value)));
      if (fkey === 'vatRate') { const exo = li.querySelector('.bd-f-exo'); if (exo) exo.hidden = Number(el.value) !== 0; }
      if (fkey === 'label' && committed) refreshHint(li, l);
      if (fkey === 'unitPrice' || fkey === 'unit') refreshHint(li, l);
    } else if (el.name === 'goodForAgreement') ed.goodForAgreement = el.checked;
    else if (TOP_FIELDS.has(el.name)) {
      ed[el.name] = el.value;
      if (el.name === 'issueDate' && validDay(el.value)) {
        if (typeof ed.term === 'number') { ed.dueDate = addDays(el.value, ed.term); const due = form()?.elements.dueDate; if (due) due.value = ed.dueDate; }
        if (ed.docType === 'devis') { const days = Number(form()?.elements.validity?.value); if (days) { ed.validUntil = addDays(el.value, days); const v = form()?.elements.validUntil; if (v) v.value = ed.validUntil; } }
      }
      if (el.name === 'dueDate') { ed.term = termOf(ed) ?? 'autre'; syncChips('term', ed.term); }
      if (el.name === 'validUntil') syncChips('validity', validDay(ed.validUntil) && validDay(ed.issueDate) ? daysBetween(ed.issueDate, ed.validUntil) : '');
    } else return;
    touch();
  }
  function onChip(name, value) {
    if (!ed) return;
    if (name === 'docType') {
      if (ed.id || ed.docType === value) return;
      ed = {...editorState({docType: value}, {settings: settings()}), ...pick(ed, ['clientId', 'clientName', 'clientAddress', 'clientSiren', 'clientVat', 'clientKind', 'clientEmail', 'clientPhone', 'deliveryAddress', 'subject', 'reference', 'note', 'lines', 'discountType', 'discountValue', 'shippingLabel', 'shippingAmount', 'shippingVat', 'issueDate', 'deliveryDate'])};
      if (!isQuoteType(value)) ed.dueDate = addDays(ed.issueDate, typeof ed.term === 'number' ? ed.term : settings().paymentDays);
      if (value === 'devis') ed.validUntil = addDays(ed.issueDate, settings().quoteValidityDays);
      touch({structural: true}); render({focus: `[data-chip-target="docType"] [data-value="${value}"]`}); return;
    }
    if (name === 'term') { ed.term = value === 'autre' ? 'autre' : Number(value); if (ed.term !== 'autre') { ed.dueDate = addDays(ed.issueDate, ed.term); const due = form()?.elements.dueDate; if (due) due.value = ed.dueDate; } else form()?.elements.dueDate?.focus(); }
    else if (name === 'validity') { ed.validUntil = addDays(ed.issueDate, Number(value)); const v = form()?.elements.validUntil; if (v) v.value = ed.validUntil; }
    else if (['discountType', 'clientKind', 'operationNature'].includes(name)) ed[name] = value;
    else return;
    touch();
  }
  // Retour de la fiche client : la saisie d'avant, mais l'identifiant et la version courants (le brouillon a pu être
  // enregistré à la fermeture de l'éditeur, une version périmée bloquerait ensuite tout enregistrement).
  const restore = back => restoreEditor(back, ed);
  const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  function syncChips(name, value) {
    const f = form(), input = f?.querySelector(`input[name="${name}"]`); if (input) input.value = value ?? '';
    f?.querySelectorAll(`[data-chip-target="${name}"] .choice-chip`).forEach(c => { const on = c.dataset.value === String(value ?? ''); c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', String(on)); });
  }
  function refreshHint(li, l) {
    const box = li.querySelector('[data-hint]'); if (!box) return;
    const hint = priceHint(ui.state(), l, ed.clientId);
    box.innerHTML = hint ? String(html`<span>Prix suggéré : ${hint.text}</span> <button type="button" class="text-button" data-bdoc="price-apply" data-price="${hint.price}">Appliquer</button>`) : '';
  }
  // Une saisie : rafraîchissement en direct, copie de sécurité et enregistrement différé.
  function touch({structural = false} = {}) {
    dirty = true;
    clearTimeout(liveTimer); liveTimer = setTimeout(live, structural ? 0 : 120);
    schedule();
  }
  function schedule(delay = SAVE_DELAY) { clearTimeout(timer); timer = setTimeout(() => { timer = null; writeBackup(); save(); }, delay); setState('Modifications en cours…', 'wait'); }
  function live() {
    const f = form(); if (!f || !ed) return;
    const w = work(), subs = runningSubtotals(ed.lines);
    f.querySelectorAll('[data-line]').forEach(li => {
      const l = ed.lines.find(x => x.id === li.dataset.line); if (!l) return;
      const amount = li.querySelector('[data-amount]'); if (amount) amount.textContent = `${money(lineAmount(l))} HT`;
      const sub = li.querySelector('[data-subtotal]'); if (sub) sub.textContent = `${money(subs.get(l.id) ?? 0)} HT`;
    });
    const totals = $('#bd-totals'); if (totals) totals.innerHTML = String(totalsHtml(w.doc));
    const comp = $('#bd-compliance'); if (comp) comp.innerHTML = String(complianceHtml(w));
    refreshPreview();
  }
  function refreshPreview(delay = 600) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const frame = $('.bd-preview-frame'); if (!frame || !ed) return;
      try { frame.srcdoc = noToolbar(invoiceHtmlWithQr(ui.state(), work().doc, {assetBase: assetBase()})); } catch (error) { console.warn('[Parcelles] aperçu indisponible', error); }
    }, delay);
  }
  function setState(message, tone = 'ok') { const el = $('#bd-save-state'); if (el) { el.textContent = message; el.dataset.tone = tone; } }

  // ---------- Enregistrement et protection contre la perte ----------
  function writeBackup() { if (ed && dirty) writeDraft(backupKey(), {ed}); }
  async function save() {
    if (!ed || !dirty) return stored;
    clearTimeout(timer); timer = null;
    if (saving) { await saving; if (!dirty) return stored; }
    const store = ui.store();
    saving = (async () => {
      const before = JSON.stringify(draftValues(ed));
      try {
        // Client retiré par « Changer » sur un brouillon existant : rien n'est écrit tant que le nouveau n'est pas choisi.
        if (ed.id && !ed.clientName) { setState('Choisissez le nouveau client : les modifications seront enregistrées ensuite (saisie gardée sur cet appareil).', 'wait'); writeBackup(); return null; }
        if (!ed.id) {
          if (!ed.clientName) { setState('Choisissez le client : le brouillon sera enregistré ensuite (saisie gardée sur cet appareil).', 'wait'); writeBackup(); return null; }
          const oldKey = backupKey();
          const created = await createDraft(store, {clientId: ed.clientId || null, client: ed.clientId ? null : {name: ed.clientName, address: ed.clientAddress, siren: ed.clientSiren, vatNumber: ed.clientVat, kind: ed.clientKind, email: ed.clientEmail}, docType: ed.docType, lines: [], today: ed.issueDate});
          ed.id = created.id; ed.version = created.version ?? null; stored = created; removeDraft(oldKey);
          const del = $('[data-bdoc="draft-delete"]'); if (!del) $('[data-bdoc="preview"]')?.insertAdjacentHTML('beforebegin', '<button type="button" class="button danger" data-bdoc="draft-delete">Supprimer</button>');
        }
        const saved = await saveDraft(store, ed.id, draftValues(ed), {version: ed.version ?? undefined});
        ed.version = saved.version ?? null; stored = saved;
        if (JSON.stringify(draftValues(ed)) === before) { dirty = false; removeDraft(backupKey()); }
        setState(`Brouillon enregistré à ${hhmm(Date.now())}.`, 'ok');
        return saved;
      } catch (error) {
        writeBackup();
        setState(`Non enregistré : ${error?.message || 'erreur inconnue'} La saisie reste gardée sur cet appareil.`, 'error');
        return null;
      } finally { saving = null; }
    })();
    return saving;
  }
  async function flush() { clearTimeout(timer); timer = null; if (dirty) { writeBackup(); await save(); } return stored; }
  // Fermeture de la fenêtre (croix, Échap, autre écran, application suspendue) : enregistrement immédiat.
  function watchClose() {
    observer?.disconnect();
    const root = globalThis.document?.getElementById('modal-root');
    if (root && typeof MutationObserver !== 'undefined') { observer = new MutationObserver(() => { if (!form()) { observer?.disconnect(); observer = null; flush(); } }); observer.observe(root, {childList: true}); }
  }
  if (globalThis.document) {
    globalThis.document.addEventListener('visibilitychange', () => { if (globalThis.document.visibilityState === 'hidden' && isOpen()) { writeBackup(); save(); } });
    globalThis.addEventListener?.('pagehide', () => { if (isOpen()) writeBackup(); });
  }
  function offerResume() {
    const box = $('#bd-resume'); if (!box || !ed) return;
    const prev = readDraft(backupKey());
    if (!prev?.fields?.ed || prev.savedAt <= (Number(stored?.updatedAt) || 0)) return;
    if (JSON.stringify(draftValues({...prev.fields.ed})) === JSON.stringify(draftValues(ed))) return;
    box.innerHTML = String(html`<div class="draft-banner" role="status"><span>Une saisie non enregistrée de ${draftTimeLabel(prev.savedAt)} existe. La reprendre ?</span><span class="draft-banner-actions"><button type="button" class="button primary" data-bdoc="resume">Reprendre</button><button type="button" class="button secondary" data-bdoc="resume-discard">Ignorer</button></span></div>`);
  }

  // ---------- Glisser-déposer des lignes ----------
  function bindDrag(f) {
    let from = null;
    const list = f.querySelector('#bd-lines'); if (!list) return;
    list.addEventListener('dragstart', event => { const li = event.target.closest?.('[data-line]'); if (!li || !event.target.classList?.contains('bd-drag')) return; from = li.dataset.line; li.classList.add('is-dragging'); try { event.dataTransfer.setData('text/plain', from); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setDragImage(li, 20, 20); } catch { /* navigateur sans glisser-déposer complet */ } });
    list.addEventListener('dragover', event => { if (!from) return; const li = event.target.closest?.('[data-line]'); if (li) { event.preventDefault(); list.querySelectorAll('.is-drop').forEach(x => x.classList.remove('is-drop')); li.classList.add('is-drop'); } });
    list.addEventListener('dragend', () => { from = null; list.querySelectorAll('.is-dragging,.is-drop').forEach(x => x.classList.remove('is-dragging', 'is-drop')); });
    list.addEventListener('drop', event => {
      const li = event.target.closest?.('[data-line]'); if (!from || !li) return; event.preventDefault();
      const a = ed.lines.findIndex(l => l.id === from), b = ed.lines.findIndex(l => l.id === li.dataset.line); from = null;
      if (a >= 0 && b >= 0 && a !== b) { ed.lines = moveLine(ed.lines, a, b); rerenderLines(); ui.toast(`Ligne déplacée en position ${b + 1}.`, 'success'); }
    });
  }
  function rerenderLines(focus = null) {
    const list = $('#bd-lines'); if (!list) return;
    list.innerHTML = String(linesInner());
    const bar = $('#bd-addbar'); if (bar) bar.innerHTML = String(addBarHtml());
    touch({structural: true});
    if (focus) ui.focusSoon(focus);
  }
  function moveBy(id, dir, focus) {
    const i = ed.lines.findIndex(l => l.id === id), j = i + dir; if (i < 0 || j < 0 || j >= ed.lines.length) return;
    ed.lines = moveLine(ed.lines, i, j); rerenderLines(focus || `[data-line="${id}"] [data-bdoc="line-move"][data-dir="${dir}"]:not([disabled]), [data-line="${id}"] [data-bdoc="line-move"]:not([disabled])`);
    const status = $('#bd-save-state'); if (status) status.textContent = `Ligne déplacée en position ${j + 1}.`;
  }
  const lineOf = control => control.closest('[data-line]')?.dataset.line;
  function addLines(lines, {focusFirst = true} = {}) {
    const added = lines.map(l => ({...l, id: newLineId()}));
    ed.lines = [...ed.lines, ...added]; rerenderLines(focusFirst && added[0] ? `[data-line="${added[0].id}"] [data-f="${added[0].unitPrice === null || added[0].unitPrice === undefined ? 'unitPrice' : 'quantity'}"]` : null);
  }
  function pickClient(id) {
    const c = ui.store()?.get('clients', id); if (!c || !ed) return;
    ed = applyClient(ed, c, {settings: settings(), fresh: !ed.id}); clientOpen = false; clientIndex = -1; prevClient = null;
    touch({structural: true}); render({focus: ed.lines.length ? '[name="subject"]' : '[data-bdoc="line-add"]'});
  }

  // ---------- Actions de l'éditeur ----------
  Object.assign(ui.handlers, {
    'client-pick': c => pickClient(c.dataset.id),
    'client-change': () => { if (!ed) return; prevClient = ed.id ? pick(ed, CLIENT_KEYS) : null; ed = {...ed, clientId: '', clientName: ''}; clientOpen = true; render({focus: '#bd-client-q'}); },
    'client-keep': () => { if (!ed || !prevClient) return; ed = {...ed, ...prevClient}; prevClient = null; clientOpen = false; touch({structural: true}); render({focus: '[data-bdoc="client-change"]'}); },
    'client-new': () => { const q = $('#bd-client-q')?.value || ''; const back = {...ed}; ui.actions.clientForm({name: q, onSaved: client => { const b = restore(back); ed = applyClient(b, client, {settings: settings(), fresh: !b.id}); touch({structural: true}); render({focus: '[data-bdoc="line-add"]'}); }, onCancel: () => { ed = restore(back); render({focus: '#bd-client-q'}); }}); },
    'client-edit': () => { if (!ed?.clientId) return; const back = {...ed}; ui.actions.clientForm({id: ed.clientId, onSaved: client => { ed = applyClient(restore(back), client, {settings: settings()}); touch({structural: true}); render(); }, onCancel: () => { ed = restore(back); render(); }}); },
    'line-add': c => { const kind = c.dataset.kind || 'item', l = newLine(kind, {vatRate: settings().vatRate, unit: 'u'}); ed.lines = [...ed.lines, l]; rerenderLines(`[data-line="${l.id}"] ${kind === 'comment' ? 'textarea' : '[data-f="label"]'}`); },
    'line-move': c => moveBy(lineOf(c), Number(c.dataset.dir) || 1),
    'line-dup': c => { const i = ed.lines.findIndex(l => l.id === lineOf(c)); if (i < 0) return; ed.lines = duplicateLine(ed.lines, i); rerenderLines(`[data-line="${ed.lines[i + 1].id}"] [data-f="label"]`); },
    'line-del': c => {
      const i = ed.lines.findIndex(l => l.id === lineOf(c)); if (i < 0) return;
      const removed = ed.lines[i]; ed.lines = removeLine(ed.lines, i);
      rerenderLines(ed.lines[Math.min(i, ed.lines.length - 1)] ? `[data-line="${ed.lines[Math.min(i, ed.lines.length - 1)].id}"] [data-f]` : '[data-bdoc="line-add"]');
      ui.toast(`Ligne supprimée${removed.label ? ` : ${removed.label}` : ''}.`, 'success', {label: 'Annuler', run: () => { if (!ed || !isOpen()) return; const at = Math.min(i, ed.lines.length); ed.lines = [...ed.lines.slice(0, at), removed, ...ed.lines.slice(at)]; rerenderLines(`[data-line="${removed.id}"] [data-f]`); }});
    },
    'price-apply': c => { const li = c.closest('[data-line]'), l = ed.lines.find(x => x.id === li?.dataset.line); if (!l) return; l.unitPrice = c.dataset.price; const input = li.querySelector('[data-f="unitPrice"]'); if (input) { input.value = c.dataset.price; input.focus(); } refreshHint(li, l); touch(); },
    panel: c => { panel = panel === c.dataset.panel ? '' : c.dataset.panel || ''; const box = $('#bd-panel'); if (box) box.innerHTML = String(panelHtml()); const bar = $('#bd-addbar'); if (bar) bar.innerHTML = String(addBarHtml()); if (panel) ui.focusSoon(panel === 'catalog' ? '[name="catalogQuery"], #bd-panel [data-bdoc="hub"]' : '#bd-panel [name="billPick"]'); else ui.focusSoon('[data-bdoc="panel"]'); },
    'catalog-pick': c => { const item = catalogItems(ui.state()).find(i => i.id === c.dataset.item); if (!item) return; addLines([catalogLine(item, {clientId: ed.clientId || null})]); ui.toast(`Ajouté : ${item.label}.`, 'success'); },
    'billable-add': () => { const keys = new Set([...globalThis.document.querySelectorAll('[name="billPick"]:checked')].map(i => i.value)); const lines = billablePicks(ui.state(), ed).filter(it => keys.has(it.key)).map(it => it.line); if (!lines.length) { ui.toast('Cochez au moins une prestation.', 'info'); return; } panel = ''; const box = $('#bd-panel'); if (box) box.innerHTML = ''; addLines(lines, {focusFirst: false}); ui.toast(`${plural(lines.length, 'prestation ajoutée', 'prestations ajoutées')}.`, 'success'); },
    quick: () => {
      const text = String($('[name="quickText"]')?.value || '').trim();
      if (!text) { ui.toast('Écrivez par exemple « 3 h de pelle à 65 € ».', 'info'); $('[name="quickText"]')?.focus(); return; }
      runQuick(text); const box = $('#bd-quick-result'); if (box) box.innerHTML = String(quickResultHtml());
      ui.focusSoon('#bd-quick-result [name="quickPick"], #bd-quick-result [data-bdoc]');
    },
    'quick-apply': () => {
      if (!quick) return;
      const keep = new Set([...globalThis.document.querySelectorAll('[name="quickPick"]:checked')].map(i => Number(i.value)));
      const lines = quick.result.lines.filter((_, i) => keep.has(i));
      if (quick.result.client && !ed.clientName) ed = applyClient(ed, quick.result.client, {settings: settings(), fresh: !ed.id});
      const typed = quick.result.clientQuery; quick = null;
      if (lines.length) ed.lines = [...ed.lines, ...lines.map(l => ({...l, id: newLineId()}))];
      touch({structural: true}); render({focus: ed.clientName ? '[data-bdoc="emit"]' : '#bd-client-q'}); prefillClientQuery(typed);
      ui.toast(lines.length ? `${plural(lines.length, 'ligne ajoutée', 'lignes ajoutées')} : vérifiez les prix.` : 'Aucune ligne ajoutée.', lines.length ? 'success' : 'info');
    },
    fix: c => {
      const type = c.dataset.fixType, f = form(); if (!f) return;
      if (type === 'settings') return ui.hub('settings');
      if (type === 'lines') return ui.focusSoon('[data-bdoc="line-add"]');
      if (type === 'line') { const li = f.querySelectorAll('#bd-lines [data-line]')[Number(c.dataset.fixIndex) || 0]; const target = li?.querySelector('[data-f="label"]:placeholder-shown, [data-f="unitPrice"]:placeholder-shown, select[data-f="vatExemption"]:not([hidden] *), [data-f="label"]'); li?.querySelector('details')?.setAttribute('open', ''); target?.focus(); target?.scrollIntoView?.({block: 'center'}); return; }
      let field = c.dataset.fixField;
      if (type === 'client') { const text = c.closest('li')?.textContent || ''; field = /adresse/i.test(text) ? 'clientAddress' : /TVA/.test(text) ? 'clientVat' : 'clientSiren'; if (!ed.clientName) return ui.focusSoon('#bd-client-q'); }
      if (field === 'discountValue' || !field) field = field || 'issueDate';
      const el = f.elements[field]; if (!el) return;
      el.closest('details')?.setAttribute('open', ''); el.focus(); el.scrollIntoView?.({block: 'center'});
    },
    resume: () => { const prev = readDraft(backupKey()); if (!prev?.fields?.ed) return; ed = {...prev.fields.ed, id: ed.id, version: ed.version}; dirty = true; render(); schedule(0); ui.toast('Saisie reprise.', 'success'); },
    'resume-discard': () => { removeDraft(backupKey()); const box = $('#bd-resume'); if (box) box.innerHTML = ''; },
    preview: async () => {
      if (wide()) { showPreview = !showPreview; setPrefPreview(showPreview); await flush(); const focus = '[data-bdoc="preview"]'; return ed?.id ? open(ed.id, {focus}) : render({focus}); }
      const doc = work().doc;
      showPrintable(invoiceHtmlWithQr(ui.state(), doc, {assetBase: assetBase()}), `${DOC_LABELS[doc.docType]} en brouillon${doc.clientName ? ` - ${doc.clientName}` : ''}`, {pdf: ui.actions.pdfOptions(doc)});
    },
    'editor-back': async () => { const type = ed?.docType || 'facture'; await flush(); ui.openList(type); },
    'draft-delete': async () => {
      await flush(); if (!ed?.id) { removeDraft(backupKey()); ed = null; return ui.openList(); }
      const id = ed.id, type = ed.docType;
      const removed = await ui.run(() => deleteDraft(ui.store(), id)); if (!removed) return;
      removeDraft(backupKey()); ed = null; dirty = false; ui.openList(type);
      ui.toast('Brouillon supprimé.', 'success', {label: 'Annuler', run: async () => { await ui.run(() => ui.store().restore('integrationImports', id)); open(id); }});
    },
    emit: async () => {
      const f = form(); if (!f) return;
      if (!ed.clientName) return ui.showFormError(f, 'Champ obligatoire : Client. Choisissez-le ou créez sa fiche.', $('#bd-client-q'));
      const w = work(); if (w.error) return ui.showFormError(f, w.error, null);
      dirty = true; const saved = await save();
      if (!saved) return ui.showFormError(f, $('#bd-save-state')?.textContent || 'Enregistrement impossible.', null);
      ui.actions.confirmEmit(saved.id);
    }
  });

  return {open, openNew, flush, isOpen, current: () => ed};
}
