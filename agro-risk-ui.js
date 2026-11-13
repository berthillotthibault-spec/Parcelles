// n° 108 — Alertes sanitaires météo : ligne sur la carte météo de l'accueil, détail avec la règle,
// les données et la source, observation de contrôle en un clic, réglage des seuils.
import {evaluateAgroRisks, riskThresholds, FUNGICIDE_DAYS_CHOICES, RISK_DEFAULTS, RISK_LABELS} from './agro-risk.js';
import {AGRO_SOURCE} from './agro-weather.js';
import {escapeHtml as e} from './utils.js';
import {validateForm} from './form-chips-ui.js';

const pad = n => String(n).padStart(2, '0');
const isoToday = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const LEVEL = {risque: 'Risque', surveiller: 'À surveiller', couvert: 'Couvert'};
// Seuils proposés au réglage : [famille, clé, libellé, pas].
const FIELDS = [
  ['septoria', 'rainMm', 'Septoriose : pluie contaminatrice (mm)', 1], ['septoria', 'riskEvents', 'Septoriose : pluies pour « risque »', 1],
  ['maizeLeaf', 'rhMin', 'Maïs : humidité d’humectation (%)', 1], ['maizeLeaf', 'watchHours', 'Maïs : heures pour « surveiller »', 1], ['maizeLeaf', 'riskHours', 'Maïs : heures pour « risque »', 1],
  ['sclerotinia', 'rhMin', 'Colza : humidité moyenne (%)', 1], ['sclerotinia', 'watchDays', 'Colza : jours humides pour « surveiller »', 1], ['sclerotinia', 'riskDays', 'Colza : jours humides pour « risque »', 1],
  ['thi', 'watch', 'Bovins : THI « surveiller »', 1], ['thi', 'risk', 'Bovins : THI « risque »', 1],
  ['fusarium', 'rainMm', 'Fusariose : pluie à la floraison (mm)', 1]
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
      <p>${e(a.message)}</p><dl><div><dt>Règle</dt><dd>${e(a.rule)}</dd></div><div><dt>Données</dt><dd>${e(a.data)}</dd></div>${a.why && a.data !== a.why ? `<div><dt>Pourquoi</dt><dd>${e(a.why)}</dd></div>` : ''}<div><dt>Source</dt><dd>${e(a.source)}</dd></div></dl>
      ${write ? `<button type="button" class="button secondary" data-agro-obs="${i}">Créer une observation de contrôle</button>` : ''}</article>`;
  }

  function openList() {
    // Idée 9 : les parcelles protégées par un fongicide récent apparaissent « couvert jusqu'au … ».
    const list = evaluateAgroRisks(state(), agro?.get(), {now: now(), withCovered: true}), write = canWrite(), loadedAt = agro?.get()?.loadedAt;
    modal('Alertes sanitaires', 'Conditions météo favorables aux stades sensibles, à vérifier au champ. Aucune recommandation de traitement.',
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
    const t = riskThresholds(state().preferences), rawCover = Number(t.cover.days);
    // Même repli que le calcul (agro-risk.js) : une ancienne valeur nulle ou invalide vaut 14 jours.
    const coverDays = rawCover > 0 ? rawCover : RISK_DEFAULTS.cover.days;
    // Protection d'un fongicide : choix fixes ; une ancienne valeur libre reste proposée tant qu'elle est en place.
    const coverChoices = FUNGICIDE_DAYS_CHOICES.includes(coverDays) ? FUNGICIDE_DAYS_CHOICES : [...FUNGICIDE_DAYS_CHOICES, coverDays].sort((a, b) => a - b);
    const coverSelect = `<label>Protection d’un fongicide<select name="fungicideProtectionDays">${coverChoices
      .map(n => `<option value="${n}"${n === coverDays ? ' selected' : ''}>${n} jours</option>`).join('')}</select></label>`;
    modal('Seuils des alertes sanitaires', 'Ajustez les seuils à votre secteur. Les valeurs par défaut sont des repères simplifiés.',
      `<form id="agro-risk-form" class="form-grid">${FIELDS.map(([k, f, label, step]) => `<label>${e(label)}<input type="number" name="${k}.${f}" min="0" max="200" step="${step}" required value="${t[k][f]}"></label>`).join('')}${coverSelect}</form>`,
      '<button class="button secondary" id="agro-risk-reset">Valeurs par défaut</button><button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="agro-risk-save">Enregistrer</button>');
    const form = doc.getElementById('agro-risk-form');
    doc.getElementById('agro-risk-save').onclick = async () => {
      if (!validateForm(form)) return;
      const out = {};
      for (const [k, f] of FIELDS) (out[k] ||= {})[f] = Number(form.elements[`${k}.${f}`].value);
      // Le seuil « surveiller » ne doit pas dépasser le seuil « risque », sinon des alertes disparaissent.
      const bad = [['maizeLeaf', 'watchHours', 'riskHours', 'Maïs'], ['sclerotinia', 'watchDays', 'riskDays', 'Colza'], ['thi', 'watch', 'risk', 'THI']].find(([k, w, r]) => out[k][w] > out[k][r]);
      let err = form.querySelector('.form-error');
      if (bad) {
        if (!err) {err = doc.createElement('p'); err.className = 'form-error'; err.setAttribute('role', 'alert'); form.append(err);}
        err.textContent = `${bad[3]} : le seuil « surveiller » doit être inférieur ou égal au seuil « risque ».`;
        form.elements[`${bad[0]}.${bad[1]}`].focus();
        return;
      }
      err?.remove();
      // L'ancien seuil libre (cover.days) est conservé ; le choix ci-dessus le remplace dans le calcul.
      const prevCover = state().preferences?.agroRiskThresholds?.cover;
      if (prevCover) out.cover = prevCover;
      await store.setPreferences({agroRiskThresholds: out, fungicideProtectionDays: Number(form.elements.fungicideProtectionDays.value)});
      closeModal(); toast('Seuils des alertes enregistrés.', 'success'); renderHome();
    };
    doc.getElementById('agro-risk-reset').onclick = async () => {await store.setPreferences({agroRiskThresholds: {}, fungicideProtectionDays: null}); closeModal(); toast('Seuils par défaut rétablis.', 'success'); renderHome();};
  }

  return {renderHome, openList, openSettings, alerts, createObservation, labels: RISK_LABELS, defaults: RISK_DEFAULTS};
}
