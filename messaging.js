// Messages et notifications (v13) : carnet de contacts, modèles, planning du jour par personne,
// liens SMS / WhatsApp / e-mail, comptage des SMS et passerelle d'envoi facultative.
// Logique pure, sans DOM (test-messaging.mjs). Aucun nouveau type d'entité : contacts, modèles et
// journal sont des enregistrements d'exploitation (integrationImports) distingués par farmKind
// (CONTACT_KIND, MESSAGE_TEMPLATE_KIND, MESSAGE_KIND), comme les factures (invoices.js).
// Rien n'est envoyé par l'application elle-même : par défaut, le téléphone ouvre l'application SMS,
// WhatsApp ou de messagerie, préremplie ; la passerelle HTTPS (Worker de l'utilisateur) est facultative.
import {farmRecords} from './farm-records.js';
import {agendaDate, isPending} from './home-priorities.js';
import {mapsLink} from './share-text.js';
import {geometryCentroid} from './utils.js';
import {FINANCE_KINDS, normalizeRole, roleLabel} from './permissions.js';

export const MESSAGE_KIND = 'message';
export const MESSAGE_TEMPLATE_KIND = 'messageTemplate';
export const CONTACT_KIND = 'contact';
export const CHANNELS = Object.freeze({sms: 'SMS', whatsapp: 'WhatsApp', email: 'E-mail', share: 'Partage'});
export const MESSAGE_STATUSES = Object.freeze({prepare: 'Préparé', envoye: 'Envoyé', echec: 'Échec', attente: 'En attente', programme: 'Programmé', annule: 'Annulé'});
export const CONTACT_ROLES = Object.freeze(['Chauffeur', 'Salarié', 'Saisonnier', 'ETA / entrepreneur', 'Vétérinaire', 'Technicien', 'Conseiller', 'Fournisseur', 'Voisin', 'Autre']);
export const MAX_RECIPIENTS = 50;
export const SMS_MAX_SEGMENTS = 10;
export const EMAIL_MAX_LENGTH = 20000;
export const GATEWAY_MAX_ATTEMPTS = 6;

const text = value => String(value ?? '').trim();
const clip = (value, max) => text(value).slice(0, max);
const live = list => (Array.isArray(list) ? list : []).filter(item => item && !item.deletedAt);
export const normalizeName = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const firstWord = name => text(name).split(/\s+/)[0] || '';

// ---------- Numéros de téléphone ----------
// Départements et régions d'outre-mer : préfixe national (après le 0) -> indicatif international.
// Wallis-et-Futuna, Nouvelle-Calédonie et Polynésie (+681, +687, +689) n'ont pas de numéro national à
// 10 chiffres : 06 81, 06 87 et 06 89 sont des mobiles de métropole. Saint-Pierre-et-Miquelon (05 08) :
// le numéro local (6 chiffres) suit l'indicatif +508, sans le répéter.
const OVERSEAS = {590: '590', 690: '590', 691: '590', 594: '594', 694: '594', 596: '596', 696: '596', 697: '596', 262: '262', 263: '262', 692: '262', 693: '262', 269: '262', 639: '262', 508: '508'};
/** Numéro au format E.164 (« +33612345678 ») ; null si illisible. Numéros français par défaut. */
export function normalizePhone(raw) {
  let s = text(raw).replace(/\(0\)/g, '').replace(/[\s.\-()/  ]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (!/^\d{8,15}$/.test(digits)) return null;
    return digits.startsWith('330') ? `+33${digits.slice(3)}` : `+${digits}`;
  }
  if (!/^\d+$/.test(s)) return null;
  if (s.length === 10 && s.startsWith('0')) {
    const overseas = OVERSEAS[s.slice(1, 4)];
    if (overseas === '508') return `+508${s.slice(4)}`;
    return overseas ? `+${overseas}${s.slice(1)}` : `+33${s.slice(1)}`;
  }
  if (s.length === 9 && /^[67]/.test(s)) return `+33${s}`;
  return null;
}
/** Mobile français (+336 / +337) : seul cas où un SMS est certain d'aboutir. */
export function isMobile(e164) {
  const v = String(e164 || '');
  if (/^\+(33|590|594|596|262)/.test(v)) return /^\+33[67]\d{8}$/.test(v) || /^\+(590|594|596|262)6\d{8}$/.test(v);
  return /^\+\d{8,15}$/.test(v); // hors France : impossible à savoir, on laisse essayer
}
/** Affichage lisible : 06 12 34 56 78 pour la France, sinon le format international. */
export function formatPhone(raw) {
  const e = normalizePhone(raw);
  if (!e) return text(raw);
  if (/^\+33\d{9}$/.test(e)) return `0${e.slice(3)}`.replace(/(\d{2})(?=\d)/g, '$1 ');
  return e;
}
export const validEmail = value => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(text(value));

