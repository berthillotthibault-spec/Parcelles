// Verrouillage optionnel de Parcelles (n° 140) : logique pure, sans DOM (testée avec node:test).
// C'est une PROTECTION D'ACCÈS à l'écran, pas un chiffrement du disque : les données restent lisibles
// par quelqu'un qui accède aux fichiers du navigateur. Le réglage est propre à l'appareil (localStorage),
// il ne part ni dans les sauvegardes ni dans la synchronisation.

export const LOCK_STORAGE_KEY = 'parcelles:app-lock';
export const LOCK_ACTIVITY_KEY = 'parcelles:app-lock-active';
export const LOCK_MINUTES = [1, 2, 5, 10, 15, 30, 60];
export const PIN_ITERATIONS = 200000;
const FREE_ATTEMPTS = 5, BASE_DELAY = 30000, MAX_DELAY = 300000;

const encoder = new TextEncoder();
const toBase64 = bytes => { let s = ''; const v = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); for (const b of v) s += String.fromCharCode(b); return btoa(s); };
const fromBase64 = value => Uint8Array.from(atob(String(value || '')), c => c.charCodeAt(0));
const subtle = () => { if (!globalThis.crypto?.subtle) throw new Error('Web Crypto indisponible sur cet appareil.'); return globalThis.crypto.subtle; };

export function normalizeLockConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const minutes = LOCK_MINUTES.includes(Number(c.minutes)) ? Number(c.minutes) : 5;
  const hasPin = typeof c.pinHash === 'string' && typeof c.pinSalt === 'string' && c.pinHash && c.pinSalt;
  return {
    // Jamais actif sans PIN : le PIN est le repli obligatoire si Face ID / empreinte échoue.
    enabled: Boolean(c.enabled && hasPin), minutes,
    pinHash: hasPin ? c.pinHash : '', pinSalt: hasPin ? c.pinSalt : '', pinIterations: Number(c.pinIterations) || PIN_ITERATIONS,
    credentialId: typeof c.credentialId === 'string' ? c.credentialId : '',
    failedAttempts: Math.max(0, Number(c.failedAttempts) || 0), blockedUntil: Math.max(0, Number(c.blockedUntil) || 0)
  };
}

export const validPin = pin => /^\d{6,12}$/.test(String(pin || ''));

export async function hashPin(pin, saltB64, iterations = PIN_ITERATIONS) {
  const material = await subtle().importKey('raw', encoder.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({name: 'PBKDF2', salt: fromBase64(saltB64), iterations, hash: 'SHA-256'}, material, 256);
  return toBase64(new Uint8Array(bits));
}

export async function createPinRecord(pin, {iterations = PIN_ITERATIONS} = {}) {
  if (!validPin(pin)) throw new Error('Le code doit comporter 6 à 12 chiffres.');
  const pinSalt = toBase64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  return {pinSalt, pinHash: await hashPin(pin, pinSalt, iterations), pinIterations: iterations};
}

export async function verifyPin(config, pin) {
  if (!config?.pinHash || !validPin(pin)) return false;
  const a = await hashPin(pin, config.pinSalt, config.pinIterations || PIN_ITERATIONS), b = config.pinHash;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// Doit-on verrouiller ? (inactivité supérieure au délai choisi)
export function shouldLock(config, lastActiveAt, now = Date.now()) {
  if (!config?.enabled) return false;
  const last = Number(lastActiveAt) || 0;
  return !last || now - last >= config.minutes * 60000;
}

// Échecs de code : délai croissant après 5 essais, plafonné à 5 min. Jamais de blocage définitif.
export function registerFailure(config, now = Date.now()) {
  const failedAttempts = (config.failedAttempts || 0) + 1;
  const over = failedAttempts - FREE_ATTEMPTS;
  const blockedUntil = over > 0 ? now + Math.min(MAX_DELAY, BASE_DELAY * 2 ** (over - 1)) : 0;
  return {...config, failedAttempts, blockedUntil};
}
export const resetFailures = config => ({...config, failedAttempts: 0, blockedUntil: 0});
export const waitSeconds = (config, now = Date.now()) => Math.max(0, Math.ceil(((config?.blockedUntil || 0) - now) / 1000));

// --- WebAuthn plateforme (Face ID, Touch ID, Windows Hello, empreinte Android) ---
// Pas de serveur : l'assertion n'est pas vérifiée cryptographiquement, seule compte la vérification
// de l'utilisateur par l'appareil. D'où la présentation comme simple protection d'accès.
export async function platformAuthAvailable(nav = globalThis.navigator, PKC = globalThis.PublicKeyCredential) {
  try { return Boolean(nav?.credentials && PKC?.isUserVerifyingPlatformAuthenticatorAvailable && await PKC.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}

export async function registerPlatformCredential({nav = globalThis.navigator, rpId = globalThis.location?.hostname, label = 'Parcelles'} = {}) {
  const random = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
  const credential = await nav.credentials.create({publicKey: {
    challenge: random(32), rp: {name: 'Parcelles', ...(rpId ? {id: rpId} : {})},
    user: {id: random(16), name: label, displayName: label},
    pubKeyCredParams: [{type: 'public-key', alg: -7}, {type: 'public-key', alg: -257}],
    authenticatorSelection: {authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged'},
    timeout: 60000, attestation: 'none'
  }});
  if (!credential?.rawId) throw new Error('Aucun identifiant créé.');
  return toBase64(new Uint8Array(credential.rawId));
}

export async function unlockWithPlatform(config, {nav = globalThis.navigator} = {}) {
  if (!config?.credentialId) return false;
  try {
    const assertion = await nav.credentials.get({publicKey: {
      challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{type: 'public-key', id: fromBase64(config.credentialId), transports: ['internal']}],
      userVerification: 'required', timeout: 60000
    }});
    return Boolean(assertion && toBase64(new Uint8Array(assertion.rawId)) === config.credentialId);
  } catch { return false; } // annulé, refusé ou indisponible : on retombe sur le code
}
