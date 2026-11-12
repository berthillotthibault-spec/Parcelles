// Vague 7 voie C — réponses locales de l'assistant aux questions agronomiques.
// Fonctions pures : l'état, les jours de météo agronomique (context.agroDays) et la date du jour
// (context.today) sont fournis par l'appelant. Les réponses restent prudentes et « estimées ».
import {normalize, formatNumber, formatEuro} from './utils.js';
import {marginRanking, rotationAlerts} from './rotation-advice.js';
import {estimatePhenology, sowingFor, profileKey, PHENO_PROFILES} from './phenology.js';
import {campaignFor} from './utils.js';
import {completed} from './farm-memory.js';
import {cultureHistory} from './rotation-advice.js';
import {activeReentries, darConflicts, isTreatment, productFor, limitsFor} from './phyto.js';
import {weatherWindows} from './weather-decision.js';
import {LEGAL_WIND_TEXT} from './spray-window.js';
import {sowingAdvice, sowingKey} from './sowing.js';
import {assessParcel} from './soil-water.js';
import {evaluateAgroRisks} from './agro-risk.js';
import {cultureFor, cultureReference, fertilizerFor, isFertilization, nitrogenPerHa, nitrogenReferences, parcelPlan} from './nitrogen.js';
import {agroIntent, agroText, cropAfterWord, nextCropOptions, sameCrop, targetDay} from './agro-knowledge.js';

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

// ---- Questions agronomiques du terrain (n° agro-assistant 2) ----------------------------------
// Chaque réponse s'appuie sur le module qui porte la règle (phyto, météo, sol, risques, azote,
// rotation) et cite sa source ; rien n'est une autorisation : l'étiquette du produit fait foi.
const PRUDENCE = 'Indicatif : l’étiquette du produit et la réglementation en vigueur font foi.';
const hourLabel = ms => {const d = new Date(ms); return `${d.getHours()} h`;};
const localDayOf = ms => isoToday(new Date(ms));
const addDaysIso = (iso, n) => {const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);};
const fr1 = v => formatNumber(Math.round(Number(v) * 10) / 10);
const openParcel = p => ({type: 'open_parcel', label: `Ouvrir · ${p.nom}`, payload: {parcelId: p.id}});

/** Parcelle citée (nom complet, ou sans l'article « Les », « La », « Le »), sinon parcelle courante pour « cette parcelle » / « ici ». */
export function parcelInQuestion(question, state = {}, context = {}) {
  const q = ` ${agroText(question)} `, parcels = activeParcels(state);
  const names = p => {const n = normalize(p.nom), bare = n.replace(/^(les|le|la|l)\s+/, ''); return [n, bare].filter(x => x.length > 2);};
  const hit = parcels.map(p => ({p, len: Math.max(0, ...names(p).filter(n => q.includes(` ${n} `)).map(n => n.length))})).filter(x => x.len).sort((a, b) => b.len - a.len)[0];
  if (hit) return hit.p;
  if (context.currentParcelId && /\b(cette parcelle|la parcelle|ici|ce champ)\b/.test(q)) return parcels.find(p => p.id === context.currentParcelId) || null;
  return null;
}
const agroCache = context => context.agro?.days?.length ? context.agro : (context.agroDays?.length ? {days: context.agroDays, hourly: null} : null);

