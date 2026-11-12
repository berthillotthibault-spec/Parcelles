// Point du matin : quelques phrases, classées par urgence, qui rapprochent les travaux prévus
// aujourd'hui et demain des conditions du moment (créneaux de pulvérisation, sol ressuyé et portance,
// délais avant récolte et de rentrée, risques agronomiques, épandage interdit en zone vulnérable).
// Module pur : l'état, la météo et la date sont fournis par l'appelant ; rien n'est enregistré.
// Chaque phrase est indicative : l'étiquette des produits et la réglementation font foi.
import {normalize} from './utils.js';
import {agendaDate, isPending} from './home-priorities.js';
import {activeReentries, darConflicts, isTreatment} from './phyto.js';
import {weatherWindows} from './weather-decision.js';
import {sowingAdvice} from './sowing.js';
import {assessParcel} from './soil-water.js';
import {evaluateAgroRisks} from './agro-risk.js';
import {isFertilization, parcelInZone, cultureFor} from './nitrogen.js';
import {zvSpreadStatus, mdLabel} from './zv-calendar.js';
import {campaignFor} from './utils.js';

const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, n) => {const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);};
const ddmm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const hourOf = ms => `${new Date(ms).getHours()} h`;
const active = (state, type) => (state?.[type] || []).filter(x => x && !x.deletedAt);
const HARVEST = /\b(recolte|moisson|battage|ensilage|arrachage|fauche)\b/;
const SOWING = /^(semis|semer|semaille|implantation)\b/;
const FIELD = /\b(semis|semer|travail du sol|labour|dechaumage|dechaumer|herse|rouleau|epandage|recolte|moisson|ensilage|fauche|binage|plantation|implantation|vibroculteur|cultivateur|strip till)\b/;
const RANK = {urgent: 0, warning: 1, info: 2};
export const BRIEF_LIMIT = 6;

