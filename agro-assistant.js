// Vague 7 voie C — réponses locales de l'assistant aux questions agronomiques.
// Fonctions pures : l'état, les jours de météo agronomique (context.agroDays) et la date du jour
// (context.today) sont fournis par l'appelant. Les réponses restent prudentes et « estimées ».
import {normalize, formatNumber, formatEuro} from './utils.js';
import {marginRanking, rotationAlerts} from './rotation-advice.js';
import {estimatePhenology, sowingFor, profileKey, PHENO_PROFILES} from './phenology.js';

const pad = n => String(n).padStart(2, '0');
const isoToday = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const short = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const activeParcels = state => (state.parcelles || []).filter(p => !p.deletedAt && !p.archived);
const reply = (intent, answer, actions = []) => ({recognized: true, intent, answer, actions});

// « Où en est le maïs ? », « stade du blé », « degrés-jours des Noues ».
export function answerPhenologyQuestion(question, state = {}, context = {}) {
  const q = normalize(question);
  if (!/\b(ou en est|ou en sont|stade|stades|degres jours|degre jour|somme de temperatures?|sommes de temperatures?)\b/.test(q)) return null;
  const parcels = activeParcels(state);
  const named = parcels.find(p => normalize(p.nom) && q.includes(normalize(p.nom)));
  const key = profileKey(q);
  if (!named && !key) return null;
  const list = named ? [named] : parcels.filter(p => profileKey(p.culture) === key);
  const crop = named ? named.nom : PHENO_PROFILES[key].label.toLowerCase();
  if (!list.length) return reply('phenology', `Aucune parcelle en ${crop} n’est enregistrée.`);
  const today = context.today || isoToday(), days = context.agroDays || [];
  const rows = list.map(p => {
    const sowing = sowingFor(state, p.id, {today});
    const obs = p.phenologyObservation?.sowingDate === sowing?.date ? p.phenologyObservation : null;
    return {p, r: estimatePhenology({culture: sowing?.culture || p.culture, sowingDate: sowing?.date, days, today, observation: obs, overrides: state.preferences?.phenologyProfiles || {}})};
  });
  const lines = rows.map(({p, r}) => {
    if (r.status === 'no-sowing') return `${p.nom} : pas de semis enregistré.`;
    if (r.status === 'no-weather') return `${p.nom} : semis du ${short(r.sowingDate)}, températures pas encore chargées.`;
    if (r.status !== 'ok') return `${p.nom} : culture non suivie.`;
    return `${p.nom} : ${formatNumber(r.sum)} °C·j base ${r.base} depuis le semis du ${short(r.sowingDate)}, stade estimé ${r.stage?.name || 'avant levée'}${r.next ? `, ${r.next.name} dans environ ${formatNumber(r.remaining)} °C·j${r.nextDate ? ` (vers le ${short(r.nextDate)})` : ''}` : ''}.`;
  });
  return reply('phenology', `${lines.join(' ')} Estimation indicative à partir des températures Open-Meteo ; vérifiez au champ et saisissez le stade observé pour recaler.`,
    rows.slice(0, 3).map(({p}) => ({type: 'open_parcel', label: `Ouvrir · ${p.nom}`, payload: {parcelId: p.id}})));
}

// « Quelle parcelle me rapporte le moins ? » (ou le plus) : marge brute/ha de la campagne.
export function answerMarginQuestion(question, state = {}, context = {}) {
  const q = normalize(question);
  const low = /(rapporte|rapportent) (le )?moins|moins rentable|plus faible marge|marge la plus (faible|basse)|pire marge/.test(q);
  const high = /(rapporte|rapportent) (le )?plus|plus rentable|meilleure marge|marge la plus (forte|haute|elevee)/.test(q);
  if (!low && !high) return null;
  const m = marginRanking(state, context.campaign ? {campaign: context.campaign} : {});
  const missing = m.unranked.length ? ` ${m.unranked.length} parcelle${m.unranked.length > 1 ? 's' : ''} non classée${m.unranked.length > 1 ? 's' : ''} faute de données (${m.unranked.slice(0, 3).map(r => `${r.parcelName} : ${r.missing.join(', ')}`).join(' ; ')}).` : '';
  if (!m.ranked.length) return reply('margin_rank', `Je ne peux pas classer les parcelles pour ${m.campaign} : aucun rendement ni prix renseigné.${missing}`);
  const r = low ? m.ranked[0] : m.ranked.at(-1);
  const gap = r.gap === null ? '' : `, ${formatEuro(Math.abs(r.gap))}/ha ${r.gap < 0 ? 'sous' : 'au-dessus de'} la moyenne de ${formatEuro(m.average)}/ha`;
  const caveat = r.missing.length ? ` Données manquantes sur cette parcelle : ${r.missing.join(', ')}.` : '';
  return reply('margin_rank', `${low ? 'La plus faible' : 'La meilleure'} marge brute en ${m.campaign} : ${r.parcelName} (${r.culture || 'culture non renseignée'}), ${formatEuro(r.marginHa)}/ha${gap}.${caveat}${missing} Marge ${m.reliability.label}.`,
    [{type: 'open_parcel', label: `Ouvrir · ${r.parcelName}`, payload: {parcelId: r.parcelId}}]);
}

export function answerRotationQuestion(question, state = {}) {
  const q = normalize(question);
  if (!/\b(rotation|rotations|delai de retour|assolement)\b/.test(q) || !/(alerte|probleme|respect|verifi|delai|conseil)/.test(q)) return null;
  const list = rotationAlerts(state);
  return reply('rotation_alerts', list.length ? `${list.length} rotation${list.length > 1 ? 's' : ''} à revoir : ${list.slice(0, 4).map(a => a.message).join(' ')}` : 'Aucune culture prévue ne revient avant son délai de retour conseillé.');
}

export function answerAgroQuestion(question, state = {}, context = {}) {
  return answerPhenologyQuestion(question, state, context) || answerMarginQuestion(question, state, context) || answerRotationQuestion(question, state, context);
}
