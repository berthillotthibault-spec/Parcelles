// Tests des règles Firestore (firestore.rules) contre l'émulateur Firebase.
// Outil de développement uniquement : il n'est PAS lancé par `npm test` (la CI n'a pas d'émulateur).
//
// Prérequis (hors projet, rien n'est ajouté à package.json) :
//   - Java 11+ (par exemple un JDK Temurin portable) ;
//   - firebase-tools, @firebase/rules-unit-testing et firebase installés dans un dossier d'outils,
//     désigné par la variable RULES_TOOLS_DIR (sinon résolution normale depuis le projet).
//
// Lancement :
//   RULES_TOOLS_DIR=/chemin/outils JAVA_HOME=/chemin/jdk \
//     /chemin/outils/node_modules/.bin/firebase emulators:exec --only firestore,storage --project demo-parcelles \
//     "node --test tools/test-rules.mjs"
//
// Si le port 8080 est pris, passer un firebase.json temporaire via --config avec
// "emulators": {"firestore": {"port": 8095}, "storage": {"port": 9195}}. RULES_FILE / STORAGE_RULES_FILE
// permettent de tester une autre version des règles. Sans émulateur Storage (--only firestore),
// les tests storage.rules sont ignorés.
//
// Chaque écriture légitime de sync.js (createWorkspace, acceptInvite, createInvite, updateMemberRole,
// removeMember, leaveWorkspace, transferOwnership, listInvites, revokeInvite, writeRemoteEntity/bootstrap/auto-merge/restauration/pièce jointe, heartbeat, audit)
// est rejouée ici avec la même forme de données, ainsi que le dépôt des pièces jointes (syncAttachments).
import {test, before, after, beforeEach} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function load(name) {
  if (!process.env.RULES_TOOLS_DIR) return import(name);
  const req = createRequire(path.join(process.env.RULES_TOOLS_DIR, 'package.json'));
  return import(pathToFileURL(req.resolve(name)).href);
}
const {initializeTestEnvironment, assertSucceeds, assertFails} = await load('@firebase/rules-unit-testing');
const fs = await load('firebase/firestore');
const {doc, setDoc, getDoc, deleteDoc, updateDoc, writeBatch, collection, addDoc, serverTimestamp, Timestamp, query, where, getDocs} = fs;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const st = storageHost ? await load('firebase/storage') : null;

const DAY = 86400000;
const WS = 'ws1';
let env;

before(async () => {
  const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-parcelles',
    firestore: {rules: readFileSync(process.env.RULES_FILE || path.join(root, 'firestore.rules'), 'utf8'), host, port: Number(port)},
    ...(storageHost ? {storage: {
      rules: readFileSync(process.env.STORAGE_RULES_FILE || path.join(root, 'storage.rules'), 'utf8'),
      host: storageHost.split(':')[0], port: Number(storageHost.split(':')[1])
    }} : {})
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'workspaces', WS), {name: 'Ferme', ownerUid: 'owner', createdAt: 1, updatedAt: 1});
    await setDoc(doc(db, 'workspaces', WS, 'members', 'owner'), {uid: 'owner', email: 'owner@ex.fr', role: 'owner', joinedAt: 1, displayName: ''});
    await setDoc(doc(db, 'workspaces', WS, 'members', 'ed'), {uid: 'ed', email: 'ed@ex.fr', role: 'editor', joinedAt: 1, inviteToken: 'old'});
    await setDoc(doc(db, 'workspaces', WS, 'members', 'vw'), {uid: 'vw', email: 'vw@ex.fr', role: 'viewer', joinedAt: 1, inviteToken: 'old2'});
    for (const [uid, role] of [['mg', 'manager'], ['op', 'operator'], ['ac', 'accountant']])
      await setDoc(doc(db, 'workspaces', WS, 'members', uid), {uid, email: uid + '@ex.fr', role, joinedAt: 1, inviteToken: 'old-' + uid});
    const invite = role => ({workspaceId: WS, workspaceName: 'Ferme', email: 'guest@ex.fr', role, createdBy: 'owner', createdAt: Date.now(), expiresAt: Date.now() + 7 * DAY});
    await setDoc(doc(db, 'invites', 'tokViewer'), invite('viewer'));
    await setDoc(doc(db, 'invites', 'tokManager'), invite('manager'));
    await setDoc(doc(db, 'invites', 'tokExpired'), {...invite('editor'), expiresAt: Date.now() - DAY});
  });
});

const as = (uid, email) => env.authenticatedContext(uid, email ? {email} : {}).firestore();
const guest = () => as('guest', 'guest@ex.fr');

