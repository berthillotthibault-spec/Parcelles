// n° 128 : « Quoi de neuf » après une mise à jour (logique pure).
// whatsnew.json : {versions:[{version:'10.13.0', date, title, items:[…]}]}, la plus récente d'abord.

export function versionFromBuild(build) {
  const match = /v?(\d+\.\d+\.\d+)\s*$/.exec(String(build || ''));
  return match ? match[1] : '';
}
export function compareVersions(a, b) {
  const pa = String(a || '').split('.').map(Number), pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
// Versions publiées après lastSeenBuild et jusqu'au build courant (au plus `max`), la plus récente d'abord.
export function entriesSince(catalog, lastSeenBuild, currentBuild, {max = 2} = {}) {
  const last = versionFromBuild(lastSeenBuild), current = versionFromBuild(currentBuild);
  const list = (Array.isArray(catalog?.versions) ? catalog.versions : [])
    .filter(entry => entry && /^\d+\.\d+\.\d+$/.test(String(entry.version)) && Array.isArray(entry.items))
    .filter(entry => (!current || compareVersions(entry.version, current) <= 0) && (!last || compareVersions(entry.version, last) > 0))
    .sort((a, b) => compareVersions(b.version, a.version));
  return list.slice(0, max).map(entry => ({...entry, items: entry.items.map(String).slice(0, 4)}));
}
// 'first' : premier lancement (rien à montrer, on retient le build) ; 'show' : nouveau build ; 'none'.
// Sans lastSeenBuild, un utilisateur déjà installé (accueil terminé ou passé) voit la dernière version ;
// un profil neuf (ou rempli par un outil de test sans accueil) retient le build sans rien afficher.
export function whatsNewDecision(preferences = {}, buildId = '') {
  const last = preferences.lastSeenBuild;
  if (!buildId) return 'none';
  if (!last) return preferences.onboardingComplete === true ? 'show' : 'first';
  return last === buildId ? 'none' : 'show';
}

// Mise à jour sans perte de saisie : quels brouillons rouvrir après rechargement.
export const RESUMABLE_DRAFT_TYPES = ['interventions', 'tasks', 'grazingSessions', 'observations'];
export function parseDraftKey(key, prefix = 'parcelles:draft:') {
  if (!String(key || '').startsWith(prefix)) return null;
  const rest = String(key).slice(prefix.length), index = rest.indexOf(':');
  if (index < 1) return null;
  const type = rest.slice(0, index), id = rest.slice(index + 1);
  return {type, id: id === 'nouveau' ? null : id};
}
export function resumeTarget(keys, {types = RESUMABLE_DRAFT_TYPES} = {}) {
  for (const key of keys || []) { const parsed = parseDraftKey(key); if (parsed && types.includes(parsed.type)) return {...parsed, key}; }
  return null;
}
