// n° 116 : interface « Choisir mes activités » (pastilles) et filtre des outils de Plus.
import {ACTIVITY_MODULES, normalizeActiveModules, isToolVisible, isModuleActive} from './activity-modules.js';
import {escapeHtml as esc} from './utils.js';

// Pastilles à choix multiple ; toutes cochées quand activeModules vaut 'all'.
export function activityChipsHtml(activeModules, {label = 'Que faites-vous sur l’exploitation ?'} = {}) {
  const active = normalizeActiveModules(activeModules);
  return `<div class="activity-chips chip-choices" role="group" aria-label="${esc(label)}">${ACTIVITY_MODULES.map(item => {
    const on = active === 'all' || active.includes(item.id);
    return `<button type="button" class="choice-chip activity-chip" data-activity="${item.id}" aria-pressed="${on}"><span><strong>${esc(item.label)}</strong><small>${esc(item.detail)}</small></span></button>`;
  }).join('')}</div>`;
}
export function bindActivityChips(root, onChange = () => {}) {
  root?.addEventListener('click', event => {
    const chip = event.target.closest('[data-activity]');
    if (!chip || !root.contains(chip)) return;
    chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
    onChange(readActivityChips(root));
  });
}
export function readActivityChips(root) {
  const chips = [...(root?.querySelectorAll('[data-activity]') || [])];
  return normalizeActiveModules(chips.filter(chip => chip.getAttribute('aria-pressed') === 'true').map(chip => chip.dataset.activity));
}

export function createActivityModulesUI({getPreferences}) {
  let showAll = false;
  const active = () => showAll ? 'all' : normalizeActiveModules(getPreferences()?.activeModules);
  return {
    active,
    isFiltered: () => normalizeActiveModules(getPreferences()?.activeModules) !== 'all',
    showingAll: () => showAll,
    setShowAll(value) { showAll = Boolean(value); },
    visible: action => isToolVisible(action, active()),
    moduleActive: id => isModuleActive(id, active()),
    filter: (items, getAction) => (items || []).filter(item => isToolVisible(getAction ? getAction(item) : item[2], active())),
    // Lien en bas de Plus : n'apparaît que si le profil masque des outils.
    footerHtml(hiddenCount) {
      if (normalizeActiveModules(getPreferences()?.activeModules) === 'all') return '';
      const names = normalizeActiveModules(getPreferences()?.activeModules);
      const labels = ACTIVITY_MODULES.filter(item => names.includes(item.id)).map(item => item.label);
      const summary = labels.length ? `Outils affichés pour : ${labels.join(', ')}.` : 'Seuls les outils communs sont affichés.';
      return `<div class="more-modules-note"><p>${esc(summary)} Modifiez vos activités dans <button class="text-button" data-action="personalize">Personnaliser</button>.</p>${showAll ? '<button class="button secondary" data-action="more-modules-filter">Revenir à mes activités</button>' : `<button class="button secondary" data-action="more-show-all-tools">Afficher tous les outils${hiddenCount ? ` (${hiddenCount} masqué${hiddenCount > 1 ? 's' : ''})` : ''}</button>`}</div>`;
    }
  };
}