// Rejoue acceptInvite (sync.js) avec des variantes malveillantes possibles.
function acceptBatch(db, token, {role, extra = {}, uid = 'guest', deleteInvite = true, invitedRole} = {}) {
  const b = writeBatch(db);
  b.set(doc(db, 'workspaces', WS, 'members', 'guest'), {uid, email: 'guest@ex.fr', role, joinedAt: Date.now(), inviteToken: token, ...extra});
  b.set(doc(db, 'users', 'guest', 'workspaces', WS), {workspaceId: WS, name: 'Ferme', role: invitedRole || role, updatedAt: Date.now()});
  if (deleteInvite) b.delete(doc(db, 'invites', token));
  return b.commit();
}

// --- acceptInvite ---
test('invitation : acceptInvite légitime (viewer) passe et consomme l’invitation', async () => {
  const db = guest();
  await assertSucceeds(getDoc(doc(db, 'invites', 'tokViewer')));
  await assertSucceeds(acceptBatch(db, 'tokViewer', {role: 'viewer'}));
  await assertSucceeds(getDoc(doc(db, 'workspaces', WS, 'members', 'guest')));
});
test('invitation : acceptInvite légitime (manager) passe', async () => {
  await assertSucceeds(acceptBatch(guest(), 'tokManager', {role: 'manager'}));
});
test('FAILLE : un invité viewer ne peut pas se donner le rôle owner', async () => {
  await assertFails(acceptBatch(guest(), 'tokViewer', {role: 'owner'}));
});
test('FAILLE : un invité viewer ne peut pas se donner un autre rôle (editor, manager)', async () => {
  await assertFails(acceptBatch(guest(), 'tokViewer', {role: 'editor'}));
  await assertFails(acceptBatch(guest(), 'tokViewer', {role: 'manager'}));
});
test('invitation : clés supplémentaires refusées', async () => {
  await assertFails(acceptBatch(guest(), 'tokViewer', {role: 'viewer', extra: {displayName: 'x', admin: true}}));
});
test('invitation : champ uid différent de l’identifiant authentifié refusé', async () => {
  await assertFails(acceptBatch(guest(), 'tokViewer', {role: 'viewer', uid: 'owner'}));
});
test('invitation : usage unique, le document membre exige la suppression de l’invitation dans le même lot', async () => {
  await assertFails(acceptBatch(guest(), 'tokViewer', {role: 'viewer', deleteInvite: false}));
});
test('invitation : impossible de réutiliser une invitation déjà consommée', async () => {
  await assertSucceeds(acceptBatch(guest(), 'tokViewer', {role: 'viewer'}));
  await env.withSecurityRulesDisabled(ctx => deleteDoc(doc(ctx.firestore(), 'workspaces', WS, 'members', 'guest')));
  await assertFails(acceptBatch(guest(), 'tokViewer', {role: 'viewer'}));
});
test('invitation : autre adresse email refusée', async () => {
  const db = as('intrus', 'intrus@ex.fr');
  const b = writeBatch(db);
  b.set(doc(db, 'workspaces', WS, 'members', 'intrus'), {uid: 'intrus', email: 'intrus@ex.fr', role: 'viewer', joinedAt: 1, inviteToken: 'tokViewer'});
  await assertFails(b.commit());
});
test('invitation : invitation expirée refusée', async () => {
  await assertFails(acceptBatch(guest(), 'tokExpired', {role: 'editor'}));
});
test('invitation : un invité ne peut pas créer le document membre d’un autre', async () => {
  const db = guest();
  const b = writeBatch(db);
  b.set(doc(db, 'workspaces', WS, 'members', 'autre'), {uid: 'autre', email: 'guest@ex.fr', role: 'viewer', joinedAt: 1, inviteToken: 'tokViewer'});
  b.delete(doc(db, 'invites', 'tokViewer'));
  await assertFails(b.commit());
});

// --- createWorkspace (branche créateur) ---
function createWorkspaceBatch(db, uid, id, memberData) {
  const b = writeBatch(db);
  b.set(doc(db, 'workspaces', id), {name: 'Neuve', ownerUid: uid, createdAt: 1, updatedAt: 1});
  b.set(doc(db, 'workspaces', id, 'members', uid), memberData);
  b.set(doc(db, 'users', uid, 'workspaces', id), {workspaceId: id, name: 'Neuve', role: 'owner', updatedAt: 1});
  return b.commit();
}
test('createWorkspace légitime passe', async () => {
  await assertSucceeds(createWorkspaceBatch(as('alice', 'alice@ex.fr'), 'alice', 'wsA', {uid: 'alice', email: 'alice@ex.fr', role: 'owner', joinedAt: 1, displayName: 'Alice'}));
});
test('createWorkspace : rôle autre que owner ou clés en trop refusés', async () => {
  await assertFails(createWorkspaceBatch(as('alice', 'alice@ex.fr'), 'alice', 'wsB', {uid: 'alice', email: 'alice@ex.fr', role: 'superadmin', joinedAt: 1, displayName: ''}));
  await assertFails(createWorkspaceBatch(as('alice', 'alice@ex.fr'), 'alice', 'wsC', {uid: 'alice', email: 'alice@ex.fr', role: 'owner', joinedAt: 1, displayName: '', admin: true}));
});
test('branche créateur : un non-propriétaire ne peut pas s’ajouter owner à une exploitation existante', async () => {
  const db = as('mallory', 'm@ex.fr');
  await assertFails(setDoc(doc(db, 'workspaces', WS, 'members', 'mallory'), {uid: 'mallory', email: 'm@ex.fr', role: 'owner', joinedAt: 1, displayName: ''}));
});

