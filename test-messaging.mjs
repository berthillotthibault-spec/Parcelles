// Messages et notifications (v13) : logique pure de messaging.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone, formatPhone, isMobile, validEmail, detectPlatform, smsUri, mailtoUri, whatsappUri, smsSegments, toGsm,
  renderTemplate, templateVariables, unresolvedVariables, messageTemplates, templateFor, templatePayload, DEFAULT_TEMPLATES, BILLING_TEMPLATE_KEYS,
  contactPayload, messageContacts, contactGroups, contactForAssignee, consentStatus, channelFor, freeRecipient, addressConsent,
  planIdempotencyId, deliveredTo, nextOutboxAt, GATEWAY_MAX_ATTEMPTS,
  dayPlanItems, dayPlanText, dayPlanAssignees, dayPlanMessage, workInstructionMessage, dayLabel,
  messageRecord, messageLog, canSeeMessage, canSendMessages, canManageDirectory, messageStats, isFinanceContext,
  messageIdempotencyKey, gatewayEndpoint, gatewayPayload, parseGatewayResponse, retryDelayMs, outboxDue, planReminderDue,
  MESSAGE_KIND, MESSAGE_TEMPLATE_KIND, CONTACT_KIND
} from './messaging.js';
import {canMutate, messageWritable, FINANCE_KINDS} from './permissions.js';
import {needsUnicode} from './tools/worker-messages.example.js';

const square = [[[4.80, 45.70], [4.81, 45.70], [4.81, 45.71], [4.80, 45.71], [4.80, 45.70]]];
const base = () => ({
  exploitation: {nom: 'GAEC du Sougey'},
  parcelles: [{id: 'p1', nom: 'Grand Champ', surfaceHa: 12.5, geometry: {type: 'Polygon', coordinates: square}}, {id: 'p2', nom: 'La Combe', surfaceHa: 3}],
  materiels: [{id: 'm1', nom: 'Semoir 4 m'}],
  interventions: [
    {id: 'w1', type: 'Semis', parcelId: 'p1', status: 'Prévu', plannedDate: '2026-10-21', startTime: '08:00', product: 'Blé Chevignon', dose: 180, doseUnit: 'kg/ha', equipmentId: 'm1', assigneeName: 'Paul Martin', instructions: 'Commencer par le bas'},
    {id: 'w2', type: 'Déchaumage', parcelId: 'p2', status: 'Prévu', plannedDate: '2026-10-21', startTime: '14:00', assigneeName: 'paul martin'},
    {id: 'w3', type: 'Labour', parcelId: 'p2', status: 'Prévu', plannedDate: '2026-10-21', assigneeName: 'Julie'},
    {id: 'w4', type: 'Broyage', parcelId: 'p2', status: 'Terminé', date: '2026-10-21', assigneeName: 'Paul Martin'},
    {id: 'w5', type: 'Roulage', parcelId: 'p2', status: 'Prévu', plannedDate: '2026-10-19', assigneeName: 'Paul Martin'},
    {id: 'w6', type: 'Traitement', parcelId: 'p2', status: 'Prévu', plannedDate: '2026-10-21', deletedAt: 5, assigneeName: 'Paul Martin'}
  ],
  tasks: [{id: 't1', title: 'Graisser la herse', status: 'À faire', dueDate: '2026-10-21', assigneeName: 'Paul Martin', assigneeId: 'uid-paul'}],
  clients: [{id: 'c1', name: 'EARL des Saules', contact: 'Marc Durand', phone: '06 11 22 33 44', email: 'marc@saules.fr'}],
  integrationImports: [
    {id: 'k1', farmKind: CONTACT_KIND, name: 'Paul Martin', role: 'Chauffeur', phones: ['+33612345678'], email: '', groups: ['Chauffeurs'], assigneeNames: ['Paulo'], consent: {sms: {status: 'oui', at: '2026-10-01', source: 'oral'}}},
    {id: 'k2', farmKind: CONTACT_KIND, name: 'Véto Rivière', role: 'Vétérinaire', phones: ['+33478000000'], email: 'veto@example.fr', groups: [], consent: {sms: {status: 'non', at: '2026-09-01'}}, preferredChannel: 'email'}
  ]
});

