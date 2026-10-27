// Collaboration en temps réel (n° 136) : logique pure et contrôleur d'abonnement, sans DOM direct.
// Au premier plan et en ligne, un onSnapshot suit les documents dont serverUpdatedAt dépasse le curseur serveur ;
// il est fermé dès que l'application passe en arrière-plan, hors ligne ou hors Wi-Fi (option).
// Les documents reçus passent par sync.applyLiveDocs, c'est-à-dire le même chemin que le pull (fusion, conflits).
// n° 5 : un document écrit par une version plus récente du schéma y est retenu (ni appliqué ni dépassé par le
// curseur serveur) et sync.onNewerSchema affiche le bandeau « Mettre à jour ».

const AUTHORS_KEY = 'parcelles:live-authors:v1';
const MAX_AUTHORS = 400;

// « paul.martin@ex.fr » → « Paul ». Un nom de membre connu est préféré.
export function actorName(email = '', members = []) {
  const key = String(email || '').toLowerCase();
  const member = members.find(m => String(m.email || '').toLowerCase() === key);
  const named = String(member?.displayName || member?.name || '').trim();
  if (named) return named;
  const local = key.split('@')[0].split(/[._-]+/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'Un membre';
}

const DONE = /^(terminé|termine|fait|réalisé|done)$/i;
export function entityLabel(type, entity = {}, lookup = {}) {
  if (!entity) return '';
  if (type === 'interventions') {
    const parcel = lookup.parcelName?.(entity.parcelId) || '';
    return [entity.type || 'Travail', parcel].filter(Boolean).join(' — ');
  }
  return String(entity.nom || entity.name || entity.title || entity.label || entity.type || '').trim();
}

// Phrase du toast, ou null si rien à annoncer (modification de cet appareil, type technique).
export function liveChangeMessage(change, {members = [], lookup = {}, selfUid = '', deviceId = ''} = {}) {
  if (!change?.after || (change.modifiedBy && change.modifiedBy === selfUid && change.deviceId === deviceId)) return null;
  if (['preferences', 'assistantMessages', 'syncConflicts'].includes(change.entityType)) return null;
  const who = actorName(change.modifiedEmail, members);
  const label = entityLabel(change.entityType, change.after, lookup);
  const quoted = label ? ` “${label}”` : '';
  let verb = 'a modifié';
  if (change.after.deletedAt && !change.before?.deletedAt) verb = 'a supprimé';
  else if (!change.before) verb = 'a ajouté';
  else if (change.entityType === 'interventions' && DONE.test(change.after.status || '') && !DONE.test(change.before.status || '')) verb = 'a terminé';
  return `${who} ${verb}${quoted}`;
}

// Plusieurs changements reçus d'un coup : un seul toast lisible.
export function summarizeChanges(changes, options = {}) {
  const messages = changes.map(c => liveChangeMessage(c, options)).filter(Boolean);
  if (!messages.length) return '';
  if (messages.length === 1) return messages[0];
  return `${messages[0]} et ${messages.length - 1} autre${messages.length > 2 ? 's' : ''} modification${messages.length > 2 ? 's' : ''}`;
}

export function relativeAgo(at, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Number(at || 0)) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

// Mémoire locale « qui a modifié quoi » (par appareil, hors schéma) : alimentée par le pull et le temps réel.
export function readAuthors(storage = globalThis.localStorage) {
  try { const parsed = JSON.parse(storage?.getItem(AUTHORS_KEY) || '{}'); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; }
}
export function recordAuthors(changes, {storage = globalThis.localStorage, workspaceId = '', now = Date.now()} = {}) {
  const map = readAuthors(storage);
  for (const c of changes || []) {
    if (!c?.entityType || !c?.entityId || !c.modifiedEmail) continue;
    map[`${workspaceId}:${c.entityType}:${c.entityId}`] = {email: c.modifiedEmail, at: now, action: c.after?.deletedAt ? 'delete' : c.before ? 'update' : 'create'};
  }
  const entries = Object.entries(map).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_AUTHORS);
  try { storage?.setItem(AUTHORS_KEY, JSON.stringify(Object.fromEntries(entries))); } catch {}
  return Object.fromEntries(entries);
}
export function authorOf(type, id, {storage = globalThis.localStorage, workspaceId = ''} = {}) {
  return readAuthors(storage)[`${workspaceId}:${type}:${id}`] || null;
}
// « Modifié par Paul il y a 1 min » sur la fiche, ou '' si aucune trace d'un autre membre.
export function modifiedByLabel(type, id, {storage, workspaceId = '', members = [], now = Date.now()} = {}) {
  const a = authorOf(type, id, {storage, workspaceId});
  if (!a) return '';
  const verb = a.action === 'delete' ? 'Supprimé' : a.action === 'create' ? 'Ajouté' : 'Modifié';
  return `${verb} par ${actorName(a.email, members)} ${relativeAgo(a.at, now)}`;
}

