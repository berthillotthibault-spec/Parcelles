// @ts-check
// Pâturage dans le « + » : logique pure, sans DOM. Trois gestes (Mettre au pré, Rentrer ou retirer du pré, Changer
// de pré). Un passage par pré et par catégorie : le total est saisi une fois puis réparti, jamais recopié.
// Écritures dans grazing-records.js ; interface dans quick-grazing-ui.js.
import {filterGrazingSessions, grazingAnimalList, grazingDate, grazingStatus, grazingTotal, isForageParcel, linkGrazingAnimals, parseGrazingAnimals,
  restLabel, stockingRate, ugbCategory, ugbTable} from './grazing.js';
import {animalLot, filterAnimals, lotAssignment, lotLabel, normalizeNationalId} from './herd.js';
import {herdLots, moveDestinations} from './herd-home.js';
import {grazingReentryConflict} from './phyto.js';
import {buildQuickWorks, parcelChoices} from './quick-work.js';
import {campaignFor} from './utils.js';

const live = list => (Array.isArray(list) ? list : []).filter(item => item && !item.deletedAt);
const whole = value => { const n = Number(String(value ?? '').trim().replace(',', '.')); return Number.isSafeInteger(n) && n >= 0 ? n : null; };
/** Libellé court d'une catégorie : « Veau (moins de 1 an) » devient « Veau ». @param {string|null|undefined} key */
export const categoryShortLabel = key => (ugbCategory(key)?.label || '').replace(/\s*\(.*\)$/, '');

/** Saisie vierge d'une mise au pré ; type et catégorie repris du dernier passage. @param {any} data @param {{parcelIds?: string[]}} [options] */
export function freshEntry(data, {parcelIds = []} = {}) {
  const last = live(data?.grazingSessions).filter(s => s.startDate).sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))[0];
  return {parcelIds: [...parcelIds], dateChoice: 'today', customDate: '', endDate: '', animalType: last?.animalType && last.animalType !== 'Non précisé' ? last.animalType : 'Bovins',
    lotName: '', numbers: '', lines: [{category: last?.animalCategory || '', count: ''}], picks: {}, alloc: {}, rotate: false, entryParcelId: parcelIds[0] || '', skip: [], reentryAck: ''};
}

/** Gestes proposés : sans lot au pré, on passe directement à la mise au pré ; le lot du pré choisi vient d'abord. @param {any} data @param {{today: string, parcelIds?: string[]}} options */
export function grazingGestures(data, {today, parcelIds = []}) {
  const lots = herdLots(data, {today});
  const here = lots.filter(l => parcelIds.includes(l.parcelId)), others = lots.filter(l => !parcelIds.includes(l.parcelId));
  return {lots: [...here, ...others], hereIds: here.map(l => l.id), skipToEntry: !lots.length};
}

/**
 * Prés de la saisie : prairies en tête, avec occupation et repos à la date. Le filtre par défaut est « pasture » s'il y en a une.
 * @param {any} data @param {{type: string, today: string, date?: string, selected?: string[], query?: string, filter?: string}} options
 */
export function grazingParcelRows(data, {type, today, date = today, selected = [], query = '', filter = 'all'}) {
  const status = new Map(moveDestinations(data, {today: date, all: true}).map(r => [r.parcel.id, r]));
  const sessions = data?.grazingSessions || [];
  const rank = row => (isForageParcel(row.parcel, sessions) ? 0 : 1);
  return parcelChoices(data, {type, today, selected, query, filter}).map((row, i) => ({...row, i}))
    .sort((a, b) => rank(a) - rank(b) || a.i - b.i)
    .map(({i: _i, ...row}) => ({...row, forage: isForageParcel(row.parcel, sessions), occupied: Boolean(status.get(row.parcel.id)?.occupied), status: status.get(row.parcel.id)?.status || ''}));
}
/** Filtre de départ de l'étape des prés. @param {any} data */
export const defaultGrazingFilter = data => live(data?.parcelles).some(p => !p.archived && isForageParcel(p, data?.grazingSessions || [])) ? 'pasture' : 'all';

/**
 * Alertes d'une mise au pré à la date choisie. Occupation, repos, parcelle non fourragère et sortie le jour de
 * l'entrée avertissent ; le délai de rentrée phyto (reentry) demande une confirmation par un bouton distinct.
 * @param {any} data @param {{parcelIds: string[], date: string, endDate?: string, ignoreId?: string, now?: number, withReentry?: boolean}} options
 * @returns {{kind: string, parcelId: string, message: string}[]}
 */