// ---------- Liens d'envoi par le téléphone ----------
/** Plateforme d'après le navigateur : 'ios', 'android' ou 'other' (ordinateur). */
export function detectPlatform({userAgent = '', maxTouchPoints = 0} = {}) {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}
const uniq = list => [...new Set(list)];
/** Lien sms: prérempli. iOS : « sms:num1,num2&body= » ; Android : « sms:num1;num2?body= » ; ailleurs RFC 5724. */
export function smsUri({phones = [], body = '', platform = 'other'} = {}) {
  const list = uniq([].concat(phones).map(normalizePhone).filter(Boolean));
  const sep = platform === 'android' ? ';' : ',';
  const query = platform === 'ios' ? '&' : '?';
  return `sms:${list.join(sep)}${body ? `${query}body=${encodeURIComponent(body)}` : ''}`;
}
const encodeAddress = address => encodeURIComponent(text(address)).replace(/%40/g, '@');
/** Lien mailto: (RFC 6068) : destinataires, copie, copie cachée, objet et corps (retours à la ligne CRLF). */
export function mailtoUri({to = [], cc = [], bcc = [], subject = '', body = ''} = {}) {
  const list = value => uniq([].concat(value).map(text).filter(validEmail)).map(encodeAddress).join(',');
  const params = [];
  if (list(cc)) params.push(`cc=${list(cc)}`);
  if (list(bcc)) params.push(`bcc=${list(bcc)}`);
  if (text(subject)) params.push(`subject=${encodeURIComponent(text(subject))}`);
  if (body) params.push(`body=${encodeURIComponent(String(body).replace(/\r?\n/g, '\r\n'))}`);
  return `mailto:${list(to)}${params.length ? `?${params.join('&')}` : ''}`;
}
/** Lien WhatsApp (wa.me) : numéro international sans « + » ; sans numéro, WhatsApp demande le destinataire. */
export function whatsappUri({phone = '', body = ''} = {}) {
  const e = normalizePhone(phone);
  return `https://wa.me/${e ? e.slice(1) : ''}${body ? `?text=${encodeURIComponent(body)}` : ''}`;
}

// ---------- Comptage des SMS ----------
// Alphabet GSM 03.38 : jeu de base (1 septet) et extension (2 septets, précédés d'un échappement).
const GSM_BASIC = new Set([...'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà']);
const GSM_EXTENDED = new Set([...'^{}\\[~]|€\f']);
/** Encodage et nombre de SMS : GSM-7 (160 caractères, 153 par partie) sinon UCS-2 (70, 67 par partie). */
export function smsSegments(body = '') {
  const value = String(body ?? '');
  const chars = [...value];
  const nonGsm = uniq(chars.filter(c => !GSM_BASIC.has(c) && !GSM_EXTENDED.has(c)));
  if (!nonGsm.length) {
    const length = chars.reduce((n, c) => n + (GSM_EXTENDED.has(c) ? 2 : 1), 0);
    const segments = length === 0 ? 0 : length <= 160 ? 1 : Math.ceil(length / 153);
    const perSegment = segments > 1 ? 153 : 160;
    return {encoding: 'GSM-7', length, segments, perSegment, remaining: segments ? segments * perSegment - length : 160, nonGsm: []};
  }
  const length = value.length; // unités UTF-16 : un émoji en compte deux
  const segments = length <= 70 ? 1 : Math.ceil(length / 67);
  const perSegment = segments > 1 ? 67 : 70;
  return {encoding: 'UCS-2', length, segments, perSegment, remaining: segments * perSegment - length, nonGsm};
}
const GSM_REPLACEMENTS = {'’': "'", '‘': "'", 'ʼ': "'", '“': '"', '”': '"', '«': '"', '»': '"', '–': '-', '—': '-', '…': '...', 'œ': 'oe', 'Œ': 'OE', '°': ' deg', ' ': ' ', ' ': ' ', '\t': ' ', '•': '-', '·': '-', '→': '->', 'ç': 'c'};
/** Remplace les caractères hors alphabet GSM (accents circonflexes, apostrophes typographiques…) pour
 * qu'un SMS tienne en 160 caractères au lieu de 70. é, è, à, ù restent tels quels. */
export function toGsm(body = '') {
  return [...String(body ?? '')].map(c => {
    if (GSM_BASIC.has(c) || GSM_EXTENDED.has(c)) return c;
    if (GSM_REPLACEMENTS[c] !== undefined) return GSM_REPLACEMENTS[c];
    const plain = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return [...plain].every(x => GSM_BASIC.has(x)) && plain ? plain : '?';
  }).join('');
}

// ---------- Modèles ----------
export const TEMPLATE_VARIABLES = Object.freeze([
  ['prenom', 'Prénom du destinataire'], ['nom', 'Nom du destinataire'], ['date', 'Date concernée'], ['heure', 'Heure'],
  ['travaux', 'Travaux et tâches (planning)'], ['exploitation', 'Nom de l’exploitation'], ['telephone', 'Téléphone de l’exploitation'],
  ['lieu', 'Lieu'], ['meteo', 'Alerte météo'], ['numero', 'Numéro du document'], ['montant', 'Montant TTC'],
  ['echeance', 'Échéance ou validité'], ['lien', 'Lien (document, paiement, position)']
]);
/** Remplace {variable} par sa valeur ; une variable inconnue (ou sans valeur) reste visible telle quelle. */
export function renderTemplate(template = '', vars = {}) {
  const source = vars || {};
  return String(template ?? '').replace(/\{([\p{L}\d_]+)\}/gu, (match, key) => {
    const value = Object.prototype.hasOwnProperty.call(source, key) ? source[key] : source[key.toLowerCase()];
    return value === undefined || value === null ? match : String(value);
  });
}
/** Variables présentes dans un texte, sans doublon. */
export const templateVariables = template => uniq([...String(template ?? '').matchAll(/\{([\p{L}\d_]+)\}/gu)].map(m => m[1]));
/** Variables restées sans valeur après remplacement (à signaler avant l'envoi). */
export const unresolvedVariables = rendered => templateVariables(rendered);

