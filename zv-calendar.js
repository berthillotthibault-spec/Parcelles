// Zones vulnérables nitrates : calendrier NATIONAL d'interdiction d'épandage des fertilisants azotés.
// Module pur, sans écriture. Source lue (Légifrance, version consolidée en vigueur au 12/11/2026,
// texte mis à jour en dernier par l'arrêté du 30 janvier 2023, en vigueur le 10/02/2023) :
// arrêté du 19 décembre 2011 modifié relatif au programme d'actions national à mettre en œuvre dans
// les zones vulnérables afin de réduire la pollution des eaux par les nitrates d'origine agricole,
// annexe I, partie I (périodes minimales d'interdiction d'épandage).
// Seules les lignes lues dans ce tableau sont codées. Les couverts d'interculture (conditions
// particulières), l'irrigation (note 4), les effluents peu chargés (notes 8 et 9) et les dérogations
// ne sont pas modélisés. Les programmes d'actions régionaux (PAR) peuvent allonger ces périodes :
// l'utilisateur peut ajouter ses périodes régionales (exploitation.azote.zvCalendar.periods, facultatif).
import {normalize} from './utils.js';
import {cultureReference} from './nitrogen.js';

export const ZV_CALENDAR_SOURCE = Object.freeze({
  text: 'Arrêté du 19 décembre 2011 modifié relatif au programme d’actions national nitrates, annexe I, I (périodes minimales d’interdiction d’épandage)',
  version: 'Version consolidée Légifrance, dernière modification par l’arrêté du 30 janvier 2023 (en vigueur le 10/02/2023), consultée le 12/11/2026',
  url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000025001662'
});
export const ZV_PAR_WARNING = 'Calendrier national minimal : le programme d’actions régional (PAR) de votre région peut allonger ces périodes ou ajouter des conditions. Vérifiez auprès de la DDT ou de la chambre d’agriculture.';

export const ZV_TYPE_LABELS = Object.freeze({
  Ia: 'Type I.a (minéralisation très lente : fumiers compacts pailleux, composts d’effluents)',
  Ib: 'Type I.b (minéralisation lente : autres fumiers avec litière, hors fumier de volaille)',
  I: 'Type I (fumier : I.a ou I.b à préciser)',
  II: 'Type II (minéralisation rapide : lisiers, purins, fientes et fumiers de volaille, digestats bruts)',
  III: 'Type III (engrais minéraux et uréiques de synthèse)'
});
export const ZV_OCCUPATION_LABELS = Object.freeze({
  automne: 'culture principale récoltée l’année suivante (hors colza)',
  colza: 'colza récolté l’année suivante',
  printemps: 'culture implantée et récoltée dans l’année (cultures de printemps)',
  prairie: 'prairie implantée depuis plus de six mois, prairie permanente, luzerne',
  autres: 'autres cultures (pérennes, vergers, vignes, maraîchage, porte-graines)'
});

