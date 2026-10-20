// Équipe et autorisations — hiérarchie des grades et règles « qui peut gérer qui ».
// Logique pure, sans DOM ni Firebase. Les mêmes règles sont appliquées côté serveur par firestore.rules
// (la vraie frontière de sécurité) : ce module ne sert qu’à afficher les bons boutons et à refuser tôt.
//
// Hiérarchie : propriétaire > responsable > collaborateur > opérateur terrain / comptabilité > lecteur.
// - le propriétaire gère tout le monde (sauf lui-même) et peut transférer la propriété ;
// - le responsable gère les grades inférieurs au sien et n’attribue que ces grades ;
// - les autres grades ne gèrent personne ;
// - chacun peut quitter l’exploitation, sauf le propriétaire tant qu’il n’a pas transféré la propriété.
import {OPERATOR_MATERIEL_FIELDS, ROLES, assignableRoles, canMutate, normalizeRole, roleCan, roleLabel} from './permissions.js';

export const ROLE_ORDER = ['owner', 'manager', 'editor', 'operator', 'accountant', 'viewer'];

// Niveau hiérarchique : opérateur terrain et comptabilité sont au même niveau (périmètres différents).
const TIER = {owner: 5, manager: 4, editor: 3, operator: 2, accountant: 2, viewer: 1};
export function roleTier(role) { return TIER[normalizeRole(role)]; }

export const ROLE_SUMMARY = {
  owner: 'Gère toute l’équipe, les invitations et l’exploitation cloud. Seul à pouvoir purger ou transférer la propriété.',
  manager: 'Saisit tout, invite et gère les collaborateurs, opérateurs, comptables et lecteurs.',
  editor: 'Saisit et modifie toutes les données de l’exploitation. Ne gère pas l’équipe.',
  operator: 'Saisit le travail de terrain : travaux, tâches, observations, photos, chantiers.',
  accountant: 'Gère clients, documents, stocks, produits et entretiens.',
  viewer: 'Consulte et exporte, sans rien modifier.'
};

// Exemples métier par grade (n° 122) : à qui donner quel grade, en une phrase.
export const ROLE_EXAMPLES = {
  owner: 'Le chef d’exploitation ou le gérant du GAEC.',
  manager: 'Un associé ou le chef de culture qui organise l’équipe.',
  editor: 'Un associé ou un conjoint collaborateur qui tient le cahier de cultures.',
  operator: 'Un salarié, un stagiaire ou le chauffeur de l’ETA qui saisit ses chantiers.',
  accountant: 'La secrétaire, le centre de gestion ou le comptable.',
  viewer: 'Le conseiller technique, un propriétaire bailleur ou un associé non exploitant.'
};

// Texte du partage d'une invitation (n° 122) : message prêt à envoyer avec le lien.
export function inviteShareText({role, email = '', expiresAt = null} = {}, farmName = '') {
  const farm = String(farmName || '').trim();
  const until = Number(expiresAt) > 0 ? ` Le lien expire le ${new Date(Number(expiresAt)).toLocaleDateString('fr-FR', {day: 'numeric', month: 'long'})}.` : '';
  return `Rejoignez ${farm ? `l’exploitation « ${farm} »` : 'notre exploitation'} sur Parcelles, grade « ${roleLabel(role)} ».${email ? ` Connectez-vous avec ${email}.` : ''}${until}`;
}

// Grades que `actor` peut attribuer (invitation ou changement de grade). Jamais « propriétaire » :
// la propriété ne se donne que par transfert.
const MANAGER_ASSIGNABLE = ['editor', 'operator', 'accountant', 'viewer'];
export function assignableRolesFor(actorRole) {
  const actor = normalizeRole(actorRole);
  if (actor === 'owner') return assignableRoles();
  if (actor === 'manager') return [...MANAGER_ASSIGNABLE];
  return [];
}
export function canManageTeam(actorRole) { return assignableRolesFor(actorRole).length > 0; }