// --- gestion par le propriétaire ---
test('propriétaire : ajout direct d’un membre avec un rôle connu, rôle inconnu refusé', async () => {
  const db = as('owner', 'owner@ex.fr');
  await assertSucceeds(setDoc(doc(db, 'workspaces', WS, 'members', 'bob'), {uid: 'bob', role: 'operator', joinedAt: 1}));
  await assertFails(setDoc(doc(db, 'workspaces', WS, 'members', 'carl'), {uid: 'carl', role: 'superadmin', joinedAt: 1}));
});
test('propriétaire : updateMemberRole (set merge) passe, rôle inconnu refusé', async () => {
  const db = as('owner', 'owner@ex.fr');
  await assertSucceeds(setDoc(doc(db, 'workspaces', WS, 'members', 'ed'), {role: 'accountant', updatedAt: 1}, {merge: true}));
  await assertFails(setDoc(doc(db, 'workspaces', WS, 'members', 'ed'), {role: 'dieu', updatedAt: 1}, {merge: true}));
});
test('propriétaire : removeMember passe ; un éditeur ne peut ni modifier ni retirer un membre', async () => {
  await assertFails(setDoc(doc(as('ed', 'ed@ex.fr'), 'workspaces', WS, 'members', 'ed'), {role: 'owner'}, {merge: true}));
  await assertFails(deleteDoc(doc(as('ed', 'ed@ex.fr'), 'workspaces', WS, 'members', 'vw')));
  await assertSucceeds(deleteDoc(doc(as('owner', 'owner@ex.fr'), 'workspaces', WS, 'members', 'vw')));
});

// --- createInvite ---
const inviteData = (over = {}) => ({workspaceId: WS, workspaceName: 'Ferme', email: 'new@ex.fr', role: 'editor', createdBy: 'owner', createdAt: Date.now(), expiresAt: Date.now() + 7 * DAY, ...over});
test('createInvite légitime passe (tous les rôles attribuables)', async () => {
  const db = as('owner', 'owner@ex.fr');
  for (const role of ['manager', 'editor', 'operator', 'accountant', 'viewer']) {
    await assertSucceeds(setDoc(doc(db, 'invites', 'n' + role), inviteData({role})));
  }
});
test('createInvite : rôle owner, durée excessive, auteur usurpé ou non-propriétaire refusés', async () => {
  const db = as('owner', 'owner@ex.fr');
  await assertFails(setDoc(doc(db, 'invites', 'x1'), inviteData({role: 'owner'})));
  await assertFails(setDoc(doc(db, 'invites', 'x2'), inviteData({expiresAt: Date.now() + 365 * DAY})));
  await assertFails(setDoc(doc(db, 'invites', 'x3'), inviteData({createdBy: 'ed'})));
  await assertFails(setDoc(doc(as('ed', 'ed@ex.fr'), 'invites', 'x4'), inviteData({createdBy: 'ed'})));
});
test('invitation : le propriétaire peut révoquer, l’invité peut lire la sienne, un tiers non', async () => {
  await assertFails(getDoc(doc(as('intrus', 'intrus@ex.fr'), 'invites', 'tokViewer')));
  await assertSucceeds(deleteDoc(doc(as('owner', 'owner@ex.fr'), 'invites', 'tokViewer')));
});

// --- Équipe et autorisations : gestion par grade (team-roles.js / sync.js) ---
// Les tests marqués « NOUVEAU » décrivent une capacité ajoutée (refusée par les anciennes règles) ;
// les autres vérifient qu'aucune escalade n'est possible.
const mgDb = () => as('mg', 'mg@ex.fr');
const ownerDb = () => as('owner', 'owner@ex.fr');
const memberRef = (db, uid) => doc(db, 'workspaces', WS, 'members', uid);
// Rejoue updateMemberRole (sync.js).
const setRole = (db, uid, role, by = 'x') => setDoc(memberRef(db, uid), {role, updatedAt: Date.now(), updatedBy: by}, {merge: true});
// Rejoue transferOwnership (sync.js) avec des variantes malveillantes possibles.
function transferBatch(db, from, to, {ws = true, promote = true, demote = true, demoteTo = 'manager'} = {}) {
  const b = writeBatch(db);
  if (ws) b.update(doc(db, 'workspaces', WS), {ownerUid: to, updatedAt: Date.now()});
  if (promote) b.set(memberRef(db, to), {role: 'owner', updatedAt: Date.now(), updatedBy: from}, {merge: true});
  if (demote) b.set(memberRef(db, from), {role: demoteTo, updatedAt: Date.now(), updatedBy: from}, {merge: true});
  return b.commit();
}
async function seedMember(uid, role) {
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'workspaces', WS, 'members', uid), {uid, email: uid + '@ex.fr', role, joinedAt: 1, inviteToken: 'old-' + uid}));
}

