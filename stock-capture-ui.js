// n° 106 — Photo d'étiquette ou de facture vers le stock : lecture EAN hors ligne, extraction en ligne
// optionnelle (consentement explicite), tableau de correspondance et validation ligne par ligne.
// n° W1 : lecture hors ligne du texte copié (Scanner du texte, Google Lens) par doc-text.js, sans réseau.
import {eanValid, cleanEan, itemByEan, matchLines, entryMovement, rememberSupplierRef, convertLineToItem} from './stock-capture.js';
import {parseDocText, docExtractSummary, frMoney} from './doc-text.js';
import {persistFormDraft, draftKey} from './form-drafts.js';
import {extractDocument} from './remote-ai.js';
import {escapeHtml as e, uid} from './utils.js';

const pad = n => String(n).padStart(2, '0');
const isoToday = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt = v => (v === null || v === undefined ? '' : String(v));
// Affichage seul : « 28 460 kg », « 14,8 % » (séparateur de milliers français).
const num = n => (Math.round(n * 1000) / 1000).toLocaleString('fr-FR', {maximumFractionDigits: 3});
const KIND_LABEL = {facture: 'Facture', bl: 'Bon de livraison', etiquette: 'Étiquette', pesee: 'Ticket de pesée', gasoil: 'Bon de gasoil', inconnu: 'Document'};
const frDate = iso => (iso ? iso.split('-').reverse().join('/') : '');

// Badge sous la ligne : déjà associé chez ce fournisseur, ou conditionnement multiplié (« 4 × 5 L = 20 L »).
export function lineBadge(row) {
  if (row.by === 'fournisseur') return 'Reconnu (déjà associé)';
  // Seul un conditionnement réellement multiplié (packs) est annoncé ; « carton 12 doses » compté en
  // cartons ou une quantité déjà lue en kg ne donnent pas de badge trompeur.
  const packs = row.line?.packs, unit = row.line?.unit || row.line?.pack?.unit || '';
  const count = Number(packs?.count), per = Number(packs?.per);
  if (!(count > 0) || !(per > 0) || count === 1) return '';
  return `${num(count)} × ${num(per)} ${unit} = ${num(count * per)} ${unit}`.replace(/ +$/, '');
}

// En-tête lu : type, fournisseur, date, n°, HT/TVA/TTC avec coche ou avertissements.
export function docHeaderHtml(parsed) {
  const h = parsed.header || {}, money = v => (v === null || v === undefined ? '' : `${frMoney(v)} €`);
  const tva = (h.tva || []).map(t => `TVA ${String(t.taux).replace('.', ',')} % ${money(t.montant)}`).join(' · ');
  const totals = [h.totalHT !== null && h.totalHT !== undefined ? `HT ${money(h.totalHT)}` : '', tva, h.totalTTC !== null && h.totalTTC !== undefined ? `TTC ${money(h.totalTTC)}` : ''].filter(Boolean).join(' · ');
  const warn = parsed.warnings || [], has = v => v !== null && v !== undefined, lignes = parsed.lignes || [];
  // Coche seulement si un contrôle a vraiment eu lieu : HT + TVA = TTC, ou somme des lignes chiffrées = HT.
  const checked = has(h.totalHT) && ((has(h.totalTTC) && (h.tva || []).length > 0) || (lignes.length > 0 && lignes.every(l => has(l.amount))));
  return `<div class="sc-doc-head"><p><strong>${e(KIND_LABEL[parsed.kind] || 'Document')}</strong>${[h.fournisseur, h.date ? `du ${frDate(h.date)}` : '', h.numero ? `n° ${h.numero}` : ''].filter(Boolean).map(v => ` · ${e(v)}`).join('')}</p>
    ${totals ? `<p class="sc-hint">${e(totals)} ${!warn.length && checked ? '<span class="badge success">✓ totaux cohérents</span>' : ''}</p>` : ''}
    ${warn.map(w => `<p class="sc-hint"><span class="badge danger">Attention</span> ${e(w)}</p>`).join('')}</div>`;
}

