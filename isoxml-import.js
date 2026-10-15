// Import ISOXML TASKDATA (ISO 11783-10) : travaux réalisés exportés par la console du tracteur (n° 124).
// Logique pure : le XML est lu par une fonction parseXml injectable (DOMParser dans le navigateur,
// lecteur minimal ici pour Node et en secours). Seuls les éléments utiles sont exploités :
// PFD (parcelle, contour PLN/LSG/PNT en WGS84), TSK (tâche), TIM (temps), DLV/PDV (doses),
// PDT (produit), WKR (opérateur), CPC via OTP (pratique culturale). Les fichiers externes (XFR)
// et les journaux binaires (TLG) ne sont pas lus.
import {geometryAreaHa, geometryBbox, geometryCentroid, normalize, pointInGeometry, validateGeometry} from './utils.js';

export const ISOXML_SOURCE = 'isoxml';

export function isTaskDataXml(text) {return /<ISO11783_TaskData\b/.test(String(text || ''));}

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    if (code[0] === '#') {const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);return Number.isFinite(n) ? String.fromCodePoint(n) : all;}
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

// Lecteur XML minimal : éléments et attributs seulement (ISOXML ne porte pas de texte utile).
export function parseXmlLite(text) {
  const source = String(text || '').replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<![^>]*>/g, '');
  const root = {tag: '#document', attrs: {}, children: []}, stack = [root];
  const tagRe = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let match;
  while ((match = tagRe.exec(source))) {
    const [, closing, tag, rawAttrs, selfClosing] = match;
    if (closing) {
      const top = stack.pop();
      if (!top || top.tag !== tag || !stack.length) throw new Error(`XML mal formé : </${tag}> inattendu.`);
      continue;
    }
    const attrs = {};
    rawAttrs.replace(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, name, a, b) => {attrs[name] = decodeEntities(a ?? b);return '';});
    const node = {tag, attrs, children: []};
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`XML mal formé : <${stack[stack.length - 1].tag}> non fermé.`);
  return root.children[0] || null;
}

function domToTree(element) {
  const attrs = {};
  for (const attr of element.attributes || []) attrs[attr.name] = attr.value;
  return {tag: element.tagName, attrs, children: [...(element.children || [])].map(domToTree)};
}

