// n° 108 — Alertes sanitaires simples à partir de la météo, fonctions pures.
// Règles volontairement simples, inspirées des repères publiés par les instituts techniques ; elles
// signalent des conditions favorables, jamais une contamination certaine, et ne recommandent aucun
// produit. Deux niveaux : « surveiller » et « risque ». Tous les seuils sont réglables
// (preferences.agroRiskThresholds) et chaque alerte affiche sa règle, ses données et sa source.
//
// - Septoriose du blé : pluies journalières d'au moins 10 mm (10 derniers jours et 3 prochains) en
//   période de montaison (mars à juin). 1 pluie = surveiller, 2 et plus = risque.
// - Helminthosporiose et rouille du maïs : plus longue période d'humectation (humidité ≥ 90 % ou pluie)
//   entre 15 et 27 °C sur les 3 derniers jours et les 2 prochains. 6 h = surveiller, 10 h = risque.
// - Sclérotinia du colza : pendant la floraison (mars à mai), jours consécutifs humides (humidité
//   moyenne ≥ 80 %) avec une maximale de 10 à 25 °C. 2 jours = surveiller, 3 = risque.
// - Stress thermique des bovins au pré : indice THI = (1,8 T + 32) − (0,55 − 0,0055 HR) (1,8 T − 26),
//   maximum sur les 48 prochaines heures, croisé avec les lots au pré. 68 = surveiller, 72 = risque.
import {normalize, formatNumber} from './utils.js';
import {profileKey} from './phenology.js';
import {grazingStatus, grazingTotal, grazingType} from './grazing.js';
import {parcelStage, fungicideCover, diseaseVerdict, shortDate} from './disease-window.js';

export const RISK_DEFAULTS = {
  septoria: {rainMm: 10, lookbackDays: 10, aheadDays: 3, riskEvents: 2, months: [3, 4, 5, 6]},
  maizeLeaf: {rhMin: 90, tMin: 15, tMax: 27, watchHours: 6, riskHours: 10, months: [6, 7, 8, 9]},
  sclerotinia: {rhMin: 80, tMin: 10, tMax: 25, watchDays: 2, riskDays: 3, months: [3, 4, 5]},
  thi: {watch: 68, risk: 72, aheadHours: 48},
  // Idée 9 : fusariose du blé, seulement quand le stade est connu (épiaison à fin floraison).
  fusarium: {rainMm: 5, lookbackDays: 3, aheadDays: 3, riskEvents: 2, months: []},
  // Idée 9 : rémanence indicative d'un fongicide (jours).
  cover: {days: 14}
};
export const RISK_SOURCES = {
  septoria: 'Arvalis, règle simplifiée des pluies contaminatrices de la septoriose',
  maizeLeaf: 'Arvalis, conditions favorables à l’helminthosporiose et à la rouille du maïs',
  sclerotinia: 'Terres Inovia, facteurs de risque du sclérotinia pendant la floraison',
  thi: 'Indice température-humidité (THI, NRC 1971), repères de stress thermique des bovins',
  fusarium: 'Arvalis, pluies autour de la floraison et risque de fusariose des épis (règle simplifiée)'
};
export const RISK_LABELS = {septoria: 'Septoriose du blé', maizeLeaf: 'Helminthosporiose et rouille du maïs', sclerotinia: 'Sclérotinia du colza', thi: 'Stress thermique des bovins',
  fusarium: 'Fusariose des épis du blé'};

// Réglage « Protection d'un fongicide » (preferences.fungicideProtectionDays) : prioritaire sur l'ancien seuil cover.days.
export const FUNGICIDE_DAYS_CHOICES = [7, 10, 14, 21];
export function riskThresholds(prefs = {}) {
  const o = prefs?.agroRiskThresholds || {}, out = {};
  for (const [k, v] of Object.entries(RISK_DEFAULTS)) out[k] = {...v, ...(o[k] || {})};
  const fd = Number(prefs?.fungicideProtectionDays);
  if (FUNGICIDE_DAYS_CHOICES.includes(fd)) out.cover = {...out.cover, days: fd};
  return out;
}
export function thi(t, rh) {
  if (!Number.isFinite(t) || !Number.isFinite(rh)) return null;
  return Math.round(((1.8 * t + 32) - (0.55 - 0.0055 * rh) * (1.8 * t - 26)) * 10) / 10;
}

const pad = n => String(n).padStart(2, '0');
export const localHour = ms => {const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;};
const addDays = (iso, n) => {const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);};
const short = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthName = n => MONTHS[n - 1] || String(n);
const fr = v => formatNumber(Math.round(v * 10) / 10);