// Modèles fournis : le texte évite les apostrophes typographiques et les accents hors GSM pour tenir
// dans un SMS standard. Une copie modifiée par l'utilisateur (même clé) les remplace.
export const DEFAULT_TEMPLATES = Object.freeze([
  {key: 'planning-jour', name: 'Planning du jour', category: 'Équipe', channel: 'sms', subject: 'Planning du {date}', body: 'Bonjour {prenom}, voici le planning du {date} :\n{travaux}\nBonne journée. {exploitation}'},
  {key: 'planning-demain', name: 'Planning de demain', category: 'Équipe', channel: 'sms', subject: 'Planning de demain ({date})', body: 'Bonjour {prenom}, voici le planning de demain, {date} :\n{travaux}\nMerci et bonne soirée. {exploitation}'},
  {key: 'consigne', name: 'Consigne d’un travail', category: 'Équipe', channel: 'sms', subject: 'Consigne : {date}', body: 'Bonjour {prenom}, consigne pour le {date} :\n{travaux}\nMerci de me confirmer. {exploitation}'},
  {key: 'changement-planning', name: 'Changement de planning', category: 'Équipe', channel: 'sms', subject: 'Changement de planning du {date}', body: 'Bonjour {prenom}, changement de planning pour le {date} :\n{travaux}\nMerci de confirmer la reception. {exploitation}'},
  {key: 'alerte-meteo', name: 'Alerte météo à l’équipe', category: 'Équipe', channel: 'sms', subject: 'Alerte meteo du {date}', body: 'Alerte meteo pour le {date} : {meteo}. Adaptez les travaux prevus et tenez-moi au courant. {exploitation}'},
  {key: 'rappel-rdv', name: 'Rappel de rendez-vous client', category: 'Clients', channel: 'sms', subject: 'Rappel de rendez-vous du {date}', body: 'Bonjour {prenom}, nous vous rappelons notre rendez-vous du {date} a {heure} ({lieu}). En cas d\'empechement : {telephone}. {exploitation}'},
  {key: 'devis-envoi', name: 'Envoi d’un devis', category: 'Facturation', channel: 'email', subject: 'Devis {numero} - {exploitation}', body: 'Bonjour {prenom},\n\nVeuillez trouver ci-joint notre devis n° {numero} d\'un montant de {montant}, valable jusqu\'au {echeance}.\n{lien}\n\nNous restons a votre disposition.\nCordialement,\n{exploitation}'},
  {key: 'facture-envoi', name: 'Envoi d’une facture', category: 'Facturation', channel: 'email', subject: 'Facture {numero} - {exploitation}', body: 'Bonjour {prenom},\n\nVeuillez trouver ci-joint la facture n° {numero} d\'un montant de {montant}, a regler au plus tard le {echeance}.\n{lien}\n\nMerci pour votre confiance.\nCordialement,\n{exploitation}'},
  {key: 'avoir-envoi', name: 'Envoi d’un avoir', category: 'Facturation', channel: 'email', subject: 'Avoir {numero} - {exploitation}', body: 'Bonjour {prenom},\n\nVeuillez trouver ci-joint l\'avoir n° {numero} d\'un montant de {montant}.\n{lien}\n\nCordialement,\n{exploitation}'},
  {key: 'relance-1', name: 'Relance 1 (rappel courtois)', category: 'Facturation', channel: 'email', subject: 'Rappel : facture {numero}', body: 'Bonjour {prenom},\n\nSauf erreur de notre part, la facture n° {numero} d\'un montant de {montant}, echue le {echeance}, n\'a pas encore ete reglee. Si le paiement est en cours, merci de ne pas tenir compte de ce message.\n{lien}\n\nCordialement,\n{exploitation}'},
  {key: 'relance-2', name: 'Relance 2 (ferme)', category: 'Facturation', channel: 'email', subject: '2e relance : facture {numero}', body: 'Bonjour {prenom},\n\nMalgre notre precedent rappel, la facture n° {numero} de {montant}, echue le {echeance}, reste impayee. Merci de proceder au reglement sous 8 jours.\n{lien}\n\nCordialement,\n{exploitation}'},
  {key: 'relance-3', name: 'Relance 3 (dernier rappel)', category: 'Facturation', channel: 'email', subject: 'Dernier rappel avant mise en demeure : facture {numero}', body: 'Bonjour {prenom},\n\nLa facture n° {numero} de {montant}, echue le {echeance}, demeure impayee malgre nos relances. Sans reglement sous 8 jours, nous engagerons une mise en demeure. Des penalites de retard et l\'indemnite forfaitaire de 40 EUR pour frais de recouvrement sont exigibles.\n{lien}\n\n{exploitation}'},
  {key: 'remerciement-paiement', name: 'Remerciement de paiement', category: 'Facturation', channel: 'email', subject: 'Paiement recu : facture {numero}', body: 'Bonjour {prenom},\n\nNous avons bien recu votre reglement de {montant} pour la facture n° {numero}. Merci !\n\nCordialement,\n{exploitation}'}
]);
/** Clés des modèles de facturation, par usage de documentMessage (invoices.js). */
export const BILLING_TEMPLATE_KEYS = Object.freeze({envoi: {devis: 'devis-envoi', acompte: 'facture-envoi', facture: 'facture-envoi', avoir: 'avoir-envoi'}, relance1: 'relance-1', relance2: 'relance-2', relance3: 'relance-3', remerciement: 'remerciement-paiement'});