test('NOUVEAU responsable : invite à un grade inférieur (collaborateur, opérateur, comptabilité, lecteur)', async () => {
  for (const role of ['editor', 'operator', 'accountant', 'viewer'])
    await assertSucceeds(setDoc(doc(mgDb(), 'invites', 'm' + role), inviteData({role, createdBy: 'mg'})));
});
test('ESCALADE responsable : invitation responsable ou propriétaire refusée, auteur usurpé refusé', async () => {
  await assertFails(setDoc(doc(mgDb(), 'invites', 'm1'), inviteData({role: 'manager', createdBy: 'mg'})));
  await assertFails(setDoc(doc(mgDb(), 'invites', 'm2'), inviteData({role: 'owner', createdBy: 'mg'})));
  await assertFails(setDoc(doc(mgDb(), 'invites', 'm3'), inviteData({role: 'viewer', createdBy: 'owner'})));
});
test('ESCALADE : collaborateur, opérateur, comptabilité et lecteur ne peuvent pas inviter', async () => {
  for (const uid of ['ed', 'op', 'ac', 'vw'])
    await assertFails(setDoc(doc(as(uid, uid + '@ex.fr'), 'invites', 'i' + uid), inviteData({role: 'viewer', createdBy: uid})));
});
test('NOUVEAU responsable : change le grade d’un rang inférieur vers un rang inférieur', async () => {
  await assertSucceeds(setRole(mgDb(), 'ed', 'operator', 'mg'));
  await assertSucceeds(setRole(mgDb(), 'vw', 'editor', 'mg'));
  await assertSucceeds(setRole(mgDb(), 'ac', 'viewer', 'mg'));
});
test('ESCALADE responsable : ne peut promouvoir personne responsable ou propriétaire', async () => {
  await assertFails(setRole(mgDb(), 'ed', 'manager', 'mg'));
  await assertFails(setRole(mgDb(), 'vw', 'owner', 'mg'));
  await assertFails(setRole(mgDb(), 'op', 'superadmin', 'mg'));
});
test('ESCALADE responsable : ne peut ni modifier ni retirer le propriétaire ou un autre responsable', async () => {
  await seedMember('mg2', 'manager');
  await assertFails(setRole(mgDb(), 'owner', 'viewer', 'mg'));
  await assertFails(setRole(mgDb(), 'mg2', 'viewer', 'mg'));
  await assertFails(deleteDoc(memberRef(mgDb(), 'owner')));
  await assertFails(deleteDoc(memberRef(mgDb(), 'mg2')));
});
test('NOUVEAU responsable : retire un membre de rang inférieur', async () => {
  for (const uid of ['ed', 'op', 'ac', 'vw']) await assertSucceeds(deleteDoc(memberRef(mgDb(), uid)));
});
test('ESCALADE : un membre ne peut pas modifier son propre grade', async () => {
  await assertFails(setRole(as('ed', 'ed@ex.fr'), 'ed', 'manager', 'ed'));
  await assertFails(setRole(as('vw', 'vw@ex.fr'), 'vw', 'editor', 'vw'));
  await assertFails(setRole(mgDb(), 'mg', 'owner', 'mg'));
  await assertFails(setRole(mgDb(), 'mg', 'viewer', 'mg'));
  await assertFails(setRole(ownerDb(), 'owner', 'manager', 'owner'));
});
test('ESCALADE : collaborateur et opérateur ne gèrent personne', async () => {
  await assertFails(setRole(as('ed', 'ed@ex.fr'), 'vw', 'viewer', 'ed'));
  await assertFails(deleteDoc(memberRef(as('op', 'op@ex.fr'), 'vw')));
  await assertFails(setDoc(memberRef(as('ed', 'ed@ex.fr'), 'bob'), {uid: 'bob', role: 'viewer', joinedAt: 1}));
});
test('ESCALADE : changement de grade limité au rôle (adresse, uid, jeton intouchables)', async () => {
  await assertFails(setDoc(memberRef(mgDb(), 'ed'), {role: 'viewer', email: 'pirate@ex.fr'}, {merge: true}));
  await assertFails(setDoc(memberRef(ownerDb(), 'ed'), {role: 'viewer', uid: 'owner'}, {merge: true}));
});
test('NOUVEAU : chacun peut quitter l’exploitation, sauf le propriétaire', async () => {
  for (const uid of ['mg', 'ed', 'op', 'ac', 'vw']) await assertSucceeds(deleteDoc(memberRef(as(uid, uid + '@ex.fr'), uid)));
  await assertFails(deleteDoc(memberRef(ownerDb(), 'owner')));
});
test('ESCALADE propriétaire : pas de second propriétaire hors transfert', async () => {
  await assertFails(setRole(ownerDb(), 'ed', 'owner', 'owner'));
  await assertFails(setDoc(memberRef(ownerDb(), 'bob'), {uid: 'bob', role: 'owner', joinedAt: 1}));
  await assertSucceeds(setRole(ownerDb(), 'mg', 'editor', 'owner'));
});
test('NOUVEAU : transfert de propriété atomique vers un membre existant', async () => {
  await assertSucceeds(transferBatch(ownerDb(), 'owner', 'ed'));
  let after;
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    after = {
      ws: (await getDoc(doc(db, 'workspaces', WS))).data().ownerUid,
      ed: (await getDoc(memberRef(db, 'ed'))).data().role,
      old: (await getDoc(memberRef(db, 'owner'))).data().role
    };
  });
  if (after.ws !== 'ed' || after.ed !== 'owner' || after.old !== 'manager') throw new Error('Transfert incomplet : ' + JSON.stringify(after));
  // Le nouveau propriétaire gère désormais l'ancien.
  await assertSucceeds(setRole(as('ed', 'ed@ex.fr'), 'owner', 'editor', 'ed'));
});
test('ESCALADE transfert : non-propriétaire, lot partiel ou cible non membre refusés', async () => {
  await assertFails(transferBatch(mgDb(), 'mg', 'mg', {demote: false}));
  await assertFails(transferBatch(mgDb(), 'owner', 'ed'));
  await assertFails(transferBatch(ownerDb(), 'owner', 'ed', {demote: false}));
  await assertFails(transferBatch(ownerDb(), 'owner', 'ed', {promote: false}));
  await assertFails(transferBatch(ownerDb(), 'owner', 'ed', {ws: false}));
  await assertFails(transferBatch(ownerDb(), 'owner', 'ed', {demoteTo: 'viewer'}));
  await assertFails(transferBatch(ownerDb(), 'owner', 'inconnu'));
  // Le propriétaire ne peut pas se rétrograder seul (exploitation sans propriétaire).
  await assertFails(setRole(ownerDb(), 'owner', 'manager', 'owner'));
  await assertFails(updateDoc(doc(ownerDb(), 'workspaces', WS), {ownerUid: 'ed'}));
});
test('NOUVEAU invitations en attente : propriétaire et responsable les listent, pas un collaborateur', async () => {
  const q = db => getDocs(query(collection(db, 'invites'), where('workspaceId', '==', WS)));
  await assertSucceeds(q(ownerDb()));
  await assertSucceeds(q(mgDb()));
  await assertFails(q(as('ed', 'ed@ex.fr')));
  await assertFails(getDoc(doc(as('ed', 'ed@ex.fr'), 'invites', 'tokViewer')));
});
test('NOUVEAU révocation : le responsable révoque une invitation de rang inférieur, pas celle d’un responsable', async () => {
  await assertSucceeds(deleteDoc(doc(mgDb(), 'invites', 'tokViewer')));
  await assertFails(deleteDoc(doc(mgDb(), 'invites', 'tokManager')));
  await assertFails(deleteDoc(doc(as('ed', 'ed@ex.fr'), 'invites', 'tokExpired')));
  await assertSucceeds(deleteDoc(doc(ownerDb(), 'invites', 'tokManager')));
});
test('NOUVEAU invitation d’un responsable acceptée ; refusée si l’auteur a été rétrogradé entre-temps', async () => {
  await assertSucceeds(setDoc(doc(mgDb(), 'invites', 'tokMg'), inviteData({role: 'operator', createdBy: 'mg', email: 'guest@ex.fr'})));
  await assertSucceeds(setDoc(doc(mgDb(), 'invites', 'tokMg2'), inviteData({role: 'viewer', createdBy: 'mg', email: 'guest@ex.fr'})));
  await assertSucceeds(acceptBatch(guest(), 'tokMg', {role: 'operator'}));
  await env.withSecurityRulesDisabled(ctx => deleteDoc(doc(ctx.firestore(), 'workspaces', WS, 'members', 'guest')));
  await assertSucceeds(setRole(ownerDb(), 'mg', 'editor', 'owner'));
  await assertFails(acceptBatch(guest(), 'tokMg2', {role: 'viewer'}));
});

