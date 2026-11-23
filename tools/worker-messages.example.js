// Passerelle d'envoi de SMS et d'e-mails pour Parcelles (v13, messages et notifications).
//
// Ce fichier n'est PAS servi par l'application (dossier tools/, hors CORE de sw.js) : c'est un exemple à
// déployer soi-même sur Cloudflare Workers, par exemple :
//   wrangler kv namespace create MESSAGES_KV
//   wrangler secret put BREVO_API_KEY
//   wrangler secret put FARM_TOKENS
//   wrangler secret put STORE_KEY
//   wrangler deploy tools/worker-messages.example.js
// Sans cette passerelle, Parcelles envoie depuis le téléphone (liens sms:, WhatsApp, mailto:) : rien à déployer.
//
// Configuration (variables du Worker, jamais dans un fichier publié) :
//   BREVO_API_KEY      (secret) clé API Brevo : elle reste ici, l'application ne la voit jamais.
//   BREVO_SENDER_EMAIL adresse d'expédition validée chez Brevo, ex. « factures@mon-exploitation.fr ».
//   BREVO_SENDER_NAME  nom affiché, ex. « GAEC du Sougey ».
//   BREVO_SMS_SENDER   expéditeur SMS, 3 à 11 caractères alphanumériques, ex. « GAECSOUGEY ».
//   ALLOWED_ORIGINS    origines autorisées, séparées par des virgules, ex. « https://berthillotthibault-spec.github.io ».
//   FARM_TOKENS        (secret) JSON : empreinte SHA-256 (hexadécimal) du jeton de chaque exploitation -> réglages.
//                      ex. {"9f86d0…":{"farm":"sougey","smsPerDay":200,"emailPerDay":300,"perMinute":30}}
//                      Le jeton lui-même n'est stocké nulle part ici : on compare son empreinte.
//                      Générer un jeton : `openssl rand -base64 32` ; son empreinte : `printf %s "$JETON" | shasum -a 256`.
//   STORE_KEY          (secret) clé AES-GCM 256 bits en base64 (`openssl rand -base64 32`) : chiffre les messages
//                      programmés le temps qu'ils attendent dans KV. Sans elle, l'envoi programmé est refusé.
//   MESSAGES_KV        espace KV (liaison) : clés d'idempotence, compteurs de débit, messages programmés chiffrés.
//
// Le jeton saisi dans Parcelles (Messages › Réglages d'envoi) donne le droit d'envoyer par CE compte Brevo :
// il n'est pas la clé du fournisseur. Un jeton par exploitation ; pour le révoquer, retirez son empreinte de FARM_TOKENS.
//
// Contrat avec messaging-ui.js (Authorization: Bearer <jeton>) :
//   POST /health  -> {ok:true, sms:boolean, email:boolean, scheduled:boolean}
//   POST /send    {channel:'sms'|'email', idempotencyKey, messages:[{to, body, subject?, key}], sendAt?, client:'Parcelles'}
//              -> {results:[{to, status:'sent'|'scheduled'|'duplicate'|'failed', error?}]}
//   Chaque message porte une clé d'idempotence (key) : un réessai après une coupure, ou le même envoi depuis
//   un second appareil, reçoit « duplicate » au lieu d'un second SMS.
//
// Envoi programmé (sendAt) et rappel du soir : un déclencheur planifié (Cron Trigger) parcourt les messages
// programmés et les envoie à l'heure dite. Dans wrangler.toml :
//   [triggers]
//   crons = ["*/5 * * * *"]
// Les textes programmés sont chiffrés au repos (STORE_KEY) et effacés dès l'envoi. La passerelle ne garde
// aucune donnée de l'exploitation : elle ne peut donc pas composer seule le planning de demain. Pour un envoi
// automatique application fermée, Parcelles prépare le planning (rappel du soir) et le confie à la passerelle
// avec une heure d'envoi (« Programmer ») ; la passerelle l'envoie ensuite sans que le téléphone soit allumé.
//
// Journal : une ligne par requête (exploitation, canal, nombre, statut), sans texte ni numéro en clair.
//
// Autres fournisseurs (remplacer sendSms / sendEmail) :
//   OVHcloud SMS : POST https://eu.api.ovh.com/1.0/sms/{serviceName}/jobs, requête signée (clés AK/AS/CK,
//     en-têtes X-Ovh-Application, X-Ovh-Consumer, X-Ovh-Timestamp, X-Ovh-Signature), corps
//     {message, receivers:['+336…'], sender, noStopClause:true, priority:'high'}.
//   Twilio : POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json, authentification Basic
//     (SID:jeton), formulaire To, From (ou MessagingServiceSid), Body ; e-mail par SendGrid.

const BREVO = 'https://api.brevo.com/v3';
const MAX_BODY = 256 * 1024;
const MAX_MESSAGES = 50;
const SMS_MAX_CHARS = 1530; // 10 SMS GSM-7 concaténés
const EMAIL_MAX_CHARS = 20000;
const IDEMPOTENCY_TTL = 7 * 24 * 3600;
const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}
function cors(origin) {
  return {'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '86400', vary: 'Origin'};
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(origin ? cors(origin) : {})}});
}
const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256(text) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }
const log = entry => console.log(JSON.stringify({at: new Date().toISOString(), ...entry}));