/** Modèles disponibles : ceux fournis (éventuellement personnalisés) puis ceux créés par l'utilisateur. */
export function messageTemplates(state) {
  const records = farmRecords(state || {}, MESSAGE_TEMPLATE_KIND);
  const byKey = new Map(records.filter(r => r.key).map(r => [r.key, r]));
  const builtins = DEFAULT_TEMPLATES.map(t => {
    const own = byKey.get(t.key);
    return own ? {...t, name: text(own.name) || t.name, subject: own.subject ?? t.subject, body: own.body ?? t.body, channel: own.channel || t.channel, builtin: true, customized: true, recordId: own.id} : {...t, builtin: true, customized: false, recordId: null};
  });
  const known = new Set(DEFAULT_TEMPLATES.map(t => t.key));
  const custom = records.filter(r => !r.key || !known.has(r.key)).map(r => ({key: r.key || r.id, name: text(r.name) || 'Modèle', category: text(r.category) || 'Mes modèles', channel: r.channel || 'sms', subject: r.subject || '', body: r.body || '', builtin: false, customized: true, recordId: r.id}));
  return [...builtins, ...custom.sort((a, b) => a.name.localeCompare(b.name, 'fr'))];
}
export const templateFor = (state, key) => messageTemplates(state).find(t => t.key === key) || null;
/** Contenu d'un modèle à enregistrer (validation). */
export function templatePayload(input = {}) {
  const name = clip(input.name, 80), body = String(input.body ?? '').replace(/\r\n/g, '\n').slice(0, 4000);
  if (!name) throw new Error('Champ obligatoire : nom du modèle.');
  if (!body.trim()) throw new Error('Champ obligatoire : texte du message.');
  const channel = CHANNELS[input.channel] ? input.channel : 'sms';
  return {name, key: clip(input.key, 60) || null, category: clip(input.category, 40) || 'Mes modèles', channel, subject: clip(input.subject, 200), body};
}

// ---------- Contacts ----------
export const contactRecords = state => farmRecords(state || {}, CONTACT_KIND);
const consentOf = (record, channel) => {
  const c = record?.consent?.[channel === 'email' ? 'email' : 'sms'];
  return c && (c.status === 'oui' || c.status === 'non') ? {status: c.status, at: text(c.at), source: text(c.source)} : {status: 'inconnu', at: '', source: ''};
};
/** Fiche contact à enregistrer (validation, numéros normalisés, consentement daté). */
export function contactPayload(input = {}, {today = ''} = {}) {
  const name = clip(input.name, 80);
  if (!name) throw new Error('Champ obligatoire : nom.');
  const rawPhones = [].concat(input.phones ?? input.phone ?? []).flatMap(p => String(p ?? '').split(/[;,\n]/)).map(text).filter(Boolean);
  const phones = [], invalid = [];
  for (const p of rawPhones) { const e = normalizePhone(p); if (e) phones.push(e); else invalid.push(p); }
  if (invalid.length) throw new Error(`Numéro illisible : ${invalid[0]}. Exemple : 06 12 34 56 78 ou +33 6 12 34 56 78.`);
  const email = text(input.email);
  if (email && !validEmail(email)) throw new Error('Adresse e-mail invalide.');
  const consent = {};
  for (const channel of ['sms', 'email']) {
    const status = input.consent?.[channel]?.status;
    if (status === 'oui' || status === 'non') consent[channel] = {status, at: text(input.consent[channel].at) || today, source: clip(input.consent[channel].source, 80)};
  }
  const preferred = ['sms', 'whatsapp', 'email'].includes(input.preferredChannel) ? input.preferredChannel : (phones.length ? 'sms' : email ? 'email' : 'sms');
  return {
    name, role: clip(input.role, 40), phones: uniq(phones).slice(0, 4), email, preferredChannel: preferred,
    groups: uniq([].concat(input.groups ?? []).flatMap(g => String(g ?? '').split(',')).map(g => clip(g, 40)).filter(Boolean)).slice(0, 10),
    assigneeNames: uniq([].concat(input.assigneeNames ?? []).flatMap(g => String(g ?? '').split(',')).map(g => clip(g, 60)).filter(Boolean)).slice(0, 10),
    memberUid: clip(input.memberUid, 128), consent, note: clip(input.note, 500)
  };
}
/** Carnet unifié : contacts libres, clients et membres de l'équipe (members : liste lue sur le cloud). */
export function messageContacts(state, {members = []} = {}) {
  const out = [], linkedMembers = new Set();
  for (const r of contactRecords(state)) {
    if (r.memberUid) linkedMembers.add(r.memberUid);
    const phones = [].concat(r.phones || []).filter(Boolean);
    out.push({id: r.id, kind: 'contact', name: text(r.name), phone: phones[0] || '', phones, email: text(r.email), role: text(r.role) || 'Contact', groups: r.groups || [], preferredChannel: r.preferredChannel || 'sms', consent: {sms: consentOf(r, 'sms'), email: consentOf(r, 'email')}, assigneeNames: r.assigneeNames || [], memberUid: r.memberUid || '', recordId: r.id});
  }
  for (const c of live(state?.clients)) {
    const phone = normalizePhone(c.phone) || '';
    out.push({id: `client:${c.id}`, kind: 'client', name: text(c.contact) || text(c.name) || 'Client', company: text(c.name), phone, phones: phone ? [phone] : [], email: validEmail(c.email) ? text(c.email) : '', role: 'Client', groups: ['Clients'], preferredChannel: validEmail(c.email) ? 'email' : 'sms', consent: {sms: consentOf(c, 'sms'), email: consentOf(c, 'email')}, assigneeNames: [], sourceId: c.id});
  }
  for (const m of Array.isArray(members) ? members : []) {
    const uid = text(m.uid || m.id);
    if (!uid || linkedMembers.has(uid)) continue;
    const name = text(m.displayName || m.name) || text(m.email).split('@')[0] || 'Membre';
    out.push({id: `member:${uid}`, kind: 'member', name, phone: '', phones: [], email: validEmail(m.email) ? text(m.email) : '', role: roleLabel(m.role), groups: ['Équipe'], preferredChannel: 'email', consent: {sms: consentOf(null), email: consentOf(null)}, assigneeNames: [name], memberUid: uid});
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
/** Groupes connus (« Chauffeurs », « Équipe », « Clients »…) avec leurs membres. */
export function contactGroups(contacts = []) {
  const groups = new Map();
  for (const c of contacts) for (const g of c.groups || []) { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }
  return [...groups.entries()].map(([name, list]) => ({name, contacts: list})).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
/** Contact rattaché à une personne désignée dans « Confier à… » (team-work.js) : compte cloud, alias ou nom. */
export function contactForAssignee(contacts = [], {name = '', id = ''} = {}) {
  const key = normalizeName(name);
  return contacts.find(c => id && c.memberUid && c.memberUid === id && (c.phone || c.email))
    || contacts.find(c => key && (c.assigneeNames || []).some(a => normalizeName(a) === key) && c.kind === 'contact')
    || contacts.find(c => key && normalizeName(c.name) === key && c.kind === 'contact')
    || contacts.find(c => key && (normalizeName(c.name) === key || (c.assigneeNames || []).some(a => normalizeName(a) === key)))
    || null;
}
/** Consentement du contact pour un canal : 'oui', 'non' (opposition : envoi bloqué) ou 'inconnu'. */
export function consentStatus(contact, channel) {
  if (!contact || channel === 'share') return 'inconnu';
  return (channel === 'email' ? contact.consent?.email?.status : contact.consent?.sms?.status) || 'inconnu';
}
/** Canal retenu pour un destinataire : le canal demandé, ou, en « auto », le canal préféré disponible. */
export function channelFor(contact, requested = 'auto') {
  const phone = Boolean(normalizePhone(contact?.phone)), email = validEmail(contact?.email);
  if (requested === 'share') return 'share';
  if (requested === 'sms' || requested === 'whatsapp') return phone ? requested : null;
  if (requested === 'email') return email ? 'email' : null;
  const preferred = contact?.preferredChannel;
  if ((preferred === 'sms' || preferred === 'whatsapp') && phone) return preferred;
  if (preferred === 'email' && email) return 'email';
  return phone ? 'sms' : email ? 'email' : null;
}
/** Contacts du carnet qui portent ce numéro ou cette adresse : le nom du premier, et pour chaque canal
 * l'opposition de l'un d'eux s'il y en a une (sinon l'accord du premier). null si aucun. */
export function addressConsent(contacts = [], {phone = '', email = ''} = {}) {
  const p = normalizePhone(phone), e = text(email).toLowerCase();
  const found = [].concat(contacts || []).filter(c => c && ((p && [c.phone, ...(c.phones || [])].some(x => x && normalizePhone(x) === p)) || (e && text(c.email).toLowerCase() === e)));
  if (!found.length) return null;
  const pick = channel => found.map(c => c.consent?.[channel]).find(x => x?.status === 'non') || found[0].consent?.[channel];
  const consent = {};
  for (const channel of ['sms', 'email']) { const c = pick(channel); if (c) consent[channel] = c; }
  return {contactId: found[0].id, name: text(found[0].name), consent};
}
/** Destinataire libre (saisi dans le composeur) : numéro ou adresse. Si un contact du carnet porte ce
 * numéro ou cette adresse, son accord ou son opposition s'applique (contacts : carnet unifié). */
export function freeRecipient(value, {contacts = []} = {}) {
  const raw = text(value);
  let r = null;
  if (validEmail(raw)) r = {id: `libre:${raw.toLowerCase()}`, kind: 'libre', name: raw, email: raw, phone: '', phones: [], groups: [], consent: {}};
  const phone = r ? null : normalizePhone(raw);
  if (phone) r = {id: `libre:${phone}`, kind: 'libre', name: formatPhone(phone), phone, phones: [phone], email: '', groups: [], consent: {}};
  if (!r) return null;
  const known = addressConsent(contacts, r);
  return known ? {...r, name: known.name || r.name, consent: known.consent} : r;
}

// ---------- Planning du jour ----------
const pad = n => String(n).padStart(2, '0');
export const isoDay = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const addDays = (day, n) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + Number(n || 0)); return isoDay(d); };
/** « mardi 20/10 » (sans accent hors GSM). */
export function dayLabel(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(day));
  if (!m) return text(day);
  const weekday = new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', {weekday: 'long'});
  return `${weekday} ${m[3]}/${m[2]}`;
}
const decimal = value => {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100).replace('.', ',') : '';
};
const sameAssignee = (item, who) => {
  if (!who) return true;
  if (who.id && item.assigneeId && item.assigneeId === who.id) return true;
  const names = new Set([who.name, ...(who.aliases || [])].map(normalizeName).filter(Boolean));
  return names.has(normalizeName(item.assigneeName));
};
const whoOf = assignee => (assignee === null || assignee === undefined || assignee === '' ? null : typeof assignee === 'string' ? {name: assignee, id: '', aliases: []} : {name: text(assignee.name), id: text(assignee.id), aliases: [].concat(assignee.aliases || [])});