function hoursBetween(hourly, from, to) {
  const out = [], h = hourly || {};
  (h.time || []).forEach((t, i) => {if (t >= from && t < to) out.push({t, temp: h.temperature_2m?.[i], rh: h.relative_humidity_2m?.[i], rain: h.precipitation?.[i]});});
  return out;
}
// Plus longue suite d'heures humectées dans la plage de température.
export function longestWetSpell(hours, {rhMin, tMin, tMax}) {
  let best = {hours: 0, start: null}, run = 0, start = null;
  for (const h of hours) {
    const wet = (Number(h.rh) >= rhMin || Number(h.rain) > 0) && Number.isFinite(h.temp) && h.temp >= tMin && h.temp <= tMax;
    if (wet) {if (!run) start = h.t; run++; if (run > best.hours) best = {hours: run, start};} else run = 0;
  }
  return best;
}
export function partOfDay(t, todayIso) {
  const day = t.slice(0, 10), h = Number(t.slice(11, 13));
  const when = day === todayIso ? 'aujourd’hui' : day === addDays(todayIso, 1) ? 'demain' : `le ${short(day)}`;
  return `${when} ${h < 12 ? 'matin' : h < 18 ? 'après-midi' : 'soir'}`.replace('aujourd’hui soir', 'ce soir').replace('aujourd’hui matin', 'ce matin').replace('aujourd’hui après-midi', 'cet après-midi');
}

const parcelsOf = (state, test) => (state.parcelles || []).filter(p => !p.deletedAt && !p.archived && test(p));
const isWheat = p => /\bble\b/.test(normalize(p.culture)) && profileKey(p.culture) === 'cereales';
const BOVINE = /vache|bovin|genisse|taurillon|taureau|veau|boeuf|allaitant|laitier|laitiere|broutard/;