// MM-JJ, bornes incluses ; une période qui passe le 31/12 a from > to.
// lift : dates (MM-JJ) où l'exception de la note peut lever l'interdiction (selon la région ou l'irrigation) ;
// ce n'est pas une date de l'arrêté mais la plage où l'interdiction n'est pas certaine pour tous.
const P = (occupation, type, from, to, note = '', lift = null) => Object.freeze({occupation, type, from, to, note, lift, origin: 'national'});
const SOUTH = 'Fin au 15/01 en Provence-Alpes-Côte d’Azur, Occitanie, Dordogne, Gironde, Landes, Lot-et-Garonne et Pyrénées-Atlantiques (note 5).';
const SOUTH_LIFT = Object.freeze(['01-16', '01-31']);
// Note 4 : type III autorisé jusqu'au 15/07 si irrigué, maïs irrigué jusqu'au brunissement des soies (date variable) :
// toute la fin d'été reste « exception possible ».
const IRRIGATED_LIFT = Object.freeze(['07-01', '08-31']);
export const ZV_NATIONAL_PERIODS = Object.freeze([
  P('automne', 'Ia', '11-15', '01-15'), P('automne', 'Ib', '11-15', '01-15'),
  P('automne', 'II', '10-01', '01-31', SOUTH, SOUTH_LIFT), P('automne', 'III', '09-01', '01-31', SOUTH, SOUTH_LIFT),
  P('colza', 'Ia', '11-15', '01-15'), P('colza', 'Ib', '11-15', '01-15'),
  P('colza', 'II', '10-15', '01-31', SOUTH, SOUTH_LIFT), P('colza', 'III', '09-01', '01-31', SOUTH, SOUTH_LIFT),
  P('printemps', 'Ia', '07-01', '08-31'), P('printemps', 'Ia', '11-15', '01-15'),
  P('printemps', 'Ib', '07-01', '01-15'), P('printemps', 'II', '07-01', '01-31'),
  P('printemps', 'III', '07-01', '02-15', 'Culture irriguée : type III autorisé jusqu’au 15/07 (maïs irrigué : jusqu’au brunissement des soies, note 4).', IRRIGATED_LIFT),
  P('prairie', 'Ia', '12-15', '01-15'), P('prairie', 'Ib', '12-15', '01-15'),
  P('prairie', 'II', '11-15', '01-15'),
  P('prairie', 'III', '10-01', '01-31', 'En zone de montagne, fin au 15/02 ou au 28/02 selon la zone.'),
  P('autres', 'Ia', '12-15', '01-15'), P('autres', 'Ib', '12-15', '01-15'),
  P('autres', 'II', '12-15', '01-15'), P('autres', 'III', '12-15', '01-15')
]);

const MD = /^\d{2}-\d{2}$/;
const TYPES = ['Ia', 'Ib', 'II', 'III'];
const CANDIDATES = {Ia: ['Ia'], Ib: ['Ib'], I: ['Ia', 'Ib'], II: ['II'], III: ['III']};
const inPeriod = (md, from, to) => from <= to ? md >= from && md <= to : md >= from || md <= to;
export const mdLabel = md => `${md.slice(3, 5)}/${md.slice(0, 2)}`;

/** Périodes en vigueur : calendrier national + périodes régionales saisies (facultatives, valides seulement). */
export function zvPeriods(state) {
  const raw = state?.exploitation?.azote?.zvCalendar?.periods;
  const extra = (Array.isArray(raw) ? raw : []).filter(p => ZV_OCCUPATION_LABELS[p?.occupation] && TYPES.includes(p?.type) && MD.test(p?.from) && MD.test(p?.to))
    .map(p => Object.freeze({occupation: p.occupation, type: p.type, from: p.from, to: p.to, note: String(p.label || 'Période régionale saisie'), lift: null, origin: 'regional'}));
  return [...ZV_NATIONAL_PERIODS, ...extra];
}

const MINERAL = /\b(ammonitrate|uree|solution azotee|solution n|sn ?39|sn ?30|uan|azote liquide|engrais (azote|mineral)|nitrate|sulfate d ammoniaque|sulfate d ammonium|dap|18 46|perlurea|n ?27|can ?27|chaux ?azote)\b/;
/**
 * Classement prudent d'un fertilisant (nom de produit, type de travail, article de stock).
 * @returns {{type:'Ia'|'Ib'|'I'|'II'|'III'|null, label:string, certain:boolean, why:string}}
 */
