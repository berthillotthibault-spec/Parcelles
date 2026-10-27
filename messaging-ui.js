// Messages et notifications (v13) : centre des messages, carnet de contacts, modèles, composeur et
// « Envoyer le planning ». Module différé (lazy-modules.js, clé « messaging »), boutons [data-msg].
// Envoi par défaut depuis le téléphone (liens sms:, wa.me, mailto:, feuille de partage) : l'application
// ne sait pas si le message est parti, elle demande « Envoyé ? » et note sinon « Préparé ». En option,
// une passerelle HTTPS configurée par l'utilisateur (tools/worker-messages.example.js) envoie elle-même,
// avec une file de réessai hors connexion et un identifiant d'idempotence par destinataire.
import {
  MESSAGE_KIND, MESSAGE_TEMPLATE_KIND, CONTACT_KIND, CHANNELS, MESSAGE_STATUSES, CONTACT_ROLES, TEMPLATE_VARIABLES,
  normalizePhone, formatPhone, isMobile, validEmail, detectPlatform, smsUri, mailtoUri, whatsappUri, smsSegments, toGsm,
  renderTemplate, unresolvedVariables, messageTemplates, templateFor, templatePayload,
  contactPayload, messageContacts, contactGroups, contactForAssignee, consentStatus, channelFor, freeRecipient, addressConsent,
  dayPlanAssignees, dayPlanMessage, workInstructionMessage, dayLabel, farmVars, isoDay, addDays,
  messageRecord, messageLog, messageStats, canSendMessages, canManageDirectory, messageIdempotencyKey,
  gatewayEndpoint, gatewayPayload, parseGatewayResponse, retryDelayMs, outboxDue, nextOutboxAt, planIdempotencyId, deliveredTo, planReminderDue, normalizeName, GATEWAY_MAX_ATTEMPTS
} from './messaging.js';
import {html, raw} from './safe-html.js';
import {uid, downloadBlob} from './utils.js';

const PERSONAL_VARS = /\{(prenom|nom)\}/;
const REMINDER_KEY = 'parcelles:plan-reminder-day';
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const when = ms => { const d = new Date(Number(ms) || 0); return Number(ms) ? d.toLocaleString('fr-FR', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}) : ''; };
const STATUS_TONE = {envoye: 'ok', prepare: 'info', attente: 'warn', programme: 'info', echec: 'bad', annule: 'muted'};
// Actions data-msg qui écrivent (journal, contacts, envoi) : un second appui pendant l'écriture est ignoré.
const MSG_WRITES = new Set(['prepare', 'contact-save', 'template-save', 'settings-save', 'plan-all', 'plan-gateway', 'log-retry', 'log-sent', 'log-resend', 'contact-delete']);