export function grazingEntryAlerts(data, {parcelIds, date, endDate = '', ignoreId = '', now, withReentry = true}) {
  const parcels = live(data?.parcelles), sessions = live(data?.grazingSessions).filter(s => s.id !== ignoreId);
  const others = {...data, grazingSessions: sessions}, out = [];
  const fmt = iso => iso.split('-').reverse().join('/'), until = endDate || grazingDate(now === undefined ? new Date() : new Date(now));
  for (const id of parcelIds || []) {
    const parcel = parcels.find(p => p.id === id);
    if (!parcel) continue;
    const name = parcel.nom || 'Parcelle';
    // Tout passage qui recoupe [entrée, sortie ou aujourd'hui] : une entrée rétroactive peut recouvrir un passage plus récent.
    const occupants = filterGrazingSessions(sessions, {parcelId: id, date});
    const later = sessions.filter(s => s.parcelId === id && !occupants.includes(s) && grazingStatus(s) !== 'invalid' && (endDate ? grazingDate(s.startDate) < until : grazingDate(s.startDate) <= until)
      && grazingDate(s.startDate) >= date && (!s.endDate || grazingDate(s.endDate) > date));
    if (occupants.length) out.push({kind: 'occupied', parcelId: id, message: `${name} : déjà occupé le ${fmt(date)} par ${occupants.map(lotLabel).join(', ')}.`});
    for (const s of later) out.push({kind: 'occupied', parcelId: id, message: `${name} : déjà occupé du ${fmt(grazingDate(s.startDate))} au ${s.endDate ? fmt(grazingDate(s.endDate)) : 'aujourd’hui'} par ${lotLabel(s)}.`});
    const rate = stockingRate(others, id, {date});
    if (!occupants.length && rate.rested === false) out.push({kind: 'rest', parcelId: id, message: `${name} : ${restLabel(rate).toLowerCase()}.`});
    if (!isForageParcel(parcel, sessions)) out.push({kind: 'forage', parcelId: id, message: `${name} n’est pas une prairie : sa surface comptera ensuite dans la surface fourragère.`});
    if (withReentry) {
      const alert = grazingReentryConflict(data, id, date, now === undefined ? {} : {now});
      if (alert) out.push({kind: 'reentry', parcelId: id, message: `${name} : ${alert.message}`});
    }
  }
  if (endDate && endDate === date) out.push({kind: 'oneday', parcelId: '', message: 'Sortie le jour de l’entrée : ce passage compte 0 jour de présence.'});
  return out;
}

/** Répartit un total au prorata des surfaces, en entiers de somme exacte ; parts égales si une surface manque. @param {number} total @param {{id: string, surfaceHa?: unknown}[]} parcels */
export function splitByArea(total, parcels) {
  const list = parcels || [], areas = list.map(p => Number(p.surfaceHa));
  if (!list.length) return {};
  const usable = areas.every(a => Number.isFinite(a) && a > 0);
  const weights = usable ? areas : areas.map(() => 1), sum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map(w => total * w / sum), floors = shares.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  shares.map((share, i) => ({i, rest: share - floors[i]})).sort((a, b) => b.rest - a.rest || a.i - b.i).forEach(({i}) => { if (left > 0) { floors[i] += 1; left -= 1; } });
  return Object.fromEntries(list.map((p, i) => [p.id, floors[i]]));
}

/** Tranche d'âge d'un animal à la date. @param {any} animal @param {string} date */
export function ageClass(animal, date) {
  if (!animal?.birthDate) return '';
  const months = (Number(date.slice(0, 4)) - Number(animal.birthDate.slice(0, 4))) * 12 + Number(date.slice(5, 7)) - Number(animal.birthDate.slice(5, 7));
  return months < 12 ? 'under1' : months < 24 ? 'y1to2' : 'over2';
}
export const HERD_FILTERS = Object.freeze([['all', 'Tous'], ['F', 'Femelles'], ['M', 'Mâles'], ['under1', 'Moins de 1 an'], ['y1to2', '1 à 2 ans'], ['over2', 'Plus de 2 ans']]);