export function classifyFertilizer(product, {state = null, workType = ''} = {}) {
  const name = normalize(product), text = normalize(`${product || ''} ${workType || ''}`);
  const stock = name && (state?.stockItems || []).find(s => s && !s.deletedAt && s.fertilizer && normalize(s.name) === name);
  const declared = stock?.fertilizer?.zvType || stock?.fertilizer?.type;
  const out = (type, why, certain = true) => ({type, label: type ? ZV_TYPE_LABELS[type] : 'Type de fertilisant à préciser', certain, why});
  if (['Ia', 'Ib', 'II', 'III'].includes(declared)) return out(declared, `Type déclaré dans l’article de stock « ${stock.name} ».`);
  if (declared === 'I') return out('I', `Type I déclaré dans le stock : I.a ou I.b à préciser.`, false);
  if (/\b(lisiers?|purins?|fientes?|digestats? bruts?|eaux? blanches?|eaux? brunes?)\b/.test(text) || /\bfumier\b.*\bvolaille|volaille.*\bfumier\b/.test(text)) return out('II', 'Lisier, purin, fientes ou fumier de volaille : type II d’après l’arrêté.');
  if (/\bcompost\b/.test(text) && /\b(fientes?|volailles?)\b/.test(text)) return out('II', 'Compost de fientes de volaille : exclu du type I.a, type II retenu par prudence.', false);
  if (/\bcompost\b/.test(text) && /\b(dechets? verts?|vegetaux)\b/.test(text)) return out(null, 'Compost de déchets verts : type 0 ou I selon sa maturité, à préciser.', false);
  if (/\bcompost\b/.test(text)) return out('Ia', 'Compost d’effluents d’élevage : type I.a d’après l’arrêté (à confirmer si fientes de volaille).', false);
  if (/\bfumier\b/.test(text) && /\b(compact|pailleux|paille|tas|stocke)\b/.test(text)) return out('Ia', 'Fumier compact pailleux : type I.a s’il n’est pas susceptible d’écoulement.', false);
  if (/\bfumier\b/.test(text)) return out('I', 'Fumier : type I.a (compact, non susceptible d’écoulement) ou I.b, à préciser.', false);
  if (/\bdigestat\b/.test(text)) return out(null, 'Digestat : type II s’il est brut, I.a si fraction solide compostée, à préciser.', false);
  if (MINERAL.test(text)) return out('III', 'Engrais azoté minéral ou uréique de synthèse : type III.');
  return out(null, product ? `« ${product} » : type de fertilisant non reconnu, à préciser.` : 'Produit non renseigné : type de fertilisant à préciser.', false);
}

const OTHER_CROPS = /\b(vigne|verger|arbori|pommier|poirier|noyer|noisetier|maraich|legume|porte graine|semences?|asperge|houblon)\b/;
/** Occupation du sol du calendrier pour une culture (null si inconnue : à préciser). */
export function occupationFor(culture) {
  const text = normalize(culture);
  if (!text) return null;
  if (/\bcolza\b/.test(text)) return 'colza';
  if (OTHER_CROPS.test(text)) return 'autres';
  const ref = cultureReference(culture);
  if (ref?.season === 'automne' || ref?.season === 'printemps' || ref?.season === 'prairie') return ref.season;
  if (/\b(hiver|automne)\b/.test(text)) return 'automne';
  if (/\b(printemps|betterave|pomme de terre|lin)\b/.test(text)) return 'printemps';
  return null;
}

/** Périodes d'interdiction en cours à une date pour une occupation et un type (exact Ia/Ib/II/III). */
export function bansAt(date, occupation, type, periods = ZV_NATIONAL_PERIODS) {
  const md = String(date || '').slice(5, 10);
  if (!MD.test(md)) return [];
  return periods.filter(p => p.occupation === occupation && p.type === type && inPeriod(md, p.from, p.to));
}

