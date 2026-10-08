// Célébration sobre quand on coche un travail : logique pure, testable sans navigateur.
export const CELEBRATION_KEY = 'parcelles:day-celebrated';
export const CELEBRATION_WINDOW_MS = 4000;

export function dayCompletion({done = 0, total = 0} = {}) {
  const d = Math.max(0, Number(done) || 0), t = Math.max(0, Number(total) || 0);
  return {done: d, total: t, pct: t ? Math.round(Math.min(d, t) / t * 100) : 0, complete: t > 0 && d >= t};
}

export function formatHa(value) {
  const n = Math.max(0, Number(value) || 0);
  return n.toLocaleString('fr-FR', {maximumFractionDigits: 2});
}

// « 0,5 ha travaillé », « 1 ha travaillé », « 19,5 ha travaillés » : le pluriel commence à 2.
export function completeLabel(area) {
  const n = Math.max(0, Number(area) || 0);
  if (!n) return 'Journée bouclée · tout est fait';
  return `Journée bouclée · ${formatHa(n)} ha ${n >= 2 ? 'travaillés' : 'travaillé'}`;
}

// L’éclosion ne se joue qu’après un geste de l’utilisateur, sur un travail, une seule fois par jour.
export function shouldBloom({complete, pending, today, lastCelebrated, now = Date.now()}) {
  return Boolean(complete && pending && pending.kind === 'work'
    && now - (pending.at || 0) <= CELEBRATION_WINDOW_MS && lastCelebrated !== today);
}

export function pendingIsFresh(pending, now = Date.now()) {
  return Boolean(pending && now - (pending.at || 0) <= CELEBRATION_WINDOW_MS);
}

// 7 feuilles réparties en éventail vers le haut, de façon déterministe (pas d’aléa visible d’un jour à l’autre).
export function leafLayout(count = 7) {
  const n = Math.max(6, Math.min(8, Math.round(Number(count) || 7)));
  return Array.from({length: n}, (_, i) => {
    const angle = -160 + (140 / (n - 1)) * i;
    const rad = angle * Math.PI / 180;
    const distance = 34 + (i % 3) * 9;
    return {
      x: Math.round(Math.cos(rad) * distance * 10) / 10,
      y: Math.round(Math.sin(rad) * distance * 10) / 10,
      rotate: Math.round(angle + 90 + (i % 2 ? 25 : -25)),
      delay: i * 24
    };
  });
}
