// Corbeille plus utile (n° 141) : logique pure (regroupement, recherche, auteur, éléments liés). Testée avec node:test.

export function trashRows(data, types = []) {
  const rows = [];
  for (const type of types) for (const item of (data?.[type] || [])) if (item?.deletedAt) rows.push({type, item});
  return rows.sort((a, b) => (b.item.deletedAt || 0) - (a.item.deletedAt || 0));
}

// Nombre d'éléments par type, du plus fréquent au moins fréquent.
export function trashGroups(rows) {
  const counts = new Map();
  for (const {type} of rows) counts.set(type, (counts.get(type) || 0) + 1);
  return [...counts].map(([type, count]) => ({type, count})).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

const fold = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function filterTrash(rows, {type = '', query = '', titleOf = () => ''} = {}) {
  const q = fold(query).trim();
  return rows.filter(({type: t, item}) => (!type || t === type) && (!q || fold(`${titleOf(t, item)} ${item.note || ''}`).includes(q)));
}

const dayKey = at => { const d = new Date(at); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
export function deletedAgo(deletedAt, now = Date.now()) {
  if (!deletedAt) return '';
  if (dayKey(deletedAt) === dayKey(now)) return 'aujourd’hui';
  const days = Math.max(1, Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(deletedAt).setHours(0, 0, 0, 0)) / 864e5));
  return days === 1 ? 'hier' : `il y a ${days} j`;
}

// Auteur de la suppression : sync (modifiedEmail mémorisé par live-sync ou porté par l'élément), sinon journal local.
export function deletedBy(type, item, {journal = [], remoteAuthor = null} = {}) {
  if (remoteAuthor?.email && remoteAuthor.action === 'delete') return remoteAuthor.email;
  const local = journal.find(e => e?.details?.entityType === type && e.details.entityId === item.id && e.details.action === 'delete');
  if (local) return local.by || '';
  return item.modifiedEmail || '';
}
export function deletedLabel(type, item, {now = Date.now(), who = ''} = {}) {
  const ago = deletedAgo(item.deletedAt, now);
  return `Supprimé ${ago}${who ? ` par ${who}` : ''}`;
}

// Travaux et passages (pâturage) d'une parcelle supprimés le même jour qu'elle : proposés, jamais restaurés d'office.
export const RELATED_TYPES = ['interventions', 'grazingSessions'];
export function relatedDeletions(data, parcel) {
  if (!parcel?.deletedAt) return [];
  const day = dayKey(parcel.deletedAt), out = [];
  for (const type of RELATED_TYPES) for (const item of (data?.[type] || [])) {
    const linked = item.parcelId === parcel.id || (Array.isArray(item.parcelIds) && item.parcelIds.includes(parcel.id));
    if (linked && item.deletedAt && dayKey(item.deletedAt) === day) out.push({type, item});
  }
  return out;
}

// « Vider » : l'utilisateur doit saisir exactement le nombre d'éléments.
export const emptyConfirmed = (typed, count) => count > 0 && String(typed || '').trim() === String(count);
