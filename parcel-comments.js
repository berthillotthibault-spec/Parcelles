// n° 129 — Fil de commentaires par parcelle (« Préco : fongicide T2 la semaine prochaine »). Logique pure, sans DOM.
// Fiche parcelComments : {parcelId, text, kind 'preco'|'comment', workId, taskId, authorUid, authorName,
// authorEmail, authorRole, editedAt}. L'auteur est figé à la création ; firestore.rules (parcelCommentWritable)
// refuse qu'un membre hors gestion écrive le commentaire d'un autre, s'en attribue un, ou affiche un autre rôle
// ou une autre adresse que les siens. authorName reste déclaratif (affiché à côté du rôle contrôlé).
import {MANAGEMENT_ROLES, normalizeRole, parcelCommentWritable, roleLabel} from './permissions.js';

export const COMMENT_KINDS = Object.freeze({preco: 'Préconisation', comment: 'Commentaire'});
export const COMMENT_MAX_LENGTH = 2000;
const text = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();

/** Nouveau commentaire (ou modification du texte d'un commentaire existant, auteur inchangé). */
export function buildComment({parcelId, text: body, kind, workId = null} = {}, {author = {}, existing = null, now = Date.now(), id = null} = {}) {
  const value = text(body);
  if (!parcelId && !existing?.parcelId) throw new Error('Parcelle obligatoire.');
  if (!value) throw new Error('Écrivez votre commentaire.');
  if (value.length > COMMENT_MAX_LENGTH) throw new Error(`Commentaire trop long (${COMMENT_MAX_LENGTH} caractères au plus).`);
  const role = normalizeRole(author.role);
  // Hors gestion, la règle exige l'uid du compte : sans lui, le commentaire resterait bloqué sur cet appareil.
  if (!MANAGEMENT_ROLES.has(role) && !author.uid) throw new Error('Connexion au compte requise pour commenter.');
  const chosenKind = COMMENT_KINDS[kind] ? kind : (existing?.kind || (role === 'advisor' ? 'preco' : 'comment'));
  if (existing) return {...existing, text: value, kind: chosenKind, workId: workId || null, editedAt: now};
  return {
    id: id || undefined, parcelId, text: value, kind: chosenKind, workId: workId || null, taskId: null,
    authorUid: String(author.uid || ''), authorName: text(author.name), authorEmail: text(author.email).toLowerCase(),
    authorRole: role, editedAt: null
  };
}

/** Commentaires d'une parcelle, les plus récents d'abord. */
export function commentsForParcel(data, parcelId) {
  return (data?.parcelComments || []).filter(c => !c.deletedAt && c.parcelId === parcelId)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

/** Nom affiché de l'auteur : nom, sinon adresse, sinon « Vous » (sans compte cloud). */
export function authorLabel(comment, {uid = ''} = {}) {
  if (uid && comment?.authorUid === uid) return 'Vous';
  return comment?.authorName || comment?.authorEmail || (comment?.authorUid ? 'Membre de l’équipe' : 'Vous');
}
export function authorRoleLabel(comment) { return comment?.authorRole ? roleLabel(comment.authorRole) : ''; }

/** Modifier le texte : l'auteur seulement (la gestion modère par la corbeille, pas en réécrivant). */
export function canEditComment({role, uid = ''} = {}, comment) {
  if (!comment || normalizeRole(role) === 'viewer') return false;
  if (!uid || !comment.authorUid) return parcelCommentWritable(role, comment, uid);
  return comment.authorUid === uid;
}
/** Mettre à la corbeille : l'auteur, ou un rôle de gestion qui a le droit de supprimer. */
export function canDeleteComment({role, uid = ''} = {}, comment) {
  if (!comment) return false;
  const r = normalizeRole(role);
  if (MANAGEMENT_ROLES.has(r)) return true;
  return canEditComment({role: r, uid}, comment);
}
/** « Transformer en tâche » : rôles de gestion (le conseiller ne crée pas de travaux ni de tâches). */
export const canConvertToTask = role => MANAGEMENT_ROLES.has(normalizeRole(role));
/** Commenter : tout rôle qui écrit (pas le lecteur). */
export const canComment = role => normalizeRole(role) !== 'viewer';

/** Tâche préremplie à partir d'un commentaire (titre court, texte complet en note, lien croisé). */
export function taskFromComment(comment, {id, parcelName = '', dueDate = null} = {}) {
  const first = text(comment?.text).split('\n')[0].replace(/^pr[ée]co\s*:\s*/i, '');
  const title = `${comment?.kind === 'preco' ? 'Préco' : 'Commentaire'} : ${first.length > 80 ? `${first.slice(0, 79)}…` : first}`;
  const by = [comment?.authorName || comment?.authorEmail, comment?.authorRole ? roleLabel(comment.authorRole) : ''].filter(Boolean).join(', ');
  return {
    id, title, parcelId: comment?.parcelId || null, dueDate, status: 'À faire', priority: 'Normale',
    note: `${text(comment?.text)}${by ? `\n— ${by}` : ''}${parcelName ? ` · ${parcelName}` : ''}`,
    commentId: comment?.id || null, workId: comment?.workId || null, source: 'parcelComment'
  };
}

/** Échéance proposée d'après le texte : « demain », « aujourd'hui », « dans 3 jours », sinon dans 7 jours. */
export function dueDateHint(body, today) {
  const t = text(body).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const plus = n => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  if (/\baujourd.?hui\b/.test(t)) return today;
  if (/\bdemain\b/.test(t)) return plus(1);
  const days = /\bdans\s+(\d{1,2})\s*j(ours?)?\b/.exec(t);
  if (days) return plus(Number(days[1]));
  return plus(7);
}

/**
 * Commentaires lus sur cet appareil (preferences.parcelCommentsSeen : identifiant → heure de lecture) : renvoie
 * une nouvelle table. Les lectures de plus de keepDays jours sont oubliées (ces commentaires ne sont plus signalés).
 */
export function markCommentsSeen(seen = {}, commentIds = [], now = Date.now(), {keepDays = 90} = {}) {
  const since = now - keepDays * 864e5, next = {};
  for (const [id, at] of Object.entries(seen && typeof seen === 'object' && !Array.isArray(seen) ? seen : {})) if (Number(at) >= since) next[id] = Number(at);
  for (const id of [].concat(commentIds)) if (id) next[id] = now;
  return next;
}
