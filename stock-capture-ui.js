// n° 106 — Photo d'étiquette ou de facture vers le stock : lecture EAN hors ligne, extraction en ligne
// optionnelle (consentement explicite), tableau de correspondance et validation ligne par ligne.
import {eanValid, cleanEan, itemByEan, matchLines, entryMovement} from './stock-capture.js';
import {extractDocument} from './remote-ai.js';
import {escapeHtml as e, uid} from './utils.js';

const pad = n => String(n).padStart(2, '0');
const isoToday = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt = v => (v === null || v === undefined ? '' : String(v));

export function createStockCaptureUI({store, state, modal, closeModal, toast, withProgress = (_, run) => run(), doc = globalThis.document, win = globalThis.window, fetchImpl} = {}) {
  const items = () => (state().stockItems || []).filter(i => !i.deletedAt);
  const endpoint = () => {const p = state().preferences || {}; return p.remoteAiEnabled && p.remoteAiEndpoint ? p.remoteAiEndpoint : '';};
  const hasDetector = () => typeof win?.BarcodeDetector === 'function';
  let file = null, lines = [];

  // file : photo déjà reçue (partage depuis une autre application, n° 121).
  function open({file: received = null} = {}) {
    file = received; lines = [];
    const ep = endpoint();
    let host = '';
    try {host = ep ? new URL(ep).host : '';} catch {host = ep;}
    modal('Photo d’étiquette ou de facture', 'Rien n’est ajouté au stock avant votre validation, ligne par ligne.',
      `<form id="stock-capture-form" class="form-grid" novalidate>
        ${received ? `<p class="sc-hint span-2">Photo reçue : <strong>${e(received.name)}</strong></p>` : ''}<label class="span-2">${received ? 'Autre photo (facultatif)' : 'Photo (étiquette ou facture)'}<input type="file" name="photo" accept="image/*,application/pdf" capture="environment"></label>
        <fieldset class="span-2 stock-capture-box"><legend>Hors ligne : code-barres</legend>
          ${hasDetector() ? '<button type="button" class="button secondary" id="sc-barcode">Lire le code-barres de la photo</button>' : '<p class="sc-hint">La lecture automatique du code-barres n’est pas disponible sur cet appareil (iPhone, iPad) : saisissez les chiffres sous le code-barres.</p>'}
          <label>Code EAN<input name="ean" inputmode="numeric" autocomplete="off" placeholder="13 chiffres"></label>
          <button type="button" class="button secondary" id="sc-ean-search">Chercher l’article</button></fieldset>
        <fieldset class="span-2 stock-capture-box"><legend>En ligne, en option : lecture de la facture</legend>
          ${ep ? `<label class="check-row sc-consent"><input type="checkbox" name="consent"><span>J’accepte d’envoyer cette image à <strong>${e(host)}</strong> (assistant distant configuré) pour en extraire les lignes. Aucune clé n’est enregistrée dans l’application.</span></label>
          <button type="button" class="button secondary" id="sc-extract">Extraire les lignes</button>` : '<p class="sc-hint">Pour lire une facture, configurez l’assistant distant dans Réglages. Sinon, utilisez le code-barres ou « Mouvement de stock ».</p>'}</fieldset>
        <p class="form-error span-2" hidden></p>
        <div id="sc-result" class="span-2"></div></form>`,
      '<button class="button secondary" data-action="close-modal">Fermer</button>', 'large');
    const form = doc.getElementById('stock-capture-form');
    const error = msg => {const el = form.querySelector('.form-error'); el.textContent = msg || ''; el.hidden = !msg;};
    form.elements.photo.addEventListener('change', () => {file = form.elements.photo.files?.[0] || received; error('');});
    doc.getElementById('sc-barcode')?.addEventListener('click', async () => {
      if (!file || !file.type.startsWith('image/')) return error('Prenez d’abord une photo du code-barres.');
      try {
        const detector = new win.BarcodeDetector({formats: ['ean_13', 'ean_8', 'upc_a']});
        const codes = await detector.detect(await win.createImageBitmap(file));
        const code = codes.map(c => cleanEan(c.rawValue)).find(eanValid);
        if (!code) return error('Aucun code EAN lisible : saisissez les chiffres à la main.');
        form.elements.ean.value = code; error(''); showEan(code);
      } catch (err) {error(`Lecture impossible (${err?.message || 'erreur'}) : saisissez les chiffres à la main.`);}
    });
    doc.getElementById('sc-ean-search').addEventListener('click', () => {
      const code = cleanEan(form.elements.ean.value);
      if (!eanValid(code)) return error('Code EAN invalide : vérifiez les chiffres (8 ou 13, clé de contrôle).');
      error(''); showEan(code);
    });
    doc.getElementById('sc-extract')?.addEventListener('click', async () => {
      if (!file) return error('Ajoutez d’abord la photo de la facture.');
      if (!form.elements.consent.checked) return error('Cochez l’accord d’envoi de l’image avant l’extraction.');
      error('');
      try {
        lines = await withProgress('Lecture de la facture…', () => extractDocument({endpoint: endpoint(), file, ...(fetchImpl ? {fetchImpl} : {})}));
        if (!lines.length) return error('Aucune ligne exploitable dans la réponse.');
        showLines();
      } catch (err) {error(`Extraction impossible : ${err?.message || 'service indisponible'}.`);}
    });
  }

  const itemOptions = (selected, newLabel) => `${newLabel ? `<option value="__new">Créer l’article « ${e(newLabel)} »</option>` : ''}${items().map(i => `<option value="${e(i.id)}" ${i.id === selected ? 'selected' : ''}>${e(i.name)}${i.unit ? ` (${e(i.unit)})` : ''}</option>`).join('')}`;

  function showEan(code) {
    const root = doc.getElementById('sc-result'), found = itemByEan(items(), code);
    root.innerHTML = `<div class="sc-ean"><p>${found ? `EAN ${e(code)} : <strong>${e(found.name)}</strong> (dictionnaire local).` : `EAN ${e(code)} inconnu : choisissez l’article à associer, il sera reconnu la prochaine fois.`}</p>
      <div class="form-grid"><label>Article<select name="sc-item">${found ? itemOptions(found.id) : `<option value="">Choisir…</option>${itemOptions('')}`}</select></label>
      <label>Quantité reçue *<input name="sc-qty" type="number" min="0" step="any" inputmode="decimal"></label>
      <label>Prix unitaire (€)<input name="sc-price" type="number" min="0" step="any" inputmode="decimal"></label><label>Lot<input name="sc-lot"></label></div>
      <button type="button" class="button primary" id="sc-ean-save">Créer l’entrée</button></div>`;
    doc.getElementById('sc-ean-save').onclick = async () => {
      const form = doc.getElementById('stock-capture-form'), err = form.querySelector('.form-error');
      const id = root.querySelector('[name="sc-item"]').value, qty = Number(root.querySelector('[name="sc-qty"]').value);
      if (!id) {err.textContent = 'Choisissez l’article.'; err.hidden = false; return;}
      if (!(qty > 0)) {err.textContent = 'Indiquez une quantité reçue positive.'; err.hidden = false; return;}
      err.hidden = true;
      const item = items().find(i => i.id === id);
      if (cleanEan(item.ean) !== code) await store.upsert('stockItems', {...item, ean: code}, {label: `EAN associé : ${item.name}`});
      const price = root.querySelector('[name="sc-price"]').value;
      await store.recordStockMovement(entryMovement({product: item.name, quantity: qty, unitPrice: price === '' ? null : Number(price), lot: root.querySelector('[name="sc-lot"]').value.trim(), amm: ''}, id, {date: isoToday(), source: 'Étiquette'}));
      const stored = await storePhoto('Étiquette');
      closeModal(); toast(`Entrée de stock créée : ${item.name}.${stored ? ' Photo rangée dans Documents.' : ''}`, 'success');
    };
  }

  function showLines() {
    const rows = matchLines(lines, items()), root = doc.getElementById('sc-result');
    root.innerHTML = `<p class="sc-hint">Vérifiez chaque ligne, choisissez l’article correspondant puis cochez « Valider ». Seules les lignes validées créent une entrée.</p>
      <div class="table-wrap"><table class="sc-table"><thead><tr><th>Valider</th><th>Ligne lue</th><th>Quantité</th><th>Prix unit.</th><th>Article du stock</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr data-line="${i}"><td data-label="Valider"><input type="checkbox" class="sc-ok" aria-label="Valider la ligne ${i + 1}"></td>
        <td><strong>${e(r.line.product)}</strong><small>${[r.line.unit, r.line.amm ? `AMM ${r.line.amm}` : '', r.line.lot ? `lot ${r.line.lot}` : ''].filter(Boolean).map(e).join(' · ')}</small></td>
        <td data-label="Quantité"><input class="sc-qty" type="number" min="0" step="any" inputmode="decimal" value="${e(fmt(r.line.quantity))}" aria-label="Quantité"></td>
        <td data-label="Prix unitaire"><input class="sc-price" type="number" min="0" step="any" inputmode="decimal" value="${e(fmt(r.line.unitPrice))}" aria-label="Prix unitaire"></td>
        <td data-label="Article du stock"><select class="sc-item" aria-label="Article">${r.item ? itemOptions(r.item.id, r.line.product) : `<option value="">Choisir…</option>${itemOptions('', r.line.product)}`}</select><small class="sc-score">${r.item ? `Correspondance ${Math.round(r.score * 100)} % (${e(r.by)})` : 'Aucune correspondance sûre'}</small></td></tr>`).join('')}
      </tbody></table></div><button type="button" class="button primary" id="sc-lines-save">Créer les entrées validées</button>`;
    doc.getElementById('sc-lines-save').onclick = saveLines;
  }

  async function saveLines() {
    const form = doc.getElementById('stock-capture-form'), err = form.querySelector('.form-error');
    const chosen = [...doc.querySelectorAll('#sc-result tr[data-line]')].filter(tr => tr.querySelector('.sc-ok').checked);
    const fail = msg => {err.textContent = msg; err.hidden = false;};
    if (!chosen.length) return fail('Validez au moins une ligne.');
    for (const tr of chosen) {
      const n = Number(tr.dataset.line) + 1;
      if (!(Number(tr.querySelector('.sc-qty').value) > 0)) return fail(`Ligne ${n} : quantité positive attendue.`);
      if (!tr.querySelector('.sc-item').value) return fail(`Ligne ${n} : choisissez l’article.`);
    }
    err.hidden = true;
    let count = 0;
    for (const tr of chosen) {
      const line = {...lines[Number(tr.dataset.line)]}, price = tr.querySelector('.sc-price').value;
      line.quantity = Number(tr.querySelector('.sc-qty').value); line.unitPrice = price === '' ? null : Number(price);
      let id = tr.querySelector('.sc-item').value;
      if (id === '__new') id = (await store.upsert('stockItems', {id: uid('stock'), name: line.product, unit: line.unit || 'unité', quantity: 0, amm: line.amm || '', category: line.amm ? 'Phytosanitaire' : ''}, {label: `Article créé : ${line.product}`})).id;
      await store.recordStockMovement(entryMovement(line, id, {date: isoToday(), source: 'Facture'}));
      count++;
    }
    const stored = await storePhoto('Facture');
    closeModal(); toast(`${count} entrée${count > 1 ? 's' : ''} de stock créée${count > 1 ? 's' : ''}.${stored ? ' Photo rangée dans Documents.' : ''}`, 'success');
  }

  // La photo rejoint les Documents une fois au moins une entrée validée.
  async function storePhoto(category) {
    if (!file) return false;
    const id = uid('doc');
    await store.storage.blobPut(id, file);
    await store.upsert('documents', {id, name: file.name || `${category}.jpg`, mimeType: file.type, size: file.size, category, documentDate: isoToday(), tags: ['stock'], note: 'Ajoutée depuis « Photo d’étiquette ou de facture ».', origin: 'stock-capture'}, {label: `Document ajouté : ${category}`});
    return true;
  }

  return {open};
}
