// n° 33 : les chiffres des cartes KPI comptent de 0 à N en 400 ms (sauté en mouvement réduit).
import {countValue, shouldCountUp, COUNT_UP_MS} from './count-up.js';

export function createCountUpUI({win = globalThis.window} = {}) {
  const last = new Map();
  const reduced = () => Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  function run(root) {
    if (!root) return;
    for (const card of root.querySelectorAll('[data-target]')) {
      const strong = card.querySelector('strong'), key = card.dataset.target;
      if (!strong) continue;
      const target = strong.textContent.trim(), previous = last.get(key);
      last.set(key, target);
      // Première ouverture ou nouvelle valeur : on compte ; un simple rafraîchissement ne rejoue rien.
      if (!shouldCountUp(previous, target, {reduced: reduced()}) || !win?.requestAnimationFrame) continue;
      const start = win.performance?.now?.() ?? Date.now();
      strong.textContent = '0'; strong.dataset.counting = '1';
      const step = time => {
        if (!strong.isConnected) return;
        const elapsed = time - start;
        strong.textContent = String(countValue(target, elapsed, COUNT_UP_MS));
        if (elapsed < COUNT_UP_MS) win.requestAnimationFrame(step); else { strong.textContent = target; delete strong.dataset.counting; }
      };
      win.requestAnimationFrame(step);
    }
  }
  return {run};
}
