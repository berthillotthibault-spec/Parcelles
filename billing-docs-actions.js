// Documents de facturation (v13, chantier A) : fiche d'un document émis et actions selon son état.
// Émettre (numéro annoncé, immutabilité), envoyer par la messagerie (PDF et Factur-X joints, puis journal des envois),
// encaisser (partiel, trop-perçu à reporter ou rembourser), relancer, avoir total ou partiel, accepter ou refuser un
// devis, acompte et facture de solde, dupliquer, Factur-X contrôlé, écritures comptables, frise de l'historique.
// Toute écriture passe par le moteur (invoices.js, billing.js) ; une action réversible propose « Annuler ».
import {html, raw} from './safe-html.js';
import {download} from './utils.js';
import {DOC_LABELS, PAYMENT_METHODS, VAT_EXEMPTIONS, ACCOUNTING_TYPES, docTypeOf, documentTotals, invoiceBalance, invoiceStatus, paymentsOf, methodLabel, fingerprintOk,
  isoDay, dateFr, lineKind, amountLine, runningSubtotals, emitDocument, addPayment, removePayment, createCreditNote, patchEmitted, deleteDraft, invoiceFileName} from './invoices.js';
import {acceptQuote, refuseQuote, createDepositInvoice, convertQuote, duplicateDocument, depositLines, quoteProgress, logSent, recordReminder, transferOverpayment} from './billing.js';
import {facturXProblems, facturXml, validateFacturX, facturXFileName, invoiceHtmlWithQr} from './billing-export.js';
import {documentMessage} from './billing-messages.js';
import {invoicePdf} from './invoice-pdf.js';
import {dataUrlBytes, isTouchDevice, pdfFile, sharePdf} from './pdf-lite.js';
import {openPrintable, assetBase} from './dossier-ui.js';
import {docActions, actionLabel, docAdvice, timeline, reminderLevel, overpaymentTargets, checkPayment, creditLines, complianceItems, upcomingNumber, documentJournal,
  clientBillingValues, exclusive, lineAmount, money, rateLabel, plural, safeName, OPEN_STATUSES} from './billing-docs-view.js';

const PAY_METHODS = PAYMENT_METHODS.filter(([k]) => !['compensation', 'remboursement'].includes(k));
const REMINDER_LABELS = {1: 'Rappel courtois', 2: 'Deuxième relance', 3: 'Dernière relance'};
const WIDE = '(min-width: 1180px)';
const wide = () => { try { return globalThis.matchMedia?.(WIDE).matches || false; } catch { return false; } };
const noToolbar = doc => String(doc).replace('</head>', '<style>.dz-toolbar,#print{display:none!important}body{margin:0}</style></head>');
const $ = sel => globalThis.document?.querySelector(sel) || null;
const qty = v => v === null || v === undefined || v === '' ? '—' : new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 3}).format(Number(v));
const TL_ICON = {create: '○', emit: '●', send: '→', remind: '!', pay: '€', refund: '€', accept: '✓', refuse: '×', convert: '↳', credit: '−', link: '↔'};

// Logo des paramètres converti une fois en JPEG sur fond blanc (insertion directe dans le PDF).
const logoCache = new Map();
function warmLogo(url) {
  if (!url || !globalThis.document) return;
  if (logoCache.has(url)) return;
  const entry = {value: undefined}; logoCache.set(url, entry);
  (async () => { const img = new Image(); img.src = url; await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1; const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0); return {bytes: dataUrlBytes(c.toDataURL('image/jpeg', 0.92))}; })()
    .catch(() => null).then(v => { entry.value = v; });
}
const logoNow = url => (url ? logoCache.get(url)?.value || null : null);

