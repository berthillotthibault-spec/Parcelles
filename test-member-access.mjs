// n° 129 : accès limité dans le temps (memberExpiresAt sur le membre). Logique de team-roles.js, écritures de
// sync.js rejouées sur un faux Firestore, alignement avec firestore.rules / storage.rules (vérifiés à
// l'émulateur par tools/test-rules.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {accessActive, accessEndInput, accessLabel, canSetAccessEnd, parseAccessEnd, inviteShareText, teamJournal} from './team-roles.js';
import {SyncService} from './sync.js';

const DAY = 86400000;
const NOW = new Date(2026, 9, 27, 10, 0, 0).getTime();

test('fin d’accès : absente = illimité, future = active, passée = terminée', () => {
  assert.equal(accessActive({}, NOW), true);
  assert.equal(accessActive({memberExpiresAt: null}, NOW), true);
  assert.equal(accessActive({memberExpiresAt: NOW + DAY}, NOW), true);
  assert.equal(accessActive({memberExpiresAt: NOW - 1}, NOW), false);
  assert.equal(accessLabel({}, NOW), '');
  assert.match(accessLabel({memberExpiresAt: NOW + 3 * DAY}, NOW), /^Accès jusqu’au .*\(3 jours\)$/);
  assert.match(accessLabel({memberExpiresAt: NOW + 60 * DAY}, NOW), /^Accès jusqu’au [^(]+$/);
  assert.match(accessLabel({memberExpiresAt: NOW - DAY}, NOW), /^Accès terminé le /);
});

test('fin d’accès : saisie (fin de journée locale), erreurs en ligne, aller-retour du champ date', () => {
  assert.deepEqual(parseAccessEnd('', NOW), {value: null});
  const ok = parseAccessEnd('2026-11-30', NOW);
  assert.equal(ok.value, new Date(2026, 10, 30, 23, 59, 59).getTime());
  assert.equal(accessEndInput(ok.value), '2026-11-30');
  assert.equal(accessEndInput(null), '');
  assert.match(parseAccessEnd('2026-02-30', NOW).error, /valide/);
  assert.match(parseAccessEnd('30/11/2026', NOW).error, /valide/);
  assert.match(parseAccessEnd('2026-10-01', NOW).error, /futur/);
  assert.match(parseAccessEnd('2030-01-01', NOW).error, /3 ans/);
  // Aujourd'hui reste valide jusqu'à minuit.
  assert.ok(parseAccessEnd('2026-10-27', NOW).value > NOW);
});

test('fin d’accès : qui peut la changer (mêmes règles que le grade)', () => {
  assert.ok(canSetAccessEnd('owner', 'advisor'));
  assert.ok(canSetAccessEnd('owner', 'manager'));
  assert.ok(canSetAccessEnd('manager', 'viewer'));
  assert.ok(!canSetAccessEnd('manager', 'manager'));
  assert.ok(!canSetAccessEnd('owner', 'owner'));
  assert.ok(!canSetAccessEnd('owner', 'editor', {self: true}));
  for (const r of ['editor', 'operator', 'accountant', 'advisor', 'viewer']) assert.ok(!canSetAccessEnd(r, 'viewer'));
  assert.match(inviteShareText({role: 'advisor', expiresAt: NOW + 7 * DAY, memberExpiresAt: NOW + 30 * DAY}, 'Ferme'), /Accès jusqu’au/);
  assert.doesNotMatch(inviteShareText({role: 'advisor'}, 'Ferme'), /Accès jusqu’au/);
  assert.equal(teamJournal([{action: 'member-access-end'}])[0].label, 'Fin d’accès modifiée');
});

// Faux Firestore : collections et documents imbriqués, lots, set {merge}, FieldValue.delete().
const DELETE = Symbol('delete');
function fakeFirestore() {
  const docs = new Map(), writes = [];
  const apply = (path, data, merge) => {
    const next = merge ? {...(docs.get(path) || {})} : {};
    for (const [k, v] of Object.entries(data)) { if (v === DELETE) delete next[k]; else next[k] = v; }
    docs.set(path, next); writes.push({path, data});
  };
  const docRef = path => ({
    id: path.split('/').pop(), path,
    collection: name => colRef(`${path}/${name}`),
    get: async () => ({exists: docs.has(path), id: path.split('/').pop(), data: () => ({...docs.get(path)})}),
    set: async (data, opts = {}) => apply(path, data, opts.merge)
  });
  const colRef = path => ({doc: id => docRef(`${path}/${id}`), add: async data => apply(`${path}/${Math.random()}`, data, false)});
  const db = {
    collection: name => colRef(name),
    batch: () => { const ops = []; return {set: (ref, data, opts = {}) => ops.push(() => apply(ref.path, data, opts.merge)), update: (ref, data) => ops.push(() => apply(ref.path, data, true)), delete: ref => ops.push(() => docs.delete(ref.path)), commit: async () => ops.forEach(op => op())}; }
  };
  return {db, docs, writes};
}
function service({uid = 'owner', email = 'owner@ex.fr', role = 'owner'} = {}) {
  const fake = fakeFirestore();
  const prefs = {workspaceId: 'w1', syncEnabled: true, cloudRole: role, securityAuditEnabled: true};
  const store = {state: {preferences: prefs, metadata: {}}, snapshot() { return this.state; }, setPreferences: async p => Object.assign(prefs, p), switchWorkspace: async () => {}};
  const sync = new SyncService(store);
  sync.db = fake.db; sync.user = {uid, email}; sync.status = {configured: true, connected: true};
  sync.member = {id: uid, role}; sync.firebase = {firestore: {FieldValue: {delete: () => DELETE, serverTimestamp: () => null}}};
  sync.heartbeat = async () => {};
  return {sync, fake, store};
}

test('sync : invitation avec fin d’accès recopiée exactement sur le membre à l’acceptation', async () => {
  const {sync, fake} = service();
  const end = Date.now() + 30 * DAY;
  await assert.rejects(sync.createInvite('a@ex.fr', 'advisor', {memberExpiresAt: Date.now() - DAY}), /invalide/);
  await assert.rejects(sync.createInvite('a@ex.fr', 'advisor', {memberExpiresAt: Date.now() + 2000 * DAY}), /invalide/);
  const invite = await sync.createInvite('guest@ex.fr', 'advisor', {memberExpiresAt: end});
  assert.equal(invite.memberExpiresAt, end);
  const plain = await sync.createInvite('other@ex.fr', 'viewer');
  assert.equal('memberExpiresAt' in plain, false);
  const guest = service({uid: 'guest', email: 'guest@ex.fr', role: 'viewer'});
  guest.sync.db = fake.db;
  guest.sync.refreshMembership = async () => {};
  await guest.sync.acceptInvite(invite.token);
  assert.equal(fake.docs.get('workspaces/w1/members/guest').memberExpiresAt, end);
  assert.equal(fake.docs.has(`invites/${invite.token}`), false);
});

test('sync : poser, retirer la fin d’accès ; propriétaire et soi exclus ; pas de transfert vers un membre limité', async () => {
  const {sync, fake} = service();
  fake.docs.set('workspaces/w1/members/adv', {uid: 'adv', email: 'adv@ex.fr', role: 'advisor', joinedAt: 1});
  fake.docs.set('workspaces/w1/members/owner2', {uid: 'owner2', role: 'owner'});
  const end = Date.now() + 10 * DAY;
  await sync.updateMemberAccessEnd('adv', end);
  assert.equal(fake.docs.get('workspaces/w1/members/adv').memberExpiresAt, end);
  assert.equal(fake.docs.get('workspaces/w1/members/adv').updatedBy, 'owner');
  await assert.rejects(sync.transferOwnership('adv', 'adv@ex.fr'), /fin d’accès/);
  await sync.updateMemberAccessEnd('adv', null);
  assert.equal('memberExpiresAt' in fake.docs.get('workspaces/w1/members/adv'), false);
  await assert.rejects(sync.updateMemberAccessEnd('owner', end), /propre accès/);
  await assert.rejects(sync.updateMemberAccessEnd('owner2', end), /grade/);
  await assert.rejects(sync.updateMemberAccessEnd('adv', Date.now() - DAY), /invalide/);
  const ed = service({uid: 'ed', email: 'ed@ex.fr', role: 'editor'});
  ed.sync.db = fake.db;
  await assert.rejects(ed.sync.updateMemberAccessEnd('adv', end), /grade/);
  assert.ok(fake.writes.some(w => w.data.action === 'member-access-end'));
});

test('sync : accès terminé, message clair sans lire l’exploitation', async () => {
  const {sync, fake} = service({uid: 'adv', email: 'adv@ex.fr', role: 'advisor'});
  fake.docs.set('workspaces/w1/members/adv', {uid: 'adv', role: 'advisor', memberExpiresAt: Date.now() - DAY});
  await sync.refreshMembership();
  assert.equal(sync.member, null);
  assert.equal(sync.status.connected, false);
  assert.equal(sync.status.accessEnded, true);
  assert.match(sync.status.message, /Accès terminé le .*prolonger/);
  fake.docs.set('workspaces/w1', {name: 'Ferme', ownerUid: 'owner'});
  fake.docs.set('workspaces/w1/members/adv', {uid: 'adv', role: 'advisor', memberExpiresAt: Date.now() + DAY});
  await sync.refreshMembership();
  assert.equal(sync.member.role, 'advisor');
  assert.equal(sync.status.connected, true);
});

test('règles : contrôle par request.time dans isMember (Firestore et Storage), membres existants inchangés', () => {
  const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
  const storage = readFileSync(new URL('./storage.rules', import.meta.url), 'utf8');
  assert.match(rules, /function accessActive\(m\) \{ return m\.get\('memberExpiresAt', null\) == null \|\| m\.memberExpiresAt > request\.time\.toMillis\(\); \}/);
  assert.match(rules, /function isMember\(workspaceId\) \{[^}]*accessActive\(get\(memberPath/);
  assert.match(rules, /hasOnly\(\['uid','email','role','joinedAt','inviteToken','memberExpiresAt'\]\)/);
  assert.match(rules, /hasOnly\(\['memberExpiresAt','updatedAt','updatedBy'\]\)/);
  assert.match(rules, /resource\.data\.get\('memberExpiresAt', null\) == null\s*&& request\.resource\.data\.role == 'owner'/);
  assert.match(storage, /firestore\.get\(memberPath\(workspaceId\)\)\.data\.get\('memberExpiresAt', null\) == null/);
  assert.match(storage, /memberExpiresAt > request\.time\.toMillis\(\)/);
  const cases = readFileSync(new URL('./tools/test-rules.mjs', import.meta.url), 'utf8');
  assert.match(cases, /accès limité : membre sans date \(existant\) illimité/);
});
