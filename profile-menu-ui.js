// Menu profil (n° 160) : feuille du bas ouverte par la pastille de profil, l'entrée « Modules » de la barre
// latérale et tout ancien lien vers « Plus ». Elle s'appuie sur modal() (feuille du bas sous 720 px :
// fermeture par le fond, la croix et Échap). Les lignes portent les mêmes data-action qu'avant : le délégué
// de clics d'app.js les traite. Module différé (clé profileMenu de lazy-modules.js).
import {html, raw} from './safe-html.js';
import {icon} from './ui.js';
import {buildProfileMenu, farmSummary} from './profile-menu.js';
import {herdSummary} from './herd.js';
import {filterGrazingSessions, grazingTotal} from './grazing.js';
import {profileInitials} from './nav-model.js';

export function createProfileMenuUI({state, modal, catalog, visible, footerHtml, livestock, isDark, setDark, doc = document}) {
  let query = '';
  const root = () => doc.querySelector('#modal-root .profile-menu');

  function counts(data) {
    const parcels = (data.parcelles || []).filter(p => !p.deletedAt && !p.archived);
    const area = parcels.reduce((sum, p) => sum + (Number(p.surfaceHa) || 0), 0);
    let animals = 0;
    if (livestock()) {
      animals = herdSummary(data).present;
      if (!animals) animals = filterGrazingSessions(data.grazingSessions || [], {status: 'current'}).reduce((sum, s) => sum + grazingTotal(s), 0);
    }
    return {area, parcels: parcels.length, animals, first: parcels[0]};
  }

  function rowHtml(item, first) {
    const desc = item.action === 'open-assistant' ? (first ? `« Qu’est-ce que je sème sur ${first.nom} ? »` : '« Résume ma journée »') : item.desc;
    const target = item.view ? html`data-view="${item.view}"` : html`data-action="${item.action}"`;
    return html`<button class="menu-row" ${target}><span>${raw(icon(item.icon, {size: 19}))}</span><span><strong>${item.title}</strong><small>${desc}</small></span><b aria-hidden="true">›</b></button>`;
  }

  function groupsHtml() {
    const first = counts(state()).first;
    const groups = buildProfileMenu(catalog(), {visible, query});
    if (!groups.length) return html`<p class="pm-empty">Aucun outil ne correspond à « ${query} ».</p>`;
    return groups.map(group => html`<section class="pm-group" aria-labelledby="pm-group-${group.id}"><h3 id="pm-group-${group.id}" class="pm-group-title">${group.title}</h3><div class="menu-list">${group.items.map(item => rowHtml(item, first))}</div></section>`);
  }

  function switchHtml() {
    const on = isDark();
    return html`<button type="button" class="pm-dark" data-pm="dark" role="switch" aria-checked="${on ? 'true' : 'false'}"><span><strong>Mode sombre</strong><small>Pour le matin tôt et le soir</small></span><span class="pm-switch" aria-hidden="true"><span></span></span></button>`;
  }

  function render() {
    const menu = root();
    if (!menu) return;
    const list = menu.querySelector('#pm-groups');
    if (list) list.innerHTML = String(html`${groupsHtml()}`);
    const note = menu.querySelector('#pm-modules-note');
    if (note) note.innerHTML = footerHtml() || '';
  }

  function open() {
    const data = state();
    const name = data.exploitation?.nom || 'Mon exploitation';
    query = '';
    const build = doc.getElementById('build-label')?.textContent || '';
    const body = html`<div class="profile-menu">
      ${switchHtml()}
      <label class="pm-search"><span class="sr-only">Rechercher un outil</span>${raw(icon('search', {size: 18}))}<input id="pm-search" type="search" placeholder="Rechercher un outil" autocomplete="off" enterkeyhint="search"></label>
      <div id="pm-groups">${groupsHtml()}</div>
      <div id="pm-modules-note" class="pm-note">${raw(footerHtml() || '')}</div>
      <p class="pm-build">${build}</p>
    </div>`;
    modal(name, farmSummary(counts(data)), String(body), '', 'profile-sheet');
    const dialog = doc.querySelector('#modal-root .modal.profile-sheet');
    if (!dialog) return;
    const chip = doc.createElement('span');
    chip.className = 'profile-chip pm-chip';
    chip.setAttribute('aria-hidden', 'true');
    chip.textContent = profileInitials(name);
    dialog.querySelector('.modal-header')?.prepend(chip);
    dialog.querySelector('#pm-search')?.addEventListener('input', event => { query = event.target.value; render(); });
    dialog.querySelector('.profile-menu')?.addEventListener('click', async event => {
      const button = event.target.closest('[data-pm="dark"]');
      if (!button) return;
      await setDark(!isDark());
      button.outerHTML = String(switchHtml());
      dialog.querySelector('[data-pm="dark"]')?.focus({preventScroll: true});
    });
  }

  return {open, refresh: render, isOpen: () => Boolean(root())};
}