/**
 * Troupeau groupé à la date choisie (saisie rétroactive comprise) : au bâtiment d'abord, puis par lot au pré.
 * lotOpen : le lot de cette date est encore ouvert aujourd'hui, donc l'animal le quitte. leavesName : lot ouvert
 * commencé après cette date, que l'animal quitterait aussi. Un lot déjà clos n'est jamais modifié.
 * @param {any} data @param {{date: string, today?: string, query?: string, filter?: string}} options
 */
export function herdGroups(data, {date, today = date, query = '', filter = 'all'}) {
  const keep = a => filter === 'all' || a.sex === filter || ageClass(a, date) === filter;
  const groups = new Map([['inside', {id: 'inside', label: 'Au bâtiment', animals: /** @type {any[]} */ ([])}]]);
  for (const animal of filterAnimals(data, {status: 'present', today: date, query}).filter(keep)) {
    const lot = lotsAtDate(data, animal, date);
    const key = lot?.id || 'inside';
    if (!groups.has(key)) groups.set(key, {id: key, label: lot ? lotLabel(lot) : 'Au bâtiment', animals: []});
    const listing = session => grazingAnimalList(session).find(x => x.animalId === animal.id || (animal.nationalId && x.number === animal.nationalId));
    const item = lot ? listing(lot) : null;
    const later = lot ? null : animalLot(data, animal, {today});
    groups.get(key)?.animals.push({animal, lotId: lot?.id || '', lotName: lot ? lotLabel(lot) : '', lotOpen: Boolean(lot) && !lotClosed(lot, today),
      leavesName: later && listing(later) ? lotLabel(later) : '', gestation: Boolean(item?.gestation)});
  }
  return [...groups.values()].filter(g => g.animals.length);
}
const lotClosed = (lot, today) => Boolean(lot.endDate) && grazingDate(lot.endDate) <= today;
function lotsAtDate(data, animal, date) {
  const lot = animalLot(data, animal, {today: date});
  return lot && grazingStatus(lot, {date}) === 'current' ? lot : null;
}

/** Animal du troupeau devenu élément de lot ; la gestation notée dans son lot d'origine le suit. @param {any} animal @param {boolean} [gestation] */
const animalItem = (animal, gestation = false) => ({number: animal.nationalId || animal.name, name: animal.name || '', animalId: animal.id, gestation});

const nameKey = value => String(value ?? '').replace(/\s+/g, '').toLocaleUpperCase('fr');
/** Numéros ou noms tapés, reliés aux fiches : un nom exact doit désigner une seule fiche présente à la date. @param {any} data @param {string} text @param {string} date */
function typedAnimals(data, text, date) {
  const present = filterAnimals(data, {status: 'present', today: date});
  return linkGrazingAnimals(parseGrazingAnimals(text), live(data?.animals)).map(item => {
    if (item.animalId) return item;
    const same = present.filter(a => a.name && nameKey(a.name) === nameKey(item.number));
    if (same.length > 1) throw new Error(`Plusieurs animaux s’appellent « ${item.number} » : indiquez leur numéro.`);
    return same.length ? animalItem(same[0], Boolean(item.gestation)) : item;
  });
}

/** Coches limitées aux animaux présents à la date (changement de date, reprise de brouillon). @param {any} data @param {Record<string, any>} picks @param {string} date */
export function presentPicks(data, picks, date) {
  const here = new Set(filterAnimals(data, {status: 'present', today: date}).map(a => a.id));
  return Object.fromEntries(Object.entries(picks || {}).filter(([id]) => here.has(id)));
}

/** Parcelles de la saisie, dans l'ordre de sélection : le même ordre à l'écran et à l'enregistrement (départage des restes). @param {any} data @param {string[]} ids */
export const selectedParcels = (data, ids) => (ids || []).map(id => live(data?.parcelles).find(p => p.id === id)).filter(Boolean);

/** Saisie déjà terminée : le passage est de l'historique, le lot actuel de l'animal ne change pas. @param {any} entry @param {string} today */
export const finishedEntry = (entry, today) => Boolean(entry?.endDate) && entry.endDate <= today;

/** Le formulaire complet n'écrit que le passage : réservé à une saisie sans animal d'un lot ni travail à clore. @param {any} entry @param {{workId?: string}} [options] */
export const fullFormAllowed = (entry, {workId = ''} = {}) => !workId && !Object.keys(entry?.picks || {}).length && !String(entry?.numbers || '').trim();

