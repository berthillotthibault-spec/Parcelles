// n° 103 — Carte « Sommes de températures » de la fiche parcelle, stade observé et réglage des seuils.
import {estimatePhenology, sowingFor, cropProfile, PHENO_PROFILES, PHENOLOGY_SOURCE} from './phenology.js';
import {AGRO_SOURCE} from './agro-weather.js';
import {escapeHtml as e, formatNumber, localDate} from './utils.js';
import {validateForm} from './form-chips-ui.js';

const short = iso => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '');
const pad = n => String(n).padStart(2, '0');
const isoToday = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function createPhenologyUI({store, state, modal, closeModal, toast, bindChipChoices = () => {}, agro, canWrite = () => true, doc = globalThis.document, today = () => isoToday()} = {}) {
  const overrides = () => state().preferences?.phenologyProfiles || {};

  // Estimation pour une parcelle (aussi utilisée par l'assistant).
  function estimate(parcel, data = state()) {
    const t = today(), sowing = sowingFor(data, parcel.id, {today: t});
    const culture = sowing?.culture || parcel.culture || '';
    const obs = parcel.phenologyObservation && sowing && parcel.phenologyObservation.sowingDate === sowing.date ? parcel.phenologyObservation : null;
    return {sowing, ...estimatePhenology({culture, sowingDate: sowing?.date, days: agro?.get()?.days || [], today: t, observation: obs, overrides: data.preferences?.phenologyProfiles || {}})};
  }

  function bar(r) {
    const total = r.profile.stages.at(-1).gdd, pct = Math.round(r.progress * 100);
    const ticks = r.profile.stages.map(s => `<i style="inset-inline-start:${(s.gdd / total * 100).toFixed(1)}%" title="${e(s.name)} · ${formatNumber(s.gdd)} °C·j"></i>`).join('');
    return `<div class="pheno-bar" role="img" aria-label="Cycle estimé à ${pct} %"><span style="width:${pct}%"></span>${ticks}</div>
      <ol class="pheno-stages">${r.profile.stages.map(s => `<li class="${r.sum >= s.gdd ? 'is-done' : ''}${r.next?.name === s.name ? ' is-next' : ''}"><span>${e(s.name)}</span><small>${formatNumber(s.gdd)}</small></li>`).join('')}</ol>`;
  }

  function parcelHtml(parcel) {
    const r = estimate(parcel);
    if (r.status === 'unsupported') return '';
    const head = `<div class="panel-heading"><h2>Sommes de températures</h2><span class="pheno-flag">estimé</span></div>`;
    const wrap = body => `<section class="panel pheno-card" data-pheno-card data-parcel-id="${e(parcel.id)}">${head}${body}</section>`;
    if (r.status === 'no-sowing') return wrap(`<p class="pheno-empty">Enregistrez le semis comme travail terminé pour estimer le stade (${e(r.profile.label)}, base ${r.profile.base} °C).</p>`);
    if (r.status === 'no-weather') {
      queueMicrotask(() => agro?.ensure({since: r.sowingDate}));
      const err = agro?.error?.();
      return wrap(`<p class="pheno-empty">${err ? `Températures indisponibles (${e(err)}). Le calcul reprendra avec le réseau.` : 'Chargement des températures depuis le semis…'}</p>`);
    }
    // Les jours manquants (archive pas encore chargée) déclenchent un complément discret.
    if (r.missing > 2) queueMicrotask(() => agro?.ensure({since: r.sowingDate}));
    const write = canWrite();
    const next = r.next ? `<p class="pheno-next">Prochain stade : <strong>${e(r.next.name)}</strong> dans environ ${formatNumber(r.remaining)} °C·j${r.nextDate ? `, vers le ${short(r.nextDate)} selon la prévision` : ''}.</p>` : '<p class="pheno-next">Dernier stade du cycle atteint (estimation).</p>';
    return wrap(`<p class="pheno-sentence">Depuis le semis (${short(r.sowingDate)}) : <strong>${formatNumber(r.sum)} °C·j</strong> base ${r.base}. Stade estimé : <strong>${e(r.stage?.name || 'avant levée')}</strong>.</p>
      ${bar(r)}${next}
      ${r.recalibrated ? `<p class="pheno-note">Recalé sur le stade observé « ${e(r.recalibrated.stage)} » le ${short(r.recalibrated.date)}.</p>` : ''}
      ${r.missing ? `<p class="pheno-note">${r.missing} jour${r.missing > 1 ? 's' : ''} sans température : la somme est sous-estimée.</p>` : ''}
      <p class="pheno-source"><small>Estimation indicative · ${e(r.profile.label)}${r.profile.custom ? ' (seuils personnalisés)' : ''} · ${e(PHENOLOGY_SOURCE)} · météo ${e(AGRO_SOURCE)}${agro?.get()?.loadedAt ? `, ${e(localDate(new Date(agro.get().loadedAt).toISOString()))}` : ''}.</small></p>
      ${write ? `<div class="pheno-actions"><button type="button" class="button secondary" data-action="pheno-observed" data-id="${e(parcel.id)}">Stade observé</button><button type="button" class="button secondary" data-action="pheno-settings" data-id="${e(parcel.id)}">Régler les seuils</button></div>` : ''}`);
  }

  function refreshDom() {
    if (!doc) return;
    const data = state();
    doc.querySelectorAll('[data-pheno-card]').forEach(card => {
      const p = (data.parcelles || []).find(x => x.id === card.dataset.parcelId);
      if (p) card.outerHTML = parcelHtml(p) || '<span hidden data-pheno-card></span>';
    });
  }

  function openObserved(parcelId) {
    const data = state(), p = (data.parcelles || []).find(x => x.id === parcelId);
    const r = p && estimate(p, data);
    if (!r?.profile || !r.sowing) return toast('Aucun semis en cours pour cette parcelle.', 'error');
    const current = p.phenologyObservation?.sowingDate === r.sowing.date ? p.phenologyObservation : null;
    modal('Stade observé', `${p.nom} · semis du ${short(r.sowing.date)}. Le calcul repartira de ce stade à cette date.`,
      `<form id="pheno-observed-form" class="form-grid"><div class="field-label span-2"><span>Stade *</span><input type="hidden" name="stage" value="${e(current?.stage || '')}" required><div class="chip-choices" data-chip-target="stage">${r.profile.stages.map(s => `<button type="button" class="choice-chip${current?.stage === s.name ? ' is-on' : ''}" data-value="${e(s.name)}">${e(s.name)}</button>`).join('')}</div></div>
      <label>Date d’observation *<input type="date" name="date" required value="${e(current?.date || today())}" min="${e(r.sowing.date)}" max="${e(today())}"></label><p class="form-error span-2" hidden></p></form>`,
      `${current ? '<button class="button secondary" id="pheno-observed-clear">Effacer</button>' : ''}<button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="pheno-observed-save">Enregistrer</button>`);
    const form = doc.getElementById('pheno-observed-form');
    bindChipChoices(form);
    doc.getElementById('pheno-observed-save').onclick = async () => {
      const err = form.querySelector('.form-error');
      if (!form.elements.stage.value) {err.textContent = 'Choisissez le stade observé.'; err.hidden = false; return;}
      if (!validateForm(form)) return;
      await store.upsert('parcelles', {...p, phenologyObservation: {stage: form.elements.stage.value, date: form.elements.date.value, sowingDate: r.sowing.date}}, {label: `Stade observé : ${form.elements.stage.value}`});
      closeModal(); toast('Stade observé enregistré : le calcul est recalé.', 'success');
    };
    doc.getElementById('pheno-observed-clear')?.addEventListener('click', async () => {
      const {phenologyObservation, ...rest} = p;
      await store.upsert('parcelles', {...rest, phenologyObservation: null}, {label: 'Stade observé effacé'});
      closeModal(); toast('Stade observé effacé.', 'success');
    });
  }

  function openSettings(parcelId) {
    const data = state(), p = (data.parcelles || []).find(x => x.id === parcelId);
    const prof = p && cropProfile(sowingFor(data, p.id, {today: today()})?.culture || p.culture, overrides());
    if (!prof) return;
    modal(`Seuils · ${prof.label}`, 'Degrés-jours cumulés depuis le semis pour atteindre chaque stade. Adaptez-les à vos variétés.',
      `<form id="pheno-settings-form" class="form-grid"><label>Température de base (°C)<input type="number" name="base" step="0.5" min="-5" max="15" required value="${prof.base}"></label>
      ${prof.stages.map((s, i) => `<label>${e(s.name)} (°C·j)<input type="number" name="gdd-${i}" data-stage="${e(s.name)}" min="0" max="5000" step="10" required value="${s.gdd}"></label>`).join('')}
      <p class="span-2"><small>${e(PHENOLOGY_SOURCE)}.</small></p></form>`,
      `<button class="button secondary" id="pheno-settings-reset">Valeurs par défaut</button><button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="pheno-settings-save">Enregistrer</button>`);
    const form = doc.getElementById('pheno-settings-form');
    const save = async value => {
      const all = {...overrides()};
      if (value) all[prof.key] = value; else delete all[prof.key];
      await store.setPreferences({phenologyProfiles: all});
      closeModal(); toast(value ? 'Seuils enregistrés.' : 'Seuils par défaut rétablis.', 'success');
    };
    doc.getElementById('pheno-settings-save').onclick = () => {
      if (!validateForm(form)) return;
      save({base: Number(form.elements.base.value), stages: [...form.querySelectorAll('[data-stage]')].map(i => ({name: i.dataset.stage, gdd: Number(i.value)}))});
    };
    doc.getElementById('pheno-settings-reset').onclick = () => save(null);
  }

  // Résumé pour l'assistant : une ligne par parcelle de la culture demandée.
  function summaries(filter = () => true) {
    const data = state();
    return (data.parcelles || []).filter(p => !p.deletedAt && !p.archived && filter(p)).map(p => ({parcel: p, r: estimate(p, data)})).filter(x => x.r.status !== 'unsupported');
  }

  return {parcelHtml, refreshDom, openObserved, openSettings, estimate, summaries, defaults: PHENO_PROFILES};
}
