// Accueil qui raconte la journée : salutation selon l’heure et briefing « Ce matin ».
// Fonctions pures, sans accès au DOM ni écriture : de simples gabarits de phrases
// assemblés à partir des données déjà présentes (agenda, météo en cache, pâturage, stocks, matériel).
import {dailySituation, isLowStock, localDay, maintenanceRemaining} from './home-priorities.js';
import {filterGrazingSessions, grazingTotal, grazingType} from './grazing.js';
import {WEATHER_RULES, forecastTime, weatherWindows} from './weather-decision.js';

const HOUR = 3600000;
const FRESH_HOURS = 6;   // au-delà, les créneaux ne sont plus calculés (même règle que weatherWindows)
const OLD_HOURS = 48;    // au-delà, la météo en cache n’est plus racontée
const MAX_SENTENCES = 5;
const nf = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 1});
const num = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const clean = value => String(value ?? '').trim();
// Typographie française : espace fine insécable avant ; : ? ! et dans les guillemets, insécable entre nombre et unité.
export const typo = text => String(text)
  .replace(/ ([;:?!»])/g, '\u202f$1').replace(/« /g, '«\u202f')
  .replace(/(\d) (km\/h|°C|h\b|min\b|kg\b|ha\b|mm\b|t\b|L\b)/g, '$1\u00a0$2');

// « Bonjour » jusqu’à 18 h, « Bonsoir » ensuite, « Bonne nuit » de 22 h à 5 h.
export function greetingFor(date = new Date()) {
  const h = date.getHours();
  if (h >= 22 || h < 5) return 'Bonne nuit';
  return h >= 18 ? 'Bonsoir' : 'Bonjour';
}
export function greetingTitle(name, date = new Date()) {
  const who = clean(name);
  return who ? `${greetingFor(date)} ${who}` : greetingFor(date);
}
export function briefTitle(date = new Date()) {
  const h = date.getHours();
  return h >= 5 && h < 12 ? 'Ce matin' : h >= 12 && h < 18 ? 'Cet après-midi' : 'Ce soir';
}