test('numéros : E.164 français, international, outre-mer, rejet de l’illisible', () => {
  assert.equal(normalizePhone('06 12 34 56 78'), '+33612345678');
  assert.equal(normalizePhone('06.12.34.56.78'), '+33612345678');
  assert.equal(normalizePhone('+33 (0)6 12 34 56 78'), '+33612345678');
  assert.equal(normalizePhone('0033612345678'), '+33612345678');
  assert.equal(normalizePhone('+330612345678'), '+33612345678');
  assert.equal(normalizePhone('612345678'), '+33612345678');
  assert.equal(normalizePhone('0690 12 34 56'), '+590690123456');
  assert.equal(normalizePhone('0692 12 34 56'), '+262692123456');
  assert.equal(normalizePhone('+32 470 12 34 56'), '+32470123456');
  for (const bad of ['', 'abc', '12', '06 12 34', '+1 2', null, undefined]) assert.equal(normalizePhone(bad), null, String(bad));
  assert.equal(formatPhone('+33612345678'), '06 12 34 56 78');
  assert.equal(isMobile('+33612345678'), true);
  assert.equal(isMobile('+33478000000'), false);
  assert.equal(isMobile('+590690123456'), true);
  assert.equal(validEmail('a@b.fr'), true);
  assert.equal(validEmail('a@b'), false);
});