// `actor` peut-il agir sur un membre de grade `targetRole` ? Jamais sur soi-même.
// Un grade inconnu est traité comme « lecteur » (normalizeRole), comme dans l’application.
export function canManageMember(actorRole, targetRole, {self = false} = {}) {
  if (self) return false;
  const actor = normalizeRole(actorRole), target = normalizeRole(targetRole);
  if (actor === 'owner') return target !== 'owner';
  if (actor === 'manager') return MANAGER_ASSIGNABLE.includes(target);
  return false;
}
export function canChangeRole(actorRole, targetRole, newRole, opts = {}) {
  return canManageMember(actorRole, targetRole, opts) && assignableRolesFor(actorRole).includes(newRole) && newRole !== normalizeRole(targetRole);
}
export function canRemoveMember(actorRole, targetRole, opts = {}) { return canManageMember(actorRole, targetRole, opts); }
export function canRevokeInvite(actorRole, inviteRole) { return canManageMember(actorRole, inviteRole); }
export function canLeave(role) { return normalizeRole(role) !== 'owner'; }
export function canTransferOwnership(actorRole, targetRole, {self = false} = {}) {
  return !self && normalizeRole(actorRole) === 'owner' && normalizeRole(targetRole) !== 'owner';
}

// Raison lisible d’un bouton indisponible (null si l’action est permise).
export function manageBlockReason(actorRole, targetRole, {self = false} = {}) {
  const actor = normalizeRole(actorRole), target = normalizeRole(targetRole);
  if (self) return actor === 'owner' ? 'Pour changer de grade, transférez d’abord la propriété.' : 'Vous ne pouvez pas modifier votre propre grade.';
  if (canManageMember(actor, target)) return null;
  if (target === 'owner') return 'Personne ne gère le propriétaire : seul un transfert de propriété le change.';
  if (actor === 'manager') return `Seul le propriétaire gère un ${roleLabel(target).toLocaleLowerCase('fr')}.`;
  if (actor === 'owner') return 'Le propriétaire ne peut pas être modifié.';
  return 'Votre grade ne permet pas de gérer l’équipe.';
}

export function teamPowerSentence(role) {
  const r = normalizeRole(role);
  if (r === 'owner') return 'Vous gérez tous les membres, les invitations et pouvez transférer la propriété.';
  if (r === 'manager') return 'Vous gérez les collaborateurs, opérateurs terrain, comptables et lecteurs.';
  return 'Votre grade ne permet pas de gérer l’équipe. Adressez-vous au propriétaire ou à un responsable.';
}

// Tri d’affichage : grade décroissant puis adresse.
export function sortMembers(members = []) {
  return [...members].sort((a, b) => (ROLE_ORDER.indexOf(normalizeRole(a.role)) - ROLE_ORDER.indexOf(normalizeRole(b.role)))
    || String(a.email || a.uid || a.id || '').localeCompare(String(b.email || b.uid || b.id || ''), 'fr'));
}

// Dernière activité connue d’un membre : appareil vu le plus récemment ou dernière entrée du journal.
export function lastActivityByUser({devices = [], activity = []} = {}) {
  const out = {};
  const bump = (uid, at) => { const t = Number(at) || 0; if (uid && t > (out[uid] || 0)) out[uid] = t; };
  for (const d of devices) bump(d.userId, d.lastSeen);
  for (const a of activity) bump(a.userId, a.createdAt);
  return out;
}