// « 14 h », « 14 h 30 » : notation horaire française.
export function frenchClock(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const m = d.getMinutes();
  return `${d.getHours()} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
}

export function weatherAge(weather, now = Date.now()) {
  const loaded = num(weather?.loadedAt);
  if (loaded === null) return {state: 'missing', hours: null, label: ''};
  const minutes = Math.max(0, Math.round((now - loaded) / 60000)), hours = minutes / 60;
  const label = minutes < 1 ? 'à l’instant' : minutes < 60 ? `il y a ${minutes} min`
    : hours < 24 ? `il y a ${Math.round(hours)} h` : `il y a ${plural(Math.round(hours / 24), 'jour', 'jours')}`;
  return {state: hours <= FRESH_HOURS ? 'fresh' : hours <= OLD_HOURS ? 'stale' : 'old', hours, label};
}

// Type de travail saisi librement → famille de seuils météo indicatifs (WEATHER_RULES).
const RULE_WORDS = [
  ['Pulvérisation', /pulv|desherb|traitement|fongicide|insecticide|herbicide|phyto/],
  ['Fauche', /fauch|foin|fanage|andain/],
  ['Semis', /semis|semer|plantation|implant/],
  ['Fertilisation', /fertili|engrais|azote|uree|ammonitrate|amendement|chaul/],
  ['Récolte', /recolt|moisson|ensil|battage|pressage/],
  ['Épandage', /epand|fumier|lisier|digestat|compost/]
];
const fold = value => clean(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function weatherRuleFor(type) {
  const text = fold(type);
  if (!text) return '';
  const exact = Object.keys(WEATHER_RULES).find(key => fold(key) === text);
  if (exact) return exact;
  return RULE_WORDS.find(([, re]) => re.test(text))?.[0] || '';
}

// Pluie, vent et température pour le reste de la journée, à partir de la prévision horaire.
export function weatherFacts(weather, now = Date.now()) {
  const h = weather?.hourly || {}, times = Array.isArray(h.time) ? h.time : [];
  const today = localDay(new Date(now));
  let rainAt = null, rainy = false, hours = 0;
  for (let i = 0; i < times.length; i++) {
    const start = forecastTime(times[i], weather);
    if (!Number.isFinite(start) || start + HOUR <= now || localDay(new Date(start)) !== today) continue;
    const rain = num(h.precipitation?.[i]);
    if (rain === null) continue;
    hours++;
    if (rain >= 0.2 && rainAt === null) {rainAt = start; rainy = start <= now;}
  }
  return {
    rainAt, rainingNow: rainy, hours,
    wind: num(weather?.current?.wind_speed_10m),
    temperature: num(weather?.current?.temperature_2m)
  };
}
function weatherLead(facts, now) {
  const parts = [];
  if (facts.hours) parts.push(facts.rainAt === null ? 'Pas de pluie prévue d’ici ce soir'
    : facts.rainingNow || facts.rainAt - now < HOUR ? 'Pluie en cours ou imminente' : `Sec jusqu’à ${frenchClock(facts.rainAt)}`);
  if (facts.wind !== null) parts.push(`vent ${nf.format(Math.round(facts.wind))} km/h`);
  if (facts.temperature !== null) parts.push(`${nf.format(Math.round(facts.temperature))} °C`);
  const text = parts.join(', ');
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

// Premier créneau favorable restant aujourd’hui pour une famille de travaux.
export function todayWindow(weather, ruleType, now = Date.now()) {
  const result = weatherWindows(weather, ruleType, {now});
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  const window = (result.windows || []).find(w => w.level === 'favorable' && w.end > now && w.start <= endOfDay.getTime());
  return window ? {start: Math.max(window.start, now), end: window.end, current: window.start <= now, endsToday: window.end <= endOfDay.getTime()} : null;
}

function workLabel(work, parcels) {
  const type = clean(work.type) || 'Travail', parcel = parcels.get(work.parcelId)?.nom;
  return `« ${type} »${parcel ? ` sur ${parcel}` : ''}`;
}

function weatherSentence(data, weather, cockpit, now, location) {
  const age = weatherAge(weather, now);
  if (age.state === 'missing' || age.state === 'old') {
    if (!location) return {key: 'weather', tone: 'muted', text: 'Météo indisponible : la position de l’exploitation n’est pas renseignée.', story: 'locate'};
    return {key: 'weather', tone: 'muted', text: age.state === 'old' ? `Dernière météo connue ${age.label} : trop ancienne pour décider.` : 'Prévisions météo pas encore chargées.', action: 'refresh-weather'};
  }
  const facts = weatherFacts(weather, now), lead = weatherLead(facts, now);
  if (age.state === 'stale') return {key: 'weather', tone: 'muted', text: `Dernière météo connue ${age.label}${lead ? ` (${lead[0].toLowerCase()}${lead.slice(1)})` : ''} : à actualiser avant de décider.`, action: 'refresh-weather'};
  const parcels = new Map((data.parcelles || []).filter(p => !p.deletedAt).map(p => [p.id, p]));
  const candidates = cockpit.actions.filter(e => e.kind === 'work').map(e => ({work: e.item, rule: weatherRuleFor(e.item.type)})).filter(c => c.rule);
  for (const {work, rule} of candidates) {
    const window = todayWindow(weather, rule, now);
    if (window) {
      const span = window.current ? (window.endsToday ? `jusqu’à ${frenchClock(window.end)}` : 'jusqu’à ce soir')
        : window.endsToday ? `de ${frenchClock(window.start)} à ${frenchClock(window.end)}` : `à partir de ${frenchClock(window.start)}`;
      return {key: 'weather', tone: 'good', text: `${lead ? `${lead} : c` : 'C'}réneau favorable ${span} pour ${workLabel(work, parcels)}.`, action: 'edit-work', id: work.id, indicative: true};
    }
  }
  if (candidates.length) {
    const {work} = candidates[0];
    return {key: 'weather', tone: 'warn', text: `${lead ? `${lead}. ` : ''}Pas de créneau favorable aujourd’hui pour ${workLabel(work, parcels)} selon les seuils indicatifs.`, action: 'edit-work', id: work.id, indicative: true};
  }
  return lead ? {key: 'weather', tone: '', text: `${lead}.`, action: 'open-weather'} : null;
}

function grazingSentence(data, today) {
  const parcels = new Map((data.parcelles || []).filter(p => !p.deletedAt).map(p => [p.id, p]));
  const sessions = filterGrazingSessions(data.grazingSessions, {date: today}).filter(s => parcels.has(s.parcelId));
  if (!sessions.length) return null;
  const days = s => s.startDate ? Math.max(0, Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${s.startDate}T12:00:00Z`)) / 86400000)) : null;
  // Le lot le plus ancien au pré est celui qu’on risque d’oublier.
  const lead = [...sessions].sort((a, b) => (days(b) ?? -1) - (days(a) ?? -1))[0];
  const total = grazingTotal(lead), type = grazingType(lead), d = days(lead);
  const who = total > 0 ? (type === 'Non précisé' ? plural(total, 'animal', 'animaux') : `${total} ${type.toLocaleLowerCase('fr')}`) : 'Un lot';
  const since = d === null ? '' : d === 0 ? ' depuis aujourd’hui' : ` depuis ${plural(d, 'jour', 'jours')}`;
  const others = sessions.length - 1;
  return {key: 'grazing', tone: d !== null && d >= 7 ? 'warn' : '', text: `${who} sur ${parcels.get(lead.parcelId).nom}${since}${others ? ` (et ${plural(others, 'autre lot', 'autres lots')})` : ''}.`, action: 'edit-grazing', id: lead.id};
}

