// Moteur de requêtes en langage naturel (n° 101) : analyse pure d'une question
// puis exécution en lecture seule sur l'état. Aucune écriture, aucun réseau.
import {campaignFor, isoDate, normalize, toNullableNumber} from './utils.js';

const active = (state, key) => (state?.[key] || []).filter(item => item && !item.deletedAt);
const done = w => ['Terminé', 'Terminée'].includes(w.status || 'Terminé');
const cancelled = w => w.status === 'Annulé';
const pad = n => String(n).padStart(2, '0');
const dayIso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const fmt = (value, digits = 2) => new Intl.NumberFormat('fr-FR', {maximumFractionDigits: digits}).format(Number(value) || 0);
const plural = (n, one, many) => `${fmt(n, 0)} ${n > 1 ? many : one}`;
const STOP = new Set(['le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'a', 'au', 'aux', 'en', 'et', 'sur', 'un', 'une']);
const KEEP_SHORT = new Set(['pre']);
const tokens = text => normalize(text).split(' ').filter(Boolean);
const meaningful = text => tokens(text).filter(t => KEEP_SHORT.has(t) || (!STOP.has(t) && t.length > 1));

export const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const MONTH_LABELS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Types de travaux reconnus : forme canonique, motif dans la question, motif sur le travail.
export const WORK_TYPES = [
  {key: 'fertilisation', label: 'fertilisation', ask: /\b(azote|azot\w*|ferti\w*|engrais|ammonitrate|uree|lisier|fumier|digestat|epandu|epandage|amendement)\b/, match: /ferti|azote|azot|engrais|ammonitrate|uree|solution n|lisier|fumier|digestat|epandage|compost|fiente|purin|amendement/},
  {key: 'desherbage', label: 'désherbage', ask: /\b(desherb\w*|herbicide\w*)\b/, match: /desherb|herbicide/},
  {key: 'fauche', label: 'fauche', ask: /\b(fauch\w*|fauche|foin|fenaison)\b/, match: /fauch|fauche|foin|fenaison|ensilage herbe/},
  {key: 'semis', label: 'semis', ask: /\b(semis|seme|semee|semes|semees|semer|ressemis)\b/, match: /\bsem|semis/},
  {key: 'recolte', label: 'récolte', ask: /\b(recolt\w*|moisson\w*|battage|ensil\w*)\b/, match: /recolt|moisson|battage|ensil/},
  {key: 'traitement', label: 'traitement', ask: /\b(traitement\w*|traite|traitee|traites|pulveri\w*|fongicide\w*|insecticide\w*|phyto\w*)\b/, match: /trait|pulveri|fongicide|insecticide|phyto/},
  {key: 'labour', label: 'labour', ask: /\b(labour\w*)\b/, match: /labour/},
  {key: 'broyage', label: 'broyage', ask: /\b(broy\w*)\b/, match: /broy/},
  {key: 'pressage', label: 'pressage', ask: /\b(press\w*|bottel\w*|enrubann\w*)\b/, match: /press|bottel|enrubann/},
  {key: 'travail du sol', label: 'travail du sol', ask: /\b(dechaum\w*|herse\w*|vibro\w*|travail du sol)\b/, match: /dechaum|herse|vibro|travail du sol/},
];

const MASS = {kg: 1, q: 100, t: 1000};
const VOLUME = {l: 1, 'm³': 1000, m3: 1000};
// Quantité apportée = dose × surface ; renvoie {amount, family, unit} ou {reason}.
export function appliedQuantity(work, parcel) {
  const dose = toNullableNumber(work.dose);
  if (dose === null || dose <= 0) return {reason: 'sans dose'};
  const unit = String(work.doseUnit || '').trim();
  const per = unit.match(/^(.+)\/ha$/i);
  if (!per) return {reason: unit ? 'unité non surfacique' : 'sans unité'};
  const area = toNullableNumber(work.surfaceWorked) ?? toNullableNumber(parcel?.surfaceHa);
  if (area === null || area <= 0) return {reason: 'sans surface'};
  const base = per[1].trim().toLowerCase(), total = dose * area;
  if (MASS[base]) return {amount: total * MASS[base], family: 'masse', unit: 'kg', converted: base !== 'kg'};
  if (VOLUME[base]) return {amount: total * VOLUME[base], family: 'volume', unit: 'L', converted: base !== 'l'};
  return {amount: total, family: base, unit: per[1].trim()};
}

export function workCost(work) {
  const total = toNullableNumber(work.cost);
  if (total !== null && total !== 0) return total;
  const parts = ['machineCost', 'inputCost', 'operatorCost', 'otherCost'].map(k => toNullableNumber(work[k])).filter(v => v !== null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

// Grands volumes lisibles : 200 000 L s'affichent 200 m³.
const qty = (total, unit) => unit === 'L' && total >= 10000 ? `${fmt(total / 1000)} m³` : `${fmt(total)} ${unit}`;

const workDay = w => String((done(w) ? w.date || w.plannedDate : w.plannedDate || w.date) || '').slice(0, 10);

// --- Périodes -------------------------------------------------------------
function campaignRange(label) {
  const y = Number(label.slice(0, 4));
  return {from: dayIso(y, 8, 1), to: dayIso(y + 1, 7, 31), label: `campagne ${label}`};
}
function monthRange(y, m) { return {from: dayIso(y, m, 1), to: dayIso(y, m, lastDay(y, m)), label: `${MONTH_LABELS[m - 1]} ${y}`}; }

function parseDay(text, refYear) {
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return dayIso(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/);
  if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : refYear; return dayIso(y, +m[2], +m[1]); }
  m = text.match(/^(\d{1,2})(?:er)? ([a-z]+)(?: (\d{4}))?$/);
  if (m && MONTHS.includes(m[2])) return dayIso(m[3] ? +m[3] : refYear, MONTHS.indexOf(m[2]) + 1, +m[1]);
  return null;
}

export function parsePeriod(question, {now = Date.now()} = {}) {
  const today = new Date(now), year = today.getFullYear(), month = today.getMonth() + 1;
  // Garder / . - pour les dates, retirer les accents.
  const q = String(question || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/\s+/g, ' ');
  const DAY = '(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.]\\d{1,2}(?:[/.]\\d{2,4})?|\\d{1,2}(?:er)? [a-z]+(?: \\d{4})?)';
  const between = q.match(new RegExp(`(?:entre(?: le)?|du) ${DAY} (?:et|au)(?: le)? ${DAY}`));
  if (between) {
    const a = parseDay(between[1], year), b = parseDay(between[2], year);
    if (a && b) { const [from, to] = a <= b ? [a, b] : [b, a]; return {from, to, label: `du ${from} au ${to}`}; }
  }
  const camp = q.match(/campagne (\d{4}) ?[/ -] ?(\d{2,4})/);
  if (camp) return campaignRange(`${camp[1]}/${camp[2].slice(-2)}`);
  const current = campaignFor(isoDate(today));
  if (/(cette|la) campagne(?! (derniere|precedente))|campagne en cours/.test(q)) return campaignRange(current);
  if (/campagne (derniere|precedente)|(derniere|precedente) campagne/.test(q)) return campaignRange(`${+current.slice(0, 4) - 1}/${String(+current.slice(0, 4)).slice(-2)}`);
  if (/\b(l an dernier|l annee derniere|l an passe|l annee passee)\b/.test(q)) return {from: dayIso(year - 1, 1, 1), to: dayIso(year - 1, 12, 31), label: `l’an dernier (${year - 1})`};
  if (/\bcette annee\b/.test(q)) return {from: dayIso(year, 1, 1), to: dayIso(year, 12, 31), label: `cette année (${year})`};
  if (/\bce mois\b/.test(q)) return monthRange(year, month);
  if (/\ble mois (dernier|passe)\b/.test(q)) return month === 1 ? monthRange(year - 1, 12) : monthRange(year, month - 1);
  if (/\bcette semaine\b/.test(q)) {
    const d = new Date(now); d.setHours(12); d.setDate(d.getDate() - (d.getDay() + 6) % 7); const from = isoDate(d); d.setDate(d.getDate() + 6);
    return {from, to: isoDate(d), label: 'cette semaine'};
  }
  const named = q.match(new RegExp(`\\b(?:en|au mois d|au mois de|mois de|d|de) ?(${MONTHS.join('|')})(?: (\\d{4}))?\\b`));
  if (named) {
    const m = MONTHS.indexOf(named[1]) + 1, y = named[2] ? +named[2] : (m > month ? year - 1 : year);
    return monthRange(y, m);
  }
  const inYear = q.match(/\ben (20\d{2})\b/);
  if (inYear) return {from: dayIso(+inYear[1], 1, 1), to: dayIso(+inYear[1], 12, 31), label: `en ${inYear[1]}`};
  return null;
}

// --- Entités nommées ------------------------------------------------------
function levenshtein(a, b) {
  if (a === b) return 0; if (!a) return b.length; if (!b) return a.length;
  const prev = Array.from({length: b.length + 1}, (_, i) => i), cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) { cur[0] = i; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); for (let j = 0; j <= b.length; j++) prev[j] = cur[j]; }
  return prev[b.length];
}
const tokenHit = (words, t) => words.includes(t) || (t.length >= 5 && words.some(w => Math.abs(w.length - t.length) <= 1 && levenshtein(w, t) <= 1));

// Une parcelle est citée si tous ses mots significatifs figurent dans la question
// (« Pré du Bas » retrouve « Le Pré Bas »). La plus longue l'emporte.
export function findParcels(question, state) {
  const words = meaningful(question);
  const scored = active(state, 'parcelles').map(p => {
    const t = meaningful(p.nom);
    return {p, n: t.length && t.every(x => tokenHit(words, x)) ? t.length : 0};
  }).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  if (!scored.length) return [];
  return scored.filter(x => x.n === scored[0].n).map(x => x.p);
}

function cultureOf(work, parcels) { return String(work.culture || parcels.get(work.parcelId)?.culture || '').trim(); }

function findCulture(question, state) {
  const words = meaningful(question);
  const cultures = [...new Set(active(state, 'parcelles').map(p => String(p.culture || '').trim()).filter(Boolean))];
  const hits = cultures.filter(c => { const t = meaningful(c); return t.length && tokenHit(words, t[0]); });
  if (!hits.length) return null;
  const first = meaningful(hits[0])[0];
  return {key: first, label: hits.length > 1 ? hits[0].split(' ')[0] : hits[0], cultures: hits};
}

function findEquipment(question, state) {
  const words = meaningful(question);
  return active(state, 'materiels').filter(m => { const t = meaningful([m.nom, m.type, m.category].filter(Boolean).join(' ')); return t.some(x => x.length > 3 && tokenHit(words, x)); });
}

function findProduct(question, state) {
  const words = meaningful(question);
  const names = new Set([...active(state, 'interventions').map(w => w.product), ...active(state, 'stockItems').map(s => s.name || s.nom), ...active(state, 'products').map(p => p.nom || p.name)].filter(Boolean).map(String));
  return [...names].filter(n => { const t = meaningful(n); return t.length && t.every(x => x.length > 3 && tokenHit(words, x)); }).sort((a, b) => b.length - a.length)[0] || null;
}

// --- Analyse ---------------------------------------------------------------
export function parseQuery(question, state, {now = Date.now()} = {}) {
  const q = normalize(question);
  const query = {question: String(question || ''), entity: 'works', measure: null, filters: {}, groupBy: null, period: parsePeriod(question, {now}), negate: false};
  if (!q) return {...query, recognized: false};
  const type = WORK_TYPES.find(t => t.ask.test(q));
  if (type) query.filters.type = type;
  const parcels = findParcels(question, state);
  if (parcels.length) query.filters.parcels = parcels;
  const culture = findCulture(question, state);
  if (culture && !parcels.some(p => meaningful(p.nom).includes(culture.key))) query.filters.culture = culture;
  const equipment = findEquipment(question, state);
  if (equipment.length) query.filters.equipment = equipment;
  const product = findProduct(question, state);
  if (product) query.filters.product = product;
  if (/\bpar parcelles?\b/.test(q)) query.groupBy = 'parcel';
  else if (/\bpar cultures?\b/.test(q)) query.groupBy = 'culture';

  if (/\b(stocks?|en reserve|reste t il|reste il)\b/.test(q)) query.entity = 'stock';
  else if (/\b(paturage|pature|paturages|patur\w*)\b/.test(q)) query.entity = 'grazing';
  else if (/\b(lots?|tonnes?|quintaux|rendements?)\b/.test(q) || (/\brecolt\w*\b/.test(q) && /\b(combien|quantite|volume)\b/.test(q) && active(state, 'integrationImports').some(r => r.farmKind === 'harvest'))) query.entity = 'harvests';

  query.negate = /\b(n ont pas|n a pas|pas eu|sans|jamais|aucun|aucune)\b/.test(q);
  if (/^quand\b|\bquand\b|\bquelle date\b|\bquelles dates\b|\bdernier passage\b/.test(q)) query.measure = 'dates';
  else if (/\bquelles? parcelles?\b/.test(q)) query.measure = 'parcels';
  else if (/\b(heures?|temps passe|combien de temps|duree)\b/.test(q)) query.measure = 'hours';
  else if (/\b(cout\w*|combien .*(depense|paye)|depense\w*|euros?|budget)\b/.test(q)) query.measure = 'cost';
  else if (/\b(surface|hectares?|combien d ha)\b/.test(q)) query.measure = 'surface';
  else if (/\b(jours?)\b/.test(q) && query.entity === 'grazing') query.measure = 'days';
  else if (/\b(combien de (fois|travaux|passages|interventions|traitements|lots|sessions)|nombre)\b/.test(q)) query.measure = 'count';
  else if (/\b(combien|quantite|total|somme|quel volume)\b/.test(q)) query.measure = query.entity === 'works' ? (type || product ? 'quantity' : 'count') : 'quantity';

  const f = query.filters;
  const workFilter = Boolean(f.type || f.product || f.equipment);
  let recognized = false;
  if (query.entity === 'stock') recognized = Boolean(f.product) || /\b(stocks?|en reserve)\b/.test(q) && Boolean(query.measure);
  else if (query.entity === 'grazing' || query.entity === 'harvests') recognized = Boolean(query.measure);
  else if (query.measure === 'parcels') recognized = workFilter;
  else if (query.measure === 'surface') recognized = workFilter || (Boolean(f.culture) && /\b(en|de|du)\b/.test(q));
  else recognized = Boolean(query.measure) && (workFilter || (Boolean(f.parcels) && query.measure !== 'dates' && Boolean(query.period)));
  if (query.measure === 'surface' && !workFilter && query.entity === 'works') query.entity = 'parcels';
  if (query.measure === 'quantity' && query.entity === 'works' && !(f.type?.key === 'fertilisation' || f.type?.key === 'traitement' || f.type?.key === 'semis' || f.product)) query.measure = 'count';
  return {...query, recognized};
}

// --- Exécution ---------------------------------------------------------------
function describeFilters(query) {
  const f = query.filters, parts = [];
  if (f.type) parts.push(f.type.label);
  if (f.product) parts.push(`produit « ${f.product} »`);
  if (f.culture) parts.push(`culture ${f.culture.label.toLowerCase()}`);
  if (f.parcels) parts.push(f.parcels.map(p => p.nom).join(', '));
  if (f.equipment) parts.push(`matériel ${f.equipment.map(m => m.nom).join(', ')}`);
  if (query.period) parts.push(query.period.label);
  return parts;
}

function matchWorks(state, query, {includePending = false} = {}) {
  const f = query.filters, parcels = new Map(active(state, 'parcelles').map(p => [p.id, p]));
  const ids = f.parcels ? new Set(f.parcels.map(p => p.id)) : null, eq = f.equipment ? new Set(f.equipment.map(m => m.id)) : null;
  const all = active(state, 'interventions').filter(w => !cancelled(w)).filter(w => {
    const text = normalize(`${w.type || ''} ${w.product || ''} ${w.category || ''}`);
    if (f.type && !f.type.match.test(text)) return false;
    if (f.product && !normalize(w.product).includes(normalize(f.product))) return false;
    if (ids && !ids.has(w.parcelId)) return false;
    if (eq && !eq.has(w.equipmentId) && !(w.equipmentIds || []).some(id => eq.has(id))) return false;
    if (f.culture && !f.culture.cultures.some(c => normalize(cultureOf(w, parcels)) === normalize(c))) return false;
    const day = workDay(w);
    if (query.period && (!day || day < query.period.from || day > query.period.to)) return false;
    return true;
  });
  const closed = all.filter(done), pending = all.filter(w => !done(w));
  return {works: includePending ? all : closed, pending, parcels};
}

function groupRows(items, key, label, value) {
  const map = new Map();
  for (const item of items) { const k = key(item); const row = map.get(k) || {label: label(item), value: 0, count: 0}; row.value += value(item); row.count++; map.set(k, row); }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

const result = (query, data) => ({recognized: true, query, filtersText: describeFilters(query), ...data});

function runWorks(state, query) {
  const {works, pending, parcels} = matchWorks(state, query);
  const name = w => parcels.get(w.parcelId)?.nom || 'Sans parcelle';
  const groupKey = query.groupBy === 'culture' ? (w => normalize(cultureOf(w, parcels)) || '-') : (w => w.parcelId || '-');
  const groupLabel = query.groupBy === 'culture' ? (w => cultureOf(w, parcels) || 'Culture inconnue') : name;
  const firstCol = query.groupBy === 'culture' ? 'Culture' : 'Parcelle';
  const pendingNote = pending.length ? `${plural(pending.length, 'travail prévu non compté', 'travaux prévus non comptés')} (seuls les travaux terminés comptent)` : '';
  const what = query.filters.type ? `travaux de ${query.filters.type.label}` : 'travaux';
  const notes = [pendingNote].filter(Boolean);

  if (query.measure === 'dates') {
    const sorted = [...works].sort((a, b) => workDay(b).localeCompare(workDay(a)));
    const rows = sorted.map(w => [workDay(w), name(w), w.type || '', w.product || '']);
    const answer = sorted.length ? `${sorted.length > 1 ? `${sorted.length} passages : ` : ''}${sorted.slice(0, 6).map(w => `${formatDay(workDay(w))}${query.filters.parcels?.length === 1 ? '' : ` (${name(w)})`}`).join(', ')}${sorted.length > 6 ? '…' : ''}.` : 'Aucun travail terminé ne correspond.';
    return result(query, {value: sorted.length, unit: '', answer, columns: ['Date', 'Parcelle', 'Travail', 'Produit'], rows, recipe: `Liste des ${what} terminés${query.period ? ` (${query.period.label})` : ''} : ${plural(sorted.length, 'travail retenu', 'travaux retenus')}, du plus récent au plus ancien.`, notes});
  }
  if (query.measure === 'parcels') {
    const all = active(state, 'parcelles').filter(p => !p.archived);
    const had = new Set(works.map(w => w.parcelId));
    const period = query.period || campaignRange(campaignFor(isoDate(new Date())));
    if (!query.period) { query.period = period; return runWorks(state, query); }
    const list = query.negate ? all.filter(p => !had.has(p.id)) : all.filter(p => had.has(p.id));
    const rows = list.map(p => [p.nom, p.culture || '', fmt(p.surfaceHa)]);
    const answer = list.length ? `${plural(list.length, 'parcelle', 'parcelles')} : ${list.slice(0, 8).map(p => p.nom).join(', ')}${list.length > 8 ? '…' : ''}.` : (query.negate ? 'Toutes les parcelles en ont eu.' : 'Aucune parcelle.');
    return result(query, {value: list.length, unit: list.length > 1 ? 'parcelles' : 'parcelle', answer, columns: ['Parcelle', 'Culture', 'Surface (ha)'], rows, recipe: `${plural(all.length, 'parcelle active', 'parcelles actives')} comparées à ${plural(works.length, `travail de ${query.filters.type?.label || 'ce type'} terminé`, `travaux de ${query.filters.type?.label || 'ce type'} terminés`)} (${period.label}) ; ${query.negate ? 'parcelles sans aucun passage' : 'parcelles avec au moins un passage'}.`, notes});
  }
  if (query.measure === 'hours' || query.measure === 'cost') {
    const isHours = query.measure === 'hours';
    const get = w => isHours ? toNullableNumber(w.duration) : workCost(w);
    const used = works.filter(w => { const v = get(w); return v !== null && v > 0; }), missing = works.length - used.length;
    const total = used.reduce((s, w) => s + get(w), 0), unit = isHours ? 'h' : '€';
    const rows = groupRows(used, groupKey, groupLabel, get).map(r => [r.label, fmt(r.value), fmt(r.count, 0)]);
    const label = isHours ? 'durée' : 'coût';
    return result(query, {value: total, unit, answer: `${fmt(total)} ${unit} sur ${plural(used.length, 'travail', 'travaux')}.`, columns: [firstCol, isHours ? 'Heures' : 'Coût (€)', 'Travaux'], rows, recipe: `Somme de ${plural(used.length, `${label} de travail terminé`, `${label}s de travaux terminés`)}${missing ? `, ${plural(missing, `travail sans ${label} exclu`, `travaux sans ${label} exclus`)}` : ''}.`, notes});
  }
  if (query.measure === 'surface') {
    const get = w => toNullableNumber(w.surfaceWorked) ?? toNullableNumber(parcels.get(w.parcelId)?.surfaceHa);
    const used = works.filter(w => get(w) > 0), fallback = used.filter(w => toNullableNumber(w.surfaceWorked) === null).length, missing = works.length - used.length;
    const total = used.reduce((s, w) => s + get(w), 0);
    const rows = groupRows(used, groupKey, groupLabel, get).map(r => [r.label, fmt(r.value), fmt(r.count, 0)]);
    return result(query, {value: total, unit: 'ha', answer: `${fmt(total)} ha travaillés en ${plural(used.length, 'passage', 'passages')}.`, columns: [firstCol, 'Surface (ha)', 'Travaux'], rows, recipe: `Somme des surfaces travaillées de ${plural(used.length, `${what.replace('travaux', 'travail')} terminé`, `${what} terminés`)}${fallback ? ` (surface de la parcelle pour ${fallback})` : ''}${missing ? `, ${plural(missing, 'travail sans surface exclu', 'travaux sans surface exclus')}` : ''}.`, notes});
  }
  if (query.measure === 'quantity') {
    const groups = new Map(), reasons = new Map();let converted = 0;
    for (const w of works) {
      const q = appliedQuantity(w, parcels.get(w.parcelId));
      if (q.reason) { reasons.set(q.reason, (reasons.get(q.reason) || 0) + 1); continue; }
      if (q.converted) converted++;
      const g = groups.get(q.unit) || {unit: q.unit, total: 0, works: []}; g.total += q.amount; g.works.push({w, amount: q.amount}); groups.set(q.unit, g);
    }
    const list = [...groups.values()].sort((a, b) => b.works.length - a.works.length), used = list.reduce((s, g) => s + g.works.length, 0);
    const excluded = [...reasons.entries()].map(([r, n]) => `${fmt(n, 0)} ${r}`).join(', ');
    const rows = [];
    for (const g of list) for (const r of groupRows(g.works, x => groupKey(x.w), x => groupLabel(x.w), x => x.amount)) rows.push([r.label, fmt(r.value), g.unit, fmt(r.count, 0)]);
    const main = list[0];
    const answer = !list.length ? 'Aucune dose exploitable.' : list.length === 1 ? `${qty(main.total, main.unit)} de produit apporté.` : `${list.map(g => qty(g.total, g.unit)).join(' et ')} : unités différentes, non additionnées.`;
    const recipe = `Somme dose × surface de ${plural(used, `${what.replace('travaux', 'travail')} terminé`, `${what} terminés`)}${excluded ? ` ; exclus : ${excluded}` : ''}. Seules des unités homogènes sont additionnées${converted ? ' (q et t convertis en kg, m³ en L)' : ''}.`;
    if (query.filters.type?.key === 'fertilisation') notes.push('Quantité de produit épandu, pas les unités d’azote : la teneur des produits n’est pas connue.');
    return result(query, {value: main?.total ?? 0, unit: main?.unit || '', answer, columns: [firstCol, 'Quantité', 'Unité', 'Travaux'], rows, recipe, notes, mixedUnits: list.length > 1});
  }
  // Nombre de travaux.
  const rows = groupRows(works, groupKey, groupLabel, () => 1).map(r => [r.label, fmt(r.count, 0)]);
  return result(query, {value: works.length, unit: works.length > 1 ? 'travaux' : 'travail', answer: `${plural(works.length, 'travail terminé', 'travaux terminés')}.`, columns: [firstCol, 'Travaux'], rows, recipe: `Nombre de ${what} terminés${query.period ? ` (${query.period.label})` : ''}.`, notes});
}

function runParcels(state, query) {
  const list = active(state, 'parcelles').filter(p => !p.archived && (!query.filters.culture || query.filters.culture.cultures.some(c => normalize(c) === normalize(p.culture))));
  const used = list.filter(p => toNullableNumber(p.surfaceHa) > 0), total = used.reduce((s, p) => s + toNullableNumber(p.surfaceHa), 0);
  return result(query, {value: total, unit: 'ha', answer: `${fmt(total)} ha sur ${plural(used.length, 'parcelle', 'parcelles')}.`, columns: ['Parcelle', 'Culture', 'Surface (ha)'], rows: used.sort((a, b) => b.surfaceHa - a.surfaceHa).map(p => [p.nom, p.culture || '', fmt(p.surfaceHa)]), recipe: `Somme des surfaces de ${plural(used.length, 'parcelle', 'parcelles')}${list.length - used.length ? `, ${fmt(list.length - used.length, 0)} sans surface exclue(s)` : ''} (culture actuelle de la fiche).`, notes: []});
}

function runStock(state, query) {
  const items = active(state, 'stockItems').filter(s => !query.filters.product || normalize(s.name || s.nom).includes(normalize(query.filters.product)));
  const byUnit = new Map();
  for (const s of items) { const u = s.unit || 'sans unité'; byUnit.set(u, (byUnit.get(u) || 0) + (toNullableNumber(s.quantity) || 0)); }
  const units = [...byUnit.entries()];
  const answer = !items.length ? 'Aucun article de stock ne correspond.' : units.map(([u, v]) => `${fmt(v)} ${u}`).join(' et ') + (units.length > 1 ? ' : unités différentes, non additionnées.' : ' en stock.');
  return result(query, {value: units[0]?.[1] ?? 0, unit: units[0]?.[0] || '', answer, columns: ['Article', 'Quantité', 'Unité'], rows: items.map(s => [s.name || s.nom || 'Article', fmt(s.quantity), s.unit || '']), recipe: `Quantités actuelles de ${plural(items.length, 'article de stock', 'articles de stock')}, additionnées par unité.`, notes: [], mixedUnits: units.length > 1});
}

function overlapDays(session, period, now) {
  const start = String(session.startDate || '').slice(0, 10); if (!start) return null;
  const end = String(session.endDate || '').slice(0, 10) || isoDate(new Date(now));
  const from = period && period.from > start ? period.from : start, to = period && period.to < end ? period.to : end;
  if (to < from) return 0;
  return Math.round((Date.parse(to + 'T12:00:00') - Date.parse(from + 'T12:00:00')) / 864e5) + 1;
}

function runGrazing(state, query, now) {
  const parcels = new Map(active(state, 'parcelles').map(p => [p.id, p])), ids = query.filters.parcels ? new Set(query.filters.parcels.map(p => p.id)) : null;
  const sessions = active(state, 'grazingSessions').filter(s => !ids || ids.has(s.parcelId)).map(s => ({s, days: overlapDays(s, query.period, now)})).filter(x => x.days === null || x.days > 0);
  const known = sessions.filter(x => x.days !== null), missing = sessions.length - known.length;
  const name = x => parcels.get(x.s.parcelId)?.nom || 'Sans parcelle';
  if (query.measure === 'count') {
    const rows = groupRows(sessions, x => x.s.parcelId, name, () => 1).map(r => [r.label, fmt(r.count, 0)]);
    return result(query, {value: sessions.length, unit: 'sessions', answer: `${plural(sessions.length, 'session de pâturage', 'sessions de pâturage')}.`, columns: ['Parcelle', 'Sessions'], rows, recipe: `Sessions de pâturage chevauchant ${query.period?.label || 'toute la période'}.`, notes: []});
  }
  const total = known.reduce((s, x) => s + x.days, 0);
  const rows = groupRows(known, x => x.s.parcelId, name, x => x.days).map(r => [r.label, fmt(r.value, 0), fmt(r.count, 0)]);
  return result(query, {value: total, unit: 'jours', answer: `${fmt(total, 0)} jours de pâturage.`, columns: ['Parcelle', 'Jours', 'Sessions'], rows, recipe: `Somme des jours de présence de ${plural(known.length, 'session', 'sessions')}${query.period ? `, limités à ${query.period.label}` : ''} (session en cours comptée jusqu’à aujourd’hui)${missing ? `, ${fmt(missing, 0)} sans date d’entrée exclue(s)` : ''}.`, notes: []});
}

function runHarvests(state, query) {
  const parcels = new Map(active(state, 'parcelles').map(p => [p.id, p])), ids = query.filters.parcels ? new Set(query.filters.parcels.map(p => p.id)) : null;
  const lots = active(state, 'integrationImports').filter(r => r.farmKind === 'harvest').filter(l => {
    if (ids && !ids.has(l.parcelId)) return false;
    if (query.filters.culture && !query.filters.culture.cultures.some(c => normalize(c) === normalize(l.culture || parcels.get(l.parcelId)?.culture))) return false;
    const day = String(l.date || '').slice(0, 10);
    return !query.period || (day && day >= query.period.from && day <= query.period.to);
  });
  const toKg = l => { const u = normalize(l.unit); const f = u === 't' || u.startsWith('tonne') ? 1000 : u === 'q' || u.startsWith('quint') || u === 'qx' ? 100 : u === 'kg' ? 1 : null; const n = toNullableNumber(l.quantity); return f && n !== null ? n * f : null; };
  const mass = lots.filter(l => toKg(l) !== null), other = lots.length - mass.length;
  const total = mass.reduce((s, l) => s + toKg(l), 0) / 1000;
  const rows = groupRows(mass, l => l.parcelId, l => parcels.get(l.parcelId)?.nom || 'Sans parcelle', l => toKg(l) / 1000).map(r => [r.label, fmt(r.value), fmt(r.count, 0)]);
  if (query.measure === 'count') return result(query, {value: lots.length, unit: 'lots', answer: `${plural(lots.length, 'lot de récolte', 'lots de récolte')}.`, columns: ['Parcelle', 't', 'Lots'], rows, recipe: 'Nombre de lots de récolte enregistrés.', notes: []});
  return result(query, {value: total, unit: 't', answer: `${fmt(total)} t récoltées.`, columns: ['Parcelle', 'Tonnes', 'Lots'], rows, recipe: `Somme de ${plural(mass.length, 'lot', 'lots')} convertis en tonnes${other ? `, ${fmt(other, 0)} lot(s) en unité non massique exclu(s)` : ''}.`, notes: []});
}

export function executeQuery(query, state, {now = Date.now()} = {}) {
  if (!query?.recognized) return {recognized: false};
  if (query.entity === 'stock') return runStock(state, query);
  if (query.entity === 'grazing') return runGrazing(state, query, now);
  if (query.entity === 'harvests') return runHarvests(state, query);
  if (query.entity === 'parcels') return runParcels(state, query);
  return runWorks(state, query);
}

export function answerQuery(question, state, options = {}) {
  const query = parseQuery(question, state, options);
  return query.recognized ? executeQuery(query, state, options) : {recognized: false, query};
}

export function formatDay(day) {
  const m = String(day || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${+m[3]} ${MONTH_LABELS[+m[2] - 1]} ${m[1]}` : String(day || '');
}

const csvCell = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function queryCsv(res) {
  const lines = [res.columns, ...res.rows].map(r => r.map(csvCell).join(';'));
  lines.push('', `Question;${csvCell(res.query?.question)}`, `Réponse;${csvCell(res.answer)}`, `Calcul;${csvCell(res.recipe)}`);
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// Suggestions construites sur les données réelles : rendent le moteur découvrable.
export function querySuggestions(state, {limit = 4} = {}) {
  const parcels = active(state, 'parcelles').filter(p => !p.archived), out = [];
  const crop = parcels.map(p => String(p.culture || '').split(' ')[0]).find(c => c && !/prairie/i.test(c));
  out.push(`Combien d’azote${crop ? ` sur le ${crop.toLowerCase()}` : ''} cette campagne ?`);
  const meadow = parcels.find(p => /prairie|pre/i.test(normalize(`${p.culture} ${p.nom}`))) || parcels[0];
  if (meadow) out.push(`Quand ai-je fauché ${meadow.nom} l’an dernier ?`);
  const machine = active(state, 'materiels')[0];
  out.push(`Combien d’heures${machine ? ` de ${String(machine.nom).toLowerCase()}` : ''} en ${MONTH_LABELS[(new Date().getMonth() + 11) % 12]} ?`);
  out.push('Quelles parcelles n’ont pas eu de désherbage ?');
  out.push('Coût des traitements par parcelle cette campagne ?');
  return out.slice(0, limit);
}
