// n° 33 : compteurs animés des KPI de l'accueil (logique pure).
export const COUNT_UP_MS = 400;
const easeOut = t => 1 - Math.pow(1 - t, 3);

// Valeur affichée après `elapsed` ms d'une animation de 0 à target.
export function countValue(target, elapsed, duration = COUNT_UP_MS) {
  const n = Number(target);
  if (!Number.isFinite(n)) return target;
  if (duration <= 0 || elapsed >= duration) return n;
  return Math.round(n * easeOut(Math.max(0, elapsed) / duration));
}
// Anime seulement un entier positif qui a changé, et jamais en mouvement réduit.
export function shouldCountUp(previous, next, {reduced = false} = {}) {
  if (reduced) return false;
  const n = Number(next);
  return Number.isInteger(n) && n > 0 && String(previous) !== String(next);
}
