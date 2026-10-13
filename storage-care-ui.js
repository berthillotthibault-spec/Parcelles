// n° 135 : interface « Espace et protection » (Mes données, alerte de quota, rappel unique sur Aujourd'hui).
// Repli silencieux : sans navigator.storage, on affiche seulement ce qui est mesurable.
import {EVICTED_ATTACHMENTS_KEY, KEEP_BACKUPS, addEvicted, backupsToPurge, breakdownSegments, cloudCopyVerified, evictableAttachments, formatSize, protectionAdvice, quotaLevel, removeEvicted} from './storage-care.js';
import {detectInstallState, requestPersistentStorage, storageHealth} from './runtime.js';
import {escapeHtml} from './utils.js';

const NUDGE_KEY = 'parcelles:storage-protect-nudged';
const PRESSURE_KEY = 'parcelles:storage-pressure-day';

export function createStorageCareUI({store, modal, closeModal, toast, getSync = () => null, offlineMap = () => null, openInstall = () => {}}) {
  const $ = selector => document.querySelector(selector);
  const supported = () => Boolean(globalThis.navigator?.storage?.persist);
  const once = (key, value) => {try {if (localStorage.getItem(key) === value) return false; localStorage.setItem(key, value); return true;} catch {return false;}};

  async function evictedList() {return (await store.storage.get(EVICTED_ATTACHMENTS_KEY).catch(() => null)) || [];}

  async function measure() {
    const [health, breakdown, backups] = await Promise.all([
      storageHealth().catch(() => ({estimate: null, persisted: false})),
      store.storage.breakdown().catch(() => null),
      store.storage.backupList().catch(() => [])
    ]);
    const tileBytes = Number(offlineMap()?.readMeta?.()?.bytes) || 0;
    const usage = Number(health.estimate?.usage) || 0, quota = Number(health.estimate?.quota) || 0;
    return {health, breakdown, backups, tileBytes, usage, quota, level: quotaLevel(usage, quota),
      segments: breakdownSegments({usage, quota, blobBytes: breakdown?.blobBytes, backupBytes: breakdown?.backupBytes, tileBytes})};
  }

  async function candidates() {
    const entities = ['photos', 'documents'].flatMap(type => store.list(type).map(e => ({...e, type})));
    const withCloud = entities.filter(e => e.cloudPath);
    if (!withCloud.length) return [];
    const sizes = new Map();
    for (const e of withCloud) {const blob = await store.storage.blobGet(e.id).catch(() => null); if (blob?.size) sizes.set(e.id, blob.size);}
    return evictableAttachments(withCloud, sizes);
  }

  function barHtml(m) {
    const segs = m.segments.filter(s => s.bytes > 0);
    const total = m.quota ? `${formatSize(m.usage)} utilisés sur ${formatSize(m.quota)} disponibles (${m.level.pct} %)` : 'Quota non communiqué par le navigateur.';
    return `<div class="sc-bar" role="img" aria-label="${escapeHtml(total)}">${segs.map(s => `<span class="sc-seg sc-${s.key}" style="width:${Math.max(s.pct, 0.6)}%"></span>`).join('')}</div>
      <p class="form-note">${escapeHtml(total)}</p>
      <ul class="sc-legend">${m.segments.map(s => `<li><i class="sc-dot sc-${s.key}"></i>${escapeHtml(s.label)} <strong>${formatSize(s.bytes)}</strong></li>`).join('')}</ul>`;
  }

  function protectionHtml(m) {
    const advice = protectionAdvice({persisted: m.health.persisted, supported: supported(), installState: detectInstallState()});
    const install = !advice.protected && supported() && ['installable', 'ios-safari', 'unsupported'].includes(detectInstallState());
    return `<div class="notice ${advice.protected ? 'success' : 'warning'} sc-protect"><strong>${escapeHtml(advice.title)}</strong><p>${escapeHtml(advice.text)}</p>${advice.steps.length ? `<ol>${advice.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : ''}${!advice.protected && supported() ? `<div class="filter-row">${install ? '<button class="button secondary" type="button" id="sc-install">Installer Parcelles</button>' : ''}<button class="button primary" type="button" id="sc-persist">Demander la protection</button></div>` : ''}</div>`;
  }

  // Carte compacte insérée dans Mes données.
  async function cardHtml() {
    const m = await measure();
    const tone = m.level.level === 'critical' ? 'danger' : m.level.level === 'warn' || !m.health.persisted ? 'warning' : 'info';
    const line = `${m.health.persisted ? 'Protégées contre l’effacement' : 'Non protégées contre l’effacement'}${m.quota ? ` · ${m.level.pct} % de l’espace utilisé` : ''}`;
    return `<button class="menu-row" data-action="open-storage-care"><span>${tone === 'info' ? '✓' : '!'}</span><span><strong>Espace et protection des données</strong><small>${escapeHtml(line)}</small></span><b>›</b></button>`;
  }

  async function open() {
    const m = await measure();
    const cands = await candidates().catch(() => []);
    const purge = backupsToPurge(m.backups, KEEP_BACKUPS);
    const purgeBytes = purge.reduce((s, b) => s + new Blob([JSON.stringify(b.state || {})]).size, 0);
    const candBytes = cands.reduce((s, c) => s + c.bytes, 0);
    const sync = getSync(), cloudReady = Boolean(sync?.storage && sync?.user && navigator.onLine !== false);
    const rows = [];
    if (cands.length) rows.push(`<label class="sc-option"><input type="checkbox" name="photos" ${cloudReady ? '' : 'disabled'}> <span><strong>Libérer ${formatSize(candBytes)} : ${cands.length} photo${cands.length > 1 ? 's' : ''} ou document${cands.length > 1 ? 's' : ''} déjà dans le cloud</strong><small>${cloudReady ? 'Chaque copie cloud est retéléchargée et comparée avant suppression locale. Rechargées à la demande à l’ouverture (réseau nécessaire) ; absentes de la sauvegarde ZIP locale tant qu’elles ne sont pas rechargées.' : 'Connectez-vous au cloud et au réseau pour vérifier les copies avant de libérer.'}</small></span></label>`);
    if (purge.length) rows.push(`<label class="sc-option"><input type="checkbox" name="backups"> <span><strong>Supprimer ${purge.length} ancienne${purge.length > 1 ? 's' : ''} sauvegarde${purge.length > 1 ? 's' : ''} automatique${purge.length > 1 ? 's' : ''} (${formatSize(purgeBytes)})</strong><small>Les ${KEEP_BACKUPS} plus récentes de chaque exploitation sont conservées.</small></span></label>`);
    if (m.tileBytes) rows.push(`<label class="sc-option"><input type="checkbox" name="tiles"> <span><strong>Supprimer la carte hors connexion (${formatSize(m.tileBytes)})</strong><small>Elle pourra être retéléchargée depuis Carte hors connexion.</small></span></label>`);
    const cleanup = rows.length ? `<form id="sc-form" class="stack-list">${rows.join('')}</form>` : '<p class="form-note">Rien à libérer pour l’instant : seules les pièces déjà sauvegardées dans le cloud, les anciennes sauvegardes automatiques et la carte hors connexion peuvent l’être.</p>';
    modal('Espace et protection', 'Ce que Parcelles occupe sur cet appareil et comment le protéger.',
      `${protectionHtml(m)}<h3 class="sc-title">Répartition</h3>${barHtml(m)}<h3 class="sc-title">Libérer de l’espace</h3>${cleanup}`,
      `<button class="button secondary" data-action="close-modal">Fermer</button>${rows.length ? '<button class="button primary" type="button" id="sc-clean">Libérer</button>' : ''}`);
    $('#sc-install')?.addEventListener('click', () => {closeModal(); openInstall();});
    $('#sc-persist')?.addEventListener('click', async () => {
      const granted = await requestPersistentStorage();
      toast(granted ? 'Protection accordée : le navigateur n’effacera plus vos données.' : 'Le navigateur a refusé pour l’instant. Installez Parcelles puis réessayez.', granted ? 'success' : 'error');
      if (granted) open();
    });
    $('#sc-clean')?.addEventListener('click', async event => {
      const form = $('#sc-form'), button = event.currentTarget;
      if (!form) return;
      const want = {photos: form.photos?.checked, backups: form.backups?.checked, tiles: form.tiles?.checked};
      if (!want.photos && !want.backups && !want.tiles) {toast('Cochez au moins un élément à libérer.', 'error'); return;}
      button.disabled = true; button.textContent = 'Libération…';
      let freed = 0, skipped = 0;
      try {
        if (want.backups) for (const b of purge) {await store.storage.backupDelete(b.id); freed += new Blob([JSON.stringify(b.state || {})]).size;}
        if (want.tiles) {await offlineMap()?.remove?.(); freed += m.tileBytes;}
        if (want.photos && cloudReady) {
          const done = [];
          for (const c of cands) {
            try {
              const remote = await sync.fetchCloudBlob(store.get(c.type, c.id));
              if (!cloudCopyVerified(c.bytes, remote?.size)) {skipped++; continue;}
              await store.storage.blobDelete(c.id); done.push(c.id); freed += c.bytes;
            } catch {skipped++;}
          }
          if (done.length) await store.storage.set(EVICTED_ATTACHMENTS_KEY, addEvicted(await evictedList(), done));
        }
        closeModal();
        toast(`${formatSize(freed)} libérés.${skipped ? ` ${skipped} pièce${skipped > 1 ? 's' : ''} conservée${skipped > 1 ? 's' : ''} : copie cloud non vérifiée.` : ''}`, 'success');
      } catch (error) {
        button.disabled = false; button.textContent = 'Libérer';
        toast(`Nettoyage interrompu : ${error.message}`, 'error');
      }
    });
  }

  // Recharge à la demande une pièce libérée (null si impossible : hors ligne, pas de cloud).
  async function reload(entity) {
    const sync = getSync();
    if (!entity?.cloudPath || !sync?.fetchCloudBlob) return null;
    try {
      const blob = await sync.fetchCloudBlob(entity);
      await store.storage.blobPut(entity.id, blob);
      await store.storage.set(EVICTED_ATTACHMENTS_KEY, removeEvicted(await evictedList(), entity.id));
      return blob;
    } catch {return null;}
  }

  // Alerte de quota (remplace l'ancien simple avertissement) : au plus une fois par jour.
  async function checkPressure() {
    try {
      const m = await measure();
      if (m.level.level === 'ok' || m.level.level === 'unknown') return;
      if (!once(PRESSURE_KEY, new Date().toISOString().slice(0, 10))) return;
      toast(`Espace presque plein : ${m.level.pct} % utilisés.`, m.level.level === 'critical' ? 'error' : 'warning', {label: 'Libérer', run: open}, {persist: m.level.level === 'critical'});
    } catch {}
  }

  // Rappel unique (sur Aujourd'hui) si le stockage n'est pas protégé.
  async function nudgeOnce() {
    try {
      if (!supported()) return;
      const health = await storageHealth();
      if (health.persisted) return;
      if (!once(NUDGE_KEY, '1')) return;
      toast('Vos données ne sont pas protégées contre l’effacement par le navigateur.', 'warning', {label: 'Protéger', run: open}, {persist: true});
    } catch {}
  }

  return {open, cardHtml, reload, checkPressure, nudgeOnce};
}
