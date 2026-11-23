// n° 33 : compteurs animés des KPI de l'accueil (logique pure).
export const COUNT_UP_MS = 400;
const easeOut = t => 1 - Math.pow(1 - t, 3);

// Valeur affichée après `elapsed` ms d'une animation de `from` (0 par défaut) à target.
// 10.39 : une valeur qui change (12 → 13) compte depuis l'ancienne, sans repasser par 0.
export function countValue(target, elapsed, duration = COUNT_UP_MS, from = 0) {
  const n = Number(target), start = Number.isFinite(Number(from)) ? Number(from) : 0;
  if (!Number.isFinite(n)) return target;
  if (duration <= 0 || elapsed >= duration) return n;
  return Math.round(start + (n - start) * easeOut(Math.max(0, elapsed) / duration));
}
// Anime seulement un entier positif qui a changé, et jamais en mouvement réduit.
export function shouldCountUp(previous, next, {reduced = false} = {}) {
  if (reduced) return false;
  const n = Number(next);
  return Number.isInteger(n) && n > 0 && String(previous) !== String(next);
}
