// n° 37 : squelettes de chargement (météo, satellite, photos, synchronisation initiale d'une ferme cloud).
// Construits avec .skeleton-line (motion.css) : l'animation est déjà coupée si prefers-reduced-motion.
// L'indicateur de synchronisation vivant existe déjà (sync-status-ui.js) : il n'est pas refait ici.

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const line = (cls = '', style = '') => `<span class="skeleton-line ${cls}"${style ? ` style="${style}"` : ''} aria-hidden="true"></span>`;

const SHAPES = {
  weather: () => `<div class="sk-row">${line('sk-circle')}<div class="sk-col">${line('', 'width:45%')}${line('sk-tall', 'width:30%')}</div></div>${line('', 'width:90%')}${line('short')}<div class="sk-grid sk-grid-6">${Array.from({length: 6}, () => line('sk-cell')).join('')}</div>`,
  chart: () => `${line('sk-block')}${line('', 'width:70%')}${line('short')}`,
  photos: () => `<div class="sk-grid sk-grid-4">${Array.from({length: 4}, () => line('sk-square')).join('')}</div>`,
  list: rows => Array.from({length: rows}, (_, i) => `<div class="sk-row sk-item">${line('sk-circle')}<div class="sk-col">${line('', `width:${[62, 48, 70, 55][i % 4]}%`)}${line('short', 'width:38%')}</div></div>`).join(''),
  text: rows => Array.from({length: rows}, (_, i) => line(i === rows - 1 ? 'short' : '')).join('')
};

// HTML d'un squelette ; `label` est lu par les lecteurs d'écran (aria-busy + statut).
export function skeletonHtml(kind = 'list', {label = 'Chargement…', rows = 4, note = ''} = {}) {
  const shape = SHAPES[kind] || SHAPES.list;
  const n = Math.max(1, Math.min(12, Number(rows) || 4));
  return `<div class="skeleton-block sk-${SHAPES[kind] ? kind : 'list'}" role="status" aria-busy="true" aria-live="polite"><span class="sr-only">${esc(label)}</span>${shape(n)}${note ? `<p class="form-note sk-note">${esc(note)}</p>` : ''}</div>`;
}

// Synchronisation initiale d'une exploitation cloud : rien en local, jamais synchronisée, compte connecté
// et réseau présent (la première synchronisation est imminente ou en cours). Un échec arrête le squelette.
// `syncAllowed` : faux si la synchronisation ne partira pas (auto désactivée, réseau refusé par « Wi-Fi seul ») ;
// _sync lève alors avant de renseigner lastSyncError, le squelette masquerait l'état vide indéfiniment.
export function initialCloudSyncPending({cloud = false, connected = false, online = true, syncAllowed = true, lastSyncAt = null, lastSyncError = null, parcelCount = 0} = {}) {
  return Boolean(cloud && connected && online && syncAllowed && !lastSyncAt && !lastSyncError && !parcelCount);
}