function planRow(kind, item, {parcels, machines, overdue = false, date = ''}) {
  const parcel = parcels.get(item.parcelId) || null, machine = machines.get(item.equipmentId) || null;
  const place = parcel?.geometry ? geometryCentroid(parcel.geometry) : null;
  return {
    kind, id: item.id, item, overdue, date, time: text(item.startTime),
    title: text(kind === 'task' ? item.title : item.type) || (kind === 'task' ? 'Tâche' : 'Travail'),
    parcel: text(parcel?.nom), surface: Number(item.surfaceWorked) > 0 ? decimal(item.surfaceWorked) : Number(parcel?.surfaceHa) > 0 ? decimal(parcel.surfaceHa) : '',
    product: kind === 'work' ? text(item.product) : '', dose: kind === 'work' && Number(item.dose) > 0 ? `${decimal(item.dose)}${text(item.doseUnit) ? ` ${text(item.doseUnit)}` : ''}` : '',
    equipment: text(machine?.nom), instructions: text(item.instructions), link: place ? mapsLink(place) : null,
    assigneeName: text(item.assigneeName), assigneeId: text(item.assigneeId)
  };
}
const lookups = state => ({parcels: new Map(live(state?.parcelles).map(p => [p.id, p])), machines: new Map(live(state?.materiels).map(m => [m.id, m]))});

