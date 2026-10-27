// Formulaires « Nouveau travail » et « Travail groupé » (n° 147), sortis d'app.js et chargés en différé
// (lazy-modules.js, clé workForm) : ils ne servent pas au premier rendu. app.js garde openWorkForm et
// openBatchWorkForm, qui attendent ce module (lazy.run) puis l'appellent. ctx : app-context.js.
import {campaignFor, escapeHtml, formatNumber, isoDate, toNullableNumber, toNumber, uid} from './utils.js';
import {recentWorkSuggestions} from './insights.js';
import {enhanceWorkForm, validateForm} from './form-chips-ui.js';
import {draftKey, persistFormDraft} from './form-drafts.js';

const STATUSES = ['À faire', 'À préparer', 'Prêt', 'En cours', 'Bloqué', 'Terminé', 'En retard', 'Annulé', 'Brouillon'];
const DOSE_UNITS = ['kg/ha', 'L/ha', 't/ha', 'm³/ha', 'unité/ha', 'graines/ha', 'q/ha', 'mm', 'autre'];
const BATCH_UNITS = ['kg/ha', 'L/ha', 't/ha', 'm³/ha', 'unité/ha'];
const TEMPLATE_KEYS = ['type', 'product', 'dose', 'doseUnit', 'operator', 'equipmentId', 'culture'];

const options = (values, selected) => values.map(v => `<option ${selected === v ? 'selected' : ''}>${v}</option>`).join('');
const datalist = (id, values) => `<datalist id="${id}">${values.map(v => `<option value="${escapeHtml(v)}"></option>`).join('')}</datalist>`;
const machineOptions = (machines, selected) =>
  machines.map(m => `<option value="${m.id}" ${selected === m.id ? 'selected' : ''}>${escapeHtml(m.nom)}</option>`).join('');

// Valeurs du formulaire : la copie d'un travail (« Refaire ») repart à zéro pour les mesures, l'historique et l'échéance.
function workItem(source, {duplicate, chosenParcel, data, recentWorks, today}) {
  const reset = duplicate
    ? {actualMetrics: undefined, plannedMetrics: undefined, statusHistory: [], prescriptionId: undefined, resourceEffects: undefined} : {};
  return {...source, ...reset, id: duplicate ? undefined : source.id, parcelId: chosenParcel.id,
    date: duplicate ? today : (source.date || today), plannedDate: duplicate ? '' : (source.plannedDate || ''),
    startTime: source.startTime || '', endTime: source.endTime || '', type: source.type || '', status: duplicate ? 'À faire' : (source.status || 'Terminé'),
    product: source.product || '', culture: source.culture || chosenParcel.culture || '', dose: source.dose ?? '', doseUnit: source.doseUnit || '',
    productUnitPrice: source.productUnitPrice ?? '', surfaceWorked: source.surfaceWorked ?? (source.id ? null : chosenParcel.surfaceHa),
    duration: source.duration ?? '', fuel: source.fuel ?? '',
    operator: source.operator || data.preferences.defaultOperator || recentWorks.find(w => w.operator)?.operator || '',
    equipmentId: source.equipmentId || '', cost: source.cost ?? '', machineCost: source.machineCost ?? '', fuelCost: source.fuelCost ?? '',
    inputCost: source.inputCost ?? '', operatorCost: source.operatorCost ?? '', otherCost: source.otherCost ?? '', note: source.note || '',
    weatherSnapshot: source.weatherSnapshot || null};
}

function essentialFields(item, {parcels, templates, data}) {
  return ['<div class="form-grid">',
    '<label>Parcelle *<select name="parcelId" required>',
    parcels.map(p => `<option value="${p.id}" ${item.parcelId === p.id ? 'selected' : ''}>${escapeHtml(p.nom)}</option>`).join(''),
    '</select></label>',
    '<label>Modèle<select id="work-template"><option value="">Aucun modèle</option>',
    recentWorkSuggestions(data, 3).map((w, i) =>
      `<option value="history:${i}">Habitude · ${escapeHtml(w.type)}${w.product ? ` · ${escapeHtml(w.product)}` : ''}</option>`).join(''),
    `${templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}</select></label>`,
    `<label>Type *<input name="type" list="recent-work-types" required value="${escapeHtml(item.type)}" placeholder="Fauche, semis…"></label>`,
    `<label>Date<input name="date" type="date" required value="${isoDate(item.date)}"></label>`,
    `<label>Statut<select name="status">${options(STATUSES, item.status)}</select></label>`,
    '<label>Surface travaillée (ha)',
    `<input name="surfaceWorked" inputmode="decimal" type="number" min="0" step="any" value="${item.surfaceWorked ?? ''}"></label>`,
    '</div>'].join('');
}