// Abonnement : ouvert seulement quand toutes les conditions sont réunies, refermé sinon.
export function liveAllowed({visible, online, connected, serverCursor, preferences = {}, networkOk = true, readOnly = false}) {
  return Boolean(visible && online && connected && serverCursor > 0 && preferences.syncEnabled && preferences.syncLive !== false && networkOk && !readOnly);
}

export function createLiveSyncController({sync, doc = globalThis.document, win = globalThis, isReadOnly = () => false, onChanges = () => {}, onError = () => {}} = {}) {
  let unsubscribe = null, chain = Promise.resolve(), stopped = false, openedFor = '';
  const allowed = () => liveAllowed({
    visible: doc?.visibilityState !== 'hidden', online: win?.navigator?.onLine !== false,
    connected: Boolean(sync?.status?.connected && sync?.user && sync?.db && sync?.workspaceId),
    serverCursor: Number(sync?.serverCursor || 0), preferences: sync?.store?.snapshot?.().preferences || {},
    networkOk: sync?.networkAllows ? sync.networkAllows({live: true}) : true, readOnly: isReadOnly()
  });
  function close() { if (unsubscribe) { try { unsubscribe(); } catch {} unsubscribe = null; } }
  function handle(snap) {
    if (snap?.metadata?.hasPendingWrites) return;
    const docs = (snap?.docChanges?.() || []).filter(c => c.type !== 'removed').map(c => c.doc);
    if (!docs.length) return;
    chain = chain.then(async () => {
      const result = await sync.applyLiveDocs(docs);
      if (result?.changes?.length) await onChanges(result.changes, result);
    }).catch(error => onError(error));
  }
  function open() {
    // n° 129 : plusieurs requêtes pour un rôle à lecture bornée (conseiller), une seule sinon.
    const queries = [].concat(sync.liveQuery?.() || []).filter(q => q?.onSnapshot);
    if (!queries.length) return;
    openedFor = `${sync.user?.uid || ''}:${sync.workspaceId || ''}`;
    const stops = queries.map(q => q.onSnapshot(handle, error => { close(); onError(error); }));
    unsubscribe = () => { for (const stop of stops) stop(); };
  }
  function refresh() {
    if (stopped) return false;
    const ok = allowed();
    // Changement de compte ou d'exploitation : l'ancien abonnement ne doit plus rien appliquer.
    if (unsubscribe && openedFor !== `${sync.user?.uid || ''}:${sync.workspaceId || ''}`) close();
    if (ok && !unsubscribe) open();
    if (!ok) close();
    return Boolean(unsubscribe);
  }
  const listeners = [[doc, 'visibilitychange'], [win, 'online'], [win, 'offline']];
  for (const [target, type] of listeners) target?.addEventListener?.(type, refresh);
  return {
    refresh,
    get active() { return Boolean(unsubscribe); },
    idle: () => chain,
    stop() { stopped = true; close(); for (const [target, type] of listeners) target?.removeEventListener?.(type, refresh); }
  };
}