// « Puis-je traiter aujourd'hui / demain ? »
export function answerSprayQuestion(question, state = {}, context = {}) {
  const now = context.now ?? Date.now(), today = context.today || isoToday(new Date(now));
  const when = targetDay(question), day = when === 'tomorrow' ? addDaysIso(today, 1) : today, label = when === 'tomorrow' ? 'demain' : 'aujourd’hui';
  const parcel = parcelInQuestion(question, state, context), parts = [];
  const res = context.weather ? weatherWindows(context.weather, 'Pulvérisation', {now}) : null;
  const hours = (res?.windows || []).flatMap(w => w.hours).filter(h => localDayOf(h.start) === day && h.start >= now - 3600000);
  if (hours.length) {
    const groups = [];
    for (const h of hours) {const g = groups.at(-1); if (g && g.level === h.level && g.end === h.start) {g.end = h.end; g.hours.push(h);} else groups.push({level: h.level, start: h.start, end: h.end, hours: [h]});}
    const span = g => `${hourLabel(g.start)}–${hourLabel(g.end)}`;
    const good = groups.filter(g => g.level === 'favorable'), watch = groups.filter(g => g.level === 'watch');
    if (good.length) parts.push(`Créneaux favorables ${label} : ${good.map(span).join(', ')}.`);
    if (watch.length) parts.push(`À surveiller : ${watch.map(span).join(', ')}.`);
    if (!good.length && !watch.length) {
      const bad = hours.find(h => h.level === 'unfavorable') || hours[0];
      parts.push(`Pas de créneau favorable ${label} d’après la prévision horaire${bad?.why?.length ? ` (par exemple à ${hourLabel(bad.start)} : ${bad.why.slice(0, 3).join(' ; ')})` : ''}.`);
    }
  } else {
    const d = (context.agroDays || context.agro?.days || []).find(x => x.date === day);
    parts.push(res?.reason ? `${res.reason} ` : '');
    parts.push(d && Number.isFinite(Number(d.rain)) ? `Pluie prévue ${label} : ${fr1(d.rain)} mm. Vent et humidité horaires non chargés : ouvrez la météo pour voir les créneaux.` : `Prévision horaire non disponible pour ${label} : ouvrez la météo pour voir les créneaux (vent, pluie, delta T).`);
  }
  if (parcel) {
    const re = activeReentries(state, {now, catalog: context.catalog || null}).get(parcel.id);
    if (re) parts.push(`${parcel.nom} : ${re.label.charAt(0).toLowerCase()}${re.label.slice(1)} (délai de rentrée du dernier traitement).`);
  }
  parts.push(`${LEGAL_WIND_TEXT} Respectez aussi les zones non traitées (ZNT) de l’étiquette près des points d’eau et des habitations. Créneaux indicatifs, pas une autorisation.`);
  return reply('spray_window', parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(), parcel ? [openParcel(parcel)] : []);
}

// « Délai avant récolte des Brosses ? », « quand puis-je récolter ? »
export function answerDarQuestion(question, state = {}, context = {}) {
  const today = context.today || isoToday(), parcel = parcelInQuestion(question, state, context), catalog = context.catalog || null;
  const list = parcel ? [parcel] : activeParcels(state);
  const rows = list.map(p => {
    const c = darConflicts(state, p.id, today, {catalog}).sort((a, b) => b.until.localeCompare(a.until))[0];
    return c ? {p, c} : null;
  }).filter(Boolean);
  const campaign = campaignFor(today);
  const noDar = (parcel ? [parcel] : []).flatMap(p => (state.interventions || []).filter(w => !w.deletedAt && w.parcelId === p.id && completed(w) && isTreatment(w) && (w.campaignId || campaignFor(w.date)) === campaign
    && limitsFor(productFor(state, w, {catalog})?.sheet || null, w, p).dar == null));
  const missing = noDar.length ? ` ${noDar.length} traitement${noDar.length > 1 ? 's' : ''} de la campagne sans délai avant récolte connu (${[...new Set(noDar.map(w => w.product || w.type || 'produit'))].slice(0, 3).join(', ')}) : complétez la fiche produit ou vérifiez l’étiquette.` : '';
  if (!rows.length) return reply('dar', `${parcel ? `${parcel.nom} : aucun` : 'Aucun'} délai avant récolte en cours d’après les traitements et fiches produits saisis.${missing} ${PRUDENCE}`, parcel ? [openParcel(parcel)] : []);
  const text = rows.slice(0, 5).map(({p, c}) => `${p.nom} : ${c.work.product || c.work.type || 'traitement'} du ${short(String(c.work.date).slice(0, 10))}, délai avant récolte de ${formatNumber(c.dar)} j : récolte possible à partir du ${short(c.until)}.`).join(' ');
  return reply('dar', `${text}${rows.length > 5 ? ` Et ${rows.length - 5} autre${rows.length - 5 > 1 ? 's' : ''}.` : ''}${missing} ${PRUDENCE}`, rows.slice(0, 3).map(({p}) => openParcel(p)));
}

