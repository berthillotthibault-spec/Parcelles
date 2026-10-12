// n° 108 — Alertes sanitaires météo : ligne sur la carte météo de l'accueil, détail avec la règle,
// les données et la source, observation de contrôle en un clic, réglage des seuils.
import {evaluateAgroRisks, riskThresholds, RISK_DEFAULTS, RISK_LABELS} from './agro-risk.js';
import {AGRO_SOURCE} from './agro-weather.js';
import {escapeHtml as e} from './utils.js';
import {validateForm} from './form-chips-ui.js';

const pad = n => String(n).padStart(2, '0');
const isoToday = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const LEVEL = {risque: 'Risque', surveiller: 'À surveiller'};
// Seuils proposés au réglage : [famille, clé, libellé, pas].
const FIELDS = [
  ['septoria', 'rainMm', 'Septoriose : pluie contaminatrice (mm)', 1], ['septoria', 'riskEvents', 'Septoriose : pluies pour « risque »', 1],
  ['maizeLeaf', 'rhMin', 'Maïs : humidité d’humectation (%)', 1], ['maizeLeaf', 'watchHours', 'Maïs : heures pour « surveiller »', 1], ['maizeLeaf', 'riskHours', 'Maïs : heures pour « risque »', 1],
  ['sclerotinia', 'rhMin', 'Colza : humidité moyenne (%)', 1], ['sclerotinia', 'riskDays', 'Colza : jours humides pour « risque »', 1],
  ['thi', 'watch', 'Bovins : THI « surveiller »', 1], ['thi', 'risk', 'Bovins : THI « risque »', 1]
];

export function createAgroRiskUI({store, state, modal, closeModal, toast, agro, canWrite = () => true, doc = globalThis.document, now = () => Date.now()} = {}) {
  const alerts = (data = state()) => evaluateAgroRisks(data, agro?.get(), {now: now()});

  function renderHome() {
    if (!doc) return;
    const card = doc.querySelector('[data-home-card="weather"]');
    if (!card) return;
    agro?.ensure();
    let root = doc.getElementById('agro-risk-home');
    const list = alerts();
    if (!list.length) {root?.remove(); return;}
    if (!root) {root = doc.createElement('div'); root.id = 'agro-risk-home'; root.className = 'agro-risk-home'; card.append(root);}
    const top = list[0], more = list.length - 1;
    root.innerHTML = `<button type="button" class="agro-risk-line is-${top.level}" data-action="open-agro-risks"><span class="agro-risk-badge">${LEVEL[top.level]}</span><span>${e(top.message)}${more ? ` <small>+ ${more} autre${more > 1 ? 's' : ''}</small>` : ''}</span></button>`;
  }

  function alertHtml(a, i, write) {
    return `<article class="agro-risk-item is-${a.level}"><header><span class="agro-risk-badge">${LEVEL[a.level]}</span><strong>${e(a.label)}</strong></header>
      <p>${e(a.message)}</p><dl><div><dt>Règle</dt><dd>${e(a.rule)}</dd></div><div><dt>Données</dt><dd>${e(a.data)}</dd></div><div><dt>Source</dt><dd>${e(a.source)}</dd></div></dl>
      ${write ? `<button type="button" class="button secondary" data-agro-obs="${i}">Créer une observation de contrôle</button>` : ''}</article>`;
  }

  function openList() {
    const list = alerts(), write = canWrite(), loadedAt = agro?.get()?.loadedAt;
    modal('Alertes sanitaires', 'Conditions météo favorables, à vérifier au champ. Aucune recommandation de traitement.',
      `${list.length ? list.map((a, i) => alertHtml(a, i, write)).join('') : '<p class="empty-state">Aucune condition favorable détectée avec les seuils actuels.</p>'}
      <p class="agro-risk-foot"><small>Indicatif · météo ${e(AGRO_SOURCE)}${loadedAt ? ` du ${new Date(loadedAt).toLocaleString('fr-FR', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})}` : ''}. Les règles sont simplifiées : l’observation au champ fait foi.</small></p>`,
      `${write ? '<button class="button secondary" id="agro-risk-settings">Régler les seuils</button>' : ''}<button class="button primary" data-action="close-modal">Fermer</button>`, 'large');
    doc.querySelectorAll('[data-agro-obs]').forEach(button => button.addEventListener('click', async () => {
      const a = list[Number(button.dataset.agroObs)];
      await createObservation(a);
      button.disabled = true; button.textContent = 'Observation créée';
    }));
    doc.getElementById('agro-risk-settings')?.addEventListener('click', openSettings);
  }

  async function createObservation(a) {
    const saved = await store.upsert('observations', {
      parcelId: a.parcelId || '', date: isoToday(new Date(now())), type: a.kind === 'thi' ? 'Autre' : 'Maladie', title: `Contrôle · ${a.label}`,
      note: `${a.message}\nRègle : ${a.rule}\nDonnées : ${a.data}\nSource : ${a.source} (indicatif).`,
      severity: a.level === 'risque' ? 'warning' : 'info', status: 'À surveiller', source: 'agro-risk', sourceId: a.id
    }, {label: `Observation de contrôle : ${a.label}`});
    toast('Observation de contrôle créée.', 'success');
    return saved;
  }

  function openSettings() {
    const t = riskThresholds(state().preferences);
    modal('Seuils des alertes sanitaires', 'Ajustez les seuils à votre secteur. Les valeurs par défaut sont des repères simplifiés.',
      `<form id="agro-risk-form" class="form-grid">${FIELDS.map(([k, f, label, step]) => `<label>${e(label)}<input type="number" name="${k}.${f}" min="0" max="200" step="${step}" required value="${t[k][f]}"></label>`).join('')}</form>`,
      '<button class="button secondary" id="agro-risk-reset">Valeurs par défaut</button><button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="agro-risk-save">Enregistrer</button>');
    const form = doc.getElementById('agro-risk-form');
    doc.getElementById('agro-risk-save').onclick = async () => {
      if (!validateForm(form)) return;
      const out = {};
      for (const [k, f] of FIELDS) (out[k] ||= {})[f] = Number(form.elements[`${k}.${f}`].value);
      await store.setPreferences({agroRiskThresholds: out});
      closeModal(); toast('Seuils des alertes enregistrés.', 'success'); renderHome();
    };
    doc.getElementById('agro-risk-reset').onclick = async () => {await store.setPreferences({agroRiskThresholds: {}}); closeModal(); toast('Seuils par défaut rétablis.', 'success'); renderHome();};
  }

  return {renderHome, openList, openSettings, alerts, createObservation, labels: RISK_LABELS, defaults: RISK_DEFAULTS};
}