// withCovered : ajoute les parcelles protégées par un fongicide récent (niveau « couvert », pas une alerte).
export function evaluateAgroRisks(state = {}, agro = null,
  {now = Date.now(), thresholds = riskThresholds(state.preferences), withCovered = false, catalog = null} = {}) {
  if (!agro?.days?.length) return [];
  const alerts = [], nowHour = localHour(now), today = nowHour.slice(0, 10), month = Number(today.slice(5, 7));
  const base = (kind, level, extra) => ({kind, level, label: RISK_LABELS[kind], source: RISK_SOURCES[kind], ...extra});
  // Idée 9 : stade sensible et rémanence d'un fongicide, par parcelle. null = pas d'alerte.
  const coverDays = Number(thresholds.cover?.days) || RISK_DEFAULTS.cover.days;
  const gate = (kind, p, {monthOk, events = [], lastEvent = null, from}) => {
    let stage = null, cover = null;
    try {stage = parcelStage(state, p, agro.days, {today});} catch {stage = null;}
    try {cover = fungicideCover(state, p.id, {today, days: coverDays, catalog});} catch {cover = null;}
    const v = diseaseVerdict(kind, {stage, cover: cover && cover.until >= from ? cover : null, events, lastEvent});
    if (v.status === 'skip' || (!v.win.known && !monthOk)) return null;
    if (v.status === 'covered') {
      if (withCovered) alerts.push(base(kind, 'couvert', {id: `${kind}:${p.id}:${today}:couvert`, parcelId: p.id, until: v.cover.until, workId: v.cover.workId,
        title: `${p.nom} · ${RISK_LABELS[kind].toLowerCase()} couvert jusqu’au ${shortDate(v.cover.until)}`,
        message: `Conditions favorables sur ${p.nom}, mais le fongicide du ${shortDate(v.cover.date)} protège encore (indicatif).`
          + ` Alerte si le risque dure après le ${shortDate(v.cover.until)}.`,
        rule: `Rémanence indicative de ${v.cover.days} jours après un fongicide, réglable. Vérifiez l’étiquette du produit.`, data: v.why, why: v.why}));
      return null;
    }
    return v;
  };
  const why = v => (v.why && (v.win.known || v.cover) ? ` ${v.why}` : ''); // stade inconnu : explication dans « why » seulement

  // Septoriose.
  const s = thresholds.septoria;
  const wheat = parcelsOf(state, isWheat);
  if (wheat.length) {
    const from = addDays(today, -s.lookbackDays);
    const all = agro.days.filter(d => d.date >= from && d.date <= addDays(today, s.aheadDays) && Number(d.rain) >= s.rainMm);
    for (const p of all.length ? wheat : []) {
      const v = gate('septoria', p, {monthOk: s.months.includes(month), events: all.map(d => d.date), from});
      const events = v ? all.filter(d => v.events.includes(d.date)) : [];
      if (!events.length) continue;
      const level = events.length >= s.riskEvents ? 'risque' : 'surveiller';
      const data = events.map(d => `${short(d.date)} : ${fr(d.rain)} mm${d.date > today ? ' (prévue)' : ''}`).join(', ');
      alerts.push(base('septoria', level, {id: `septoria:${p.id}:${today}`, parcelId: p.id, why: v.why,
        title: `${p.nom} · ${level === 'risque' ? 'risque de septoriose' : 'septoriose à surveiller'}`,
        message: `${events.length} pluie${events.length > 1 ? 's' : ''} d’au moins ${s.rainMm} mm sur ${p.nom} : conditions favorables à la septoriose.`
          + ` Observez les feuilles du bas.${why(v)}`,
        rule: `Pluie journalière ≥ ${s.rainMm} mm entre J-${s.lookbackDays} et J+${s.aheadDays}, `
          + `de ${monthName(s.months[0])} à ${monthName(s.months.at(-1))} `
          + `(ou dès 1-2 nœuds si le stade est connu) ; ${s.riskEvents} pluies ou plus = risque.`, data}));
    }
  }
  // Fusariose des épis : seulement au stade sensible connu (épiaison à fin floraison).
  const fu = thresholds.fusarium;
  if (wheat.length) {
    const from = addDays(today, -fu.lookbackDays);
    const all = agro.days.filter(d => d.date >= from && d.date <= addDays(today, fu.aheadDays) && Number(d.rain) >= fu.rainMm);
    for (const p of all.length ? wheat : []) {
      const v = gate('fusarium', p, {monthOk: (fu.months || []).includes(month), events: all.map(d => d.date), from});
      const events = v ? all.filter(d => v.events.includes(d.date)) : [];
      if (!events.length) continue;
      const level = events.length >= fu.riskEvents ? 'risque' : 'surveiller';
      alerts.push(base('fusarium', level, {id: `fusarium:${p.id}:${today}`, parcelId: p.id, why: v.why,
        title: `${p.nom} · ${level === 'risque' ? 'risque de fusariose' : 'fusariose à surveiller'}`,
        message: `${events.length} jour${events.length > 1 ? 's' : ''} de pluie d’au moins ${fu.rainMm} mm autour de la floraison sur ${p.nom} : `
          + `conditions favorables à la fusariose des épis.${why(v)}`,
        rule: `Pluie journalière ≥ ${fu.rainMm} mm entre J-${fu.lookbackDays} et J+${fu.aheadDays}, de l’épiaison à la fin de la floraison ; `
          + `${fu.riskEvents} jours ou plus = risque.`,
        data: events.map(d => `${short(d.date)} : ${fr(d.rain)} mm${d.date > today ? ' (prévue)' : ''}`).join(', ')}));
    }
  }
  // Maïs : helminthosporiose et rouille.
  const m = thresholds.maizeLeaf;
  const maize = parcelsOf(state, p => profileKey(p.culture) === 'mais');
  if (maize.length && agro.hourly?.time?.length) {
    const spell = longestWetSpell(hoursBetween(agro.hourly, `${addDays(today, -3)}T00:00`, `${addDays(today, 3)}T00:00`), m);
    if (spell.hours >= Math.min(m.watchHours, m.riskHours)) {
      const level = spell.hours >= m.riskHours ? 'risque' : 'surveiller';
      const end = spell.start ? localHour(new Date(`${spell.start}:00`).getTime() + (spell.hours - 1) * 3600000).slice(0, 10) : today;
      for (const p of maize) {
        const v = gate('maizeLeaf', p, {monthOk: m.months.includes(month), events: [end], lastEvent: end, from: addDays(today, -3)});
        if (v) alerts.push(base('maizeLeaf', level, {id: `maizeLeaf:${p.id}:${today}`, parcelId: p.id, why: v.why,
        title: `${p.nom} · maladies foliaires du maïs`,
        message: `${spell.hours} h d’humectation entre ${m.tMin} et ${m.tMax} °C : `
          + `conditions favorables à l’helminthosporiose et à la rouille sur ${p.nom}. Observez les feuilles.${why(v)}`,
        rule: `Humectation (humidité ≥ ${m.rhMin} % ou pluie) entre ${m.tMin} et ${m.tMax} °C : ${m.watchHours} h = surveiller, ${m.riskHours} h = risque (J-3 à J+2).`,
        data: `Plus longue période : ${spell.hours} h à partir du ${short(spell.start)} ${spell.start.slice(11, 16)}`}));
      }
    }
  }
  // Colza : sclérotinia.
  const c = thresholds.sclerotinia;
  const rape = parcelsOf(state, p => profileKey(p.culture) === 'colza');
  if (rape.length && agro.hourly?.time?.length) {
    const byDay = new Map();
    (agro.hourly.time || []).forEach((t, i) => {const d = t.slice(0, 10), rh = agro.hourly.relative_humidity_2m?.[i]; if (!Number.isFinite(rh)) return; const r = byDay.get(d) || {sum: 0, n: 0}; r.sum += rh; r.n++; byDay.set(d, r);});
    let run = 0, best = 0, bestEnd = null;
    for (const d of agro.days.filter(x => x.date >= addDays(today, -5) && x.date <= addDays(today, 3))) {
      const r = byDay.get(d.date), rh = r?.n ? r.sum / r.n : null;
      const humid = rh !== null && rh >= c.rhMin && Number.isFinite(d.tmax) && d.tmax >= c.tMin && d.tmax <= c.tMax;
      run = humid ? run + 1 : 0;
      if (run > best) {best = run; bestEnd = d.date;}
    }
    if (best >= Math.min(c.watchDays, c.riskDays)) {
      const level = best >= c.riskDays ? 'risque' : 'surveiller';
      for (const p of rape) {
        const v = gate('sclerotinia', p, {monthOk: c.months.includes(month), events: [bestEnd], lastEvent: bestEnd, from: addDays(today, -5)});
        if (v) alerts.push(base('sclerotinia', level, {id: `sclerotinia:${p.id}:${today}`, parcelId: p.id, why: v.why,
        title: `${p.nom} · ${level === 'risque' ? 'risque de sclérotinia' : 'sclérotinia à surveiller'}`,
        message: `${best} jours humides et doux d’affilée pendant la floraison du colza sur ${p.nom}.`
          + ` Vérifiez le stade et l’état des pétales.${why(v)}`,
        rule: `En floraison (de ${monthName(c.months[0])} à ${monthName(c.months.at(-1))}), jours consécutifs avec humidité moyenne ≥ ${c.rhMin} % et maximale de ${c.tMin} à ${c.tMax} °C : ${c.watchDays} = surveiller, ${c.riskDays} = risque.`,
        data: `${best} jours jusqu’au ${short(bestEnd)} (J-5 à J+3)`}));
      }
    }
  }
  // Bovins au pré : THI.
  const tconf = thresholds.thi;
  const lots = (state.grazingSessions || []).filter(x => grazingStatus(x, {date: new Date(now)}) === 'current' && BOVINE.test(normalize(grazingType(x))));
  if (lots.length && agro.hourly?.time?.length) {
    const ahead = hoursBetween(agro.hourly, nowHour, localHour(now + tconf.aheadHours * 3600000));
    let peak = null;
    for (const h of ahead) {const v = thi(h.temp, h.rh); if (v !== null && (!peak || v > peak.v)) peak = {v, t: h.t, temp: h.temp, rh: h.rh};}
    if (peak && peak.v >= Math.min(tconf.watch, tconf.risk)) {
      const level = peak.v >= tconf.risk ? 'risque' : 'surveiller';
      for (const lot of lots) {
        const parcel = (state.parcelles || []).find(p => p.id === lot.parcelId), n = grazingTotal(lot), type = grazingType(lot).toLowerCase();
        alerts.push(base('thi', level, {id: `thi:${lot.id}:${today}`, parcelId: lot.parcelId || '', grazingId: lot.id,
          title: `${parcel?.nom || 'Pâture'} · chaleur pour le lot`, message: `${n ? `${n} ` : ''}${type} sur ${parcel?.nom || 'la pâture'}, THI ${Math.round(peak.v)} ${partOfDay(peak.t, today)} : vérifier l’eau et l’ombre.`,
          rule: `THI maximal sur ${tconf.aheadHours} h : ${tconf.watch} = surveiller, ${tconf.risk} = risque.`,
          data: `${fr(peak.temp)} °C et ${Math.round(peak.rh)} % d’humidité le ${short(peak.t)} à ${peak.t.slice(11, 16)}`}));
      }
    }
  }
  const order = {risque: 0, surveiller: 1, couvert: 2};
  return alerts.sort((a, b) => order[a.level] - order[b.level]);
}
