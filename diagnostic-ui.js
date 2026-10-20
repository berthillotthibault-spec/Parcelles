// Écran « Santé de l'application » (Plus › Mes données › Diagnostic, n° 147), sorti d'app.js et chargé en
// différé (lazy-modules.js, clé diagnostic) : il ne sert pas au premier rendu. app.js garde openDiagnostic,
// qui attend ce module (lazy.run) puis l'appelle. ctx : app-context.js.
import {APP_VERSION, BUILD_ID, escapeHtml, formatNumber, localDateTime} from './utils.js';
import {verifyDeployment, storageHealth, clearAppCaches, serviceWorkerStatus, resetRuntimeAndReload, downloadEmergencyState} from './runtime.js';
import {getRecordedErrors, clearRecordedErrors} from './diagnostics.js';
import {performanceHistory, resourceTimingSummary} from './performance.js';
import {nativeCapabilities} from './native.js';
import {platformSummary} from './platform.js';

const plural = (n, one, many) => (n > 1 ? many : one);
const COUNTED = ['parcelles', 'interventions', 'tasks', 'photos', 'documents', 'points', 'clients', 'observations', 'stockItems', 'materiels',
  'platformJobs'];
const RENDER_NAMES = {today: 'Aujourd’hui', parcels: 'Parcelles', work: 'Travaux', map: 'Carte', parcel: 'Fiche'};

// Décalage mesuré pendant la synchronisation cloud (heure du serveur Firestore) ; la synchronisation n'en dépend plus.
export function clockSkewLabel(skew) {
  const ms = Number(skew?.deviceOffsetMs);
  if (!skew || !Number.isFinite(ms)) return 'Non mesuré (synchronisation cloud requise)';
  const abs = Math.abs(ms), tolerance = Math.max(2000, Number(skew.uncertaintyMs) || 0);
  if (abs <= tolerance) return `À l’heure (écart inférieur à ${Math.ceil(tolerance / 1000)} s)`;
  const value = abs >= 60000 ? `${formatNumber(Math.round(abs / 6000) / 10)} min` : `${Math.round(abs / 1000)} s`;
  return `${ms > 0 ? '+' : '−'}${value} (l’appareil ${ms > 0 ? 'avance' : 'retarde'}) · mesuré le ${localDateTime(skew.measuredAt)}`;
}
export const clockSkewIsLarge = skew => Math.abs(Number(skew?.deviceOffsetMs) || 0) > 5 * 60000;

// Durées de rendu par écran (render-scheduler.js).
function renderStatsLabel(stats) {
  const rows = Object.entries(stats);
  return rows.length ? rows.map(([v, r]) => `${RENDER_NAMES[v] || v} ${r.count}× · ${String(r.lastMs).replace('.', ',')} ms `
    + `(max ${String(r.maxMs).replace('.', ',')})`).join(' ; ') : '—';
}

function healthChecks({deploy, store, reg, backups, data, recentErrors, sync, active}) {
  const failedCount = deploy.failed?.length || 0, rules = active('automationRules', data).filter(r => r.enabled).length;
  const skew = data.metadata.clockSkew, native = nativeCapabilities();
  return [
    {label: 'Déploiement', ok: Boolean(deploy.ok),
      detail: deploy.ok ? 'Ressources cohérentes' : `${failedCount} ${plural(failedCount, 'ressource', 'ressources')} en erreur`},
    {label: 'Stockage local', ok: !store.storage.usingFallback, detail: store.storage.usingFallback ? 'Mode de secours' : 'IndexedDB opérationnel'},
    {label: 'Service worker', ok: Boolean(reg), detail: reg ? 'Installé' : 'Absent'},
    {label: 'Sauvegardes', ok: backups.length > 0 || !data.preferences.autoBackup,
      detail: backups.length ? `${backups.length} ${plural(backups.length, 'sauvegarde', 'sauvegardes')} ${plural(backups.length, 'locale', 'locales')}`
        : data.preferences.autoBackup ? 'Aucune créée' : 'Automatiques désactivées'},
    {label: 'Erreurs 24 h', ok: recentErrors.length === 0,
      detail: recentErrors.length ? `${recentErrors.length} ${plural(recentErrors.length, 'erreur', 'erreurs')} `
        + `${plural(recentErrors.length, 'enregistrée', 'enregistrées')}` : 'Aucune erreur enregistrée'},
    {label: 'Cloud', ok: !data.preferences.syncEnabled || Boolean(sync?.status?.connected),
      detail: !data.preferences.syncEnabled ? 'Désactivé' : sync?.status?.message || 'Non initialisé'},
    {label: 'Automatisations', ok: true, detail: `${rules} ${plural(rules, 'règle', 'règles')} ${plural(rules, 'active', 'actives')}`},
    {label: 'Horloge', ok: !clockSkewIsLarge(skew),
      detail: clockSkewIsLarge(skew) ? `${clockSkewLabel(skew)} · réglez l’heure automatique de l’appareil` : clockSkewLabel(skew)},
    {label: 'Mode natif', ok: true, detail: native.native ? `Actif · ${native.platform}` : 'Web/PWA'}
  ];
}