function detailFields(item, machines) {
  const money = (label, name, placeholder = '') =>
    `<label>${label}<input name="${name}" inputmode="decimal" value="${item[name] ?? ''}"${placeholder ? ` placeholder="${placeholder}"` : ''}></label>`;
  return ['<details class="form-section"><summary>Plus de détails</summary><div class="form-grid">',
    `<label>Heure début<input name="startTime" type="time" value="${escapeHtml(item.startTime)}"></label>`,
    `<label>Heure fin<input name="endTime" type="time" value="${escapeHtml(item.endTime)}"></label>`,
    `<label>Culture<input name="culture" value="${escapeHtml(item.culture)}"></label>`,
    `<label>Produit<input name="product" list="recent-products" value="${escapeHtml(item.product)}"></label>`,
    `<label>Dose<input name="dose" inputmode="decimal" value="${escapeHtml(item.dose)}"></label>`,
    `<label>Unité dose<select name="doseUnit"><option value="">—</option>${options(DOSE_UNITS, item.doseUnit)}</select></label>`,
    `<label>AMM (si phytosanitaire)<input name="amm" value="${escapeHtml(item.amm || '')}"></label>`,
    `<label><input type="checkbox" name="isPhytosanitary" ${item.isPhytosanitary ? 'checked' : ''}> Intervention phytosanitaire</label>`,
    money('Prix produit / unité (€)', 'productUnitPrice'),
    `<label>Durée (h)<input name="duration" type="number" min="0" step="any" value="${item.duration ?? ''}"></label>`,
    `<label>Carburant (L)<input name="fuel" type="number" min="0" step="0.1" value="${item.fuel ?? ''}"></label>`,
    `<label>Opérateur<input name="operator" list="recent-operators" value="${escapeHtml(item.operator)}"></label>`,
    `<label>Matériel<select name="equipmentId"><option value="">Non renseigné</option>${machineOptions(machines, item.equipmentId)}</select></label>`,
    money('Coût machine (€)', 'machineCost', 'auto si vide'), money('Coût carburant (€)', 'fuelCost', 'auto si vide'),
    money('Coût intrants (€)', 'inputCost'), money('Coût opérateur (€)', 'operatorCost'), money('Autres coûts (€)', 'otherCost'),
    money('Coût total (€)', 'cost', 'somme automatique si vide'),
    `<label class="span-2">Note<textarea name="note">${escapeHtml(item.note)}</textarea></label>`,
    '<label><input type="checkbox" name="saveTemplate"> Enregistrer comme modèle</label>',
    `<label><input type="checkbox" name="weatherSnapshot" ${item.weatherSnapshot ? 'checked' : ''}> Conserver la météo actuelle</label>`,
    '<label><input type="checkbox" name="addPhotoAfter"> Ajouter une photo après</label>',
    '</div></details>'].join('');
}

// Durée déduite des heures de début et de fin (passage de minuit compris) quand elle n'est pas saisie.
function recalcDuration(form) {
  const a = form.elements.startTime.value, b = form.elements.endTime.value;
  if (!a || !b || String(form.elements.duration.value).trim()) return;
  const [ah, am] = a.split(':').map(Number), [bh, bm] = b.split(':').map(Number);
  let minutes = (bh * 60 + bm) - (ah * 60 + am);
  if (minutes < 0) minutes += 1440;
  if (minutes >= 0) form.elements.duration.value = (minutes / 60).toFixed(2);
}

