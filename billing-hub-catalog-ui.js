// Centre « Facturation » (chantier B) : onglets Catalogue et Récurrences, rendus dans le panneau du centre
// (billing-hub-ui.js). Catalogue : recherche, catégories, création, modification, archivage, prix par client,
// import CSV ou XLSX (SheetJS chargé à la demande) avec aperçu avant écriture et annulation. Récurrences :
// liste des modèles, prochaine date, historique des générations, création (vierge ou depuis un document),
// suspension, génération du brouillon (jamais d'émission sans confirmation explicite).
import {active} from './farm-memory.js';
import {dateFr, deleteDraft, emitDocument, invoiceSettings, invoices, vatRatesOf, DOC_LABELS} from './invoices.js';
import {FREQUENCIES, archiveCatalogItem, catalogItems, catalogLine, generateFromSchedule, importCatalogItems, saveCatalogItem, saveSchedule, schedules, undoCatalogImport} from './billing.js';
import {ALL_UNITS, CATALOG_CSV_MODEL, CATALOG_IMPORT_MAX,catalogCategories, catalogImportPreview, money, moneyShort, parseCsv, plural, scheduleFromDocument, scheduleRows, searchCatalog, sheetRows} from './billing-hub.js';
import {loadVendor} from './vendor-loader.js';

const rate = r => `${String(r).replace('.', ',')} %`;
const unitLabel = u => (ALL_UNITS.find(([k]) => k === u) || [u, u])[1];

