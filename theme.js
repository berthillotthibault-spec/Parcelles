// n° 32 : thème Auto / Clair / Sombre / Cabine de nuit (logique pure).
export const THEMES = [
  {id: 'system', label: 'Auto'},
  {id: 'light', label: 'Clair'},
  {id: 'dark', label: 'Sombre'},
  {id: 'night', label: 'Cabine de nuit'}
];
export function normalizeTheme(value) {
  return THEMES.some(item => item.id === value) ? value : 'system';
}
// Thème affiché : sombre ou non, et variante de nuit (luminosité réduite, rouges atténués).
export function resolveTheme(preference, systemDark = false) {
  const theme = normalizeTheme(preference);
  const dark = theme === 'dark' || theme === 'night' || (theme === 'system' && Boolean(systemDark));
  return {theme, dark, night: theme === 'night'};
}
// Couleur de la barre du navigateur, alignée sur le fond (--bg).
export function themeColor({dark, night}) {
  return night ? '#0a0d0b' : dark ? '#0f1411' : '#f7f5f0';
}
// Bascule rapide (palette de commandes) : clair ↔ sombre selon ce qui est affiché.
export function toggledTheme(preference, systemDark = false) {
  return resolveTheme(preference, systemDark).dark ? 'light' : 'dark';
}
