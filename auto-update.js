// @ts-check
// Registre des données de référence mises à jour automatiquement (chantier A0).
// Module pur, sans import d'app.js : fetch, stockage, horloge et état réseau sont injectés.
// Chaque source a une valeur embarquée (repli), un cache horodaté dans localStorage
// ('parcelles:ref:<id>') et une vérification réseau bornée (TTL, délai, backoff après échec).
// Un résultat invalide n'écrase jamais la dernière valeur validée.

export const CACHE_PREFIX = 'parcelles:ref:';
export const DEFAULT_FAIL_BACKOFF_MS = 10 * 60 * 1000;
export const DEFAULT_TIMEOUT_MS = 10000;
export const ENSURE_ALL_DEBOUNCE_MS = 60 * 1000;
export const DEFAULT_TTL_MS = 24 * 3600 * 1000;

// Âge d'un horodatage ; un instant dans le futur (horloge de l'appareil corrigée depuis) compte comme inconnu.
const ageOf = (t, at) => (Number.isFinite(at) && at <= t ? t - at : Infinity);

/** Vrai si l'appareil demande d'économiser les données (navigator.connection.saveData). */
export function isSaveData(nav = globalThis.navigator) {
  try { return /** @type {any} */ (nav)?.connection?.saveData === true; } catch { return false; }
}

const httpError = res => new Error(`http-${res?.status ?? 'erreur'}`);

/**
 * Lit une réponse texte en refusant tout ce qui dépasse maxBytes (lève 'too-large').
 * Lit le flux quand il existe, pour s'arrêter dès que la limite est franchie.
 */
export async function fetchTextLimited(fetchFn, url, {signal, maxBytes = Infinity} = {}) {
  const res = await fetchFn(url, {signal});
  if (!res || !res.ok) throw httpError(res);
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('too-large');
  const reader = res.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    let total = 0, text = '';
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value?.byteLength || 0;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* flux déjà fermé */ }
        throw new Error('too-large');
      }
      text += decoder.decode(value, {stream: true});
    }
    return text + decoder.decode();
  }
  const text = await res.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('too-large');
  return text;
}

/** Charge du JSON ; avec maxBytes, passe par fetchTextLimited. */
export async function fetchJson(fetchFn, url, {signal, maxBytes} = {}) {
  if (maxBytes != null) return JSON.parse(await fetchTextLimited(fetchFn, url, {signal, maxBytes}));
  const res = await fetchFn(url, {signal});
  if (!res || !res.ok) throw httpError(res);
  return res.json();
}

function defaultStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

// Page en cours de fermeture ou de rechargement (pagehide, remis à faux par pageshow si la page revient du
// cache de navigation) : le navigateur coupe alors les requêtes en vol (« Failed to fetch »). Ce n'est pas une
// panne de la source, il ne faut ni l'afficher en échec ni la bloquer 10 min au démarrage suivant.
function defaultUnloading(target = globalThis) {
  let leaving = false;
  try {
    target?.addEventListener?.('pagehide', () => { leaving = true; });
    target?.addEventListener?.('pageshow', () => { leaving = false; });
  } catch { /* pas de fenêtre (tests, worker) */ }
  return () => leaving;
}

/**
 * @param {{storage?: any, fetch?: any, now?: () => number, online?: () => boolean, unloading?: () => boolean, logger?: any}} [options]
 */
