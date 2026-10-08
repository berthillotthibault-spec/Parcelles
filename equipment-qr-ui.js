// n° 11 « QR codes sur les engins, portails et abreuvoirs » : feuille ouverte par le lien du QR
// (4 gros boutons), aperçu d’étiquette, planche A4 en PDF et écriture NFC (Android, si disponible).
import {qrSvg} from './qr.js';
import {appBaseUrl, labelSheetPdf, qrLink} from './qr-labels.js';
import {pdfFile, sharePdf} from './pdf-lite.js';
import {routeUrl} from './utils.js';
import {icon} from './ui.js';

const LABEL_POINT_TYPES = /entree|eau|abreuv|portail|regard|equipement|autre/;
const fold = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const num = v => v === null || v === undefined || String(v).trim() === '' ? null : Number.isFinite(Number(String(v).replace(',', '.'))) ? Number(String(v).replace(',', '.')) : NaN;

export function createEquipmentQrUI(deps) {
  const {store, state, active, modal, closeModal, toast, escapeHtml: e, todayIso, formatNumber, openMaintenanceForm, openEquipmentDetail, openAttachmentForm, openObservationForm, openMapPointEditor, showPoint} = deps;
  const base = () => appBaseUrl(location.href);
  const $ = id => document.getElementById(id);
  const fail = (id, message) => { const el = $(id); if (el) { el.textContent = message; el.classList.remove('hidden'); } };
  const guard = fn => async (...args) => { try { await fn(...args); } catch (error) { toast(error?.message || 'Enregistrement impossible.', 'error'); } };

  function openRoute(route) {
    if (route.kind === 'point') return openPointSheet(route.id);
    const m = store.get('materiels', route.id);
    if (!m || m.deletedAt) return toast('Ce QR code ne correspond à aucun matériel de cette exploitation.', 'error');
    return route.log ? openSheet(m.id) : openEquipmentDetail(m.id);
  }

  // Feuille « Tracteur 6155M » : Heures compteur, Plein, Entretien, Panne + photo.
  function openSheet(id) {
    const m = store.get('materiels', id);
    if (!m) return;
    const meter = num(m.currentMeter);
    modal(m.nom || 'Matériel', `${meter !== null && !Number.isNaN(meter) ? `Compteur : ${formatNumber(meter)} h` : 'Compteur non renseigné'}${m.status ? ` · ${m.status}` : ''}`,
      `<div class="qr-sheet-grid">
        <button class="qr-sheet-button" id="qr-meter">${icon('calendar',{size:28})}<strong>Heures compteur</strong><small>Relever le compteur</small></button>
        <button class="qr-sheet-button" id="qr-fuel">${icon('package',{size:28})}<strong>Plein</strong><small>Litres et compteur</small></button>
        <button class="qr-sheet-button" id="qr-maintenance">${icon('tools',{size:28})}<strong>Entretien</strong><small>Vidange, graissage…</small></button>
        <button class="qr-sheet-button is-alert" id="qr-breakdown">${icon('camera',{size:28})}<strong>Panne + photo</strong><small>Signaler un problème</small></button>
      </div>`,
      `<button class="button secondary" data-action="close-modal">Fermer</button><button class="button secondary" id="qr-detail">Fiche matériel</button>`, 'small');
    $('qr-meter').onclick = () => openMeter(id);
    $('qr-fuel').onclick = () => openFuel(id);
    $('qr-maintenance').onclick = () => openMaintenanceForm(id, null, {returnTo: 'detail'});
    $('qr-breakdown').onclick = () => openBreakdown(id);
    $('qr-detail').onclick = () => openEquipmentDetail(id);
  }
  const back = (id, message) => { closeModal(); toast(message, 'success'); openSheet(id); };
  async function raiseMeter(m, value) {
    if (value === null) return;
    const current = num(m.currentMeter);
    if (current === null || Number.isNaN(current) || value > current) await store.upsert('materiels', {...m, currentMeter: value}, {label: `Compteur mis à jour : ${m.nom}`});
  }

  function openMeter(id) {
    const m = store.get('materiels', id);
    modal('Heures compteur', m.nom, `<form id="qr-meter-form" class="form-grid"><label class="span-2">Compteur (h)<input name="meter" inputmode="decimal" autocomplete="off" value="${e(m.currentMeter ?? '')}" required></label><p class="form-error span-2 hidden" id="qr-meter-error" role="alert"></p></form>`,
      `<button class="button secondary" id="qr-cancel">Annuler</button><button class="button primary" id="qr-save">Enregistrer</button>`, 'small');
    $('qr-cancel').onclick = () => openSheet(id);
    $('qr-save').onclick = guard(async () => {
      const value = num(new FormData($('qr-meter-form')).get('meter')), current = num(m.currentMeter);
      if (value === null) return fail('qr-meter-error', 'Champ obligatoire : Compteur');
      if (Number.isNaN(value) || value < 0) return fail('qr-meter-error', 'Compteur invalide : saisissez un nombre d’heures.');
      if (current !== null && !Number.isNaN(current) && value < current) return fail('qr-meter-error', `Inférieur au compteur actuel (${formatNumber(current)} h) : corrigez-le depuis la fiche matériel.`);
      await store.upsert('materiels', {...m, currentMeter: value}, {label: `Compteur relevé : ${m.nom}`});
      back(id, `Compteur enregistré : ${formatNumber(value)} h.`);
    });
  }

  function openFuel(id) {
    const m = store.get('materiels', id);
    modal('Plein', m.nom, `<form id="qr-fuel-form" class="form-grid"><label>Litres *<input name="liters" inputmode="decimal" autocomplete="off" required></label><label>Compteur (h)<input name="meter" inputmode="decimal" autocomplete="off" value="${e(m.currentMeter ?? '')}"></label><label class="span-2">Coût (€)<input name="cost" inputmode="decimal" autocomplete="off"></label><p class="form-error span-2 hidden" id="qr-fuel-error" role="alert"></p></form>`,
      `<button class="button secondary" id="qr-cancel">Annuler</button><button class="button primary" id="qr-save">Enregistrer</button>`, 'small');
    $('qr-cancel').onclick = () => openSheet(id);
    $('qr-save').onclick = guard(async () => {
      const v = Object.fromEntries(new FormData($('qr-fuel-form'))), liters = num(v.liters), meter = num(v.meter), cost = num(v.cost);
      if (liters === null) return fail('qr-fuel-error', 'Champ obligatoire : Litres');
      if (Number.isNaN(liters) || liters <= 0 || Number.isNaN(meter) || Number.isNaN(cost)) return fail('qr-fuel-error', 'Valeur invalide : saisissez des nombres positifs.');
      await store.upsert('maintenanceRecords', {equipmentId: id, date: todayIso(), type: 'Plein', liters, meter, cost: cost ?? 0, note: `${formatNumber(liters)} L`, nextDue: null}, {label: `Plein enregistré : ${m.nom}`});
      await raiseMeter(store.get('materiels', id), meter);
      back(id, `Plein enregistré : ${formatNumber(liters)} L.`);
    });
  }

  function openBreakdown(id) {
    const m = store.get('materiels', id);
    modal('Signaler une panne', m.nom, `<form id="qr-breakdown-form" class="form-grid"><label class="span-2">Description *<textarea name="note" maxlength="500" required placeholder="Fuite hydraulique, voyant moteur…"></textarea></label><label class="span-2">Compteur (h)<input name="meter" inputmode="decimal" autocomplete="off" value="${e(m.currentMeter ?? '')}"></label><p class="form-error span-2 hidden" id="qr-breakdown-error" role="alert"></p></form>`,
      `<button class="button secondary" id="qr-cancel">Annuler</button><button class="button secondary" id="qr-save">Enregistrer</button><button class="button primary" id="qr-save-photo">Enregistrer et photographier</button>`, 'small');
    $('qr-cancel').onclick = () => openSheet(id);
    const save = photo => guard(async () => {
      const v = Object.fromEntries(new FormData($('qr-breakdown-form'))), note = String(v.note || '').trim(), meter = num(v.meter);
      if (!note) return fail('qr-breakdown-error', 'Champ obligatoire : Description');
      if (Number.isNaN(meter)) return fail('qr-breakdown-error', 'Compteur invalide : saisissez un nombre d’heures.');
      await store.upsert('maintenanceRecords', {equipmentId: id, date: todayIso(), type: 'Panne', meter, cost: 0, note, nextDue: null}, {label: `Panne signalée : ${m.nom}`});
      const fresh = store.get('materiels', id);
      await store.upsert('materiels', {...fresh, status: 'En panne', ...(meter !== null && (num(fresh.currentMeter) === null || meter > num(fresh.currentMeter)) ? {currentMeter: meter} : {})}, {label: `Matériel en panne : ${m.nom}`});
      closeModal(); toast('Panne signalée.', 'success');
      if (photo) openAttachmentForm(null, {photoOnly: true, equipmentId: id});
      else openSheet(id);
    });
    $('qr-save').onclick = save(false);
    $('qr-save-photo').onclick = save(true);
  }

  // Point (portail, entrée de champ, abreuvoir) : carte, itinéraire, observation, photo.
  function openPointSheet(id) {
    const p = store.get('points', id);
    if (!p || p.deletedAt) return toast('Ce QR code ne correspond à aucun point de cette exploitation.', 'error');
    const parcel = p.parcelId ? store.get('parcelles', p.parcelId) : null, located = Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude));
    modal(p.nom || p.name || p.type || 'Point', [p.type, parcel?.nom].filter(Boolean).join(' · ') || 'Point de l’exploitation',
      `<div class="qr-sheet-grid">
        <button class="qr-sheet-button" id="qr-point-map" ${located ? '' : 'disabled'}>${icon('map',{size:28})}<strong>Voir sur la carte</strong><small>Centrer la carte</small></button>
        <button class="qr-sheet-button" id="qr-point-route" ${located ? '' : 'disabled'}>${icon('route',{size:28})}<strong>Y aller</strong><small>Itinéraire</small></button>
        <button class="qr-sheet-button" id="qr-point-observation">${icon('alert',{size:28})}<strong>Observation</strong><small>Constat, réparation</small></button>
        <button class="qr-sheet-button" id="qr-point-photo" ${p.parcelId ? '' : 'disabled'}>${icon('camera',{size:28})}<strong>Photo</strong><small>${p.parcelId ? 'Rattachée à la parcelle' : 'Point sans parcelle'}</small></button>
      </div>${p.note || p.notes ? `<p class="form-note">${e(p.note || p.notes)}</p>` : ''}`,
      `<button class="button secondary" data-action="close-modal">Fermer</button><button class="button secondary" id="qr-point-edit">Modifier</button>`, 'small');
    $('qr-point-map').onclick = () => { closeModal(); showPoint(id); };
    $('qr-point-route').onclick = () => window.open(routeUrl(state().preferences?.routeProvider || 'apple', p.latitude, p.longitude), '_blank', 'noopener');
    $('qr-point-observation').onclick = () => { closeModal(); openObservationForm(null, {parcelId: p.parcelId || null}); };
    $('qr-point-photo').onclick = () => { closeModal(); openAttachmentForm(p.parcelId, {photoOnly: true}); };
    $('qr-point-edit').onclick = () => openMapPointEditor(id);
  }

  const itemFor = (kind, id) => {
    const x = store.get(kind === 'point' ? 'points' : 'materiels', id);
    return x ? {kind, id, name: kind === 'point' ? x.nom || x.name || x.type || 'Point' : x.nom || 'Matériel', subtitle: kind === 'point' ? `${x.type || 'Point'} · scanner pour ouvrir` : undefined} : null;
  };
  function printItems(items) {
    const farm = state().exploitation?.nom || state().exploitation?.name || '';
    const file = pdfFile(labelSheetPdf(items, {base: base(), farm}), `Etiquettes QR ${todayIso()}`);
    return sharePdf(file, {title: 'Étiquettes QR'});
  }

  // Aperçu d’une étiquette : QR, lien, impression, NFC.
  function openLabel(kind, id) {
    const item = itemFor(kind, id);
    if (!item) return;
    const url = qrLink(base(), kind, id), nfc = typeof window !== 'undefined' && 'NDEFReader' in window;
    modal('Étiquette QR', item.name, `<div class="qr-preview">${qrSvg(url, {label: `QR code : ${item.name}`})}</div><p class="form-note qr-url">${e(url)}</p><p class="form-note">Le lien ne contient que l’identifiant interne : sans l’application et le compte de l’exploitation, rien n’est visible.</p>${nfc ? '<p class="form-note">Sur Android, vous pouvez aussi écrire ce lien sur un tag NFC.</p>' : ''}`,
      `<button class="button secondary" data-action="close-modal">Fermer</button>${nfc ? '<button class="button secondary" id="qr-nfc">Écrire sur un tag NFC</button>' : ''}<button class="button secondary" id="qr-all">Toutes les étiquettes</button><button class="button primary" id="qr-print-one">Imprimer</button>`, 'small');
    $('qr-print-one').onclick = guard(() => printItems([item]));
    $('qr-all').onclick = () => openPicker();
    if (nfc) $('qr-nfc').onclick = guard(async () => {
      toast('Approchez le tag NFC du téléphone…');
      await new window.NDEFReader().write({records: [{recordType: 'url', data: url}]});
      toast('Tag NFC écrit.', 'success');
    });
  }

  // Choix des étiquettes à imprimer : matériels et points utiles (portails, entrées de champ, abreuvoirs).
  function openPicker() {
    const data = state(), machines = active('materiels', data), points = active('points', data).filter(p => LABEL_POINT_TYPES.test(fold(p.type)));
    const row = (kind, x, checked) => `<label class="qr-pick"><input type="checkbox" name="pick" value="${kind}:${e(x.id)}" ${checked ? 'checked' : ''}><span><strong>${e(kind === 'point' ? x.nom || x.name || x.type || 'Point' : x.nom || 'Matériel')}</strong><small>${e(kind === 'point' ? x.type || 'Point' : x.location || x.emplacement || 'Matériel')}</small></span></label>`;
    const body = machines.length || points.length
      ? `<form id="qr-pick-form">${machines.length ? `<h3>Matériel</h3><div class="qr-pick-list">${machines.map(m => row('equipment', m, true)).join('')}</div>` : ''}${points.length ? `<h3>Points</h3><div class="qr-pick-list">${points.map(p => row('point', p, /entree|eau|abreuv|portail/.test(fold(p.type)))).join('')}</div>` : ''}<p class="form-error hidden" id="qr-pick-error" role="alert"></p></form><p class="form-note">Planche A4 de 12 étiquettes à découper. Plastifiez-les pour l’extérieur.</p>`
      : '<div class="empty-state">Ajoutez d’abord un matériel ou un point (entrée de champ, point d’eau) sur la carte.</div>';
    modal('Imprimer les étiquettes QR', 'Un QR par engin, portail ou abreuvoir : le scanner ouvre directement la bonne fiche.', body,
      `<button class="button secondary" data-action="close-modal">Fermer</button>${machines.length || points.length ? '<button class="button primary" id="qr-print">Créer le PDF</button>' : ''}`, 'small');
    $('qr-print')?.addEventListener('click', guard(async () => {
      const picks = new FormData($('qr-pick-form')).getAll('pick').map(v => { const i = String(v).indexOf(':'); return itemFor(String(v).slice(0, i), String(v).slice(i + 1)); }).filter(Boolean);
      if (!picks.length) return fail('qr-pick-error', 'Champ obligatoire : choisissez au moins une étiquette.');
      const result = await printItems(picks);
      toast(result === 'shared' ? 'Planche partagée.' : result === 'cancelled' ? 'Partage annulé.' : `Planche de ${picks.length} ${picks.length > 1 ? 'étiquettes téléchargée' : 'étiquette téléchargée'}.`, result === 'cancelled' ? 'info' : 'success');
    }));
  }

  return {openRoute, openSheet, openPointSheet, openLabel, openPicker};
}