// Pesée ou gasoil : récapitulatif seulement, l'enregistrement se fait dans l'écran dédié.
export function docRecapHtml(parsed) {
  const has = v => v !== null && v !== undefined, kg = v => (v === null || v === undefined ? '' : `${num(v)} kg`);
  let facts = [], where = '';
  if (parsed.pesee) {
    const p = parsed.pesee;
    facts = [p.produit, p.plaque ? `plaque ${p.plaque}` : '', has(p.brutKg) ? `brut ${kg(p.brutKg)}` : '', has(p.tareKg) ? `tare ${kg(p.tareKg)}` : '', has(p.netKg) ? `net ${kg(p.netKg)}` : '', has(p.humidite) ? `humidité ${num(p.humidite)} %` : '', has(p.ps) ? `PS ${num(p.ps)}` : '', has(p.impuretes) ? `impuretés ${num(p.impuretes)} %` : ''];
    where = 'Ouvrez Récolte › Lot pour l’enregistrer.';
  } else if (parsed.gasoil) {
    const g = parsed.gasoil;
    facts = [g.produit, has(g.litres) ? `${num(g.litres)} L` : '', has(g.prixLitre) ? `${String(g.prixLitre).replace('.', ',')} €/L` : '', has(g.indexDebut) && has(g.indexFin) ? `index ${num(g.indexDebut)} → ${num(g.indexFin)}` : ''];
    where = 'Ouvrez Carburant › Plein pour l’enregistrer.';
  }
  return `${docHeaderHtml(parsed)}<p>${facts.filter(Boolean).map(e).join(' · ')}</p><p class="sc-hint">${e(where)}</p>`;
}

