// Équipe et autorisations : qui peut gérer qui, grades attribuables, tableau « Qui peut faire quoi ».
// Mêmes règles que firestore.rules (vérifiées à l’émulateur par tools/test-rules.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  ROLE_ORDER, roleTier, assignableRolesFor, canManageTeam, canManageMember, canChangeRole, canRemoveMember,
  canRevokeInvite, canLeave, canTransferOwnership, manageBlockReason, sortMembers, lastActivityByUser,
  pendingInvites, teamJournal, permissionMatrix, teamPowerSentence
} from './team-roles.js';

const LOWER = ['editor', 'operator', 'accountant', 'viewer'];

test('hiérarchie : propriétaire > responsable > collaborateur > opérateur / comptabilité > lecteur', () => {
  assert.deepEqual(ROLE_ORDER, ['owner', 'manager', 'editor', 'operator', 'accountant', 'viewer']);
  assert.ok(roleTier('owner') > roleTier('manager'));
  assert.ok(roleTier('manager') > roleTier('editor'));
  assert.ok(roleTier('editor') > roleTier('operator'));
  assert.equal(roleTier('operator'), roleTier('accountant'));
  assert.ok(roleTier('accountant') > roleTier('viewer'));
  assert.equal(roleTier('inconnu'), roleTier('viewer'));
});

test('grades attribuables : jamais propriétaire ; le responsable seulement en dessous de lui', () => {
  assert.deepEqual(assignableRolesFor('owner'), ['manager', ...LOWER]);
  assert.deepEqual(assignableRolesFor('manager'), LOWER);
  for (const r of ['editor', 'operator', 'accountant', 'viewer', 'inconnu']) assert.deepEqual(assignableRolesFor(r), []);
  for (const r of ROLE_ORDER) assert.ok(!assignableRolesFor(r).includes('owner'));
  assert.ok(canManageTeam('owner') && canManageTeam('manager') && !canManageTeam('editor'));
});

test('le propriétaire gère tout le monde sauf un propriétaire et lui-même', () => {
  for (const r of ['manager', ...LOWER]) assert.ok(canManageMember('owner', r), r);
  assert.ok(!canManageMember('owner', 'owner'));
  assert.ok(!canManageMember('owner', 'editor', {self: true}));
  assert.ok(canChangeRole('owner', 'editor', 'manager'));
  assert.ok(!canChangeRole('owner', 'editor', 'owner'), 'la propriété ne se donne que par transfert');
  assert.ok(!canChangeRole('owner', 'editor', 'editor'), 'pas de changement vide');
});

test('le responsable gère les rangs inférieurs, jamais un responsable ni le propriétaire', () => {
  for (const r of LOWER) {
    assert.ok(canManageMember('manager', r), r);
    assert.ok(canRemoveMember('manager', r), r);
  }
  assert.ok(!canManageMember('manager', 'manager'));
  assert.ok(!canManageMember('manager', 'owner'));
  assert.ok(!canRemoveMember('manager', 'owner'));
  assert.ok(canChangeRole('manager', 'viewer', 'editor'));
  assert.ok(!canChangeRole('manager', 'editor', 'manager'), 'ne promeut pas responsable');
  assert.ok(!canChangeRole('manager', 'editor', 'owner'), 'ne promeut pas propriétaire');
  assert.ok(!canChangeRole('manager', 'manager', 'viewer'), 'ne rétrograde pas un autre responsable');
  assert.ok(canRevokeInvite('manager', 'viewer'));
  assert.ok(!canRevokeInvite('manager', 'manager'));
  assert.ok(!canChangeRole('manager', 'editor', 'viewer', {self: true}));
});

test('les autres grades ne gèrent personne', () => {
  for (const actor of ['editor', 'operator', 'accountant', 'viewer'])
    for (const target of ROLE_ORDER) {
      assert.ok(!canManageMember(actor, target), `${actor} → ${target}`);
      assert.ok(!canRevokeInvite(actor, target));
    }
});

test('quitter et transférer : le propriétaire reste tant qu’il n’a pas transféré', () => {
  assert.ok(!canLeave('owner'));
  for (const r of ['manager', ...LOWER]) assert.ok(canLeave(r), r);
  assert.ok(canTransferOwnership('owner', 'editor'));
  assert.ok(canTransferOwnership('owner', 'viewer'));
  assert.ok(!canTransferOwnership('owner', 'editor', {self: true}));
  assert.ok(!canTransferOwnership('owner', 'owner'));
  for (const r of ['manager', ...LOWER]) assert.ok(!canTransferOwnership(r, 'editor'), r);
});

test('explications des boutons indisponibles', () => {
  assert.equal(manageBlockReason('manager', 'editor'), null);
  assert.match(manageBlockReason('manager', 'manager'), /Seul le propriétaire gère un responsable/);
  assert.match(manageBlockReason('manager', 'owner'), /propriétaire/);
  assert.match(manageBlockReason('editor', 'viewer'), /ne permet pas/);
  assert.match(manageBlockReason('owner', 'owner', {self: true}), /transférez/);
  assert.match(teamPowerSentence('manager'), /collaborateurs/);
});