/** « des Brosses », « du Grand Champ », « de la Côte », « de l’Étang », « d’Arnay », « de Bel Air ». */
export function ofParcel(name = '') {
  const n = String(name || 'la parcelle').trim();
  const m = n.match(/^(les|le|la|l[’'])\s*(.*)$/i);
  if (m) {
    const art = m[1].toLowerCase(), rest = m[2];
    if (art === 'les') return `des ${rest}`;
    if (art === 'le') return `du ${rest}`;
    if (art === 'la') return `de la ${rest}`;
    return `de l’${rest}`;
  }
  return /^[aeiouyàâäéèêëîïôöûü]/i.test(n) ? `d’${n}` : `de ${n}`;
}

function workKind(w) {
  const t = normalize(w?.type).trim();
  if (isTreatment(w) && !isFertilization(w)) return 'treatment';
  if (isFertilization(w)) return 'fertilization';
  if (SOWING.test(t) || w?.kind === 'sow') return 'sowing';
  if (HARVEST.test(t) || w?.kind === 'harvest') return 'harvest';
  return 'other';
}
const workLabel = (w, kind) => kind === 'treatment' ? 'Traitement' : kind === 'sowing' ? 'Semis' : (String(w.type || '').trim() || 'Travail');

/** Plages horaires favorables à la pulvérisation sur une journée (groupes contigus), ou null si pas de prévision. */
export function sprayWindowsFor(weather, day, {now = Date.now()} = {}) {
  if (!weather) return null;
  const res = weatherWindows(weather, 'Pulvérisation', {now});
  if (!res.windows.length) return null;
  const hours = res.windows.flatMap(w => w.hours).filter(h => isoOf(new Date(h.start)) === day && h.start >= now - 3600000);
  if (!hours.length) return null;
  const groups = [];
  for (const h of hours) {
    const g = groups.at(-1);
    if (g && g.level === h.level && g.end === h.start) {g.end = h.end; g.hours.push(h);} else groups.push({level: h.level, start: h.start, end: h.end, hours: [h]});
  }
  const bad = hours.find(h => h.level === 'unfavorable');
  return {favorable: groups.filter(g => g.level === 'favorable'), watch: groups.filter(g => g.level === 'watch'), reason: bad?.why?.find(x => !/^Delta T|^Pluie 0/.test(x)) || bad?.why?.[0] || ''};
}

const agroOf = o => o.agro?.days?.length ? o.agro : (o.agroDays?.length ? {days: o.agroDays, hourly: null} : null);

/**
 * Point du matin.
 * @param {any} state
 * @param {{today?:string, now?:number, agro?:any, agroDays?:any[], weather?:any, soilWater?:any, stations?:any[], catalog?:any, zvAuto?:any, limit?:number}} [options]
 * @returns {{items:Array<{level:string,kind:string,text:string,parcelId:string|null,workId:string|null,day:string|null}>, sentences:string[], text:string}}
 */
export function briefing(state, options = {}) {
  const now = options.now ?? Date.now(), today = options.today || isoOf(new Date(now)), tomorrow = addDays(today, 1);
  const data = state || {}, agro = agroOf(options), items = [];
  const parcels = new Map(active(data, 'parcelles').map(p => [p.id, p]));
  const push = (level, kind, text, {parcelId = null, workId = null, day = null, order = 5} = {}) => items.push({level, kind, text, parcelId, workId, day, order});
  const dayWord = day => day === today ? 'aujourd’hui' : 'demain';
  const works = active(data, 'interventions').filter(w => isPending(w) && w.status !== 'Annulé' && w.status !== 'Annulée');
  const soon = works.filter(w => {const d = agendaDate(w); return d === today || d === tomorrow;})
    .sort((a, b) => agendaDate(a).localeCompare(agendaDate(b)) || String(a.id).localeCompare(String(b.id)));
  const plain = {[today]: [], [tomorrow]: []};
  const windows = {};
  const sprayFor = day => (day in windows ? windows[day] : (windows[day] = (() => {try {return sprayWindowsFor(options.weather, day, {now});} catch {return null;}})()));
  const soilFor = parcel => {try {return options.soilWater?.days?.length ? assessParcel(parcel, options.soilWater, options.stations || []) : null;} catch {return null;}};

  for (const w of soon) {
    const day = agendaDate(w), parcel = parcels.get(w.parcelId) || null, kind = workKind(w), when = dayWord(day);
    const name = parcel ? ofParcel(parcel.nom) : '', label = `${workLabel(w, kind)}${parcel ? ` ${name}` : ''}`;
    const ref = {parcelId: parcel?.id || null, workId: w.id, day};
    if (kind === 'fertilization' && parcel && parcelInZone(data, parcel, options.zvAuto)) {
      const culture = w.culture || cultureFor(data, parcel, w.campaignId || campaignFor(day), today) || parcel.culture || '';
      const res = zvSpreadStatus({date: day, culture, product: w.product || '', workType: w.type || '', state: data});
      if (res.status === 'interdit') {
        const what = `Épandage ${name}${w.product ? ` (${w.product})` : ''} prévu ${when}`, end = mdLabel(res.hit.ban.to);
        const origin = res.hit.ban.origin === 'regional' ? 'période régionale saisie' : 'calendrier national';
        // Exception possible à cette date (fin au 15/01 dans le Sud, irrigation) : « à vérifier » plutôt qu'interdit ferme.
        if (res.exception) {push('warning', 'zv-check', `${what} : probablement interdit en zone vulnérable jusqu’au ${end} (${origin}), sauf exception : ${res.hit.ban.note}`, {...ref, order: 1}); continue;}
        push('urgent', 'zv-ban', `${what} : interdit en zone vulnérable jusqu’au ${end} (${origin}), à reporter.`, {...ref, order: 0}); continue;
      }
      if (res.status === 'a-preciser') {push('warning', 'zv-check', `Épandage ${name}${w.product ? ` (${w.product})` : ''} prévu ${when} : parcelle en zone vulnérable, période d’interdiction possible, précisez le type de fertilisant ou la culture.`, {...ref, order: 1}); continue;}
    }
    if (kind === 'harvest' && parcel) {
      const c = darConflicts(data, parcel.id, day, {catalog: options.catalog || null}).sort((a, b) => b.until.localeCompare(a.until))[0];
      if (c) {push('urgent', 'dar', `${label} prévue ${when} : délai avant récolte de ${c.work.product || 'traitement'} jusqu’au ${ddmm(c.until)}, à repousser.`, {...ref, order: 0}); continue;}
    }
    if (kind === 'treatment') {
      const win = sprayFor(day);
      if (!win) {push('info', 'spray-nodata', `${label} prévu ${when} : prévision horaire non chargée, ouvrez la météo pour voir les créneaux.`, {...ref, order: 3}); continue;}
      if (win.favorable.length) {
        const spans = win.favorable.slice(0, 2).map(g => `de ${hourOf(g.start)} à ${hourOf(g.end)}`).join(' ou ');
        push('info', 'spray-window', `${label} possible ${day === today ? '' : 'demain '}${spans}.`.replace(/\s+/g, ' '), {...ref, order: 2});
      } else if (win.watch.length) {
        push('warning', 'spray-watch', `${label} ${when} : pas de créneau franchement favorable, à surveiller ${win.watch.slice(0, 2).map(g => `de ${hourOf(g.start)} à ${hourOf(g.end)}`).join(' ou ')}.`, {...ref, order: 2});
      } else push('warning', 'spray-none', `${label} ${when} : pas de créneau favorable${win.reason ? ` (${win.reason.charAt(0).toLowerCase()}${win.reason.slice(1)})` : ''}, à décaler.`, {...ref, order: 2});
      continue;
    }
    if (parcel && (kind === 'sowing' || FIELD.test(normalize(w.type)))) {
      const soil = soilFor(parcel), portance = soil?.portance || null;
      let adv = null;
      if (kind === 'sowing') {try {adv = sowingAdvice(data, w, agro, {today});} catch {adv = null;}}
      if (adv?.wet || portance?.level === 'avoid') {
        const reasons = portance?.level === 'avoid' ? ` (${portance.reasons.join(', ')})` : '';
        push('warning', 'soil-wet', `${label} : sol encore humide${reasons}, à repousser.`, {...ref, order: 1}); continue;
      }
      if (portance?.level === 'limit') {push('warning', 'soil-limit', `${label} ${when} : portance limite (${portance.reasons.join(', ')}), vérifiez au champ avant d’engager le matériel.`, {...ref, order: 2}); continue;}
      if (adv && adv.status === 'ok' && !adv.ready) {push('info', 'sowing-temp', `${label} ${when} : ${adv.message.charAt(0).toLowerCase()}${adv.message.slice(1)}`, {...ref, order: 3}); continue;}
      if (adv?.ready) {push('info', 'sowing-ready', `${label} ${when} : conditions de semis réunies (sol à ${String(adv.soilTemp).replace('.', ',')} °C).`, {...ref, order: 3}); continue;}
    }
    plain[day].push(`${w.type || 'Travail'}${parcel ? ` ${name}` : ''}`);
  }
  for (const day of [today, tomorrow]) {
    const list = plain[day];
    if (!list.length) continue;
    const head = day === today ? 'Aujourd’hui' : 'Demain';
    push('info', 'works', `${head} : ${list.slice(0, 3).join(', ')}${list.length > 3 ? ` et ${list.length - 3} autre${list.length - 3 > 1 ? 's' : ''}` : ''}.`, {day, order: day === today ? 4 : 6});
  }
  const late = works.filter(w => {const d = agendaDate(w); return d && d < today;}).length;
  if (late) push('warning', 'late', `${late} travail${late > 1 ? 'x' : ''} en retard à replanifier ou clôturer.`, {order: 4});

  // Délais de rentrée en cours (traitements terminés ou en cours).
  try {
    const rows = [...activeReentries(data, {now, catalog: options.catalog || null})].map(([id, r]) => ({p: parcels.get(id), r})).filter(x => x.p).slice(0, 2);
    for (const {p, r} of rows) push('warning', 'reentry', `${p.nom} : ${r.label.charAt(0).toLowerCase()}${r.label.slice(1)} (délai de rentrée après traitement).`, {parcelId: p.id, workId: r.work?.id || null, order: 3});
  } catch {}
  // Risques agronomiques (conditions favorables, jamais une contamination certaine).
  try {
    const risks = agro ? evaluateAgroRisks(data, agro, {now}) : [];
    const strong = risks.filter(a => a.level === 'risque'), watch = risks.filter(a => a.level !== 'risque');
    for (const a of strong.slice(0, 2)) push('warning', `risk-${a.kind}`, `${a.title} : conditions favorables, observez la parcelle avant de décider.`, {parcelId: a.parcelId || null, order: 5});
    if (!strong.length && watch.length) push('info', 'risk-watch', `${watch[0].title}${watch.length > 1 ? ` (et ${watch.length - 1} autre${watch.length > 2 ? 's' : ''} à surveiller)` : ''}.`, {parcelId: watch[0].parcelId || null, order: 7});
  } catch {}

  if (!items.length) push('info', 'empty', 'Rien de prévu aujourd’hui ni demain dans le planning.', {order: 9});
  const limit = Math.max(1, Number(options.limit) || BRIEF_LIMIT);
  const sorted = items.map((x, i) => ({x, i})).sort((a, b) => RANK[a.x.level] - RANK[b.x.level] || (a.x.day === today ? 0 : a.x.day ? 1 : 0.5) - (b.x.day === today ? 0 : b.x.day ? 1 : 0.5) || a.x.order - b.x.order || a.i - b.i)
    .slice(0, limit).map(({x}) => {const {order, ...rest} = x; return rest;});
  const sentences = sorted.map(x => x.text);
  return {items: sorted, sentences, text: sentences.join(' ')};
}