export function createHubCatalogUI(ctx) {
  const {store, data, today, toast, bindChipChoices, canWrite, doc, html, raw, refresh, setView} = ctx;
  let filters = {q: '', category: '', archived: false}, preview = null;
  const show = view => { setView(view); refresh(); doc.getElementById('bh-panel')?.focus(); };
  const back = () => { setView(null); refresh(); };
  const fail = (form, message, field = null) => {
    const box = form?.querySelector('.form-error');
    if (box) { box.textContent = message; box.classList.remove('hidden'); }
    (field && form?.elements[field])?.focus?.();
  };
  // Écriture en cours : bouton d'envoi désactivé et second envoi ignoré (double clic, Entrée répétée).
  const busy = (form, on) => {
    if (on && form.dataset.bhBusy) return false;
    if (on) { form.dataset.bhBusy = '1'; form.setAttribute('aria-busy', 'true'); } else { delete form.dataset.bhBusy; form.removeAttribute('aria-busy'); }
    form.querySelectorAll('button[type="submit"]').forEach(b => { b.disabled = on; });
    return true;
  };
  const settings = () => invoiceSettings(data());
  const clients = () => active(data(), 'clients').filter(c => !c.archived).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
  const option = (value, label, current) => html`<option value="${value}"${String(value) === String(current) ? raw(' selected') : ''}>${label}</option>`;

  // ——— Catalogue ———
  function renderCatalog(box) {
    const list = searchCatalog(data(), {query: filters.q, category: filters.category, archived: filters.archived}), cats = catalogCategories(data()), w = canWrite('billingItem');
    const total = catalogItems(data(), {includeArchived: true}).length;
    box.innerHTML = String(html`<div class="bh-toolbar">
        <form class="bh-search" role="search" data-bh-form="catalog-filter" aria-label="Filtrer le catalogue">
          <label>Rechercher<input type="search" name="q" value="${filters.q}" autocomplete="off" placeholder="Code, désignation, catégorie"></label>
          <label>Catégorie<select name="category"><option value="">Toutes</option>${cats.map(c => option(c, c, filters.category))}</select></label>
          <label class="bh-check"><input type="checkbox" name="archived"${filters.archived ? raw(' checked') : ''}> Articles archivés</label>
        </form>
        ${w ? html`<div class="bh-actions"><button type="button" class="button primary" data-bh="cat-new">Nouvel article</button><button type="button" class="button secondary" data-bh="cat-import">Importer CSV ou XLSX</button><button type="button" class="text-button" data-bh="cat-model">Modèle de fichier</button><input type="file" class="sr-only" data-bh-file="catalog" accept=".csv,.txt,.tsv,.xlsx,.xls,text/csv" tabindex="-1" aria-hidden="true"></div>` : ''}
      </div>
      ${list.length ? html`<ul class="bh-rows bh-catalog" aria-label="Articles du catalogue">${list.map(i => html`<li><button type="button" class="bh-row" data-bh="cat-edit" data-id="${i.id}"><span><strong>${i.label}</strong><small>${[i.code, i.category, i.clientPrices?.length ? plural(i.clientPrices.length, 'prix client', 'prix clients') : ''].filter(Boolean).join(' · ') || 'Sans code'}</small></span><span class="bh-amounts"><strong>${i.unitPrice === null || i.unitPrice === undefined ? 'Prix à saisir' : `${money(i.unitPrice)} HT`}</strong><small>par ${unitLabel(i.unit)} · TVA ${rate(i.vatRate)}</small></span></button></li>`)}</ul>`
        : html`<div class="bh-empty-state"><strong>${total ? 'Aucun article ne correspond.' : 'Catalogue vide.'}</strong><p>${total ? 'Modifiez la recherche ou la catégorie.' : 'Enregistrez vos prestations et articles habituels (code, prix, TVA, compte) : ils se reprennent en un geste dans les devis et factures, avec le prix propre à chaque client.'}</p></div>`}`);
    const form = box.querySelector('[data-bh-form="catalog-filter"]');
    form.addEventListener('submit', event => event.preventDefault());
    form.elements.q.addEventListener('input', () => { filters = {...filters, q: form.elements.q.value}; const pos = form.elements.q.selectionStart; renderCatalog(box); const again = box.querySelector('input[name="q"]'); again.focus(); again.setSelectionRange(pos, pos); });
    form.elements.category.addEventListener('change', () => { filters = {...filters, category: form.elements.category.value}; renderCatalog(box); box.querySelector('select[name="category"]')?.focus(); });
    form.elements.archived.addEventListener('change', () => { filters = {...filters, archived: form.elements.archived.checked}; renderCatalog(box); box.querySelector('input[name="archived"]')?.focus(); });
    box.querySelector('[data-bh-file="catalog"]')?.addEventListener('change', event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) readImport(file); });
  }

  function itemForm(item = null) {
    const s = settings(), w = canWrite('billingItem'), cats = catalogCategories(data()), people = clients();
    const prices = item?.clientPrices?.length ? item.clientPrices : [];
    const priceRow = (p = {}, i = 0) => html`<li class="bh-price-row"><label>Client<select name="cpClient">${option('', 'Choisir…', p.clientId || '')}${people.map(c => option(c.id, c.name, p.clientId || ''))}</select></label><label>Prix HT<input name="cpPrice" inputmode="decimal" value="${p.unitPrice ?? ''}" aria-describedby="bh-cp-help"></label><button type="button" class="text-button" data-bh="cat-price-remove" aria-label="${`Retirer le prix client ${i + 1}`}">Retirer</button></li>`;
    return box => {
      box.innerHTML = String(html`<button type="button" class="text-button bh-back" data-bh="back">‹ Catalogue</button>
        <h3 class="bh-title">${item ? item.label : 'Nouvel article'}</h3>
        <form class="bh-form" data-bh-form="catalog-item"${w ? raw(' data-bh-guard') : ''} novalidate>
          <div class="bh-form-grid">
            <label>Code<input name="code" value="${item?.code || ''}" maxlength="20" autocomplete="off" placeholder="PELLE-8T"></label>
            <label class="is-wide">Désignation<input name="label" value="${item?.label || ''}" required maxlength="200" data-autofocus></label>
            <label class="is-wide">Description<textarea name="description" rows="2" maxlength="2000">${item?.description || ''}</textarea></label>
            <label>Unité<select name="unit">${ALL_UNITS.map(([u, l]) => option(u, l, item?.unit || 'h'))}</select></label>
            <label>Prix unitaire HT<input name="unitPrice" inputmode="decimal" value="${item?.unitPrice ?? ''}" placeholder="65"></label>
            <label>TVA<select name="vatRate">${vatRatesOf(s).map(r => option(r, rate(r), item?.vatRate ?? s.vatRate))}</select></label>
            <label>Catégorie<input name="category" value="${item?.category || ''}" list="bh-categories" maxlength="60" placeholder="Terrassement"><datalist id="bh-categories">${cats.map(c => html`<option value="${c}"></option>`)}</datalist></label>
            <label>Compte de produit<input name="account" value="${item?.account || ''}" inputmode="numeric" maxlength="10" placeholder="706"></label>
          </div>
          <fieldset class="bh-fieldset"><legend>Prix par client</legend><p class="bh-note" id="bh-cp-help">Remplace le prix du catalogue pour ce client dans ses devis et factures.</p>
            <ul class="bh-price-list" data-bh-prices>${prices.map((p, i) => priceRow(p, i))}</ul>
            ${people.length ? html`<button type="button" class="button secondary" data-bh="cat-price-add">Ajouter un prix client</button>` : html`<p class="bh-note">Aucun client enregistré.</p>`}</fieldset>
          <p class="form-error hidden" role="alert"></p>
          ${w ? html`<div class="bh-actions"><button type="submit" class="button primary">Enregistrer</button>${item ? html`<button type="button" class="button secondary" data-bh="cat-archive" data-id="${item.id}">${item.archived ? 'Réactiver' : 'Archiver'}</button>` : ''}<button type="button" class="button secondary" data-bh="back">Annuler</button></div>` : html`<p class="bh-note">Lecture seule : votre rôle ne permet pas de modifier le catalogue.</p>`}
        </form>`);
      const form = box.querySelector('form');
      form.querySelector('[data-autofocus]')?.focus();
      form.addEventListener('input', () => form.querySelector('.form-error')?.classList.add('hidden'));
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const f = form.elements, rows = [...form.querySelectorAll('.bh-price-row')];
        const clientPrices = rows.map(r => ({clientId: r.querySelector('[name="cpClient"]').value, unitPrice: r.querySelector('[name="cpPrice"]').value})).filter(p => p.clientId || String(p.unitPrice).trim());
        if (clientPrices.some(p => !p.clientId)) return fail(form, 'Choisissez le client de chaque prix client (ou retirez la ligne).');
        const values = {code: f.code.value, label: f.label.value, description: f.description.value, unit: f.unit.value, unitPrice: f.unitPrice.value, vatRate: f.vatRate.value, category: f.category.value, account: f.account.value, archived: !!item?.archived, clientPrices};
        if (!values.label.trim()) return fail(form, 'Champ obligatoire : Désignation', 'label');
        const before = item ? JSON.parse(JSON.stringify(store.get('integrationImports', item.id) || item)) : null;
        if (!busy(form, true)) return;
        try {
          const saved = await saveCatalogItem(store, values, item?.id || null);
          toast(item ? 'Article modifié.' : 'Article ajouté au catalogue.', 'success', {label: 'Annuler', run: async () => { if (before) await store.upsert('integrationImports', before, {label: 'Modification annulée'}); else await store.remove('integrationImports', saved.id); toast('Modification annulée.'); if (doc.getElementById('bh-panel')) back(); }});
          back();
        } catch (error) { busy(form, false); fail(form, error.message, /Code/.test(error.message) ? 'code' : /Compte/.test(error.message) ? 'account' : /Prix client/.test(error.message) ? null : /Prix/.test(error.message) ? 'unitPrice' : null); }
      });
      ctx.priceRow = priceRow;
    };
  }

  // Import : lecture, aperçu, puis une seule écriture (annulable).
  async function readImport(file) {
    try {
      let rows;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const XLSX = await loadVendor('xlsx');
        if (!XLSX) throw new Error('Lecture des fichiers Excel indisponible pour le moment : enregistrez le fichier au format CSV puis importez-le.');
        rows = sheetRows(XLSX, await file.arrayBuffer());
      } else rows = parseCsv(await file.text());
      preview = {...catalogImportPreview(data(), rows), file: file.name};
      show(importView);
    } catch (error) { toast(error.message || 'Fichier illisible.', 'error'); }
  }
  function importView(box) {
    const p = preview || {items: [], errors: []};
    box.innerHTML = String(html`<button type="button" class="text-button bh-back" data-bh="back">‹ Catalogue</button>
      <h3 class="bh-title">Import du catalogue</h3><p class="bh-lead">${p.file || ''}</p>
      ${p.error ? html`<p class="notice warning" role="alert">${p.error}</p>` : html`<div class="bh-kpis is-small"><div class="bh-kpi"><span class="bh-kpi-label">Nouveaux articles</span><strong class="bh-kpi-value" data-bh-import-created>${p.created}</strong></div><div class="bh-kpi"><span class="bh-kpi-label">Mises à jour (même code)</span><strong class="bh-kpi-value">${p.updated}</strong></div><div class="bh-kpi${p.ignored ? ' is-bad' : ''}"><span class="bh-kpi-label">Lignes ignorées</span><strong class="bh-kpi-value">${p.ignored ?? p.errors.length}</strong></div></div>
        ${p.truncated ? html`<p class="notice warning" role="status" data-bh-import-truncated>${`Seules les ${CATALOG_IMPORT_MAX.toLocaleString('fr-FR')} premières lignes seront importées : ${plural(p.truncated, 'ligne n’est pas prise', 'lignes ne sont pas prises')} en compte. Découpez le fichier pour importer la suite.`}</p>` : ''}
        ${p.errors.length ? html`<details class="bh-figures"><summary>Voir les lignes ignorées</summary><ul class="bh-errors">${p.errors.slice(0, 50).map(e => html`<li>Ligne ${e.line} : ${e.error}</li>`)}</ul></details>` : ''}
        ${p.items.length ? html`<div class="bh-table-wrap"><table class="bh-table"><caption class="sr-only">Articles lus dans le fichier</caption><thead><tr><th scope="col">Désignation</th><th scope="col">Code</th><th scope="col" class="n">Prix HT</th><th scope="col" class="n">TVA</th><th scope="col">Catégorie</th><th scope="col">Action</th></tr></thead><tbody>${p.items.slice(0, 60).map(x => html`<tr><th scope="row">${x.values.label}</th><td>${x.values.code || '—'}</td><td class="n">${x.values.unitPrice === null ? '—' : `${money(x.values.unitPrice)} / ${unitLabel(x.values.unit)}`}</td><td class="n">${rate(x.values.vatRate)}</td><td>${x.values.category || '—'}</td><td>${x.id ? 'Mise à jour' : 'Nouveau'}</td></tr>`)}</tbody></table></div>${p.items.length > 60 ? html`<p class="bh-note">… et ${p.items.length - 60} autres articles.</p>` : ''}` : ''}`}
      <div class="bh-actions">${p.items.length ? html`<button type="button" class="button primary" data-bh="cat-import-confirm">${`Importer ${plural(p.items.length, 'article', 'articles')}`}</button>` : ''}<button type="button" class="button secondary" data-bh="back">Annuler</button></div>`);
  }
  async function confirmImport() {
    if (!preview?.items?.length) return;
    // Aperçu consommé avant l'écriture : un second clic pendant l'import ne relance rien.
    const current = preview; preview = null;
    const button = doc.querySelector('[data-bh="cat-import-confirm"]');
    if (button) button.disabled = true;
    let result;
    try { result = await importCatalogItems(store, current.items); }
    catch (error) { preview = current; if (button?.isConnected) button.disabled = false; throw error; }
    toast(`${plural(result.count, 'article importé', 'articles importés')}.`, 'success', {label: 'Annuler', run: async () => { const r = await undoCatalogImport(store, result); toast(r?.archived ? `Import annulé : ${plural(r.archived, 'nouvel article archivé', 'nouveaux articles archivés')} (suppression réservée à la gestion).` : 'Import annulé.'); if (doc.getElementById('bh-panel')) refresh(); }});
    back();
  }
  function downloadModel() {
    const blob = new Blob(['﻿', CATALOG_CSV_MODEL], {type: 'text/csv;charset=utf-8'}), url = URL.createObjectURL(blob), a = doc.createElement('a');
    a.href = url; a.download = 'modele-catalogue.csv'; doc.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ——— Récurrences ———
  function renderSchedules(box) {
    const rows = scheduleRows(data(), {today: today()}), w = canWrite('billingSchedule');
    box.innerHTML = String(html`<div class="bh-toolbar"><p class="bh-lead">Factures périodiques (pension, location, entretien) : chaque échéance prépare un brouillon à vérifier ; rien n’est émis sans votre confirmation.</p>
      ${w ? html`<div class="bh-actions"><button type="button" class="button primary" data-bh="rec-new">Nouveau modèle</button><button type="button" class="button secondary" data-bh="rec-from-doc">Depuis une facture</button></div>` : ''}</div>
      ${rows.length ? html`<ul class="bh-todo" aria-label="Modèles de facturation récurrente">${rows.map(r => html`<li class="bh-todo-item${r.ended ? ' is-muted' : ''}"><div class="bh-todo-main"><strong>${r.schedule.label}</strong>
          <small>${r.client?.name || 'Client supprimé'} · ${r.frequency} · ${moneyShort(r.amountHt)} HT${r.schedule.mode === 'emission' ? ' · émission proposée' : ' · brouillon'}</small>
          <small>${r.ended ? (r.schedule.endDate && r.schedule.nextDate > r.schedule.endDate ? `Terminé le ${dateFr(r.schedule.endDate)}` : 'Suspendu') : r.due ? html`<b class="is-late">${plural(r.due, 'période à facturer', 'périodes à facturer')}</b> depuis le ${dateFr(r.schedule.nextDate)}` : `Prochaine facture le ${dateFr(r.schedule.nextDate)}`}${r.schedule.endDate && !r.ended ? ` · jusqu’au ${dateFr(r.schedule.endDate)}` : ''}</small>
          ${r.history.length ? html`<details class="bh-history"><summary>${plural(r.history.length, 'facture générée', 'factures générées')}</summary><ul class="bh-docs">${r.history.slice(0, 24).map(h => html`<li><button type="button" class="text-button" data-bh="doc" data-id="${h.id}">${h.number}</button> · période du ${dateFr(h.period)} · ${h.status === 'brouillon' ? 'brouillon' : h.status}</li>`)}</ul></details>` : html`<small>Aucune facture générée.</small>`}</div>
        <div class="bh-todo-actions">${w && r.due && !r.ended ? html`<button type="button" class="button primary" data-bh="rec-generate" data-id="${r.schedule.id}">Préparer le brouillon</button>` : ''}${w ? html`<button type="button" class="button secondary" data-bh="rec-edit" data-id="${r.schedule.id}">Modifier</button><button type="button" class="button secondary" data-bh="rec-toggle" data-id="${r.schedule.id}">${r.schedule.active ? 'Suspendre' : 'Reprendre'}</button>` : ''}</div></li>`)}</ul>`
        : html`<div class="bh-empty-state"><strong>Aucune facturation récurrente.</strong><p>Créez un modèle (client, lignes, périodicité) ou partez d’une facture existante.</p></div>`}`);
  }

  function lineRow(l = {}, i = 0) {
    const s = settings();
    return html`<li class="bh-line" data-bh-line><span class="bh-line-no" aria-hidden="true">${i + 1}</span>
      <label class="is-wide">Désignation<input name="lLabel" value="${l.label || ''}" maxlength="200"></label>
      <label>Quantité<input name="lQty" inputmode="decimal" value="${l.quantity ?? 1}"></label>
      <label>Unité<select name="lUnit">${ALL_UNITS.map(([u, lab]) => option(u, lab, l.unit || 'forfait'))}</select></label>
      <label>Prix HT<input name="lPrice" inputmode="decimal" value="${l.unitPrice ?? ''}"></label>
      <label>TVA<select name="lVat">${vatRatesOf(s).map(r => option(r, rate(r), l.vatRate ?? s.vatRate))}</select></label>
      <input type="hidden" name="lItem" value="${l.itemId || ''}"><input type="hidden" name="lAccount" value="${l.account || ''}">
      <button type="button" class="text-button" data-bh="rec-line-remove" aria-label="${`Retirer la ligne ${i + 1}`}">Retirer</button></li>`;
  }
  function scheduleForm(schedule = null, preset = null) {
    const v = schedule || preset || {frequency: 'mensuel', mode: 'brouillon', lines: [{}], nextDate: today()};
    const people = clients(), items = catalogItems(data());
    return box => {
      box.innerHTML = String(html`<button type="button" class="text-button bh-back" data-bh="back">‹ Récurrences</button>
        <h3 class="bh-title">${schedule ? schedule.label : 'Nouveau modèle de facturation'}</h3>
        <form class="bh-form" data-bh-form="schedule" data-bh-guard novalidate>
          <div class="bh-form-grid">
            <label>Client<select name="clientId" data-autofocus>${option('', 'Choisir…', v.clientId || '')}${people.map(c => option(c.id, c.name, v.clientId || ''))}</select></label>
            <label class="is-wide">Intitulé<input name="label" value="${v.label || ''}" maxlength="120" placeholder="Pension des génisses"></label>
            <div class="field-label is-wide"><span>Périodicité</span><input type="hidden" name="frequency" value="${v.frequency || 'mensuel'}"><div class="chip-choices" data-chip-target="frequency">${FREQUENCIES.map(([k, , label]) => html`<button type="button" class="choice-chip${k === (v.frequency || 'mensuel') ? ' is-on' : ''}" data-value="${k}">${label}</button>`)}</div></div>
            <label>Prochaine facture le<input type="date" name="nextDate" value="${v.nextDate || today()}"></label>
            <label>Dernière facture au plus tard le<input type="date" name="endDate" value="${v.endDate || ''}"></label>
            <div class="field-label is-wide"><span>À chaque échéance</span><input type="hidden" name="mode" value="${v.mode || 'brouillon'}"><div class="chip-choices" data-chip-target="mode"><button type="button" class="choice-chip${v.mode !== 'emission' ? ' is-on' : ''}" data-value="brouillon">Préparer un brouillon</button><button type="button" class="choice-chip${v.mode === 'emission' ? ' is-on' : ''}" data-value="emission">Proposer l’émission</button></div></div>
            <label class="is-wide">Note imprimée<textarea name="note" rows="2" maxlength="1000">${v.note || ''}</textarea></label>
          </div>
          <fieldset class="bh-fieldset"><legend>Lignes facturées</legend>
            <ol class="bh-lines" data-bh-lines>${(v.lines?.length ? v.lines : [{}]).filter(l => !l.kind || l.kind === 'item').map((l, i) => lineRow(l, i))}</ol>
            <div class="bh-actions"><button type="button" class="button secondary" data-bh="rec-line-add">Ajouter une ligne</button>${items.length ? html`<label class="bh-inline">Depuis le catalogue<select data-bh-catalog-pick><option value="">Choisir un article…</option>${items.map(i => option(i.id, `${i.label}${i.code ? ` (${i.code})` : ''}`, ''))}</select></label>` : ''}</div></fieldset>
          <p class="form-error hidden" role="alert"></p>
          <div class="bh-actions"><button type="submit" class="button primary">Enregistrer le modèle</button><button type="button" class="button secondary" data-bh="back">Annuler</button></div>
        </form>`);
      const form = box.querySelector('form');
      bindChipChoices(form);
      form.querySelector('[data-autofocus]')?.focus();
      form.addEventListener('input', () => form.querySelector('.form-error')?.classList.add('hidden'));
      form.querySelector('[data-bh-catalog-pick]')?.addEventListener('change', event => {
        const item = catalogItems(data()).find(i => i.id === event.target.value); event.target.value = '';
        if (!item) return;
        const list = form.querySelector('[data-bh-lines]'), empty = [...list.querySelectorAll('[data-bh-line]')].find(li => !li.querySelector('[name="lLabel"]').value.trim());
        const line = catalogLine(item, {clientId: form.elements.clientId.value || null}), node = doc.createElement('template');
        node.innerHTML = String(lineRow(line, list.children.length));
        if (empty) empty.replaceWith(node.content.firstElementChild); else list.append(node.content.firstElementChild);
        renumber(list);
        toast(`Ligne ajoutée : ${item.label}.`);
      });
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const f = form.elements;
        const lines = [...form.querySelectorAll('[data-bh-line]')].map(li => { const g = n => li.querySelector(`[name="${n}"]`).value; return {label: g('lLabel'), quantity: g('lQty'), unit: g('lUnit'), unitPrice: g('lPrice'), vatRate: g('lVat'), ...(g('lItem') ? {itemId: g('lItem')} : {}), ...(g('lAccount') ? {account: g('lAccount')} : {})}; }).filter(l => l.label.trim() || String(l.unitPrice).trim());
        if (!f.clientId.value) return fail(form, 'Champ obligatoire : Client', 'clientId');
        const values = {clientId: f.clientId.value, label: f.label.value, frequency: f.frequency.value, nextDate: f.nextDate.value, endDate: f.endDate.value, mode: f.mode.value, note: f.note.value, lines, active: schedule ? schedule.active : true};
        const before = schedule ? JSON.parse(JSON.stringify(store.get('integrationImports', schedule.id) || schedule)) : null;
        if (!busy(form, true)) return;
        try {
          const saved = await saveSchedule(store, values, schedule?.id || null);
          toast(schedule ? 'Modèle modifié.' : 'Modèle de facturation enregistré.', 'success', {label: 'Annuler', run: async () => { if (before) await store.upsert('integrationImports', before, {label: 'Modification annulée'}); else await store.remove('integrationImports', saved.id); toast('Modification annulée.'); if (doc.getElementById('bh-panel')) back(); }});
          back();
        } catch (error) { busy(form, false); fail(form, error.message, /Client/.test(error.message) ? 'clientId' : /date/i.test(error.message) ? (/fin/i.test(error.message) ? 'endDate' : 'nextDate') : null); }
      });
    };
  }
  const renumber = list => list.querySelectorAll('[data-bh-line]').forEach((li, i) => { li.querySelector('.bh-line-no').textContent = String(i + 1); li.querySelector('[data-bh="rec-line-remove"]').setAttribute('aria-label', `Retirer la ligne ${i + 1}`); });

  function pickDocument() {
    const list = invoices(data()).filter(d => d.status !== 'brouillon' && ['facture', undefined].includes(d.docType) && d.clientId).sort((a, b) => String(b.issueDate).localeCompare(String(a.issueDate))).slice(0, 40);
    show(box => {
      box.innerHTML = String(html`<button type="button" class="text-button bh-back" data-bh="back">‹ Récurrences</button><h3 class="bh-title">Partir d’une facture</h3>
        ${list.length ? html`<ul class="bh-rows">${list.map(d => html`<li><button type="button" class="bh-row" data-bh="rec-use-doc" data-id="${d.id}"><span><strong>${DOC_LABELS.facture} ${d.number}</strong><small>${d.clientName} · ${dateFr(d.issueDate)}</small></span><strong>${money(d.totals?.ht ?? 0)} HT</strong></button></li>`)}</ul>` : html`<p class="bh-empty">Aucune facture émise à reprendre.</p>`}`);
    });
  }

  async function generate(id) {
    const s = schedules(data()).find(x => x.id === id);
    if (!s) return;
    const before = JSON.parse(JSON.stringify(s));
    const draft = await generateFromSchedule(store, id, {today: today()});
    // Annuler : le modèle ne revient à l'échéance précédente que si le brouillon a bien été supprimé ; sinon
    // (brouillon émis entre-temps, rôle sans suppression) la période reste facturée et la raison est affichée.
    const canDelete = !store.writeGuard || store.writeGuard({entity: 'integrationImports', action: 'delete', entityId: draft.id, farmKind: draft.farmKind});
    const undo = async () => {
      try { await deleteDraft(store, draft.id); } catch (error) {
        toast(`Brouillon conservé : ${error.message} La période reste facturée ; supprimez le brouillon depuis la facture si besoin.`, 'error');
        if (doc.getElementById('bh-panel')) refresh();
        return;
      }
      await store.upsert('integrationImports', before, {label: 'Génération annulée'}); toast('Brouillon retiré, modèle remis à l’échéance précédente.'); if (doc.getElementById('bh-panel')) refresh();
    };
    if (s.mode !== 'emission') {
      toast(`Brouillon préparé : ${s.label}.`, 'success', canDelete ? {label: 'Annuler', run: undo} : null);
      refresh();
      return draft;
    }
    // Mode « émission » : la facture n'est émise qu'après un clic explicite ici.
    show(box => {
      box.innerHTML = String(html`<h3 class="bh-title">Émettre la facture récurrente ?</h3>
        <p class="bh-lead">${s.label} · ${draft.clientName} · ${money(draft.totals?.ttc ?? 0)} TTC. Le brouillon est prêt ; l’émission attribue le numéro définitif et fige la facture.</p>
        <p class="form-error hidden" role="alert"></p>
        <div class="bh-actions"><button type="button" class="button primary" data-bh="rec-emit" data-id="${draft.id}">Émettre maintenant</button><button type="button" class="button secondary" data-bh="doc" data-id="${draft.id}">Vérifier le brouillon</button><button type="button" class="button secondary" data-bh="back">Garder en brouillon</button></div>`);
      box.querySelector('[data-bh="rec-emit"]')?.focus();
    });
    ctx.lastGenerated = {draft, undo};
    return draft;
  }

  async function handle(action, el) {
    const id = el.dataset.id || '';
    if (action === 'cat-new') show(itemForm(null));
    else if (action === 'cat-edit') { const item = catalogItems(data(), {includeArchived: true}).find(i => i.id === id); if (item) show(itemForm(item)); }
    else if (action === 'cat-import') doc.querySelector('[data-bh-file="catalog"]')?.click();
    else if (action === 'cat-model') downloadModel();
    else if (action === 'cat-import-confirm') await confirmImport();
    else if (action === 'cat-archive') {
      const item = catalogItems(data(), {includeArchived: true}).find(i => i.id === id); if (!item) return;
      await archiveCatalogItem(store, id, !item.archived);
      toast(item.archived ? 'Article réactivé.' : 'Article archivé : il ne sera plus proposé.', 'success', {label: 'Annuler', run: async () => { await archiveCatalogItem(store, id, !!item.archived); if (doc.getElementById('bh-panel')) refresh(); }});
      back();
    } else if (action === 'cat-price-add') {
      const list = el.closest('form')?.querySelector('[data-bh-prices]'); if (!list || !ctx.priceRow) return;
      const node = doc.createElement('template'); node.innerHTML = String(ctx.priceRow({}, list.children.length)); list.append(node.content.firstElementChild);
      list.lastElementChild.querySelector('select')?.focus();
    } else if (action === 'cat-price-remove') { const form = el.closest('form'); el.closest('.bh-price-row')?.remove(); form?.querySelector('[data-bh="cat-price-add"]')?.focus(); }
    else if (action === 'rec-new') show(scheduleForm(null));
    else if (action === 'rec-edit') { const s = schedules(data()).find(x => x.id === id); if (s) show(scheduleForm(s)); }
    else if (action === 'rec-from-doc') pickDocument();
    else if (action === 'rec-use-doc') { const d = store.get('integrationImports', id); if (d) show(scheduleForm(null, scheduleFromDocument(d, {today: today()}))); }
    else if (action === 'rec-toggle') {
      const s = schedules(data()).find(x => x.id === id); if (!s) return;
      await store.upsert('integrationImports', {...s, active: !s.active}, {label: s.active ? `Récurrence suspendue : ${s.label}` : `Récurrence reprise : ${s.label}`});
      toast(s.active ? 'Récurrence suspendue.' : 'Récurrence reprise.', 'success', {label: 'Annuler', run: async () => { await store.upsert('integrationImports', {...store.get('integrationImports', id), active: s.active}); if (doc.getElementById('bh-panel')) refresh(); }});
      refresh();
    } else if (action === 'rec-generate') await generate(id);
    else if (action === 'rec-emit') {
      const box = doc.getElementById('bh-panel');
      try { const issued = await emitDocument(store, id, {today: today()}); toast(`Facture ${issued.number} émise.`, 'success'); back(); }
      catch (error) { fail(box, `Émission impossible : ${error.message} Le brouillon est conservé.`); }
    } else if (action === 'rec-line-add') {
      const list = el.closest('form')?.querySelector('[data-bh-lines]'); if (!list) return;
      const node = doc.createElement('template'); node.innerHTML = String(lineRow({}, list.children.length)); list.append(node.content.firstElementChild);
      list.lastElementChild.querySelector('input')?.focus();
    } else if (action === 'rec-line-remove') {
      const list = el.closest('[data-bh-lines]'); el.closest('[data-bh-line]')?.remove();
      if (list) { if (!list.children.length) { const node = doc.createElement('template'); node.innerHTML = String(lineRow({}, 0)); list.append(node.content.firstElementChild); } renumber(list); list.querySelector('input')?.focus(); }
    }
  }

  return {renderCatalog, renderSchedules, handle, generate, readImport, get preview() { return preview; }};
}