export function createStockCaptureUI({store, state, modal, closeModal, toast, withProgress = (_, run) => run(), doc = globalThis.document, win = globalThis.window, fetchImpl} = {}) {
  const items = () => (state().stockItems || []).filter(i => !i.deletedAt);
  const endpoint = () => {const p = state().preferences || {}; return p.remoteAiEnabled && p.remoteAiEndpoint ? p.remoteAiEndpoint : '';};
  const hasDetector = () => typeof win?.BarcodeDetector === 'function';
  const canPaste = () => typeof win?.navigator?.clipboard?.readText === 'function';
  let file = null, lines = [], parsed = null, draft = null;

  // file : photo déjà reçue (partage depuis une autre application, n° 121).
  function open({file: received = null} = {}) {
    file = received; lines = []; parsed = null;
    const ep = endpoint();
    let host;
    try {host = ep ? new URL(ep).host : '';} catch {host = ep;}
    modal('Photo d’étiquette ou de facture', 'Rien n’est ajouté au stock avant votre validation, ligne par ligne.',
      `<form id="stock-capture-form" class="form-grid" novalidate>
        ${received ? `<p class="sc-hint span-2">Photo reçue : <strong>${e(received.name)}</strong></p>` : ''}<label class="span-2">${received ? 'Autre photo (facultatif)' : 'Photo (étiquette ou facture)'}<input type="file" name="photo" accept="image/*,application/pdf" capture="environment"></label>
        <fieldset class="span-2 stock-capture-box"><legend>Hors ligne : code-barres</legend>
          ${hasDetector() ? '<button type="button" class="button secondary" id="sc-barcode">Lire le code-barres de la photo</button>' : '<p class="sc-hint">La lecture automatique du code-barres n’est pas disponible sur cet appareil (iPhone, iPad) : saisissez les chiffres sous le code-barres.</p>'}
          <label>Code EAN<input name="ean" inputmode="numeric" autocomplete="off" placeholder="13 chiffres"></label>
          <button type="button" class="button secondary" id="sc-ean-search">Chercher l’article</button></fieldset>
        <fieldset class="span-2 stock-capture-box"><legend>Hors ligne : coller le texte du document</legend>
          <p class="sc-hint">iPhone : ouvrez la photo › icône Texte › Tout sélectionner › Copier. Android : Google Lens › Texte › Copier.</p>
          <label>Texte de la facture, du BL, de l’étiquette, du ticket de pesée ou du bon de gasoil<textarea name="docText" rows="6" autocomplete="off" spellcheck="false"></textarea></label>
          <input type="hidden" name="linesJson" value="">
          ${canPaste() ? '<button type="button" class="button secondary" id="sc-paste">Coller</button>' : ''}<button type="button" class="button secondary" id="sc-read">Lire le texte</button></fieldset>
        <fieldset class="span-2 stock-capture-box"><legend>En ligne, en option : lecture de la facture</legend>
          ${ep ? `<label class="check-row sc-consent"><input type="checkbox" name="consent"><span>J’accepte d’envoyer cette image à <strong>${e(host)}</strong> (assistant distant configuré) pour en extraire les lignes. Aucune clé n’est enregistrée dans l’application.</span></label>
          <button type="button" class="button secondary" id="sc-extract">Extraire les lignes</button>` : '<p class="sc-hint">Pour lire une facture, configurez l’assistant distant dans Réglages. Sinon, utilisez le code-barres ou « Mouvement de stock ».</p>'}</fieldset>
        <p class="form-error span-2" hidden></p>
        <div id="sc-result" class="span-2"></div></form>`,
      '<button class="button secondary" data-action="close-modal">Fermer</button>', 'large');
    const form = doc.getElementById('stock-capture-form');
    const error = msg => {const el = form.querySelector('.form-error'); el.textContent = msg || ''; el.hidden = !msg;};
    form.elements.photo.addEventListener('change', () => {file = form.elements.photo.files?.[0] || received; error('');});
    draft = persistFormDraft(form, draftKey('stock-capture'), {exclude: ['consent', 'ean'], doc});
    // Brouillon repris : le texte est relu puis l'état des lignes (quantité, prix, article, validée) réappliqué.
    form.elements.linesJson.addEventListener('change', () => {
      if (!form.elements.docText.value.trim() || !form.elements.linesJson.value) return;
      let saved;
      try {saved = JSON.parse(form.elements.linesJson.value);} catch {return;}
      if (Array.isArray(saved) && readText({quiet: true})) restoreRows(saved);
    });
    // Toute modification du tableau met à jour le champ caché suivi par le brouillon.
    const track = event => {if (event.target?.closest?.('#sc-result')) syncLinesJson();};
    form.addEventListener('input', track); form.addEventListener('change', track);
    doc.getElementById('sc-paste')?.addEventListener('click', async () => {
      try {
        const text = await win.navigator.clipboard.readText();
        if (!text?.trim()) return error('Le presse-papiers est vide : copiez d’abord le texte du document.');
        form.elements.docText.value = text; form.elements.docText.dispatchEvent?.(new Event('input', {bubbles: true})); error(''); readText();
      } catch {error('Collage refusé par le navigateur : appuyez longuement dans la zone de texte puis « Coller ».');}
    });
    doc.getElementById('sc-read').addEventListener('click', () => readText());
    function readText({quiet = false} = {}) {
      try {parsed = parseDocText(form.elements.docText.value, {state: state()});} catch (err) {if (!quiet) error(err?.message || 'Lecture impossible.'); return false;}
      error('');
      if (parsed.pesee || parsed.gasoil) {lines = []; doc.getElementById('sc-result').innerHTML = docRecapHtml(parsed);}
      else {lines = parsed.lignes; showLines();}
      // Sur téléphone le résultat est sous l’encadré « En ligne » : on l’amène à l’écran après un appui.
      if (!quiet) doc.getElementById('sc-result')?.scrollIntoView?.({block: 'start', behavior: 'smooth'});
      return true;
    }
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
        parsed = null;
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
      <label>Prix unitaire (€)<input name="sc-price" type="number" min="0" step="any" inputmode="decimal"></label><label>N° de lot<input name="sc-lot" maxlength="60"></label>
      <label>Fournisseur<input name="sc-supplier" maxlength="80"></label><label>Date de péremption<input name="sc-expiry" type="date"></label></div>
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
      await store.recordStockMovement(entryMovement({product: item.name, quantity: qty, unitPrice: price === '' ? null : Number(price), lot: root.querySelector('[name="sc-lot"]').value.trim(), supplier: root.querySelector('[name="sc-supplier"]').value.trim(), expiryDate: root.querySelector('[name="sc-expiry"]').value, amm: ''}, id, {date: isoToday(), source: 'Étiquette'}));
      const stored = await storePhoto('Étiquette');
      draft?.clear();
      closeModal(); toast(`Entrée de stock créée : ${item.name}.${stored ? ' Photo rangée dans Documents.' : ''}`, 'success');
    };
  }

  const docSupplier = () => parsed?.header?.fournisseur || '';
  function showLines() {
    const supplier = docSupplier(), rows = matchLines(lines, items(), {supplier}), root = doc.getElementById('sc-result');
    root.innerHTML = `${parsed ? docHeaderHtml(parsed) : ''}<p class="sc-hint">Vérifiez chaque ligne, choisissez l’article correspondant puis cochez « Valider ». Seules les lignes validées créent une entrée.</p>
      <div class="table-wrap"><table class="sc-table"><thead><tr><th>Valider</th><th>Ligne lue</th><th>Quantité</th><th>Prix unit.</th><th>Article du stock</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr data-line="${i}"><td data-label="Valider"><input type="checkbox" class="sc-ok" aria-label="Valider la ligne ${i + 1}"></td>
        <td><strong>${e(r.line.product)}</strong><small>${[r.line.unit, r.line.amm ? `AMM ${r.line.amm}` : '', r.line.lot ? `lot ${r.line.lot}` : '', r.line.supplier || '', r.line.expiryDate ? `péremption ${r.line.expiryDate.split('-').reverse().join('/')}` : ''].filter(Boolean).map(e).join(' · ')}</small></td>
        <td data-label="Quantité"><input class="sc-qty" type="number" min="0" step="any" inputmode="decimal" value="${e(fmt(r.line.quantity))}" aria-label="Quantité"></td>
        <td data-label="Prix unitaire"><input class="sc-price" type="number" min="0" step="any" inputmode="decimal" value="${e(fmt(r.line.unitPrice))}" aria-label="Prix unitaire"></td>
        <td data-label="Article du stock"><select class="sc-item" aria-label="Article">${r.item ? itemOptions(r.item.id, r.line.product) : `<option value="">Choisir…</option>${itemOptions('', r.line.product)}`}</select><small class="sc-score">${r.item ? `Correspondance ${Math.round(r.score * 100)} % (${e(r.by)})` : 'Aucune correspondance sûre'}</small>${lineBadge(r) ? `<small${r.by === 'fournisseur' ? '' : ` class="sc-pack" data-qty="${e(String(r.line.quantity ?? ''))}"`}><span class="badge ${r.by === 'fournisseur' ? 'success' : 'info'}">${e(lineBadge(r))}</span></small>` : ''}${(r.line.supplier || supplier) && r.by !== 'fournisseur' ? `<label class="check-row"><input type="checkbox" class="sc-remember" checked><span>Retenir pour ce fournisseur</span></label>` : ''}</td></tr>`).join('')}
      </tbody></table></div><button type="button" class="button primary" id="sc-lines-save">Créer les entrées validées</button>`;
    doc.getElementById('sc-lines-save').onclick = saveLines;
    syncLinesJson();
  }

  const rowEls = () => [...(doc.getElementById('sc-result')?.querySelectorAll?.('tr[data-line]') || [])];
  function syncLinesJson() {
    const field = doc.getElementById('stock-capture-form')?.elements?.linesJson;
    // Quantité corrigée à la main : le badge « 4 × 5 L = 20 L » ne décrit plus la ligne, il se masque.
    for (const tr of rowEls()) {const pack = tr.querySelector('.sc-pack'); if (pack) pack.hidden = Number(tr.querySelector('.sc-qty').value) !== Number(pack.dataset.qty);}
    if (!field) return;
    field.value = JSON.stringify(rowEls().map(tr => {
      const remember = tr.querySelector('.sc-remember');
      return {qty: tr.querySelector('.sc-qty').value, price: tr.querySelector('.sc-price').value, item: tr.querySelector('.sc-item').value, ok: tr.querySelector('.sc-ok').checked, ...(remember ? {remember: remember.checked} : {})};
    }));
  }
  function restoreRows(saved) {
    rowEls().forEach((tr, i) => {
      const s = saved[i]; if (!s) return;
      tr.querySelector('.sc-qty').value = s.qty ?? ''; tr.querySelector('.sc-price').value = s.price ?? '';
      if (s.item && [...tr.querySelector('.sc-item').options].some(o => o.value === s.item)) tr.querySelector('.sc-item').value = s.item;
      tr.querySelector('.sc-ok').checked = Boolean(s.ok);
      const remember = tr.querySelector('.sc-remember'); if (remember && typeof s.remember === 'boolean') remember.checked = s.remember;
    });
    syncLinesJson();
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
    const kept = [];
    const supplier = docSupplier(), source = parsed ? (KIND_LABEL[parsed.kind] && parsed.kind !== 'inconnu' ? KIND_LABEL[parsed.kind] : 'Document') : 'Facture';
    // Facture d'achat lue : TVA et totaux conservés sur l'achat (purchaseVat sur la 1re entrée, clé commune
    // purchaseKey sur toutes et sur la photo rangée) pour le solde de TVA (vat-balance.js), sans double compte.
    const purchase = parsed?.kind === 'facture' ? {...docExtractSummary(parsed), supplier} : null, purchaseKey = purchase ? uid('achat') : '';
    const purchaseFields = first => purchase ? {purchaseKey, ...(purchase.numero ? {invoiceRef: purchase.numero} : {}), ...(first ? {purchaseVat: purchase} : {})} : {};
    for (const tr of chosen) {
      const line = {...lines[Number(tr.dataset.line)]}, price = tr.querySelector('.sc-price').value;
      line.quantity = Number(tr.querySelector('.sc-qty').value); line.unitPrice = price === '' ? null : Number(price);
      let id = tr.querySelector('.sc-item').value;
      if (id === '__new') id = (await store.upsert('stockItems', {id: uid('stock'), name: line.product, unit: line.unit || 'unités', quantity: 0, amm: line.amm || '', category: line.amm ? 'Phytosanitaire' : ''}, {label: `Article créé : ${line.product}`})).id;
      else {
        // Quantité ramenée à l'unité de l'article (L, kg, t) ; unité incompatible : valeurs lues gardées.
        const conv = convertLineToItem(line, items().find(i => i.id === id));
        if (conv.converted) {line.quantity = conv.quantity; line.unitPrice = conv.unitPrice;}
        else if (conv.why === 'Unité incompatible') kept.push(Number(tr.dataset.line) + 1);
      }
      await store.recordStockMovement({...entryMovement(line, id, {date: isoToday(), source}), ...purchaseFields(count === 0)});
      const who = line.supplier || supplier, item = items().find(i => i.id === id);
      if (who && item && tr.querySelector('.sc-remember')?.checked) await store.upsert('stockItems', rememberSupplierRef(item, {supplier: who, label: lines[Number(tr.dataset.line)].product, factor: line.pack?.factor ?? null, unit: line.pack?.unit || line.unit || ''}), {label: `Référence fournisseur retenue : ${item.name}`});
      count++;
    }
    const stored = await storePhoto(parsed && parsed.kind !== 'inconnu' ? source : 'Facture', purchase ? {purchaseKey, ...(supplier ? {supplier} : {})} : {});
    draft?.clear();
    // Unité lue impossible à convertir vers celle de l'article : quantité gardée telle quelle, et on le dit.
    const note = kept.length ? ` Ligne${kept.length > 1 ? 's' : ''} ${kept.join(', ')} : unité différente de l’article, quantité gardée telle quelle, à vérifier.` : '';
    closeModal(); toast(`${count} entrée${count > 1 ? 's' : ''} de stock créée${count > 1 ? 's' : ''}.${stored ? ' Photo rangée dans Documents.' : ''}${note}`, kept.length ? 'warning' : 'success');
  }

  // La photo rejoint les Documents une fois au moins une entrée validée.
  async function storePhoto(category, extra = {}) {
    if (!file) return false;
    const id = uid('doc');
    await store.storage.blobPut(id, file);
    await store.upsert('documents', {id, name: file.name || `${category}.jpg`, mimeType: file.type, size: file.size, category, documentDate: isoToday(), tags: ['stock'], note: 'Ajoutée depuis « Photo d’étiquette ou de facture ».', origin: 'stock-capture', ...(parsed ? {docExtract: docExtractSummary(parsed)} : {}), ...extra}, {label: `Document ajouté : ${category}`});
    return true;
  }

  return {open};
}
