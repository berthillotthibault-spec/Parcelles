// Questions de suivi de l’assistant : « combien me doit Martin ? » puis « et Dupont ? ».
// Logique pure : on reconnaît une relance courte, puis on la reformule à partir de la dernière
// question comprise en remplaçant l’entité du même type (client, parcelle, jour ou période).
import {normalize} from './utils.js';
import {findClientInQuestion} from './billing-assistant.js';

const B = '(?<![\\p{L}\\d])', E = '(?![\\p{L}\\d])';
const rx = (body, flags = 'iu') => new RegExp(`${B}(?:${body})${E}`, flags);
// Expressions de temps, par catégorie (l’ordre compte : « après-demain » avant « demain »).
const TIME = [
  {cat: 'day', body: "apr[eè]s[- ]demain|aujourd['’ ]?hui|demain|hier|avant[- ]hier|ce soir|ce matin|cet apr[eè]s[- ]midi"},
  {cat: 'week', body: '(?:(?:cette|la|de la|de cette)\\s+)?semaine(?:\\s+(?:derni[eè]re|prochaine|pass[eé]e|pr[eé]c[eé]dente))?'},
  {cat: 'month', body: '(?:(?:du|le|ce|au|de ce)\\s+)?mois(?:[- ]ci)?(?:\\s+(?:dernier|pr[eé]c[eé]dent|pass[eé]|prochain))?'},
  {cat: 'quarter', body: '(?:(?:du|le|ce|au|de ce)\\s+)?trimestre(?:[- ]ci)?(?:\\s+(?:dernier|pr[eé]c[eé]dent|pass[eé]|prochain))?'},
  {cat: 'year', body: "(?:(?:de\\s+)?l['’]\\s?|cette\\s+|d['’]\\s?)?ann[eé]e"
    + '(?:\\s+(?:derni[eè]re|pr[eé]c[eé]dente|pass[eé]e|prochaine))?|(?:en\\s+)?20\\d\\d'}
];
// Mots qui font d’une phrase une vraie question (ou une demande), pas une relance.
const QUESTION_WORDS = new RegExp(`\\b(${[
  'combien|quel|quels|quelle|quelles|comment|pourquoi|qui|quand|ou|est ce|peux|peut|puis|dois|doit|faut|fais|faire',
  'ajoute|ajouter|cree|creer|planifie|planifier|enregistre|enregistrer|resume|montre|ouvre|affiche|si|que|quoi'
].join('|')})\\b`);
// Relances vides de sens seules (« et alors ? », « et merci »).
const FILLERS = /^(alors|apres|ensuite|donc|puis|encore|sinon|toi|vous|moi|ca|bien|merci|ok|voila|non|oui|rien|tout|autre chose)$/;
const LEAD = new RegExp('^\\s*(?:(?:et|mais)\\s+(?:pour\\s+)?'
  + '|(?:m[eê]me\\s+chose|m[eê]me\\s+question|pareil|idem)\\s+(?:pour\\s+)?)', 'iu');
const PREP_GROUP = `(?:${[
  "sur\\s+(?:les?|la|l['’])\\s*", 'sur\\s+', 'de\\s+la\\s+', "de\\s+l['’]\\s*", '[aà]\\s+la\\s+', "[aà]\\s+l['’]\\s*",
  'de\\s+', 'aux\\s+', 'au\\s+', 'des\\s+', 'du\\s+', 'les?\\s+', 'la\\s+', "l['’]\\s*", 'en\\s+', '[aà]\\s+'
].join('|')})`;