/** Travaux et tâches à faire à une date pour une personne (toutes si assignee est vide). Le jour même,
 * les travaux en retard non faits sont repris (marqués overdue). */
export function dayPlanItems(state, {date, assignee = null, today = null, includeOverdue = null} = {}) {
  const day = text(date) || isoDay();
  const who = whoOf(assignee);
  const withOverdue = includeOverdue ?? (Boolean(today) && today === day);
  const {parcels, machines} = lookups(state);
  const rows = [];
  for (const [kind, list] of [['work', state?.interventions], ['task', state?.tasks]]) {
    for (const item of live(list)) {
      if (!isPending(item, kind) || !sameAssignee(item, who)) continue;
      const when = agendaDate(item, kind);
      const overdue = Boolean(when) && when < day;
      if (when !== day && !(withOverdue && overdue)) continue;
      rows.push(planRow(kind, item, {parcels, machines, overdue, date: when}));
    }
  }
  return rows.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.time || '99:99').localeCompare(b.time || '99:99') || a.title.localeCompare(b.title, 'fr') || String(a.id).localeCompare(String(b.id)));
}
/** Une ligne de planning (variable {travaux}) : heure, travail, parcelle, produit et dose, matériel, consigne, position. */
export function planItemText(row, index = null, {links = true} = {}) {
  const head = `${index === null ? '' : `${index + 1}. `}${row.time ? `${row.time} ` : ''}${row.kind === 'task' ? `Tache : ${row.title}` : row.title}${row.parcel ? ` - ${row.parcel}${row.surface ? ` (${row.surface} ha)` : ''}` : ''}${row.overdue ? ' (en retard)' : ''}`;
  const lines = [head];
  if (row.product || row.dose) lines.push(`   Produit : ${[row.product, row.dose].filter(Boolean).join(' ')}`);
  if (row.equipment) lines.push(`   Materiel : ${row.equipment}`);
  if (row.instructions) lines.push(`   Consigne : ${row.instructions}`);
  if (links && row.link) lines.push(`   Lieu : ${row.link}`);
  return lines.join('\n');
}
/** Texte des travaux et tâches du jour pour une personne (variable {travaux} des modèles de planning). */
export function dayPlanText(state, {date, assignee = null, today = null, links = true, includeOverdue = null} = {}) {
  const rows = dayPlanItems(state, {date, assignee, today, includeOverdue});
  if (!rows.length) return 'Rien de prevu.';
  return rows.map((row, i) => planItemText(row, rows.length > 1 ? i : null, {links})).join('\n');
}
/** Personnes à qui un travail ou une tâche est confié à cette date (ordre alphabétique). */
export function dayPlanAssignees(state, {date, today = null} = {}) {
  // Le compte (assigneeId) prime sur le nom : un membre renommé (« Paul » puis « Paul Martin ») reste une
  // seule personne ; un travail sans compte rejoint la personne du même nom.
  const people = [], byId = new Map(), byName = new Map();
  for (const row of dayPlanItems(state, {date, today})) {
    if (!row.assigneeName && !row.assigneeId) continue;
    const id = text(row.assigneeId), nameKey = normalizeName(row.assigneeName);
    const named = nameKey ? byName.get(nameKey) : null;
    let p = (id && byId.get(id)) || (named && (!id || !named.id) ? named : null);
    if (!p) { p = {name: row.assigneeName || 'Sans nom', id, count: 0}; people.push(p); }
    p.count += 1;
    if (!p.id && id) p.id = id;
    if (p.name === 'Sans nom' && row.assigneeName) p.name = row.assigneeName;
    if (id) byId.set(id, p);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, p);
  }
  return people.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
/** Variables communes : exploitation et téléphone (réglages de facturation s'ils existent). */
export function farmVars(state) {
  const e = state?.exploitation || {};
  return {exploitation: text(e.invoicing?.legalName) || text(e.nom) || '', telephone: formatPhone(e.invoicing?.phone || e.telephone || '')};
}
/** Message de planning complet pour une personne, d'après le modèle (planning du jour ou de demain). */
export function dayPlanMessage(state, {date, assignee, today = null, templateKey = null, contact = null} = {}) {
  const who = whoOf(assignee);
  const key = templateKey || (today && date > today ? 'planning-demain' : 'planning-jour');
  const template = templateFor(state, key) || DEFAULT_TEMPLATES[0];
  const name = text(contact?.name) || text(who?.name);
  const vars = {...farmVars(state), prenom: firstWord(name), nom: name, date: dayLabel(date), travaux: dayPlanText(state, {date, assignee, today})};
  return {subject: renderTemplate(template.subject, vars), body: renderTemplate(template.body, vars).replace(/\s+$/, ''), templateKey: template.key, vars};
}
/** Consigne d'un travail ou d'une tâche confié(e), à envoyer à la personne désignée. */
export function workInstructionMessage(state, {kind = 'work', id, contact = null, templateKey = 'consigne'} = {}) {
  const list = kind === 'task' ? state?.tasks : state?.interventions;
  const item = live(list).find(x => x.id === id);
  if (!item) return null;
  const date = agendaDate(item, kind) || isoDay();
  const row = planRow(kind, item, {...lookups(state), date});
  const template = templateFor(state, templateKey) || templateFor(state, 'consigne');
  const name = text(contact?.name) || text(item.assigneeName);
  const vars = {...farmVars(state), prenom: firstWord(name), nom: name, date: dayLabel(date), travaux: planItemText(row)};
  return {subject: renderTemplate(template.subject, vars), body: renderTemplate(template.body, vars), assigneeName: text(item.assigneeName), assigneeId: text(item.assigneeId), date, templateKey: template.key};
}