// --- non-régression des autres écritures de sync.js ---
test('données, appareils et journal : écritures légitimes inchangées', async () => {
  const ed = as('ed', 'ed@ex.fr'), vw = as('vw', 'vw@ex.fr');
  const entity = {entityType: 'parcels', entityId: 'p1', payload: {id: 'p1'}, payloadEncoding: 'nested-arrays-v1', version: 1, updatedAt: 1, deletedAt: null, modifiedBy: 'ed', modifiedEmail: 'ed@ex.fr', deviceId: 'd', build: 'b', action: 'bootstrap'};
  await assertSucceeds(setDoc(doc(ed, 'workspaces', WS, 'data', 'parcels__p1'), entity));
  await assertFails(setDoc(doc(vw, 'workspaces', WS, 'data', 'parcels__p1'), {...entity, modifiedBy: 'vw'}));
  await assertSucceeds(setDoc(doc(vw, 'workspaces', WS, 'devices', 'dev1'), {deviceId: 'dev1', name: 'Tel', userId: 'vw', email: 'vw@ex.fr', lastSeen: 1, build: 'b', userAgent: 'x'}, {merge: true}));
  await assertSucceeds(addDoc(collection(vw, 'workspaces', WS, 'audit'), {action: 'invite-accept', entity: 'member', entityId: 'vw', userId: 'vw', email: 'vw@ex.fr', deviceId: '', build: 'b', details: null, createdAt: 1}));
  await assertSucceeds(getDoc(doc(vw, 'workspaces', WS)));
});