/** Jour (ISO) qui suit la fin de période, en tenant compte du passage d'année. */
export function dayAfterBan(date, ban) {
  const y = Number(String(date).slice(0, 4)), md = String(date).slice(5, 10);
  const endYear = ban.from > ban.to && md >= ban.from ? y + 1 : y;
  const d = new Date(Date.UTC(endYear, Number(ban.to.slice(0, 2)) - 1, Number(ban.to.slice(3, 5)) + 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Épandage d'un fertilisant à une date sur une occupation du sol.
 * status : 'interdit' (tous les types possibles sont en période d'interdiction), 'a-preciser'
 * (interdit pour une partie des types possibles, ou occupation inconnue), 'autorise' (hors périodes
 * connues ; le PAR peut être plus strict).
 */
export function zvSpreadStatus({date, culture = '', product = '', workType = '', state = null, periods = zvPeriods(state)} = {}) {
  const fert = classifyFertilizer(product, {state, workType}), occupation = occupationFor(culture);
  const types = fert.type ? CANDIDATES[fert.type] : TYPES;
  const occs = occupation ? [occupation] : Object.keys(ZV_OCCUPATION_LABELS);
  const hits = [];
  // Pour chaque couple (occupation, type), la période qui finit le plus tard l'emporte (une période régionale peut
  // prolonger la nationale) ; à fin égale, la nationale.
  for (const occ of occs) for (const t of types) {
    const b = bansAt(date, occ, t, periods);
    if (!b.length) continue;
    const best = b.map(ban => ({ban, until: dayAfterBan(date, ban)})).sort((x, y) => y.until.localeCompare(x.until) || (x.ban.origin === 'regional') - (y.ban.origin === 'regional'))[0];
    hits.push({occupation: occ, type: t, ban: best.ban, until: best.until, all: b});
  }
  const bannedTypes = new Set(hits.filter(h => h.occupation === occupation).map(h => h.type));
  let status = 'autorise';
  if (occupation && types.every(t => bannedTypes.has(t))) status = 'interdit';
  else if (hits.length) status = 'a-preciser';
  // Fin la plus tardive parmi les périodes qui s'appliquent : prudence.
  const pick = hits.filter(h => !occupation || h.occupation === occupation).sort((a, b) => b.until.localeCompare(a.until))[0] || null;
  // exception : l'interdiction peut être levée à cette date par la note de la période (région, irrigation).
  const md = String(date || '').slice(5, 10), lift = pick?.ban?.lift;
  const exception = Boolean(lift && inPeriod(md, lift[0], lift[1]) && pick.all.every(b => b.origin === 'national'));
  return {status, fert, occupation, hit: pick, hits, exception, date: String(date || '').slice(0, 10)};
}

/** Phrase courte : « Lisier (type II) interdit sur colza du 15/10 au 31/01 ; possible à partir du 01/02. » */
export function zvStatusText(res, {product = 'Fertilisant', parcelName = ''} = {}) {
  const where = parcelName ? ` sur ${parcelName}` : '';
  const occ = res.occupation ? ZV_OCCUPATION_LABELS[res.occupation] : 'occupation du sol à préciser';
  const h = res.hit;
  const dotted = t => t.replace('a', '.a').replace('b', '.b');
  const typeShort = res.fert.type ? `type ${dotted(res.fert.type)}` : 'type à préciser';
  if (res.status === 'interdit') return `${product} (${typeShort}) interdit en zone vulnérable${where} du ${mdLabel(h.ban.from)} au ${mdLabel(h.ban.to)} (${occ}) ; possible à partir du ${mdLabel(h.until.slice(5))}.${h.ban.note ? ` ${h.ban.note}` : ''}`;
  if (res.status === 'a-preciser') {
    if (!res.occupation) return `${product}${where} : culture non reconnue, épandage peut-être interdit à cette date selon l’occupation du sol (à préciser).`;
    return `${product}${where} : ${res.fert.type ? `épandage interdit pour une partie des fertilisants de ${typeShort}` : 'type de fertilisant à préciser'} ; si c’est du ${h.type === 'III' ? 'minéral' : `type ${dotted(h.type)}`}, interdit du ${mdLabel(h.ban.from)} au ${mdLabel(h.ban.to)} (${occ}).`;
  }
  return `${product}${where} : hors des périodes nationales d’interdiction à cette date (${occ}), sous réserve du programme d’actions régional.`;
}