test('liens SMS : formats iOS, Android et RFC 5724, plusieurs numéros, corps encodé', () => {
  const body = 'Planning du mardi 20/10 :\n1. 08:00 Semis & co';
  assert.equal(smsUri({phones: ['06 12 34 56 78', '07 11 22 33 44'], body, platform: 'ios'}), `sms:+33612345678,+33711223344&body=${encodeURIComponent(body)}`);
  assert.equal(smsUri({phones: ['06 12 34 56 78', '07 11 22 33 44'], body, platform: 'android'}), `sms:+33612345678;+33711223344?body=${encodeURIComponent(body)}`);
  assert.equal(smsUri({phones: ['0612345678'], body: 'a b', platform: 'other'}), 'sms:+33612345678?body=a%20b');
  assert.equal(smsUri({phones: ['0612345678', '+33612345678', 'nimporte'], platform: 'ios'}), 'sms:+33612345678', 'doublons et numéros illisibles écartés, sans corps');
  assert.ok(smsUri({phones: ['0612345678'], body: 'x', platform: 'ios'}).includes('%0A') === false);
  assert.ok(smsUri({phones: ['0612345678'], body: 'a\nb', platform: 'ios'}).endsWith('body=a%0Ab'));
  assert.equal(detectPlatform({userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'}), 'ios');
  assert.equal(detectPlatform({userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5}), 'ios');
  assert.equal(detectPlatform({userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)'}), 'android');
  assert.equal(detectPlatform({userAgent: 'Mozilla/5.0 (Windows NT 10.0)'}), 'other');
});

test('liens e-mail et WhatsApp', () => {
  assert.equal(mailtoUri({to: ['marc@saules.fr', 'bad'], subject: 'Facture F2026-0001', body: 'Bonjour,\nCi-joint.'}), 'mailto:marc@saules.fr?subject=Facture%20F2026-0001&body=Bonjour%2C%0D%0ACi-joint.');
  assert.equal(mailtoUri({to: 'a+b@x.fr', cc: ['c@x.fr'], bcc: ['d@x.fr']}), 'mailto:a%2Bb@x.fr?cc=c@x.fr&bcc=d@x.fr');
  assert.equal(whatsappUri({phone: '06 12 34 56 78', body: 'Salut à toi'}), `https://wa.me/33612345678?text=${encodeURIComponent('Salut à toi')}`);
  assert.equal(whatsappUri({body: 'x'}), 'https://wa.me/?text=x');
});

test('segments SMS : GSM-7 160/153 (extension comptée double), UCS-2 70/67', () => {
  assert.deepEqual(smsSegments(''), {encoding: 'GSM-7', length: 0, segments: 0, perSegment: 160, remaining: 160, nonGsm: []});
  assert.equal(smsSegments('a'.repeat(160)).segments, 1);
  assert.equal(smsSegments('a'.repeat(161)).segments, 2);
  assert.equal(smsSegments('a'.repeat(306)).segments, 2);
  assert.equal(smsSegments('a'.repeat(307)).segments, 3);
  assert.equal(smsSegments('Prix : 12 €').length, 12, 'l’euro compte deux septets');
  assert.equal(smsSegments('Récolte à 9 h, déjà prévu').encoding, 'GSM-7', 'é, à restent en GSM');
  const ucs = smsSegments('Fenêtre de traitement');
  assert.equal(ucs.encoding, 'UCS-2');
  assert.deepEqual(ucs.nonGsm, ['ê']);
  assert.equal(smsSegments('ê'.repeat(70)).segments, 1);
  assert.equal(smsSegments('ê'.repeat(71)).segments, 2);
  assert.equal(smsSegments('ê'.repeat(135)).segments, 3);
  assert.equal(toGsm('L’été, fenêtre « idéale » – œuf ç°'), 'L\'été, fenetre " idéale " - oeuf c deg');
  assert.equal(smsSegments(toGsm('Fenêtre ouverte… à 9 h')).encoding, 'GSM-7');
});

test('modèles : variables remplacées, inconnues laissées visibles, personnalisation par clé', () => {
  assert.equal(renderTemplate('Bonjour {prenom}, facture {numero} : {montant} avant le {echeance}. {lien} {inconnue}', {prenom: 'Marc', numero: 'F2026-0001', montant: '120,00 €', echeance: '20/11/2026', lien: ''}), 'Bonjour Marc, facture F2026-0001 : 120,00 € avant le 20/11/2026.  {inconnue}');
  assert.equal(renderTemplate('{Prenom} {date}', {prenom: 'Paul', date: null}), 'Paul {date}');
  assert.deepEqual(templateVariables('{a} {b} {a}'), ['a', 'b']);
  assert.deepEqual(unresolvedVariables(renderTemplate('{prenom} {x}', {prenom: 'P'})), ['x']);
  const keys = DEFAULT_TEMPLATES.map(t => t.key);
  for (const k of ['planning-jour', 'planning-demain', 'consigne', 'changement-planning', 'rappel-rdv', 'alerte-meteo', 'devis-envoi', 'facture-envoi', 'relance-1', 'relance-2', 'relance-3', 'remerciement-paiement']) assert.ok(keys.includes(k), k);
  for (const k of ['relance-1', 'relance-2', 'relance-3', 'facture-envoi', 'devis-envoi']) for (const v of ['numero', 'montant', 'echeance', 'lien']) assert.ok(templateVariables(templateFor({}, k).body).includes(v), `${k} : ${v}`);
  assert.equal(BILLING_TEMPLATE_KEYS.envoi.facture, 'facture-envoi');
  for (const t of DEFAULT_TEMPLATES.filter(x => x.channel === 'sms')) assert.equal(smsSegments(t.body.replace(/\{\w+\}/g, 'x')).encoding, 'GSM-7', `${t.key} tient en GSM`);
  const state = {integrationImports: [{id: 'r1', farmKind: MESSAGE_TEMPLATE_KIND, key: 'planning-jour', name: 'Mon planning', body: 'Salut {prenom} : {travaux}'}, {id: 'r2', farmKind: MESSAGE_TEMPLATE_KIND, name: 'Rappel clôture', body: 'Vérifie la clôture'}]};
  const list = messageTemplates(state);
  assert.equal(templateFor(state, 'planning-jour').body, 'Salut {prenom} : {travaux}');
  assert.equal(templateFor(state, 'planning-jour').customized, true);
  assert.equal(list.filter(t => t.key === 'planning-jour').length, 1);
  assert.ok(list.some(t => t.key === 'r2' && !t.builtin));
  assert.throws(() => templatePayload({name: '', body: 'x'}), /nom/);
  assert.equal(templatePayload({name: 'A', body: 'b', channel: 'fax'}).channel, 'sms');
});

test('contacts : validation, carnet unifié, groupes, rattachement aux personnes désignées, consentement', () => {
  assert.throws(() => contactPayload({name: 'X', phones: '12'}), /Numéro illisible/);
  assert.throws(() => contactPayload({name: 'X', email: 'pas-une-adresse'}), /e-mail/);
  const c = contactPayload({name: ' Paul ', phones: '06 12 34 56 78; 0711223344', groups: 'Chauffeurs, Équipe', consent: {sms: {status: 'oui'}}}, {today: '2026-10-20'});
  assert.deepEqual(c.phones, ['+33612345678', '+33711223344']);
  assert.deepEqual(c.groups, ['Chauffeurs', 'Équipe']);
  assert.deepEqual(c.consent.sms, {status: 'oui', at: '2026-10-20', source: ''});
  assert.equal(c.preferredChannel, 'sms');
  const contacts = messageContacts(base(), {members: [{id: 'uid-julie', displayName: 'Julie', role: 'operator', email: 'julie@x.fr'}]});
  assert.deepEqual(contacts.map(x => [x.id, x.kind]), [['member:uid-julie', 'member'], ['client:c1', 'client'], ['k1', 'contact'], ['k2', 'contact']]);
  const marc = contacts.find(x => x.kind === 'client');
  assert.equal(marc.phone, '+33611223344');
  assert.equal(marc.name, 'Marc Durand');
  assert.deepEqual(contactGroups(contacts).map(g => g.name), ['Chauffeurs', 'Clients', 'Équipe']);
  assert.equal(contactForAssignee(contacts, {name: 'paul martin'})?.id, 'k1');
  assert.equal(contactForAssignee(contacts, {name: 'Paulo'})?.id, 'k1', 'alias');
  assert.equal(contactForAssignee(contacts, {name: 'Julie'})?.id, 'member:uid-julie');
  assert.equal(contactForAssignee(contacts, {name: 'Inconnu'}), null);
  const veto = contacts.find(x => x.id === 'k2');
  assert.equal(consentStatus(veto, 'sms'), 'non');
  assert.equal(consentStatus(veto, 'email'), 'inconnu');
  assert.equal(channelFor(veto, 'auto'), 'email');
  assert.equal(channelFor(contacts.find(x => x.id === 'k1'), 'auto'), 'sms');
  assert.equal(channelFor(contacts.find(x => x.id === 'k1'), 'email'), null);
  assert.equal(freeRecipient('06 99 88 77 66').phone, '+33699887766');
  assert.equal(freeRecipient('x@y.fr').email, 'x@y.fr');
  assert.equal(freeRecipient('rien'), null);
});

test('planning du jour : par personne, heure, parcelle, produit et dose, matériel, consigne, lien de localisation', () => {
  const state = base();
  const rows = dayPlanItems(state, {date: '2026-10-21', assignee: 'Paul Martin'});
  assert.deepEqual(rows.map(r => r.id), ['w1', 'w2', 't1'], 'terminé, supprimé et autre personne exclus ; tri par heure');
  const textPlan = dayPlanText(state, {date: '2026-10-21', assignee: {name: 'Paul Martin', id: 'uid-paul'}});
  assert.match(textPlan, /^1\. 08:00 Semis - Grand Champ \(12,5 ha\)/);
  assert.match(textPlan, /Produit : Blé Chevignon 180 kg\/ha/);
  assert.match(textPlan, /Materiel : Semoir 4 m/);
  assert.match(textPlan, /Consigne : Commencer par le bas/);
  assert.match(textPlan, /Lieu : https:\/\/www\.google\.com\/maps\?q=45\.70\d+,4\.80\d+/);
  assert.match(textPlan, /3\. Tache : Graisser la herse/);
  assert.equal(dayPlanText(state, {date: '2026-10-22', assignee: 'Paul Martin'}), 'Rien de prevu.');
  // Le jour même, le travail en retard non fait est repris.
  assert.deepEqual(dayPlanItems(state, {date: '2026-10-21', assignee: 'Paul Martin', today: '2026-10-21'}).map(r => r.id), ['w5', 'w1', 'w2', 't1']);
  assert.match(dayPlanText(state, {date: '2026-10-21', assignee: 'Paul Martin', today: '2026-10-21'}), /Roulage - La Combe \(3 ha\) \(en retard\)/);
  assert.deepEqual(dayPlanAssignees(state, {date: '2026-10-21'}).map(p => [p.name, p.count, p.id]), [['Julie', 1, ''], ['Paul Martin', 3, 'uid-paul']]);
  const msg = dayPlanMessage(state, {date: '2026-10-21', assignee: 'Paul Martin', today: '2026-10-20'});
  assert.equal(msg.templateKey, 'planning-demain');
  assert.match(msg.body, /^Bonjour Paul, voici le planning de demain, mercredi 21\/10 :\n1\. 08:00 Semis/);
  assert.match(msg.body, /GAEC du Sougey$/);
  assert.equal(dayLabel('2026-10-20'), 'mardi 20/10');
  const consigne = workInstructionMessage(state, {kind: 'work', id: 'w1'});
  assert.match(consigne.body, /^Bonjour Paul, consigne pour le mercredi 21\/10 :\n08:00 Semis - Grand Champ/);
  assert.equal(workInstructionMessage(state, {id: 'absent'}), null);
});

test('journal : enregistrement sans secret, visibilité selon le rôle, filtres', () => {
  const rec = messageRecord({channel: 'sms', recipients: [{id: 'k1', name: 'Paul', phone: '06 12 34 56 78'}], body: 'x'.repeat(5000), context: {entity: 'interventions', id: 'w1', kind: 'work'}, deviceId: 'dev1', author: {uid: 'u1', name: 'Thibault'}, now: 1000});
  assert.equal(rec.body.length, 4000);
  assert.equal(rec.excerpt.length, 160);
  assert.deepEqual(rec.recipients, [{contactId: 'k1', name: 'Paul', phone: '+33612345678', email: ''}]);
  assert.equal(rec.finance, false);
  assert.throws(() => messageRecord({channel: 'fax'}), /Canal/);
  const facture = messageRecord({channel: 'email', recipients: [{name: 'Marc', email: 'marc@saules.fr'}], subject: 'Facture', body: 'b', context: {kind: 'invoice', id: 'f1'}, deviceId: 'dev2', author: {uid: 'u2'}, now: 2000});
  assert.equal(facture.finance, true);
  assert.ok(FINANCE_KINDS.has('invoice') && isFinanceContext({kind: 'invoice'}));
  const state = {integrationImports: [{id: 'm1', farmKind: MESSAGE_KIND, ...rec}, {id: 'm2', farmKind: MESSAGE_KIND, ...facture, status: 'envoye'}]};
  assert.deepEqual(messageLog(state).map(m => m.id), ['m2', 'm1']);
  assert.deepEqual(messageLog(state, {role: 'operator', uid: 'u1'}).map(m => m.id), ['m1'], 'opérateur : ses messages seulement');
  assert.deepEqual(messageLog(state, {role: 'operator', uid: 'u2'}).map(m => m.id), [], 'opérateur : jamais la facturation');
  assert.deepEqual(messageLog(state, {role: 'viewer'}).map(m => m.id), ['m1']);
  assert.deepEqual(messageLog(state, {role: 'accountant'}).map(m => m.id), ['m2', 'm1']);
  assert.deepEqual(messageLog(state, {channel: 'email'}).map(m => m.id), ['m2']);
  assert.deepEqual(messageLog(state, {query: 'paul'}).map(m => m.id), ['m1']);
  assert.deepEqual(messageLog(state, {contextId: 'w1'}).map(m => m.id), ['m1']);
  assert.equal(canSeeMessage({deviceId: 'dev1'}, {role: 'operator', deviceId: 'dev1'}), true, 'mode local : messages de cet appareil');
  assert.equal(messageStats(messageLog(state)).envoye, 1);
  assert.equal(canSendMessages('viewer'), false);
  assert.equal(canSendMessages('operator'), true);
  assert.equal(canManageDirectory('operator'), false);
  assert.equal(canManageDirectory('editor'), true);
});

test('rôles : journal ouvert à l’opérateur et à la comptabilité, carnet et modèles à la gestion', () => {
  const op = kind => ({entity: 'integrationImports', action: 'update', farmKind: kind});
  assert.equal(canMutate('operator', op('message')), true);
  assert.equal(canMutate('operator', op('contact')), false);
  assert.equal(canMutate('operator', op('messageTemplate')), false);
  assert.equal(canMutate('accountant', op('message')), true);
  assert.equal(canMutate('accountant', op('contact')), false);
  assert.equal(canMutate('viewer', op('message')), false);
  assert.equal(canMutate('editor', op('contact')), true);
  assert.equal(canMutate('operator', op('sensor')), true, 'les autres enregistrements restent à l’opérateur');
});

test('passerelle : idempotence, adresse HTTPS, validation et réponse', () => {
  const k1 = messageIdempotencyKey('rec1', {phone: '06 12 34 56 78'}, 'sms');
  assert.equal(k1, messageIdempotencyKey('rec1', '+33612345678', 'sms'), 'même destinataire, même clé');
  assert.notEqual(k1, messageIdempotencyKey('rec1', '+33612345679', 'sms'));
  assert.notEqual(k1, messageIdempotencyKey('rec2', '+33612345678', 'sms'));
  assert.notEqual(k1, messageIdempotencyKey('rec1', '+33612345678', 'whatsapp'));
  assert.equal(gatewayEndpoint('https://msg.example.workers.dev/', 'send'), 'https://msg.example.workers.dev/send');
  assert.equal(gatewayEndpoint('https://x.dev/api?x=1', 'health'), 'https://x.dev/api/health');
  assert.throws(() => gatewayEndpoint('http://x.dev'), /HTTPS/);
  assert.throws(() => gatewayEndpoint(''), /Aucune/);
  const payload = gatewayPayload({channel: 'sms', idempotencyKey: 'pm-1', messages: [{to: '06 12 34 56 78', body: 'Salut', key: 'k'}, {to: '0711223344', body: 'Yo'}]});
  assert.deepEqual(payload.messages, [{to: '+33612345678', body: 'Salut', key: 'k'}, {to: '+33711223344', body: 'Yo', key: 'pm-1-1'}]);
  assert.throws(() => gatewayPayload({channel: 'whatsapp', messages: [{to: 'x', body: 'y'}]}), /SMS et des e-mails/);
  assert.throws(() => gatewayPayload({channel: 'sms', messages: [{to: '12', body: 'y'}]}), /Numéro invalide/);
  assert.throws(() => gatewayPayload({channel: 'sms', messages: [{to: '0612345678', body: 'a'.repeat(1600)}]}), /trop long/);
  assert.throws(() => gatewayPayload({channel: 'email', messages: [{to: 'nope', body: 'y'}]}), /Adresse invalide/);
  assert.throws(() => gatewayPayload({channel: 'sms', messages: []}), /Aucun destinataire/);
  assert.equal(gatewayPayload({channel: 'email', messages: [{to: 'a@b.fr', body: 'x'}], subject: 'S', sendAt: '2026-10-21T05:00:00Z'}).sendAt, '2026-10-21T05:00:00.000Z');
  assert.equal(parseGatewayResponse({results: [{to: '+33612345678', status: 'sent'}]}).status, 'envoye');
  assert.equal(parseGatewayResponse({results: [{to: 'a', status: 'duplicate'}]}).status, 'envoye', 'doublon reconnu : déjà envoyé');
  assert.equal(parseGatewayResponse({results: [{to: 'a', status: 'scheduled'}]}).status, 'programme');
  assert.equal(parseGatewayResponse({results: [{to: 'a', status: 'sent'}, {to: 'b', status: 'failed', error: 'Numéro inconnu'}]}).status, 'partiel');
  assert.deepEqual(parseGatewayResponse({}, 401), {status: 'echec', results: [], error: 'Jeton refusé par la passerelle.', retry: false});
  assert.equal(parseGatewayResponse({}, 503).retry, true);
  assert.equal(retryDelayMs(0), 30000);
  assert.equal(retryDelayMs(3), 240000);
  assert.equal(retryDelayMs(20), 3600000);
  const state = {integrationImports: [
    {id: 'a', farmKind: MESSAGE_KIND, status: 'attente', via: 'passerelle', deviceId: 'd1', attempts: 0},
    {id: 'b', farmKind: MESSAGE_KIND, status: 'attente', via: 'passerelle', deviceId: 'd2', attempts: 0},
    {id: 'c', farmKind: MESSAGE_KIND, status: 'attente', via: 'passerelle', deviceId: 'd1', attempts: 1, nextAttemptAt: 5000},
    {id: 'd', farmKind: MESSAGE_KIND, status: 'envoye', via: 'passerelle', deviceId: 'd1'}
  ]};
  assert.deepEqual(outboxDue(state, {deviceId: 'd1', now: 1000}).map(m => m.id), ['a'], 'un autre appareil ne renvoie pas');
  assert.deepEqual(outboxDue(state, {deviceId: 'd1', now: 6000}).map(m => m.id), ['a', 'c']);
});

test('rappel du soir : après l’heure choisie, une fois par jour', () => {
  const at = h => new Date(2026, 9, 20, h, 5);
  assert.equal(planReminderDue({enabled: false, now: at(19)}), false);
  assert.equal(planReminderDue({enabled: true, hour: 18, now: at(17)}), false);
  assert.equal(planReminderDue({enabled: true, hour: 18, now: at(18)}), true);
  assert.equal(planReminderDue({enabled: true, hour: 18, now: at(21), lastDay: '2026-10-20'}), false);
  assert.equal(planReminderDue({enabled: true, hour: 18, now: at(21), lastDay: '2026-10-19'}), true);
});

// ---------- Correctifs de relecture ----------
test('numéros : 06 81 / 06 87 / 06 89 restent en métropole, Saint-Pierre-et-Miquelon sans indicatif répété', () => {
  assert.equal(normalizePhone('06 81 12 34 56'), '+33681123456');
  assert.equal(normalizePhone('06 87 12 34 56'), '+33687123456');
  assert.equal(normalizePhone('0689123456'), '+33689123456');
  assert.equal(formatPhone('06 87 12 34 56'), '06 87 12 34 56');
  assert.equal(normalizePhone('05 08 41 12 34'), '+508411234');
  assert.equal(normalizePhone('0590 12 34 56'), '+590590123456');
});
test('destinataire saisi à la main : l’opposition du contact qui porte ce numéro ou cette adresse s’applique', () => {
  const contacts = messageContacts(base());
  const typed = freeRecipient('04 78 00 00 00', {contacts});
  assert.equal(consentStatus(typed, 'sms'), 'non');
  assert.equal(typed.name, 'Véto Rivière');
  assert.equal(typed.phone, '+33478000000');
  assert.equal(consentStatus(freeRecipient('0478000000'), 'sms'), 'inconnu', 'sans carnet : rien à reprendre');
  assert.equal(consentStatus(freeRecipient('VETO@example.fr', {contacts}), 'email'), 'inconnu', 'pas d’opposition par e-mail');
  assert.equal(addressConsent(contacts, {phone: '+33478000000'}).consent.sms.status, 'non');
  assert.equal(addressConsent(contacts, {phone: '0699999999'}), null);
  // Le même numéro chez deux contacts : l'opposition l'emporte.
  const twice = [{id: 'a', name: 'A', phones: ['+33478000000'], consent: {sms: {status: 'oui'}}}, ...contacts];
  assert.equal(addressConsent(twice, {phone: '04 78 00 00 00'}).consent.sms.status, 'non');
});
test('planning : un compte renommé reste une seule personne', () => {
  const state = {...base(), integrationImports: [], tasks: [], interventions: [
    {id: 'a', type: 'Labour', parcelId: 'p2', status: 'Prévu', plannedDate: '2026-10-21', assigneeId: 'u1', assigneeName: 'Paul'},
    {id: 'b', type: 'Semis', parcelId: 'p2', status: 'Prévu', plannedDate: '2026-10-21', assigneeId: 'u1', assigneeName: 'Paul Martin'},
    {id: 'c', type: 'Roulage', parcelId: 'p2', status: 'Prévu', plannedDate: '2026-10-21', assigneeId: 'u2', assigneeName: 'Paul'}
  ]};
  const people = dayPlanAssignees(state, {date: '2026-10-21'});
  assert.deepEqual(people.map(p => [p.id, p.count]).sort(), [['u1', 2], ['u2', 1]]);
});
test('passerelle : clé de planning stable, lignes acceptées et prochain réessai', () => {
  assert.equal(planIdempotencyId('2026-10-21', 'Bonjour Paul'), planIdempotencyId('2026-10-21', 'Bonjour Paul'));
  assert.notEqual(planIdempotencyId('2026-10-21', 'Bonjour Paul'), planIdempotencyId('2026-10-21', 'Bonjour Julie'));
  assert.notEqual(planIdempotencyId('2026-10-21', 'Bonjour Paul'), planIdempotencyId('2026-10-22', 'Bonjour Paul'));
  const ok = deliveredTo([{to: '+33612345678', status: 'sent'}, {to: '+33611111111', status: 'duplicate'}, {to: '+33622222222', status: 'failed'}]);
  assert.deepEqual([...ok].sort(), ['+33611111111', '+33612345678']);
  const msg = extra => ({farmKind: MESSAGE_KIND, via: 'passerelle', status: 'attente', deviceId: 'd1', attempts: 1, ...extra});
  const state = {integrationImports: [msg({id: 'a', nextAttemptAt: 5000}), msg({id: 'b', nextAttemptAt: 2000}), msg({id: 'c', nextAttemptAt: 1000, deviceId: 'd2'}), msg({id: 'd', nextAttemptAt: 10, attempts: GATEWAY_MAX_ATTEMPTS}), msg({id: 'e', nextAttemptAt: 1, status: 'envoye'})]};
  assert.equal(nextOutboxAt(state, {deviceId: 'd1'}), 2000);
  assert.equal(nextOutboxAt(state, {deviceId: 'd3'}), null);
});
test('journal : l’opérateur n’écrit que ses messages hors facturation, la comptabilité ceux de la facturation', () => {
  const op = (record, previous = null, uid = 'op') => ({entity: 'integrationImports', action: previous ? 'update' : 'create', farmKind: MESSAGE_KIND, record, previous, uid});
  const relance = {farmKind: MESSAGE_KIND, finance: true, authorUid: 'ac'};
  const planning = {farmKind: MESSAGE_KIND, finance: false, authorUid: 'op'};
  assert.equal(canMutate('operator', op(planning)), true);
  assert.equal(canMutate('operator', op({...relance, status: 'envoye'}, relance)), false);
  assert.equal(canMutate('operator', op({...relance, finance: false, authorUid: 'op'}, relance)), false, 'pas d’appropriation');
  assert.equal(canMutate('operator', op({...planning, authorUid: 'ac'})), false);
  assert.equal(canMutate('accountant', op(relance, relance, 'ac2')), true);
  assert.equal(canMutate('accountant', op({...planning, status: 'echec'}, planning, 'ac')), false);
  assert.equal(canMutate('owner', op({...relance}, relance, 'x')), true);
  assert.equal(messageWritable('operator', planning, ''), true, 'sans compte cloud : pas de contrôle d’auteur');
});
test('passerelle d’exemple : encodage Unicode dès qu’un caractère sort de l’alphabet GSM', () => {
  for (const body of ['Côte du Bois', 'fenêtre', 'maïs', 'garçon', 'été là-bas ?'.replace('é', 'â')]) assert.equal(needsUnicode(body), smsSegments(body).encoding === 'UCS-2', body);
  assert.equal(needsUnicode('Cote du Bois, fenetre a 8h : 12 EUR €'), false);
  assert.equal(needsUnicode('Fenêtre'), true);
  assert.equal(needsUnicode('Été là'), false);
});