export function createMessagingUI({store, state, modal, closeModal, toast, sync = null, role = () => 'owner', bindChipChoices = () => {}, doc = globalThis.document, nav = globalThis.navigator, win = globalThis, now = () => Date.now(), fetchImpl = (...a) => fetch(...a), storage = null} = {}) {
  const local = storage || (() => { try { return win.localStorage; } catch { return null; } })();
  const lsGet = key => { try { return local?.getItem(key) || ''; } catch { return ''; } };
  const lsSet = (key, value) => { try { if (value) local?.setItem(key, value); else local?.removeItem(key); } catch { /* stockage indisponible */ } };
  const data = () => state() || {};
  const prefs = () => data().preferences || {};
  const today = () => isoDay(new Date(now()));
  const currentRole = () => (typeof role === 'function' ? role() : role) || 'owner';
  const canSend = () => canSendMessages(currentRole()) && !store.tabReadOnly;
  const canManage = () => canManageDirectory(currentRole()) && !store.tabReadOnly;
  const platform = () => detectPlatform({userAgent: nav?.userAgent || '', maxTouchPoints: nav?.maxTouchPoints || 0});
  const deviceId = () => sync?.deviceId || lsGet('parcelles:device-id') || 'cet-appareil';
  const author = () => ({uid: sync?.user?.uid || '', name: String(prefs().teamIdentity || sync?.user?.displayName || '').trim()});
  const tokenKey = () => `parcelles:messaging-token:${store.workspaceId || 'local'}`;
  const gatewayToken = () => lsGet(tokenKey());
  const gatewayReady = () => Boolean(prefs().messagingGatewayEnabled && prefs().messagingGatewayUrl && gatewayToken());
  let members = [];
  let session = null; // composeur ou envoi en cours
  let plan = null; // « Envoyer le planning » en cours
  let centerFilters = {channel: '', status: '', query: ''};

  async function loadMembers() {
    if (!sync?.workspaceId || typeof sync.listMembers !== 'function') return members;
    try { members = await sync.listMembers(); } catch { /* hors connexion : membres déjà connus */ }
    return members;
  }
  const contacts = () => messageContacts(data(), {members});
  const contactById = id => contacts().find(c => c.id === id) || null;
  const record = id => store.get('integrationImports', id);

  async function saveRecord(kind, payload, existing = null, label = '') {
    const entity = {...(existing || {}), id: existing?.id || uid(kind), farmKind: kind, format: 'Parcelles', recordVersion: 1, ...payload};
    await store.upsert('integrationImports', entity, {label: label || payload.name || kind});
    return entity;
  }
  const fail = (form, message, field = null) => {
    const box = form?.querySelector('.form-error');
    if (box) { box.textContent = message; box.classList.remove('hidden'); }
    field?.focus?.();
  };

  // ——— Centre des messages ———
  function logHtml() {
    const list = messageLog(data(), {role: currentRole(), uid: author().uid, deviceId: deviceId(), ...centerFilters});
    if (!list.length) return html`<p class="msg-empty">${centerFilters.channel || centerFilters.status || centerFilters.query ? 'Aucun message ne correspond aux filtres.' : 'Aucun message pour l’instant. Les messages préparés ou envoyés depuis Parcelles s’affichent ici.'}</p>`;
    return html`<ul class="msg-log" aria-label="Journal des messages">${list.slice(0, 200).map(m => html`<li class="msg-log-row"><div class="msg-log-head"><span class="msg-pill is-${STATUS_TONE[m.status] || 'muted'}">${MESSAGE_STATUSES[m.status] || m.status}</span><small>${CHANNELS[m.channel] || m.channel}${m.via === 'passerelle' ? ' · automatique' : ''} · ${when(m.statusAt || m.createdAtMs)}</small></div>
      <strong class="msg-log-to">${(m.recipients || []).map(r => r.name || formatPhone(r.phone) || r.email).join(', ') || 'Sans destinataire'}</strong>
      ${m.subject ? html`<span class="msg-log-subject">${m.subject}</span>` : ''}<p class="msg-log-excerpt">${m.excerpt}</p>
      ${m.context?.label ? html`<small class="msg-log-context">Lié à : ${m.context.label}</small>` : ''}${m.error ? html`<small class="msg-log-error">${m.error}</small>` : ''}
      ${canSend() ? html`<div class="msg-log-actions">${m.status === 'prepare' ? html`<button type="button" class="small-button" data-msg="log-sent" data-id="${m.id}">Marquer envoyé</button>` : ''}${m.status === 'attente' || (m.status === 'echec' && m.via === 'passerelle') ? html`<button type="button" class="small-button" data-msg="log-retry" data-id="${m.id}">Réessayer</button>` : ''}<button type="button" class="small-button" data-msg="log-resend" data-id="${m.id}">Renvoyer</button></div>` : ''}</li>`)}</ul>`;
  }
  function centerBody() {
    const stats = messageStats(messageLog(data(), {role: currentRole(), uid: author().uid, deviceId: deviceId()}));
    const send = canSend();
    return html`<div class="msg-center" id="msg-center">
      ${send ? html`<div class="msg-tiles"><button type="button" class="msg-tile is-main" data-msg="plan" data-date="${today()}"><strong>Envoyer le planning</strong><small>Les travaux du jour à chaque personne, par SMS</small></button>
        <button type="button" class="msg-tile" data-msg="plan" data-date="${addDays(today(), 1)}"><strong>Planning de demain</strong><small>À préparer la veille</small></button>
        <button type="button" class="msg-tile" data-msg="compose"><strong>Nouveau message</strong><small>SMS, WhatsApp, e-mail</small></button></div>` : html`<p class="msg-note">Lecture seule : votre rôle ne permet pas d’envoyer de message.</p>`}
      <div class="menu-list msg-menu"><button type="button" class="menu-row" data-msg="contacts"><span><strong>Contacts</strong><small>Équipe, chauffeurs, clients, fournisseurs et groupes</small></span><b aria-hidden="true">›</b></button>
        <button type="button" class="menu-row" data-msg="templates"><span><strong>Modèles de messages</strong><small>Planning, consignes, rendez-vous, factures et relances</small></span><b aria-hidden="true">›</b></button>
        ${send ? html`<button type="button" class="menu-row" data-msg="settings"><span><strong>Réglages d’envoi</strong><small>${gatewayReady() ? 'Envoi automatique configuré' : 'Depuis ce téléphone'} · rappel du soir ${prefs().planReminderEnabled ? `à ${Number(prefs().planReminderHour ?? 18)} h` : 'désactivé'}</small></span><b aria-hidden="true">›</b></button>` : ''}</div>
      <h3 class="msg-h">Journal</h3>
      <p class="msg-stats">${plural(stats.envoye, 'envoyé', 'envoyés')} · ${plural(stats.prepare, 'préparé', 'préparés')}${stats.attente ? ` · ${stats.attente} en attente` : ''}${stats.programme ? ` · ${plural(stats.programme, 'programmé', 'programmés')}` : ''}${stats.echec ? ` · ${plural(stats.echec, 'échec', 'échecs')}` : ''}</p>
      <form class="msg-filters" id="msg-filters" role="search" novalidate>
        <label>Canal<select name="channel"><option value="">Tous</option>${Object.entries(CHANNELS).map(([k, v]) => html`<option value="${k}"${centerFilters.channel === k ? raw(' selected') : ''}>${v}</option>`)}</select></label>
        <label>Statut<select name="status"><option value="">Tous</option>${Object.entries(MESSAGE_STATUSES).map(([k, v]) => html`<option value="${k}"${centerFilters.status === k ? raw(' selected') : ''}>${v}</option>`)}</select></label>
        <label class="msg-filter-query">Rechercher<input name="query" type="search" value="${centerFilters.query}" placeholder="Nom, numéro, texte"></label>
      </form>
      <div id="msg-log-list">${logHtml()}</div></div>`;
  }
  function openMessagesCenter() {
    modal('Messages & SMS', 'Planning, consignes et notifications à l’équipe et aux clients', String(centerBody()), '', 'small');
    const form = doc.getElementById('msg-filters');
    const apply = () => { centerFilters = {channel: form.elements.channel.value, status: form.elements.status.value, query: form.elements.query.value}; const box = doc.getElementById('msg-log-list'); if (box) box.innerHTML = String(logHtml()); };
    form?.addEventListener('input', apply);
    form?.addEventListener('submit', event => event.preventDefault());
    loadMembers();
    flushOutbox();
  }
  const refreshCenter = () => { const box = doc.getElementById('msg-log-list'); if (box) box.innerHTML = String(logHtml()); };

  // ——— Contacts ———
  const kindLabel = {contact: 'Contacts', client: 'Clients', member: 'Membres de l’équipe'};
  function contactRow(c) {
    const reach = [c.phone ? formatPhone(c.phone) : '', c.email].filter(Boolean).join(' · ') || 'Ni numéro ni e-mail';
    return html`<li><button type="button" class="msg-contact-line" data-msg="contact" data-id="${c.id}"><span><strong>${c.name}</strong><small>${[c.role, reach].filter(Boolean).join(' · ')}</small></span>${(c.groups || []).length ? html`<span class="msg-groups">${c.groups.slice(0, 2).join(', ')}</span>` : ''}</button></li>`;
  }
  function openContacts({group = ''} = {}) {
    const all = contacts(), groups = contactGroups(all);
    const list = group ? all.filter(c => (c.groups || []).includes(group)) : all;
    const sections = ['contact', 'member', 'client'].map(kind => [kind, list.filter(c => c.kind === kind)]).filter(([, l]) => l.length);
    modal('Contacts', 'Équipe, chauffeurs, clients et prestataires', String(html`<div class="msg-contacts">
      ${groups.length ? html`<div class="chip-choices msg-group-chips" role="group" aria-label="Groupes"><button type="button" class="choice-chip${group ? '' : ' is-on'}" aria-pressed="${!group}" data-msg="contacts-group" data-value="">Tous</button>${groups.map(g => html`<button type="button" class="choice-chip${g.name === group ? ' is-on' : ''}" aria-pressed="${g.name === group}" data-msg="contacts-group" data-value="${g.name}">${g.name} (${g.contacts.length})</button>`)}</div>` : ''}
      ${sections.length ? sections.map(([kind, l]) => html`<h3 class="msg-h">${kindLabel[kind]}</h3><ul class="msg-contact-list">${l.map(contactRow)}</ul>`) : html`<p class="msg-empty">Aucun contact. Ajoutez vos chauffeurs, salariés, ETA, vétérinaire ou fournisseurs pour leur écrire en un geste.</p>`}
      ${group && canSend() ? html`<button type="button" class="button secondary msg-wide" data-msg="compose-group" data-value="${group}">Écrire au groupe « ${group} »</button>` : ''}
      <p class="msg-note">Les clients se gèrent dans Gestion › Clients ; les membres, dans Équipe et autorisations. Un contact libre peut être rattaché à une personne de « Confier à… » pour recevoir son planning.</p></div>`),
    canManage() ? '<button type="button" class="button primary msg-wide" data-msg="contact-new">Nouveau contact</button>' : '', 'small');
    loadMembers();
  }
  function openContact(id) {
    const c = contactById(id);
    if (!c) { toast('Contact introuvable.', 'error'); return; }
    const sms = consentStatus(c, 'sms'), mail = consentStatus(c, 'email');
    const consentText = status => status === 'oui' ? 'accord donné' : status === 'non' ? 'opposition : ne pas écrire' : 'non renseigné';
    const send = canSend();
    modal(c.name, `${c.role}${c.company && c.company !== c.name ? ` · ${c.company}` : ''}`, String(html`<div class="msg-contact-sheet">
      <dl class="msg-dl"><dt>Téléphone</dt><dd>${c.phones?.length ? c.phones.map(formatPhone).join(', ') : '—'}${c.phone && !isMobile(c.phone) ? ' (fixe : pas de SMS)' : ''}</dd><dt>E-mail</dt><dd>${c.email || '—'}</dd>
        ${c.groups?.length ? html`<dt>Groupes</dt><dd>${c.groups.join(', ')}</dd>` : ''}${c.kind === 'contact' ? html`<dt>Accord SMS</dt><dd>${consentText(sms)}${c.consent?.sms?.at ? ` (${c.consent.sms.at})` : ''}</dd><dt>Accord e-mail</dt><dd>${consentText(mail)}${c.consent?.email?.at ? ` (${c.consent.email.at})` : ''}</dd>` : ''}
        ${c.assigneeNames?.length && c.kind === 'contact' ? html`<dt>Rattaché à</dt><dd>${c.assigneeNames.join(', ')}</dd>` : ''}</dl>
      ${send ? html`<div class="msg-actions-row">${c.phone ? html`<button type="button" class="button secondary" data-msg="compose" data-to="${c.id}" data-channel="sms">SMS</button><button type="button" class="button secondary" data-msg="compose" data-to="${c.id}" data-channel="whatsapp">WhatsApp</button>` : ''}${c.email ? html`<button type="button" class="button secondary" data-msg="compose" data-to="${c.id}" data-channel="email">E-mail</button>` : ''}</div>
        ${c.kind !== 'client' ? html`<div class="msg-actions-row"><button type="button" class="button primary" data-msg="plan" data-date="${today()}" data-person="${c.id}">Planning d’aujourd’hui</button><button type="button" class="button secondary" data-msg="plan" data-date="${addDays(today(), 1)}" data-person="${c.id}">Planning de demain</button></div>` : ''}` : ''}
      <h3 class="msg-h">Derniers messages</h3>${(() => { const mine = messageLog(data(), {role: currentRole(), uid: author().uid, deviceId: deviceId()}).filter(m => (m.recipients || []).some(r => r.contactId === c.id || (c.phone && r.phone === c.phone) || (c.email && r.email === c.email))).slice(0, 5); return mine.length ? html`<ul class="msg-mini-log">${mine.map(m => html`<li><span class="msg-pill is-${STATUS_TONE[m.status] || 'muted'}">${MESSAGE_STATUSES[m.status]}</span> ${when(m.statusAt || m.createdAtMs)} · ${m.excerpt.slice(0, 80)}</li>`)}</ul>` : html`<p class="msg-empty">Aucun message.</p>`; })()}</div>`),
    `${c.kind === 'contact' && canManage() ? `<button type="button" class="button secondary" data-msg="contact-edit" data-id="${String(html`${c.id}`)}">Modifier</button>` : ''}<button type="button" class="button secondary" data-msg="contacts">Tous les contacts</button>`, 'small');
  }
  function consentField(channel, label, current) {
    const status = current?.status || '';
    return html`<fieldset class="msg-consent span-2"><legend>${label}</legend><input type="hidden" name="consent-${channel}" value="${status}">
      <div class="chip-choices" data-chip-target="consent-${channel}" role="group" aria-label="${label}">${[['oui', 'Accord donné'], ['non', 'Opposition'], ['', 'Non renseigné']].map(([v, t]) => html`<button type="button" class="choice-chip${status === v ? ' is-on' : ''}" data-value="${v}" aria-pressed="${status === v}">${t}</button>`)}</div>
      <label>Date de l’accord ou de l’opposition<input type="date" name="consent-${channel}-at" value="${current?.at || ''}"></label></fieldset>`;
  }
  let afterContactSave = null; // retour à « Envoyer le planning » après « Rattacher à un contact »
  async function openContactForm(id = null, {then = null, prefill = null} = {}) {
    afterContactSave = then;
    if (!canManage()) { toast('Votre rôle ne permet pas de modifier le carnet de contacts.', 'info'); return; }
    await loadMembers();
    const r = id ? record(id) : null;
    const people = [...new Set([...(data().interventions || []), ...(data().tasks || [])].filter(i => i && !i.deletedAt && i.assigneeName).map(i => String(i.assigneeName).trim()))].sort((a, b) => a.localeCompare(b, 'fr'));
    const groups = contactGroups(contacts()).map(g => g.name);
    modal(r ? 'Modifier le contact' : 'Nouveau contact', 'Téléphone, e-mail, groupes et accord RGPD', String(html`<form id="msg-contact-form" class="form-grid msg-form" novalidate>
      <label class="span-2">Nom *<input name="name" maxlength="80" autocomplete="name" value="${r?.name || ''}" data-autofocus></label>
      <label>Rôle<select name="role">${CONTACT_ROLES.map(x => html`<option${(r?.role || 'Chauffeur') === x ? raw(' selected') : ''}>${x}</option>`)}</select></label>
      <label>Canal préféré<select name="preferredChannel">${[['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail']].map(([v, t]) => html`<option value="${v}"${(r?.preferredChannel || 'sms') === v ? raw(' selected') : ''}>${t}</option>`)}</select></label>
      <label class="span-2">Téléphone(s)<input name="phones" type="tel" inputmode="tel" autocomplete="tel" value="${(r?.phones || []).map(formatPhone).join(', ')}" placeholder="06 12 34 56 78"><small class="form-note">Plusieurs numéros séparés par une virgule. Format français ou international (+32…).</small></label>
      <label class="span-2">E-mail<input name="email" type="email" autocomplete="email" value="${r?.email || ''}"></label>
      <label class="span-2">Groupes<input name="groups" list="msg-group-list" value="${(r?.groups || []).join(', ')}" placeholder="Ex. Chauffeurs, Moisson"><datalist id="msg-group-list">${['Chauffeurs', 'Équipe', 'Saisonniers', 'Prestataires', ...groups].filter((x, i, a) => a.indexOf(x) === i).map(g => html`<option value="${g}"></option>`)}</datalist></label>
      <label class="span-2">Nom dans « Confier à… »<input name="assigneeNames" list="msg-people-list" value="${(r?.assigneeNames || []).join(', ')}" placeholder="Ex. Paul"><datalist id="msg-people-list">${people.map(p => html`<option value="${p}"></option>`)}</datalist><small class="form-note">Les travaux confiés à ce nom arrivent dans son planning.</small></label>
      ${members.length ? html`<label class="span-2">Compte de l’équipe<select name="memberUid"><option value="">Aucun</option>${members.map(m => html`<option value="${m.uid || m.id}"${r?.memberUid === (m.uid || m.id) ? raw(' selected') : ''}>${m.displayName || m.email || m.id}</option>`)}</select></label>` : ''}
      ${consentField('sms', 'Accord pour les SMS et WhatsApp', r?.consent?.sms)}
      ${consentField('email', 'Accord pour les e-mails', r?.consent?.email)}
      <p class="span-2 form-note">RGPD : notez l’accord ou l’opposition de la personne et sa date. Une opposition bloque l’envoi par ce canal. Les messages de travail à vos salariés relèvent du contrat ; les messages commerciaux demandent un accord.</p>
      <label class="span-2">Note<textarea name="note" rows="2" maxlength="500">${r?.note || ''}</textarea></label>
      <p class="span-2 form-error hidden" role="alert"></p></form>`),
    `${r ? `<button type="button" class="button secondary" data-msg="contact-delete" data-id="${String(html`${r.id}`)}">Supprimer</button>` : ''}<button type="button" class="button primary" data-msg="contact-save" data-id="${String(html`${r?.id || ''}`)}">Enregistrer</button>`, 'small');
    const form = doc.getElementById('msg-contact-form');
    if (form) bindChipChoices(form);
    if (form && prefill) for (const [k, v] of Object.entries(prefill)) if (form.elements[k] && v) form.elements[k].value = v;
  }
  async function saveContact(id) {
    const form = doc.getElementById('msg-contact-form');
    if (!form) return;
    const f = form.elements, existing = id ? record(id) : null;
    const consent = {};
    for (const ch of ['sms', 'email']) { const status = f[`consent-${ch}`].value; if (status) consent[ch] = {status, at: f[`consent-${ch}-at`].value || today(), source: existing?.consent?.[ch]?.status === status ? existing.consent[ch].source || '' : 'saisie'}; }
    try {
      const payload = contactPayload({name: f.name.value, role: f.role.value, phones: f.phones.value, email: f.email.value, preferredChannel: f.preferredChannel.value, groups: f.groups.value, assigneeNames: f.assigneeNames.value, memberUid: f.memberUid?.value || '', consent, note: f.note.value}, {today: today()});
      const saved = await saveRecord(CONTACT_KIND, payload, existing, `Contact ${existing ? 'modifié' : 'ajouté'} : ${payload.name}`);
      toast(`Contact enregistré : ${payload.name}.`);
      if (afterContactSave) { const back = afterContactSave; afterContactSave = null; back(saved.id); return; }
      openContact(saved.id);
    } catch (error) { fail(form, error?.message || 'Enregistrement impossible.', error?.message?.includes('Nom') ? f.name : null); }
  }
  async function deleteContact(id) {
    const r = record(id);
    if (!r || !canManage()) return;
    await store.remove('integrationImports', id);
    toast(`Contact placé dans la corbeille : ${r.name}.`);
    openContacts();
  }

  // ——— Modèles ———
  function openTemplates() {
    const list = messageTemplates(data()), cats = [...new Set(list.map(t => t.category))];
    modal('Modèles de messages', 'Textes personnalisables avec variables', String(html`<div class="msg-templates">${cats.map(cat => html`<h3 class="msg-h">${cat}</h3><ul class="msg-contact-list">${list.filter(t => t.category === cat).map(t => html`<li><button type="button" class="msg-contact-line" data-msg="template" data-key="${t.key}"><span><strong>${t.name}</strong><small>${CHANNELS[t.channel] || ''}${t.builtin ? (t.customized ? ' · personnalisé' : ' · fourni') : ' · le vôtre'} · ${t.body.replace(/\s+/g, ' ').slice(0, 70)}…</small></span></button></li>`)}</ul>`)}</div>`),
    canManage() ? '<button type="button" class="button primary msg-wide" data-msg="template" data-key="">Nouveau modèle</button>' : '', 'small');
  }
  const SAMPLE_VARS = {prenom: 'Paul', nom: 'Paul Martin', date: 'mardi 20/10', heure: '14:00', travaux: '1. 08:00 Semis - Grand Champ (12,5 ha)\n   Produit : Blé 180 kg/ha', lieu: 'la ferme', meteo: 'orages et rafales a 70 km/h', numero: 'F2026-0042', montant: '1 250,00 EUR', echeance: '20/11/2026', lien: 'https://exemple.fr/f/42'};
  function previewOf(body) { return renderTemplate(body, {...SAMPLE_VARS, ...farmVars(data())}); }
  function counterText(body, channel) {
    if (channel !== 'sms') return `${[...String(body || '')].length} caractères`;
    const s = smsSegments(body);
    return `${s.length} caractères · ${plural(s.segments || 1, 'SMS', 'SMS')}${s.encoding === 'UCS-2' ? ` (caractères spéciaux : ${s.nonGsm.slice(0, 5).join(' ')}, 70 par SMS)` : ''}`;
  }
  function openTemplateForm(key) {
    const t = key ? templateFor(data(), key) : null;
    const editable = canManage();
    modal(t ? t.name : 'Nouveau modèle', t?.builtin ? 'Modèle fourni : vos modifications le remplacent' : 'Variables entre accolades, remplacées à l’envoi', String(html`<form id="msg-template-form" class="form-grid msg-form" novalidate>
      <label class="span-2">Nom *<input name="name" maxlength="80" value="${t?.name || ''}"${editable ? '' : raw(' readonly')}></label>
      <label>Canal conseillé<select name="channel"${editable ? '' : raw(' disabled')}>${Object.entries(CHANNELS).map(([k, v]) => html`<option value="${k}"${(t?.channel || 'sms') === k ? raw(' selected') : ''}>${v}</option>`)}</select></label>
      <label>Catégorie<input name="category" maxlength="40" value="${t?.category || 'Mes modèles'}"${t?.builtin || !editable ? raw(' readonly') : ''}></label>
      <label class="span-2">Objet (e-mail)<input name="subject" maxlength="200" value="${t?.subject || ''}"${editable ? '' : raw(' readonly')}></label>
      <label class="span-2">Texte *<textarea name="body" rows="8" maxlength="4000"${editable ? '' : raw(' readonly')}>${t?.body || ''}</textarea></label>
      <p class="span-2 msg-counter" id="msg-template-counter" aria-live="polite">${counterText(previewOf(t?.body || ''), t?.channel || 'sms')}</p>
      ${editable ? html`<div class="span-2 msg-vars" role="group" aria-label="Insérer une variable">${TEMPLATE_VARIABLES.map(([v, label]) => html`<button type="button" class="small-button" data-msg="insert-var" data-value="${v}" title="${label}">{${v}}</button>`)}</div>` : ''}
      <div class="span-2 msg-preview"><p class="msg-preview-title">Aperçu avec des valeurs d’exemple</p><pre id="msg-template-preview">${previewOf(t?.body || '')}</pre></div>
      <p class="span-2 form-error hidden" role="alert"></p></form>`),
    editable ? `${t?.customized ? `<button type="button" class="button secondary" data-msg="template-reset" data-key="${String(html`${t.key}`)}">${t.builtin ? 'Rétablir le texte fourni' : 'Supprimer'}</button>` : ''}<button type="button" class="button primary" data-msg="template-save" data-key="${String(html`${t?.key || ''}`)}">Enregistrer</button>` : '', 'small');
    const form = doc.getElementById('msg-template-form');
    const update = () => { const body = form.elements.body.value; doc.getElementById('msg-template-preview').textContent = previewOf(body); doc.getElementById('msg-template-counter').textContent = counterText(previewOf(body), form.elements.channel.value); };
    form?.addEventListener('input', update);
  }
  function insertVariable(name) {
    const area = doc.querySelector('#msg-template-form textarea[name="body"], #msg-compose textarea[name="body"]');
    if (!area) return;
    const start = area.selectionStart ?? area.value.length, end = area.selectionEnd ?? start, token = `{${name}}`;
    area.value = `${area.value.slice(0, start)}${token}${area.value.slice(end)}`;
    area.focus(); area.selectionStart = area.selectionEnd = start + token.length;
    area.dispatchEvent(new Event('input', {bubbles: true}));
  }
  async function saveTemplate(key) {
    const form = doc.getElementById('msg-template-form');
    if (!form) return;
    const t = key ? templateFor(data(), key) : null;
    try {
      const payload = templatePayload({name: form.elements.name.value, channel: form.elements.channel.value, category: t?.builtin ? t.category : form.elements.category.value, subject: form.elements.subject.value, body: form.elements.body.value, key: t?.builtin ? t.key : (t?.key || '')});
      await saveRecord(MESSAGE_TEMPLATE_KIND, payload, t?.recordId ? record(t.recordId) : null, `Modèle enregistré : ${payload.name}`);
      toast(`Modèle enregistré : ${payload.name}.`);
      openTemplates();
    } catch (error) { fail(form, error?.message || 'Enregistrement impossible.'); }
  }
  async function resetTemplate(key) {
    const t = templateFor(data(), key);
    if (!t?.recordId) return;
    await store.remove('integrationImports', t.recordId);
    toast(t.builtin ? 'Texte fourni rétabli.' : 'Modèle supprimé.');
    openTemplates();
  }

  // ——— Composeur ———
  function asRecipient(value) {
    if (!value) return null;
    if (typeof value === 'string') return contactById(value) || freeRecipient(value, {contacts: contacts()});
    const phone = normalizePhone(value.phone) || '', email = validEmail(value.email) ? String(value.email).trim() : '';
    const known = value.id ? contactById(value.id) : null;
    if (known) return known;
    if (!phone && !email && !value.name) return null;
    // Numéro ou adresse d'un contact du carnet : son opposition s'applique aussi à ce destinataire.
    const consent = addressConsent(contacts(), {phone, email})?.consent || {};
    return {id: value.contactId || `libre:${phone || email || value.name}`, kind: 'libre', name: String(value.name || formatPhone(phone) || email), phone, phones: phone ? [phone] : [], email, groups: [], consent};
  }
  /**
   * Ouvre le composeur. Renvoie une promesse résolue à la fermeture : {sent, channel, recordId}.
   * @param {{recipients?:Array<string|{name?:string,phone?:string,email?:string}>, channel?:string, subject?:string, body?:string, files?:Array<Blob>, context?:{entity?:string,id?:string,kind?:string,label?:string}, templateKey?:string, vars?:Object}} [options]
   */
  function openComposer({recipients = [], channel = 'auto', subject = '', body = '', files = [], context = null, templateKey = '', vars = {}} = {}) {
    if (!canSend()) { toast('Votre rôle ne permet pas d’envoyer de message.', 'info'); return Promise.resolve({sent: false, channel, recordId: null}); }
    finishSession();
    const template = templateKey ? templateFor(data(), templateKey) : null;
    return new Promise(resolve => {
      session = {
        id: uid('compose'), resolve, context, vars: vars || {}, templateKey: template?.key || templateKey || '',
        recipients: [].concat(recipients).map(asRecipient).filter(Boolean),
        channel: CHANNELS[channel] || channel === 'auto' ? channel : 'auto',
        subject: subject || template?.subject || '', body: body || template?.body || '',
        files: [].concat(files).filter(f => f && typeof f === 'object' && 'size' in f).map((f, i) => (f.name ? f : new File([f], `piece-jointe-${i + 1}.pdf`, {type: f.type || 'application/pdf'}))),
        mode: gatewayReady() ? 'gateway' : 'device', sendAt: '', recordId: null, sent: false, links: []
      };
      if (session.channel === 'auto' && session.recipients.length) session.channel = channelFor(session.recipients[0], 'auto') || 'sms';
      if (session.channel === 'auto') session.channel = 'sms';
      renderComposer();
      loadMembers();
    });
  }
  function finishSession() {
    if (!session) return;
    const s = session; session = null;
    s.observer?.disconnect();
    s.resolve?.({sent: s.sent, channel: s.channel, recordId: s.recordId});
  }
  // Fermeture de la fenêtre (croix, Échap, autre écran) : la promesse du composeur est résolue.
  function watchSession() {
    const root = doc.getElementById('modal-root');
    if (!root || !session || typeof MutationObserver === 'undefined') return;
    session.observer?.disconnect();
    const id = session.id;
    session.observer = new MutationObserver(() => { if (session?.id === id && !root.querySelector(`[data-msg-session="${id}"]`)) finishSession(); });
    session.observer.observe(root, {childList: true});
  }
  const varsFor = recipient => {
    const name = String(recipient?.name || '').trim();
    return {...farmVars(data()), ...session.vars, ...(name ? {prenom: name.split(/\s+/)[0], nom: name} : {})};
  };
  const recipientChannel = r => (session.channel === 'share' ? 'share' : channelFor(r, session.channel));
  function recipientsHtml() {
    return html`${session.recipients.length ? html`<ul class="msg-rcpts">${session.recipients.map(r => html`<li class="msg-rcpt"><span>${r.name}<small>${session.channel === 'email' ? r.email || 'sans e-mail' : session.channel === 'share' ? '' : r.phone ? formatPhone(r.phone) : 'sans numéro'}</small></span><button type="button" class="msg-rcpt-x" data-msg="rcpt-remove" data-id="${r.id}" aria-label="Retirer ${r.name}">×</button></li>`)}</ul>` : html`<p class="msg-note">${session.channel === 'share' ? 'Le partage vous laisse choisir l’application et le destinataire.' : 'Aucun destinataire.'}</p>`}`;
  }
  function warningsHtml() {
    const out = [];
    for (const r of session.recipients) {
      const ch = recipientChannel(r);
      if (session.channel === 'share') break;
      if (!ch) out.push(`${r.name} : ${session.channel === 'email' ? 'pas d’adresse e-mail' : 'pas de numéro'}.`);
      else if (consentStatus(r, ch) === 'non') out.push(`${r.name} s’est opposé(e) à ce canal : il ne recevra rien.`);
      else if ((ch === 'sms') && r.phone && !isMobile(r.phone)) out.push(`${r.name} : numéro fixe, le SMS risque de ne pas arriver.`);
    }
    const sample = renderTemplate(session.body, varsFor(session.recipients[0]));
    const missing = unresolvedVariables(`${session.subject} ${sample}`);
    if (missing.length) out.push(`Variables sans valeur : ${missing.map(v => `{${v}}`).join(', ')}. Remplacez-les avant l’envoi.`);
    if (session.files.length && session.channel === 'sms') out.push('Un SMS ne transporte pas de pièce jointe : choisissez E-mail ou Partager.');
    return out.length ? html`<ul class="msg-warnings">${out.map(w => html`<li>${w}</li>`)}</ul>` : '';
  }
  function composerFormHtml() {
    const all = contacts().filter(c => !session.recipients.some(r => r.id === c.id)), groups = contactGroups(contacts());
    const templates = messageTemplates(data());
    const gateway = gatewayReady() && (session.channel === 'sms' || session.channel === 'email');
    const sample = renderTemplate(session.body, varsFor(session.recipients[0]));
    return html`<form id="msg-compose" class="msg-compose" data-msg-session="${session.id}" novalidate>
      <fieldset class="msg-fieldset"><legend>Destinataires</legend><div id="msg-rcpts">${recipientsHtml()}</div>
        <div class="msg-add"><label>Ajouter<select name="add"><option value="">Choisir…</option>${groups.length ? html`<optgroup label="Groupes">${groups.map(g => html`<option value="group:${g.name}">${g.name} (${g.contacts.length})</option>`)}</optgroup>` : ''}${['contact', 'member', 'client'].map(kind => { const l = all.filter(c => c.kind === kind); return l.length ? html`<optgroup label="${({contact: 'Contacts', member: 'Équipe', client: 'Clients'})[kind]}">${l.map(c => html`<option value="${c.id}">${c.name}${c.role ? ` · ${c.role}` : ''}</option>`)}</optgroup>` : ''; })}</select></label>
          <label>Ou numéro / e-mail<span class="msg-inline"><input name="free" inputmode="email" autocomplete="off" placeholder="06 12 34 56 78"><button type="button" class="small-button" data-msg="rcpt-free">Ajouter</button></span></label></div></fieldset>
      <fieldset class="msg-fieldset"><legend>Canal</legend><div class="chip-choices" role="group" aria-label="Canal">${Object.entries(CHANNELS).map(([k, v]) => html`<button type="button" class="choice-chip${session.channel === k ? ' is-on' : ''}" aria-pressed="${session.channel === k}" data-msg="channel" data-value="${k}">${v}</button>`)}</div></fieldset>
      <label>Modèle<select name="template"><option value="">Texte libre</option>${templates.map(t => html`<option value="${t.key}"${session.templateKey === t.key ? raw(' selected') : ''}>${t.category} · ${t.name}</option>`)}</select></label>
      ${session.channel === 'email' || session.channel === 'share' ? html`<label>Objet<input name="subject" maxlength="200" value="${session.subject}"></label>` : ''}
      <label>Message<textarea name="body" rows="7" maxlength="4000">${session.body}</textarea></label>
      <div class="msg-counter-row"><p class="msg-counter" id="msg-counter" aria-live="polite">${counterText(sample, session.channel)}</p>${session.channel === 'sms' || session.channel === 'whatsapp' ? html`<button type="button" class="small-button" data-msg="gsm" title="Remplace ê, ç, apostrophes typographiques… pour tenir en 160 caractères par SMS">Simplifier les caractères</button>` : ''}</div>
      ${session.channel === 'email' || session.channel === 'share' ? html`<div class="msg-files"><p class="msg-preview-title">Pièces jointes</p>${session.files.length ? html`<ul>${session.files.map((f, i) => html`<li>${f.name} (${Math.max(1, Math.round(f.size / 1024))} Ko) <button type="button" class="msg-rcpt-x" data-msg="file-remove" data-index="${i}" aria-label="Retirer ${f.name}">×</button></li>`)}</ul>` : ''}<label class="small-button msg-file-pick">Joindre un fichier<input type="file" name="file" class="sr-only" multiple accept="application/pdf,image/*"></label></div>` : ''}
      <div id="msg-warn" role="status">${warningsHtml()}</div>
      <details class="msg-preview"${session.recipients.length > 1 || PERSONAL_VARS.test(session.body) ? raw(' open') : ''}><summary>Aperçu${session.recipients[0] ? ` pour ${session.recipients[0].name}` : ''}</summary><pre id="msg-preview">${sample}</pre></details>
      ${gateway ? html`<fieldset class="msg-fieldset"><legend>Envoi</legend><div class="chip-choices" role="group" aria-label="Mode d’envoi"><button type="button" class="choice-chip${session.mode === 'device' ? ' is-on' : ''}" aria-pressed="${session.mode === 'device'}" data-msg="mode" data-value="device">Depuis ce téléphone</button><button type="button" class="choice-chip${session.mode === 'gateway' ? ' is-on' : ''}" aria-pressed="${session.mode === 'gateway'}" data-msg="mode" data-value="gateway">Automatique (passerelle)</button></div>
        ${session.mode === 'gateway' ? html`<label>Programmer (facultatif)<input type="datetime-local" name="sendAt" value="${session.sendAt}"></label>` : ''}</fieldset>` : ''}
      <p class="form-error hidden" role="alert"></p></form>`;
  }
  function renderComposer() {
    modal('Nouveau message', session.context?.label || 'SMS, WhatsApp, e-mail ou partage', String(composerFormHtml()), '<button type="button" class="button secondary" data-action="close-modal">Annuler</button><button type="button" class="button primary" data-msg="prepare">Préparer l’envoi</button>', 'small');
    renderComposerListeners();
    watchSession();
  }
  function rerenderComposer() { const form = doc.getElementById('msg-compose'); if (form) { form.outerHTML = String(composerFormHtml()); renderComposerListeners(); } }
  function renderComposerListeners() {
    // Le formulaire a été remplacé : on rebranche les écouteurs (la fenêtre, elle, reste ouverte).
    const form = doc.getElementById('msg-compose');
    if (!form) return;
    form.addEventListener('input', event => { const t = event.target; if (t.name === 'body') session.body = t.value; else if (t.name === 'subject') session.subject = t.value; else if (t.name === 'sendAt') session.sendAt = t.value; else return; refreshComposerBits(); });
    form.addEventListener('change', event => { const t = event.target; if (t.name === 'add' && t.value) addRecipients(t.value); else if (t.name === 'template') applyTemplate(t.value); else if (t.name === 'file' && t.files?.length) { session.files.push(...t.files); rerenderComposer(); } });
    form.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.name === 'free') { event.preventDefault(); addFree(); } });
  }
  function refreshComposerBits() {
    const sample = renderTemplate(session.body, varsFor(session.recipients[0]));
    const counter = doc.getElementById('msg-counter'), preview = doc.getElementById('msg-preview'), warn = doc.getElementById('msg-warn');
    if (counter) counter.textContent = counterText(sample, session.channel);
    if (preview) preview.textContent = sample;
    if (warn) warn.innerHTML = String(warningsHtml());
  }
  function addRecipients(value) {
    const all = contacts();
    const add = value.startsWith('group:') ? all.filter(c => (c.groups || []).includes(value.slice(6))) : [all.find(c => c.id === value)].filter(Boolean);
    for (const c of add) if (!session.recipients.some(r => r.id === c.id)) session.recipients.push(c);
    rerenderComposer();
  }
  function addFree() {
    const form = doc.getElementById('msg-compose'), input = form?.elements.free;
    const r = freeRecipient(input?.value, {contacts: contacts()});
    if (!r) { fail(form, 'Numéro ou adresse e-mail illisible.', input); return; }
    if (!session.recipients.some(x => x.id === r.id)) session.recipients.push(r);
    rerenderComposer();
  }
  function applyTemplate(key) {
    const t = templateFor(data(), key);
    session.templateKey = key || '';
    if (t) { session.body = t.body; session.subject = t.subject || session.subject; if (t.channel && session.recipients.every(r => channelFor(r, t.channel))) session.channel = t.channel; }
    rerenderComposer();
  }

  // Préparer l'envoi : contrôle, puis liste des envois (téléphone) ou appel de la passerelle.
  async function prepare() {
    const form = doc.getElementById('msg-compose');
    if (!form || !session) return;
    session.body = form.elements.body.value; if (form.elements.subject) session.subject = form.elements.subject.value;
    if (!session.body.trim()) return fail(form, 'Champ obligatoire : message.', form.elements.body);
    if (session.channel !== 'share' && !session.recipients.length) return fail(form, 'Ajoutez au moins un destinataire.', form.elements.add);
    const targets = [], skipped = [];
    for (const r of session.recipients) {
      const ch = recipientChannel(r);
      if (!ch) { skipped.push(`${r.name} (${session.channel === 'email' ? 'pas d’e-mail' : 'pas de numéro'})`); continue; }
      if (consentStatus(r, ch) === 'non') { skipped.push(`${r.name} (opposition)`); continue; }
      const vars = varsFor(r);
      targets.push({recipient: r, channel: ch, body: renderTemplate(session.body, vars), subject: renderTemplate(session.subject, vars)});
    }
    if (session.channel !== 'share' && !targets.length) return fail(form, `Personne ne peut recevoir ce message : ${skipped.join(', ')}.`);
    const missing = unresolvedVariables(targets.map(t => `${t.subject} ${t.body}`).join(' ') || renderTemplate(`${session.subject} ${session.body}`, varsFor(null)));
    if (missing.length) return fail(form, `Variables sans valeur : ${missing.map(v => `{${v}}`).join(', ')}. Remplacez-les dans le texte.`, form.elements.body);
    if (session.mode === 'gateway' && gatewayReady() && (session.channel === 'sms' || session.channel === 'email')) return sendViaGateway(targets, skipped);
    return showDeviceSend(targets, skipped);
  }
  async function logRecord(payload, existing = null) {
    try { return await saveRecord(MESSAGE_KIND, payload, existing, `Message ${MESSAGE_STATUSES[payload.status]?.toLowerCase() || ''} : ${payload.name}`); }
    catch (error) { toast(error?.message || 'Journal des messages indisponible.', 'warning'); return null; }
  }
  function baseRecord(targets, {status = 'prepare', via = 'appareil', sendAt = ''} = {}) {
    return messageRecord({channel: session.channel, recipients: targets.map(t => ({contactId: t.recipient.kind === 'libre' ? '' : t.recipient.id, name: t.recipient.name, phone: t.recipient.phone, email: t.recipient.email})), subject: targets[0]?.subject || session.subject, body: targets[0]?.body || session.body, status, via, context: session.context, deviceId: deviceId(), author: author(), now: now(), templateKey: session.templateKey, attachments: session.files, sendAt});
  }

  // Envoi par le téléphone : un lien par destinataire (SMS, WhatsApp), un e-mail groupé si le texte n'est pas personnalisé.
  async function showDeviceSend(targets, skipped) {
    const ch = session.channel, p = platform();
    const personal = PERSONAL_VARS.test(`${session.subject} ${session.body}`);
    let links;
    if (ch === 'share') links = [{label: 'Partager', share: true, body: targets[0]?.body || renderTemplate(session.body, varsFor(null)), subject: targets[0]?.subject || renderTemplate(session.subject, varsFor(null)), names: targets.map(t => t.recipient.name)}];
    else if (ch === 'email' && !personal && targets.length > 1) links = [{label: `E-mail à ${plural(targets.length, 'destinataire', 'destinataires')} (copie cachée)`, href: mailtoUri({bcc: targets.map(t => t.recipient.email), subject: targets[0].subject, body: targets[0].body}), names: targets.map(t => t.recipient.name), indexes: targets.map((_, i) => i)}];
    else links = targets.map((t, i) => ({label: t.recipient.name, detail: t.channel === 'email' ? t.recipient.email : formatPhone(t.recipient.phone), href: t.channel === 'email' ? mailtoUri({to: [t.recipient.email], subject: t.subject, body: t.body}) : t.channel === 'whatsapp' ? whatsappUri({phone: t.recipient.phone, body: t.body}) : smsUri({phones: [t.recipient.phone], body: t.body, platform: p}), names: [t.recipient.name], indexes: [i], channel: t.channel}));
    const rec = await logRecord({...baseRecord(targets), results: targets.map(t => ({to: t.recipient.phone || t.recipient.email || t.recipient.name, status: 'prepare'}))});
    session.recordId = rec?.id || null;
    session.links = links.map(l => ({...l, done: false}));
    session.targets = targets;
    const canFiles = session.files.length && typeof nav?.share === 'function' && nav?.canShare?.({files: session.files});
    const opener = l => l.channel === 'whatsapp' ? 'Ouvrir WhatsApp' : l.channel === 'email' || ch === 'email' ? 'Ouvrir l’e-mail' : 'Ouvrir le SMS';
    modal('Envoyer', ch === 'share' ? 'Choisissez l’application dans la feuille de partage' : 'Touchez chaque bouton : le message s’ouvre prérempli, il ne reste qu’à l’envoyer', String(html`<div class="msg-send" data-msg-session="${session.id}">
      ${skipped.length ? html`<p class="msg-warnings">Non envoyé à : ${skipped.join(', ')}.</p>` : ''}
      ${session.files.length && ch === 'email' ? html`<div class="msg-note">${canFiles ? html`Le lien e-mail ne peut pas joindre de fichier : utilisez « Partager avec les pièces jointes » puis choisissez votre messagerie.<button type="button" class="button primary msg-wide" data-msg="share-files">Partager avec les pièces jointes</button>` : html`Le lien e-mail ne peut pas joindre de fichier : téléchargez-le puis ajoutez-le au message.<button type="button" class="button secondary msg-wide" data-msg="download-files">Télécharger les pièces jointes</button>`}</div>` : ''}
      <ul class="msg-send-list">${session.links.map((l, i) => html`<li class="msg-send-row" data-index="${i}"><span class="msg-send-who"><strong>${l.label}</strong>${l.detail ? html`<small>${l.detail}</small>` : ''}</span>
        ${l.share ? html`<button type="button" class="button primary" data-msg="share-open" data-index="${i}">Partager</button>` : html`<a class="button primary" href="${l.href}" data-msg-link="${i}"${l.href.startsWith('https:') ? raw(' target="_blank" rel="noopener"') : ''}>${opener(l)}</a>`}
        <button type="button" class="button secondary msg-sent-toggle" data-msg="mark-sent" data-index="${i}" aria-pressed="false">Envoyé ?</button></li>`)}</ul>
      <p class="msg-note">Parcelles ne voit pas votre application de messagerie : confirmez « Envoyé » une fois le message parti. Sinon il reste noté « Préparé » dans le journal.</p></div>`),
    '<button type="button" class="button primary" data-msg="send-done">Terminé</button>', 'small');
    watchSession();
  }
  async function updateDeviceRecord() {
    if (!session?.recordId) return;
    const rec = record(session.recordId);
    if (!rec) return;
    const sentIdx = new Set(session.links.flatMap((l, i) => (l.done ? (l.indexes || [i]) : [])));
    const results = (session.targets || []).map((t, i) => ({to: t.recipient.phone || t.recipient.email || t.recipient.name, status: sentIdx.has(i) || (session.channel === 'share' && session.links[0]?.done) ? 'sent' : 'prepare'}));
    const all = session.links.every(l => l.done), any = session.links.some(l => l.done);
    await logRecord({...rec, results, status: all || (session.channel === 'share' && any) ? 'envoye' : 'prepare', statusAt: now(), sentAt: any ? now() : null}, rec);
    session.sent = any;
  }
  async function markSent(index) {
    const l = session?.links?.[index];
    if (!l) return;
    l.done = !l.done;
    paintSent(index);
    await updateDeviceRecord();
  }
  function paintSent(index) {
    const l = session?.links?.[index], btn = doc.querySelector(`.msg-send-row[data-index="${index}"] .msg-sent-toggle`);
    if (l && btn) { btn.setAttribute('aria-pressed', String(l.done)); btn.textContent = l.done ? 'Envoyé ✓' : 'Envoyé ?'; btn.classList.toggle('is-on', l.done); }
  }
  async function shareOpen(index, {withFiles = false} = {}) {
    // Lien e-mail ou SMS : il ne garde que l'adresse ; le texte et l'objet viennent du destinataire (sinon le premier).
    const link = session?.links?.[index] || {}, target = session?.targets?.[link.indexes?.[0] ?? 0] || session?.targets?.[0] || {};
    const l = {...link, body: link.body ?? target.body ?? '', subject: link.subject ?? target.subject ?? ''};
    const files = session.files.length && nav?.canShare?.({files: session.files}) ? session.files : [];
    if (typeof nav?.share !== 'function') {
      try { await nav?.clipboard?.writeText?.(l.body); toast('Partage indisponible : texte copié dans le presse-papiers.'); } catch { toast('Partage indisponible sur ce navigateur.', 'error'); }
      return;
    }
    try {
      await nav.share({title: l.subject || 'Parcelles', text: l.body, ...(files.length ? {files} : {})});
      if (withFiles || session.channel === 'share') { session.links.forEach((x, i) => { x.done = true; paintSent(i); }); await updateDeviceRecord(); toast('Partagé.'); }
    } catch (error) { if (error?.name !== 'AbortError') toast(error?.message || 'Partage impossible.', 'error'); }
  }
  function downloadFiles() { for (const f of session?.files || []) downloadBlob(f.name, f); }

  // ——— Passerelle ———
  async function callGateway(path, payload, {timeoutMs = 15000} = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(gatewayEndpoint(prefs().messagingGatewayUrl, path), {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${gatewayToken()}`}, body: JSON.stringify(payload), signal: controller?.signal});
      let json = null;
      try { json = await response.json(); } catch { json = null; }
      return {status: response.status, json};
    } finally { if (timer) clearTimeout(timer); }
  }
  async function deliver(rec) {
    const payload = gatewayPayload({channel: rec.channel, idempotencyKey: rec.idempotencyKey || rec.id, messages: rec.outbox || [], subject: rec.subject, sendAt: rec.sendAt});
    const offline = nav && nav.onLine === false;
    if (offline) throw Object.assign(new Error('Hors connexion.'), {retry: true});
    let answer;
    try { answer = await callGateway('send', payload); } catch (error) { throw Object.assign(new Error(error?.name === 'AbortError' ? 'Passerelle trop lente.' : 'Passerelle injoignable.'), {retry: true}); }
    return parseGatewayResponse(answer.json, answer.status);
  }
  async function attempt(rec) {
    const attempts = (Number(rec.attempts) || 0) + 1;
    try {
      const result = await deliver(rec);
      if (result.status === 'echec' && result.retry) throw Object.assign(new Error(result.error), {retry: true});
      const status = result.status === 'partiel' ? 'echec' : result.status;
      const saved = await logRecord({...rec, status, statusAt: now(), attempts, results: result.results, error: result.error, outbox: status === 'echec' ? rec.outbox : [], nextAttemptAt: null}, rec);
      return {record: saved, status, error: result.error};
    } catch (error) {
      const retry = error?.retry && attempts < GATEWAY_MAX_ATTEMPTS;
      const nextAttemptAt = retry ? now() + retryDelayMs(attempts - 1) : null;
      const saved = await logRecord({...rec, status: retry ? 'attente' : 'echec', statusAt: now(), attempts, error: error?.message || 'Envoi impossible.', nextAttemptAt}, rec);
      if (retry) scheduleFlush(nextAttemptAt);
      return {record: saved, status: retry ? 'attente' : 'echec', error: error?.message};
    }
  }
  async function sendViaGateway(targets, skipped) {
    const sendAt = session.sendAt && !Number.isNaN(Date.parse(session.sendAt)) ? new Date(session.sendAt).toISOString() : '';
    if (sendAt && Date.parse(sendAt) <= now()) return fail(doc.getElementById('msg-compose'), 'L’heure d’envoi programmé est déjà passée.', doc.querySelector('#msg-compose [name="sendAt"]'));
    const id = uid(MESSAGE_KIND);
    const outbox = targets.map(t => ({to: t.channel === 'email' ? t.recipient.email : t.recipient.phone, body: t.body, subject: t.subject, key: messageIdempotencyKey(id, t.channel === 'email' ? t.recipient.email : t.recipient.phone, t.channel)}));
    try { gatewayPayload({channel: session.channel, messages: outbox, idempotencyKey: id, sendAt}); } catch (error) { return fail(doc.getElementById('msg-compose'), error.message); }
    const rec = await logRecord({...baseRecord(targets, {status: 'attente', via: 'passerelle', sendAt}), idempotencyKey: id, outbox, id});
    if (!rec) return;
    session.recordId = rec.id;
    const result = await attempt(rec);
    session.sent = result.status === 'envoye' || result.status === 'programme';
    const text = result.status === 'envoye' ? `Envoyé à ${plural(targets.length, 'destinataire', 'destinataires')}.` : result.status === 'programme' ? 'Envoi programmé par la passerelle.' : result.status === 'attente' ? `${result.error} Le message part dès que la connexion revient (file d’attente de cet appareil).` : `Échec : ${result.error}`;
    toast(`${text}${skipped.length ? ` Non envoyé à : ${skipped.join(', ')}.` : ''}`, result.status === 'echec' ? 'error' : result.status === 'attente' ? 'warning' : 'success');
    closeModal();
  }
  // Minuterie du prochain réessai : sans elle, un message mis en attente (503, délai dépassé, réseau revenu
  // avant l'heure du réessai) resterait bloqué tant que l'appli reste ouverte au premier plan.
  let flushTimer = null, flushAt = 0;
  function scheduleFlush(at) {
    if (!at || !gatewayReady()) return;
    if (flushTimer && flushAt <= at) return;
    if (flushTimer) clearTimeout(flushTimer);
    flushAt = at;
    flushTimer = setTimeout(() => { flushTimer = null; flushAt = 0; flushOutbox(); }, Math.max(1000, at - now()));
  }
  let flushing = false;
  async function flushOutbox() {
    if (flushing || !gatewayReady() || nav?.onLine === false) return 0;
    flushing = true;
    let sent = 0;
    try {
      for (const rec of outboxDue(data(), {deviceId: deviceId(), now: now()})) { const r = await attempt(rec); if (r.status === 'envoye' || r.status === 'programme') sent += 1; }
      if (sent) { toast(`${plural(sent, 'message en attente envoyé', 'messages en attente envoyés')}.`); refreshCenter(); }
    } finally { flushing = false; scheduleFlush(nextOutboxAt(data(), {deviceId: deviceId()})); }
    return sent;
  }
  async function retryRecord(id) {
    const rec = record(id);
    if (!rec) return;
    if (rec.via !== 'passerelle' || !rec.outbox?.length) { resend(id); return; }
    if (!gatewayReady()) { toast('Passerelle non configurée : renvoyez depuis ce téléphone.', 'warning'); resend(id); return; }
    const r = await attempt({...rec, deviceId: deviceId(), attempts: 0});
    toast(r.status === 'envoye' ? 'Message envoyé.' : r.status === 'attente' ? 'Toujours en attente de connexion.' : `Échec : ${r.error}`, r.status === 'echec' ? 'error' : 'success');
    refreshCenter();
  }
  function resend(id) {
    const rec = record(id);
    if (!rec) return;
    openComposer({recipients: (rec.recipients || []).map(r => (r.contactId && contactById(r.contactId) ? r.contactId : {name: r.name, phone: r.phone, email: r.email})), channel: rec.channel, subject: rec.subject, body: rec.body, context: rec.context, templateKey: ''});
  }
  async function markLogSent(id) {
    const rec = record(id);
    if (!rec) return;
    await logRecord({...rec, status: 'envoye', statusAt: now(), sentAt: now(), results: (rec.results || []).map(r => ({...r, status: 'sent'}))}, rec);
    refreshCenter();
  }

  // ——— Réglages ———
  function openSettings() {
    const p = prefs(), token = gatewayToken();
    modal('Réglages d’envoi', 'Envoi depuis le téléphone, passerelle facultative et rappel du soir', String(html`<form id="msg-settings-form" class="form-grid msg-form" novalidate>
      <fieldset class="span-2 msg-fieldset"><legend>Rappel du planning</legend>
        <label class="msg-check"><input type="checkbox" name="planReminderEnabled"${p.planReminderEnabled ? raw(' checked') : ''}> Le soir, proposer d’envoyer le planning de demain</label>
        <label>À partir de<select name="planReminderHour">${[16, 17, 18, 19, 20, 21].map(h => html`<option value="${h}"${Number(p.planReminderHour ?? 18) === h ? raw(' selected') : ''}>${h} h</option>`)}</select></label>
        <p class="form-note">Sans serveur, Parcelles le propose à la première ouverture après cette heure (notification si vous l’autorisez, sinon un message). Un envoi vraiment automatique, application fermée, demande la passerelle et un déclencheur planifié (voir l’aide de la passerelle).</p>
        <button type="button" class="small-button" data-msg="notif-permission">Autoriser les notifications</button></fieldset>
      <fieldset class="span-2 msg-fieldset"><legend>Envoi automatique (facultatif)</legend>
        <p class="form-note">Par défaut, chaque message s’ouvre dans l’application SMS, WhatsApp ou e-mail du téléphone : gratuit, rien ne passe par un serveur. Pour envoyer sans toucher le téléphone, déployez votre propre passerelle (Worker Cloudflare, exemple fourni avec Parcelles) reliée à un fournisseur SMS / e-mail (Brevo, OVH, Twilio…).</p>
        <label class="msg-check"><input type="checkbox" name="messagingGatewayEnabled"${p.messagingGatewayEnabled ? raw(' checked') : ''}> Utiliser ma passerelle</label>
        <label>Adresse HTTPS de la passerelle<input name="messagingGatewayUrl" type="url" inputmode="url" value="${p.messagingGatewayUrl || ''}" placeholder="https://messages.mon-exploitation.workers.dev"></label>
        <label>Jeton d’accès de cette exploitation<input name="token" type="password" autocomplete="off" value="${token}" placeholder="Jeton fourni par votre passerelle"></label>
        <p class="form-note msg-caution">Ce jeton donne le droit d’envoyer des messages par votre compte (et à vos frais) : gardez-le pour vous. Ce n’est pas la clé du fournisseur, qui reste sur la passerelle. Il est gardé sur cet appareil seulement, hors sauvegardes.</p>
        <button type="button" class="small-button" data-msg="gateway-test">Tester la connexion</button><p class="form-note" id="msg-gateway-status" role="status"></p></fieldset>
      <p class="span-2 form-error hidden" role="alert"></p></form>`),
    '<button type="button" class="button primary msg-wide" data-msg="settings-save">Enregistrer</button>', 'small');
  }
  function readSettings() {
    const form = doc.getElementById('msg-settings-form');
    if (!form) return null;
    const f = form.elements, url = String(f.messagingGatewayUrl.value || '').trim();
    if (url) gatewayEndpoint(url);
    if (f.messagingGatewayEnabled.checked && !url) throw new Error('Champ obligatoire : adresse de la passerelle.');
    if (f.messagingGatewayEnabled.checked && !String(f.token.value || '').trim()) throw new Error('Champ obligatoire : jeton d’accès.');
    return {prefs: {planReminderEnabled: f.planReminderEnabled.checked, planReminderHour: Number(f.planReminderHour.value) || 18, messagingGatewayEnabled: f.messagingGatewayEnabled.checked && Boolean(url), messagingGatewayUrl: url}, token: String(f.token.value || '').trim()};
  }
  async function saveSettings() {
    const form = doc.getElementById('msg-settings-form');
    try {
      const s = readSettings();
      lsSet(tokenKey(), s.token);
      await store.setPreferences(s.prefs);
      scheduleReminder();
      toast('Réglages d’envoi enregistrés.');
      openMessagesCenter();
    } catch (error) { fail(form, error?.message || 'Enregistrement impossible.'); }
  }
  async function testGateway() {
    const box = doc.getElementById('msg-gateway-status'), form = doc.getElementById('msg-settings-form');
    let s;
    try { s = readSettings(); gatewayEndpoint(s.prefs.messagingGatewayUrl); } catch (error) { fail(form, error.message); return; }
    if (box) box.textContent = 'Test en cours…';
    try {
      const response = await fetchImpl(gatewayEndpoint(s.prefs.messagingGatewayUrl, 'health'), {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${s.token}`}, body: '{}'});
      const json = await response.json().catch(() => ({}));
      if (box) box.textContent = response.ok && json?.ok ? `Connexion réussie : ${[json.sms ? 'SMS' : '', json.email ? 'e-mail' : ''].filter(Boolean).join(' et ') || 'aucun canal'} disponible${json.scheduled ? ', envoi programmé possible' : ''}.` : response.status === 401 || response.status === 403 ? 'Jeton refusé par la passerelle.' : `Échec (${response.status}).`;
    } catch { if (box) box.textContent = 'Passerelle injoignable (adresse, réseau ou autorisation CORS).'; }
  }
  async function askNotifications() {
    if (!('Notification' in win)) { toast('Notifications non disponibles sur ce navigateur.', 'info'); return; }
    try { const r = await win.Notification.requestPermission(); toast(r === 'granted' ? 'Notifications autorisées.' : 'Notifications refusées : le rappel s’affichera dans l’application.', 'info'); } catch { /* refus silencieux */ }
  }

  // ——— Envoyer le planning ———
  function personAssignee(c) {
    return {name: c.name, id: c.memberUid || '', aliases: c.assigneeNames || []};
  }
  function buildPlan(date, personId = '', personName = '') {
    const all = contacts(), t = today();
    let people;
    if (personId) {
      const c = all.find(x => x.id === personId);
      people = c ? [{name: c.name, id: c.memberUid || '', aliases: c.assigneeNames || [], contact: c}] : [];
    } else {
      people = dayPlanAssignees(data(), {date, today: t}).filter(p => !personName || normalizeName(p.name) === normalizeName(personName)).map(p => ({...p, contact: contactForAssignee(all, p)}));
    }
    return people.map((p, i) => {
      const contact = p.contact || null;
      const who = contact ? {...personAssignee(contact), name: p.name, aliases: [...(contact.assigneeNames || []), contact.name]} : {name: p.name, id: p.id || '', aliases: []};
      if (p.id && !who.id) who.id = p.id;
      const msg = dayPlanMessage(data(), {date, assignee: who, today: t, contact});
      return {index: i, name: p.name, contact, phone: contact?.phone || '', body: msg.body, templateKey: msg.templateKey, done: false, recordId: null, empty: /Rien de prevu\./.test(msg.vars.travaux), optOut: contact ? consentStatus(contact, 'sms') === 'non' : false};
    });
  }
  function planRowHtml(r) {
    const p = platform(), phone = normalizePhone(r.phone);
    const seg = smsSegments(r.body);
    return html`<li class="msg-plan-row" data-index="${r.index}"><div class="msg-plan-head"><strong>${r.name}</strong><small>${phone ? formatPhone(phone) : 'pas de numéro'}${r.contact ? '' : ' · pas de contact rattaché'}</small></div>
      ${r.optOut ? html`<p class="msg-warnings">${r.name} s’est opposé(e) aux SMS : utilisez un autre moyen.</p>` : ''}
      ${!phone ? html`<label class="msg-inline-phone">Numéro de ${r.name}<span class="msg-inline"><input name="phone-${r.index}" type="tel" inputmode="tel" placeholder="06 12 34 56 78" data-plan-phone="${r.index}"><button type="button" class="small-button" data-msg="plan-phone" data-index="${r.index}">Utiliser</button></span></label>${canManage() ? html`<button type="button" class="text-button" data-msg="plan-link" data-index="${r.index}">Rattacher à un contact</button>` : ''}` : ''}
      <label class="sr-only" for="msg-plan-body-${r.index}">Message pour ${r.name}</label><textarea id="msg-plan-body-${r.index}" rows="6" data-plan-body="${r.index}">${r.body}</textarea>
      <p class="msg-counter" id="msg-plan-count-${r.index}">${seg.length} caractères · ${plural(seg.segments || 1, 'SMS', 'SMS')}${seg.encoding === 'UCS-2' ? ' (caractères spéciaux)' : ''}</p>
      <div class="msg-actions-row">${phone && !r.optOut ? html`<a class="button primary" data-msg-plan-link="${r.index}" href="${smsUri({phones: [phone], body: r.body, platform: p})}">Ouvrir le SMS</a><a class="button secondary" data-msg-plan-wa="${r.index}" href="${whatsappUri({phone, body: r.body})}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        <button type="button" class="button secondary msg-sent-toggle${r.done ? ' is-on' : ''}" data-msg="plan-sent" data-index="${r.index}" aria-pressed="${r.done}">${r.done ? 'Envoyé ✓' : 'Envoyé ?'}</button></div></li>`;
  }
  function planBodyHtml() {
    const t = today(), tomorrow = addDays(t, 1);
    const rows = plan.rows;
    const ready = rows.filter(r => normalizePhone(r.phone) && !r.optOut && !r.done && !r.queued);
    return html`<div class="msg-plan" data-msg-session="${plan.id}">
      <div class="chip-choices" role="group" aria-label="Jour du planning">${[[t, 'Aujourd’hui'], [tomorrow, 'Demain']].map(([d, label]) => html`<button type="button" class="choice-chip${plan.date === d ? ' is-on' : ''}" aria-pressed="${plan.date === d}" data-msg="plan" data-date="${d}" data-person="${plan.personId}" data-name="${plan.personName}">${label}</button>`)}</div>
      ${rows.length ? html`<p class="msg-note">${plural(rows.length, 'personne', 'personnes')} · un SMS par personne, avec ses travaux, la parcelle, le produit, le matériel, la consigne et le lien de position. Modifiez le texte si besoin.</p><ul class="msg-plan-list">${rows.map(planRowHtml)}</ul>
        ${gatewayReady() && ready.length ? html`${plan.date > t ? html`<label class="msg-plan-when">Envoi automatique programmé (facultatif)<input type="datetime-local" name="plan-send-at" value="${plan.sendAt}" min="${t}T00:00"><small class="form-note">Ex. demain à 7 h : la passerelle l’envoie même si ce téléphone est éteint.</small></label>` : ''}<button type="button" class="button secondary msg-wide" data-msg="plan-gateway">${plan.date > t && plan.sendAt ? 'Programmer' : 'Tout envoyer'} automatiquement (${plural(ready.length, 'SMS', 'SMS')})</button>` : ''}`
      : html`<p class="msg-empty">Aucun travail ni tâche confié pour ${dayLabel(plan.date)}.</p><p class="msg-note">Confiez d’abord un travail à une personne (Consignes & heures), ou envoyez le planning complet de l’exploitation à quelqu’un.</p>
        <div class="msg-actions-row"><button type="button" class="button primary" data-team="assign">Confier un travail</button><button type="button" class="button secondary" data-msg="plan-all" data-date="${plan.date}">Envoyer tout le planning</button></div>`}</div>`;
  }
  function openPlanningSender({date = today(), personId = '', personName = ''} = {}) {
    if (!canSend()) { toast('Votre rôle ne permet pas d’envoyer de message.', 'info'); return; }
    plan = {id: uid('plan'), date, personId, personName, sendAt: '', rows: buildPlan(date, personId, personName)};
    modal(`Planning du ${dayLabel(date)}`, personName || personId ? `Pour ${personName || contactById(personId)?.name || ''}` : 'Envoyer à chacun ses travaux du jour', String(planBodyHtml()), '<button type="button" class="button primary msg-wide" data-msg="plan-done">Terminé</button>', 'small');
    bindPlan();
    if (!members.length && sync?.workspaceId) loadMembers().then(() => { if (plan && doc.querySelector(`[data-msg-session="${plan.id}"]`) && plan.rows.some(r => !r.contact)) { plan.rows = buildPlan(plan.date, plan.personId, plan.personName); rerenderPlan(); } });
  }
  function rerenderPlan() { const box = doc.querySelector(`[data-msg-session="${plan?.id}"]`); if (box) { box.outerHTML = String(planBodyHtml()); bindPlan(); } }
  function bindPlan() {
    const box = doc.querySelector(`[data-msg-session="${plan?.id}"]`);
    if (!box) return;
    box.addEventListener('input', event => {
      if (event.target.name === 'plan-send-at') { plan.sendAt = event.target.value; const go = box.querySelector('[data-msg="plan-gateway"]'); if (go) go.textContent = go.textContent.replace(/^(Programmer|Tout envoyer)/, plan.sendAt ? 'Programmer' : 'Tout envoyer'); return; }
      const i = event.target.dataset?.planBody;
      if (i === undefined) return;
      const r = plan.rows[Number(i)];
      r.body = event.target.value;
      const phone = normalizePhone(r.phone), seg = smsSegments(r.body);
      const link = box.querySelector(`[data-msg-plan-link="${i}"]`), wa = box.querySelector(`[data-msg-plan-wa="${i}"]`), count = doc.getElementById(`msg-plan-count-${i}`);
      if (link && phone) link.setAttribute('href', smsUri({phones: [phone], body: r.body, platform: platform()}));
      if (wa && phone) wa.setAttribute('href', whatsappUri({phone, body: r.body}));
      if (count) count.textContent = `${seg.length} caractères · ${plural(seg.segments || 1, 'SMS', 'SMS')}${seg.encoding === 'UCS-2' ? ' (caractères spéciaux)' : ''}`;
    });
    box.addEventListener('click', event => {
      const a = event.target.closest?.('[data-msg-plan-link],[data-msg-plan-wa]');
      if (!a) return;
      const i = Number(a.dataset.msgPlanLink ?? a.dataset.msgPlanWa);
      logPlanRow(plan.rows[i], a.dataset.msgPlanWa !== undefined ? 'whatsapp' : 'sms', 'prepare');
      const toggle = box.querySelector(`.msg-plan-row[data-index="${i}"] .msg-sent-toggle`);
      setTimeout(() => toggle?.focus?.({preventScroll: true}), 300);
    });
  }
  async function logPlanRow(r, channel = 'sms', status = 'prepare') {
    if (!r) return;
    const existing = r.recordId ? record(r.recordId) : null;
    const payload = messageRecord({channel, recipients: [{contactId: r.contact?.kind === 'contact' || r.contact?.kind === 'member' ? r.contact.id : '', name: r.contact?.name || r.name, phone: r.phone}], subject: `Planning du ${dayLabel(plan.date)}`, body: r.body, status, context: {entity: 'planning', id: plan.date, kind: 'planning', label: `Planning du ${dayLabel(plan.date)}`}, deviceId: deviceId(), author: author(), now: now(), templateKey: r.templateKey});
    const saved = await logRecord(existing ? {...existing, ...payload, createdAtMs: existing.createdAtMs, sentAt: status === 'envoye' ? now() : existing.sentAt || null} : payload, existing);
    if (saved) r.recordId = saved.id;
  }
  async function planSent(index) {
    const r = plan?.rows?.[index];
    if (!r) return;
    r.done = !r.done;
    const btn = doc.querySelector(`.msg-plan-row[data-index="${index}"] .msg-sent-toggle`);
    if (btn) { btn.setAttribute('aria-pressed', String(r.done)); btn.textContent = r.done ? 'Envoyé ✓' : 'Envoyé ?'; btn.classList.toggle('is-on', r.done); }
    await logPlanRow(r, 'sms', r.done ? 'envoye' : 'prepare');
  }
  function planPhone(index) {
    const input = doc.querySelector(`[data-plan-phone="${index}"]`), r = plan?.rows?.[index];
    const phone = normalizePhone(input?.value);
    if (!r || !phone) { toast('Numéro illisible. Exemple : 06 12 34 56 78.', 'error'); input?.focus(); return; }
    r.phone = phone;
    // Numéro d'un contact du carnet qui s'est opposé aux SMS : la ligne reste bloquée.
    if (!r.optOut) r.optOut = addressConsent(contacts(), {phone})?.consent?.sms?.status === 'non';
    rerenderPlan();
  }
  function planLink(index) {
    const r = plan?.rows?.[index];
    if (!r) return;
    const keep = plan;
    openContactForm(null, {prefill: {name: r.name, assigneeNames: r.name, phones: r.phone ? formatPhone(r.phone) : ''}, then: () => { plan = keep; plan.rows = buildPlan(plan.date, plan.personId, plan.personName); openPlanningSenderFromState(); }});
  }
  function openPlanningSenderFromState() {
    modal(`Planning du ${dayLabel(plan.date)}`, 'Envoyer à chacun ses travaux du jour', String(planBodyHtml()), '<button type="button" class="button primary msg-wide" data-msg="plan-done">Terminé</button>', 'small');
    bindPlan();
  }
  async function planGateway() {
    // Une ligne déjà confiée à la passerelle (en attente de réseau) ne repart pas d'ici : la file s'en charge.
    const rows = plan.rows.filter(r => normalizePhone(r.phone) && !r.optOut && !r.done && !r.queued);
    if (!rows.length) return;
    const id = uid(MESSAGE_KIND);
    const sendAt = plan.sendAt && plan.date > today() ? new Date(plan.sendAt).toISOString() : '';
    if (sendAt && Date.parse(sendAt) <= now()) { toast('L’heure d’envoi programmé est déjà passée.', 'error'); return; }
    // Clé d'idempotence tirée du jour et du texte de chacun, pas de l'identifiant du clic : renvoyer le même
    // planning (après un échec partiel, par exemple) est reconnu comme doublon par la passerelle.
    const outbox = rows.map(r => ({to: normalizePhone(r.phone), body: r.body, key: messageIdempotencyKey(planIdempotencyId(plan.date, r.body), r.phone, 'sms')}));
    try { gatewayPayload({channel: 'sms', messages: outbox, idempotencyKey: id, sendAt}); } catch (error) { toast(error.message, 'error'); return; }
    const rec = await logRecord({...messageRecord({channel: 'sms', recipients: rows.map(r => ({contactId: r.contact?.id || '', name: r.contact?.name || r.name, phone: r.phone})), subject: `Planning du ${dayLabel(plan.date)}`, body: rows[0].body, status: 'attente', via: 'passerelle', context: {entity: 'planning', id: plan.date, kind: 'planning', label: `Planning du ${dayLabel(plan.date)}`}, deviceId: deviceId(), author: author(), now: now(), templateKey: rows[0].templateKey, sendAt}), id, idempotencyKey: id, outbox});
    if (!rec) return;
    const r = await attempt(rec);
    const delivered = deliveredTo(r.record?.results);
    rows.forEach(x => {
      if (r.status === 'envoye' || r.status === 'programme' || delivered.has(normalizePhone(x.phone))) x.done = true;
      else if (r.status === 'attente') x.queued = true;
    });
    rerenderPlan();
    toast(r.status === 'envoye' ? `Planning envoyé à ${plural(rows.length, 'personne', 'personnes')}.` : r.status === 'programme' ? `Planning programmé pour ${plural(rows.length, 'personne', 'personnes')}.` : r.status === 'attente' ? 'Hors connexion : envoi dès le retour du réseau.' : `Échec : ${r.error}`, r.status === 'echec' ? 'error' : r.status === 'attente' ? 'warning' : 'success');
  }
  function sendWholePlan(date) {
    const msg = dayPlanMessage(data(), {date, assignee: null, today: today()});
    openComposer({recipients: [], channel: 'sms', subject: msg.subject, body: msg.body.replace(/\{prenom\}/g, '').replace(/Bonjour ,/, 'Bonjour,'), context: {entity: 'planning', id: date, kind: 'planning', label: `Planning du ${dayLabel(date)}`}, templateKey: msg.templateKey});
  }

  // « Envoyer la consigne » d'un travail ou d'une tâche confié(e).
  async function sendWorkInstructions(kind, id) {
    await loadMembers();
    const msg = workInstructionMessage(data(), {kind, id});
    if (!msg) { toast('Travail introuvable.', 'error'); return {sent: false, channel: null, recordId: null}; }
    const contact = msg.assigneeName || msg.assigneeId ? contactForAssignee(contacts(), {name: msg.assigneeName, id: msg.assigneeId}) : null;
    const finalMsg = contact ? workInstructionMessage(data(), {kind, id, contact}) : msg;
    const item = kind === 'task' ? store.get('tasks', id) : store.get('interventions', id);
    if (!contact && msg.assigneeName) toast(`${msg.assigneeName} n’est rattaché(e) à aucun contact : ajoutez son numéro.`, 'info');
    return openComposer({recipients: contact ? [contact.id] : [], channel: contact ? channelFor(contact, 'auto') || 'sms' : 'sms', subject: finalMsg.subject, body: finalMsg.body, context: {entity: kind === 'task' ? 'tasks' : 'interventions', id, kind, label: `${kind === 'task' ? item?.title || 'Tâche' : item?.type || 'Travail'}${msg.assigneeName ? ` · ${msg.assigneeName}` : ''}`}, templateKey: finalMsg.templateKey});
  }

  // ——— Rappel du soir ———
  // Application ouverte avant l'heure : un minuteur la propose à l'heure dite (notification système si la
  // page est en arrière-plan et les notifications autorisées). Application fermée : à la prochaine ouverture.
  let reminderTimer = null;
  function scheduleReminder() {
    const p = prefs();
    if (reminderTimer) { clearTimeout(reminderTimer); reminderTimer = null; }
    if (!p.planReminderEnabled || lsGet(REMINDER_KEY) === today()) return;
    const at = new Date(now()); at.setHours(Math.min(23, Math.max(0, Number(p.planReminderHour ?? 18))), 0, 5, 0);
    const delay = at.getTime() - now();
    if (delay > 0 && delay < 86400000) reminderTimer = setTimeout(() => { reminderTimer = null; checkPlanReminder(); }, delay);
  }
  function checkPlanReminder() {
    const p = prefs();
    if (!canSend() || !planReminderDue({enabled: p.planReminderEnabled, hour: p.planReminderHour ?? 18, now: new Date(now()), lastDay: lsGet(REMINDER_KEY)})) { scheduleReminder(); return false; }
    const tomorrow = addDays(today(), 1), people = dayPlanAssignees(data(), {date: tomorrow});
    if (!people.length) return false; // rien de confié pour demain : on reproposera si un travail est confié ce soir
    lsSet(REMINDER_KEY, today());
    const body = `${plural(people.length, 'personne a', 'personnes ont')} des travaux demain : ${people.slice(0, 3).map(x => x.name).join(', ')}${people.length > 3 ? '…' : ''}.`;
    let shown = false;
    try {
      if ('Notification' in win && win.Notification.permission === 'granted' && doc.visibilityState !== 'visible') {
        const n = new win.Notification('Envoyer le planning de demain ?', {body, tag: 'parcelles-planning', icon: './icon-192.png'});
        n.onclick = () => { try { win.focus(); } catch { /* fenêtre déjà au premier plan */ } openPlanningSender({date: tomorrow}); n.close(); };
        shown = true;
      }
    } catch { shown = false; }
    toast(`Planning de demain : ${body}`, 'info', {label: 'Préparer les SMS', run: () => openPlanningSender({date: tomorrow})}, {persist: !shown});
    return true;
  }

  // ——— Clics ———
  const handlers = {
    center: () => openMessagesCenter(),
    plan: c => openPlanningSender({date: c.dataset.date || today(), personId: c.dataset.person || '', personName: c.dataset.name || ''}),
    'plan-sent': c => planSent(Number(c.dataset.index)),
    'plan-phone': c => planPhone(Number(c.dataset.index)),
    'plan-link': c => planLink(Number(c.dataset.index)),
    'plan-gateway': () => planGateway(),
    'plan-all': c => sendWholePlan(c.dataset.date || today()),
    'plan-done': () => { plan = null; closeModal(); },
    work: c => sendWorkInstructions('work', c.dataset.id),
    task: c => sendWorkInstructions('task', c.dataset.id),
    compose: c => openComposer({recipients: c.dataset.to ? [c.dataset.to] : [], channel: c.dataset.channel || 'auto'}),
    'compose-group': c => openComposer({recipients: contacts().filter(x => (x.groups || []).includes(c.dataset.value)).map(x => x.id), channel: 'auto'}),
    contacts: () => openContacts(),
    'contacts-group': c => openContacts({group: c.dataset.value || ''}),
    contact: c => openContact(c.dataset.id),
    'contact-new': () => openContactForm(null),
    'contact-edit': c => openContactForm(c.dataset.id),
    'contact-save': c => saveContact(c.dataset.id || null),
    'contact-delete': c => deleteContact(c.dataset.id),
    templates: () => openTemplates(),
    template: c => openTemplateForm(c.dataset.key || null),
    'template-save': c => saveTemplate(c.dataset.key || null),
    'template-reset': c => resetTemplate(c.dataset.key),
    'insert-var': c => insertVariable(c.dataset.value),
    settings: () => openSettings(),
    'settings-save': () => saveSettings(),
    'gateway-test': () => testGateway(),
    'notif-permission': () => askNotifications(),
    'rcpt-remove': c => { session.recipients = session.recipients.filter(r => r.id !== c.dataset.id); rerenderComposer(); },
    'rcpt-free': () => addFree(),
    'file-remove': c => { session.files.splice(Number(c.dataset.index), 1); rerenderComposer(); },
    channel: c => { session.channel = c.dataset.value; rerenderComposer(); },
    mode: c => { session.mode = c.dataset.value; rerenderComposer(); },
    gsm: () => { const area = doc.querySelector('#msg-compose textarea[name="body"]'); session.body = toGsm(area?.value ?? session.body); if (area) area.value = session.body; refreshComposerBits(); },
    prepare: () => prepare(),
    'mark-sent': c => markSent(Number(c.dataset.index)),
    'share-open': c => shareOpen(Number(c.dataset.index)),
    'share-files': () => shareOpen(0, {withFiles: true}),
    'download-files': () => downloadFiles(),
    'send-done': () => closeModal(),
    'log-sent': c => markLogSent(c.dataset.id),
    'log-retry': c => retryRecord(c.dataset.id),
    'log-resend': c => resend(c.dataset.id)
  };
  doc?.addEventListener('click', event => {
    const control = event.target?.closest?.('[data-msg]');
    if (control) {
      const run = handlers[control.dataset.msg];
      if (!run) return;
      event.preventDefault();
      // Verrou anti double appui sur les écritures (un second « Préparer » enverrait deux SMS par la passerelle).
      if (MSG_WRITES.has(control.dataset.msg)) { if (control.dataset.msgBusy) return; control.dataset.msgBusy = '1'; }
      Promise.resolve().then(() => run(control)).catch(error => toast(error?.message || 'Action impossible.', 'error')).finally(() => { delete control.dataset.msgBusy; });
      return;
    }
    // Lien d'envoi du composeur ouvert : la ligne attend la confirmation « Envoyé ? ».
    const link = event.target?.closest?.('[data-msg-link]');
    if (link && session?.links) { const row = link.closest('.msg-send-row'); row?.classList.add('is-opened'); setTimeout(() => row?.querySelector('.msg-sent-toggle')?.focus?.({preventScroll: true}), 300); }
  });
  win?.addEventListener?.('online', () => { flushOutbox(); });

  return {openComposer, openMessagesCenter, openContacts, openContact, openContactForm, openTemplates, openSettings, openPlanningSender, sendWorkInstructions, checkPlanReminder, flushOutbox, contacts};
}