// ---------- Journal ----------
export const isFinanceContext = context => Boolean(context && (FINANCE_KINDS.has(context.kind) || context.finance === true));
const cleanRecipient = r => ({contactId: clip(r?.contactId ?? r?.id, 128), name: clip(r?.name, 80), phone: normalizePhone(r?.phone) || '', email: validEmail(r?.email) ? text(r.email) : ''});
/** Enregistrement du journal (farmKind « message ») : ni pièce jointe ni secret, corps limité à 4 000 caractères. */
export function messageRecord({channel, recipients = [], subject = '', body = '', status = 'prepare', via = 'appareil', context = null, deviceId = '', author = {}, now = Date.now(), idempotencyKey = '', templateKey = '', attachments = [], sendAt = ''} = {}) {
  if (!CHANNELS[channel]) throw new Error('Canal inconnu.');
  if (!MESSAGE_STATUSES[status]) throw new Error('Statut inconnu.');
  const list = [].concat(recipients).map(cleanRecipient).filter(r => r.name || r.phone || r.email).slice(0, MAX_RECIPIENTS);
  const ctx = context && (context.entity || context.id || context.kind) ? {entity: clip(context.entity, 40), id: clip(context.id, 128), kind: clip(context.kind, 40), label: clip(context.label, 120)} : null;
  const finance = isFinanceContext(context);
  const subjectText = clip(subject, 200), bodyText = String(body ?? '').slice(0, 4000);
  return {
    name: subjectText || bodyText.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Message',
    channel, via: via === 'passerelle' ? 'passerelle' : 'appareil', status, statusAt: now, recipients: list,
    recipientCount: list.length, subject: subjectText, body: bodyText, excerpt: bodyText.replace(/\s+/g, ' ').trim().slice(0, 160),
    context: ctx, finance, deviceId: clip(deviceId, 80), authorUid: clip(author.uid, 128), authorName: clip(author.name, 80),
    idempotencyKey: clip(idempotencyKey, 120), templateKey: clip(templateKey, 60), sendAt: clip(sendAt, 40),
    attachments: [].concat(attachments).slice(0, 10).map(a => ({name: clip(a?.name, 120), type: clip(a?.type, 80), size: Number(a?.size) || 0})),
    attempts: 0, nextAttemptAt: null, error: '', results: [], createdAtMs: now
  };
}
/** Le journal visible selon le rôle : l'opérateur terrain ne voit que ses propres messages, jamais ceux
 * de la facturation ; le lecteur ne voit pas ceux de la facturation. */
export function canSeeMessage(message, {role = 'owner', uid = '', deviceId = ''} = {}) {
  const r = normalizeRole(role);
  if (message?.finance && (r === 'operator' || r === 'viewer')) return false;
  if (r === 'operator') return Boolean((uid && message?.authorUid === uid) || (!message?.authorUid && deviceId && message?.deviceId === deviceId));
  return true;
}
export const canSendMessages = role => normalizeRole(role) !== 'viewer';
export const canManageDirectory = role => ['owner', 'manager', 'editor'].includes(normalizeRole(role));
/** Journal filtré (canal, statut, texte, élément lié), du plus récent au plus ancien. */
export function messageLog(state, {role = 'owner', uid = '', deviceId = '', channel = '', status = '', query = '', contextId = ''} = {}) {
  const q = normalizeName(query);
  return farmRecords(state || {}, MESSAGE_KIND)
    .filter(m => canSeeMessage(m, {role, uid, deviceId}))
    .filter(m => (!channel || m.channel === channel) && (!status || m.status === status) && (!contextId || m.context?.id === contextId))
    .filter(m => !q || normalizeName([m.subject, m.excerpt, ...(m.recipients || []).map(r => `${r.name} ${r.phone} ${r.email}`), m.context?.label].join(' ')).includes(q))
    .sort((a, b) => (Number(b.createdAtMs) || Number(b.createdAt) || 0) - (Number(a.createdAtMs) || Number(a.createdAt) || 0));
}
/** Résumé pour le centre des messages. */
export function messageStats(list = []) {
  const out = {total: list.length, envoye: 0, prepare: 0, echec: 0, attente: 0, programme: 0};
  for (const m of list) if (out[m.status] !== undefined) out[m.status] += 1;
  return out;
}

