// n° 121 — Fichiers reçus d'autres applications : boîte de réception IndexedDB (partage) et
// launchQueue (« Ouvrir avec »), puis tri « C'est quoi ? » vers l'importeur existant ou les Documents.
import {INBOX_DB, INBOX_STORE, validateIncoming, guessKinds, kindAccepts, SHARE_KINDS, DOCUMENT_CATEGORY} from './share-target.js';
import {escapeHtml as e, uid} from './utils.js';

const pad = n => String(n).padStart(2, '0');
const isoToday = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const size = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

export function createShareTargetUI({store, modal, closeModal, toast, bindChipChoices = () => {}, importParcels, importTracks, stockCapture, doc = globalThis.document, win = globalThis.window} = {}) {
  function inboxDb() {
    return new Promise((resolve, reject) => {
      const r = win.indexedDB.open(INBOX_DB, 1);
      r.onupgradeneeded = () => {if (!r.result.objectStoreNames.contains(INBOX_STORE)) r.result.createObjectStore(INBOX_STORE, {keyPath: 'id'});};
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  }
  async function inbox({clear = false} = {}) {
    const db = await inboxDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(INBOX_STORE, 'readwrite'), os = tx.objectStore(INBOX_STORE), req = os.getAll();
        let rows = [];
        req.onsuccess = () => {rows = req.result || []; if (clear) os.clear();};
        tx.oncomplete = () => resolve(rows); tx.onerror = () => reject(tx.error);
      });
    } finally {db.close();}
  }
  const asFile = row => (row.blob instanceof win.File ? row.blob : new win.File([row.blob], row.name, {type: row.type || row.blob?.type || ''}));

  async function init() {
    const url = new URL(win.location.href);
    if (url.searchParams.has('inbox')) {
      const rejectedCount = Number(url.searchParams.get('rejected') || 0);
      url.searchParams.delete('inbox'); url.searchParams.delete('n'); url.searchParams.delete('rejected');
      win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash);
      try {
        const rows = await inbox({clear: true});
        if (rows.length) triage(rows.map(asFile), {rejectedCount});
        else if (rejectedCount) toast(`${rejectedCount} fichier${rejectedCount > 1 ? 's' : ''} refusé${rejectedCount > 1 ? 's' : ''} : type ou taille non pris en charge.`, 'error');
      } catch (error) {console.warn('[Parcelles] fichiers partagés', error); toast('Fichiers partagés illisibles.', 'error');}
    }
    if (url.searchParams.get('open') === 'files') {url.searchParams.delete('open'); win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash);}
    if ('launchQueue' in win && win.launchQueue?.setConsumer) {
      win.launchQueue.setConsumer(async params => {
        if (!params?.files?.length) return;
        try {triage(await Promise.all(params.files.map(h => h.getFile())));} catch (error) {console.warn('[Parcelles] ouverture de fichier', error);}
      });
    }
  }

  function triage(files, {rejectedCount = 0} = {}) {
    const {accepted, rejected} = validateIncoming(files);
    if (!accepted.length) {toast(`Aucun fichier utilisable : ${rejected.map(r => `${r.name} (${r.reason})`).join(', ') || 'type non pris en charge'}.`, 'error'); return;}
    const kinds = guessKinds(accepted);
    const all = [...kinds, ...Object.keys(SHARE_KINDS).filter(k => !kinds.includes(k))];
    modal('C’est quoi ?', `${accepted.length} fichier${accepted.length > 1 ? 's' : ''} reçu${accepted.length > 1 ? 's' : ''}. Choisissez sa nature : Parcelles l’oriente vers le bon import.`,
      `<form id="share-triage-form" class="form-grid"><ul class="share-files span-2">${accepted.map(f => `<li><strong>${e(f.name)}</strong><small>${size(f.size)}</small></li>`).join('')}</ul>
      ${rejected.length || rejectedCount ? `<p class="notice warning span-2">Refusés : ${rejected.map(r => `${e(r.name)} (${e(r.reason)})`).join(', ')}${rejectedCount ? `${rejected.length ? ', ' : ''}${rejectedCount} fichier${rejectedCount > 1 ? 's' : ''} au partage` : ''}.</p>` : ''}
      <div class="field-label span-2"><span>Nature *</span><input type="hidden" name="kind" value="${e(kinds[0])}"><div class="chip-choices share-kinds" data-chip-target="kind">${all.map(k => `<button type="button" class="choice-chip${k === kinds[0] ? ' is-on' : ''}" data-value="${k}">${e(SHARE_KINDS[k].label)}</button>`).join('')}</div></div>
      <p class="share-hint span-2" id="share-kind-hint">${e(SHARE_KINDS[kinds[0]].hint)}</p><p class="form-error span-2" hidden></p></form>`,
      '<button class="button secondary" data-action="close-modal">Ignorer</button><button class="button primary" id="share-triage-go">Continuer</button>');
    const form = doc.getElementById('share-triage-form');
    bindChipChoices(form);
    form.querySelector('.share-kinds').addEventListener('click', () => queueMicrotask(() => {doc.getElementById('share-kind-hint').textContent = SHARE_KINDS[form.elements.kind.value]?.hint || '';}));
    doc.getElementById('share-triage-go').onclick = async () => {
      const kind = form.elements.kind.value, err = form.querySelector('.form-error');
      const usable = accepted.filter(f => kindAccepts(kind, f));
      if (!usable.length) {err.textContent = `Ces fichiers ne correspondent pas à « ${SHARE_KINDS[kind].label} ».`; err.hidden = false; return;}
      err.hidden = true;
      await route(kind, usable);
    };
  }

  async function route(kind, files) {
    if (kind === 'contour') {closeModal(); return importParcels(files);}
    if (kind === 'trace') {closeModal(); return importTracks(files);}
    if (kind === 'facture' && files.length === 1 && /^image\//.test(files[0].type) && stockCapture) {closeModal(); return stockCapture.open({file: files[0]});}
    const category = DOCUMENT_CATEGORY[kind] || 'Autre';
    for (const file of files) {
      const id = uid('doc');
      await store.storage.blobPut(id, file);
      await store.upsert('documents', {id, name: file.name, mimeType: file.type || '', size: file.size, category, documentDate: isoToday(), tags: kind === 'ordonnance' ? ['ordonnance'] : [], note: 'Reçu depuis une autre application.', origin: 'share-target'}, {label: `Document reçu : ${file.name}`});
    }
    closeModal();
    toast(`${files.length} document${files.length > 1 ? 's' : ''} rangé${files.length > 1 ? 's' : ''} dans Documents (${category}).`, 'success');
  }

  return {init, triage, route};
}