/** Répartition d'une ligne entre les prés : saisie (somme contrôlée) ou au prorata des surfaces, en ordre de sélection. */
function lineSplit(entry, l, count, line, lineTotal, targets, parcels) {
  if (targets.length === 1) return {[targets[0]]: count};
  const alloc = entry.alloc?.[l] || {};
  const given = Object.keys(alloc).length ? targets.map(id => (String(alloc[id] ?? '').trim() === '' ? 0 : whole(alloc[id]))) : null;
  if (given?.includes(null)) throw new Error('Répartition : indiquez des nombres entiers.');
  const split = given ? Object.fromEntries(targets.map((id, i) => [id, given[i]])) : splitByArea(count, targets.map(id => parcels.find(p => p.id === id) || {id}));
  const sum = Object.values(split).reduce((a, b) => a + Number(b), 0);
  if (sum !== count) throw new Error(`Répartition : ${sum} réparti${sum > 1 ? 's' : ''} pour ${count} sans numéro${lineTotal > 1 ? ` (${categoryShortLabel(line.category) || `ligne ${l + 1}`})` : ''}.`);
  return split;
}

/**
 * Passages à écrire à partir de la saisie. Refuse une répartition dont la somme ne correspond pas au total.
 * @param {any} entry @param {any} data @param {{today: string, date: string}} options
 * @returns {{entries: Record<string, any>[], animals: any[], total: number, unknownCategory: boolean, noLotName: boolean}}
 */
export function buildGrazingEntries(entry, data, {today, date}) {
  const parcels = live(data?.parcelles);
  const ids = (entry.parcelIds || []).filter(id => parcels.some(p => p.id === id));
  if (!ids.length) throw new Error('Choisissez au moins un pré.');
  if (date > today) throw new Error('Une entrée future s’enregistre comme travail à faire.');
  if (entry.endDate && entry.endDate < date) throw new Error('La sortie doit être postérieure ou égale à l’entrée.');
  const rotate = Boolean(entry.rotate) && ids.length > 1;
  const targets = rotate ? [ids.includes(entry.entryParcelId) ? entry.entryParcelId : ids[0]] : ids;
  const lines = entry.lines?.length ? entry.lines : [{category: '', count: ''}];
  const counts = lines.map((line, i) => {
    const n = String(line.count ?? '').trim() === '' ? 0 : whole(line.count);
    if (n === null) throw new Error(`Effectif invalide${lines.length > 1 ? ` à la ligne ${i + 1}` : ''} : indiquez un nombre entier.`);
    return n;
  });
  const typed = typedAnimals(data, entry.numbers || '', date);
  // Seuls les animaux présents à la date comptent : une coche restée sur un animal sorti (ou pas encore arrivé) est ignorée.
  const herd = new Map(filterAnimals(data, {status: 'present', today: date}).map(a => [a.id, a]));
  const groups = herdGroups(data, {date}).flatMap(g => g.animals);
  const picks = Object.entries(entry.picks || {}).filter(([id]) => herd.has(id)).map(([id, pick]) => ({
    item: animalItem(herd.get(id), Boolean(groups.find(g => g.animal.id === id)?.gestation)),
    line: Math.min(lines.length - 1, Math.max(0, Number(/** @type {any} */ (pick)?.line) || 0)),
    parcelId: targets.includes(/** @type {any} */ (pick)?.parcelId) ? /** @type {any} */ (pick).parcelId : targets[0]}));
  // Un numéro tapé qui correspond à un animal coché ne compte qu'une fois.
  const keyOf = item => item.animalId || nameKey(item.number || item.name);
  const seen = new Set(picks.map(p => keyOf(p.item)));
  const extras = typed.filter(item => { const key = keyOf(item); if (seen.has(key)) return false; seen.add(key); return true; });
  const entries = [];
  lines.forEach((line, l) => {
    const split = lineSplit(entry, l, counts[l], line, lines.length, targets, parcels);
    for (const parcelId of targets) {
      const animals = [...picks.filter(p => p.line === l && p.parcelId === parcelId).map(p => p.item), ...(l === 0 && parcelId === targets[0] ? extras : [])];
      const additional = Number(split[parcelId]) || 0;
      if (!animals.length && !additional) continue;
      const base = String(entry.lotName || '').trim();
      const name = parcels.find(p => p.id === parcelId)?.nom;
      // Convention du nom : nom de lot, catégorie si le lot en compte plusieurs, pré si le lot est partagé.
      const note = [base, lines.length > 1 ? categoryShortLabel(line.category) : '', base && targets.length > 1 ? name : ''].filter(Boolean).join(' · ');
      entries.push({parcelId, animalType: String(entry.animalType || '').trim() || 'Non précisé', animalCategory: line.category || null,
        startDate: date, endDate: entry.endDate || null, animals, additionalAnimalsCount: additional, note});
    }
  });
  if (!entries.length) throw new Error('Indiquez combien d’animaux, ou cochez-les dans le troupeau.');
  return {entries, animals: entries.flatMap(row => row.animals), total: entries.reduce((sum, row) => sum + row.animals.length + row.additionalAnimalsCount, 0),
    unknownCategory: entries.some(row => !row.animalCategory), noLotName: !String(entry.lotName || '').trim()};
}