export function defaultParseXml(text) {
  if (typeof DOMParser === 'function') {
    const doc = new DOMParser().parseFromString(String(text || ''), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Fichier ISOXML illisible (XML mal formé).');
    return doc.documentElement ? domToTree(doc.documentElement) : null;
  }
  return parseXmlLite(text);
}

const childrenOf = (node, tag) => (node?.children || []).filter(child => child.tag === tag);
const num = value => {const n = Number(String(value ?? '').replace(',', '.'));return value === undefined || value === '' || !Number.isFinite(n) ? null : n;};

function ringOf(lsg) {
  const ring = childrenOf(lsg, 'PNT').map(p => [num(p.attrs.D), num(p.attrs.C)]).filter(([x, y]) => x !== null && y !== null && Math.abs(x) <= 180 && Math.abs(y) <= 90);
  if (ring.length < 3) return null;
  const [a, b] = [ring[0], ring[ring.length - 1]];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([...a]);
  return ring.length >= 4 ? ring : null;
}
// PLN de type 1 = contour de parcelle ; LSG de type 1 = anneau extérieur, 2 = enclave.
function pfdGeometry(pfd) {
  const plns = childrenOf(pfd, 'PLN'), boundaries = plns.filter(p => p.attrs.A === '1');
  const polygons = (boundaries.length ? boundaries : plns.slice(0, 1)).map(pln => {
    const lsgs = childrenOf(pln, 'LSG'), outer = lsgs.find(l => l.attrs.A === '1') || lsgs[0];
    const exterior = outer && ringOf(outer);if (!exterior) return null;
    return [exterior, ...lsgs.filter(l => l !== outer && l.attrs.A === '2').map(ringOf).filter(Boolean)];
  }).filter(Boolean);
  if (!polygons.length) return null;
  return polygons.length === 1 ? {type: 'Polygon', coordinates: polygons[0]} : {type: 'MultiPolygon', coordinates: polygons};
}

// Codes DDI (ISO 11783-11) des doses par surface : volume en mm³/m², masse en mg/m² ; 1 mm³/m² = 0,01 L/ha.
const DOSE_DDI = {
  '0002': {unit: 'L/ha', factor: 0.01, actual: true}, '0001': {unit: 'L/ha', factor: 0.01, actual: false},
  '0007': {unit: 'kg/ha', factor: 0.01, actual: true}, '0006': {unit: 'kg/ha', factor: 0.01, actual: false},
};
function doseFrom(values) {
  const known = values.map(v => ({...v, ddi: String(v.ddi || '').toUpperCase().padStart(4, '0')})).filter(v => DOSE_DDI[v.ddi] && v.value !== null && v.value > 0);
  const best = known.find(v => DOSE_DDI[v.ddi].actual) || known[0];
  if (!best) return null;
  const spec = DOSE_DDI[best.ddi];
  return {dose: Math.round(best.value * spec.factor * 100) / 100, doseUnit: spec.unit, product: best.product || null};
}

// Une valeur avec décalage (Z ou ±hh:mm) est convertie en heure locale ; sans décalage, elle est déjà locale.
const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const withColonOffset = value => String(value || '').trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
const pad = n => String(n).padStart(2, '0');
function localParts(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  if (OFFSET_RE.test(text)) {
    const d = new Date(withColonOffset(text));
    if (!Number.isFinite(d.getTime())) return null;
    return {date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: /T\d{2}:\d{2}/.test(text) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : null};
  }
  const m = text.match(/T(\d{2}:\d{2})/);
  return {date: text.slice(0, 10), time: m ? m[1] : null};
}
const isoDate = value => localParts(value)?.date || null;
const isoTime = value => localParts(value)?.time || null;
const parseMs = value => {const t = Date.parse(withColonOffset(value));return Number.isFinite(t) ? t : null;};
const byInstant = (a, b) => (parseMs(a) ?? 0) - (parseMs(b) ?? 0) || String(a).localeCompare(String(b));

// Lit un TASKDATA.XML et renvoie {parcels, tasks}. parseXml(text) doit renvoyer {tag, attrs, children}.
export function parseTaskData(text, {parseXml = defaultParseXml} = {}) {
  const root = parseXml(text);
  if (!root || root.tag !== 'ISO11783_TaskData') throw new Error('Fichier ISOXML invalide : élément ISO11783_TaskData absent.');
  const designators = tag => new Map(childrenOf(root, tag).map(n => [n.attrs.A, n.attrs.B || '']));
  const products = designators('PDT'), practices = designators('CPC'), crops = designators('CTP');
  const workers = new Map(childrenOf(root, 'WKR').map(n => [n.attrs.A, [n.attrs.C, n.attrs.B].filter(Boolean).join(' ')]));
  const parcels = childrenOf(root, 'PFD').map(pfd => {
    const area = num(pfd.attrs.D);
    return {id: pfd.attrs.A, code: pfd.attrs.B || '', name: pfd.attrs.C || pfd.attrs.B || pfd.attrs.A, areaHa: area !== null ? Math.round(area / 100) / 100 : null, crop: crops.get(pfd.attrs.G) || '', geometry: pfdGeometry(pfd)};
  });
  const tasks = childrenOf(root, 'TSK').map(tsk => {
    const status = tsk.attrs.G || '';
    // Seuls les temps effectifs (TIM D=4) prouvent un travail réalisé ; le repli sur tous les TIM est réservé
    // aux tâches déclarées terminées (G=4). Planifiée (1), modèle (5) et annulée (6) ne sont jamais réalisées.
    const tims = childrenOf(tsk, 'TIM'), effective = tims.filter(t => t.attrs.D === '4'), used = effective.length ? effective : status === '4' ? tims : [];
    const starts = used.map(t => t.attrs.A).filter(Boolean).sort(byInstant), stops = used.map(t => t.attrs.B).filter(Boolean).sort(byInstant);
    let seconds = 0;
    for (const t of used) {
      const a = parseMs(t.attrs.A), b = parseMs(t.attrs.B), c = num(t.attrs.C);
      if (a !== null && b !== null && b >= a) seconds += (b - a) / 1000; else if (c !== null && c > 0) seconds += c;
    }
    const logged = used.flatMap(t => childrenOf(t, 'DLV').map(d => ({ddi: d.attrs.A, value: num(d.attrs.B)})));
    const planned = childrenOf(tsk, 'TZN').flatMap(z => childrenOf(z, 'PDV').map(p => ({ddi: p.attrs.A, value: num(p.attrs.B), product: products.get(p.attrs.C) || null})));
    const dose = doseFrom(logged) || doseFrom(planned);
    const productIds = [...childrenOf(tsk, 'PAN').map(p => p.attrs.A), ...childrenOf(tsk, 'TZN').flatMap(z => childrenOf(z, 'PDV').map(p => p.attrs.C))].filter(Boolean);
    const productNames = [...new Set(productIds.map(id => products.get(id)).filter(Boolean))];
    const practice = childrenOf(tsk, 'OTP').map(o => practices.get(o.attrs.A)).find(Boolean) || '';
    return {
      id: tsk.attrs.A, name: tsk.attrs.B || '', parcelRef: tsk.attrs.E || null, operator: workers.get(tsk.attrs.F) || '', status,
      done: status === '4' || (!['1', '5', '6'].includes(status) && effective.some(t => t.attrs.B)),
      date: isoDate(starts[0]), startTime: isoTime(starts[0]), endTime: isoTime(stops[stops.length - 1]),
      durationHours: seconds > 0 ? Math.round(seconds / 36) / 100 : null,
      product: dose?.product || productNames[0] || '', products: productNames, dose: dose?.dose ?? null, doseUnit: dose?.doseUnit || '', practice,
    };
  });
  return {parcels, tasks};
}

// Type de travail : pratique culturale de la console, sinon désignation de la tâche, sinon unité de dose.
const TYPE_RULES = [[/semi|seed|sow/, 'Semis'], [/recolt|harvest|moisson|battage/, 'Récolte'], [/ferti|engrais|azote|fertil/, 'Fertilisation'], [/epand|lisier|fumier|manure|slurry/, 'Épandage'], [/trait|pulv|spray|phyto|herbicide|fongicide|insecticide/, 'Traitement'], [/labour|plough|plow|dechaum|herse|travail du sol|tillage|cultivat/, 'Travail du sol'], [/fauch|mow/, 'Fauche']];
export function guessWorkType(task) {
  for (const text of [task.practice, task.name]) {const n = normalize(text);const rule = n && TYPE_RULES.find(([re]) => re.test(n));if (rule) return rule[1];}
  if (task.doseUnit === 'L/ha') return 'Traitement';
  if (task.doseUnit === 'kg/ha') return 'Fertilisation';
  return String(task.practice || task.name || '').trim() || 'Travail console';
}

const slug = value => normalize(value).replace(/\s+/g, '-');
// Les identifiants TSK repartent en général de TSK1 à chaque export : l'identifiant de dédoublonnage repose
// sur ce qui caractérise la tâche d'un export à l'autre (date et heure de début, parcelle, désignation).
export const isoxmlSourceId = (task, pfd) => [ISOXML_SOURCE, task.date || 'sans-date', (task.startTime || 'sans-heure').replace(':', 'h'), slug(pfd?.name || pfd?.code || task.parcelRef || ''), slug(task.name) || task.id].join(':');

// Point garanti intérieur au contour (le centre de l'emprise sort d'une parcelle en L, en croissant ou annulaire) :
// centre de l'emprise s'il convient, sinon le point de grille intérieur, loin du bord, le plus proche du centre.
export function interiorPoint(geometry) {
  const center = geometry && geometryCentroid(geometry);
  if (!center) return null;
  if (pointInGeometry(center.longitude, center.latitude, geometry)) return center;
  const box = geometryBbox(geometry);if (!box) return null;
  const N = 30, at = (i, j) => [box[0] + (box[2] - box[0]) * (i + 0.5) / N, box[1] + (box[3] - box[1]) * (j + 0.5) / N];
  const inside = (i, j) => i >= 0 && j >= 0 && i < N && j < N && pointInGeometry(...at(i, j), geometry);
  let best = null, fallback = null;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (!inside(i, j)) continue;
    const [x, y] = at(i, j), d = (x - center.longitude) ** 2 + (y - center.latitude) ** 2;
    if (!fallback || d < fallback.d) fallback = {x, y, d};
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].every(([di, dj]) => inside(i + di, j + dj)) && (!best || d < best.d)) best = {x, y, d};
  }
  const point = best || fallback;
  return point ? {longitude: point.x, latitude: point.y} : null;
}