// « Délai de rentrée », « quand puis-je retourner dans la parcelle ? »
export function answerReentryQuestion(question, state = {}, context = {}) {
  const now = context.now ?? Date.now(), parcel = parcelInQuestion(question, state, context);
  const map = activeReentries(state, {now, catalog: context.catalog || null});
  const rows = [...map].filter(([id]) => !parcel || id === parcel.id).map(([id, r]) => ({p: activeParcels(state).find(x => x.id === id), r})).filter(x => x.p);
  if (!rows.length) return reply('reentry', `${parcel ? `${parcel.nom} : aucun` : 'Aucun'} délai de rentrée en cours d’après les traitements saisis (fiche produit, sinon 6 h minimum après la fin du traitement). ${PRUDENCE}`, parcel ? [openParcel(parcel)] : []);
  return reply('reentry', `${rows.map(({p, r}) => `${p.nom} : ${r.label.charAt(0).toLowerCase()}${r.label.slice(1)} (${r.work.product || r.work.type || 'traitement'}).`).join(' ')} Portez les équipements prévus par l’étiquette si vous devez entrer avant. ${PRUDENCE}`, rows.slice(0, 3).map(({p}) => openParcel(p)));
}

// « Peut-on semer ? », « le sol est-il ressuyé ? », « portance »
export function answerSowingQuestion(question, state = {}, context = {}) {
  const today = context.today || isoToday(), parcel = parcelInQuestion(question, state, context), q = agroText(question), parts = [];
  const agro = agroCache(context);
  const pending = parcel && (state.interventions || []).find(w => !w.deletedAt && w.parcelId === parcel.id && !completed(w) && w.status !== 'Annulé' && /\bsem/.test(normalize(w.type)));
  const cropText = sowingKey(q) ? q : (pending?.culture || parcel?.culture || '');
  if (/\b(semer|semis|implanter)\b/.test(q)) {
    if (sowingKey(cropText)) {
      const adv = sowingAdvice(state, {id: 'question', parcelId: parcel?.id || null, culture: cropText, type: 'Semis'}, agro, {today});
      if (adv) parts.push(adv.message);
    } else parts.push('Précisez la culture (maïs, colza, céréales…) pour comparer la température du sol au repère de semis.');
  }
  const soil = context.soilWater?.days?.length ? assessParcel(parcel || {id: '_farm'}, context.soilWater, context.stations || []) : null;
  if (soil?.portance) parts.push(`Portance ${soil.portance.label.toLowerCase()}${parcel ? ` sur ${parcel.nom}` : ''} : ${soil.portance.reasons.join(', ')}.`);
  else {
    const past = (agro?.days || []).filter(d => d.date <= today && d.date > addDaysIso(today, -3) && Number.isFinite(Number(d.rain)));
    if (past.length) parts.push(`${fr1(past.reduce((s, d) => s + Number(d.rain), 0))} mm de pluie sur les 3 derniers jours (estimation Open-Meteo).`);
    else parts.push('Bilan hydrique du sol non chargé : ouvrez l’écran Eau du sol pour la portance.');
  }
  parts.push('Repère indicatif : vérifiez au champ (test à la bêche, traces de roues) avant d’engager le matériel.');
  return reply('sowing_conditions', parts.join(' '), parcel ? [openParcel(parcel)] : []);
}

