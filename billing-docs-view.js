// Documents de facturation (v13, chantier A) : fonctions de vue pures, sans DOM, testées par
// test-billing-docs.mjs. Listes (recherche, filtres, tri, statuts calculés), actions possibles selon
// l'état, frise d'un document, opérations sur les lignes de l'éditeur, recherche floue des clients,
// fiche de facturation d'un client, panneau de conformité et écritures comptables d'une pièce.
// Rien n'est écrit ici : billing-docs-ui.js appelle le moteur (invoices.js, billing.js) après un geste.
import {normalize} from './utils.js';
import {DOC_LABELS, STATUS_LABELS, ACCOUNTING_TYPES, PAYMENT_TERMS, billingDocs, docTypeOf, documentTotals, invoiceBalance,
  invoiceStatus, isoDay, daysBetween, addDays, lineKind, amountLine, round2, dateFr, creditNotesOf, paymentsOf, methodLabel,
  validDay, luhnValid, invoices, emissionProblems, complianceReport, allocateNumber, invoiceSettings, clientSnapshot, clientTerms,
  validateDraft, cleanLine, billableItems, kindOfDocType} from './invoices.js';
import {depositsOf, quoteProgress, catalogItems, catalogPrice} from './billing.js';
import {suggestPrice} from './billing-insights.js';
import {FEC_HEADERS, billingJournal, fecTable} from './billing-export.js';