// Jeton -> réglages de l'exploitation (empreinte SHA-256 comparée à FARM_TOKENS).
async function farmFor(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token.length < 16) return null;
  let farms;
  try { farms = JSON.parse(env.FARM_TOKENS || '{}'); } catch { return null; }
  const farm = farms[await sha256(token)];
  return farm ? {perMinute: 30, smsPerDay: 200, emailPerDay: 300, ...farm, farm: String(farm.farm || 'exploitation')} : null;
}

// Limite de débit approximative (KV est cohérent à terme : pour une limite stricte, utiliser un Durable Object).
async function withinLimits(env, farm, channel, count) {
  const now = new Date(), minute = Math.floor(now.getTime() / 60000), day = now.toISOString().slice(0, 10);
  const minuteKey = `rate:${farm.farm}:${minute}`, dayKey = `day:${farm.farm}:${day}:${channel}`;
  const [perMinute, perDay] = await Promise.all([env.MESSAGES_KV.get(minuteKey), env.MESSAGES_KV.get(dayKey)]);
  const dayLimit = channel === 'sms' ? farm.smsPerDay : farm.emailPerDay;
  if (Number(perMinute || 0) + 1 > farm.perMinute || Number(perDay || 0) + count > dayLimit) return false;
  await Promise.all([
    env.MESSAGES_KV.put(minuteKey, String(Number(perMinute || 0) + 1), {expirationTtl: 120}),
    env.MESSAGES_KV.put(dayKey, String(Number(perDay || 0) + count), {expirationTtl: 2 * 86400})
  ]);
  return true;
}

function validate(payload) {
  if (!payload || (payload.channel !== 'sms' && payload.channel !== 'email')) return 'Canal inconnu.';
  const list = Array.isArray(payload.messages) ? payload.messages : [];
  if (!list.length || list.length > MAX_MESSAGES) return `Entre 1 et ${MAX_MESSAGES} messages.`;
  for (const m of list) {
    const body = String(m?.body || '');
    if (!body.trim()) return 'Message vide.';
    if (!m.key || String(m.key).length > 160) return 'Clé d’idempotence manquante.';
    if (payload.channel === 'sms' && (!E164.test(String(m.to)) || body.length > SMS_MAX_CHARS)) return 'Numéro ou longueur de SMS invalide.';
    if (payload.channel === 'email' && (!EMAIL.test(String(m.to)) || body.length > EMAIL_MAX_CHARS || String(m.subject || '').length > 200)) return 'Adresse ou longueur d’e-mail invalide.';
  }
  if (payload.sendAt && Number.isNaN(Date.parse(payload.sendAt))) return 'Date d’envoi invalide.';
  return '';
}

// Alphabet GSM 03.38 (jeu de base et extension), comme smsSegments dans messaging.js : tout autre caractère
// (ê, â, î, ô, û, ç minuscule..., y compris en Latin-1) impose l'encodage Unicode, sinon le fournisseur l'altère.
const GSM_BASIC = new Set([...'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà']);
const GSM_EXTENDED = new Set([...'^{}\\[~]|€\f']);
export const needsUnicode = body => [...String(body ?? '')].some(c => !GSM_BASIC.has(c) && !GSM_EXTENDED.has(c));

async function sendSms(env, message) {
  const response = await fetch(`${BREVO}/transactionalSMS/sms`, {
    method: 'POST', headers: {'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json'},
    body: JSON.stringify({type: 'transactional', sender: env.BREVO_SMS_SENDER, recipient: message.to.slice(1), content: message.body, unicodeEnabled: needsUnicode(message.body)})
  });
  if (!response.ok) throw new Error(`Fournisseur SMS : ${response.status}`);
}
async function sendEmail(env, message) {
  const response = await fetch(`${BREVO}/smtp/email`, {
    method: 'POST', headers: {'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json'},
    body: JSON.stringify({sender: {email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME || 'Parcelles'}, to: [{email: message.to}], subject: message.subject || '(sans objet)', textContent: message.body})
  });
  if (!response.ok) throw new Error(`Fournisseur e-mail : ${response.status}`);
}

// Envoi d'un message avec idempotence : la clé est posée avant l'appel au fournisseur (au pire un message
// perdu signalé en échec, jamais deux SMS), puis confirmée ; en cas d'échec, elle est retirée pour permettre un réessai.
async function deliverOne(env, farm, channel, message) {
  const idemKey = `idem:${farm.farm}:${message.key}`;
  if (await env.MESSAGES_KV.get(idemKey)) return {to: message.to, status: 'duplicate'};
  await env.MESSAGES_KV.put(idemKey, 'en-cours', {expirationTtl: IDEMPOTENCY_TTL});
  try {
    if (channel === 'sms') await sendSms(env, message); else await sendEmail(env, message);
    await env.MESSAGES_KV.put(idemKey, 'envoye', {expirationTtl: IDEMPOTENCY_TTL});
    return {to: message.to, status: 'sent'};
  } catch (error) {
    await env.MESSAGES_KV.delete(idemKey);
    return {to: message.to, status: 'failed', error: String(error?.message || 'Échec').slice(0, 200)};
  }
}

