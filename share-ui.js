// n° 19 — Boutons « Partager » (data-share="work|observation|day", data-id, data-day) : module différé
// (LAZY_TRIGGERS de lazy-modules.js). Texte formaté par share-text.js, photo de l'observation jointe
// quand le navigateur sait partager des fichiers ; repli : copie dans le presse-papiers et toast.
import {dayShareText, observationPhoto, observationShareText, workShareText} from './share-text.js';

export function createShareUI({store, state, nativeBridge = null, catalog = null, toast, copyText, today, doc = globalThis.document, nav = globalThis.navigator}) {
  const nativeShare = () => Boolean(globalThis.Capacitor?.Plugins?.Share?.share);
  const canSheet = () => nativeShare() || typeof nav?.share === 'function';

  async function photoFile(data, observationId) {
    const photo = observationPhoto(data, observationId);
    if (!photo) return null;
    try {
      const blob = await store.storage?.blobGet?.(photo.id);
      if (!blob) return null;
      const type = photo.mimeType || blob.type || 'image/jpeg';
      return new File([blob], photo.name || `observation.${type.split('/')[1] || 'jpg'}`, {type});
    } catch { return null; }
  }

  // Feuille de partage (application installée ou navigateur), sinon copie du texte.
  async function send({title, text, provisional = false}, file = null) {
    // Le greffon natif attend des chemins de fichiers, pas des objets File : texte seul dans ce cas.
    const files = file && !nativeShare() && nav?.canShare?.({files: [file]}) ? [file] : [];
    if (canSheet()) {
      try {
        if (nativeBridge?.share) await nativeBridge.share({title, text, files});
        else await nav.share({title, text, files: files.length ? files : undefined});
        // Photo prévue mais non jointe (application installée ou navigateur sans partage de fichiers) : le signaler.
        const notes = [file && !files.length ? 'photo non jointe : partagez-la depuis la fiche' : '', provisional ? 'mention « provisoire » : registre phyto à compléter' : ''].filter(Boolean);
        if (notes.length) toast(`Partagé, ${notes.join(' ; ')}.`, 'warning');
        return true;
      } catch (error) { if (error?.name === 'AbortError') return false; }
    }
    const copied = await copyText(text);
    toast(copied ? `Texte copié dans le presse-papiers${file ? ' (photo non jointe)' : ''}${provisional ? ' · mention « provisoire »' : ''}.` : 'Partage et copie indisponibles sur ce navigateur.', copied ? 'success' : 'error');
    return copied;
  }

  async function share(kind, id, day) {
    const data = state(), parcel = parcelId => (data.parcelles || []).find(p => p.id === parcelId && !p.deletedAt) || null;
    if (kind === 'work') {
      const w = store.get('interventions', id);
      if (!w) return toast('Travail introuvable.', 'error');
      const equipment = w.equipmentId ? store.get('materiels', w.equipmentId) : null;
      return send(workShareText(w, {parcel: parcel(w.parcelId), equipment, state: data, catalog}));
    }
    if (kind === 'observation') {
      const o = store.get('observations', id);
      if (!o) return toast('Observation introuvable.', 'error');
      return send(observationShareText(o, {parcel: parcel(o.parcelId)}), await photoFile(data, o.id));
    }
    if (kind === 'day') return send(dayShareText(data, day || today(), {catalog}));
  }

  doc?.addEventListener('click', event => {
    const b = event.target?.closest?.('[data-share]');
    if (!b) return;
    event.preventDefault();
    if (b.dataset.shareBusy) return;
    b.dataset.shareBusy = '1';
    Promise.resolve(share(b.dataset.share, b.dataset.id, b.dataset.day))
      .catch(error => toast(error?.message || 'Partage impossible.', 'error'))
      .finally(() => { delete b.dataset.shareBusy; });
  });

  return {share, send};
}
