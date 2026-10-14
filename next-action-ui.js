// n° 28 - Carte « Prochaine action » enrichie : compte à rebours (mis à jour chaque minute),
// pastille météo du créneau, vignette du contour de la parcelle, action suivante et retournement
// de la carte après « Marquer comme fait ». Lecture seule : aucune donnée n'est écrite.
import {animateElement} from './motion.js';
import {cachedSilhouette} from './parcel-silhouette.js';
import {countdownLabel, msToNextMinute, pickFollowing, followingLabel, weatherChip} from './next-action.js';

const THUMB = 44;
const FLIP_MS = 5000;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const initials = name => String(name || '').trim().split(/\s+/).filter(w => w.length > 2 || /^[A-ZÀ-Ý]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'P';

function thumbHtml(parcel) {
  if (!parcel) return '';
  const d = cachedSilhouette(parcel, THUMB);
  if (!d) return `<span class="next-thumb is-empty" aria-hidden="true">${esc(initials(parcel.nom))}</span>`;
  return `<span class="next-thumb" aria-hidden="true"><svg viewBox="0 0 ${THUMB} ${THUMB}" width="${THUMB}" height="${THUMB}" focusable="false"><path d="${d}" fill-rule="evenodd"/></svg></span>`;
}

// Jour civil local : au passage de minuit, onDayChange() redessine la carte (étiquette « À FAIRE
// AUJOURD’HUI », « Ensuite : … aujourd’hui ») au lieu de garder celles de la veille (vague 9).
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function createNextActionUI({doc = globalThis.document, win = globalThis, onDayChange = null} = {}) {
  let timer = 0, current = null, flip = null;
  const reduced = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

  function stop() {
    if (timer) win.clearTimeout(timer);
    timer = 0;
  }
  function tick() {
    timer = 0;
    const now = new Date();
    if (!current?.root?.isConnected || doc.documentElement.dataset.view && doc.documentElement.dataset.view !== 'today') return;
    if (onDayChange && current.day !== dayKey(now)) {current = null; onDayChange(); return;}
    const node = current.root.querySelector('.next-countdown');
    if (node && current.entry) {
      const text = countdownLabel(current.entry, now);
      node.textContent = text;
      node.hidden = !text;
    }
    timer = win.setTimeout(tick, msToNextMinute(now));
  }
  function schedule() {
    stop();
    if (current?.root && (onDayChange || current.root.querySelector('.next-countdown'))) timer = win.setTimeout(tick, msToNextMinute(new Date()));
  }

  // Appelé au clic sur « Marquer comme fait », avant l'enregistrement.
  function armFlip(control, id) {
    flip = control?.closest?.('#next-action') ? {id: String(id || ''), at: Date.now()} : null;
  }

  function runFlip(card, entry) {
    const armed = flip;
    if (!armed || Date.now() - armed.at > FLIP_MS) {flip = null; return;}
    // Le rendu juste après le clic montre encore l'action cochée : attendre l'action suivante.
    if (entry && String(entry.item?.id) === armed.id) return;
    flip = null;
    if (reduced()) {card.dataset.flip = 'skip'; return;}
    card.dataset.flip = 'anim';
    animateElement(card, [
      {transform: 'perspective(900px) rotateX(-88deg)', opacity: .35},
      {transform: 'perspective(900px) rotateX(8deg)', opacity: 1, offset: .7},
      {transform: 'perspective(900px) rotateX(0deg)', opacity: 1}
    ], {duration: 520, easing: 'cubic-bezier(.2,.7,.2,1)'});
  }

  // Enrichit la carte rendue par app.js. `next` est l'entrée d'agenda affichée (ou null).
  function enhance(root, {next = null, entries = [], parcel = null, weather = null, today = '', now = new Date()} = {}) {
    const card = root?.querySelector?.('.next-action-card');
    if (!card) {stop(); current = null; return;}
    if (!next) {current = {root, entry: null, day: dayKey(now)}; schedule(); runFlip(card, null); return;}
    const text = card.querySelector(':scope > span');
    if (text && !card.querySelector('.next-action-head')) {
      const head = doc.createElement('div');
      head.className = 'next-action-head';
      card.insertBefore(head, text);
      head.append(text);
      head.insertAdjacentHTML('beforeend', thumbHtml(parcel));
    }
    const countdown = countdownLabel(next, now);
    const chip = weatherChip(weather, next, {today, now});
    if (text && (countdown || chip)) {
      text.insertAdjacentHTML('beforeend', `<span class="next-meta"><span class="next-countdown"${countdown ? '' : ' hidden'}>${esc(countdown)}</span>${chip ? `<span class="next-weather is-${chip.tone}" title="${esc(chip.title)}"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">${chip.tone === 'rain' ? '<path d="M4.5 10.5a3 3 0 1 1 .6-5.9A4 4 0 0 1 12.8 6a2.3 2.3 0 0 1-.3 4.5z"/><path d="M6 12.5l-.7 1.6M9 12.5l-.7 1.6"/>' : '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>'}</svg>${esc(chip.label)}</span>` : ''}</span>`);
    }
    const following = pickFollowing(entries, next);
    if (following) card.insertAdjacentHTML('beforeend', `<p class="next-following"><span class="next-following-label">Ensuite :</span> <span class="next-following-text">${esc(followingLabel(following, today))}</span></p>`);
    current = {root, entry: next, day: dayKey(now)};
    schedule();
    runFlip(card, next);
  }

  // Changement de vue : le minuteur s'arrête hors d'Aujourd'hui et reprend au retour.
  function view(name) {
    if (name !== 'today') {stop(); return;}
    if (current?.root?.isConnected) tick();
  }

  return {enhance, stop, view, armFlip, get running() {return Boolean(timer);}};
}
