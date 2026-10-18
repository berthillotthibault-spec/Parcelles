// Écran « Activité » (n° 139) : frise du journal local et de l'audit cloud, filtres, fiche et historique, exports.
import {html, raw} from './safe-html.js';
import {emptyState} from './ui.js';
import {buildTimeline, filterTimeline, facets, timelineCsv, registerBlocks, entityLabel, actionLabel} from './activity.js';
import {flowPdf, pdfFile, sharePdf} from './pdf-lite.js';

const fmt = at => new Date(at).toLocaleString('fr-FR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});

export function createActivityLogUI({store, state, sync, modal, toast, openParcel, historyUI, download, doc = document} = {}) {
  let rows = [], filters = {};
  const parcelName = id => (id && store.get('parcelles', id, {includeDeleted: true})?.nom) || '';
  const lookup = (type, id) => store.get(type, id, {includeDeleted: true});
  const $ = sel => doc.querySelector(sel);

  async function load() {
    const connected = Boolean(sync?.status?.connected && sync?.workspaceId);
    const [audit, devices] = connected ? await Promise.all([sync.listActivity(200).catch(() => []), sync.listDevices?.().catch(() => []) || []]) : [[], []];
    rows = buildTimeline({journal: state().journal || [], audit, devices, deviceName: 'Cet appareil', lookup});
    return connected;
  }

  const option = (value, label, current) => html`<option value="${value}" ${raw(value === current ? 'selected' : '')}>${label}</option>`;
  function filtersHtml() {
    const f = facets(rows);
    const select = (name, label, values, labelOf = v => v) => html`<label class="field-label">${label}<select name="${name}">${option('', 'Tous', filters[name] || '')}${values.map(v => option(v, labelOf(v), filters[name] || ''))}</select></label>`;
    return html`<form id="activity-filters" class="activity-filters form-grid">
      ${select('person', 'Personne', f.people)}${select('device', 'Appareil', f.devices)}
      ${select('parcelId', 'Parcelle', f.parcels, id => parcelName(id) || 'Parcelle supprimée')}${select('type', 'Type', f.types, entityLabel)}
      <label class="field-label">Du<input type="date" name="from" value="${filters.from || ''}"></label>
      <label class="field-label">Au<input type="date" name="to" value="${filters.to || ''}"></label>
    </form>`;
  }
  function listHtml(list) {
    if (!list.length) return raw(emptyState({icon: 'search', title: 'Aucune activité pour ces filtres', text: 'Élargissez la période ou retirez un filtre.'}));
    return html`<ol class="activity-timeline">${list.slice(0, 300).map(r => html`<li class="activity-item">
      <button type="button" class="activity-row" data-activity-id="${r.id}" ${raw(r.entityType && r.entityId ? '' : 'disabled')}>
        <strong>${r.message}</strong>
        <small>${fmt(r.at)} · ${r.who || 'Vous'} · ${r.device || '—'}${r.entityType ? ` · ${entityLabel(r.entityType)}` : ''}${r.parcelId ? ` · ${parcelName(r.parcelId)}` : ''}</small>
        <span class="activity-source ${r.source}">${r.source === 'cloud' ? 'Cloud' : 'Local'}</span>
      </button></li>`)}</ol>${list.length > 300 ? html`<p class="form-note">300 premiers événements affichés ; l’export contient les ${list.length}.</p>` : ''}`;
  }
  const current = () => filterTimeline(rows, filters);
  function refreshList() { const box = $('#activity-list'); if (box) box.innerHTML = listHtml(current()); const n = $('#activity-count'); if (n) n.textContent = `${current().length} événement${current().length > 1 ? 's' : ''}`; }
  const filterText = () => Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${({person: 'personne', device: 'appareil', parcelId: 'parcelle', type: 'type', from: 'du', to: 'au'})[k]} ${k === 'parcelId' ? parcelName(v) : k === 'type' ? entityLabel(v) : v}`).join(', ');

  function openEntry(id) {
    const r = rows.find(x => x.id === id); if (!r?.entityType || !r.entityId) return;
    if (r.entityType === 'parcelles' && store.get('parcelles', r.entityId)) { openParcel(r.entityId, 'history'); return; }
    const entity = lookup(r.entityType, r.entityId);
    const title = entity?.nom || entity?.title || entity?.type || entity?.name || entityLabel(r.entityType);
    modal(`${entityLabel(r.entityType)} · ${title}`, `${actionLabel(r.action)} le ${fmt(r.at)}`,
      `${entity?.deletedAt ? '<p class="notice warning">Cet élément est dans la corbeille.</p>' : ''}<div id="activity-history" class="history-panel"></div>`,
      `<button class="button secondary" data-action="open-log">Retour à l’activité</button>${r.parcelId && store.get('parcelles', r.parcelId) ? `<button class="button primary" id="activity-open-parcel">Ouvrir la parcelle</button>` : ''}`);
    historyUI?.mount($('#activity-history'), r.entityType, r.entityId);
    $('#activity-open-parcel')?.addEventListener('click', () => openParcel(r.parcelId, 'summary'));
  }

  async function exportPdf() {
    const name = 'Registre des modifications';
    try {
      const file = pdfFile(flowPdf(registerBlocks(current(), {farm: state().preferences?.farmName || '', filters: filterText(), parcelName}), {title: name, footer: name}), name);
      const result = await sharePdf(file, {title: name});
      if (result !== 'cancelled') toast(result === 'shared' ? 'PDF partagé.' : 'PDF téléchargé.');
    } catch (error) { toast(`PDF impossible : ${error.message}`, 'error'); }
  }

  async function open() {
    filters = {};
    const connected = await load();
    modal('Activité', connected ? 'Journal de cet appareil et audit cloud de l’exploitation, du plus récent au plus ancien.' : 'Journal de cet appareil (500 derniers événements). Connectez une exploitation cloud pour voir l’activité de l’équipe.',
      `${filtersHtml()}<p class="form-note" id="activity-count" aria-live="polite"></p><div id="activity-list"></div>`,
      `<button class="button secondary" data-action="close-modal">Fermer</button><button class="button secondary" id="activity-csv">CSV</button><button class="button primary" id="activity-pdf">PDF « Registre »</button>`, 'large');
    refreshList();
    $('#activity-filters')?.addEventListener('input', event => { const f = event.currentTarget; filters = Object.fromEntries(new FormData(f)); refreshList(); });
    $('#activity-filters')?.addEventListener('submit', event => event.preventDefault());
    $('#activity-list')?.addEventListener('click', event => { const b = event.target.closest('[data-activity-id]'); if (b && !b.disabled) openEntry(b.dataset.activityId); });
    $('#activity-csv')?.addEventListener('click', () => download(`parcelles-activite-${new Date().toISOString().slice(0, 10)}.csv`, timelineCsv(current(), {parcelName}), 'text/csv;charset=utf-8'));
    $('#activity-pdf')?.addEventListener('click', exportPdf);
  }
  return {open, openEntry, get rows() { return rows; }};
}