function stockSentence(data) {
  const low = (data.stockItems || []).filter(x => !x.deletedAt && isLowStock(x));
  if (!low.length) return null;
  const names = low.slice(0, 2).map(x => clean(x.name) || 'Article');
  const text = low.length === 1 ? `Stock sous le seuil : ${names[0]} (${nf.format(Number(low[0].quantity))}${low[0].unit ? ` ${low[0].unit}` : ''}).`
    : `${low.length} stocks sous le seuil : ${names.join(', ')}${low.length > 2 ? '…' : ''}.`;
  return {key: 'stock', tone: 'warn', text, action: low.length === 1 ? 'edit-stock' : 'open-stock', id: low.length === 1 ? low[0].id : ''};
}

function maintenanceSentence(data) {
  const rows = (data.materiels || []).filter(m => !m.deletedAt).map(m => ({m, left: maintenanceRemaining(m)}))
    .filter(r => r.left !== null && r.left <= 20).sort((a, b) => a.left - b.left);
  if (!rows.length) return null;
  const {m, left} = rows[0], name = clean(m.nom) || 'Matériel';
  const text = left <= 0 ? `Entretien dépassé de ${plural(Math.abs(Math.round(left)), 'heure', 'heures')} pour ${name}` : `Entretien de ${name} dans ${plural(Math.round(left), 'heure', 'heures')}`;
  return {key: 'maintenance', tone: left <= 0 ? 'warn' : '', text: `${text}${rows.length > 1 ? `, et ${plural(rows.length - 1, 'autre matériel', 'autres matériels')} à surveiller` : ''}.`, action: 'edit-equipment', id: m.id};
}

function observationSentence(data) {
  const urgent = (data.observations || []).filter(o => !o.deletedAt && o.status !== 'Résolu' && fold(o.severity) === 'urgent');
  if (!urgent.length) return null;
  const first = urgent[0], title = clean(first.title || first.type) || 'Observation';
  return {key: 'observation', tone: 'warn', text: urgent.length === 1 ? `Observation urgente à traiter : ${title}.` : `${urgent.length} observations urgentes à traiter, dont ${title}.`, action: 'edit-observation', id: first.id};
}