const filled = value => String(value).trim();
// Coûts : chaque poste saisi l'emporte, sinon il est calculé (machine x heures, carburant x prix, dose x prix x surface).
function workCosts(v, {machines, data}) {
  const machine = machines.find(m => m.id === v.equipmentId), duration = toNullableNumber(v.duration), fuel = toNullableNumber(v.fuel);
  const machineCost = filled(v.machineCost) ? toNumber(v.machineCost) : (machine && duration !== null ? duration * toNumber(machine.hourlyCost) : 0);
  const fuelCost = filled(v.fuelCost) ? toNumber(v.fuelCost) : (fuel !== null ? fuel * toNumber(data.preferences.fuelPrice) : 0);
  const priced = toNullableNumber(v.dose) !== null && toNullableNumber(v.productUnitPrice) !== null && toNullableNumber(v.surfaceWorked) !== null;
  const inputCost = filled(v.inputCost) ? toNumber(v.inputCost) : (priced ? toNumber(v.dose) * toNumber(v.productUnitPrice) * toNumber(v.surfaceWorked) : 0);
  const operatorCost = toNumber(v.operatorCost), otherCost = toNumber(v.otherCost);
  const components = machineCost + fuelCost + inputCost + operatorCost + otherCost, total = filled(v.cost) ? toNumber(v.cost) : components;
  return {duration, fuel, machineCost, fuelCost, inputCost, operatorCost, otherCost, total};
}

function weatherSnapshotOf(weather) {
  const c = weather.current;
  return {capturedAt: Date.now(), place: weather.place, temperature: c?.temperature_2m, precipitation: c?.precipitation, wind: c?.wind_speed_10m,
    gust: c?.wind_gusts_10m, humidity: c?.relative_humidity_2m, windDirection: c?.wind_direction_10m, forecastAt: weather.loadedAt};
}

