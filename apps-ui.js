// Applis dans l'appli (n° 161) : lanceur, barre du bas propre à chaque appli, page d'une appli (#app/<id>)
// et pastille de retour après une bascule automatique. La logique (liste, bascule, écran d'ouverture) est
// dans apps.js. Champs garde la barre n° 160 : ce module ne l'affiche ni ne la modifie, il la masque
// seulement (html[data-app]) quand une autre appli est ouverte.
import {html, raw} from './safe-html.js';
import {icon} from './ui.js';
import {formatEuro} from './utils.js';
import {APPS, DEFAULT_APP, LAST_APP_KEY, ALERT_RULES, appAlerts, appById, appTools, billingSummary, tpSummary, normalizeAppId, returnChip, startScreen, switchTarget, visibleApps} from './apps.js';

export function createAppsUI({doc = document, catalog, isVisible, livestock, switchView, currentView, modal, closeModal, readLocal, writeLocal, routeHash, goRoute, alerts = () => [], billingTodo = async () => null, tpProjects = () => []}) {
  let current = DEFAULT_APP;
  /** Appli et adresse quittées lors d'une bascule automatique : {app, hash} ou null. */
  let back = null;

  const visibleIds = () => visibleApps({isVisible, livestock: livestock()}).map(app => app.id);
  const app = () => appById(current);
  const homeView = id => appById(id).home;

  function tabHtml(tab, {desktop = false} = {}) {
    const target = tab.view ? html`data-view="${tab.view}"` : html`data-action="${tab.action}"${tab.tab ? html` data-tab="${tab.tab}"` : ''}`;
    const bar = desktop ? '' : html`<span class="nav-bar" aria-hidden="true"></span>`;
    return html`<button class="nav-item" ${target}>${bar}${raw(icon(tab.icon, {size: 22}))}<small>${tab.label}</small></button>`;
  }

  function navHtml() {
    const a = app(), tabs = a.tabs;
    const plus = a.plus ? html`<button class="nav-plus" data-action="${a.plus.action}" aria-label="${a.plus.label}">${raw(icon('plus', {size: 24}))}</button>` : '';
    const half = Math.ceil(tabs.length / 2);
    return html`${tabs.slice(0, half).map(t => tabHtml(t))}${plus}${tabs.slice(half).map(t => tabHtml(t))}`;
  }

  function desktopNavHtml() {
    const a = app();
    const plus = a.plus ? html`<button class="button primary sidebar-new-work" data-action="${a.plus.action}">${raw(icon('plus', {size: 20}))}<span>${a.plus.label}</span></button>` : '';
    return html`${plus}${a.tabs.map(t => tabHtml(t, {desktop: true}))}`;
  }

  function sidebarAppsHtml() {
    const ids = visibleIds();
    return html`${APPS.filter(a => ids.includes(a.id)).map(a => html`<button class="sidebar-app${a.id === current ? ' is-on' : ''}" data-action="switch-app" data-app="${a.id}" style="--app-color:${a.color}"${a.id === current ? raw(' aria-current="true"') : ''} title="${a.title}"><span class="sidebar-app-icon" aria-hidden="true">${raw(icon(a.icon, {size: 18}))}</span><span>${a.title}</span></button>`)}`;
  }

  function chipHtml() {
    if (!back) return '';
    const chip = returnChip(back.app);
    return html`<button type="button" class="app-return" data-action="app-return">${raw(icon('back', {size: 16}))}<span>${chip.label}</span></button>`;
  }

  /** Met à jour tout ce qui dépend de l'appli courante (barres, en-tête, pastille). */
  function apply() {
    const a = app(), root = doc.documentElement;
    root.dataset.app = a.id;
    root.style.setProperty('--app-color', a.color);
    const nav = doc.getElementById('app-nav');
    if (nav) { nav.innerHTML = a.id === DEFAULT_APP ? '' : String(navHtml()); nav.dataset.count = String(a.tabs.length + (a.plus ? 1 : 0)); }
    const side = doc.getElementById('sidebar-app-nav');
    if (side) side.innerHTML = a.id === DEFAULT_APP ? '' : String(desktopNavHtml());
    const apps = doc.getElementById('sidebar-apps');
    if (apps) apps.innerHTML = String(sidebarAppsHtml());
    doc.querySelectorAll('[data-app-title]').forEach(el => { el.textContent = a.id === DEFAULT_APP ? 'Parcelles' : a.title; });
    // n° 162 : la tuile de marque reprend l’icône de l’appli affichée (carte pour Champs).
    doc.querySelectorAll('.desktop-brand .brand-mark').forEach(el => { el.innerHTML = icon(a.id === DEFAULT_APP ? 'map' : a.icon, {size: 22}); });
    doc.querySelectorAll('[data-app-return]').forEach(el => { el.innerHTML = String(chipHtml()); el.hidden = !back; });
    markActive(currentView());
    if (currentView() === 'space') renderSpace();
  }

  /** Onglet actif de la barre de l'appli (les onglets qui ouvrent un outil ne le sont jamais). */
  function markActive(view) {
    doc.querySelectorAll('#app-nav .nav-item, #sidebar-app-nav .nav-item').forEach(el => {
      const on = Boolean(el.dataset.view) && el.dataset.view === view;
      el.classList.toggle('is-active', on);
      if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
  }

  function setApp(id, {from = null} = {}) {
    id = normalizeAppId(id);
    if (from) back = {app: current, hash: from};
    else if (back && back.app === id) back = null;
    current = id;
    writeLocal(LAST_APP_KEY, id);
    apply();
  }

  /** Ouvre une appli depuis le lanceur ou la barre latérale : pas de pastille, on arrive sur son accueil. */
  function open(id) {
    id = normalizeAppId(id);
    if (!visibleIds().includes(id)) id = DEFAULT_APP;
    closeModal();
    back = null;
    setApp(id);
    switchView(homeView(id));
  }

  /**
   * Bascule automatique, avant l'exécution d'un clic : l'action ou la vue relève-t-elle d'une autre appli ?
   * Si oui, l'appli change, l'adresse quittée est retenue pour la pastille, et une action qui ouvre une
   * fenêtre s'ouvre par-dessus l'accueil de la nouvelle appli.
   * @returns {boolean} vrai si l'appli a changé
   */
  function follow({action = '', view = ''}) {
    const target = switchTarget({action, view}, current, {visibleIds: visibleIds()});
    if (!target) return false;
    const from = routeHash();
    const hist = doc.defaultView?.history, len = hist?.length;
    setApp(target, {from});
    if (action && !view) switchView(homeView(target));
    // Une fois le clic traité (la vue y est ouverte par le délégué d'app.js), marque l'entrée d'historique créée
    // juste après « from » : goBack pourra y revenir par history.back() au lieu de dupliquer l'entrée.
    const mark = back;
    if (hist && mark) queueMicrotask(() => {
      if (back !== mark || hist.length !== len + 1 || routeHash() === from) return;
      mark.token = `apps-back-${Date.now()}`;
      try { hist.replaceState({...(hist.state || {}), appsBack: mark.token}, '', doc.defaultView.location.href); } catch { mark.token = null; }
    });
    return true;
  }

  /** Vue affichée par n'importe quel chemin (retour arrière, lien) : l'appli suit sans pastille. */
  function syncView(view) {
    if (view !== 'space') {
      const target = switchTarget({view}, current, {visibleIds: visibleIds()});
      if (target) { setApp(target); return; }
    }
    markActive(view);
    if (view === 'space') renderSpace();
  }

  /** Pastille « Retour à … » : revient à l'appli et à l'écran quittés, en reculant d'une entrée d'historique
   *  quand c'est possible, sinon en remplaçant l'entrée (le retour arrière du navigateur ne rouvre pas l'appli quittée). */
  function goBack() {
    if (!back) return;
    const {app: id, hash, token} = back;
    back = null;
    closeModal();
    if (!visibleIds().includes(id)) { setApp(DEFAULT_APP); switchView(homeView(DEFAULT_APP)); return; }
    setApp(id);
    // Toujours sur l'entrée ouverte par la bascule : on recule d'un pas (popstate affiche l'écran quitté),
    // sinon l'entrée remplacée laisserait un doublon qui rendrait le retour arrière suivant sans effet.
    const hist = doc.defaultView?.history;
    if (token && hist?.state?.appsBack === token && routeHash() !== hash) { hist.back(); return; }
    goRoute(hash);
  }

  function renderSpace() {
    const box = doc.getElementById('app-space');
    if (!box) return;
    const a = app();
    const tools = appTools(a.id, catalog(), isVisible);
    const ids = visibleIds();
    const others = APPS.filter(x => x.id !== a.id && ids.includes(x.id));
    box.innerHTML = String(html`<header class="app-space-hero" style="--app-color:${a.color}">
        <span class="app-space-icon" aria-hidden="true">${raw(icon(a.icon, {size: 30}))}</span>
        <div><h1 id="app-space-title" class="page-title">${a.title}</h1><p class="lead">${a.desc}</p></div>
      </header>
      ${watchHtml(a)}
      ${a.plus ? html`<button class="button primary app-space-plus" data-action="${a.plus.action}">${raw(icon('plus', {size: 20}))}<span>${a.plus.label}</span></button>` : ''}
      <section class="app-space-section" aria-labelledby="app-space-tools"><h2 id="app-space-tools" class="section-title">Outils</h2>
        ${tools.length ? html`<div class="menu-list">${tools.map(([title, desc, action, ico]) => html`<button class="menu-row" data-action="${action}"><span>${raw(icon(ico, {size: 19}))}</span><span><strong>${title}</strong><small>${desc}</small></span><b aria-hidden="true">›</b></button>`)}</div>`
          : html`<p class="empty-state">Aucun outil de cette appli n’est disponible avec vos activités ou votre rôle.</p>`}
      </section>
      <section class="app-space-section" aria-labelledby="app-space-others"><h2 id="app-space-others" class="section-title">Autres applis</h2>
        <div class="apps-grid is-compact">${others.map(tileHtml)}</div>
      </section>`);
    if (a.id === 'facturation') fillBilling(a.id);
  }

  /** « À surveiller » : alertes de l'appli (notifications.js), ou le résumé de la facturation (rempli ensuite). */
  function watchHtml(a) {
    if (a.id === 'facturation') return html`<section class="app-space-section" aria-labelledby="app-space-watch-title"><h2 id="app-space-watch-title">À surveiller</h2><div id="app-space-watch" class="app-watch" aria-live="polite"><p class="app-watch-calm">Calcul en cours…</p></div></section>`;
    if (a.id === 'tp') {
      const rows = tpSummary(tpProjects());
      return html`<section class="app-space-section" aria-labelledby="app-space-watch-title"><h2 id="app-space-watch-title">Chantiers</h2>
        ${rows.length ? html`<div class="menu-list">${rows.map(r => html`<button class="menu-row app-watch-row" data-action="open-public-works"><span class="app-watch-count">${r.count}</span><span><strong>${r.label}</strong></span><b aria-hidden="true">›</b></button>`)}</div>`
          : html`<p class="app-watch-calm">${raw(icon('check', {size: 18}))}<span>Aucun chantier en cours ni prévu.</span></p>`}</section>`;
    }
    if (!ALERT_RULES[a.id]) return '';
    const rows = appAlerts(a.id, alerts());
    const shown = rows.slice(0, 5);
    return html`<section class="app-space-section" aria-labelledby="app-space-watch-title"><h2 id="app-space-watch-title">À surveiller</h2>
      ${rows.length ? html`<div class="menu-list app-watch">${shown.map(n => html`<button class="menu-row app-watch-row is-${n.level || 'info'}" data-action="notification-open" data-entity="${n.entity || ''}" data-id="${n.entityId || ''}"><span>${raw(icon(n.level === 'info' ? 'bell' : 'alert', {size: 19}))}</span><span><strong>${n.title}</strong><small>${n.message || ''}</small></span><b aria-hidden="true">›</b></button>`)}${rows.length > shown.length ? html`<button class="menu-row app-watch-more" data-action="open-notifications"><span>${raw(icon('bell', {size: 19}))}</span><span><strong>Voir les ${rows.length} alertes</strong></span><b aria-hidden="true">›</b></button>` : ''}</div>`
        : html`<p class="app-watch-calm">${raw(icon('check', {size: 18}))}<span>Rien à signaler.</span></p>`}
    </section>`;
  }

  /** Compteurs de la facturation (billing-hub.js chargé à la demande) ; chaque ligne ouvre « À faire ». */
  async function fillBilling(id) {
    let todo = null;
    try { todo = await billingTodo(); } catch { todo = null; }
    const box = doc.getElementById('app-space-watch');
    if (!box || current !== id) return;
    if (!todo) { box.innerHTML = String(html`<p class="app-watch-calm">Résumé indisponible : ouvrez « À faire ».</p>`); return; }
    const rows = billingSummary(todo);
    box.innerHTML = String(rows.length
      ? html`<div class="menu-list">${rows.map(r => html`<button class="menu-row app-watch-row is-${r.tone}" data-action="open-invoices" data-tab="afaire"><span class="app-watch-count">${r.count}</span><span><strong>${r.label}</strong>${r.amount ? html`<small>${formatEuro(r.amount)} en retard</small>` : ''}</span><b aria-hidden="true">›</b></button>`)}</div>`
      : html`<p class="app-watch-calm">${raw(icon('check', {size: 18}))}<span>Rien à relancer ni à facturer.</span></p>`);
  }

  function tileHtml(a) {
    return html`<button type="button" class="app-tile${a.id === current ? ' is-on' : ''}" data-action="switch-app" data-app="${a.id}" style="--app-color:${a.color}"${a.id === current ? raw(' aria-current="true"') : ''}>
      <span class="app-tile-icon" aria-hidden="true">${raw(icon(a.icon, {size: 28}))}</span><strong>${a.title}</strong><small>${a.desc}</small></button>`;
  }

  /** Lanceur : grille des applis visibles. */
  function openLauncher() {
    const ids = visibleIds();
    modal('Mes applis', 'Chaque appli regroupe ses outils ; vos données restent communes.',
      String(html`<div class="apps-grid">${APPS.filter(a => ids.includes(a.id)).map(tileHtml)}</div>`), '', 'apps-sheet');
  }

  /** Écran d'ouverture (adresse vide) : la dernière appli utilisée sur cet appareil. */
  function start() {
    const screen = startScreen(readLocal(LAST_APP_KEY), visibleIds());
    current = screen.app;
    apply();
    return screen;
  }

  /** Appelé après un changement d'activités ou de rôle : une appli devenue invisible ramène à Champs. */
  function refresh() {
    if (back && !visibleIds().includes(back.app)) back = null;
    if (!visibleIds().includes(current)) { back = null; setApp(DEFAULT_APP); if (currentView() === 'space') switchView(homeView(DEFAULT_APP)); return; }
    apply();
    if (currentView() === 'space') renderSpace();
  }

  return {apply, open, follow, visibleIds, syncView, goBack, renderSpace, openLauncher, start, refresh,
    setApp: id => setApp(id), current: () => current, hasReturn: () => Boolean(back)};
}