test('membres triés par grade puis adresse ; grade inconnu traité comme lecteur', () => {
  const sorted = sortMembers([
    {id: 'a', email: 'zoe@x.fr', role: 'viewer'}, {id: 'b', email: 'amy@x.fr', role: 'manager'},
    {id: 'c', email: 'bob@x.fr', role: 'owner'}, {id: 'd', email: 'abe@x.fr', role: 'bizarre'}, {id: 'e', email: 'eve@x.fr', role: 'manager'}
  ]);
  assert.deepEqual(sorted.map(m => m.id), ['c', 'b', 'e', 'd', 'a']);
});

test('dernière activité : appareil ou journal, la plus récente', () => {
  const last = lastActivityByUser({
    devices: [{userId: 'u1', lastSeen: 100}, {userId: 'u1', lastSeen: 300}, {userId: 'u2', lastSeen: 50}],
    activity: [{userId: 'u2', createdAt: 400}, {userId: '', createdAt: 999}]
  });
  assert.deepEqual(last, {u1: 300, u2: 400});
});

test('invitations en attente : expirées masquées, plus récentes d’abord', () => {
  const list = pendingInvites([{token: 'a', createdAt: 1, expiresAt: 2000}, {token: 'b', createdAt: 5, expiresAt: 3000}, {token: 'c', createdAt: 9, expiresAt: 500}], 1000);
  assert.deepEqual(list.map(i => i.token), ['b', 'a']);
});

test('journal d’équipe : seules les actions d’équipe, libellés en français', () => {
  const rows = teamJournal([
    {action: 'sign-in'}, {action: 'member-role', details: {role: 'operator'}}, {action: 'ownership-transfer', details: {role: 'owner'}},
    {action: 'invite-revoke'}, {action: 'member-leave'}, {action: 'update'}
  ]);
  assert.deepEqual(rows.map(r => r.label), ['Grade modifié', 'Propriété transférée', 'Invitation révoquée', 'A quitté l’exploitation']);
  assert.equal(rows[0].roleLabel, 'Opérateur terrain');
});

test('« Qui peut faire quoi » reflète permissions.js', () => {
  const {roles, rows} = permissionMatrix();
  assert.deepEqual(roles.map(r => r.role), ROLE_ORDER);
  const row = label => rows.find(r => r.label === label).cells;
  assert.equal(row('Parcelles').owner.value, 'yes');
  assert.equal(row('Parcelles').operator.value, 'no');
  assert.equal(row('Travaux et coûts').operator.value, 'yes');
  assert.equal(row('Stocks et produits').accountant.value, 'yes');
  assert.equal(row('Stocks et produits').operator.value, 'no');
  for (const label of rows.map(r => r.label).filter(l => l !== 'Consulter' && l !== 'Exporter, imprimer' && l !== 'Quitter l’exploitation'))
    assert.equal(row(label).viewer.value, 'no', label);
  assert.equal(row('Supprimer définitivement').manager.value, 'no');
  assert.equal(row('Supprimer définitivement').owner.value, 'yes');
  assert.equal(row('Inviter et gérer les membres').manager.value, 'partial');
  assert.equal(row('Inviter et gérer les membres').owner.value, 'yes');
  assert.equal(row('Inviter et gérer les membres').editor.value, 'no');
  assert.equal(row('Transférer la propriété').owner.value, 'yes');
  assert.equal(row('Quitter l’exploitation').owner.value, 'partial');
});

test('firestore.rules applique la même hiérarchie (responsable limité aux rangs inférieurs)', () => {
  const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /function lowerThanManager\(role\) \{ return role in \['editor','operator','accountant','viewer'\]; \}/);
  assert.match(rules, /me == 'manager' && !\(targetRole in \['owner','manager'\]\)/);
  assert.match(rules, /request\.auth\.uid == uid && isMember\(workspaceId\) && resource\.data\.role != 'owner'/);
  assert.ok(!/isOwner\(workspaceId\) && validRole\(request\.resource\.data\.role\)/.test(rules), 'plus de création directe de propriétaire');
});

test('nouveaux fichiers servis listés dans sw.js et runtime.js', () => {
  for (const f of ['sw.js', 'runtime.js']) {
    const src = readFileSync(new URL('./' + f, import.meta.url), 'utf8');
    assert.ok(src.includes("'./team-roles.js'") && src.includes("'./team-roles-ui.js'"), f);
  }
});

test('factures et ventes : comptabilité oui, opérateur terrain non ; capteurs : opérateur oui, comptabilité non', async () => {
  const {canMutate} = await import('./permissions.js');
  for (const farmKind of ['invoice', 'salesContract']) {
    assert.equal(canMutate('accountant', {entity: 'integrationImports', action: 'update', farmKind}), true);
    assert.equal(canMutate('operator', {entity: 'integrationImports', action: 'update', farmKind}), false);
    assert.equal(canMutate('operator', {entity: 'integrationImports', action: 'create', payload: {farmKind}}), false);
  }
  assert.equal(canMutate('operator', {entity: 'integrationImports', action: 'update', farmKind: 'sensor'}), true);
  assert.equal(canMutate('accountant', {entity: 'integrationImports', action: 'update', farmKind: 'sensor'}), false);
  assert.equal(canMutate('editor', {entity: 'integrationImports', action: 'update', farmKind: 'invoice'}), true);
});