export function createDiagnosticUI(ctx) {
  const {$} = ctx;

  async function open() {
    const store = ctx.store, sync = ctx.sync, active = ctx.active;
    const [estimate, deploy, health, backups, breakdown, swStatus] = await Promise.all([
      store.storage.estimate(),
      verifyDeployment().catch(error => ({ok: false, failed: [{path: 'deployment', error: error.message}], results: []})),
      storageHealth().catch(() => ({estimate: null, persisted: false})),
      store.storage.backupList(store.workspaceContext().id).catch(() => []),
      store.storage.breakdown().catch(() => null),
      serviceWorkerStatus().catch(() => null)
    ]);
    const reg = await navigator.serviceWorker?.getRegistration?.();
    const data = ctx.state();
    const blobs = await store.storage.blobKeys().catch(() => []), errors = getRecordedErrors();
    const perfRows = performanceHistory(), resources = resourceTimingSummary();
    const recentErrors = errors.filter(e => Date.now() - Number(e.createdAt || 0) <= 24 * 3600 * 1000);
    const usagePct = estimate.quota ? Math.round((estimate.usage || 0) / (estimate.quota || 1) * 100) : 0;
    const checks = healthChecks({deploy, store, reg, backups, data, recentErrors, sync, active});
    const scheduler = ctx.scheduler(), marks = ctx.perf.marks;
    const diag = {build: BUILD_ID, schema: APP_VERSION, revision: data.metadata.revision, clockSkew: data.metadata.clockSkew || null,
      userAgent: navigator.userAgent, language: navigator.language, online: navigator.onLine, serviceWorker: Boolean(reg),
      serviceWorkerController: Boolean(navigator.serviceWorker?.controller), serviceWorkerScope: reg?.scope || null,
      serviceWorkerReported: swStatus?.reported || null, indexedDbFallback: store.storage.usingFallback, storagePersisted: Boolean(health.persisted),
      storageUsage: estimate.usage, storageQuota: estimate.quota, storageUsagePercent: usagePct, blobCount: blobs.length, backupCount: backups.length,
      storageBreakdown: breakdown, performanceLatest: perfRows[0] || null, renderStats: scheduler.stats(),
      renderMarks: Object.fromEntries(Object.entries(marks).filter(([k]) => k.startsWith('render:'))), resourceTiming: resources,
      lastImportAt: data.metadata.lastImportAt, lastAutoBackupDay: data.metadata.lastAutoBackupDay, lastSyncAt: data.metadata.lastSyncAt,
      deploymentOk: deploy.ok, deploymentFailures: deploy.failed, counts: Object.fromEntries(COUNTED.map(t => [t, active(t, data).length])),
      recentErrors: errors.slice(0, 20),
      cloud: {enabled: Boolean(data.preferences.syncEnabled), connected: Boolean(sync?.status?.connected), workspaceId: data.preferences.workspaceId || null,
        workspaceStorage: store.workspaceContext(), role: sync?.role || 'owner', deviceId: sync?.deviceId || null, user: sync?.user?.email || null,
        status: sync?.status?.message || null},
      platform: platformSummary(data, store.workspaceContext()), native: nativeCapabilities(),
      automations: {enabled: data.preferences.automationEnabled !== false, rules: active('automationRules', data).length,
        runs: active('automationRuns', data).length, lastRunAt: data.metadata.automationLastRunAt || null}};
    const failed = deploy.failed?.length
      ? '<div class="notice danger"><strong>Ressources de déploiement manquantes</strong><br>'
        + `${deploy.failed.map(x => `${escapeHtml(x.path)} · ${escapeHtml(x.status || x.error || 'erreur')}`).join('<br>')}</div>`
      : '<div class="notice info">✓ Toutes les ressources principales du déploiement répondent correctement.</div>';
    const healthHtml = `<div class="health-grid">${checks.map(c => `<div class="health-card ${c.ok ? 'ok' : 'warn'}"><span>${c.ok ? '✓' : '!'}</span>`
      + `<div><strong>${escapeHtml(c.label)}</strong><small>${escapeHtml(c.detail)}</small></div></div>`).join('')}</div>`;
    const errorsHtml = errors.length
      ? `<details class="diagnostic-errors"><summary>Erreurs récentes (${errors.length})</summary><div class="stack-list">`
        + `${errors.slice(0, 10).map(e => `<div class="list-row"><div><strong>${escapeHtml(e.source || 'Erreur')}</strong>`
        + `<small>${localDateTime(e.createdAt)} · ${escapeHtml(e.message || '')}</small></div></div>`).join('')}</div></details>`
      : '<div class="notice info">Aucune erreur JavaScript enregistrée localement.</div>';
    const row = (label, value, id = '') => `<div><dt>${label}</dt><dd${id ? ` id="${id}"` : ''}>${value}</dd></div>`;
    const mo = bytes => formatNumber((bytes || 0) / 1024 / 1024);
    const definitions = ['<dl class="definition-list" style="margin:14px 0">', row('Build', escapeHtml(BUILD_ID)),
      row('Décalage d’horloge de l’appareil', escapeHtml(clockSkewLabel(data.metadata.clockSkew))),
      row('Stockage persistant', health.persisted ? 'Oui' : 'Non garanti'),
      row('Espace utilisé', `${mo(estimate.usage)} Mo / ${mo(estimate.quota)} Mo (${usagePct} %)`),
      row('Pièces jointes', blobs.length), row('Sauvegardes locales', backups.length), row('Service worker', reg ? 'Installé' : 'Absent'),
      row('Démarrage 7.1', `${perfRows[0]?.readyMs ?? '—'} ms`), row('Rendu des écrans', escapeHtml(renderStatsLabel(scheduler.stats())), 'render-stats'),
      row('Blobs', breakdown ? `${mo(breakdown.blobBytes)} Mo` : '—'),
      row('Sauvegardes', `${backups.filter(b => b.verified).length}/${backups.length} ${plural(backups.length, 'vérifiée', 'vérifiées')}`), '</dl>'].join('');
    const body = `${healthHtml}${failed}${definitions}${errorsHtml}<details><summary>Diagnostic complet</summary>`
      + `<pre class="diagnostic-pre">${escapeHtml(JSON.stringify(diag, null, 2))}</pre></details>`;
    const footer = ['<button class="button secondary" id="copy-diagnostic">Copier</button>',
      errors.length ? '<button class="button secondary" id="clear-errors">Effacer erreurs</button>' : '',
      '<button class="button secondary" id="clear-cache">Nettoyer cache</button><button class="button secondary" id="force-update">Mise à jour</button>',
      '<button class="button secondary" id="emergency-export">Export secours</button>',
      '<button class="button danger" id="reset-runtime">Réinitialiser cache/PWA</button>',
      '<button class="button primary" data-action="close-modal">Fermer</button>'].join('');
    ctx.modal('Santé de l’application', 'État du build, du stockage et des composants essentiels.', body, footer, 'large');
    $('#copy-diagnostic').onclick = async () => {
      const copied = await ctx.copyText(JSON.stringify(diag, null, 2));
      ctx.toast(copied ? 'Diagnostic copié.' : 'Copie impossible sur ce navigateur.', copied ? 'success' : 'error');
    };
    $('#emergency-export').onclick = async () => {
      try { await downloadEmergencyState(); ctx.toast('Export de secours téléchargé.'); } catch (error) { ctx.toast(error.message, 'error'); }
    };
    $('#reset-runtime').onclick = async () => {
      if (!confirm('Réinitialiser le cache et le service worker ? Vos données IndexedDB seront conservées.')) return;
      await resetRuntimeAndReload();
    };
    $('#clear-errors')?.addEventListener('click', () => { clearRecordedErrors(); ctx.toast('Journal d’erreurs effacé.'); open(); });
    $('#clear-cache').onclick = async () => { await clearAppCaches(); ctx.toast('Caches applicatifs nettoyés. Rechargez la page.'); };
    $('#force-update').onclick = async () => {
      try { await reg?.update?.(); ctx.toast('Recherche de mise à jour terminée.'); } catch (error) { ctx.toast(error.message, 'error'); }
    };
  }

  return {open};
}
