// n° 32 : application du thème sur <html> et suivi du réglage système en mode Auto.
import {resolveTheme, themeColor} from './theme.js';

export function createThemeUI({doc = globalThis.document, win = globalThis.window, onSystemChange = () => {}} = {}) {
  const query = win?.matchMedia?.('(prefers-color-scheme: dark)');
  let current = 'system';
  query?.addEventListener?.('change', () => { if (current === 'system') { apply(current); onSystemChange(); } });
  function apply(preference) {
    const resolved = resolveTheme(preference, query?.matches);
    current = resolved.theme;
    const root = doc.documentElement;
    root.dataset.theme = resolved.theme;
    root.classList.toggle('theme-dark', resolved.dark);
    root.classList.toggle('theme-night', resolved.night);
    root.style.colorScheme = resolved.dark ? 'dark' : 'light';
    doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor(resolved));
    return resolved;
  }
  return {apply, systemDark: () => Boolean(query?.matches)};
}
