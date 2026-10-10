// n° 125 : bouton « ? » des fenêtres et des écrans, astuces au premier usage et aide générale.
import {HELP, FAQ, helpKeyFor, helpEntry, tipToShow, markTipSeen} from './help.js';
import {escapeHtml as e} from './utils.js';

function entryHtml(entry) {
  return `<ul class="help-points">${entry.points.map(point => `<li>${e(point)}</li>`).join('')}</ul>${entry.link ? `<button type="button" class="text-button help-link" data-action="${e(entry.link.action)}">${e(entry.link.label)} ›</button>` : ''}`;
}

export function createHelpUI({store, modal, doc = globalThis.document}) {
  const prefs = () => store.snapshot().preferences || {};
  const writable = () => !store.tabReadOnly && !store.schemaLock;

  // Clé d'aide d'une fenêtre : explicite (option helpKey de modal()) ou déduite du titre.
  const keyFor = (title, helpKey) => (helpKey && HELP[helpKey] ? helpKey : helpKeyFor(title));
  const headerButtonHtml = (key, title) => key ? `<button type="button" class="modal-help" data-help-toggle aria-expanded="false" aria-controls="modal-help-panel" aria-label="Aide : ${e(title)}">?</button>` : '';

  async function rememberTip(key) {
    if (!writable()) return;
    try { await store.setPreferences({seenTips: markTipSeen(prefs().seenTips, key)}); } catch {}
  }
  function decorateModal(dialog, key) {
    const entry = helpEntry(key), body = dialog?.querySelector('.modal-body');
    if (!entry || !body) return;
    const panel = doc.createElement('section');
    panel.id = 'modal-help-panel'; panel.className = 'modal-help-panel'; panel.hidden = true;
    panel.setAttribute('aria-label', `Aide : ${entry.title}`);
    panel.innerHTML = `<strong>${e(entry.title)}</strong>${entryHtml(entry)}`;
    body.prepend(panel);
    const button = dialog.querySelector('[data-help-toggle]');
    button?.addEventListener('click', () => {
      panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden));
      dialog.querySelector('.help-tip')?.remove();
      if (!panel.hidden) rememberTip(key);
    });
    const tip = tipToShow(key, prefs().seenTips);
    if (tip && writable()) {
      const bubble = doc.createElement('div');
      bubble.className = 'help-tip'; bubble.setAttribute('role', 'note');
      bubble.innerHTML = `<span>${e(tip)}</span><button type="button" class="text-button">Compris</button>`;
      bubble.querySelector('button').addEventListener('click', () => bubble.remove());
      body.prepend(bubble);
      rememberTip(key);
    }
  }

  // Écran Travaux : « ? » selon l'onglet affiché (Liste, Semaine, Calendrier…).
  function mountViewHelp() {
    const heading = doc.querySelector('#view-work .view-heading');
    if (!heading || heading.querySelector('.view-help')) return;
    const button = doc.createElement('button');
    button.type = 'button'; button.className = 'view-help'; button.dataset.action = 'help-topic'; button.dataset.helpKey = 'work';
    button.setAttribute('aria-label', 'Aide sur cet écran'); button.textContent = '?';
    const anchor = heading.querySelector('[data-action="new-work"]');
    if (anchor) anchor.before(button); else heading.append(button);
  }
  function viewKey(key) {
    if (key !== 'work') return key;
    const tab = doc.querySelector('#work-subviews [aria-selected="true"]')?.dataset.tab || 'list';
    return HELP[`work-${tab}`] ? `work-${tab}` : 'work-list';
  }
  function openTopic(key) {
    const entry = helpEntry(viewKey(key));
    if (!entry) { openHelp(); return; }
    modal(entry.title, 'Aide sur cet écran', `<div class="help-topic">${entryHtml(entry)}</div><p class="form-note"><button type="button" class="text-button" data-action="open-help">Toute l’aide</button></p>`, '<button class="button primary" data-action="close-modal">Compris</button>', 'small');
  }

  function openHelp() {
    const sections = [
      ['Bien commencer', ['Ajoutez vos parcelles : Plus › Mes données › Importer (fichier PAC, SHP ou Excel), ou retrouvez-les sur la carte PAC.', 'Saisissez un travail avec le bouton « + Travail » : parcelle, type et date suffisent.', 'Choisissez vos activités dans Personnaliser : seuls les outils utiles s’affichent.']],
      ['Au champ', ['Le mode terrain trouve la parcelle où vous êtes, si vous autorisez la position.', '« J’ai fait » note en deux gestes un travail terminé.', 'La dictée vocale remplit un travail ou une observation.']],
      ['Vos données', ['Tout est gardé dans le téléphone, même sans réseau.', 'Faites une sauvegarde hors du téléphone de temps en temps.', 'Avec un compte, l’équipe partage la même exploitation.']],
      ['Réglementation', ['Registre phyto, azote, PAC et couverts vous aident à préparer un contrôle.', 'Ces aides sont indicatives : la source et la date des tables sont affichées.', 'La déclaration officielle se fait toujours sur les services de l’État (Telepac…).']]
    ];
    modal('Aide', 'Les réponses aux questions courantes.', `<div class="help-general">${sections.map(([title, points]) => `<section><h3>${e(title)}</h3><ul class="help-points">${points.map(point => `<li>${e(point)}</li>`).join('')}</ul></section>`).join('')}
      <section><h3>Questions fréquentes</h3>${FAQ.map(item => `<details class="help-faq"><summary>${e(item.q)}</summary><p>${e(item.a)}</p></details>`).join('')}</section>
      <p class="form-note">Le bouton « ? » en haut d’une fenêtre explique l’écran ouvert.</p>
      <div class="help-actions"><button type="button" class="button secondary" data-action="open-whats-new">Nouveautés</button><button type="button" class="button secondary" data-action="open-diagnostic">Un problème ?</button></div></div>`,
    '<button class="button primary" data-action="close-modal">Compris</button>');
  }
  return {keyFor, headerButtonHtml, decorateModal, mountViewHelp, openTopic, openHelp};
}