// --- /data/{docId} : writeRemoteEntity (sync.js) ---
// Même forme que writeRemoteEntity : set complet (merge:false), identifiant `${entityType}__${entityId}`.
const remoteDoc = (uid, over = {}) => ({
  entityType: 'interventions', entityId: 'w1', payload: {id: 'w1', type: 'Fauche', geometry: {__parcellesNestedArray: '[[1,2]]'}, version: 2, updatedAt: 5},
  payloadEncoding: 'nested-arrays-v1', version: 2, updatedAt: 5, deletedAt: null,
  modifiedBy: uid, modifiedEmail: uid + '@ex.fr', deviceId: 'dev-' + uid, build: '2026.10.07-v10.10.9', action: 'update', ...over
});
const dataRef = (db, id = 'interventions__w1') => doc(db, 'workspaces', WS, 'data', id);
async function seedData(over = {}) {
  await env.withSecurityRulesDisabled(ctx => setDoc(dataRef(ctx.firestore()), remoteDoc('owner', over)));
}

test('données : création, mise à jour, auto-merge, restauration, suppression logique et pièce jointe passent', async () => {
  const ed = as('ed', 'ed@ex.fr');
  for (const action of ['create', 'update', 'auto-merge', 'restore', 'attachment', 'bootstrap']) {
    await assertSucceeds(setDoc(dataRef(ed), remoteDoc('ed', {action}), {merge: false}));
  }
  // Suppression logique : l'application écrit deletedAt (jamais de suppression en dur).
  await assertSucceeds(setDoc(dataRef(ed), remoteDoc('ed', {action: 'delete', deletedAt: 9, updatedAt: 9})));
  // Propriétaire, entité sans payload (clean(undefined) → null), ancien format sans payloadEncoding, email vide.
  const own = as('owner', 'owner@ex.fr');
  await assertSucceeds(setDoc(dataRef(own, 'farm__f1'), remoteDoc('owner', {entityType: 'farm', entityId: 'f1', payload: null})));
  const {payloadEncoding, ...legacy} = remoteDoc('owner', {modifiedEmail: ''});
  await assertSucceeds(setDoc(dataRef(own), legacy));
  // Identifiant numérique hérité d'une vieille sauvegarde.
  await assertSucceeds(setDoc(dataRef(own, 'parcels__12'), remoteDoc('owner', {entityType: 'parcels', entityId: 12})));
  // Heure serveur (point 7) : FieldValue.serverTimestamp(), comme writeRemoteEntity.
  await assertSucceeds(setDoc(dataRef(own), {...remoteDoc('owner'), serverUpdatedAt: serverTimestamp()}));
  await assertSucceeds(setDoc(dataRef(ed), {...remoteDoc('ed', {action: 'auto-merge'}), serverUpdatedAt: serverTimestamp()}, {merge: false}));
});
test('données : serverUpdatedAt forgé (nombre, date future ou passée) refusé, il empoisonnerait les curseurs', async () => {
  const ed = as('ed', 'ed@ex.fr');
  await assertFails(setDoc(dataRef(ed), {...remoteDoc('ed'), serverUpdatedAt: 1}));
  await assertFails(setDoc(dataRef(ed), {...remoteDoc('ed'), serverUpdatedAt: Timestamp.fromMillis(Date.now() + 365 * DAY)}));
  await assertFails(setDoc(dataRef(ed), {...remoteDoc('ed'), serverUpdatedAt: Timestamp.fromMillis(Date.now() - 600000)}));
});
test('heartbeat avec heure serveur (mesure du décalage d’horloge) puis relecture', async () => {
  const ed = as('ed', 'ed@ex.fr'), ref = doc(ed, 'workspaces', WS, 'devices', 'dev-ed');
  await assertSucceeds(setDoc(ref, {deviceId: 'dev-ed', name: 'Tel', userId: 'ed', email: 'ed@ex.fr', lastSeen: Date.now(), build: 'b', userAgent: 'x', serverSeenAt: serverTimestamp()}, {merge: true}));
  await assertSucceeds(getDoc(ref));
});
test('données : modifiedBy doit être l’auteur authentifié', async () => {
  await assertFails(setDoc(dataRef(as('ed', 'ed@ex.fr')), remoteDoc('owner')));
  await seedData();
  await assertFails(setDoc(dataRef(as('ed', 'ed@ex.fr')), remoteDoc('vw')));
});
test('données : identifiant du document incohérent avec entityType/entityId refusé', async () => {
  const ed = as('ed', 'ed@ex.fr');
  await assertFails(setDoc(dataRef(ed, 'interventions__autre'), remoteDoc('ed')));
  await assertFails(setDoc(dataRef(ed, 'parcels__w1'), remoteDoc('ed')));
  await assertFails(setDoc(dataRef(ed, 'interventions_w1'), remoteDoc('ed')));
  await assertFails(setDoc(dataRef(ed), remoteDoc('ed', {entityId: {x: 1}})));
});
test('données : clés inconnues et tailles excessives refusées', async () => {
  const ed = as('ed', 'ed@ex.fr');
  await assertFails(setDoc(dataRef(ed), {...remoteDoc('ed'), admin: true}));
  await assertFails(setDoc(dataRef(ed), remoteDoc('ed', {payload: 'texte'})));
  await assertFails(setDoc(dataRef(ed), remoteDoc('ed', {payload: Object.fromEntries(Array.from({length: 501}, (_, i) => ['k' + i, i]))})));
  await assertFails(setDoc(dataRef(ed), remoteDoc('ed', {deviceId: 'x'.repeat(129)})));
  await assertFails(setDoc(dataRef(ed), remoteDoc('ed', {action: 'x'.repeat(65)})));
  const longId = 'i'.repeat(257);
  await assertFails(setDoc(dataRef(ed, 'interventions__' + longId), remoteDoc('ed', {entityId: longId})));
});
test('données : lecture et écriture refusées hors rôle d’édition ou hors exploitation', async () => {
  await seedData();
  await assertSucceeds(getDoc(dataRef(as('vw', 'vw@ex.fr'))));
  await assertFails(setDoc(dataRef(as('vw', 'vw@ex.fr')), remoteDoc('vw')));
  await assertFails(getDoc(dataRef(as('intrus', 'intrus@ex.fr'))));
  await assertFails(setDoc(dataRef(as('intrus', 'intrus@ex.fr')), remoteDoc('intrus')));
});
// Rôles intermédiaires (permissions.js : canMutate) : responsable = tout, opérateur et comptable = leurs entités.
const entityDoc = (uid, entityType, id = 'x1') => [dataRef(as(uid, uid + '@ex.fr'), `${entityType}__${id}`), remoteDoc(uid, {entityType, entityId: id, serverUpdatedAt: serverTimestamp()})];
test('rôles intermédiaires : écritures légitimes de sync.js (responsable, opérateur terrain, comptabilité)', async () => {
  for (const type of ['parcelles', 'interventions', 'farm', 'stockItems']) await assertSucceeds(setDoc(...entityDoc('mg', type)));
  for (const type of ['interventions', 'tasks', 'observations', 'fieldSessions', 'chantiers', 'points', 'photos', 'documents', 'routeSessions', 'gpsTracks', 'integrationImports'])
    await assertSucceeds(setDoc(...entityDoc('op', type)));
  for (const type of ['clients', 'documents', 'stockItems', 'stockMovements', 'products', 'maintenanceRecords']) await assertSucceeds(setDoc(...entityDoc('ac', type)));
});
test('rôles intermédiaires : hors de leur périmètre refusé, suppression définitive refusée', async () => {
  for (const type of ['parcelles', 'clients', 'stockItems', 'farm']) await assertFails(setDoc(...entityDoc('op', type)));
  for (const type of ['parcelles', 'interventions', 'tasks', 'photos']) await assertFails(setDoc(...entityDoc('ac', type)));
  await seedData();
  for (const uid of ['mg', 'op', 'ac']) await assertFails(deleteDoc(dataRef(as(uid, uid + '@ex.fr'))));
});
test('FAILLE : un éditeur ne peut plus supprimer définitivement une donnée ; le propriétaire peut purger', async () => {
  await seedData();
  await assertFails(deleteDoc(dataRef(as('ed', 'ed@ex.fr'))));
  await assertFails(deleteDoc(dataRef(as('vw', 'vw@ex.fr'))));
  await assertSucceeds(deleteDoc(dataRef(as('owner', 'owner@ex.fr'))));
});

