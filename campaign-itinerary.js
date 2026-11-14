// Itinéraire prévisionnel de la campagne suivante, tiré des habitudes (n° chantier 10). Logique pure, testée sous Node.
// Pour chaque parcelle dont la culture est prévue pour la campagne (rotation) :
// - premiers travaux habituels de cette culture (learnCalendar : semis, première fauche…) à leur date habituelle ;
// - puis l'enchaînement habituel (learnHabits.next : après A, B au bout de N jours), jusqu'à MAX_STEPS travaux ;
// - produit, dose et matériel habituels (learnHabits.inputs).
// Un travail du même type déjà prévu ou fait sur la parcelle pour cette campagne n'est pas reproposé.
// Rien n'est écrit : l'écran montre le brouillon, l'utilisateur coche et valide. Besoins en intrants et IFT prévisionnel.
import {campaignFor, normalize} from './utils.js';
import {alignToWeekday, habitKey, learnCalendar, learnHabits} from './habits.js';
import {isTreatment} from './phyto.js';
import {treatmentIft} from './ift.js';

export const MAX_STEPS = 8;
const DAY = 864e5;
const live = (state, type) => (Array.isArray(state?.[type]) ? state[type] : []).filter(x => x && !x.deletedAt);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const num = v => { const n = Number(String(v ?? '').replace(',', '.')); return v === '' || v === null || v === undefined || !Number.isFinite(n) ? null : n; };
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const dayLabel = iso => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/** Campagne qui suit « 2026/27 » : « 2027/28 ». */
export function nextCampaign(campaign) {
  const y = Number(String(campaign || '').slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? `${y + 1}/${String(y + 2).slice(-2)}` : '';
}

/**
 * @returns {{campaign:string, works:object[], skipped:{parcelId:string,name:string,reason:string}[], needs:{product:string,unit:string,quantity:number}[], ift:{total:number|null,missing:number}}}
 */
export function draftCampaignItinerary(state, {now = Date.now(), campaign = nextCampaign(campaignFor(now)), habits = null, calendar = null, catalog = null} = {}) {
  const learned = habits || learnHabits(state, {now});
  const seasons = Object.values(calendar || learnCalendar(state, {now, habits: learned}));
  const start = `${campaign.slice(0, 4)}-08-01`, campaignDays = Math.round((Date.parse(`${Number(campaign.slice(0, 4)) + 1}-08-01T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / DAY);
  const parcels = live(state, 'parcelles').filter(p => !p.archived && (p.ownershipType || 'own') === 'own');
  const rotations = live(state, 'rotations');
  const works = [], skipped = [];
  for (const parcel of parcels) {
    const culture = rotations.find(r => r.parcelId === parcel.id && r.campaignId === campaign)?.culture || '';
    if (!culture) { skipped.push({parcelId: parcel.id, name: parcel.nom || 'Parcelle', reason: `culture ${campaign} non prévue (Planifier la campagne)`}); continue; }
    const planned = new Set(live(state, 'interventions').filter(w => w.parcelId === parcel.id && !['Annulé', 'Annulée'].includes(w.status)
      && (w.campaignId || campaignFor(String(w.plannedDate || w.date || '').slice(0, 10) || now)) === campaign).map(w => normalize(w.type)));
    const starts = seasons.filter(s => normalize(s.culture) === normalize(culture));
    if (!starts.length) { skipped.push({parcelId: parcel.id, name: parcel.nom || 'Parcelle', reason: `pas encore d’habitude pour ${culture} (2 campagnes au moins)`}); continue; }
    const seen = new Set();
    for (const season of starts) {
      // Décalage depuis le 1er août, borné au dernier jour de la campagne (31 juillet) : une moisson à cheval sur le
      // 1er août tombe en fin de campagne, jamais au début de la campagne visée (un an trop tôt).
      let date = addDays(start, Math.max(0, Math.min(Math.round(season.median), campaignDays - 1))), type = season.type;
      let reason = `habituellement vers le ${dayLabel(date)} (${season.campaigns.length} campagnes)`;
      for (let step = 0; step < MAX_STEPS && type && !seen.has(normalize(type)); step += 1) {
        seen.add(normalize(type));
        if (!planned.has(normalize(type))) works.push(draftWork(state, learned, parcel, culture, type, date, campaign, reason, catalog));
        const next = learned.next?.[habitKey(culture, type)];
        if (!next) break;
        // Jour de semaine habituel : {value, label} (habitualWeekday), comme nextStepSuggestion de habits.js.
        const nextDate = addDays(date, next.delayDays ?? 0), when = Number.isInteger(next.weekday?.value) ? alignToWeekday(nextDate, next.weekday.value) : nextDate;
        reason = `${next.delayDays} jours après ${type} (${next.count} fois)`;
        date = when < date ? nextDate : when; type = next.type;
      }
    }
  }
  works.sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.parcelName.localeCompare(b.parcelName, 'fr'));
  return {campaign, works, skipped, needs: inputNeeds(works), ift: farmIftOf(state, works, catalog)};
}

function draftWork(state, learned, parcel, culture, type, date, campaign, reason, catalog) {
  const inputs = learned.inputs?.[habitKey(culture, type)] || {};
  const work = {parcelId: parcel.id, parcelName: parcel.nom || 'Parcelle', surfaceHa: num(parcel.surfaceHa), culture, type, plannedDate: date, date,
    status: 'À faire', campaignId: campaign, source: 'itineraire', reason,
    product: inputs.product?.value || '', dose: inputs.dose ? num(inputs.dose.value) : null, doseUnit: inputs.dose?.unit || '', equipmentId: inputs.equipmentId?.value || ''};
  if (isTreatment(work)) { try { work.ift = treatmentIft(state, work, {catalog}).value; } catch { work.ift = null; } }
  return work;
}

/** Quantités d'intrants : dose × surface, regroupées par produit et unité (« L/ha » → « L »). */
export function inputNeeds(works) {
  const map = new Map();
  for (const w of works) {
    if (!w.product || w.dose === null || !(w.surfaceHa > 0)) continue;
    const unit = String(w.doseUnit || '').replace(/\s*\/\s*ha$/i, ''), key = `${normalize(w.product)}|${unit}`;
    const row = map.get(key) || {product: w.product, unit, quantity: 0, parcels: 0};
    row.quantity = Math.round((row.quantity + w.dose * w.surfaceHa) * 100) / 100; row.parcels += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.product.localeCompare(b.product, 'fr'));
}

/** IFT prévisionnel moyen de l'exploitation (pondéré par la surface) ; missing : traitements sans IFT calculable. */
function farmIftOf(state, works, catalog) {
  const parcels = live(state, 'parcelles').filter(p => !p.archived && (p.ownershipType || 'own') === 'own');
  const area = parcels.reduce((s, p) => s + (num(p.surfaceHa) || 0), 0);
  let sum = 0, missing = 0, any = false;
  for (const w of works) {
    if (!isTreatment(w)) continue;
    if (w.ift === null || w.ift === undefined || !(w.surfaceHa > 0)) { missing += 1; continue; }
    sum += w.ift * w.surfaceHa; any = true;
  }
  return {total: any && area > 0 ? Math.round(sum / area * 100) / 100 : null, missing};
}

/** Travaux à écrire pour les lignes cochées (champs de calcul retirés). */
export function itineraryEntities(works) {
  return works.map(({parcelName, surfaceHa, reason, ift, ...w}) => ({...w, note: `Prévu d’après vos habitudes : ${reason}.`}));
}
