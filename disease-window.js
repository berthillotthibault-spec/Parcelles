// Idée 9 — Risques maladies calés sur le stade et la rémanence, fonctions pures.
// 1. Stade : une maladie n'est signalée que pendant les stades sensibles de la culture (septoriose du blé
//    à partir de 1-2 nœuds, fusariose de l'épiaison à la fin de la floraison, sclérotinia pendant la
//    floraison du colza, maladies foliaires du maïs à partir de 8-10 feuilles). Le stade vient d'une
//    observation saisie sur la parcelle ou de l'estimation par sommes de températures (phenology.js).
//    Sans semis ni météo suffisante, le stade reste inconnu et la règle des mois s'applique comme avant.
// 2. Rémanence : un fongicide réalisé sur la parcelle protège pendant une durée indicative (14 jours par
//    défaut, réglable). Les conditions favorables pendant cette période donnent « couvert jusqu'au … »
//    au lieu d'une alerte ; l'alerte revient quand la protection se termine pendant la période à risque.
import {normalize} from './utils.js';
import {cropProfile, estimatePhenology, sowingFor, PHENO_PROFILES} from './phenology.js';
import {isTreatment, productFor} from './phyto.js';

export const COVER_DEFAULT_DAYS = 14;
// Fenêtre sensible : du stade « from » (inclus) au stade « to » (exclu), « extra » degrés-jours après « to » si précisé.
export const DISEASE_WINDOWS = {
  septoria: {profile: 'cereales', from: '1-2 nœuds', to: 'Maturité physiologique', why: 'la septoriose touche les dernières feuilles à partir de 2 nœuds'},
  fusarium: {profile: 'cereales', from: 'Épiaison', to: 'Floraison', extra: 200,
    why: 'la fusariose contamine les épis de l’épiaison à la fin de la floraison'},
  maizeLeaf: {profile: 'mais', from: '8-10 feuilles', to: 'Maturité (32 % d’humidité)',
    why: 'les maladies foliaires du maïs comptent à partir de 8-10 feuilles'},
  sclerotinia: {profile: 'colza', from: 'Floraison', to: 'Floraison', extra: 450, why: 'le sclérotinia contamine par les pétales pendant la floraison'}
};
const CLOSED = ['Terminé', 'Terminée'];
const day10 = v => {const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';};
const addDays = (iso, n) => {const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);};
export const shortDate = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// Seuil en degrés-jours d'un stade : profil réglé par l'utilisateur, sinon profil par défaut.
function stageGdd(profile, name) {
  const s = profile?.stages?.find(x => x.name === name) || PHENO_PROFILES[profile?.key]?.stages?.find(x => x.name === name);
  return s ? s.gdd : null;
}

// Stade de la parcelle : {name, sum, source: 'observé'|'estimé'} ou null si inconnu.
export function parcelStage(state = {}, parcel, days = [], {today, overrides = state.preferences?.phenologyProfiles || {}} = {}) {
  if (!parcel || !today) return null;
  const sowing = sowingFor(state, parcel.id, {today});
  if (!sowing) return null;
  const obs = parcel.phenologyObservation && parcel.phenologyObservation.sowingDate === sowing.date ? parcel.phenologyObservation : null;
  const est = estimatePhenology({culture: sowing.culture || parcel.culture || '', sowingDate: sowing.date, days, today, observation: obs, overrides});
  if (est.status !== 'ok') return null;
  // Trop de jours sans météo depuis le semis (ou depuis le stade observé) : estimation sous-évaluée, on ne filtre pas.
  // Une observation ancienne ne suffit pas : sans la météo qui suit, le stade serait jugé trop tôt et l'alerte supprimée.
  if (est.missing > 10) return null;
  const source = est.recalibrated ? 'observé' : 'estimé';
  return {name: est.stage?.name || 'Avant levée', sum: est.sum, profile: est.profile, source, sowingDate: sowing.date};
}