// --- storage.rules : pièces jointes (syncAttachments) ---
const storageTest = (name, fn) => test(name, {skip: st ? false : 'émulateur Storage absent'}, fn);
const asStorage = (uid, email) => env.authenticatedContext(uid, email ? {email} : {}).storage();
const blob = (n = 16) => new Uint8Array(n);
// Même appel que sync.js : ref.put(blob, {contentType, customMetadata:{entityId, entityType}}).
const putAttachment = (storage, type, id, meta = {entityId: id, entityType: type}, bytes = blob()) =>
  st.uploadBytes(st.ref(storage, `workspaces/${WS}/attachments/${type}/${id}`), bytes, {contentType: 'image/jpeg', customMetadata: meta});
const attRef = (storage, type = 'photos', id = 'ph1') => st.ref(storage, `workspaces/${WS}/attachments/${type}/${id}`);

storageTest('pièces jointes : dépôt légitime (photo, document) et lecture par un membre', async () => {
  await assertSucceeds(putAttachment(asStorage('ed', 'ed@ex.fr'), 'photos', 'ph1'));
  await assertSucceeds(putAttachment(asStorage('owner', 'owner@ex.fr'), 'documents', 'doc1'));
  // Nouveau dépôt du même fichier (reprise après une erreur réseau).
  await assertSucceeds(putAttachment(asStorage('ed', 'ed@ex.fr'), 'photos', 'ph1'));
  await assertSucceeds(st.getDownloadURL(attRef(asStorage('vw', 'vw@ex.fr'))));
  await assertFails(st.getDownloadURL(attRef(asStorage('intrus', 'intrus@ex.fr'))));
});
storageTest('pièces jointes : métadonnées incohérentes, dossier inconnu, lecteur ou fichier trop lourd refusés', async () => {
  const ed = asStorage('ed', 'ed@ex.fr');
  await assertFails(putAttachment(ed, 'photos', 'ph2', {entityId: 'autre', entityType: 'photos'}));
  await assertFails(putAttachment(ed, 'photos', 'ph2', {entityId: 'ph2', entityType: 'documents'}));
  await assertFails(putAttachment(ed, 'photos', 'ph2', {}));
  await assertFails(putAttachment(ed, 'scripts', 'x1'));
  await assertFails(putAttachment(asStorage('vw', 'vw@ex.fr'), 'photos', 'ph3'));
  await assertFails(putAttachment(ed, 'photos', 'big', undefined, new Uint8Array(25 * 1024 * 1024)));
});
storageTest('pièces jointes : rôles intermédiaires selon leur périmètre', async () => {
  await assertSucceeds(putAttachment(asStorage('mg', 'mg@ex.fr'), 'photos', 'ph-mg'));
  await assertSucceeds(putAttachment(asStorage('op', 'op@ex.fr'), 'photos', 'ph-op'));
  await assertSucceeds(putAttachment(asStorage('op', 'op@ex.fr'), 'documents', 'doc-op'));
  await assertSucceeds(putAttachment(asStorage('ac', 'ac@ex.fr'), 'documents', 'doc-ac'));
  await assertFails(putAttachment(asStorage('ac', 'ac@ex.fr'), 'photos', 'ph-ac'));
  for (const uid of ['mg', 'op', 'ac']) await assertFails(st.deleteObject(attRef(asStorage(uid, uid + '@ex.fr'), 'photos', 'ph-mg')));
});
storageTest('FAILLE : un éditeur ne peut plus supprimer une pièce jointe ; le propriétaire peut', async () => {
  await assertSucceeds(putAttachment(asStorage('ed', 'ed@ex.fr'), 'photos', 'ph1'));
  await assertFails(st.deleteObject(attRef(asStorage('ed', 'ed@ex.fr'))));
  await assertSucceeds(st.deleteObject(attRef(asStorage('owner', 'owner@ex.fr'))));
});