export function createWorkFormUI(ctx) {
  const {$, $$} = ctx;

  function open(work = null, parcelId = null, {duplicate = false} = {}) {
    const data = ctx.state(), parcels = ctx.active('parcelles', data);
    if (!parcels.length) { ctx.toast('Créez ou importez d’abord une parcelle.', 'error'); return; }
    const templates = ctx.active('templates', data), machines = ctx.active('materiels', data);
    const recentWorks = [...ctx.active('interventions', data)].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const source = work || {};
    const chosenParcel = ctx.parcelById(parcelId || source.parcelId || ctx.selectedParcelId, data) || parcels[0];
    const distinct = key => [...new Set(recentWorks.map(w => w[key]).filter(Boolean))].slice(0, 12);
    const item = workItem(source, {duplicate, chosenParcel, data, recentWorks, today: ctx.todayIso()});
    const datalists = datalist('recent-work-types', distinct('type')) + datalist('recent-products', distinct('product'))
      + datalist('recent-operators', distinct('operator'));
    const editing = work?.id && !duplicate;
    const review = '<p class="notice warning">Les mesures réelles ont changé. Vérifiez les coûts, stocks et heures matériel associés avant validation.</p>';
    const body = [item.costReviewRequired ? review : '',
      datalists, '<form id="work-form">', essentialFields(item, {parcels, templates, data}), '\n  ', detailFields(item, machines), '</form>'].join('');
    const footer = ['<button class="button secondary" data-action="close-modal">Annuler</button>',
      editing && work.status === 'Terminé'
        ? `<button class="button secondary" data-farm="effects" data-id="${escapeHtml(work.id)}">Stocks / heures / coûts</button>` : '',
      editing ? '<button class="button secondary" id="attach-work">Pièce jointe</button>' : '',
      editing ? '<button class="button secondary" id="delete-work">Supprimer</button>' : '',
      '<button class="button primary" id="save-work">Enregistrer</button>'].join('');
    const title = editing ? 'Modifier le travail' : duplicate ? 'Refaire ce travail' : 'Nouveau travail';
    ctx.modal(title, 'Un cas simple peut être enregistré avec les champs essentiels uniquement.', body, footer, 'large');
    const form = $('#work-form');
    enhanceWorkForm(form, {data, today: ctx.todayIso(), recentIds: ctx.recentParcelIds});
    ctx.phytoUI?.enhanceWorkForm(form, item); ctx.hedgesUI?.enhanceWorkForm(form, item); ctx.stockLotsUI?.enhanceWorkForm(form, item);
    // n° 144 : le formulaire s’ouvre sans attendre, habitudes et semences s’y ajoutent à l’arrivée.
    const late = ctx.lazy.need(['habits', 'seeds'], {silent: true});
    const lateFields = () => { ctx.habitsUI.enhanceWorkForm(form, item); ctx.seedsUI.enhanceWorkForm(form, item); };
    if (ctx.lazy.ready(['habits', 'seeds'])) lateFields(); else late.then(ok => ok && form.isConnected && lateFields());
    ctx.neighbors().enhanceWorkForm(form);
    if (item.id && !duplicate) ctx.historyUI?.attach(form, 'interventions', item.id);
    const draft = persistFormDraft(form, draftKey('interventions', duplicate ? null : item.id));
    $('#work-template').onchange = () => {
      const value = $('#work-template').value;
      const t = value.startsWith('history:') ? recentWorkSuggestions(data, 3)[Number(value.split(':')[1])] : templates.find(x => x.id === value);
      if (!t) return;
      for (const key of TEMPLATE_KEYS) if (t[key] !== undefined && form.elements[key]) form.elements[key].value = t[key];
    };
    let autoSurface = form.elements.surfaceWorked.value;
    form.elements.parcelId.onchange = () => {
      const p = ctx.parcelById(form.elements.parcelId.value);
      if (p && (!String(form.elements.surfaceWorked.value).trim() || form.elements.surfaceWorked.value === autoSurface)) {
        form.elements.surfaceWorked.value = p.surfaceHa ?? ''; autoSurface = form.elements.surfaceWorked.value;
      }
    };
    form.elements.endTime.onchange = () => recalcDuration(form); form.elements.startTime.onchange = () => recalcDuration(form);
    $('#save-work').onclick = () => save({form, item, source, duplicate, machines, data, draft});
    $('#attach-work')?.addEventListener('click', () => { ctx.closeModal(); ctx.openAttachmentForm(item.parcelId, {interventionId: item.id}); });
    $('#delete-work')?.addEventListener('click', () => ctx.confirmDelete('interventions', item.id, 'ce travail'));
  }

  async function save({form, item, source, duplicate, machines, data, draft}) {
    if (!validateForm(form)) return;
    recalcDuration(form);
    const v = Object.fromEntries(new FormData(form));
    const {duration, fuel, machineCost, fuelCost, inputCost, operatorCost, otherCost, total} = workCosts(v, {machines, data});
    const weather = ctx.weatherCache, weatherSnapshot = form.elements.weatherSnapshot.checked && weather ? weatherSnapshotOf(weather) : item.weatherSnapshot;
    const entity = {...item, ...v, isPhytosanitary: form.elements.isPhytosanitary.checked, costReviewRequired: false, id: item.id, cost: total,
      surfaceWorked: toNullableNumber(v.surfaceWorked), dose: toNullableNumber(v.dose) ?? v.dose, productUnitPrice: toNullableNumber(v.productUnitPrice),
      duration, fuel, machineCost, fuelCost, inputCost, operatorCost, otherCost, weatherSnapshot, campaignId: campaignFor(v.date),
      source: item.id ? 'local' : (source.source || 'local')};
    if (v.status !== 'Terminé' && item.plannedDate && v.date !== item.date) entity.plannedDate = v.date;
    if (!entity.productLot && !item.productLot) delete entity.productLot; // n° 73 : lot du produit, seulement s'il est choisi
    if (ctx.phytoUI && !(await ctx.phytoUI.guardWork(form, entity))) return;
    if (!ctx.lazy.ready('seeds')) await ctx.lazy.need('seeds', {silent: true});
    const seedError = ctx.seedsUI?.applyToWork(entity) || ctx.hedgesUI?.guardWork(entity, form);
    if (seedError) { ctx.toast(seedError, 'error'); return; }
    const metrics = () => ({areaHa: entity.surfaceWorked, dose: toNullableNumber(entity.dose), duration: entity.duration});
    if (v.status !== 'Terminé' && !entity.plannedMetrics) entity.plannedMetrics = metrics();
    if (v.status === 'Terminé') entity.actualMetrics = metrics();
    const saved = await ctx.store.upsert('interventions', entity, {label: `Travail ${item.id ? 'modifié' : 'enregistré'} : ${v.type}`});
    draft.clear();
    if (v.status === 'Terminé' && (!source.id || duplicate || source.status !== 'Terminé')) ctx.habitsUI?.afterFinish(saved);
    if (form.elements.saveTemplate.checked) {
      const template = {name: `${v.type}${v.product ? ` · ${v.product}` : ''}`, type: v.type, culture: v.culture, product: v.product, dose: v.dose,
        doseUnit: v.doseUnit, operator: v.operator, equipmentId: v.equipmentId};
      await ctx.store.upsert('templates', template, {label: `Modèle créé : ${v.type}`, queue: false});
    }
    const addPhoto = form.elements.addPhotoAfter.checked;
    ctx.closeModal();
    if (addPhoto) { ctx.openAttachmentForm(saved.parcelId, {photoOnly: true, interventionId: saved.id}); return; }
    ctx.savedToast('Travail enregistré.', {label: 'Ouvrir', run: () => ctx.openWorkForm(saved)});
  }

  // Travail groupé : une saisie, un travail relié (batchId) par parcelle ; selected précoche des parcelles (sélection de la carte).
  function openBatch(selected = []) {
    const data = ctx.state(), parcels = ctx.active('parcelles', data), machines = ctx.active('materiels', data);
    if (!parcels.length) return ctx.toast('Aucune parcelle disponible.', 'error');
    const rows = parcels.map(p => [
      `<label class="check-row"><input type="checkbox" name="parcelIds" value="${p.id}"${selected.includes(p.id) ? ' checked' : ''}>`,
      `<span><strong>${escapeHtml(p.nom)}</strong><small>${escapeHtml(p.culture || '')} · ${formatNumber(p.surfaceHa)} ha</small></span></label>`
    ].join('')).join('');
    const body = ['<form id="batch-work-form"><div class="form-grid"><label class="span-2">Parcelles *</label>',
      `<div class="span-2 batch-parcel-list">${rows}</div>`,
      '<div class="span-2"><button type="button" class="text-button" id="batch-select-all">Tout sélectionner</button> ',
      '<button type="button" class="text-button" id="batch-clear">Effacer</button></div>',
      '<label>Type *<input name="type" required placeholder="Fauche, semis…"></label>',
      `<label>Date<input name="date" type="date" value="${ctx.todayIso()}" required></label>`,
      `<label>Statut<select name="status">${['À faire', 'En cours', 'Terminé'].map(v => `<option>${v}</option>`).join('')}</select></label>`,
      '<label>Produit<input name="product"></label><label>Dose<input name="dose" inputmode="decimal"></label>',
      `<label>Unité<select name="doseUnit"><option value="">—</option>${BATCH_UNITS.map(v => `<option>${v}</option>`).join('')}</select></label>`,
      '<label>Matériel<select name="equipmentId"><option value="">Non renseigné</option>',
      `${machines.map(m => `<option value="${m.id}">${escapeHtml(m.nom)}</option>`).join('')}</select></label>`,
      '<label>Coût total du lot (€)<input name="batchCost" inputmode="decimal" type="number" min="0" step=".01"></label>',
      '<label class="span-2">Note<textarea name="note"></textarea></label></div></form>'].join('');
    ctx.modal('Travail groupé', 'Une seule saisie crée un travail relié pour chaque parcelle sélectionnée.', body,
      '<button class="button secondary" data-action="close-modal">Annuler</button>'
      + '<button class="button primary" id="save-batch-work">Enregistrer le lot</button>', 'large');
    const boxes = () => $$('#batch-work-form input[name="parcelIds"]');
    $('#batch-select-all').onclick = () => boxes().forEach(x => x.checked = true);
    $('#batch-clear').onclick = () => boxes().forEach(x => x.checked = false);
    $('#save-batch-work').onclick = async () => {
      const form = $('#batch-work-form');
      if (!validateForm(form)) return;
      const ids = $$('#batch-work-form input[name="parcelIds"]:checked').map(x => x.value);
      if (!ids.length) return ctx.toast('Sélectionnez au moins une parcelle.', 'error');
      const v = Object.fromEntries(new FormData(form)), batchId = uid('batch'), chosen = ids.map(id => ctx.parcelById(id)).filter(Boolean);
      const totalSurface = chosen.reduce((sum, p) => sum + toNumber(p.surfaceHa), 0), batchCost = toNumber(v.batchCost);
      const entities = chosen.map(p => ({batchId, parcelId: p.id, type: v.type, date: v.date, status: v.status, product: v.product,
        dose: toNullableNumber(v.dose) ?? v.dose, doseUnit: v.doseUnit, equipmentId: v.equipmentId, note: v.note, surfaceWorked: toNumber(p.surfaceHa),
        cost: batchCost && totalSurface ? batchCost * (toNumber(p.surfaceHa) / totalSurface) : 0, campaignId: campaignFor(v.date), source: 'local'}));
      await ctx.store.upsertMany('interventions', entities, {label: `Travail groupé : ${v.type} · ${chosen.length} parcelles`});
      ctx.closeModal();
      ctx.savedToast(`${chosen.length} travaux créés dans le même lot.`);
    };
  }

  return {open, openBatch};
}