// ---------- Passerelle d'envoi (facultative) ----------
// FNV-1a 32 bits : empreinte stable, sans dépendance, pour l'identifiant d'idempotence.
const fnv = value => { let h = 0x811c9dc5; for (const c of String(value)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
/** Identifiant d'idempotence d'un envoi : le même message au même destinataire par le même canal donne
 * toujours la même clé ; la passerelle refuse un second envoi (réessai après coupure, deux appareils). */
export function messageIdempotencyKey(recordId, recipient, channel) {
  const to = normalizePhone(recipient?.phone ?? recipient) || text(recipient?.email ?? recipient).toLowerCase();
  return `pm-${clip(recordId, 80)}-${channel}-${fnv(`${channel}|${to}`)}`;
}
/** Identifiant stable d'un envoi du planning par la passerelle : même jour et même texte donnent la même
 * clé, si bien qu'un second « Tout envoyer » (après un échec partiel ou une mise en attente) est reconnu
 * comme doublon par la passerelle au lieu de repartir. */
export const planIdempotencyId = (date, body) => `plan-${clip(date, 20)}-${fnv(String(body ?? ''))}`;
/** Numéros (ou adresses) que la passerelle a acceptés : envoyé, programmé ou déjà envoyé (doublon). */
export function deliveredTo(results = []) {
  return new Set([].concat(results || []).filter(r => ['sent', 'scheduled', 'duplicate'].includes(r?.status)).map(r => normalizePhone(r.to) || text(r.to).toLowerCase()).filter(Boolean));
}
/** Heure du prochain réessai dû sur cet appareil (null si la file est vide). */
export function nextOutboxAt(state, {deviceId = ''} = {}) {
  const times = farmRecords(state || {}, MESSAGE_KIND).filter(m => m.status === 'attente' && m.via === 'passerelle' && m.deviceId === deviceId && (Number(m.attempts) || 0) < GATEWAY_MAX_ATTEMPTS).map(m => Number(m.nextAttemptAt) || 0);
  return times.length ? Math.min(...times) : null;
}
/** Adresse de la passerelle : HTTPS obligatoire (localhost admis pour les essais). */
export function gatewayEndpoint(base, path = 'send') {
  const raw = text(base);
  if (!raw) throw new Error('Aucune passerelle configurée.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Adresse de passerelle invalide.'); }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('La passerelle doit utiliser HTTPS.');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`;
  url.search = ''; url.hash = '';
  return url.toString();
}
/** Corps de la requête POST /send : un message par destinataire (texte personnalisé), validé ici avant
 * de partir (numéros, adresses, taille). sendAt (ISO) demande un envoi programmé à la passerelle. */
export function gatewayPayload({channel, messages = [], subject = '', idempotencyKey = '', sendAt = ''} = {}) {
  if (channel !== 'sms' && channel !== 'email') throw new Error('La passerelle n’envoie que des SMS et des e-mails.');
  const list = [].concat(messages);
  if (!list.length) throw new Error('Aucun destinataire.');
  if (list.length > MAX_RECIPIENTS) throw new Error(`${MAX_RECIPIENTS} destinataires au plus par envoi.`);
  const out = list.map((m, i) => {
    const body = String(m.body ?? '');
    if (!body.trim()) throw new Error('Le message est vide.');
    if (channel === 'sms') {
      const to = normalizePhone(m.to);
      if (!to) throw new Error(`Numéro invalide : ${text(m.to) || '(vide)'}.`);
      if (smsSegments(body).segments > SMS_MAX_SEGMENTS) throw new Error(`SMS trop long (${SMS_MAX_SEGMENTS} parties au plus).`);
      return {to, body, key: text(m.key) || `${idempotencyKey}-${i}`};
    }
    if (!validEmail(m.to)) throw new Error(`Adresse invalide : ${text(m.to) || '(vide)'}.`);
    if (body.length > EMAIL_MAX_LENGTH) throw new Error('E-mail trop long.');
    return {to: text(m.to), body, subject: clip(m.subject ?? subject, 200), key: text(m.key) || `${idempotencyKey}-${i}`};
  });
  if (sendAt && Number.isNaN(Date.parse(sendAt))) throw new Error('Date d’envoi programmé invalide.');
  return {channel, idempotencyKey: clip(idempotencyKey, 120), messages: out, ...(sendAt ? {sendAt: new Date(sendAt).toISOString()} : {}), client: 'Parcelles'};
}
/** Réponse de la passerelle : {status:'envoye'|'programme'|'partiel'|'echec', results, error}. */
export function parseGatewayResponse(json, httpStatus = 200) {
  const results = Array.isArray(json?.results) ? json.results.map(r => ({to: text(r.to), status: ['sent', 'scheduled', 'duplicate'].includes(r.status) ? r.status : 'failed', error: clip(r.error, 200)})) : [];
  if (httpStatus === 401 || httpStatus === 403) return {status: 'echec', results, error: 'Jeton refusé par la passerelle.', retry: false};
  if (httpStatus === 429) return {status: 'echec', results, error: 'Trop d’envois : réessai plus tard.', retry: true};
  if (httpStatus >= 500) return {status: 'echec', results, error: text(json?.error) || `Passerelle indisponible (${httpStatus}).`, retry: true};
  if (httpStatus >= 400) return {status: 'echec', results, error: text(json?.error) || `Requête refusée (${httpStatus}).`, retry: false};
  if (!results.length) return {status: 'echec', results, error: text(json?.error) || 'Réponse de la passerelle illisible.', retry: false};
  const ok = results.filter(r => r.status !== 'failed');
  const scheduled = results.every(r => r.status === 'scheduled');
  return {status: ok.length === results.length ? (scheduled ? 'programme' : 'envoye') : ok.length ? 'partiel' : 'echec', results, error: ok.length === results.length ? '' : results.find(r => r.status === 'failed')?.error || 'Envoi refusé.', retry: false};
}
/** Délai avant le réessai n (30 s, 1 min, 2 min… plafonné à 1 h). */
export const retryDelayMs = attempts => Math.min(3600000, 30000 * 2 ** Math.max(0, Number(attempts) || 0));
/** Messages en file d'attente de cet appareil, prêts à être réessayés (un autre appareil ne les envoie pas). */
export function outboxDue(state, {deviceId = '', now = Date.now()} = {}) {
  return farmRecords(state || {}, MESSAGE_KIND).filter(m => m.status === 'attente' && m.via === 'passerelle' && m.deviceId === deviceId && (Number(m.attempts) || 0) < GATEWAY_MAX_ATTEMPTS && (!m.nextAttemptAt || Number(m.nextAttemptAt) <= now));
}

// ---------- Rappel du soir ----------
/** Proposer d'envoyer le planning de demain : rappel actif, heure passée, pas encore proposé aujourd'hui. */
export function planReminderDue({enabled = false, hour = 18, now = new Date(), lastDay = ''} = {}) {
  if (!enabled) return false;
  const h = Number.isFinite(Number(hour)) ? Math.min(23, Math.max(0, Number(hour))) : 18;
  return now.getHours() >= h && lastDay !== isoDay(now);
}