export function createDocsActions(ui) {
  let clientCtx = null;
  const store = () => ui.store(), state = () => ui.state();
  const pdfBytes = doc => invoicePdf(state(), doc, {logo: logoNow(ui.settings().logo)});
  const pdfOptions = doc => ({name: invoiceFileName(doc), make: () => pdfBytes(doc)});
  const docName = d => `${DOC_LABELS[docTypeOf(d)]} ${d.number || (d.status === 'brouillon' ? 'en brouillon' : 'pro forma')}`;
  const footerBack = (id, extra = '') => html`<button type="button" class="button secondary" data-bdoc="view" data-id="${id}">Retour</button>${raw(String(extra))}`;
  function must(id) { const d = ui.doc(id); if (!d) ui.toast('Document introuvable : il a peut-être été supprimé.', 'error'); return d; }
  function writable(d) { if (ui.canWrite(d.farmKind)) return true; ui.toast('Votre rôle ne permet pas de modifier les documents de facturation.', 'info'); return false; }

  // ---------- Totaux, lignes, frise ----------
  function totalsHtml(doc) {
    const t = doc.status === 'brouillon' ? documentTotals(doc) : doc.totals?.parTaux ? doc.totals : documentTotals(doc), row = (label, value, cls = '') => html`<div${raw(cls ? ` class="${cls}"` : '')}><dt>${label}</dt><dd>${value}</dd></div>`;
    return html`<dl class="bd-totals">
      ${row('Total des lignes HT', money(t.linesHt ?? t.ht))}
      ${t.discount ? row('Remise', money(-t.discount)) : ''}${t.shipping ? row(doc.shipping?.label || 'Frais', money(t.shipping)) : ''}
      ${t.deductions?.ht ? row('Acomptes déduits HT', money(-t.deductions.ht)) : ''}
      ${(t.parTaux || t.byRate || []).map(p => html`${row(`Base HT ${rateLabel(p.rate)}${p.exemption ? ` (${VAT_EXEMPTIONS[p.exemption]?.label || p.exemption})` : ''}`, money(p.base), 'is-sub')}${p.rate ? row(`TVA ${rateLabel(p.rate)}`, money(p.tax), 'is-sub') : ''}`)}
      ${row('Total HT', money(t.ht))}${row('TVA', money(t.tva))}${row('Total TTC', money(t.ttc), 'is-grand')}</dl>
      ${t.missing ? html`<p class="bd-help">${plural(t.missing, 'ligne sans prix', 'lignes sans prix')} : à compléter avant l’émission.</p>` : ''}`;
  }
  function linesView(doc) {
    const subs = runningSubtotals(doc.lines || []);
    return html`<ul class="bd-view-lines">${(doc.lines || []).map(l => {
      const k = lineKind(l);
      if (k === 'section') return html`<li class="is-section"><strong>${l.label}</strong></li>`;
      if (k === 'subtotal') return html`<li class="is-subtotal"><span>${l.label || 'Sous-total'}</span><strong>${money(subs.get(l.id) ?? 0)}</strong></li>`;
      if (k === 'comment') return html`<li class="is-comment"><span>${l.description || l.label}</span></li>`;
      const ht = lineAmount(l);
      return html`<li${raw(k === 'deduction' ? ' class="is-deduction"' : '')}><span><strong>${l.label}</strong><small>${qty(l.quantity)} ${l.unit || ''} × ${money(Number(l.unitPrice))}${l.discountPct ? ` · remise ${String(l.discountPct).replace('.', ',')} %` : ''} · TVA ${rateLabel(l.vatRate)}</small>${l.description ? html`<small>${l.description}</small>` : ''}</span><strong>${money(ht)}</strong></li>`;
    })}</ul>`;
  }
  function timelineHtml(d) {
    const items = timeline(state(), d);
    if (!items.length) return '';
    return html`<section class="bd-sec" aria-labelledby="bd-tl-h"><h3 class="bd-h3" id="bd-tl-h">Historique</h3><ol class="bd-timeline">${items.map(e => html`<li class="bd-tl is-${e.kind}"><span class="bd-tl-dot" aria-hidden="true">${TL_ICON[e.kind] || '·'}</span><span class="bd-tl-body"><time datetime="${e.date}">${dateFr(e.date)}</time><span>${e.label}</span>${e.docId && ui.doc(e.docId) ? html`<button type="button" class="text-button" data-bdoc="open" data-id="${e.docId}" aria-label="${`Ouvrir le document lié : ${e.label}`}">Ouvrir</button>` : ''}</span></li>`)}</ol></section>`;
  }

  // ---------- Fiche d'un document ----------
  function view(id) {
    const data = state(), d = ui.doc(id); if (!d) { ui.toast('Document introuvable : il a peut-être été supprimé.', 'error'); return ui.openList(); }
    const t = docTypeOf(d), s = invoiceStatus(d, data), write = ui.canWrite(d.farmKind), draft = d.status === 'brouillon';
    const totals = draft ? documentTotals(d) : d.totals || documentTotals(d), payable = (t === 'facture' || t === 'acompte') && !draft, b = payable ? invoiceBalance(data, d) : null;
    const acts = docActions(data, d, {canWrite: write}).filter(k => !['preview', 'pdf', 'open'].includes(k));
    const main = acts.slice(0, 4), more = acts.slice(4), advice = write ? docAdvice(data, d) : null;
    warmLogo(ui.settings().logo);
    const facts = [
      ['Client', d.clientName || '—'], [t === 'devis' || t === 'proforma' ? 'Date' : 'Date d’émission', dateFr(d.issueDate)],
      d.deliveryDate ? ['Livraison ou prestation', dateFr(d.deliveryDate)] : null,
      t === 'devis' ? ['Valable jusqu’au', dateFr(d.validUntil)] : payable ? ['Échéance', dateFr(d.dueDate)] : null,
      d.subject ? ['Objet', d.subject] : null, d.reference ? ['Référence', d.reference] : null
    ].filter(Boolean);
    const linkTo = (label, docId, number) => html`<div><dt>${label}</dt><dd>${ui.doc(docId) ? html`<button type="button" class="text-button" data-bdoc="open" data-id="${docId}">${number || 'Ouvrir'}</button>` : number || '—'}</dd></div>`;
    const prog = t === 'devis' && ['accepte', 'converti'].includes(s) ? quoteProgress(data, d) : null;
    const payments = payable ? paymentsOf(d) : [];
    const body = html`<div class="bd-doc-layout${wide() ? ' has-preview' : ''}"><div class="bd-doc-main">
      <div class="bd-doc-head">${ui.statusPill(s)}<strong class="bd-doc-total">${money(totals.ttc)} <small>TTC</small></strong>${b && b.due > 0.005 && b.due < b.net - 0.005 ? html`<span class="bd-doc-due">reste ${money(b.due)}</span>` : ''}</div>
      ${b && b.net > 0 ? html`<div class="bd-progress"><progress max="${b.net}" value="${Math.min(b.paid, b.net)}" aria-label="${`Encaissé : ${money(b.paid)} sur ${money(b.net)}`}"></progress><small>Encaissé ${money(b.paid)} sur ${money(b.net)}${b.credited ? ` (avoirs déduits : ${money(b.credited)})` : ''}${b.overpaid > 0.005 ? ` · trop-perçu ${money(b.overpaid)}` : ''}</small></div>` : ''}
      ${prog ? html`<div class="bd-progress"><progress max="${prog.total}" value="${Math.max(0, prog.total - prog.remaining)}" aria-label="${`Facturé en acomptes : ${money(prog.total - prog.remaining)} sur ${money(prog.total)}`}"></progress><small>Acomptes : ${money(prog.deposited)} émis${prog.draftDeposits ? `, ${money(prog.draftDeposits)} en brouillon` : ''} · reste ${money(prog.remaining)}</small></div>` : ''}
      ${advice ? html`<div class="notice info bd-advice"><p>${advice.text}</p>${advice.action && acts.includes(advice.action) ? html`<button type="button" class="small-button" data-bdoc="act" data-act="${advice.action}" data-id="${d.id}">${actionLabel(advice.action, d, data)}</button>` : ''}</div>` : ''}
      ${!draft && fingerprintOk(d) === false ? html`<p class="notice danger" role="alert">Ce document a été modifié depuis son émission (empreinte différente : synchronisation, import ou correction directe). Vérifiez-le avant de le réimprimer ou de l’exporter.</p>` : ''}
      ${main.length ? html`<div class="bd-actions" role="group" aria-label="Actions sur le document">${main.map((k, i) => html`<button type="button" class="button ${i === 0 ? 'primary' : 'secondary'}${k === 'delete' ? ' danger' : ''}" data-bdoc="act" data-act="${k}" data-id="${d.id}">${actionLabel(k, d, data)}</button>`)}
        ${more.length ? html`<details class="bd-more"><summary>Plus d’actions</summary><div class="bd-more-list">${more.map(k => html`<button type="button" class="small-button" data-bdoc="act" data-act="${k}" data-id="${d.id}">${actionLabel(k, d, data)}</button>`)}</div></details>` : ''}</div>` : ''}
      <dl class="definition-list bd-facts">${facts.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}
        ${d.quoteId ? linkTo(t === 'facture' || t === 'acompte' ? 'Devis' : 'Document d’origine', d.quoteId, d.quoteNumber) : ''}${d.creditOf ? linkTo('Facture d’origine', d.creditOf, d.creditOfNumber) : ''}
        ${d.acceptance ? html`<div><dt>Acceptation</dt><dd>${dateFr(d.acceptance.date)} · ${d.acceptance.signatory}${d.acceptance.goodForAgreement ? ' · « Bon pour accord »' : ''}</dd></div>` : ''}</dl>
      <section class="bd-sec" aria-labelledby="bd-vl-h"><h3 class="bd-h3" id="bd-vl-h">${plural((d.lines || []).filter(amountLine).length, 'ligne', 'lignes')}</h3>${linesView(d)}${totalsHtml(d)}</section>
      ${payments.length ? html`<section class="bd-sec" aria-labelledby="bd-pay-h"><h3 class="bd-h3" id="bd-pay-h">Paiements</h3><ul class="bd-payments">${payments.map(p => html`<li><span><strong>${money(p.amount)}</strong><small>${dateFr(p.date)}${p.method ? ` · ${methodLabel(p.method)}` : ''}${p.reference ? ` · ${p.reference}` : ''}</small></span>${write && !p.legacy ? html`<button type="button" class="small-button" data-bdoc="payment-remove" data-id="${d.id}" data-payment="${p.id}" aria-label="${`Retirer le paiement de ${money(p.amount)} du ${dateFr(p.date)}`}">Retirer</button>` : ''}</li>`)}</ul></section>` : ''}
      ${timelineHtml(d)}
      <p class="bd-help">${draft ? 'Brouillon : consultation seule pour votre rôle.' : t === 'devis' ? 'Devis numéroté : non modifiable. Pour le changer, dupliquez-le.' : t === 'proforma' ? 'Pro forma : sans valeur comptable, elle se convertit en facture.' : 'Document émis : non modifiable. Une correction passe par un avoir.'}</p>
    </div>${wide() ? html`<aside class="bd-preview" aria-label="Aperçu du document"><iframe class="bd-preview-frame" title="${`Aperçu : ${docName(d)}`}" sandbox="allow-same-origin"></iframe></aside>` : ''}</div>`;
    const touch = isTouchDevice();
    const footer = html`<button type="button" class="button secondary" data-bdoc="back">Retour</button><button type="button" class="button secondary" data-bdoc="act" data-act="preview" data-id="${d.id}">${touch ? 'Aperçu' : 'Imprimer'}</button><button type="button" class="button secondary" data-bdoc="act" data-act="pdf" data-id="${d.id}">${touch ? 'Partager le PDF' : 'Télécharger le PDF'}</button>`;
    ui.modal(docName(d), d.clientName || '', String(body), String(footer), `large bd-modal${wide() ? ' bd-wide' : ''}`);
    const frame = $('.bd-preview-frame');
    if (frame) setTimeout(() => { try { frame.srcdoc = noToolbar(invoiceHtmlWithQr(state(), d, {assetBase: assetBase()})); } catch (error) { console.warn('[Parcelles] aperçu indisponible', error); } }, 30);
  }

  // ---------- Émission ----------
  function confirmEmit(id) {
    const d = must(id); if (!d || !writable(d)) return;
    const data = state(), t = docTypeOf(d), c = complianceItems(data, d), number = upcomingNumber(data, d), totals = documentTotals(d);
    const errors = c.items.filter(i => i.level === 'error'), warnings = c.items.filter(i => i.level === 'warning');
    const lock = t === 'devis' ? 'Le devis numéroté ne se modifie plus : pour le changer, vous le dupliquerez.' : t === 'proforma' ? 'La pro forma finalisée ne se modifie plus ; elle se convertit ensuite en facture.' : `Une fois émis${t === 'facture' || t === 'acompte' ? 'e' : ''}, ${t === 'avoir' ? 'l’avoir' : 'la facture'} ne se modifie plus et ne se supprime pas : toute correction passera par un avoir. La numérotation reste continue, sans trou.`;
    const body = errors.length ? html`<div class="notice danger bd-notice" role="alert"><p><strong>À compléter avant l’émission :</strong></p><ul>${errors.map(e => html`<li>${e.text}</li>`)}</ul></div>`
      : html`<p class="bd-confirm">${number ? html`${DOC_LABELS[t]} pour <strong>${d.clientName}</strong> : numéro <strong class="bd-number">${number}</strong>, ` : html`${DOC_LABELS[t]} pour <strong>${d.clientName}</strong>, sans numéro, `}total <strong>${money(totals.ttc)} TTC</strong>, daté du ${dateFr(d.issueDate)}.</p>
        ${warnings.length ? html`<div class="notice warning bd-notice"><p>À vérifier (non bloquant) :</p><ul>${warnings.map(w => html`<li>${w.text}</li>`)}</ul></div>` : ''}
        <div class="notice info bd-notice"><p>${lock}</p></div>`;
    const footer = html`<button type="button" class="button secondary" data-bdoc="edit" data-id="${d.id}">Retour au brouillon</button>${errors.some(e => e.fix?.type === 'settings') ? html`<button type="button" class="button secondary" data-bdoc="hub" data-tab="settings">Paramètres</button>` : ''}${errors.length ? '' : html`<button type="button" class="button primary" data-bdoc="emit-confirm" data-id="${d.id}" data-version="${d.version ?? ''}">${t === 'devis' ? 'Numéroter le devis' : t === 'proforma' ? 'Finaliser' : 'Émettre définitivement'}</button>`}`;
    ui.modal(actionLabel('emit', d), `${d.clientName} · ${money(totals.ttc)} TTC`, String(body), String(footer), 'small');
  }
  async function emitConfirmed(control) {
    const id = control.dataset.id, version = control.dataset.version === '' ? undefined : Number(control.dataset.version);
    control.disabled = true;
    const saved = await ui.run(() => emitDocument(store(), id, {version}));
    if (!saved) { control.disabled = false; return; }
    const t = docTypeOf(saved);
    ui.toast(`${DOC_LABELS[t]} ${saved.number || ''} ${t === 'devis' ? 'numéroté' : t === 'proforma' ? 'finalisée' : t === 'avoir' ? 'émis' : 'émise'}.`.replace(/\s+\./, '.'), 'success', {label: 'Envoyer', run: () => send(id)});
    view(id);
  }

  // ---------- Envoi par la messagerie ----------
  function attachments(d) {
    const files = [];
    try { files.push(pdfFile(pdfBytes(d), invoiceFileName(d))); } catch (error) { console.warn('[Parcelles] PDF non joint', error); }
    if (ACCOUNTING_TYPES.has(docTypeOf(d)) && !facturXProblems(state(), d).length) {
      try { const xml = facturXml(state(), d); if (validateFacturX(xml).ok) files.push(new File([xml], facturXFileName(d), {type: 'application/xml'})); } catch (error) { console.warn('[Parcelles] Factur-X non joint', error); }
    }
    return files;
  }
  async function send(id, {purpose = 'envoi', level = null} = {}) {
    const d = must(id); if (!d) return null;
    if (d.status === 'brouillon') { ui.toast('Émettez d’abord le document : il reçoit alors son numéro.', 'info'); return ui.openEditor(id); }
    let msg; try { msg = documentMessage(state(), d, {purpose}); } catch (error) { ui.toast(error?.message || 'Message impossible à préparer.', 'error'); return null; }
    const messaging = await ui.messaging();
    if (!messaging?.openComposer) { ui.toast('Écran indisponible : la messagerie n’a pas pu se charger. Téléchargez le PDF pour l’envoyer vous-même.', 'error'); return null; }
    warmLogo(ui.settings().logo);
    const result = await messaging.openComposer({recipients: msg.recipients, channel: msg.recipients[0]?.email ? 'email' : 'auto', subject: msg.subject, body: msg.body, files: attachments(d),
      context: {...msg.context, label: `${docName(d)} · ${d.clientName || ''}`.trim()}, templateKey: msg.templateKey});
    // Composeur fermé par Échap : la promesse se résout pendant la touche, avant l'événement « cancel » du dialogue
    // qui refermerait aussitôt la fiche rouverte (même report que afterClose de billing-hub-ui.js).
    await new Promise(resolve => setTimeout(resolve, 0));
    const entry = {date: isoDay(), channel: result?.channel || 'email', recipients: msg.recipients, purpose, recordId: result?.recordId || null};
    const record = () => level ? recordReminder(store(), id, {...entry, level, fee: feeOf(level)}) : logSent(store(), id, entry);
    if (result?.sent) {
      if (await ui.run(record)) ui.toast(level ? `Relance ${level} consignée dans l’historique.` : 'Envoi consigné dans l’historique.', 'success');
    } else if (result?.recordId) ui.toast('Message préparé, envoi non confirmé.', 'info', {label: 'Il est parti', run: async () => { if (await ui.run(record)) { ui.toast('Envoi consigné.', 'success'); view(id); } }});
    if (ui.doc(id)) view(id);
    return result;
  }

  // ---------- Paiement ----------
  function payment(id) {
    const d = must(id); if (!d || !writable(d)) return;
    const b = invoiceBalance(state(), d), due = b.due;
    const body = html`<form id="bd-pay-form" class="form-grid bd-form" novalidate data-id="${d.id}">
      <label>Montant reçu (€) *<input name="amount" inputmode="decimal" value="${due > 0 ? String(due).replace('.', ',') : ''}" data-autofocus autocomplete="off"></label>
      <label>Date du paiement *<input type="date" name="date" value="${isoDay()}"></label>
      <div class="bd-field span-2"><span class="bd-label">Moyen de paiement</span>${ui.chipGroup('method', PAY_METHODS, 'virement', 'Moyen de paiement')}</div>
      <label class="span-2">Référence<input name="reference" maxlength="80" placeholder="N° de chèque, libellé du virement…" autocomplete="off"></label>
      <p class="span-2 bd-pay-note" id="bd-pay-note" role="status">${due > 0 ? `Reste dû avant ce paiement : ${money(due)}.` : 'Facture déjà soldée.'}</p>
      <p class="span-2 form-error hidden" role="alert"></p></form>`;
    ui.modal('Encaisser', `${docName(d)} · ${d.clientName}`, String(body), String(footerBack(d.id, html`<button type="button" class="button primary" data-bdoc="pay-save" data-id="${d.id}">Enregistrer le paiement</button>`)), 'small');
    const f = $('#bd-pay-form'); ui.bindChips(f);
    f?.addEventListener('input', () => { const c = checkPayment(state(), d, {amount: f.amount.value, date: f.date.value}), note = $('#bd-pay-note'); if (!note) return; note.textContent = c.error ? '' : c.overpaid > 0 ? `Trop-perçu de ${money(c.overpaid)} : il pourra être reporté sur une autre facture ou remboursé.` : `Reste dû après ce paiement : ${money(Math.max(0, c.due - c.value))}.`; });
  }
  async function paySave(control) {
    const f = $('#bd-pay-form'), d = must(control.dataset.id); if (!f || !d) return;
    ui.clearFormError(f);
    const c = checkPayment(state(), d, {amount: f.amount.value, date: f.date.value});
    if (c.error) return ui.showFormError(f, c.error, c.field);
    const saved = await ui.run(() => addPayment(store(), d.id, {date: f.date.value, amount: c.value, method: f.method.value || 'virement', reference: f.reference.value}));
    if (!saved) return;
    const p = paymentsOf(saved).at(-1);
    ui.toast(`Paiement de ${money(c.value)} enregistré.`, 'success', p?.id ? {label: 'Annuler', run: async () => { await ui.run(() => removePayment(store(), d.id, p.id)); view(d.id); }} : null);
    if (c.overpaid > 0.005) return overpay(d.id); else view(d.id);
  }
  async function paymentRemove(control) {
    const d = must(control.dataset.id); if (!d || !writable(d)) return;
    const p = paymentsOf(d).find(x => x.id === control.dataset.payment); if (!p) return;
    if (!await ui.run(() => removePayment(store(), d.id, p.id))) return;
    ui.toast(`Paiement de ${money(p.amount)} retiré.`, 'success', {label: 'Annuler', run: async () => { await ui.run(() => addPayment(store(), d.id, {date: p.date, amount: p.amount, method: p.method, reference: p.reference, fromId: p.fromId || null})); view(d.id); }});
    view(d.id);
  }
  // Trop-perçu : report sur une autre facture ouverte du même client, ou remboursement.
  function overpay(id) {
    const d = must(id); if (!d || !writable(d)) return;
    const b = invoiceBalance(state(), d), targets = overpaymentTargets(state(), d);
    if (!(b.overpaid > 0.005)) return view(id);
    const body = html`<form id="bd-over-form" class="form-grid bd-form" novalidate><p class="span-2">Trop-perçu de <strong>${money(b.overpaid)}</strong> sur ${docName(d)}.</p>
      <fieldset class="span-2 bd-proposals"><legend>Que faire de ce montant ?</legend>
        ${targets.map((x, i) => html`<label class="bd-proposal"><input type="radio" name="target" value="${x.doc.id}"${raw(i === 0 ? ' checked' : '')}><span><strong>Reporter sur ${x.doc.number}</strong><small>reste dû ${money(x.due)} · échéance ${dateFr(x.doc.dueDate)}</small></span></label>`)}
        <label class="bd-proposal"><input type="radio" name="target" value="refund"${raw(targets.length ? '' : ' checked')}><span><strong>Rembourser le client</strong><small>enregistré comme paiement négatif</small></span></label>
        <label class="bd-proposal"><input type="radio" name="target" value="later"><span><strong>Décider plus tard</strong><small>le trop-perçu reste visible sur la facture</small></span></label></fieldset>
      <p class="span-2 form-error hidden" role="alert"></p></form>`;
    ui.modal('Trop-perçu', `${docName(d)} · ${d.clientName}`, String(body), String(footerBack(id, html`<button type="button" class="button primary" data-bdoc="over-save" data-id="${id}">Valider</button>`)), 'small');
  }
  async function overSave(control) {
    const f = $('#bd-over-form'), d = must(control.dataset.id); if (!f || !d) return;
    const target = f.querySelector('[name="target"]:checked')?.value || 'later', b = invoiceBalance(state(), d);
    if (target === 'later') return view(d.id);
    if (target === 'refund') { if (await ui.run(() => addPayment(store(), d.id, {date: isoDay(), amount: -b.overpaid, method: 'remboursement', reference: 'Remboursement du trop-perçu'}))) ui.toast(`Remboursement de ${money(b.overpaid)} enregistré.`, 'success'); return view(d.id); }
    const done = await ui.run(() => transferOverpayment(store(), {fromId: d.id, toId: target}));
    if (done) ui.toast(`Trop-perçu reporté sur ${done.number}.`, 'success');
    view(d.id);
  }

  // ---------- Relance ----------
  function remind(id) {
    const d = must(id); if (!d || !writable(d)) return;
    const lv = reminderLevel(state(), d), b = invoiceBalance(state(), d), levels = ui.settings().reminders || [];
    const body = html`<form id="bd-remind-form" class="form-grid bd-form" novalidate>
      <p class="span-2">Reste dû <strong>${money(b.due)}</strong>${lv.daysLate ? html`, ${plural(lv.daysLate, 'jour', 'jours')} de retard` : ''}${lv.sent ? html` · ${plural(lv.sent, 'relance déjà faite', 'relances déjà faites')}` : ''}.</p>
      <div class="bd-field span-2"><span class="bd-label">Niveau de relance</span>${ui.chipGroup('level', [1, 2, 3].map(n => [n, `${n} · ${REMINDER_LABELS[n]}`]), lv.level, 'Niveau de relance')}</div>
      <p class="span-2 bd-help" id="bd-remind-note">${levels.map(l => `Niveau ${l.level} : à ${l.days} jours${l.fee ? `, frais ${money(l.fee)}` : ''}`).join(' · ')}. Le niveau ${lv.level} est proposé d’après le retard et les relances déjà faites.</p>
      <p class="span-2 form-error hidden" role="alert"></p></form>`;
    ui.modal('Relancer', `${docName(d)} · ${d.clientName}`, String(body), String(footerBack(id, html`<button type="button" class="button secondary" data-bdoc="remind-log" data-id="${id}">Consigner sans message</button><button type="button" class="button primary" data-bdoc="remind-go" data-id="${id}">Préparer la relance</button>`)), 'small');
    ui.bindChips($('#bd-remind-form'));
  }
  const feeOf = level => (ui.settings().reminders || []).find(r => r.level === level)?.fee || 0;
  const chosenLevel = () => Math.min(3, Math.max(1, Number($('#bd-remind-form')?.level?.value) || 1));
  async function remindGo(control) { const level = chosenLevel(); return send(control.dataset.id, {purpose: `relance${level}`, level}); }
  async function remindLog(control) {
    const d = must(control.dataset.id); if (!d) return; const level = chosenLevel();
    if (await ui.run(() => recordReminder(store(), d.id, {level, channel: 'autre', recipients: [], fee: feeOf(level)}))) ui.toast(`Relance ${level} consignée (appel, courrier ou visite).`, 'success');
    view(d.id);
  }

  // ---------- Avoir ----------
  function credit(id) {
    const d = must(id); if (!d || !writable(d)) return;
    const lines = (d.lines || []).filter(l => amountLine(l) && lineKind(l) !== 'deduction');
    const body = html`<form id="bd-credit-form" class="form-grid bd-form" novalidate>
      <div class="bd-field span-2"><span class="bd-label">Étendue</span>${ui.chipGroup('mode', [['total', 'Avoir total'], ['partiel', 'Avoir partiel']], 'total', 'Étendue de l’avoir')}</div>
      <fieldset class="span-2 bd-credit-lines" id="bd-credit-lines" hidden><legend>Lignes à reprendre (quantité modifiable)</legend>
        ${lines.map(l => html`<div class="bd-credit-line"><label class="bd-check"><input type="checkbox" name="pick" value="${l.id}"><span>${l.label}<small>${qty(l.quantity)} ${l.unit || ''} × ${money(Number(l.unitPrice))}</small></span></label><label>Quantité<input name="${`qty-${l.id}`}" inputmode="decimal" value="${String(Math.abs(Number(l.quantity) || 0)).replace('.', ',')}"></label></div>`)}</fieldset>
      <p class="span-2 bd-help">L’avoir est préparé en brouillon : vous le vérifiez puis l’émettez. Il ne peut pas dépasser le reste de la facture.</p>
      <p class="span-2 form-error hidden" role="alert"></p></form>`;
    ui.modal('Établir un avoir', `${docName(d)} · ${money(d.totals?.ttc ?? documentTotals(d).ttc)} TTC`, String(body), String(footerBack(id, html`<button type="button" class="button primary" data-bdoc="credit-go" data-id="${id}">Préparer l’avoir</button>`)), 'small');
    const f = $('#bd-credit-form'); ui.bindChips(f);
    f?.addEventListener('click', event => { if (event.target.closest('[data-chip-target="mode"] .choice-chip')) queueMicrotask(() => { const box = $('#bd-credit-lines'); if (box) box.hidden = f.mode.value !== 'partiel'; }); });
  }
  async function creditGo(control) {
    const f = $('#bd-credit-form'), d = must(control.dataset.id); if (!f || !d) return;
    ui.clearFormError(f);
    let lines = null;
    if (f.mode.value === 'partiel') {
      const picks = Object.fromEntries([...f.querySelectorAll('[name="pick"]:checked')].map(i => [i.value, f.elements[`qty-${i.value}`]?.value]));
      const r = creditLines(d, picks); if (r.errors.length) return ui.showFormError(f, r.errors[0], null);
      lines = r.lines;
    }
    const draft = await ui.run(() => createCreditNote(store(), d.id, {lines}));
    if (!draft) return;
    ui.toast('Avoir préparé en brouillon : vérifiez-le puis émettez-le.', 'success');
    ui.openEditor(draft.id);
  }

  // ---------- Devis : acceptation, refus, acompte, facture ----------
  function accept(id) {
    const d = must(id); if (!d || !writable(d)) return;
    const s = invoiceStatus(d, state()), c = d.clientId ? store()?.get('clients', d.clientId) : null;
    const body = html`<form id="bd-accept-form" class="form-grid bd-form" novalidate>
      ${s === 'expire' ? html`<p class="span-2 notice warning">Devis expiré le ${dateFr(d.validUntil)} : l’acceptation sera notée tardive.</p>` : ''}
      <label class="span-2">Signataire *<input name="signatory" value="${c?.contact || ''}" maxlength="120" autocomplete="off" data-autofocus></label>
      <label>Date d’acceptation *<input type="date" name="date" value="${isoDay()}"></label>
      <label class="bd-check span-2"><input type="checkbox" name="good" checked><span>Devis retourné avec la mention « Bon pour accord »</span></label>
      <p class="span-2 form-error hidden" role="alert"></p></form>`;
    ui.modal('Accepter le devis', `${docName(d)} · ${d.clientName}`, String(body), String(footerBack(id, html`<button type="button" class="button primary" data-bdoc="accept-save" data-id="${id}">Enregistrer l’acceptation</button>`)), 'small');
  }
  async function acceptSave(control) {
    const f = $('#bd-accept-form'), d = must(control.dataset.id); if (!f || !d) return;
    ui.clearFormError(f);
    if (!f.signatory.value.trim()) return ui.showFormError(f, 'Champ obligatoire : Nom du signataire', 'signatory');
    try { await acceptQuote(store(), d.id, {date: f.date.value, signatory: f.signatory.value, goodForAgreement: f.good.checked, late: invoiceStatus(d, state()) === 'expire'}); }
    catch (error) { return ui.showFormError(f, error?.message || 'Acceptation impossible.', /date/i.test(error?.message || '') ? 'date' : null); }
    ui.toast(`Devis ${d.number} accepté.`, 'success', {label: 'Annuler', run: async () => { await ui.run(() => patchEmitted(store(), d.id, {status: 'envoye', acceptance: null}, {label: `Acceptation annulée : ${d.number}`})); view(d.id); }});
    view(d.id);
  }
  function refuse(id) {
    const d = must(id); if (!d || !writable(d)) return;
    const body = html`<form id="bd-refuse-form" class="form-grid bd-form" novalidate><label>Date *<input type="date" name="date" value="${isoDay()}"></label>
      <label class="span-2">Motif (facultatif)<textarea name="reason" rows="2" maxlength="300" placeholder="Prix, délai, concurrent…"></textarea></label><p class="span-2 form-error hidden" role="alert"></p></form>`;
    ui.modal('Refus du devis', `${docName(d)} · ${d.clientName}`, String(body), String(footerBack(id, html`<button type="button" class="button primary" data-bdoc="refuse-save" data-id="${id}">Noter le refus</button>`)), 'small');
  }
  async function refuseSave(control) {
    const f = $('#bd-refuse-form'), d = must(control.dataset.id); if (!f || !d) return;
    try { await refuseQuote(store(), d.id, {date: f.date.value, reason: f.reason.value}); } catch (error) { return ui.showFormError(f, error?.message || 'Refus impossible.', 'date'); }
    ui.toast(`Devis ${d.number} noté refusé.`, 'success', {label: 'Annuler', run: async () => { await ui.run(() => patchEmitted(store(), d.id, {status: 'envoye', refusal: null}, {label: `Refus annulé : ${d.number}`})); view(d.id); }});
    view(d.id);
  }
  function deposit(id) {
    const d = must(id); if (!d || !writable(d)) return;
    const prog = quoteProgress(state(), d), pct = ui.settings().depositPct || 30;
    const body = html`<form id="bd-deposit-form" class="form-grid bd-form" novalidate data-id="${id}">
      <p class="span-2">Devis <strong>${money(prog.total)} TTC</strong> · déjà demandé ${money(prog.total - prog.remaining)} · reste ${money(prog.remaining)}.</p>
      <div class="bd-field span-2"><span class="bd-label">Calcul</span>${ui.chipGroup('mode', [['pct', 'Pourcentage du devis'], ['amount', 'Montant TTC']], 'pct', 'Calcul de l’acompte')}</div>
      <label data-mode="pct">Pourcentage (%)<input name="percent" inputmode="decimal" value="${String(pct).replace('.', ',')}" data-autofocus></label>
      <div class="bd-field" data-mode="pct"><span class="bd-label">Raccourcis</span><div class="bd-inline" role="group" aria-label="Pourcentages usuels">${[20, 30, 40, 50].map(p => html`<button type="button" class="small-button" data-bdoc="deposit-pct" data-value="${p}">${p} %</button>`)}</div></div>
      <label data-mode="amount" hidden>Montant TTC (€)<input name="amount" inputmode="decimal" value="${String(Math.min(prog.remaining, Math.round(prog.total * pct) / 100)).replace('.', ',')}"></label>
      <p class="span-2 bd-pay-note" id="bd-deposit-note" role="status"></p>
      <p class="span-2 form-error hidden" role="alert"></p></form>`;
    ui.modal('Demander un acompte', `${docName(d)} · ${d.clientName}`, String(body), String(footerBack(id, html`<button type="button" class="button primary" data-bdoc="deposit-go" data-id="${id}">Préparer l’acompte</button>`)), 'small');
    const f = $('#bd-deposit-form'); ui.bindChips(f);
    const refresh = () => {
      const amountMode = f.mode.value === 'amount'; f.querySelectorAll('[data-mode]').forEach(el => { el.hidden = (el.dataset.mode === 'amount') !== amountMode; });
      const note = $('#bd-deposit-note'); if (!note) return;
      try { const lines = depositLines(d, amountMode ? {amount: f.amount.value} : {percent: f.percent.value}), t = documentTotals({lines}); const asked = amountMode ? Number(String(f.amount.value).replace(',', '.').replace(/\s/g, '')) : NaN, off = Number.isFinite(asked) && Math.abs(t.ttc - asked) >= 0.005; note.textContent = `Acompte de ${money(t.ttc)} TTC (${money(t.ht)} HT) ; reste à facturer ensuite ${money(prog.remaining - t.ttc)}.${off ? ` Montant exact de ${money(asked)} non atteignable avec ce taux de TVA : ${money(t.ttc)} sera facturé.` : ''}`; }
      catch (error) { note.textContent = error?.message || ''; }
    };
    f?.addEventListener('input', refresh); f?.addEventListener('click', event => { if (event.target.closest('.choice-chip')) queueMicrotask(refresh); });
    ui.handlers['deposit-pct'] = c => { f.percent.value = c.dataset.value; refresh(); };
    refresh();
  }
  async function depositGo(control) {
    const f = $('#bd-deposit-form'), d = must(control.dataset.id); if (!f || !d) return;
    ui.clearFormError(f);
    const amountMode = f.mode.value === 'amount';
    let draft;
    try { draft = await createDepositInvoice(store(), d.id, amountMode ? {amount: f.amount.value} : {percent: f.percent.value}); }
    catch (error) { return ui.showFormError(f, error?.message || 'Acompte impossible.', amountMode ? 'amount' : 'percent'); }
    ui.toast('Facture d’acompte préparée : vérifiez-la puis émettez-la.', 'success');
    ui.openEditor(draft.id);
  }
  async function convert(id) {
    const d = must(id); if (!d || !writable(d)) return;
    const draft = await ui.run(() => convertQuote(store(), d.id));
    if (!draft) return;
    ui.toast(`${draft.lines?.some(l => l.kind === 'deduction') ? 'Facture de solde' : 'Facture'} préparée depuis ${d.number || 'la pro forma'} : vérifiez-la puis émettez-la.`, 'success');
    ui.openEditor(draft.id);
  }
  function duplicate(id) {
    const d = must(id); if (!d || !writable(d)) return;
    const t = docTypeOf(d), choices = [['devis', 'Devis'], ['facture', 'Facture'], ['proforma', 'Pro forma']];
    const body = html`<form id="bd-dup-form" class="form-grid bd-form" novalidate><div class="bd-field span-2"><span class="bd-label">Nouveau document</span>${ui.chipGroup('docType', choices, choices.some(([k]) => k === t) ? t : 'facture', 'Type du nouveau document')}</div>
      <p class="span-2 bd-help">Les lignes et conditions sont reprises dans un nouveau brouillon daté d’aujourd’hui, sans lien avec les travaux déjà facturés.</p><p class="span-2 form-error hidden" role="alert"></p></form>`;
    ui.modal('Dupliquer', `${docName(d)} · ${d.clientName}`, String(body), String(footerBack(id, html`<button type="button" class="button primary" data-bdoc="dup-go" data-id="${id}">Créer le brouillon</button>`)), 'small');
    ui.bindChips($('#bd-dup-form'));
  }
  async function dupGo(control) {
    const f = $('#bd-dup-form'), d = must(control.dataset.id); if (!f || !d) return;
    let draft; try { draft = await duplicateDocument(store(), d.id, {docType: f.docType.value}); } catch (error) { return ui.showFormError(f, error?.message || 'Duplication impossible.', null); }
    ui.toast('Brouillon créé par duplication.', 'success'); ui.openEditor(draft.id);
  }

  // ---------- Fichiers : aperçu, PDF, Factur-X, écritures ----------
  function print(id) { const d = must(id); if (!d) return; warmLogo(ui.settings().logo); openPrintable(invoiceHtmlWithQr(state(), d, {assetBase: assetBase()}), docName(d), {pdf: pdfOptions(d)}); }
  function downloadPdf(id) {
    const d = must(id); if (!d) return;
    let file; try { file = pdfFile(pdfBytes(d), invoiceFileName(d)); } catch (error) { ui.toast(error?.message || 'PDF impossible à préparer.', 'error'); return; }
    sharePdf(file, {title: docName(d), preferShare: isTouchDevice()}).then(how => { if (how === 'downloaded') ui.toast(`PDF téléchargé : ${file.name}`, 'success'); }).catch(() => ui.toast('Partage du PDF impossible.', 'error'));
  }
  function xmlDialog(id) {
    const d = must(id); if (!d) return;
    const problems = facturXProblems(state(), d);
    let xml = '', check = null;
    if (!problems.length) { try { xml = facturXml(state(), d); check = validateFacturX(xml); } catch (error) { problems.push(error?.message || 'Factur-X impossible à produire.'); } }
    const body = html`<div class="bd-form">${problems.length ? html`<div class="notice danger bd-notice" role="alert"><p>Factur-X impossible pour l’instant :</p><ul>${problems.map(p => html`<li>${p}</li>`)}</ul></div>`
      : check?.ok ? html`<div class="notice info bd-notice"><p><strong>Contrôles locaux réussis</strong> : profil EN 16931, ordre des éléments, champs obligatoires et règles de calcul (BR-CO-10 à 16).</p></div>`
        : html`<div class="notice warning bd-notice" role="alert"><p>Le XML produit présente des écarts :</p><ul>${(check?.errors || []).map(e => html`<li>${e}</li>`)}</ul></div>`}
      <p class="bd-help">Le XML est remis à côté du PDF lisible : son incorporation dans un PDF/A-3 n’est pas faite par Parcelles. Les plateformes agréées et la plupart des logiciels comptables acceptent ces deux fichiers.</p></div>`;
    ui.modal('Factur-X (XML)', docName(d), String(body), String(footerBack(id, xml ? html`<button type="button" class="button primary" data-bdoc="xml-download" data-id="${id}">Télécharger le XML</button>` : '')), 'small');
  }
  function xmlDownload(control) {
    const d = must(control.dataset.id); if (!d) return;
    try { download(facturXFileName(d), facturXml(state(), d), 'application/xml;charset=utf-8'); ui.toast(`XML téléchargé : ${facturXFileName(d)}`, 'success'); } catch (error) { ui.toast(error?.message || 'Téléchargement impossible.', 'error'); }
  }
  function journal(id) {
    const d = must(id); if (!d) return;
    const j = documentJournal(state(), d), rows = j.entries.flatMap(e => e.rows.map(r => ({...r, journal: e.journal, date: e.date, label: e.label})));
    const body = html`<div class="bd-form">${rows.length ? html`<div class="bd-table-wrap"><table class="bd-table"><caption class="sr-only">Écritures de ${docName(d)}</caption><thead><tr><th scope="col">Journal</th><th scope="col">Date</th><th scope="col">Compte</th><th scope="col">Libellé</th><th scope="col" class="n">Débit</th><th scope="col" class="n">Crédit</th></tr></thead>
        <tbody>${rows.map(r => html`<tr><td>${r.journal}</td><td>${dateFr(r.date)}</td><td>${r.account}${r.aux ? html`<small>${r.aux}</small>` : ''}</td><td>${r.label}</td><td class="n">${r.debit ? money(r.debit) : ''}</td><td class="n">${r.credit ? money(r.credit) : ''}</td></tr>`)}</tbody></table></div>` : html`<p class="empty-state">Aucune écriture : le document n’est pas une pièce comptable émise.</p>`}
      ${j.warnings.length ? html`<ul class="bd-warnings">${j.warnings.map(w => html`<li>${w}</li>`)}</ul>` : ''}
      <p class="bd-help">Écritures façon FEC (ventes, TVA collectée, règlements, lettrage) de cette pièce seulement ; l’export de toute la période se fait depuis le tableau de bord.</p></div>`;
    ui.modal('Écritures comptables', docName(d), String(body), String(footerBack(id, rows.length ? html`<button type="button" class="button primary" data-bdoc="journal-download" data-id="${id}">Télécharger (FEC)</button>` : '')), 'large bd-modal');
  }
  function journalDownload(control) { const d = must(control.dataset.id); if (!d) return; download(`${safeName(`Ecritures ${d.number}`)}.txt`, documentJournal(state(), d).text, 'text/plain;charset=utf-8'); }
  async function removeDraftDoc(id) {
    const d = must(id); if (!d || !writable(d)) return;
    if (!await ui.run(() => deleteDraft(store(), id))) return;
    ui.toast('Brouillon supprimé.', 'success', {label: 'Annuler', run: async () => { await ui.run(() => store().restore('integrationImports', id)); ui.openDocument(id); }});
    ui.openList(docTypeOf(d));
  }

  // ---------- Fiche de facturation d'un client (création rapide ou complément) ----------
  function clientForm({id = null, name = '', onSaved = null, onCancel = null} = {}) {
    if (!ui.canWriteClients()) { ui.toast('Votre rôle ne permet pas de modifier les clients.', 'info'); onCancel?.(); return; }
    const c = id ? store()?.get('clients', id) : null, v = {name, kind: '', ...(c || {})};
    clientCtx = {id: c?.id || null, onSaved, onCancel};
    const terms = [['', 'Selon les paramètres'], ['0', 'À réception'], ['15', '15 jours'], ['30', '30 jours'], ['45', '45 jours'], ['60', '60 jours']];
    const body = html`<form id="bd-client-form" class="form-grid bd-form" novalidate>
      <label class="span-2">Nom ou raison sociale *<input name="name" maxlength="120" value="${v.name || ''}" autocomplete="off" data-autofocus></label>
      <div class="bd-field span-2"><span class="bd-label">Type de client</span>${ui.chipGroup('kind', [['pro', 'Professionnel'], ['particulier', 'Particulier']], v.kind || '', 'Type de client')}</div>
      <label>Contact<input name="contact" maxlength="120" value="${v.contact || ''}" autocomplete="off"></label><label>Téléphone<input name="phone" inputmode="tel" maxlength="30" value="${v.phone || ''}" autocomplete="off"></label>
      <label class="span-2">E-mail de facturation<input type="email" name="billingEmail" maxlength="160" value="${v.billingEmail || v.email || ''}" autocomplete="off"></label>
      <label class="span-2">Adresse de facturation<textarea name="billingAddress" rows="2" maxlength="400">${v.billingAddress || v.address || ''}</textarea></label>
      <label class="span-2">Adresse de livraison<textarea name="deliveryAddress" rows="2" maxlength="400" placeholder="Si elle diffère">${v.deliveryAddress || ''}</textarea></label>
      <label>SIREN ou SIRET<input name="siren" inputmode="numeric" maxlength="17" value="${v.siren || ''}" autocomplete="off"></label><label>N° de TVA intracommunautaire<input name="vatNumber" maxlength="17" value="${v.vatNumber || ''}" autocomplete="off"></label>
      <label>Délai de paiement<select name="paymentDays">${terms.map(([k, l]) => html`<option value="${k}"${raw(String(v.paymentDays ?? '') === k ? ' selected' : '')}>${l}</option>`)}</select></label>
      <label>Remise par défaut (%)<input name="discountPct" inputmode="decimal" value="${v.discountPct ?? ''}" autocomplete="off"></label>
      <div class="span-2" id="bd-client-warn" role="status"></div>
      <p class="span-2 form-error hidden" role="alert"></p></form>`;
    ui.modal(c ? `Facturation : ${c.name}` : 'Nouveau client', 'Coordonnées reprises sur les devis et les factures', String(body), String(html`<button type="button" class="button secondary" data-bdoc="client-cancel">Annuler</button><button type="button" class="button primary" data-bdoc="client-save">Enregistrer</button>`), 'small');
    ui.bindChips($('#bd-client-form'));
  }
  async function clientSave() {
    const f = $('#bd-client-form'); if (!f || !clientCtx) return;
    ui.clearFormError(f);
    const raw0 = Object.fromEntries(new FormData(f)), checked = clientBillingValues(raw0);
    if (checked.error) return ui.showFormError(f, checked.error, checked.field);
    const box = $('#bd-client-warn');
    if (checked.warnings.length && box && box.dataset.shown !== JSON.stringify(checked.warnings)) {
      box.dataset.shown = JSON.stringify(checked.warnings);
      box.innerHTML = String(html`<div class="notice warning"><p>À vérifier :</p><ul>${checked.warnings.map(w => html`<li>${w}</li>`)}</ul><p>Touchez de nouveau « Enregistrer » pour garder ces valeurs.</p></div>`);
      return;
    }
    const prev = clientCtx.id ? store().get('clients', clientCtx.id) : null, value = checked.value;
    const record = {...(prev || {}), ...value, address: prev?.address || value.billingAddress, email: prev?.email || value.billingEmail};
    let saved; try { saved = await store().upsert('clients', record, {label: `Client ${prev ? 'modifié' : 'créé'} : ${value.name}`}); } catch (error) { return ui.showFormError(f, error?.message || 'Enregistrement impossible.', null); }
    const ctx0 = clientCtx; clientCtx = null;
    ui.toast(prev ? 'Fiche de facturation mise à jour.' : `Client créé : ${saved.name}.`, 'success', prev ? null : {label: 'Annuler', run: () => ui.run(() => store().remove('clients', saved.id))});
    ctx0.onSaved ? ctx0.onSaved(saved) : ui.closeModal();
  }

  // ---------- Routeur ----------
  const WRITE = new Set(['edit', 'emit', 'send', 'thank', 'pay', 'remind', 'credit', 'accept', 'refuse', 'deposit', 'invoice', 'balance', 'duplicate', 'transfer', 'delete']);
  function run(key, id) {
    const d = must(id); if (!d) return null;
    if (WRITE.has(key) && key !== 'send' && key !== 'thank' && !writable(d)) return null;
    const map = {edit: () => ui.openEditor(id), emit: () => confirmEmit(id), send: () => send(id), thank: () => send(id, {purpose: 'remerciement'}), pay: () => payment(id), remind: () => remind(id),
      credit: () => credit(id), accept: () => accept(id), refuse: () => refuse(id), deposit: () => deposit(id), invoice: () => convert(id), balance: () => convert(id), duplicate: () => duplicate(id),
      preview: () => print(id), pdf: () => downloadPdf(id), xml: () => xmlDialog(id), journal: () => journal(id), transfer: () => overpay(id), delete: () => removeDraftDoc(id)};
    return (map[key] || (() => view(id)))();
  }
  Object.assign(ui.handlers, {
    view: c => view(c.dataset.id), edit: c => ui.openEditor(c.dataset.id),
    // Écritures : bouton désactivé pendant l'enregistrement (double clic ou double appui avec des gants : une seule écriture).
    'emit-confirm': exclusive(emitConfirmed), 'pay-save': exclusive(paySave), 'payment-remove': exclusive(paymentRemove), 'over-save': exclusive(overSave),
    'remind-go': remindGo, 'remind-log': exclusive(remindLog), 'credit-go': exclusive(creditGo), 'accept-save': exclusive(acceptSave), 'refuse-save': exclusive(refuseSave),
    'deposit-go': exclusive(depositGo), 'dup-go': exclusive(dupGo), 'xml-download': xmlDownload, 'journal-download': journalDownload,
    'client-save': exclusive(clientSave), 'client-cancel': () => { const ctx0 = clientCtx; clientCtx = null; ctx0?.onCancel ? ctx0.onCancel() : ui.closeModal(); }
  });
  return {view, run, confirmEmit, send, clientForm, pdfOptions, totalsHtml, statusOpen: s => OPEN_STATUSES.has(s)};
}
