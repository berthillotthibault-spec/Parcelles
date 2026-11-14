// Résumé de l'exploitation calculé sur l'appareil, toujours joint aux questions envoyées à l'assistant distant
// (n° chantier 8). Avant, le service ne recevait des données que si la question contenait certains mots-clés :
// « que dois-je faire cette semaine ? » partait sans rien. Le résumé reprend ce que l'accueil a déjà calculé
// (« À décider »), le stade estimé des parcelles, l'IFT de la campagne, la conformité et les retards.
// Borné à SUMMARY_MAX_CHARS ; il passe par la même anonymisation et le même aperçu « Ce que j'envoie » que le reste.
// Aucun texte n'est tronqué : un nom coupé (« Grande pièce derrière… ») ne serait plus reconnu par l'anonymisation.
// La taille est bornée en retirant des éléments entiers. Facturation : nature et montant seulement, jamais le client.
import {campaignFor, localIso, toNumber} from './utils.js';
import {farmIft} from './ift.js';
import {complianceChecks, complianceSummary} from './compliance.js';
import {getHomeAgenda} from './home-priorities.js';

export const SUMMARY_MAX_CHARS = 2500;
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const BILLING_TITLES = {'billing-remind': 'Relance de facture à faire', 'billing-unbilled': 'Travaux à facturer'};
const live = (state, type) => (Array.isArray(state?.[type]) ? state[type] : []).filter(x => x && !x.deletedAt);

/**
 * @param {object} state
 * @param {{today?:string, decisions?:object[], phenologyFor?:(parcel:object)=>object|null, catalog?:any, zvAuto?:any, maxChars?:number}} [options]
 */
export function farmSummary(state, {today = localIso(), decisions = [], phenologyFor = null, yieldFor = null, catalog = null, zvAuto = null, maxChars = SUMMARY_MAX_CHARS} = {}) {
  const campaign = campaignFor(today);
  const out = {today, campaign};
  out.decisions = (decisions || []).slice(0, 7).map(d => /^billing/.test(String(d.kind || ''))
    ? {title: BILLING_TITLES[d.kind] || 'Facturation à traiter', level: d.level || '', daysLeft: d.stakes?.daysLeft ?? null, eur: d.stakes?.eur ?? null, why: []}
    : {title: clean(d.title), level: d.level || '', daysLeft: d.stakes?.daysLeft ?? null, why: (Array.isArray(d.why) ? d.why : []).slice(0, 2).map(clean)});
  try {
    const agenda = getHomeAgenda(state, today);
    const n = agenda.next, where = n?.item?.parcelId ? live(state, 'parcelles').find(p => p.id === n.item.parcelId)?.nom : '';
    out.agenda = {overdue: agenda.overdueCount, overdueWorks: agenda.overdueWorks,
      next: n ? {what: clean(n.item.type || n.item.title || 'Travail'), parcel: where ? clean(where) : null, date: n.date || null, overdue: Boolean(n.overdue)} : null};
  } catch { out.agenda = null; }
  try {
    const ift = farmIft(state, campaign, {catalog}).farm;
    out.ift = {total: ift.total, herbicide: ift.herbicide, other: ift.other, treatments: ift.treatments};
  } catch { out.ift = null; }
  try {
    const checks = complianceChecks(state, {today, zvAuto}), sum = complianceSummary(checks);
    out.compliance = {status: sum.status, headline: sum.headline, points: checks.filter(c => c.status === 'ko' || c.status === 'warn').slice(0, 4).map(c => clean(c.label))};
  } catch { out.compliance = null; }
  const parcels = live(state, 'parcelles').filter(p => !p.archived);
  out.parcels = parcels.map(p => {
    const row = {name: clean(p.nom), culture: clean(p.culture), ha: toNumber(p.surfaceHa) || null};
    let ph = null; try { ph = phenologyFor?.(p) || null; } catch { ph = null; }
    if (ph?.status === 'ok') { row.stage = ph.stage?.name || null; if (ph.next && ph.nextDate) row.next = `${ph.next.name} vers le ${ph.nextDate}`; }
    let y = null; try { y = yieldFor?.(p) || null; } catch { y = null; }
    if (y?.tPerHa) row.yield = {tPerHa: y.tPerHa, low: y.low, high: y.high, status: y.status};
    return row;
  }).sort((a, b) => (b.ha || 0) - (a.ha || 0));
  // Taille bornée : les plus petites parcelles d'abord retirées, puis les explications des décisions.
  const size = () => JSON.stringify(out).length;
  let dropped = 0;
  while (size() > maxChars && out.parcels.length) { out.parcels.pop(); dropped += 1; }
  if (dropped) out.parcelsOmitted = dropped;
  for (const d of out.decisions) if (size() > maxChars) d.why = d.why.slice(0, 1);
  while (size() > maxChars && out.decisions.length) out.decisions.pop();
  return out;
}