// Rapprochement d'une parcelle ISOXML : point intérieur dans un contour existant (sans ambiguïté), sinon nom.
export function matchIsoxmlParcel(pfd, parcels = []) {
  const active = parcels.filter(p => !p.deletedAt);
  const center = pfd?.geometry && interiorPoint(pfd.geometry);
  if (center) {
    const hits = active.filter(p => p.geometry && pointInGeometry(center.longitude, center.latitude, p.geometry));
    if (hits.length === 1) return {parcel: hits[0], by: 'géométrie'};
  }
  for (const label of [pfd?.name, pfd?.code]) {
    const key = normalize(label);if (!key) continue;
    const hits = active.filter(p => normalize(p.nom) === key);
    if (hits.length === 1) return {parcel: hits[0], by: 'nom'};
  }
  return null;
}

// Lignes d'aperçu : travaux terminés rattachés (parcelId) ou à une parcelle proposée à la création (parcelSourceId).
export function isoxmlImportRows(data, state = {}) {
  const parcels = state.parcelles || [];
  const known = new Set((state.interventions || []).filter(i => !i.deletedAt && i.source === ISOXML_SOURCE).map(i => i.sourceId));
  const pfds = new Map((data.parcels || []).map(p => [p.id, p]));
  const parcelRows = [], workRows = [], warnings = [], proposed = new Map(), stats = {tasks: data.tasks?.length || 0, done: 0, planned: 0, duplicates: 0, matchedByGeometry: 0, matchedByName: 0, newParcels: 0, orphans: 0};
  for (const task of data.tasks || []) {
    if (!task.done || !task.date) {stats.planned++;continue;}
    stats.done++;
    const pfd = pfds.get(task.parcelRef);
    if (!pfd) {stats.orphans++;continue;}
    const sourceId = isoxmlSourceId(task, pfd);
    if (known.has(sourceId)) {stats.duplicates++;continue;}
    known.add(sourceId);
    const row = {isoxml: true, surfaceHa: null, type: guessWorkType(task), date: task.date, product: task.product || '', dose: task.dose, doseUnit: task.doseUnit, duration: task.durationHours, operator: task.operator, startTime: task.startTime, endTime: task.endTime, note: `Console ISOXML : ${task.name || task.id}`, sourceId, parcelName: pfd.name, nom: null};
    const match = matchIsoxmlParcel(pfd, parcels);
    if (match) {row.parcelId = match.parcel.id;stats[match.by === 'géométrie' ? 'matchedByGeometry' : 'matchedByName']++;}
    else {
      // Les identifiants PFD sont propres à chaque export : le nom les rend sûrs d'un fichier à l'autre.
      const parcelSourceId = `${ISOXML_SOURCE}:${pfd.id}:${normalize(pfd.name).replace(/\s+/g, '-')}`;
      if (!proposed.has(pfd.id)) {
        const declared = Number.isFinite(pfd.areaHa) && pfd.areaHa >= 0 ? pfd.areaHa : null;
        const surface = declared ?? (pfd.geometry ? Math.round(geometryAreaHa(pfd.geometry) * 100) / 100 : null);
        proposed.set(pfd.id, true);stats.newParcels++;
        // Un contour invalide ferait rejeter la parcelle et, avec elle, ses travaux : elle est proposée sans contour.
        const geometryErrors = pfd.geometry ? validateGeometry(pfd.geometry) : [];
        if (geometryErrors.length) warnings.push(`ISOXML : contour de « ${pfd.name} » invalide (${geometryErrors.join(', ')}), parcelle proposée sans contour.`);
        parcelRows.push({nom: pfd.name, surfaceHa: surface, culture: pfd.crop || '', commune: '', ilot: '', sourceId: parcelSourceId, geometry: geometryErrors.length ? null : pfd.geometry || null, isoxml: true});
      }
      row.parcelSourceId = parcelSourceId;
    }
    workRows.push(row);
  }
  warnings.unshift(`ISOXML : ${stats.done} ${stats.done > 1 ? 'tâches réalisées' : 'tâche réalisée'} sur ${stats.tasks}, ${stats.matchedByGeometry} rapprochée(s) par contour, ${stats.matchedByName} par nom, ${stats.newParcels} parcelle(s) à créer.`);
  if (stats.duplicates) warnings.push(`ISOXML : ${stats.duplicates} tâche(s) déjà importée(s), ignorée(s).`);
  if (stats.planned) warnings.push(`ISOXML : ${stats.planned} tâche(s) planifiée(s) ou sans date, ignorée(s).`);
  if (stats.orphans) warnings.push(`ISOXML : ${stats.orphans} tâche(s) sans parcelle de référence, ignorée(s).`);
  return {parcelRows, workRows, stats, warnings};
}

// Champs de l'intervention terminée créée à partir d'une ligne ISOXML.
export function isoxmlInterventionFields(row) {
  const fields = {source: ISOXML_SOURCE, sourceId: row.sourceId, note: row.note || ''};
  if (row.duration !== null && row.duration !== undefined) fields.duration = row.duration;
  if (row.operator) fields.operator = row.operator;
  if (row.startTime) fields.startTime = row.startTime;
  if (row.endTime) fields.endTime = row.endTime;
  return fields;
}