test('factures et contrats de vente : la comptabilité écrit, l’opérateur terrain non ; capteurs et imports restent à l’opérateur', async () => {
  const imp = (uid, farmKind, id = 'r1') => remoteDoc(uid, {entityType: 'integrationImports', entityId: id, payload: {id, farmKind, name: farmKind, version: 1, updatedAt: 5}});
  const ref = (db, id = 'r1') => dataRef(db, 'integrationImports__' + id);
  const op = as('op', 'op@ex.fr'), ac = as('ac', 'ac@ex.fr');
  for (const kind of ['invoice', 'salesContract']) {
    await assertSucceeds(setDoc(ref(ac, kind), imp('ac', kind, kind)));
    await assertFails(setDoc(ref(op, kind), imp('op', kind, kind)));
  }
  await assertSucceeds(setDoc(ref(op, 's1'), imp('op', 'sensor', 's1')));
  await assertFails(setDoc(ref(ac, 's2'), imp('ac', 'sensor', 's2')));
  // Ni l’un ni l’autre ne peut changer le type d’un enregistrement existant pour contourner la règle.
  await assertFails(setDoc(ref(op, 'invoice'), imp('op', 'sensor', 'invoice')));
  await assertFails(setDoc(ref(ac, 's1'), imp('ac', 'invoice', 's1')));
  // Collaborateur et propriétaire : tout.
  await assertSucceeds(setDoc(ref(as('ed', 'ed@ex.fr'), 'invoice'), imp('ed', 'invoice', 'invoice')));
});