// « Risque de maladie ? », « septoriose », « gel », « stress thermique »
export function answerRiskQuestion(question, state = {}, context = {}) {
  const now = context.now ?? Date.now(), today = context.today || isoToday(new Date(now)), q = agroText(question), agro = agroCache(context), parts = [];
  if (/\bmildiou\b/.test(q)) parts.push('Le mildiou (vigne, pomme de terre) n’est pas modélisé dans l’application : référez-vous au Bulletin de santé du végétal (BSV) de votre région ou à un outil d’aide à la décision dédié.');
  if (!agro) return reply('agro_risk', `${parts.join(' ')} Météo agronomique non chargée : ouvrez l’accueil en ligne pour calculer les risques.`.trim());
  const kinds = [/septoriose/.test(q) && 'septoria', /sclerotinia/.test(q) && 'sclerotinia', /(helminthosporiose|rouille)/.test(q) && 'maizeLeaf', /(chaleur|stress thermique|\bthi\b|canicule)/.test(q) && 'thi'].filter(Boolean);
  const frost = /\b(gelee|gel|froid)\b/.test(q);
  const wantAll = !kinds.length && !frost && !/\bmildiou\b/.test(q);
  const alerts = evaluateAgroRisks(state, agro, {now}).filter(a => wantAll ? a.kind !== 'thi' || /chaleur|sanitaire/.test(q) : kinds.includes(a.kind));
  if (alerts.length) parts.push(`${alerts.slice(0, 4).map(a => `${a.title} : ${a.message}`).join(' ')} Règle : ${alerts[0].rule} Source : ${alerts[0].source}.`);
  else if (kinds.length || wantAll) parts.push('Aucune condition favorable détectée par les règles suivies (septoriose du blé, maladies foliaires du maïs, sclérotinia du colza, stress thermique au pré), qui ne s’appliquent qu’aux cultures et aux mois concernés.');
  if (frost) {
    const cold = agro.days.filter(d => d.date >= today && d.date <= addDaysIso(today, 7) && Number.isFinite(d.tmin) && d.tmin <= 0);
    if (cold.length) {const min = cold.reduce((a, b) => (b.tmin < a.tmin ? b : a)); parts.push(`Gelée possible : ${cold.length} jour${cold.length > 1 ? 's' : ''} sous 0 °C prévu${cold.length > 1 ? 's' : ''} sur 7 jours, minimale ${fr1(min.tmin)} °C le ${short(min.date)} (température sous abri ; au sol, il peut faire plus froid). La sensibilité dépend du stade de la culture.`);}
    else parts.push('Pas de minimale sous 0 °C prévue sur les 7 prochains jours (température sous abri, Open-Meteo).');
  }
  parts.push('Conditions favorables seulement, jamais une contamination certaine : observez la parcelle avant de décider.');
  const ids = [...new Set(alerts.map(a => a.parcelId).filter(Boolean))].slice(0, 3);
  return reply('agro_risk', parts.join(' '), ids.map(id => activeParcels(state).find(p => p.id === id)).filter(Boolean).map(openParcel));
}

/** Azote apporté (kg N/ha) sur une parcelle et une campagne : réalisé, prévu et apports sans teneur connue. */
export function nitrogenBalance(state = {}, parcel, campaign) {
  const out = {realized: 0, realizedTotal: 0, planned: 0, unknown: [], count: 0};
  for (const w of state.interventions || []) {
    if (w.deletedAt || w.parcelId !== parcel.id || w.status === 'Annulé' || !isFertilization(w) || (w.campaignId || campaignFor(w.date || w.plannedDate)) !== campaign) continue;
    out.count++;
    const n = nitrogenPerHa(w, fertilizerFor(state, w.product));
    if (!n) {out.unknown.push(w.product || w.type || 'apport'); continue;}
    if (completed(w)) {out.realized += n.nEff; out.realizedTotal += n.nTotal;} else out.planned += n.nEff;
  }
  return out;
}