function addDays(day, n) {const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d);}
// Le lundi : la semaine qui commence et le bilan de la semaine écoulée.
function weeklySentence(data, today) {
  const end = addDays(today, 6), lastStart = addDays(today, -7), lastEnd = addDays(today, -1);
  const works = (data.interventions || []).filter(w => !w.deletedAt && !['Annulé', 'Annulée'].includes(w.status));
  const pendingStatus = w => !['Terminé', 'Terminée'].includes(w.status || 'Terminé');
  const planned = works.filter(w => pendingStatus(w) && (w.plannedDate || w.date || '').slice(0, 10) >= today && (w.plannedDate || w.date || '').slice(0, 10) <= end);
  const done = works.filter(w => !pendingStatus(w) && String(w.date || '').slice(0, 10) >= lastStart && String(w.date || '').slice(0, 10) <= lastEnd);
  const area = done.reduce((sum, w) => sum + Math.max(0, num(w.surfaceWorked) ?? 0), 0);
  const ahead = planned.length ? `${plural(planned.length, 'travail prévu', 'travaux prévus')} d’ici dimanche` : 'aucun travail planifié d’ici dimanche';
  const back = done.length ? `${plural(done.length, 'travail terminé', 'travaux terminés')} la semaine dernière${area > 0 ? ` (${nf.format(area)} ha)` : ''}` : 'aucun travail terminé la semaine dernière';
  return {key: 'week', tone: '', text: `Cette semaine : ${ahead} ; ${back}.`, action: 'calendar-day-overview'};
}

// Sous-titre de l’accueil : l’agenda du jour en une phrase.
export function dayStory(cockpit, now = new Date()) {return typo(agendaSentence(cockpit, now));}
function agendaSentence(cockpit, now) {
  const works = cockpit.planned.length, tasks = cockpit.tasks.length, late = cockpit.overdueCount || 0, done = cockpit.done.length;
  const ongoing = cockpit.entries.filter(e => e.item.status === 'En cours').length;
  const items = [works ? plural(works, 'travail', 'travaux') : '', tasks ? plural(tasks, 'tâche', 'tâches') : ''].filter(Boolean);
  const lateText = late ? `${plural(late, 'action', 'actions')} en retard à reprendre` : '';
  if (!items.length) {
    if (done && !late) return `Journée bouclée : ${plural(done, 'travail terminé', 'travaux terminés')}.`;
    const head = done ? `${plural(done, 'travail terminé', 'travaux terminés')} aujourd’hui` : now.getHours() >= 18 ? 'Plus rien de prévu ce soir' : 'Rien de prévu aujourd’hui';
    return `${head}${lateText ? `, mais ${lateText}` : ongoing ? `, ${plural(ongoing, 'travail', 'travaux')} en cours` : ''}.`;
  }
  return `${items.join(' et ')} ${now.getHours() >= 18 ? 'encore à faire ce soir' : 'aujourd’hui'}${lateText ? `, plus ${lateText}` : ''}.`;
}

// Briefing de 1 à 5 phrases. Chaque phrase porte l’action à ouvrir (data-action existant de app.js)
// ou une action propre (« story ») gérée par home-story-ui.js.
export function composeMorningBrief(data, weather, {now = Date.now(), cockpit = null, location = null} = {}) {
  const date = new Date(now), today = localDay(date);
  const situation = cockpit || dailySituation(data, today);
  const hasLocation = location ?? Boolean(clean(data.exploitation?.commune) || (num(data.exploitation?.latitude) !== null && num(data.exploitation?.longitude) !== null));
  const age = weatherAge(weather, now);
  const sentences = [weatherSentence(data, weather, situation, now, hasLocation)];
  if (date.getDay() === 1) sentences.push(weeklySentence(data, today));
  sentences.push(grazingSentence(data, today), observationSentence(data), stockSentence(data), maintenanceSentence(data));
  const kept = sentences.filter(Boolean).slice(0, MAX_SENTENCES).map(s => ({...s, text: typo(s.text)}));
  if (kept.length === 1) kept.push({key: 'calm', tone: 'good', text: typo('Rien d’autre à signaler : stocks, entretiens et animaux sans alerte.')});
  const title = briefTitle(date);
  return {
    title, sentences: kept, weatherAge: age,
    indicative: kept.some(s => s.indicative),
    speech: [`${title}.`, ...kept.map(s => s.text)].join(' ')
  };
}