// Le stade est-il dans la fenêtre sensible ? {inWindow, known, label, why}.
export function stageWindow(kind, stage) {
  const w = DISEASE_WINDOWS[kind];
  if (!w) return {inWindow: true, known: false, label: '', why: ''};
  if (!stage?.profile || stage.profile.key !== w.profile) {
    return {inWindow: true, known: false, label: 'stade inconnu (semis non saisi ou météo insuffisante)', why: ''};
  }
  const from = stageGdd(stage.profile, w.from), to = stageGdd(stage.profile, w.to);
  if (from === null || to === null) return {inWindow: true, known: false, label: 'stade non reconnu', why: ''};
  const end = to + (w.extra || 0), inWindow = stage.sum >= from && stage.sum < end;
  const label = `stade ${stage.source} : ${stage.name} (${Math.round(stage.sum)} degrés-jours)`;
  const range = w.extra ? `de ${w.from} à la fin de ${w.to.toLowerCase()}` : `de ${w.from} à ${w.to.toLowerCase()}`;
  return {inWindow, known: true, label, why: `${w.why} (${range})`, before: stage.sum < from};
}

// Le travail est-il un fongicide ? Fiche produit (catégorie), limites figées, puis libellés.
export function isFungicide(state, work, {catalog = null} = {}) {
  if (!isTreatment(work)) return false;
  const cat = normalize(work.phytoLimits?.category || '') || normalize(productFor(state, work, {catalog})?.sheet?.category || '');
  if (cat) return cat === 'fongicide';
  return /fongicide|fungicide|septori|fusari|sclerotinia|helmintho|rouille|oidium/.test(normalize(`${work.type} ${work.target || ''} ${work.kind || ''}`));
}

// Dernier fongicide réalisé sur la parcelle (au plus tard aujourd'hui) et fin indicative de protection.
export function fungicideCover(state = {}, parcelId, {today, days = COVER_DEFAULT_DAYS, catalog = null} = {}) {
  const span = Number.isFinite(Number(days)) && Number(days) > 0 ? Number(days) : COVER_DEFAULT_DAYS;
  const work = (state.interventions || [])
    .filter(w => !w.deletedAt && w.parcelId === parcelId && CLOSED.includes(w.status || 'Terminé') && day10(w.date) && day10(w.date) <= today)
    .filter(w => isFungicide(state, w, {catalog}))
    .sort((a, b) => day10(b.date).localeCompare(day10(a.date)))[0];
  if (!work) return null;
  const date = day10(work.date);
  return {workId: work.id, date, until: addDays(date, span), days: span, product: work.product || work.type || 'fongicide'};
}

// Verdict pour une parcelle : skip (hors stade), covered (tous les épisodes tombent pendant la protection) ou alert.
// events : dates (AAAA-MM-JJ) des épisodes favorables. La rémanence est préventive : elle couvre les épisodes après le
// jour du traitement et jusqu'à la fin de protection, pas ceux d'avant (contaminations déjà en place).
export function diseaseVerdict(kind, {stage = null, cover = null, events = [], lastEvent = null} = {}) {
  const win = stageWindow(kind, stage);
  if (!win.inWindow) return {status: 'skip', win, cover: null, why: `Hors stade sensible : ${win.label} ; ${win.why}.`};
  const notes = [win.known ? `Stade sensible : ${win.label} ; ${win.why}.` : `Stade : ${win.label}, règle des mois appliquée.`];
  const list = events.length ? events : lastEvent ? [lastEvent] : [];
  const inCover = d => cover && d > cover.date && d <= cover.until;
  if (cover && list.length && list.every(inCover)) {
    const why = `${notes[0]} Fongicide du ${shortDate(cover.date)} : protection indicative de ${cover.days} jours, jusqu’au ${shortDate(cover.until)}.`;
    return {status: 'covered', win, cover, events: [], why};
  }
  const left = list.filter(d => !inCover(d));
  if (cover && left.some(d => d > cover.until)) {
    notes.push(`Protection du fongicide du ${shortDate(cover.date)} terminée le ${shortDate(cover.until)} (${cover.days} jours indicatifs).`);
  }
  if (cover && left.some(d => d <= cover.date)) notes.push(`Épisode antérieur au fongicide du ${shortDate(cover.date)}, non couvert par sa rémanence.`);
  return {status: 'alert', win, cover, events: events.length ? left : events, why: notes.join(' ')};
}