// Invitations encore valides, les plus récentes d’abord.
export function pendingInvites(invites = [], now = Date.now()) {
  return invites.filter(i => i && Number(i.expiresAt) > now).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

// Journal des changements d’équipe (collection audit existante).
const TEAM_ACTIONS = {
  'workspace-create': 'Exploitation cloud créée',
  'invite-create': 'Invitation envoyée',
  'invite-accept': 'Invitation acceptée',
  'invite-revoke': 'Invitation révoquée',
  'member-role': 'Grade modifié',
  'member-remove': 'Membre retiré',
  'member-leave': 'A quitté l’exploitation',
  'ownership-transfer': 'Propriété transférée'
};
export function teamJournal(activity = []) {
  return activity.filter(a => TEAM_ACTIONS[a?.action]).map(a => ({
    ...a,
    label: TEAM_ACTIONS[a.action],
    roleLabel: a.details?.role ? roleLabel(a.details.role) : ''
  }));
}

// Tableau « Qui peut faire quoi », calculé à partir de permissions.js (mêmes règles que l’application).
// Chaque cellule : 'yes' | 'partial' | 'no', avec une précision éventuelle.
const DOMAINS = [
  ['Parcelles', {entity: 'parcelles'}],
  ['Travaux et coûts', {entity: 'interventions'}],
  ['Tâches et consignes', {entity: 'tasks'}],
  ['Observations et photos', {entity: 'observations'}],
  ['Chantiers', {entity: 'chantiers'}],
  ['Matériel', {entity: 'materiels'}],
  ['Entretiens du matériel', {entity: 'maintenanceRecords'}],
  ['Stocks et produits', {entity: 'stockItems'}],
  ['Clients', {entity: 'clients'}],
  ['Factures et ventes', {entity: 'integrationImports', farmKind: 'invoice'}],
  ['Capteurs et imports machine', {entity: 'integrationImports', farmKind: 'sensor'}],
  ['Documents', {entity: 'documents'}]
];
export function permissionMatrix() {
  const cell = (ok, note = '') => ({value: ok ? 'yes' : 'no', note});
  const rows = DOMAINS.map(([label, op]) => ({
    label,
    cells: Object.fromEntries(ROLE_ORDER.map(r => [r, cell(canMutate(r, {...op, action: 'update'}))]))
  }));
  // Vague 12 : l'opérateur terrain relève le compteur des engins sans modifier le reste de la fiche.
  const machines = rows.find(row => row.label === 'Matériel');
  for (const r of ROLE_ORDER) if (machines.cells[r].value === 'no' && canMutate(r, {entity: 'materiels', action: 'update', fields: OPERATOR_MATERIEL_FIELDS}))
    machines.cells[r] = {value: 'partial', note: 'compteur seulement'};
  rows.push({label: 'Mettre à la corbeille', cells: Object.fromEntries(ROLE_ORDER.map(r => [r, cell(roleCan(r, 'delete'))]))});
  rows.push({label: 'Supprimer définitivement', cells: Object.fromEntries(ROLE_ORDER.map(r => [r, cell(roleCan(r, 'purge'))]))});
  rows.push({label: 'Restaurer une sauvegarde', cells: Object.fromEntries(ROLE_ORDER.map(r => [r, cell(roleCan(r, 'restore'))]))});
  rows.push({label: 'Importer des fichiers', cells: Object.fromEntries(ROLE_ORDER.map(r => [r, cell(roleCan(r, 'import'))]))});
  rows.push({label: 'Exporter, imprimer', cells: Object.fromEntries(ROLE_ORDER.map(r => [r, cell(roleCan(r, 'export'))]))});
  rows.push({label: 'Consulter', cells: Object.fromEntries(ROLE_ORDER.map(r => [r, cell(roleCan(r, 'read'))]))});
  rows.push({label: 'Inviter et gérer les membres', cells: Object.fromEntries(ROLE_ORDER.map(r => {
    const n = assignableRolesFor(r).length;
    return [r, n === assignableRoles().length ? {value: 'yes', note: 'tout le monde'} : n ? {value: 'partial', note: 'grades inférieurs'} : {value: 'no', note: ''}];
  }))});
  rows.push({label: 'Transférer la propriété', cells: Object.fromEntries(ROLE_ORDER.map(r => [r, cell(r === 'owner')]))});
  rows.push({label: 'Quitter l’exploitation', cells: Object.fromEntries(ROLE_ORDER.map(r => [r, r === 'owner' ? {value: 'partial', note: 'après transfert'} : cell(true)]))});
  return {roles: ROLE_ORDER.map(r => ({role: r, label: roleLabel(r), rank: ROLES[r].rank})), rows};
}