/**
 * Sortie des animaux choisis de leurs lots ouverts, sans doublon entre lots et sans réécrire le passé. À calculer avant
 * d'écrire les nouveaux passages.
 * Lot commencé avant la date : il est clos à cette date avec sa liste intacte (closed s'il est repris en entier), et le
 * reste repart dans un nouveau passage (creates), comme removeAnimalFromLot.
 * Lot commencé à cette date ou après : les animaux n'y ont pas compté, la liste est corrigée ; vidé, il est toujours clos à son
 * entrée (emptied, pour l'annoncer) : un lot ouvert à 0 animal n'existe pas.
 * Lot déjà clos ou saisie terminée (endDate passée) : rien ne change, c'est de l'historique.
 * @param {any} data @param {any[]} animals éléments {number, name, animalId, gestation} @param {{date: string, today?: string, endDate?: string}} options
 */
export function planLotMoves(data, animals, {date, today = date, endDate = ''}) {
  if (finishedEntry({endDate}, today)) return {updates: [], creates: [], emptied: [], closed: []};
  const original = live(data?.grazingSessions);
  let sessions = original;
  const changed = new Map();
  for (const item of animals) {
    const animal = live(data?.animals).find(a => a.id === item.animalId) || {id: item.animalId || '', nationalId: item.number, name: item.name};
    for (const row of lotAssignment({...data, grazingSessions: sessions}, animal, null, {today: date})) {
      changed.set(row.id, row);
      sessions = sessions.map(s => (s.id === row.id ? row : s));
    }
    // Lot qui compte l'animal par sa fiche (sessionId) sans le lister : il perd une tête de son effectif hors liste.
    const noted = animalLot({...data, grazingSessions: sessions}, animal, {today: date});
    const key = normalizeNationalId(animal.nationalId);
    const listed = noted && grazingAnimalList(noted).some(x => x.animalId === animal.id || (key && normalizeNationalId(x.number) === key));
    if (noted && !listed && (!noted.animals || Array.isArray(noted.animals))) {
      const list = grazingAnimalList(noted), rest = grazingTotal(noted) - list.length;
      if (rest > 0) {
        const row = {...noted, animals: list, additionalAnimalsCount: rest - 1, animalsCount: list.length + rest - 1};
        changed.set(row.id, row);
        sessions = sessions.map(s => (s.id === row.id ? row : s));
      }
    }
  }
  const updates = [], creates = [], emptied = [], closed = [];
  for (const row of changed.values()) {
    const before = original.find(s => s.id === row.id);
    if (!before || lotClosed(before, today)) continue;
    const list = grazingAnimalList(row), additional = Number(row.additionalAnimalsCount) || 0, total = list.length + additional;
    const start = grazingDate(row.startDate);
    if (date > start) {
      updates.push({...before, endDate: date});
      if (total) creates.push({parcelId: row.parcelId, animalType: row.animalType || 'Non précisé', animalCategory: row.animalCategory || null, note: row.note || '', startDate: date,
        endDate: before.endDate || null, animals: list, additionalAnimalsCount: additional, animalsCount: total});
      else closed.push({id: row.id, name: lotLabel(row)});
      continue;
    }
    if (!total) emptied.push({id: row.id, name: lotLabel(row)});
    updates.push({...row, animalsCount: total, ...(!total ? {endDate: start} : {})});
  }
  return {updates, creates, emptied, closed};
}

