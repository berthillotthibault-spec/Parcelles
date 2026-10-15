// « Vous êtes dans » contextuel (n° 111) : choix de la parcelle de la position GPS selon la précision
// et la distance à la limite, application à une saisie vocale sans parcelle nommée, travaux dus sur place.
// Logique pure, sans DOM (testée par test-here-context.mjs) ; l'interface est dans here-ui.js.
import {distanceToBoundary, locateParcels} from './field-ops.js';
import {agendaDate, isPending} from './home-priorities.js';

export const HERE_MAX_ACCURACY_M = 25;   // au-delà, pas de pastille et confirmation obligatoire
export const HERE_EDGE_MIN_M = 10;       // marge minimale à la limite, même avec un GPS très précis
export const HERE_MAX_AGE_MS = 5 * 60000; // position plus ancienne : ignorée

const accuracyOf = position => {
  const value = Number(position?.accuracy);
  return position?.accuracy !== null && position?.accuracy !== undefined && position?.accuracy !== '' && Number.isFinite(value) && value >= 0 ? value : null;
};

// Parcelle contenant la position, ou null (hors parcelle, position absente ou trop ancienne).
// confident : précision <= maxAccuracy et assez loin de la limite (distance >= max(edgeMin, précision)).
// neighbours : parcelles voisines à portée de l'incertitude, proposées quand il faut confirmer.
export function pickHereParcel(position, parcels = [], {now = Date.now(), maxAccuracy = HERE_MAX_ACCURACY_M, edgeMin = HERE_EDGE_MIN_M, maxAge = HERE_MAX_AGE_MS} = {}) {
  if (!position) return null;
  const at = Number(position.at);
  if (position.at && Number.isFinite(at) && now - at > maxAge) return null;
  const rows = locateParcels(position, (parcels || []).filter(p => p && !p.archived));
  const inside = rows.filter(row => row.inside), hit = inside[0];
  if (!hit) return null;
  const overlap = inside.length > 1; // parcelles superposées (doublon, réimport, dérobée) : jamais sûre
  const accuracy = accuracyOf(position);
  const edgeDistance = distanceToBoundary(position, hit.parcel.geometry);
  const margin = Math.max(edgeMin, accuracy ?? 0);
  const precise = accuracy !== null && accuracy <= maxAccuracy;
  const nearEdge = edgeDistance < margin;
  const neighbours = [...inside.slice(1), ...rows.filter(row => !row.inside && row.distance <= margin)].map(row => row.parcel).slice(0, 3);
  return {parcel: hit.parcel, accuracy, edgeDistance, precise, nearEdge, overlap, confident: precise && !nearEdge && !overlap, neighbours, reason: !precise ? 'accuracy' : overlap ? 'overlap' : nearEdge ? 'edge' : ''};
}

export const accuracyText = here => here?.accuracy === null || here?.accuracy === undefined ? 'précision inconnue' : `± ${Math.round(here.accuracy)} m`;

// Pastille « Vous êtes dans : … » : seulement avec une précision suffisante.
export function hereBadge(here) {
  if (!here?.parcel || !here.precise) return null;
  return {label: `Vous êtes dans : ${here.parcel.nom || 'parcelle sans nom'}`, detail: `${accuracyText(here)}${here.nearEdge ? ' · près d’une limite' : ''}`};
}

// Saisie vocale de travail sans parcelle nommée (« j'ai fini de semer ») : la parcelle de la position.
// Position sûre : la parcelle est cochée. Sinon (précision > 25 m ou près d'une limite) elle est
// seulement proposée, avec ses voisines : il faut la toucher pour confirmer. Idem pour un travail daté
// d'un autre jour (« hier j'ai semé », « demain il faut traiter ») : la position actuelle n'en dit rien.
export function applyHereToEntry(entry, here, {today = ''} = {}) {
  if (!entry || !here?.parcel || entry.intent !== 'work') return entry;
  if (entry.parcels?.length || entry.parcelChoices?.length) return entry;
  const otherDay = Boolean(today && entry.date && entry.date !== today);
  if (here.confident && !otherDay) return {...entry, parcels: [here.parcel], parcelProbable: false, hereParcelId: here.parcel.id, hereNote: `Parcelle de votre position (${accuracyText(here)}).`};
  const why = otherDay ? `Position actuelle : ${here.parcel.nom || 'parcelle sans nom'}` : !here.precise ? 'Position imprécise' : here.overlap ? 'Parcelles superposées ici' : 'Vous êtes près d’une limite';
  return {...entry, parcels: [], parcelChoices: [[here.parcel, ...(here.neighbours || [])]], hereParcelId: here.parcel.id, hereNote: `${why} (${accuracyText(here)}) : touchez la parcelle pour confirmer.`};
}

// Travaux à faire sur la parcelle, échus aujourd'hui ou en retard (puis sans date), les plus anciens d'abord.
export function dueWorksHere(works = [], parcelId, today, limit = 3) {
  return (works || []).filter(w => w && w.parcelId === parcelId && isPending(w))
    .map(w => ({work: w, date: agendaDate(w)}))
    .filter(row => !row.date || row.date <= today)
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
    .slice(0, limit).map(row => ({...row.work, dueDate: row.date, overdue: Boolean(row.date && row.date < today)}));
}
