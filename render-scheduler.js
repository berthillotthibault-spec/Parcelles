// n° 145 : ne rendre que la vue visible après une modification (logique pure, horloge et rAF injectés).
// Les autres vues sont marquées « à refaire » et rendues au changement d'onglet.

export const RENDER_VIEWS = ['today', 'parcels', 'work', 'map', 'parcel'];

// Vues touchées par une modification, d'après l'entité de l'événement du Store.
// null → tout est à refaire (restauration, import, espace changé, préférences…).
export function viewsForEvent(event = {}) {
  const {entity, kind} = event || {};
  if (!entity || entity === 'state' || entity === 'preferences' || ['restore', 'import', 'import-rollback', 'workspace-switch', 'external-reload', 'schema-lock'].includes(kind)) return null;
  if (entity === 'parcelles') return ['today', 'parcels', 'work', 'map', 'parcel'];
  if (entity === 'interventions') return ['today', 'work', 'parcels', 'map', 'parcel'];
  if (entity === 'tasks') return ['today', 'work', 'map', 'parcel'];
  if (entity === 'observations') return ['today', 'map', 'parcel'];
  if (['materiels', 'stockItems', 'stockMovements', 'fieldSessions', 'chantiers', 'automationRules', 'automationRuns'].includes(entity)) return ['today', 'parcel'];
  if (entity === 'points') return ['map', 'parcel'];
  if (entity === 'grazingSessions') return ['today', 'parcels', 'map', 'parcel'];
  if (['photos', 'documents', 'rotations', 'clients', 'maintenanceRecords', 'routeSessions', 'vetTreatments', 'integrationImports'].includes(entity)) return ['today', 'parcel'];
  return ['parcel'];
}

// Empreinte « carte » d'une fiche : ce qui change le dessin (contour, culture, statut, parcelle, suppression).
export function mapSignature(type, entity) {
  if (!entity) return '';
  if (type === 'parcelles') return JSON.stringify([entity.geometry || null, entity.culture || '', entity.status || '', entity.nom || '', Boolean(entity.deletedAt), entity.favorite || false]);
  if (type === 'interventions' || type === 'tasks') return JSON.stringify([entity.parcelId || '', entity.status || '', entity.date || '', entity.plannedDate || entity.dueDate || '', Boolean(entity.deletedAt)]);
  if (type === 'grazingSessions') return JSON.stringify([entity.parcelId || '', entity.startDate || '', entity.endDate || '', Boolean(entity.deletedAt)]);
  if (type === 'observations' || type === 'points') return JSON.stringify([entity.latitude ?? null, entity.longitude ?? null, entity.parcelId || '', entity.status || '', Boolean(entity.deletedAt)]);
  return '';
}

export function createRenderScheduler({render, currentView, raf = cb => setTimeout(cb, 16), clock = () => Date.now(), onRendered = null} = {}) {
  const dirty = new Set(RENDER_VIEWS);
  const stats = {};
  const signatures = new Map();
  let frame = null;

  function run(view) {
    if (!dirty.has(view)) return false;
    dirty.delete(view);
    const start = clock();
    render(view);
    const ms = Math.max(0, clock() - start), row = stats[view] || (stats[view] = {count: 0, lastMs: 0, maxMs: 0, totalMs: 0});
    row.count += 1;row.lastMs = Math.round(ms * 10) / 10;row.maxMs = Math.max(row.maxMs, row.lastMs);row.totalMs += ms;
    onRendered?.(view, row.lastMs);
    return true;
  }
  function flushVisible() {
    frame = null;
    const view = currentView();
    if (RENDER_VIEWS.includes(view)) run(view);
  }
  // Marque des vues ; la visible est rendue à la prochaine image (plusieurs modifications → un seul rendu).
  function invalidate(views = null) {
    for (const view of views || RENDER_VIEWS) dirty.add(view);
    if (frame === null) frame = raf(flushVisible);
  }
  // Rendu immédiat de la vue visible (démarrage, rendu complet demandé).
  function renderNow(views = null) {
    for (const view of views || RENDER_VIEWS) dirty.add(view);
    flushVisible();
  }
  // Changement d'onglet : la vue d'arrivée est mise à jour avant d'être montrée.
  function show(view) {return run(view);}

  // La carte n'est redessinée que si une fiche change de contour, de culture ou de statut.
  function mapChanged(event = {}, data = {}) {
    const {entity, entityId} = event || {};
    if (!entity || !entityId || !Array.isArray(data[entity])) {signatures.clear();return true;}
    const item = data[entity].find(row => row?.id === entityId);
    const key = `${entity}:${entityId}`, next = mapSignature(entity, item), previous = signatures.get(key);
    signatures.set(key, next);
    if (!next && !previous) return false;
    return previous === undefined || previous !== next;
  }
  function remember(data = {}) {
    signatures.clear();
    for (const type of ['parcelles', 'interventions', 'tasks', 'grazingSessions', 'observations', 'points']) for (const item of data[type] || []) if (item?.id) signatures.set(`${type}:${item.id}`, mapSignature(type, item));
  }

  return {invalidate, renderNow, show, mapChanged, remember, isDirty: view => dirty.has(view), dirtyViews: () => [...dirty], stats: () => structuredClone(stats)};
}