/**
 * Travaux et tâches de pâturage prévus à clore : seulement après l'écriture du passage, jamais pour une date future.
 * Le travail d'où vient la saisie (workId, finish-work) est toujours clos.
 * @param {any} data @param {{closing: {works: any[], tasks: any[]}, date: string, skip?: string[], workId?: string}} options
 */
export function grazingClosings(data, {closing, date, skip = [], workId = ''}) {
  const source = workId ? live(data?.interventions).find(w => w.id === workId) : null;
  const works = [...closing.works.filter(w => !skip.includes(w.id) && w.id !== workId), ...(source ? [source] : [])]
    .map(w => ({...w, status: 'Terminé', plannedDate: w.plannedDate || w.date || '', date, campaignId: campaignFor(date)}));
  return {works, tasks: closing.tasks.filter(t => !skip.includes(t.id)).map(t => ({...t, status: 'Terminé'}))};
}

/** Effectif et lot prévus, en note du travail « À faire ». @param {any} entry */
export function plannedNote(entry) {
  const total = (entry.lines || []).reduce((sum, line) => sum + (whole(line.count) || 0), 0) + Object.keys(entry.picks || {}).length
    + String(entry.numbers || '').split('\n').filter(line => line.trim()).length;
  const cats = (entry.lines || []).map(line => categoryShortLabel(line.category)).filter(Boolean);
  return [total ? `Prévu : ${total} ${total > 1 ? 'animaux' : 'animal'}` : '', String(entry.animalType || '').trim(), ...cats, String(entry.lotName || '').trim()].filter(Boolean).join(' · ');
}

/**
 * Date future : un travail « À faire » par pré recevant des animaux, aucun passage. Répartition contrôlée comme pour une
 * entrée du jour. Le travail porte grazingPlan (la part de ce pré), rechargé par plannedEntry à sa clôture.
 * @param {any} entry @param {any} data @param {{type: string, date: string, today: string, batchId?: string}} options
 */
export function plannedGrazingWorks(entry, data, {type, date, today, batchId = ''}) {
  const asked = (entry.lines || []).some(line => String(line.count ?? '').trim()) || Object.keys(entry.picks || {}).length || String(entry.numbers || '').trim();
  const rows = asked ? buildGrazingEntries({...entry, endDate: ''}, data, {today: date, date}).entries : [];
  const entryParcel = entry.rotate && entry.parcelIds?.length > 1 ? [entry.entryParcelId || entry.parcelIds[0]] : entry.parcelIds;
  const targets = rows.length ? [...new Set(rows.map(row => row.parcelId))] : entryParcel;
  return (targets || []).flatMap(parcelId => {
    const mine = rows.filter(row => row.parcelId === parcelId);
    const plan = {animalType: String(entry.animalType || '').trim(), lotName: String(entry.lotName || '').trim(),
      lines: mine.length ? mine.map(row => ({category: row.animalCategory || '', count: row.additionalAnimalsCount ? String(row.additionalAnimalsCount) : ''})) : (entry.lines || []),
      picks: mine.flatMap((row, line) => row.animals.filter(a => a.animalId).map(a => ({id: a.animalId, line}))),
      numbers: mine.flatMap(row => row.animals.filter(a => !a.animalId).map(a => `${a.number}${a.gestation ? ' | gestante' : ''}`)).join('\n')};
    return buildQuickWorks({type, parcelIds: [parcelId], date, note: plannedNote(plan), equipmentId: ''}, data, {today, batchId}).creates.map(work => ({...work, grazingPlan: plan}));
  });
}

/** Champs de saisie rechargés depuis le travail prévu (grazingPlan). @param {any} plan */
export function plannedEntry(plan) {
  return {animalType: plan?.animalType || 'Bovins', lotName: plan?.lotName || '', numbers: plan?.numbers || '',
    lines: plan?.lines?.length ? plan.lines.map(line => ({category: line.category || '', count: line.count ?? ''})) : [{category: '', count: ''}],
    picks: Object.fromEntries((plan?.picks || []).map(pick => [pick.id, {line: Number(pick.line) || 0, parcelId: ''}]))};
}

/** Table UGB effective, pour les listes de catégories. @param {any} data */
export const grazingCategories = data => ugbTable(data).categories;
