// n° 129 : rôle « Conseiller / technicien » et fil de commentaires par parcelle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ADVISOR_READ_DOCUMENT_CATEGORIES, ADVISOR_READ_ENTITIES, ADVISOR_READ_FARM_KINDS, actionVisibleForRole, advisorCanRead,
  assignableRoles, canMutate, canSeeBilling, canSeeEconomy, canSeeTreasury, parcelCommentWritable, readFilters, roleCan, roleLabel, roleScope
} from './permissions.js';
import {
  buildComment, canComment, canConvertToTask, canDeleteComment, canEditComment, commentsForParcel, dueDateHint,
  markCommentsSeen, taskFromComment, authorLabel
} from './parcel-comments.js';
import {newParcelComments} from './home-priorities.js';
import {computeNotifications} from './notifications.js';
import {emptyState, migrateData} from './state.js';
import {APP_VERSION, ENTITY_TYPES} from './utils.js';
import {encodeCloudPayload, SyncService} from './sync.js';
import {campaignCardModel, billingHomeModel} from './campaign-card.js';
import {buildCommandIndex, matchCommands} from './spotlight.js';
import {DOCUMENT_CATEGORIES} from './traceability.js';
import {LAZY_MODULES, LAZY_TRIGGERS} from './lazy-modules.js';

const rules = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
const storageRules = fs.readFileSync(new URL('./storage.rules', import.meta.url), 'utf8');
const listIn = (text, re) => { const m = re.exec(text); assert.ok(m, String(re)); return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]); };

test('rôle conseiller : attribuable, libellé, capacités limitées', () => {
  assert.ok(assignableRoles().includes('advisor'));
  assert.equal(roleLabel('advisor'), 'Conseiller / technicien');
  assert.ok(roleCan('advisor', 'read') && roleCan('advisor', 'write') && roleCan('advisor', 'sync'));
  for (const cap of ['delete', 'purge', 'restore', 'import', 'export', 'manage-members']) assert.equal(roleCan('advisor', cap), false, cap);
  assert.deepEqual(roleScope('advisor'), {all: false, entities: ['parcelComments']});
});

test('conseiller : aucun travail, aucune tâche, aucune fiche économique ; seulement ses commentaires', () => {
  for (const entity of ['interventions', 'tasks', 'parcelles', 'observations', 'clients', 'stockItems', 'documents', 'integrationImports', 'materiels'])
    for (const action of ['create', 'update']) assert.equal(canMutate('advisor', {entity, action}), false, `${entity} ${action}`);
  assert.equal(canMutate('advisor', {entity: 'integrationImports', action: 'create', farmKind: 'invoice'}), false);
  const mine = {id: 'c1', parcelId: 'p', text: 'Préco', authorUid: 'adv', authorRole: 'advisor', authorEmail: 'adv@ex.fr'};
  assert.equal(canMutate('advisor', {entity: 'parcelComments', action: 'create', record: mine, uid: 'adv'}), true);
  assert.equal(canMutate('advisor', {entity: 'parcelComments', action: 'update', record: {...mine, text: 'x'}, previous: mine, uid: 'adv'}), true);
  // Corbeille de son propre commentaire : l'opération ne porte que {id, deletedAt}, l'auteur se lit sur la version existante.
  assert.equal(canMutate('advisor', {entity: 'parcelComments', action: 'delete', payload: {id: 'c1', deletedAt: 9}, previous: mine, uid: 'adv'}), true);
  const other = {...mine, authorUid: 'ed'};
  assert.equal(canMutate('advisor', {entity: 'parcelComments', action: 'update', record: {...other, text: 'réécrit'}, previous: other, uid: 'adv'}), false);
  assert.equal(canMutate('advisor', {entity: 'parcelComments', action: 'delete', payload: {id: 'c1', deletedAt: 9}, previous: other, uid: 'adv'}), false);
  // Ni s'approprier le commentaire d'un autre en changeant l'auteur.
  assert.equal(canMutate('advisor', {entity: 'parcelComments', action: 'update', record: mine, previous: other, uid: 'adv'}), false);
  // Ni créer au nom d'un autre.
  assert.equal(canMutate('advisor', {entity: 'parcelComments', action: 'create', record: other, uid: 'adv'}), false);
  // Ni se présenter sous un autre rôle ou une autre adresse (même contrôle que firestore.rules).
  assert.equal(canMutate('advisor', {entity: 'parcelComments', action: 'create', record: {...mine, authorRole: 'owner'}, uid: 'adv'}), false);
  assert.equal(canMutate('advisor', {entity: 'parcelComments', action: 'create', record: mine, uid: 'adv', email: 'ADV@ex.fr'}), true);
  assert.equal(canMutate('advisor', {entity: 'parcelComments', action: 'create', record: {...mine, authorEmail: 'owner@ex.fr'}, uid: 'adv', email: 'adv@ex.fr'}), false);
});