// Chiffrement des messages programmés (AES-GCM, clé STORE_KEY) : rien de lisible au repos dans KV.
async function storeKey(env) {
  const raw = Uint8Array.from(atob(String(env.STORE_KEY || '')), c => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('STORE_KEY absente ou invalide.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await storeKey(env), new TextEncoder().encode(JSON.stringify(value)));
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(data)))}`;
}
async function unseal(env, sealed) {
  const [iv, data] = String(sealed).split('.').map(part => Uint8Array.from(atob(part), c => c.charCodeAt(0)));
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv}, await storeKey(env), data)));
}

async function handleSend(request, env, origin) {
  const farm = await farmFor(request, env);
  if (!farm) return json({error: 'Jeton refusé.'}, 401, origin);
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY) return json({error: 'Requête trop volumineuse.'}, 413, origin);
  let payload;
  try { payload = JSON.parse(await request.text()); } catch { return json({error: 'JSON invalide.'}, 400, origin); }
  const problem = validate(payload);
  if (problem) return json({error: problem}, 400, origin);
  const {channel, messages} = payload;
  if (channel === 'sms' && !env.BREVO_SMS_SENDER) return json({error: 'SMS non configurés sur la passerelle.'}, 400, origin);
  if (channel === 'email' && !env.BREVO_SENDER_EMAIL) return json({error: 'E-mails non configurés sur la passerelle.'}, 400, origin);
  if (!(await withinLimits(env, farm, channel, messages.length))) { log({farm: farm.farm, channel, count: messages.length, status: 'limite'}); return json({error: 'Trop d’envois, réessayez plus tard.'}, 429, origin); }
  const sendAt = payload.sendAt ? Date.parse(payload.sendAt) : 0;
  let results;
  if (sendAt && sendAt > Date.now() + 60000) {
    if (sendAt > Date.now() + 14 * 86400000) return json({error: 'Programmation limitée à 14 jours.'}, 400, origin);
    try {
      results = [];
      for (const m of messages) {
        const key = `sched:${String(sendAt).padStart(15, '0')}:${crypto.randomUUID()}`;
        await env.MESSAGES_KV.put(key, await seal(env, {farm: farm.farm, channel, message: {to: m.to, body: m.body, subject: m.subject || '', key: m.key}}), {expirationTtl: Math.ceil((sendAt - Date.now()) / 1000) + 7 * 86400});
        results.push({to: m.to, status: 'scheduled'});
      }
    } catch (error) { return json({error: String(error?.message || 'Programmation impossible.')}, 500, origin); }
  } else {
    results = [];
    for (const m of messages) results.push(await deliverOne(env, farm, channel, {to: m.to, body: m.body, subject: m.subject || '', key: m.key}));
  }
  log({farm: farm.farm, channel, count: messages.length, sent: results.filter(r => r.status === 'sent').length, duplicate: results.filter(r => r.status === 'duplicate').length, failed: results.filter(r => r.status === 'failed').length, scheduled: results.filter(r => r.status === 'scheduled').length});
  return json({results}, 200, origin);
}

// Déclencheur planifié : envoie les messages programmés arrivés à échéance, puis les efface.
async function runScheduled(env) {
  const now = Date.now();
  let cursor;
  do {
    const page = await env.MESSAGES_KV.list({prefix: 'sched:', cursor});
    for (const {name} of page.keys) {
      const due = Number(name.split(':')[1]);
      if (due > now) continue;
      const sealed = await env.MESSAGES_KV.get(name);
      await env.MESSAGES_KV.delete(name);
      if (!sealed) continue;
      try {
        const item = await unseal(env, sealed);
        const result = await deliverOne(env, {farm: item.farm}, item.channel, item.message);
        log({farm: item.farm, channel: item.channel, count: 1, scheduledStatus: result.status});
      } catch (error) { log({status: 'programme-illisible', error: String(error?.message || '').slice(0, 80)}); }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (!origin) return new Response('Origine non autorisée.', {status: 403});
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(origin)});
    if (request.method !== 'POST') return json({error: 'Méthode non autorisée.'}, 405, origin);
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (path.endsWith('/health')) {
      const farm = await farmFor(request, env);
      if (!farm) return json({error: 'Jeton refusé.'}, 401, origin);
      return json({ok: true, sms: Boolean(env.BREVO_API_KEY && env.BREVO_SMS_SENDER), email: Boolean(env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL), scheduled: Boolean(env.STORE_KEY)}, 200, origin);
    }
    if (path.endsWith('/send')) return handleSend(request, env, origin);
    return json({error: 'Adresse inconnue.'}, 404, origin);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  }
};
