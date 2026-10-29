// @ts-check
// Feuilles du bas (n° 160) : glisser la poignée ou l'en-tête vers le bas ferme la fenêtre, en plus de la croix,
// du fond et d'Échap. Seulement quand modal() s'affiche en feuille du bas (écran étroit) ; le contenu qui défile
// n'est pas concerné. Logique de décision pure (sheetDragOutcome), branchement DOM dans attachSheetSwipe.

export const SWIPE_CLOSE_PX = 90;
export const SWIPE_ZONE_PX = 56;

/**
 * Décision à la fin d'un glissé : fermer si l'on est descendu assez loin, ou vite.
 * @param {{dy: number, ms: number}} drag
 */
export function sheetDragOutcome({dy, ms}) {
  if (dy >= SWIPE_CLOSE_PX) return 'close';
  if (dy > 30 && ms > 0 && dy / ms > 0.6) return 'close';
  return 'stay';
}

/**
 * @param {HTMLElement|null} root #modal-root
 * @param {() => void} close closeModal
 * @param {{win?: Window}} [options]
 */
export function attachSheetSwipe(root, close, {win = window} = {}) {
  if (!root) return;
  const narrow = () => Boolean(win.matchMedia?.('(max-width: 720px)').matches);
  /** @type {{sheet: HTMLElement, y: number, t: number, id: number}|null} */
  let drag = null;
  root.addEventListener('pointerdown', event => {
    const target = /** @type {HTMLElement} */ (event.target);
    const sheet = /** @type {HTMLElement|null} */ (target.closest?.('.modal'));
    if (!sheet || !narrow() || event.button > 0) return;
    if (target.closest('button, a, input, select, textarea, label, [contenteditable]')) return;
    const inZone = event.clientY - sheet.getBoundingClientRect().top <= SWIPE_ZONE_PX || target.closest('.modal-header, .qw-head');
    if (!inZone) return;
    drag = {sheet, y: event.clientY, t: event.timeStamp, id: event.pointerId};
    sheet.style.transition = 'none';
    try { sheet.setPointerCapture?.(event.pointerId); } catch { /* pointeur déjà relâché */ }
  });
  root.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dy = Math.max(0, event.clientY - drag.y);
    drag.sheet.style.transform = dy ? `translateY(${dy}px)` : '';
  });
  const end = event => {
    if (!drag || event.pointerId !== drag.id) return;
    const {sheet, y, t} = drag;
    drag = null;
    const outcome = sheetDragOutcome({dy: Math.max(0, event.clientY - y), ms: event.timeStamp - t});
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (outcome === 'close' && event.type === 'pointerup') close();
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}
