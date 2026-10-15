// n° 19 — Partage d'un travail, d'une observation et du récapitulatif du jour.
// Logique pure (testée sous Node) : texte court et lisible pour une messagerie, sans données
// superflues (pas de coûts, d'identifiants internes ni de notes de synchronisation).
// Un traitement phytosanitaire incomplet est marqué « provisoire ».
import {formatNumber, geometryCentroid} from './utils.js';
import {active, completed} from './farm-memory.js';
import {isPending} from './home-priorities.js';
import {dayIso, isTreatment, registerMissing} from './phyto.js';

const text = value => String(value ?? '').trim();
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const plural = (n, one, many) => `${formatNumber(n)} ${n > 1 ? many : one}`;

/** Date ISO (AAAA-MM-JJ…) au format JJ/MM/AAAA ; texte vide si illisible. */
export function shareDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Lien Google Maps vers un point (6 décimales) ; null hors plage. */
export function mapsLink(point) {
  if (!point || !finite(point.latitude) || !finite(point.longitude)) return null;
  const lat = Number(point.latitude), lon = Number(point.longitude);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

// Position propre (GPS de l'observation) sinon centroïde de la parcelle.
function placeOf(item, parcel) {
  if (item && finite(item.latitude) && finite(item.longitude)) return {latitude: Number(item.latitude), longitude: Number(item.longitude)};
  return parcel?.geometry ? geometryCentroid(parcel.geometry) : null;
}

/** Échéance d'un travail en attente, date de réalisation d'un travail clos. */
export function shareWorkDate(work) {
  return isPending(work || {}) ? (work.plannedDate || work.date || '') : (work?.date || '');
}

/** Champs manquants d'un traitement réalisé pour le registre (mêmes règles que registerRows de phyto.js) ;
 * vide si complet, si ce n'est pas un traitement ou s'il est seulement prévu (le registre ne compte que les traitements faits). */
export function phytoMissing(work, {state = null, parcel, catalog = null} = {}) {
  if (!work || !isTreatment(work) || isPending(work)) return [];
  return registerMissing(state, work, {parcel, catalog});
}

function doseText(work) {
  const product = text(work.product), dose = finite(work.dose) ? `${formatNumber(work.dose)}${text(work.doseUnit) ? ` ${text(work.doseUnit)}` : ''}` : '';
  if (!product && !dose) return '';
  return [product, dose].filter(Boolean).join(' · ');
}

/** Texte de partage d'un travail : {title, text, provisional, missing}. */
export function workShareText(work, {parcel = null, equipment = null, state = null, catalog = null} = {}) {
  if (!work) return null;
  const missing = phytoMissing(work, {state, parcel, catalog}), provisional = missing.length > 0;
  const type = text(work.type) || 'Travail', place = text(parcel?.nom);
  const date = shareDate(shareWorkDate(work)), pending = isPending(work);
  const title = `${type}${place ? ` · ${place}` : ''}`;
  const lines = [`${provisional ? '[PROVISOIRE] ' : ''}${title}`];
  if (date) lines.push(`${pending ? 'Prévu le' : 'Fait le'} ${date}${text(work.startTime) ? ` à ${text(work.startTime)}` : ''}`);
  if (parcel) lines.push(`Parcelle : ${place || 'sans nom'}${finite(parcel.surfaceHa) ? ` (${formatNumber(parcel.surfaceHa)} ha)` : ''}`);
  const culture = text(work.culture || parcel?.culture);
  if (culture) lines.push(`Culture : ${culture}`);
  if (finite(work.surfaceWorked)) lines.push(`Surface : ${formatNumber(work.surfaceWorked)} ha`);
  const dose = doseText(work);
  if (dose) lines.push(`Produit : ${dose}`);
  if (text(work.target)) lines.push(`Cible : ${text(work.target)}`);
  if (text(work.operator)) lines.push(`Opérateur : ${text(work.operator)}`);
  if (text(equipment?.nom)) lines.push(`Matériel : ${text(equipment.nom)}`);
  if (pending && text(work.status)) lines.push(`Statut : ${text(work.status)}`);
  const link = mapsLink(placeOf(null, parcel));
  if (link) lines.push(`Position : ${link}`);
  if (provisional) lines.push(`Provisoire : registre phytosanitaire incomplet (manque ${missing.join(', ')}).`);
  else if (pending && isTreatment(work)) lines.push('Traitement prévu : registre à compléter après réalisation.');
  return {title: provisional ? `${title} (provisoire)` : title, text: lines.join('\n'), provisional, missing};
}

const SEVERITY = {urgent: 'Urgent', warning: 'À surveiller', info: 'Information'};

/** Texte de partage d'une observation : {title, text}. */
export function observationShareText(observation, {parcel = null} = {}) {
  if (!observation) return null;
  const o = observation, head = text(o.title) || text(o.type) || 'Observation', place = text(parcel?.nom);
  const title = `${head}${place ? ` · ${place}` : ''}`;
  const lines = [title];
  const date = shareDate(o.date);
  if (date) lines.push(`Observé le ${date}`);
  if (text(o.type) && text(o.type) !== head) lines.push(`Type : ${text(o.type)}`);
  if (parcel) lines.push(`Parcelle : ${place || 'sans nom'}${text(parcel.culture) ? ` (${text(parcel.culture)})` : ''}`);
  const level = SEVERITY[o.severity];
  if (level || text(o.status)) lines.push([level ? `Niveau : ${level}` : '', text(o.status) ? `Statut : ${text(o.status)}` : ''].filter(Boolean).join(' · '));
  if (text(o.note)) lines.push(text(o.note));
  const own = finite(o.latitude) && finite(o.longitude), link = mapsLink(placeOf(o, parcel));
  if (link) lines.push(`${own ? 'Position' : 'Parcelle'} : ${link}`);
  return {title, text: lines.join('\n')};
}

/** Photo à joindre : la plus récente rattachée à l'observation (ou null). */
export function observationPhoto(data, observationId) {
  if (!observationId) return null;
  return active(data || {}, 'photos').filter(p => p.observationId === observationId && (!p.mimeType || /^image\//.test(p.mimeType)))
    .sort((a, b) => Number(b.capturedAt || 0) - Number(a.capturedAt || 0))[0] || null;
}

/** Récapitulatif d'une journée : travaux faits, restants et observations du jour. */
export function dayShareText(data, day, {catalog = null} = {}) {
  const s = data || {}, parcels = new Map(active(s, 'parcelles').map(p => [p.id, p]));
  const name = id => text(parcels.get(id)?.nom) || 'sans parcelle';
  const works = active(s, 'interventions').filter(w => w.status !== 'Annulé' && String(shareWorkDate(w)).slice(0, 10) === day);
  const done = works.filter(w => !isPending(w) && completed(w)), left = works.filter(w => isPending(w));
  // Tâches du jour (comme les étapes du récapitulatif de la tournée) : échéance du jour, ou terminées ce jour-là.
  const tasks = active(s, 'tasks').filter(t => t.status !== 'Annulé' && (String(t.dueDate || '').slice(0, 10) === day || (!isPending(t, 'task') && Number(t.updatedAt) > 0 && dayIso(Number(t.updatedAt)) === day)));
  const doneTasks = tasks.filter(t => !isPending(t, 'task')), leftTasks = tasks.filter(t => isPending(t, 'task'));
  const observations = active(s, 'observations').filter(o => String(o.date || '').slice(0, 10) === day);
  const hectares = done.reduce((sum, w) => sum + (finite(w.surfaceWorked) ? Number(w.surfaceWorked) : finite(parcels.get(w.parcelId)?.surfaceHa) ? Number(parcels.get(w.parcelId).surfaceHa) : 0), 0);
  const farm = text(s.exploitation?.nom || s.exploitation?.name);
  const title = `Journée du ${shareDate(day) || day}${farm ? ` · ${farm}` : ''}`;
  const flagged = w => phytoMissing(w, {state: s, parcel: parcels.get(w.parcelId) || null, catalog}).length > 0;
  const taskLine = t => `- ${text(t.title) || 'Tâche'}${t.parcelId ? ` · ${name(t.parcelId)}` : ''}`;
  const workLine = w => {
    const dose = doseText(w), flag = flagged(w) ? ' (provisoire)' : '';
    return `- ${text(w.type) || 'Travail'} · ${name(w.parcelId)}${dose ? ` · ${dose}` : ''}${text(w.operator) ? ` · ${text(w.operator)}` : ''}${flag}`;
  };
  const lines = [title];
  lines.push(done.length ? `Fait : ${plural(done.length, 'travail', 'travaux')}${hectares > 0 ? `, ${formatNumber(hectares)} ha` : ''}` : 'Fait : aucun travail terminé.');
  lines.push(...done.map(workLine));
  if (left.length) lines.push(`Reste : ${plural(left.length, 'travail', 'travaux')}`, ...left.map(workLine));
  if (doneTasks.length) lines.push(`Tâches faites : ${doneTasks.length}`, ...doneTasks.map(taskLine));
  if (leftTasks.length) lines.push(`Tâches restantes : ${leftTasks.length}`, ...leftTasks.map(taskLine));
  if (observations.length) lines.push(`Observations : ${observations.length}`, ...observations.map(o => `- ${text(o.title) || text(o.type) || 'Observation'} · ${name(o.parcelId)}${o.severity === 'urgent' ? ' (urgent)' : ''}`));
  const provisional = done.some(flagged);
  if (provisional) lines.push('Provisoire : au moins un traitement phytosanitaire est incomplet.');
  return {title, text: lines.join('\n'), provisional, counts: {done: done.length, left: left.length, tasksDone: doneTasks.length, tasksLeft: leftTasks.length, observations: observations.length}};
}