const text = v => String(v ?? '').trim();
const loose = v => { if (v === null || v === undefined || String(v).trim() === '') return null; const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const NB = ' ';
export const money = v => v === null || v === undefined || !Number.isFinite(v) ? '—' : `${new Intl.NumberFormat('fr-FR', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(v).replace(/[  ]/g, NB).replace(/^-/, '−')}${NB}€`;
export const rateLabel = r => `${String(r).replace('.', ',')}${NB}%`;

// ---------- Listes ----------
export const LIST_TYPES = [['devis', 'Devis'], ['facture', 'Factures'], ['acompte', 'Acomptes'], ['avoir', 'Avoirs'], ['proforma', 'Pro forma'], ['all', 'Tout']];
const INVOICE_FILTERS = [['all', 'Toutes'], ['brouillon', 'Brouillons'], ['due', 'À encaisser'], ['retard', 'En retard'], ['partielle', 'Partielles'], ['payee', 'Payées'], ['annulee', 'Annulées']];
export const STATUS_FILTERS = {
  devis: [['all', 'Tous'], ['brouillon', 'Brouillons'], ['envoye', 'Envoyés'], ['accepte', 'Acceptés'], ['refuse', 'Refusés'], ['expire', 'Expirés'], ['converti', 'Facturés']],
  facture: INVOICE_FILTERS,
  acompte: INVOICE_FILTERS,
  avoir: [['all', 'Tous'], ['brouillon', 'Brouillons'], ['avoir', 'Émis']],
  proforma: [['all', 'Toutes'], ['brouillon', 'Brouillons'], ['envoye', 'Émises'], ['converti', 'Facturées']],
  all: [['all', 'Tout'], ['brouillon', 'Brouillons'], ['due', 'À encaisser'], ['retard', 'En retard'], ['payee', 'Payées'], ['envoye', 'Devis en attente']]
};
export const SORTS = [['recent', 'Plus récents'], ['oldest', 'Plus anciens'], ['due', 'Échéance la plus proche'], ['amount-desc', 'Montant décroissant'], ['amount-asc', 'Montant croissant'], ['client', 'Client (A → Z)'], ['number', 'Numéro']];
export const OPEN_STATUSES = new Set(['emise', 'partielle', 'retard']);
export const listTypeLabel = t => (LIST_TYPES.find(([k]) => k === t) || LIST_TYPES[5])[1];
export const newLabel = t => ({devis: 'Nouveau devis', facture: 'Nouvelle facture', proforma: 'Nouvelle pro forma', acompte: 'Nouvel acompte', avoir: 'Nouvel avoir'})[t] || 'Nouveau document';
export const clientKeyOf = doc => text(doc?.clientId) || `nom:${normalize(doc?.clientName)}`;
const payable = t => t === 'facture' || t === 'acompte';

/** Ligne de liste d'un document : statut calculé, montant, reste dû, retard. */
export function docRow(state, doc, today = isoDay()) {
  const t = docTypeOf(doc), draft = doc.status === 'brouillon', status = invoiceStatus(doc, state, today);
  const totals = draft ? documentTotals(doc) : doc.totals || documentTotals(doc);
  const b = payable(t) && !draft ? invoiceBalance(state, doc) : null;
  return {
    id: doc.id, doc, type: t, typeLabel: DOC_LABELS[t], number: text(doc.number),
    title: doc.number || (t === 'proforma' && !draft ? 'Pro forma' : draft ? 'Brouillon' : DOC_LABELS[t]),
    clientName: text(doc.clientName) || 'Client', clientKey: clientKeyOf(doc), issueDate: text(doc.issueDate), dueDate: text(doc.dueDate),
    validUntil: text(doc.validUntil), status, statusLabel: STATUS_LABELS[status] || status, draft, ttc: totals.ttc,
    due: b ? b.due : null, paid: b ? b.paid : null, overpaid: b ? b.overpaid : 0,
    lateDays: status === 'retard' && doc.dueDate ? Math.max(0, daysBetween(doc.dueDate, today)) : 0,
    expiresIn: t === 'devis' && status === 'envoye' && doc.validUntil ? daysBetween(today, doc.validUntil) : null
  };
}
// Texte cherché : numéro, client, objet, référence, désignations, montant (« 1250,50 » comme « 1250.5 »).
function haystack(row) {
  const d = row.doc, amount = Math.abs(row.ttc || 0);
  return normalize([row.number, row.clientName, d.subject, d.reference, d.note, row.typeLabel, row.statusLabel,
    ...(d.lines || []).map(l => l?.label), amount.toFixed(2), amount.toFixed(2).replace('.', ','), String(round2(amount))].filter(Boolean).join(' '));
}
/** filter : {query, status, client, from, to, min, max} ; montants comparés en valeur absolue TTC. */
export function matchesFilter(row, filter = {}) {
  const status = filter.status || 'all';
  if (status === 'due' ? !OPEN_STATUSES.has(row.status) : status !== 'all' && row.status !== status) return false;
  if (filter.client && row.clientKey !== filter.client) return false;
  const day = row.issueDate;
  if (filter.from && (!day || day < filter.from)) return false;
  if (filter.to && (!day || day > filter.to)) return false;
  const amount = Math.abs(row.ttc || 0), min = loose(filter.min), max = loose(filter.max);
  if (min !== null && amount < min - 0.005) return false;
  if (max !== null && amount > max + 0.005) return false;
  const tokens = normalize(filter.query).split(' ').filter(Boolean);
  if (tokens.length) { const hay = haystack(row); if (!tokens.every(t => hay.includes(t))) return false; }
  return true;
}
const byText = (a, b) => a.localeCompare(b, 'fr', {numeric: true, sensitivity: 'base'});
export function sortRows(rows, sort = 'recent') {
  const list = [...rows], draftFirst = (a, b) => (a.draft ? 0 : 1) - (b.draft ? 0 : 1);
  const cmp = {
    recent: (a, b) => draftFirst(a, b) || byText(b.issueDate, a.issueDate) || byText(b.number, a.number),
    oldest: (a, b) => byText(a.issueDate, b.issueDate) || byText(a.number, b.number),
    due: (a, b) => byText(a.dueDate || a.validUntil || '9999', b.dueDate || b.validUntil || '9999') || byText(a.number, b.number),
    'amount-desc': (a, b) => Math.abs(b.ttc) - Math.abs(a.ttc),
    'amount-asc': (a, b) => Math.abs(a.ttc) - Math.abs(b.ttc),
    client: (a, b) => byText(a.clientName, b.clientName) || byText(b.issueDate, a.issueDate),
    number: (a, b) => byText(b.number || '~', a.number || '~')
  }[sort] || null;
  return cmp ? list.sort(cmp) : list;
}
export function listRows(state, docType = 'all', filter = {}, today = isoDay()) {
  return filterRows(docRows(state, docType, today), filter);
}
/** Lignes d'un type, sans filtre ni tri : calculées une fois par ouverture de liste, puis filtrées à chaque frappe. */
export const docRows = (state, docType = 'all', today = isoDay()) => billingDocs(state).filter(d => docType === 'all' || docTypeOf(d) === docType).map(d => docRow(state, d, today));
export const filterRows = (rows, filter = {}) => sortRows(rows.filter(r => matchesFilter(r, filter)), filter.sort || 'recent');
/** Clients du filtre : ceux de la liste, plus le client filtré même sans document (bouton « Documents » de sa fiche). */
export function filterClients(state, docType = 'all', key = '') {
  const list = listClients(state, docType);
  if (!key || list.some(c => c.key === key)) return list;
  const c = (state?.clients || []).find(x => x.id === key && !x.deletedAt);
  const name = c ? text(c.name) || 'Client' : key.startsWith('nom:') ? key.slice(4) : '';
  return name ? [...list, {key, name}].sort((a, b) => byText(a.name, b.name)) : list;
}
/** Synthèse d'une liste : nombre, total TTC, reste dû, retards, brouillons. */
export function listSummary(rows) {
  return {count: rows.length, ttc: round2(rows.reduce((s, r) => s + (r.ttc || 0), 0)), due: round2(rows.reduce((s, r) => s + (r.due || 0), 0)),
    late: rows.filter(r => r.status === 'retard').length, lateDue: round2(rows.filter(r => r.status === 'retard').reduce((s, r) => s + (r.due || 0), 0)), drafts: rows.filter(r => r.draft).length};
}
/** Clients présents dans une liste (pour le filtre client), triés par nom. */
export function listClients(state, docType = 'all') {
  const seen = new Map();
  for (const d of billingDocs(state)) if (docType === 'all' || docTypeOf(d) === docType) { const k = clientKeyOf(d); if (!seen.has(k)) seen.set(k, text(d.clientName) || 'Client'); }
  return [...seen].map(([key, name]) => ({key, name})).sort((a, b) => byText(a.name, b.name));
}

// ---------- Actions selon l'état ----------
export const ACTION_LABELS = {
  edit: 'Modifier', emit: 'Émettre', send: 'Envoyer', pay: 'Encaisser', remind: 'Relancer', credit: 'Avoir', accept: 'Accepter', refuse: 'Refuser',
  deposit: 'Acompte', invoice: 'Facturer', balance: 'Facture de solde', duplicate: 'Dupliquer', preview: 'Aperçu', pdf: 'PDF', xml: 'Factur-X',
  journal: 'Écritures', transfer: 'Reporter le trop-perçu', thank: 'Remercier', delete: 'Supprimer le brouillon', open: 'Ouvrir'
};
/** Actions possibles sur un document, dans l'ordre d'importance (la première est l'action principale). */
export function docActions(state, doc, {canWrite = true, today = isoDay()} = {}) {
  const t = docTypeOf(doc), s = invoiceStatus(doc, state, today), out = [];
  const add = (...keys) => { for (const k of keys) if (!out.includes(k)) out.push(k); };
  const read = ['preview', 'pdf'];
  if (!canWrite) { add(...read); if (ACCOUNTING_TYPES.has(t) && doc.status !== 'brouillon') add('xml', 'journal'); return out; }
  if (doc.status === 'brouillon') { add('edit', 'emit', 'preview', 'delete'); return out; }
  if (t === 'devis') {
    if (s === 'envoye') add('accept', 'send', 'refuse');
    if (s === 'expire') add('accept', 'duplicate', 'refuse');
    if (s === 'accepte' || s === 'converti') {
      const prog = quoteProgress(state, doc), deps = depositsOf(state, doc.id);
      if (!prog.finalInvoices.length) { add(deps.length ? 'balance' : 'invoice'); if (prog.remaining > 0.005) add('deposit'); }
    }
    add('send', 'duplicate');
  } else if (t === 'proforma') {
    if (!invoices(state).some(i => i.quoteId === doc.id && docTypeOf(i) === 'facture' && invoiceStatus(i, state, today) !== 'annulee')) add('invoice');
    add('send', 'duplicate');
  } else if (t === 'avoir') add('send');
  else {
    const b = invoiceBalance(state, doc);
    if (OPEN_STATUSES.has(s)) add('pay', s === 'retard' ? 'remind' : 'send', s === 'retard' ? 'send' : 'remind');
    if (b.overpaid > 0.005) add('transfer');
    if (s === 'payee') add('thank', 'send');
    if (s !== 'annulee') add('credit');
    if (t === 'facture') add('duplicate');
  }
  add(...read);
  if (ACCOUNTING_TYPES.has(t)) add('xml', 'journal');
  return out;
}
/** Deux actions rapides au plus pour une ligne de liste. */
export const rowActions = (state, doc, options) => docActions(state, doc, options).filter(k => !['preview', 'pdf', 'xml', 'journal', 'delete', 'duplicate', 'refuse', 'thank'].includes(k)).slice(0, 2);
export function actionLabel(key, doc, state = null) {
  const t = docTypeOf(doc);
  if (key === 'emit') return t === 'devis' ? 'Émettre le devis' : t === 'proforma' ? 'Finaliser la pro forma' : t === 'avoir' ? 'Émettre l’avoir' : t === 'acompte' ? 'Émettre l’acompte' : 'Émettre la facture';
  if (key === 'invoice' && state && t === 'devis' && depositsOf(state, doc.id).length) return ACTION_LABELS.balance;
  return ACTION_LABELS[key] || key;
}

// ---------- Relances, paiements, avoirs ----------
/** Niveau de relance proposé : celui atteint par le retard, sinon le suivant du dernier envoyé (3 au plus). */
export function reminderLevel(state, doc, today = isoDay()) {
  const levels = invoiceSettings(state).reminders, sent = Math.max(0, ...(doc.reminders || []).map(r => Number(r.level) || 0));
  const late = doc.dueDate ? daysBetween(doc.dueDate, today) : 0, reached = levels.filter(l => late >= l.days).pop();
  const level = Math.min(3, Math.max(reached?.level || 1, sent + 1));
  return {level, sent, daysLate: Math.max(0, late), fee: levels.find(l => l.level === level)?.fee || 0, reached: reached?.level || 0};
}
/** Autres factures ouvertes du même client, pour reporter un trop-perçu. */
export function overpaymentTargets(state, doc, today = isoDay()) {
  const key = clientKeyOf(doc);
  return invoices(state).filter(i => i.id !== doc.id && payable(docTypeOf(i)) && i.status !== 'brouillon' && clientKeyOf(i) === key && OPEN_STATUSES.has(invoiceStatus(i, state, today)))
    .map(i => ({doc: i, due: invoiceBalance(state, i).due})).filter(x => x.due > 0.005).sort((a, b) => byText(a.doc.dueDate || '', b.doc.dueDate || ''));
}
/** Paiement saisi : montant (virgule admise), contrôle et trop-perçu éventuel. */
export function checkPayment(state, doc, {amount, date} = {}) {
  const a = loose(amount), b = invoiceBalance(state, doc);
  if (!validDay(text(date))) return {error: 'Date de paiement invalide.', field: 'date'};
  if (a === null || a <= 0) return {error: 'Montant du paiement invalide : saisissez un montant positif.', field: 'amount'};
  return {value: round2(a), overpaid: round2(Math.max(0, a - b.due)), due: b.due};
}
/** Lignes d'un avoir partiel : picks = {idLigne: quantité} ; quantité plafonnée à celle de la facture. */
export function creditLines(doc, picks = {}) {
  const out = [], errors = [];
  for (const l of doc.lines || []) {
    if (!amountLine(l) || lineKind(l) === 'deduction' || !(l.id in picks)) continue;
    const q = loose(picks[l.id]), max = Math.abs(Number(l.quantity) || 0);
    if (q === null || q <= 0) continue;
    if (q > max + 1e-9) { errors.push(`${l.label} : ${String(q).replace('.', ',')} dépasse la quantité facturée (${String(max).replace('.', ',')}).`); continue; }
    out.push({...l, quantity: q});
  }
  if (!out.length && !errors.length) errors.push('Choisissez au moins une ligne à reprendre dans l’avoir.');
  return {lines: out, errors};
}

// ---------- Frise d'un document ----------
const CHANNEL_LABELS = {email: 'par e-mail', sms: 'par SMS', whatsapp: 'par WhatsApp', share: 'par partage', courrier: 'par courrier', autre: ''};
const who = list => (list || []).map(r => r?.name).filter(Boolean).join(', ');
/** Événements datés : création, émission, envois, relances, paiements, réponse au devis, conversions, avoirs. */
export function timeline(state, doc) {
  const out = [], t = docTypeOf(doc), all = billingDocs(state), find = id => all.find(d => d.id === id);
  const push = (date, kind, label, extra = {}) => { if (date || extra.at) out.push({date: text(date).slice(0, 10), at: extra.at || 0, kind, label, ...extra}); };
  if (doc.createdAt) push(isoDay(new Date(doc.createdAt)), 'create', `${DOC_LABELS[t]} préparé${t === 'devis' || t === 'avoir' ? '' : 'e'} en brouillon`, {at: Number(doc.createdAt) || 0});
  if (doc.quoteId) { const q = find(doc.quoteId); push(doc.createdAt ? isoDay(new Date(doc.createdAt)) : doc.issueDate, 'link', `Issu du devis ${q?.number || doc.quoteNumber || ''}`.trim(), {docId: doc.quoteId, at: (Number(doc.createdAt) || 0) + 1}); }
  if (t === 'avoir' && doc.creditOf) push(doc.issueDate, 'link', `Avoir sur la facture ${doc.creditOfNumber || find(doc.creditOf)?.number || ''}`.trim(), {docId: doc.creditOf});
  if (doc.status !== 'brouillon') push(doc.issueDate, 'emit', doc.number ? `${t === 'devis' ? 'Devis émis' : 'Émis'} sous le n° ${doc.number}` : 'Finalisé (sans numéro)', {at: Number(doc.emittedAt) || 0});
  for (const s of doc.sentLog || []) if (!/^relance/.test(s.purpose || '')) push(s.date, 'send', `${s.purpose === 'remerciement' ? 'Remerciement envoyé' : 'Envoyé'} ${CHANNEL_LABELS[s.channel] || ''}${who(s.recipients) ? ` à ${who(s.recipients)}` : ''}`.replace(/\s+/g, ' ').trim(), {at: s.at || 0, recordId: s.recordId || null});
  for (const r of doc.reminders || []) push(r.date, 'remind', `Relance ${r.level} ${CHANNEL_LABELS[r.channel] || ''}${r.due ? ` · reste ${money(r.due)}` : ''}${r.fee ? ` · frais ${money(r.fee)}` : ''}`.replace(/\s+/g, ' ').trim(), {at: r.at || 0});
  for (const p of paymentsOf(doc)) {
    if (p.legacy) { push(p.date, 'pay', `Payée${p.method ? ` · ${p.method}` : ''}`); continue; }
    const negative = p.amount < 0, label = negative ? (p.method === 'compensation' ? 'Trop-perçu reporté' : 'Remboursement') : p.method === 'compensation' ? 'Compensation' : 'Paiement';
    push(p.date, negative ? 'refund' : 'pay', `${label} de ${money(Math.abs(p.amount))}${p.method && !['compensation', 'remboursement'].includes(p.method) ? ` · ${methodLabel(p.method)}` : ''}${p.reference ? ` · ${p.reference}` : ''}`, {at: p.at || 0, paymentId: p.id, docId: p.fromId || null});
  }
  if (doc.acceptance) push(doc.acceptance.date, 'accept', `Accepté par ${doc.acceptance.signatory}${doc.acceptance.goodForAgreement ? ' (« Bon pour accord »)' : ''}${doc.acceptance.late ? ' · acceptation tardive' : ''}`, {at: doc.acceptance.at || 0});
  if (doc.refusal) push(doc.refusal.date, 'refuse', `Refusé${doc.refusal.reason ? ` : ${doc.refusal.reason}` : ''}`, {at: doc.refusal.at || 0});
  for (const c of doc.conversions || []) { const d = find(c.id); push(d?.issueDate || isoDay(new Date(c.at || Date.now())), 'convert', `${c.type === 'acompte' ? 'Acompte' : 'Facture'} ${d?.number || (d ? 'en brouillon' : 'supprimée')}${d ? ` · ${money((d.totals || documentTotals(d)).ttc)}` : ''}`, {at: c.at || 0, docId: c.id}); }
  if (payable(t) && doc.status !== 'brouillon') for (const a of creditNotesOf(state, doc)) push(a.issueDate, 'credit', `Avoir ${a.number} de ${money(Math.abs(a.totals?.ttc || 0))}`, {at: Number(a.emittedAt) || 0, docId: a.id});
  if (t === 'acompte') { const fin = invoices(state).find(i => docTypeOf(i) === 'facture' && (i.lines || []).some(l => l.source?.type === 'deposit' && l.source.id === doc.id)); if (fin) push(fin.issueDate, 'link', `Déduit de la facture ${fin.number || 'en brouillon'}`, {docId: fin.id}); }
  // La préparation ouvre toujours la frise, même si le document est daté d'avant sa saisie.
  return out.sort((a, b) => (a.kind === 'create' ? 0 : 1) - (b.kind === 'create' ? 0 : 1) || byText(a.date, b.date) || a.at - b.at);
}

// ---------- Lignes de l'éditeur ----------
let lineSeq = 0;
export const newLineId = () => `n${Date.now().toString(36)}${(lineSeq += 1).toString(36)}`;
export function newLine(kind = 'item', {vatRate = 20, unit = 'u'} = {}) {
  const id = newLineId();
  if (kind === 'section') return {id, kind, label: ''};
  if (kind === 'subtotal') return {id, kind, label: 'Sous-total'};
  if (kind === 'comment') return {id, kind, label: '', description: ''};
  return {id, label: '', quantity: 1, unit, unitPrice: null, vatRate};
}
export function moveLine(lines, from, to) {
  const list = [...lines];
  if (from < 0 || from >= list.length) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  const [line] = list.splice(from, 1); list.splice(target, 0, line);
  return list;
}
export function duplicateLine(lines, index) {
  const list = [...lines], src = list[index];
  if (!src) return list;
  const {source: _source, ...copy} = src;
  list.splice(index + 1, 0, {...JSON.parse(JSON.stringify(copy)), id: newLineId()});
  return list;
}
export const removeLine = (lines, index) => lines.filter((_, i) => i !== index);
/** Montant HT d'une ligne pour l'affichage (null si prix ou quantité manquant). */
export function lineAmount(l) {
  if (!amountLine(l)) return null;
  const q = loose(l.quantity), p = loose(l.unitPrice); if (q === null || p === null) return null;
  // Même règle que le moteur (cleanLine, lineTotal) : une remise hors de ]0 ; 100] n'est jamais appliquée.
  const d = loose(l.discountPct); return round2(d !== null && d > 0 && d <= 100 ? q * p * (1 - d / 100) : q * p);
}
/** Remise de ligne saisie hors de 0 à 100 % (refusée à l'enregistrement par validateDraft). */
export const discountInvalid = v => { const d = loose(v); return d !== null && (d < 0 || d > 100); };
/** État de l'éditeur repris après une fenêtre intermédiaire : saisie de `back`, identifiant et version de `current`. */
export const restoreEditor = (back, current) => current?.id ? {...back, id: current.id, version: current.version ?? null} : {...back};
/** Action d'écriture déclenchée par un bouton : désactivé dès l'appui et jusqu'à la fin ; réactivé s'il est encore
 * affiché (erreur, saisie à corriger), un second appui pendant l'écriture est ignoré. */
export const exclusive = fn => async (control, ...rest) => {
  if (!control || control.disabled) return undefined;
  control.disabled = true;
  try { return await fn(control, ...rest); } finally { if (control.isConnected !== false) control.disabled = false; }
};
/** Échéance calculée : date d'émission + délai (jours). */
export const dueDateFor = (issueDate, days) => validDay(issueDate) && Number.isFinite(Number(days)) ? addDays(issueDate, Number(days)) : '';
/** Délai de paiement d'un document (jours entre émission et échéance), si c'est l'un des délais usuels. */
export const termOf = doc => { if (!validDay(doc?.issueDate) || !validDay(doc?.dueDate)) return null; const d = daysBetween(doc.issueDate, doc.dueDate); return PAYMENT_TERMS.includes(d) ? d : null; };

// ---------- Clients ----------
// Distance d'édition avec inversion de deux lettres voisines (« bios » pour « bois » : une seule faute).
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({length: a.length + 1}, (_, i) => Array.from({length: b.length + 1}, (_v, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const subsequence = (q, s) => { let i = 0; for (const ch of s) if (ch === q[i]) i += 1; return i === q.length; };
/** Score de ressemblance (0 = aucun) entre une recherche et un client : nom, contact, SIREN, e-mail, commune. */
export function clientScore(client, query) {
  const q = normalize(query); if (!q) return 1;
  const name = normalize(client?.name), extra = normalize([client?.contact, client?.siren, client?.billingEmail || client?.email, client?.address, client?.billingAddress].filter(Boolean).join(' '));
  if (name === q) return 100;
  if (name.startsWith(q)) return 85;
  const words = name.split(' ').filter(Boolean), tokens = q.split(' ').filter(Boolean);
  if (words.some(w => w.startsWith(q))) return 75;
  if (name.includes(q)) return 65;
  if (tokens.every(t => name.includes(t))) return 55;
  if (tokens.every(t => `${name} ${extra}`.includes(t))) return 45;
  const initials = words.map(w => w[0]).join('');
  if (q.length >= 2 && !q.includes(' ') && initials.startsWith(q)) return 40;
  if (q.length >= 4 && tokens.every(t => words.some(w => distance(t, w.slice(0, Math.max(t.length, Math.min(w.length, t.length + 1)))) <= (t.length >= 7 ? 2 : 1)))) return 35;
  if (q.length >= 3 && subsequence(q.replace(/ /g, ''), name.replace(/ /g, ''))) return 20;
  return 0;
}
/** Recherche floue des clients actifs (fautes de frappe, initiales, SIREN, e-mail). */
export function fuzzyClients(clients, query, {limit = 8} = {}) {
  return (clients || []).filter(c => c && !c.deletedAt && !c.archived).map(c => ({client: c, score: clientScore(c, query)})).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || byText(text(a.client.name), text(b.client.name))).slice(0, limit).map(x => x.client);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Champs de facturation d'une fiche client (création rapide ou complément de fiche). */
export function clientBillingValues(v = {}) {
  const siren = text(v.siren).replace(/\s/g, ''), vat = text(v.vatNumber).replace(/\s/g, '').toUpperCase(), email = text(v.billingEmail);
  const days = loose(v.paymentDays), pct = loose(v.discountPct), warnings = [];
  const out = {name: text(v.name).slice(0, 120), kind: ['pro', 'particulier'].includes(v.kind) ? v.kind : '', contact: text(v.contact).slice(0, 120), phone: text(v.phone).slice(0, 30),
    siren, vatNumber: vat, billingAddress: text(v.billingAddress).slice(0, 400), deliveryAddress: text(v.deliveryAddress).slice(0, 400), billingEmail: email.slice(0, 160),
    paymentDays: days === null ? null : Math.floor(days), discountPct: pct === null || pct === 0 ? null : round2(pct)};
  if (!out.name) return {error: 'Champ obligatoire : Nom du client', field: 'name'};
  if (siren && !/^\d{9}(\d{5})?$/.test(siren)) return {error: 'SIREN invalide : 9 chiffres (ou SIRET : 14 chiffres).', field: 'siren'};
  if (siren && !luhnValid(siren.slice(0, 9))) warnings.push('SIREN : la clé de contrôle ne correspond pas, vérifiez-le.');
  if (vat && !/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(vat)) return {error: 'N° de TVA intracommunautaire invalide (ex. FR12345678901).', field: 'vatNumber'};
  if (vat.startsWith('FR') && siren && vat.slice(-9) !== siren.slice(0, 9)) warnings.push('Le n° de TVA ne correspond pas au SIREN saisi.');
  if (email && !EMAIL_RE.test(email)) return {error: 'E-mail de facturation invalide.', field: 'billingEmail'};
  if (out.paymentDays !== null && (out.paymentDays < 0 || out.paymentDays > 120)) return {error: 'Délai de paiement : entre 0 et 120 jours.', field: 'paymentDays'};
  if (out.discountPct !== null && (out.discountPct < 0 || out.discountPct > 100)) return {error: 'Remise par défaut : entre 0 et 100 %.', field: 'discountPct'};
  if (out.kind === 'pro' && !siren && !vat) warnings.push('Client professionnel : le SIREN sera obligatoire sur les factures (réforme 2027).');
  return {value: out, warnings};
}

// ---------- Conformité ----------
/** Correction proposée pour un message de conformité : champ du document, ligne, fiche client ou paramètres. */
export function fixFor(message) {
  const m = String(message || ''), line = /ligne (\d+)/i.exec(m);
  if (line) return {type: 'line', index: Number(line[1]) - 1};
  if (/Paramètres|du vendeur|capital|RCS|indemnité forfaitaire|Mention|régime|Franchise|Remboursement forfaitaire/i.test(m)) return {type: 'settings'};
  if (/Adresse du client|SIREN du client|n° de TVA du client|TVA ou le SIREN du client|Client/i.test(m)) return {type: 'client'};
  if (/Échéancier/i.test(m)) return {type: 'field', field: 'dueDate'};
  if (/Date d’émission|chronologique/i.test(m)) return {type: 'field', field: 'issueDate'};
  if (/Échéance/i.test(m)) return {type: 'field', field: 'dueDate'};
  if (/livraison|prestation/i.test(m)) return {type: 'field', field: 'deliveryDate'};
  if (/validité/i.test(m)) return {type: 'field', field: 'validUntil'};
  if (/Remise/i.test(m)) return {type: 'field', field: 'discountValue'};
  if (/au moins une ligne|Total négatif|total négatif/i.test(m)) return {type: 'lines'};
  return null;
}
/** Erreurs bloquantes (émission) et avertissements, sans doublon, chacun avec sa correction. */
export function complianceItems(state, doc, today = isoDay()) {
  const t = docTypeOf(doc), errors = emissionProblems(state, doc, t, {today}), report = complianceReport(state, doc, {today});
  const seen = new Set(), out = [];
  for (const [level, list] of [['error', errors], ['warning', report.warnings]]) for (const m of list) if (!seen.has(m)) { seen.add(m); out.push({level, text: m, fix: fixFor(m)}); }
  return {items: out, errors: out.filter(i => i.level === 'error').length, warnings: out.filter(i => i.level === 'warning').length, mentions: report.mentions};
}
/** Numéro que recevra le document à l'émission (aucun pour une pro forma). */
export function upcomingNumber(state, doc, today = isoDay()) {
  const t = docTypeOf(doc); if (t === 'proforma') return null;
  try { return allocateNumber(state, t, doc.issueDate || today).number || null; } catch { return null; }
}

// ---------- Écritures comptables d'une pièce ----------
/** Écritures (façon FEC) de cette pièce seulement : vente et règlements. */
export function documentJournal(state, doc) {
  const journal = billingJournal(state, {}), entries = journal.entries.filter(e => e.piece && e.piece === doc.number);
  return {entries, warnings: journal.warnings.filter(w => w.includes(doc.number)), text: [FEC_HEADERS, ...fecTable({entries})].map(r => r.map(v => String(v ?? '').replace(/[|\r\n\t]+/g, ' ')).join('|')).join('\r\n')};
}
/** Nom de fichier sûr. */
export const safeName = v => String(v || 'document').replace(/[’]/g, "'").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
export {dateFr};
export const plural = (n, one, many) => `${n} ${Math.abs(n) > 1 ? many : one}`;

// ---------- Éditeur : état, valeurs, document de travail ----------
export const EDITABLE_TYPES = [['devis', 'Devis'], ['facture', 'Facture'], ['proforma', 'Pro forma']];
export const TERM_CHOICES = [[0, 'À réception'], [15, '15 jours'], [30, '30 jours'], [45, '45 jours'], [60, '60 jours']];
export const VALIDITY_CHOICES = [15, 30, 60, 90];
const QUOTE_TYPES = new Set(['devis', 'proforma']);
export const isQuoteType = t => QUOTE_TYPES.has(t);

/** État de l'éditeur : un brouillon enregistré, ou un document neuf ({docType}). Les montants restent des chaînes saisies. */
export function editorState(doc = {}, {settings = null, today = isoDay()} = {}) {
  const t = docTypeOf(doc), s = settings || {paymentDays: 30, vatRate: 20, quoteValidityDays: 30}, quote = QUOTE_TYPES.has(t);
  const issueDate = validDay(text(doc.issueDate)) ? text(doc.issueDate) : today;
  const dueDate = quote ? '' : validDay(text(doc.dueDate)) ? text(doc.dueDate) : addDays(issueDate, s.paymentDays);
  const term = quote ? null : termOf({issueDate, dueDate});
  return {
    id: doc.id || null, version: doc.version ?? null, docType: t, creditOf: doc.creditOf || null, creditOfNumber: text(doc.creditOfNumber), quoteId: doc.quoteId || null, quoteNumber: text(doc.quoteNumber),
    clientId: text(doc.clientId), clientName: text(doc.clientName), clientAddress: text(doc.clientAddress), clientSiren: text(doc.clientSiren), clientVat: text(doc.clientVat),
    clientKind: text(doc.clientKind), clientEmail: text(doc.clientEmail), clientPhone: text(doc.clientPhone), deliveryAddress: text(doc.deliveryAddress),
    issueDate, dueDate, term: quote ? null : term === null ? 'autre' : term, deliveryDate: text(doc.deliveryDate),
    validUntil: t === 'devis' ? (validDay(text(doc.validUntil)) ? text(doc.validUntil) : addDays(issueDate, s.quoteValidityDays)) : '',
    reference: text(doc.reference), subject: text(doc.subject), note: text(doc.note), terms: text(doc.terms), goodForAgreement: doc.goodForAgreement !== false,
    operationNature: text(doc.operationNature),
    discountType: doc.discount?.type === 'amount' ? 'amount' : 'pct', discountValue: doc.discount?.value ?? '',
    shippingLabel: text(doc.shipping?.label) || 'Frais de déplacement', shippingAmount: doc.shipping?.amount ?? '', shippingVat: doc.shipping?.vatRate ?? s.vatRate,
    lines: (doc.lines || []).map(l => ({...l, id: text(l?.id) || newLineId()}))
  };
}
/** Valeurs envoyées à saveDraft (contrôlées par validateDraft). */
export function draftValues(ed) {
  const quote = QUOTE_TYPES.has(ed.docType);
  const out = {clientId: ed.clientId || '', clientName: ed.clientName, clientAddress: ed.clientAddress, clientSiren: ed.clientSiren, clientVat: ed.clientVat, clientKind: ed.clientKind,
    clientEmail: ed.clientEmail, clientPhone: ed.clientPhone, deliveryAddress: ed.deliveryAddress, issueDate: ed.issueDate, dueDate: quote ? '' : ed.dueDate,
    deliveryDate: ed.deliveryDate || null, reference: ed.reference, subject: ed.subject, note: ed.note, operationNature: ed.operationNature,
    discount: {type: ed.discountType === 'amount' ? 'amount' : 'pct', value: ed.discountValue}, shipping: {label: ed.shippingLabel, amount: ed.shippingAmount, vatRate: ed.shippingVat},
    // Ligne ajoutée mais encore vide (ni désignation ni prix) : ignorée à l'enregistrement plutôt que refusée.
    lines: (ed.lines || []).filter(l => !(lineKind(l) === 'item' && !text(l.label) && loose(l.unitPrice) === null))};
  if (ed.docType === 'devis') { out.validUntil = ed.validUntil || null; out.goodForAgreement = !!ed.goodForAgreement; }
  if (quote) out.terms = ed.terms;
  return out;
}
/** Document de travail (aperçu, totaux, conformité) : valeurs contrôlées, sinon lignes nettoyées une à une. */
export function workingDoc(ed, {stored = null, customRates = []} = {}) {
  const v = draftValues(ed), checked = validateDraft(v, {customRates, docType: ed.docType});
  const base = {...(stored || {}), id: ed.id || 'nouveau', farmKind: stored?.farmKind || kindOfDocType(ed.docType), docType: ed.docType, status: 'brouillon', number: null,
    creditOf: ed.creditOf, creditOfNumber: ed.creditOfNumber || stored?.creditOfNumber, quoteId: ed.quoteId};
  const value = checked.value || {...v, lines: (ed.lines || []).map((l, i) => cleanLine(l, i, {customRates})), discount: null, shipping: null};
  const doc = {...base, ...value};
  doc.totals = documentTotals(doc);
  return {doc, error: checked.error || '', field: checked.field || ''};
}
/** Client choisi : identité recopiée ; pour un document neuf, conditions de la fiche (échéance, remise, livraison). */
export function applyClient(ed, client, {settings = null, fresh = false} = {}) {
  const snap = clientSnapshot({...client, id: client?.id || null});
  const next = {...ed, clientId: snap.clientId || '', clientName: snap.clientName, clientAddress: snap.clientAddress, clientSiren: snap.clientSiren, clientVat: snap.clientVat,
    clientKind: snap.clientKind, clientEmail: snap.clientEmail, clientPhone: snap.clientPhone};
  if (!fresh) return next;
  const terms = clientTerms(client, settings || {paymentDays: 30}, ed.issueDate, QUOTE_TYPES.has(ed.docType));
  if (terms.dueDate) { next.dueDate = terms.dueDate; next.term = termOf(next) ?? 'autre'; }
  if (terms.discount && (ed.discountValue === '' || ed.discountValue === null)) { next.discountType = 'pct'; next.discountValue = terms.discount.value; }
  if (terms.deliveryAddress && !text(ed.deliveryAddress)) next.deliveryAddress = terms.deliveryAddress;
  return next;
}
/** Catalogue : recherche par code, désignation ou catégorie ; prix propre au client s'il existe. */
export function catalogMatches(state, query, {clientId = null, limit = 12} = {}) {
  const q = normalize(query), tokens = q.split(' ').filter(Boolean);
  return catalogItems(state).map(item => {
    const code = normalize(item.code), label = normalize(item.label), all = `${code} ${label} ${normalize(item.category)}`;
    const score = !q ? 1 : code === q ? 100 : code.startsWith(q) ? 80 : label.startsWith(q) ? 70 : label.includes(q) ? 50 : tokens.every(t => all.includes(t)) ? 30 : 0;
    return {item, score};
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || byText(text(a.item.label), text(b.item.label))).slice(0, limit)
    .map(({item}) => ({item, ...catalogPrice(item, clientId || null)}));
}
/** Travaux, chantiers et carburant non facturés du client, hors lignes déjà reprises dans le brouillon. */
export function billablePicks(state, ed) {
  if (!ed.clientId || !['facture', 'proforma'].includes(ed.docType)) return [];
  const used = new Set((ed.lines || []).filter(l => l?.source?.type && l.source.id).map(l => `${l.source.type}:${l.source.id}`));
  return billableItems(state, ed.clientId, {exceptId: ed.id}).filter(it => !used.has(it.key));
}
/** Prix suggéré d'une ligne (dernier prix du client, prix habituel ou catalogue), s'il diffère du prix saisi. */
export function priceHint(state, line, clientId = null) {
  if (!line || lineKind(line) !== 'item' || !text(line.label)) return null;
  const sug = suggestPrice(state, {clientId: clientId || null, itemId: line.itemId || null, label: line.label, unit: line.unit || ''});
  if (!sug || !Number.isFinite(sug.price)) return null;
  const current = loose(line.unitPrice);
  if (current !== null && Math.abs(current - sug.price) < 0.005) return null;
  const why = sug.source === 'client' ? `dernier prix pour ce client${sug.last?.number ? ` (${sug.last.number})` : ''}` : sug.source === 'historique' ? `prix habituel (${plural(sug.count, 'ligne', 'lignes')})` : 'prix du catalogue';
  return {price: sug.price, source: sug.source, text: `${money(sug.price)} HT · ${why}`};
}
/** Encours d'un client : reste dû et factures en retard. */
export function clientBalance(state, key, today = isoDay()) {
  let due = 0, late = 0, open = 0;
  for (const i of invoices(state)) {
    if (!payable(docTypeOf(i)) || i.status === 'brouillon' || clientKeyOf(i) !== key) continue;
    const s = invoiceStatus(i, state, today); if (!OPEN_STATUSES.has(s)) continue;
    open += 1; due += invoiceBalance(state, i).due; if (s === 'retard') late += 1;
  }
  return {due: round2(due), late, open};
}
/** Conseil : la prochaine étape utile pour ce document, avec l'action qui la réalise. */
export function docAdvice(state, doc, today = isoDay()) {
  const r = docRow(state, doc, today), t = r.type, days = n => plural(n, 'jour', 'jours');
  if (r.draft) return {text: 'Brouillon : complétez-le, vérifiez la conformité puis émettez-le.', action: 'edit'};
  if (t === 'devis') {
    if (r.status === 'envoye' && r.expiresIn !== null && r.expiresIn <= 7) return {text: r.expiresIn > 0 ? `Valable encore ${days(r.expiresIn)} : un rappel au client peut aider.` : 'Dernier jour de validité.', action: 'send'};
    if (r.status === 'expire') return {text: 'Devis expiré : enregistrez une acceptation tardive ou établissez un nouveau devis.', action: 'duplicate'};
    if (r.status === 'accepte') {
      const prog = quoteProgress(state, doc), deps = depositsOf(state, doc.id);
      return deps.length ? {text: `Acomptes : ${money(prog.deposited)} émis sur ${money(prog.total)}. Établissez la facture de solde une fois le travail terminé.`, action: 'balance'}
        : {text: 'Devis accepté : demandez un acompte ou facturez directement.', action: 'deposit'};
    }
    return null;
  }
  if (!payable(t)) return null;
  if (r.status === 'retard') { const lv = reminderLevel(state, doc, today); return {text: `En retard de ${days(r.lateDays)} : relance ${lv.level} conseillée${lv.fee ? ` (frais ${money(lv.fee)})` : ''}.`, action: 'remind'}; }
  if (r.overpaid > 0.005) return {text: `Trop-perçu de ${money(r.overpaid)} : reportez-le sur une autre facture ou remboursez-le.`, action: 'transfer'};
  if (OPEN_STATUSES.has(r.status) && !(doc.sentLog || []).length) return {text: 'Pas encore envoyée au client.', action: 'send'};
  if (OPEN_STATUSES.has(r.status) && doc.dueDate) { const d = daysBetween(today, doc.dueDate); if (d >= 0 && d <= 3) return {text: d ? `Échéance dans ${days(d)}.` : 'Échéance aujourd’hui.', action: 'pay'}; }
  return null;
}