// « Combien d'azote ai-je apporté sur les Brosses ? »
export function answerNitrogenQuestion(question, state = {}, context = {}) {
  const today = context.today || isoToday(), campaign = context.campaign || campaignFor(today), parcel = parcelInQuestion(question, state, context);
  const refs = nitrogenReferences(state);
  const list = parcel ? [parcel] : activeParcels(state);
  const rows = list.map(p => ({p, b: nitrogenBalance(state, p, campaign)})).filter(r => parcel || r.b.count);
  if (!rows.length) return reply('nitrogen_applied', `Aucun apport d’engrais saisi pour la campagne ${campaign}.`);
  const lines = rows.slice(0, 5).map(({p, b}) => {
    const culture = cultureFor(state, p, campaign, today) || p.culture || '', ref = cultureReference(culture, refs);
    let line = `${p.nom}${culture ? ` (${culture})` : ''} : ${formatNumber(Math.round(b.realized))} kg N efficace/ha apportés${b.realizedTotal && Math.round(b.realizedTotal) !== Math.round(b.realized) ? ` (${formatNumber(Math.round(b.realizedTotal))} kg N total)` : ''}${b.planned ? `, ${formatNumber(Math.round(b.planned))} prévus` : ''}`;
    if (!b.count) line = `${p.nom} : aucun apport d’engrais saisi en ${campaign}`;
    if (b.unknown.length) line += ` ; teneur en azote inconnue pour ${[...new Set(b.unknown)].slice(0, 3).join(', ')} (renseignez la composition du produit dans le stock pour le compter)`;
    if (ref?.legume) line += ` ; légumineuse : en général pas d’apport d’azote minéral nécessaire, à confirmer avec votre conseiller`;
    else {
      const plan = parcelPlan(state, p, campaign, {today, refs});
      if (plan.dose != null) line += ` ; dose prévisionnelle indicative ${formatNumber(plan.dose)} kg N/ha${plan.complete ? '' : ` (calcul incomplet : ${plan.missing.join(', ') || 'objectif par défaut'})`}`;
    }
    return `${line}.`;
  });
  return reply('nitrogen_applied', `Campagne ${campaign} — ${lines.join(' ')}${rows.length > 5 ? ` Et ${rows.length - 5} autre${rows.length - 5 > 1 ? 's' : ''} parcelle${rows.length - 5 > 1 ? 's' : ''}.` : ''} Calcul à partir des doses et compositions saisies ; le plan prévisionnel réglementaire reste celui de votre arrêté régional.`,
    rows.slice(0, 3).map(({p}) => openParcel(p)));
}

// « Quelle culture après un colza ? », « que semer derrière le blé des Brosses ? »
export function answerNextCropQuestion(question, state = {}, context = {}) {
  const today = context.today || isoToday(), current = context.campaign || campaignFor(today), parcel = parcelInQuestion(question, state, context);
  let history = parcel ? cultureHistory(state, parcel.id, {current}) : [];
  const asked = cropAfterWord(question);
  // La culture citée complète l'historique de la parcelle sans l'effacer (délais de retour conservés).
  if (asked && !history.length) history = [{campaignId: current, culture: asked}];
  else if (asked && !sameCrop(history.at(-1).culture, asked)) history = [...history.filter(h => h.campaignId !== current), {campaignId: current, culture: asked}];
  const r = nextCropOptions(history, {prefs: state.preferences || {}});
  if (!r) return reply('next_crop', parcel ? `${parcel.nom} : aucune culture enregistrée. Saisissez l’assolement ou précisez la culture précédente (« quelle culture après un blé ? »).` : 'Précisez la culture précédente (« quelle culture après un colza ? ») ou le nom de la parcelle.');
  const fmt = rows => rows.map(x => `${x.crop}${x.reasons.length ? ` (${x.reasons.join(' ; ')})` : ''}`).join(', ');
  const parts = [`Après ${r.previous.culture.toLowerCase()}${parcel ? ` sur ${parcel.nom}` : ''} :`];
  if (r.good.length) parts.push(`pistes intéressantes : ${fmt(r.good)}.`);
  if (r.avoid.length) parts.push(`à éviter ou à raisonner : ${fmt(r.avoid)}.`);
  if (r.neutral.length) parts.push(`possibles sans alerte : ${r.neutral.map(x => x.crop).join(', ')}.`);
  parts.push(`Pistes indicatives (${r.source}) : le débouché, le sol, la pression adventices et l’avis de votre conseiller priment.`);
  return reply('next_crop', parts.join(' '), parcel ? [openParcel(parcel)] : []);
}

const AGRO_ANSWERS = {reentry: answerReentryQuestion, dar: answerDarQuestion, nextCrop: answerNextCropQuestion, sowing: answerSowingQuestion, risk: answerRiskQuestion, nitrogen: answerNitrogenQuestion, spray: answerSprayQuestion};

export function answerAgroQuestion(question, state = {}, context = {}) {
  const first = answerPhenologyQuestion(question, state, context) || answerMarginQuestion(question, state, context) || answerRotationQuestion(question, state, context);
  if (first) return first;
  const intent = agroIntent(question);
  if (!intent) return null;
  try {return AGRO_ANSWERS[intent](question, state || {}, context || {});} catch (error) {
    // Une donnée inattendue ne doit pas casser l’assistant : on laisse la main aux autres réponses.
    console.warn('[Parcelles] assistant agronomique', error);
    return null;
  }
}