export function createAutoUpdater({
  storage = defaultStorage(),
  fetch = globalThis.fetch?.bind(globalThis),
  now = () => Date.now(),
  online = () => globalThis.navigator?.onLine !== false,
  unloading = defaultUnloading(),
  logger
} = {}) {
  const defs = new Map();
  const memory = new Map();         // cache de secours si le stockage est indisponible
  const inflight = new Map();       // id -> promesse en cours (dédoublonnage)
  const fetchedThisSession = new Set();
  const lastAll = new Map();        // reason -> instant du dernier ensureAll
  const listeners = new Set();
  const memoryNewer = new Set();    // ids dont la dernière écriture n'a pas pu aller dans le stockage (quota…)

  const warn = (...args) => { try { logger?.warn?.(...args); } catch { /* journal facultatif */ } };

  function readCache(id) {
    if (memoryNewer.has(id)) return memory.get(id) || null;
    try {
      const raw = storage?.getItem?.(CACHE_PREFIX + id);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (error) { warn('auto-update: lecture du cache impossible', id, error); }
    return memory.get(id) || null;
  }

  function writeCache(id, entry) {
    memory.set(id, entry);
    try {
      if (!storage?.setItem) throw new Error('stockage indisponible');
      storage.setItem(CACHE_PREFIX + id, JSON.stringify(entry));
      memoryNewer.delete(id);
    } catch (error) {
      // Quota dépassé ou stockage bloqué : la copie en mémoire fait foi, pas l'ancienne entrée du stockage.
      memoryNewer.add(id);
      warn('auto-update: écriture du cache impossible', id, error);
    }
  }

  function notify() {
    for (const fn of [...listeners]) {
      try { fn(status()); } catch (error) { warn('auto-update: abonné en erreur', error); }
    }
  }

  function register(def) {
    if (!def || typeof def.id !== 'string' || !def.id) throw new Error('auto-update: id requis');
    if (typeof def.check !== 'function') throw new Error(`auto-update: check requis pour ${def.id}`);
    // Une durée absente, undefined, NaN ou négative reprend la valeur par défaut (sinon timeoutMs undefined
    // déclencherait un délai immédiat et ttlMs undefined une vérification à chaque appel).
    const ms = (v, fallback) => (Number.isFinite(v) && v >= 0 ? v : fallback);
    defs.set(def.id, {
      embedded: {value: undefined, version: null, label: null}, ...def,
      failBackoffMs: ms(def.failBackoffMs, DEFAULT_FAIL_BACKOFF_MS),
      timeoutMs: ms(def.timeoutMs, DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
      ttlMs: ms(def.ttlMs, DEFAULT_TTL_MS),
      // Durée relue à chaque vérification : une source peut la donner par un accesseur (ex. BCAE, plus courte en janvier).
      liveTtlMs: () => ms(def.ttlMs, DEFAULT_TTL_MS)
    });
    notify();
    return api;
  }

  function get(id) {
    const def = defs.get(id);
    if (!def) return null;
    const entry = readCache(id);
    const t = now();
    const hasValue = Boolean(entry && entry.okAt && 'value' in entry);
    const okAt = hasValue ? entry.okAt : null;
    return {
      value: hasValue ? entry.value : def.embedded?.value,
      version: hasValue ? (entry.version ?? null) : (def.embedded?.version ?? null),
      origin: hasValue ? (fetchedThisSession.has(id) ? 'reseau' : 'cache') : 'embarque',
      okAt,
      checkedAt: entry?.checkedAt ?? null,
      sourceDate: hasValue ? (entry.sourceDate ?? null) : null,
      note: hasValue ? (entry.note ?? null) : null,
      stale: ageOf(t, okAt) > def.liveTtlMs(),
      error: entry?.error ?? null,
      errorAt: entry?.errorAt ?? null
    };
  }

  const value = id => get(id)?.value;

  function status() {
    return [...defs.values()].map(def => ({
      id: def.id, label: def.label || def.id, ttlMs: def.liveTtlMs(),
      embeddedVersion: def.embedded?.version ?? null, embeddedLabel: def.embedded?.label ?? null,
      pending: inflight.has(def.id), ...get(def.id)
    }));
  }

  function skipReason(def, force) {
    if (!online()) return 'hors-ligne';
    try { if (def.when && !def.when()) return 'desactive'; } catch { return 'desactive'; }
    if (typeof fetch !== 'function') return 'sans-reseau';
    if (force) return null;
    const entry = readCache(def.id), t = now();
    if (entry?.okAt && ageOf(t, entry.okAt) <= def.liveTtlMs()) return 'frais';
    if (entry?.errorAt && (!entry.okAt || entry.errorAt >= entry.okAt) && ageOf(t, entry.errorAt) < def.failBackoffMs) return 'backoff';
    return null;
  }

  async function run(def, reason) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const cached = get(def.id);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller?.abort(); reject(new Error('timeout')); }, def.timeoutMs);
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => def.check({fetch, signal: controller?.signal, cached, now, reason})),
        timeout
      ]);
      let valid = Boolean(result && typeof result === 'object' && 'value' in result && result.value !== undefined);
      if (valid && def.validate) {
        try { valid = def.validate(result) === true; } catch { valid = false; }
      }
      if (!valid) throw new Error('invalide');
      const t = now();
      writeCache(def.id, {value: result.value, version: result.version ?? null, sourceDate: result.sourceDate ?? null,
        note: result.note ?? null, checkedAt: t, okAt: t, error: null, errorAt: null});
      fetchedThisSession.add(def.id);
    } catch (error) {
      // Requête coupée par la fermeture de la page : la dernière vérification connue reste telle quelle.
      let leaving = false;
      try { leaving = unloading?.() === true; } catch { leaving = false; }
      if (leaving) return;
      const t = now();
      const prev = readCache(def.id) || {};
      const message = controller?.signal?.aborted ? 'timeout' : (error?.message || String(error));
      writeCache(def.id, {...prev, checkedAt: t, error: message, errorAt: t});
      warn('auto-update: vérification en échec', def.id, message);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Vérifie une source si nécessaire ; renvoie get(id) avec `skipped` (raison) ou null. */
  async function ensure(id, {force = false, reason = 'auto'} = {}) {
    const def = defs.get(id);
    if (!def) return null;
    const pending = inflight.get(id);
    if (pending) { await pending; return {...get(id), skipped: 'en-cours'}; }
    const skipped = skipReason(def, force);
    if (skipped) return {...get(id), skipped};
    const promise = run(def, reason).finally(() => { inflight.delete(id); notify(); });
    inflight.set(id, promise);
    notify();
    await promise;
    return {...get(id), skipped: null};
  }

  /** Vérifie toutes les sources une à une ; anti-rebond de 60 s par raison (sauf force). */
  async function ensureAll({reason = 'auto', force = false} = {}) {
    const t = now();
    const last = lastAll.get(reason);
    if (!force && last != null && ageOf(t, last) < ENSURE_ALL_DEBOUNCE_MS) return [];
    lastAll.set(reason, t);
    const results = [];
    for (const id of [...defs.keys()]) results.push(await ensure(id, {force, reason}));
    // Passage entièrement hors ligne : il ne consomme pas l'anti-rebond, la prochaine demande retente.
    if (results.length && results.every(r => r?.skipped === 'hors-ligne')) {
      if (last == null) lastAll.delete(reason); else lastAll.set(reason, last);
    }
    return results;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  const api = {register, get, ensure, ensureAll, status, subscribe, value};
  return api;
}