const active = (state, type) => (state?.[type] || []).filter(x => x && !x.deletedAt);
const qNorm = text => normalize(text).replace(/['’]/g, ' ');

/** Chaîne repliée caractère par caractère (même longueur que l’original) : minuscules, sans accents, ponctuation en espace. */
function fold(text) {
  return [...String(text || '')].map(ch => {
    const c = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()[0] || ' ';
    return /[a-z0-9]/.test(c) ? c : ' ';
  }).join('');
}
/** Position d’un nom (déjà normalisé) dans un texte brut, mots entiers, ou null. */
function spanOf(raw, needle) {
  const n = String(needle || '').trim();
  if (!n) return null;
  const chars = [...String(raw || '')], folded = fold(raw);
  const m = new RegExp(`(^| )(${n.split(' ').map(w => w.replace(/[^a-z0-9]/g, '')).join(' +')})(?= |$)`).exec(folded);
  if (!m) return null;
  // Les indices du repli portent sur les points de code : on revient aux indices de la chaîne JS.
  const startCp = m.index + m[1].length, endCp = startCp + m[2].length;
  const toIdx = cp => chars.slice(0, cp).join('').length;
  return {start: toIdx(startCp), end: toIdx(endCp)};
}
const splice = (raw, span, text) => `${raw.slice(0, span.start)}${text}${raw.slice(span.end)}`;
const tidy = text => String(text).replace(/\s{2,}/g, ' ').trim();

function timeCategory(term) {
  const t = String(term || '').trim();
  for (const {cat, body} of TIME) if (new RegExp(`^(?:pour\\s+)?(?:${body})$`, 'iu').test(t)) return cat;
  return null;
}

/**
 * Relance courte (« et Dupont ? », « et pour demain ? », « même chose pour le Grand Champ »), ou null.
 * Une question complète (« et combien me doit Durand ? ») n’est pas une relance.
 */
export function detectFollowUp(question) {
  const raw = String(question || '').trim();
  if (!raw || raw.length > 60 || !LEAD.test(raw)) return null;
  const term = raw.replace(LEAD, '').replace(/[\s?!.…]+$/u, '').trim();
  const t = qNorm(term);
  if (!t || t.split(' ').length > 5 || FILLERS.test(t)) return null;
  const cat = timeCategory(term);
  if (!cat && QUESTION_WORDS.test(t)) return null;
  return {term, kind: cat ? 'time' : 'entity', timeCategory: cat};
}
export const isFollowUpQuestion = question => Boolean(detectFollowUp(question));

/** Parcelle citée (nom complet ou sans article, mots entiers), la plus longue d’abord. */
export function parcelMention(text, state) {
  const q = ` ${qNorm(text)} `;
  let best = null;
  for (const p of active(state, 'parcelles')) {
    const full = qNorm(p.nom), bare = full.replace(/^(les|le|la|l)\s+/, '');
    for (const [name, isBare] of [[full, false], [bare, true]]) {
      if (name.length > 2 && q.includes(` ${name} `) && (!best || name.length > best.name.length)) best = {parcel: p, name, bare: isBare && bare !== full};
    }
  }
  return best;
}
function clientMention(text, state) {
  const found = findClientInQuestion(qNorm(text), state);
  return found ? (found.ambiguous ? {ambiguous: found.ambiguous} : {client: found}) : null;
}
/** Zone du nom du client dans la question : nom complet, sinon les mots significatifs trouvés. */
function clientSpan(raw, client) {
  const full = spanOf(raw, qNorm(client.name));
  if (full) return full;
  const spans = qNorm(client.name).split(' ').filter(w => w.length >= 3).map(w => spanOf(raw, w)).filter(Boolean);
  return spans.length ? {start: Math.min(...spans.map(s => s.start)), end: Math.max(...spans.map(s => s.end))} : null;
}

function replaceTime(prev, term, cat) {
  const clean = term.replace(/^pour\s+/iu, '').trim();
  const hits = TIME.map(t => ({cat: t.cat, m: rx(t.body).exec(prev)})).filter(x => x.m);
  const hit = hits.find(x => x.cat === cat) || hits[0];
  if (!hit) return tidy(prev.replace(/\s*([?!.…]*)\s*$/u, (_, end) => ` ${clean}${end ? ` ${end}` : ''}`));
  const old = hit.m[0];
  // « CA du mois » + « le mois dernier » → « CA du mois dernier » (on garde la préposition contractée).
  let next = clean;
  const prep = old.match(/^(du|au|de ce)\s+/i), art = clean.match(/^(le|ce)\s+/i);
  if (prep && art) next = `${prep[1]} ${clean.slice(art[0].length)}`;
  return tidy(`${prev.slice(0, hit.m.index)}${next}${prev.slice(hit.m.index + old.length)}`);
}

function replaceParcel(prev, oldHit, newParcel, term) {
  const span = spanOf(prev, oldHit.name);
  if (!span) return null;
  const before = prev.slice(0, span.start), group = new RegExp(`${B}${PREP_GROUP}$`, 'iu').exec(before);
  const userPhrase = term.replace(/^pour\s+/iu, '').trim();
  // L’utilisateur a donné sa préposition (« et au Grand Champ ? ») : elle remplace l’ancienne.
  if (group && /^(sur|de|d['’]|[aà]|au|aux|du|des|en)(\s|['’])/iu.test(userPhrase)) {
    return tidy(splice(prev, {start: span.start - group[0].length, end: span.end}, userPhrase));
  }
  const full = newParcel.nom, bare = full.replace(/^(les|le|la|l['’])\s*/i, '');
  // « aux Brosses » → « au Grand Champ », « au Grand Champ » → « aux Brosses » : la préposition (à, de)
  // est accordée à l’article du nouveau nom, que l’ancien nom ait été cité avec ou sans son article.
  const kind = group && (/^(au|aux|[aà]\s)/i.test(group[0]) ? 'a' : /^(du|des|de\s)/i.test(group[0]) ? 'de' : null);
  if (kind) {
    const art = (full.match(/^(les|le|la|l['’])\s*/i)?.[1] || '').toLowerCase().replace('’', "'");
    const table = {a: {le: 'au ', les: 'aux ', la: 'à la ', "l'": "à l'", '': 'à '}, de: {le: 'du ', les: 'des ', la: 'de la ', "l'": "de l'", '': 'de '}};
    return tidy(splice(prev, {start: span.start - group[0].length, end: span.end}, `${table[kind][art] ?? table[kind]['']}${bare}`));
  }
  return tidy(splice(prev, span, oldHit.bare ? bare : full));
}

/**
 * Reformule une relance à partir de la dernière question comprise.
 * previous : {question, intent}. Retourne {question, kind} ; {unresolved:true, term} si la relance
 * a la bonne forme mais que l’élément cité n’est ni un client, ni une parcelle, ni une période ;
 * null si ce n’est pas une relance ou s’il n’y a rien à reprendre.
 */
export function rewriteFollowUp(question, previous, state = {}) {
  const f = detectFollowUp(question), prev = String(previous?.question || '').trim();
  if (!f || !prev) return null;
  if (f.kind === 'time') {
    const q = replaceTime(prev, f.term, f.timeCategory);
    return q && qNorm(q) !== qNorm(prev) ? {question: q, kind: 'time', term: f.term} : null;
  }
  const prevClient = clientMention(prev, state)?.client, prevParcel = parcelMention(prev, state);
  const newClient = clientMention(f.term, state), newParcel = parcelMention(f.term, state);
  const billing = /^billing_/.test(String(previous?.intent || ''));
  // Le type de l’ancienne question décide : un nom à la fois client et parcelle suit la question précédente.
  if (prevClient && newClient && (billing || !prevParcel || !newParcel)) {
    const span = clientSpan(prev, prevClient);
    const name = newClient.client ? newClient.client.name : f.term.replace(/^(chez|pour)\s+/iu, '');
    if (span) return {question: tidy(splice(prev, span, name)), kind: 'client', term: f.term};
  }
  if (prevParcel && newParcel) {
    const q = replaceParcel(prev, prevParcel, newParcel.parcel, f.term);
    if (q) return {question: q, kind: 'parcel', term: f.term};
  }
  return {unresolved: true, term: f.term, previousKind: prevClient ? 'client' : prevParcel ? 'parcel' : null};
}

/** Phrase de transparence ajoutée à la réponse. */
export const understoodNote = question => `(compris : « ${question} »)`;