test('commentaires : le lecteur n’écrit rien, opérateur et comptabilité les leurs, la gestion tout', () => {
  const c = {id: 'c', parcelId: 'p', text: 't', authorUid: 'adv', authorRole: 'advisor'};
  assert.equal(canMutate('viewer', {entity: 'parcelComments', action: 'create', record: {...c, authorUid: 'vw'}, uid: 'vw'}), false);
  for (const r of ['operator', 'accountant']) {
    assert.equal(canMutate(r, {entity: 'parcelComments', action: 'create', record: {...c, authorUid: r, authorRole: r}, uid: r}), true, r);
    assert.equal(canMutate(r, {entity: 'parcelComments', action: 'update', record: c, previous: c, uid: r}), false, r);
  }
  for (const r of ['owner', 'manager', 'editor']) assert.equal(canMutate(r, {entity: 'parcelComments', action: 'update', record: {...c, taskId: 't1'}, previous: c, uid: r}), true, r);
  assert.equal(parcelCommentWritable('editor', c, 'ed'), true);
  assert.equal(parcelCommentWritable('advisor', null, 'adv'), true);
  // Hors gestion sans compte connecté (uid vide) : refusé ici, la règle le refuserait à l'envoi pour toujours.
  assert.equal(parcelCommentWritable('operator', {...c, authorUid: ''}, ''), false);
  assert.equal(parcelCommentWritable('owner', {...c, authorUid: ''}, ''), true, 'ferme locale : gestion');
});

test('lecture du conseiller : agronomie seulement, mêmes listes que firestore.rules et storage.rules', () => {
  const fn = rules.slice(rules.indexOf('function advisorReadable'), rules.indexOf('function canWriteData'));
  assert.deepEqual(listIn(fn, /d\.entityType in \[([^\]]+)\]/), [...ADVISOR_READ_ENTITIES]);
  assert.deepEqual(listIn(fn, /d\.payload\.farmKind in \[([^\]]+)\]/), [...ADVISOR_READ_FARM_KINDS]);
  assert.deepEqual(listIn(fn, /d\.payload\.category in \[([^\]]+)\]/), [...ADVISOR_READ_DOCUMENT_CATEGORIES]);
  assert.deepEqual(listIn(storageRules, /\.data\.payload\.category\s+in \[([^\]]+)\]/), [...ADVISOR_READ_DOCUMENT_CATEGORIES]);
  assert.match(rules, /allow read: if isMember\(workspaceId\) && \(memberRole\(workspaceId\) != 'advisor' \|\| resource == null \|\| advisorReadable\(resource\.data\)\);/);
  assert.match(rules, /match \/audit\/\{auditId\} \{[\s\S]*?allow read: if isMember\(workspaceId\) && memberRole\(workspaceId\) != 'advisor';/);
  for (const type of ADVISOR_READ_ENTITIES) assert.ok(ENTITY_TYPES.includes(type), type);
  for (const cat of ADVISOR_READ_DOCUMENT_CATEGORIES.filter(c => c !== 'Analyse')) assert.ok(DOCUMENT_CATEGORIES.includes(cat), cat);
  // Rien d'économique ni de personnel.
  for (const type of ['clients', 'stockItems', 'stockMovements', 'materiels', 'maintenanceRecords', 'fieldSessions', 'gpsTracks', 'routeSessions', 'chantiers', 'importSessions', 'automationRules'])
    assert.equal(advisorCanRead(type, {}), false, type);
  for (const farmKind of ['invoice', 'quote', 'billingItem', 'billingSchedule', 'salesContract', 'contact', 'messageTemplate', 'message', 'harvest', 'fuel', 'animalSale', 'sensor'])
    assert.equal(advisorCanRead('integrationImports', {farmKind}), false, farmKind);
  assert.equal(advisorCanRead('integrationImports', {farmKind: 'soilAnalysis'}), true);
  assert.equal(advisorCanRead('documents', {category: 'Facture'}), false);
  assert.equal(advisorCanRead('documents', {category: 'Analyse de sol'}), true);
  // Les colonnes « in » de Firestore sont limitées à 30 valeurs.
  for (const list of [ADVISOR_READ_ENTITIES, ADVISOR_READ_FARM_KINDS, ADVISOR_READ_DOCUMENT_CATEGORIES]) assert.ok(list.length <= 30);
});

