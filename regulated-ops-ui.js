// n° 72 : écran « Opérateurs et échéances » (Plus › Gestion) : fiches Certiphyto, contrôle des pulvérisateurs,
// conseil stratégique phytosanitaire, et liste regroupée des échéances (assurance, contrôle, Certiphyto, CSP).
import {html, raw} from './safe-html.js';
import {CERTIPHYTO_CATEGORIES, REGULATED_NOTE, adminDeadlines, regulatedSettings, sprayerMachines} from './regulated-ops.js';
import {phytoOperators} from './compliance.js';
import {isoDate, localDate, normalize} from './utils.js';

const STATUS={ko:['danger','Dépassée'],warn:['warning','Proche'],unknown:['info','À renseigner'],ok:['success','À jour']};

export function createRegulatedOpsUI({store, modal, toast, doc = globalThis.document, today = () => isoDate(new Date())} = {}) {
  const $ = sel => doc.querySelector(sel);
  function deadlinesHtml(rows) {
    if (!rows.length) return html`<div class="empty-state">Aucune échéance suivie. Renseignez vos opérateurs, vos pulvérisateurs ou l’échéance d’assurance d’un matériel.</div>`;
    return html`<div class="stack-list">${rows.map(r => html`<div class="list-row"><div><strong>${r.label}</strong><small>${r.detail}${r.dueDate ? ` · échéance ${localDate(r.dueDate)}` : ''}</small></div><span class="badge ${STATUS[r.status][0]}">${STATUS[r.status][1]}</span></div>`)}</div>`;
  }
  function operatorRow(card, i) {
    const select = html`<select name="cat:${i}"><option value="">Catégorie…</option>${CERTIPHYTO_CATEGORIES.map(([k, l]) => html`<option value="${k}" ${raw(card.categorie === k ? 'selected' : '')}>${l}</option>`)}</select>`;
    return html`<fieldset class="span-2 reg-operator"><legend>${card.nom || 'Nouvel opérateur'}</legend><label>Nom<input name="nom:${i}" maxlength="60" autocomplete="name" value="${card.nom}" placeholder="Prénom Nom"></label><label>N° Certiphyto<input name="num:${i}" maxlength="40" value="${card.numero}"></label><label>Catégorie${select}</label><label>Valable jusqu’au<input type="date" name="exp:${i}" value="${card.expiresAt}"></label></fieldset>`;
  }
  function open() {
    const state = store.state, s = regulatedSettings(state), rows = adminDeadlines(state, {today: today()});
    const known = new Set(s.operators.map(c => normalize(c.nom)));
    const cards = [...s.operators, ...phytoOperators(state).filter(n => !known.has(normalize(n))).map(nom => ({nom, numero: '', categorie: '', expiresAt: ''})), {nom: '', numero: '', categorie: '', expiresAt: ''}];
    const sprayers = sprayerMachines(state);
    modal('Opérateurs et échéances', 'Certiphyto, contrôle du pulvérisateur, assurances et conseil stratégique.',
      html`<section><h3>Échéances</h3>${deadlinesHtml(rows)}</section>
      <form id="regulated-form" class="form-grid" novalidate>
        <h3 class="span-2">Opérateurs (Certiphyto)</h3>${cards.map(operatorRow)}
        <h3 class="span-2">Pulvérisateurs</h3>${sprayers.length ? sprayers.map(m => html`<label class="span-2">Dernier contrôle : ${m.nom || 'Pulvérisateur'}<input type="date" name="ctl:${m.id}" value="${m.controleDate || ''}" max="${today()}"></label>`) : html`<p class="form-note span-2">Aucun pulvérisateur dans le matériel (nom contenant « pulvé », « atomiseur »…).</p>`}
        <label>Contrôle tous les (ans)<input name="sprayerControlYears" type="number" min="1" max="10" step="1" value="${s.sprayerControlYears}"></label>
        <label>Prévenir avant (jours)<input name="warnDays" type="number" min="0" max="365" step="1" value="${s.warnDays}"></label>
        <h3 class="span-2">Conseil stratégique phytosanitaire</h3>
        <label>Dernier conseil<input type="date" name="cspDate" value="${s.cspDate}" max="${today()}"></label>
        <label>À renouveler tous les (ans)<input name="cspYears" type="number" min="1" max="10" step="1" value="${s.cspYears}"></label>
        <p class="form-note span-2">L’échéance d’assurance se renseigne sur la fiche de chaque matériel. ${REGULATED_NOTE}</p>
        <p class="form-error span-2 hidden" role="alert"></p>
      </form>`,
      html`<button class="button secondary" data-action="open-compliance">Conformité</button><button class="button primary" id="regulated-save">Enregistrer</button>`, 'large');
    $('#regulated-save')?.addEventListener('click', () => save(cards.length, sprayers));
  }
  async function save(count, sprayers) {
    const form = $('#regulated-form'), v = Object.fromEntries(new FormData(form)), error = form.querySelector('.form-error');
    const fail = text => { error.textContent = text; error.classList.remove('hidden'); };
    const list = [], seen = new Set();
    for (let i = 0; i < count; i++) {
      const nom = String(v[`nom:${i}`] || '').replace(/\s+/g, ' ').trim(); if (!nom) continue;
      if (seen.has(normalize(nom))) return fail(`Opérateur en double : ${nom}.`); seen.add(normalize(nom));
      list.push({nom, numero: String(v[`num:${i}`] || '').trim(), categorie: String(v[`cat:${i}`] || ''), expiresAt: String(v[`exp:${i}`] || '')});
    }
    const ints = [['sprayerControlYears', 1, 10, 'contrôle du pulvérisateur'], ['warnDays', 0, 365, 'prévenir avant'], ['cspYears', 1, 10, 'conseil stratégique']];
    for (const [k, min, max, label] of ints) { const n = Number(v[k]); if (!Number.isInteger(n) || n < min || n > max) return fail(`Valeur à corriger : ${label} (entre ${min} et ${max}).`); }
    const day = today();
    if ((v.cspDate && v.cspDate > day) || sprayers.some(m => (v[`ctl:${m.id}`] || '') > day)) return fail('Une date de contrôle ou de conseil ne peut pas être dans le futur.');
    try {
      const current = store.state.exploitation?.conformite || {};
      await store.setExploitation({conformite: {...current, certiphytos: list, sprayerControlYears: Number(v.sprayerControlYears), warnDays: Number(v.warnDays), cspYears: Number(v.cspYears), cspDate: String(v.cspDate || '')}});
      for (const m of sprayers) { const date = String(v[`ctl:${m.id}`] || ''); if (date !== (m.controleDate || '')) await store.upsert('materiels', {...m, controleDate: date || null}, {label: `Contrôle pulvérisateur renseigné : ${m.nom || 'matériel'}`}); }
      toast('Opérateurs et échéances enregistrés.', 'success'); open();
    } catch (err) { fail(err.message); }
  }
  return {open};
}