test('requêtes de synchronisation bornées pour le conseiller (index composites déclarés)', () => {
  assert.equal(readFilters('owner'), null);
  assert.equal(readFilters('viewer'), null);
  const f = readFilters('advisor');
  assert.equal(f.length, 3);
  assert.deepEqual(f[0], [['entityType', 'in', [...ADVISOR_READ_ENTITIES]]]);
  const indexes = JSON.parse(fs.readFileSync(new URL('./firestore.indexes.json', import.meta.url), 'utf8')).indexes;
  const has = fields => indexes.some(i => i.collectionGroup === 'data' && i.fields.map(x => x.fieldPath).join() === fields.join());
  for (const cursor of ['updatedAt', 'serverUpdatedAt']) for (const conds of f) assert.ok(has([...conds.map(c => c[0]), cursor]), `${conds.map(c => c[0])} + ${cursor}`);
  assert.match(fs.readFileSync(new URL('./firebase.json', import.meta.url), 'utf8'), /"indexes": "firestore.indexes.json"/);
  // Requêtes construites par sync.js (scopedQueries) sur un faux SDK.
  const sync = fs.readFileSync(new URL('./sync.js', import.meta.url), 'utf8');
  assert.match(sync, /collectScoped\(data,q=>q\.where\('updatedAt'/);
  assert.match(sync, /collectScoped\(data,q=>q\.where\('serverUpdatedAt'/);
  assert.match(sync, /if\(readFilters\(this\.role\)\)return\{seeded:0,remoteEmpty:false\}/);
});

test('rules : écriture des commentaires contrôlée par auteur, rôle conseiller invitable', () => {
  const fn = rules.slice(rules.indexOf('function parcelCommentWritable'), rules.indexOf('function advisorReadable'));
  assert.match(fn, /entityType == 'parcelComments'/);
  assert.match(fn, /d\.payload\.get\('authorUid', ''\) == request\.auth\.uid/);
  assert.match(fn, /d\.payload\.get\('authorRole', ''\) == role/);
  assert.match(fn, /d\.payload\.get\('authorEmail', ''\) == request\.auth\.token\.get\('email', ''\)\.lower\(\)/);
  assert.match(rules, /\(resource == null \|\| canWriteData\(workspaceId, resource\.data\.entityType, resource\.data\)\)/);
});

test('commentaire : construction, auteur figé, validation', () => {
  const author = {uid: 'adv', role: 'advisor', name: 'Claire', email: 'Claire@Coop.example'};
  const c = buildComment({parcelId: 'p1', text: '  Préco : fongicide T2 la semaine prochaine  '}, {author, id: 'c1'});
  assert.deepEqual([c.kind, c.text, c.authorUid, c.authorEmail, c.authorRole, c.taskId], ['preco', 'Préco : fongicide T2 la semaine prochaine', 'adv', 'claire@coop.example', 'advisor', null]);
  assert.equal(buildComment({parcelId: 'p1', text: 'Vu des pucerons'}, {author: {uid: 'ed', role: 'editor'}}).kind, 'comment');
  const edited = buildComment({text: 'Corrigé', kind: 'comment'}, {author: {uid: 'autre', role: 'owner'}, existing: {...c, createdAt: 5}, now: 99});
  assert.deepEqual([edited.authorUid, edited.text, edited.kind, edited.editedAt, edited.parcelId], ['adv', 'Corrigé', 'comment', 99, 'p1']);
  assert.throws(() => buildComment({parcelId: 'p1', text: '   '}, {author}), /Écrivez/);
  assert.throws(() => buildComment({text: 'x'}, {author}), /Parcelle/);
  assert.throws(() => buildComment({parcelId: 'p1', text: 'x'.repeat(2001)}, {author}), /trop long/);
  assert.throws(() => buildComment({parcelId: 'p1', text: 'Préco'}, {author: {uid: '', role: 'advisor'}}), /Connexion au compte requise/);
  assert.equal(buildComment({parcelId: 'p1', text: 'Note'}, {author: {uid: '', role: 'owner'}}).authorUid, '', 'ferme locale');
});

test('droits d’interface : modifier le sien, supprimer (auteur ou gestion), transformer (gestion)', () => {
  const c = {id: 'c', authorUid: 'adv', authorRole: 'advisor'};
  assert.equal(canEditComment({role: 'advisor', uid: 'adv'}, c), true);
  assert.equal(canEditComment({role: 'advisor', uid: ''}, {id: 'x', authorUid: ''}), false, 'hors gestion sans compte');
  assert.equal(canEditComment({role: 'owner', uid: 'own'}, c), false);
  assert.equal(canDeleteComment({role: 'owner', uid: 'own'}, c), true);
  assert.equal(canDeleteComment({role: 'operator', uid: 'op'}, c), false);
  assert.equal(canEditComment({role: 'viewer', uid: 'adv'}, c), false);
  assert.deepEqual(['owner', 'manager', 'editor', 'operator', 'accountant', 'advisor', 'viewer'].map(canConvertToTask), [true, true, true, false, false, false, false]);
  assert.equal(canComment('viewer'), false); assert.equal(canComment('advisor'), true);
  assert.equal(authorLabel(c, {uid: 'adv'}), 'Vous');
  assert.equal(authorLabel({authorUid: 'x', authorEmail: 'a@b.fr'}, {uid: 'adv'}), 'a@b.fr');
});

test('Transformer en tâche : tâche préremplie, échéance déduite du texte', () => {
  const c = {id: 'c1', parcelId: 'p1', kind: 'preco', text: 'Préco : fongicide T2 la semaine prochaine\nDose 0,8 l/ha', authorName: 'Claire', authorRole: 'advisor', workId: 'w1'};
  const t = taskFromComment(c, {id: 't1', parcelName: 'Grand champ', dueDate: '2026-11-03'});
  assert.equal(t.title, 'Préco : fongicide T2 la semaine prochaine');
  assert.deepEqual([t.parcelId, t.status, t.commentId, t.workId, t.dueDate], ['p1', 'À faire', 'c1', 'w1', '2026-11-03']);
  assert.match(t.note, /Dose 0,8 l\/ha\n— Claire, Conseiller \/ technicien · Grand champ/);
  assert.ok(taskFromComment({...c, text: 'x'.repeat(120)}, {id: 't'}).title.length <= 92);
  assert.equal(dueDateHint('à faire demain', '2026-10-27'), '2026-10-28');
  assert.equal(dueDateHint('Traiter aujourd’hui', '2026-10-27'), '2026-10-27');
  assert.equal(dueDateHint('dans 3 jours', '2026-10-30'), '2026-11-02');
  assert.equal(dueDateHint('la semaine prochaine', '2026-12-28'), '2027-01-04');
});

test('nouvelles préconisations : celles des autres, depuis la dernière lecture, notification à l’ouverture', () => {
  const now = Date.UTC(2026, 9, 27);
  const s = emptyState();
  s.parcelles = [{id: 'p1', nom: 'A'}, {id: 'p2', nom: 'B'}, {id: 'p3', nom: 'C', deletedAt: 1}];
  s.parcelComments = [
    {id: 'c1', parcelId: 'p1', kind: 'preco', text: 'T2', authorUid: 'adv', createdAt: now - 3600e3},
    {id: 'c2', parcelId: 'p2', kind: 'preco', text: 'Azote', authorUid: 'adv', createdAt: now - 7200e3},
    {id: 'c3', parcelId: 'p1', kind: 'comment', text: 'moi', authorUid: 'me', createdAt: now},
    {id: 'c4', parcelId: 'p1', kind: 'preco', text: 'vieux', authorUid: 'adv', createdAt: now - 40 * 864e5},
    {id: 'c5', parcelId: 'p3', kind: 'preco', text: 'parcelle supprimée', authorUid: 'adv', createdAt: now},
    {id: 'c6', parcelId: 'p2', kind: 'preco', text: 'corbeille', authorUid: 'adv', createdAt: now, deletedAt: now}
  ];
  const fresh = newParcelComments(s, {uid: 'me', now});
  assert.deepEqual(fresh.comments.map(c => c.id), ['c1', 'c2']);
  assert.deepEqual([fresh.count, fresh.precos, fresh.parcelIds], [2, 2, ['p1', 'p2']]);
  assert.equal(newParcelComments(s, {uid: '', now}).count, 0, 'sans compte cloud, rien de nouveau');
  s.preferences.parcelCommentsSeen = markCommentsSeen({}, ['c1'], now - 1000);
  assert.deepEqual(newParcelComments(s, {uid: 'me', now}).comments.map(c => c.id), ['c2']);
  s.preferences.parcelCommentsSeen = markCommentsSeen(s.preferences.parcelCommentsSeen, ['c2'], now);
  assert.equal(newParcelComments(s, {uid: 'me', now}).count, 0);
  // Écrit hors ligne avant la dernière lecture, reçu après : toujours nouveau (lecture notée par commentaire).
  s.parcelComments.push({id: 'c7', parcelId: 'p1', kind: 'preco', text: 'hors ligne', authorUid: 'adv', createdAt: now - 5000});
  assert.deepEqual(newParcelComments(s, {uid: 'me', now}).comments.map(c => c.id), ['c7']);
  s.parcelComments.pop();
  assert.deepEqual(Object.keys(markCommentsSeen({old: now - 100 * 864e5, c1: now}, [], now)), ['c1'], 'anciennes lectures oubliées');
  s.preferences.parcelCommentsSeen = {};
  const row = computeNotifications(s, {uid: 'me'}).find(n => n.id === 'parcel-comments-new');
  assert.ok(row); assert.equal(row.message, '2 nouvelles préconisations'); assert.equal(row.entity, 'parcelComments');
  assert.equal(computeNotifications(s).some(n => n.id === 'parcel-comments-new'), false);
  assert.deepEqual(commentsForParcel(s, 'p1').map(c => c.id), ['c3', 'c1', 'c4']);
});

test('migration v18 : parcelComments et lecture par parcelle, anciennes sauvegardes', () => {
  assert.equal(APP_VERSION, 18);
  assert.ok(ENTITY_TYPES.includes('parcelComments'));
  assert.deepEqual(emptyState().parcelComments, []);
  assert.deepEqual(emptyState().preferences.parcelCommentsSeen, {});
  const m = migrateData({version: 17, parcelles: [{id: 'p'}], preferences: {parcelCommentsSeen: 'abîmé'}, metadata: {}});
  assert.deepEqual(m.parcelComments, []);
  assert.deepEqual(m.preferences.parcelCommentsSeen, {});
  const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/backups/v18-actuelle.json', import.meta.url), 'utf8'));
  const v18 = migrateData(raw.data);
  assert.equal(v18.parcelComments.length, 1);
  assert.equal(v18.parcelComments[0].authorRole, 'advisor');
  assert.equal(v18.preferences.parcelCommentsSeen.p_h, 1791000000000);
  assert.deepEqual(migrateData(v18), v18);
});

test('transport cloud : un commentaire passe sans tableau imbriqué ni clé réservée', () => {
  const enc = encodeCloudPayload({id: 'c', parcelId: 'p', text: 'a\nb', kind: 'preco', authorUid: 'u', taskId: null, workId: null});
  assert.equal(enc.parcelId, 'p'); assert.equal(enc.authorUid, 'u');
});

test('interface : économie masquée au conseiller (Plus, recherche, accueil) ; facturation au lecteur et à l’opérateur', () => {
  assert.equal(canSeeEconomy('advisor'), false); assert.equal(canSeeEconomy('viewer'), true);
  assert.equal(canSeeBilling('advisor'), false); assert.equal(canSeeTreasury('advisor'), false);
  for (const action of ['open-invoices', 'open-treasury', 'open-statistics', 'open-clients', 'open-messages', 'open-team-work', 'open-crop-margins', 'open-land', 'open-accounting-export'])
    assert.equal(actionVisibleForRole('advisor', action), false, action);
  for (const action of ['open-rotations', 'open-observations', 'open-weather', 'open-soil-analyses', 'open-nitrogen', 'open-phyto-register', 'open-team-roles'])
    assert.equal(actionVisibleForRole('advisor', action), true, action);
  for (const r of ['viewer', 'operator']) assert.equal(actionVisibleForRole(r, 'open-invoices'), false, r);
  assert.equal(actionVisibleForRole('viewer', 'open-treasury'), false);
  assert.equal(actionVisibleForRole('accountant', 'open-invoices'), true);
  // Recherche globale : « Facturation » n'est plus proposée au lecteur ni au conseiller.
  const index = buildCommandIndex({});
  const found = role => matchCommands('facturation', index, {visible: a => actionVisibleForRole(role, a)}).map(r => r.action || r[2] || r.id);
  assert.ok(JSON.stringify(found('owner')).includes('open-invoices'));
  for (const r of ['viewer', 'advisor', 'operator']) assert.ok(!JSON.stringify(found(r)).includes('open-invoices'), r);
  // Accueil : carte de campagne et carte Facturation masquées.
  assert.equal(campaignCardModel(emptyState(), {role: 'advisor'}).hidden, true);
  assert.equal(billingHomeModel(emptyState(), {role: 'advisor'}).hidden, true);
  // app.js applique ce filtre à Plus, à la recherche de Plus et à la recherche globale.
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  assert.match(app, /c\.items\.filter\(i=>actionVisibleForRole\(cloudRole\(\),i\[2\]\)\)/);
  assert.match(app, /filter\(i=>actionVisibleForRole\(cloudRole\(\),i\[2\]\)&&normalize/);
  assert.match(app, /visible:a=>activities\(\)\.visible\(a\)&&actionVisibleForRole\(cloudRole\(\),a\)/);
});

test('branchement : module différé, déclencheur [data-pc], CORE', () => {
  assert.match(String(LAZY_MODULES.parcelComments), /parcel-comments-ui\.js/);
  assert.equal(LAZY_TRIGGERS['[data-pc]'], 'parcelComments');
  const sw = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
  for (const f of ['parcel-comments.js', 'parcel-comments-ui.js']) assert.ok(sw.includes(`'./${f}'`), f);
  for (const f of ['parcel-comments.js', 'parcel-comments-ui.js']) assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')), f);
});

test('conseiller promu : curseurs remis à zéro quand le périmètre de lecture s’élargit (pull complet)', () => {
  const state = emptyState();
  state.preferences = {...state.preferences, workspaceId: 'ws', syncEnabled: true};
  state.metadata = {...state.metadata, syncCursors: {ws: 5000}, syncServerCursors: {ws: 6000}, syncCursorScopes: {ws: 'advisor'}};
  const sync = new SyncService({state});
  Object.assign(sync, {status: {connected: true}, member: {role: 'advisor'}});
  assert.deepEqual([sync.readScope, sync.syncCursor, sync.serverCursor], ['advisor', 5000, 6000]);
  sync.member = {role: 'editor'};
  assert.deepEqual([sync.readScope, sync.syncCursor, sync.serverCursor], ['all', 0, 0], 'promu : tout relire');
  state.metadata.syncCursorScopes.ws = 'all';
  sync.member = {role: 'advisor'};
  assert.equal(sync.syncCursor, 5000, 'rétrogradé : périmètre plus étroit, curseur gardé');
  const src = fs.readFileSync(new URL('./sync.js', import.meta.url), 'utf8');
  assert.match(src, /state\.metadata\.syncCursorScopes=\{\.\.\.\(state\.metadata\.syncCursorScopes\|\|\{\}\),\[this\.workspaceId\]:pulled\.scope\}/);
});
