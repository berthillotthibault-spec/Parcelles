// n° 102 — Interface des habitudes : proposition de l'étape suivante après un travail terminé et
// pré-remplissage du formulaire de travail. Toujours une proposition, jamais une écriture automatique.
import {learnHabits, nextStepSuggestion, habitDefaults} from './habits.js';
import {escapeHtml} from './utils.js';

export function createHabitsUI({store, state, toast, now = () => Date.now()} = {}) {
  // Calcul complet à chaque appel : quelques milliers de travaux au plus, tri compris.
  const habits = (data = state()) => learnHabits(data, {now: now()});

  function suggestAfter(work) {
    if (!work) return null;
    const data = state();
    return nextStepSuggestion(data, work, {now: now(), habits: habits(data)});
  }

  // Après un travail terminé : une invite persistante, à accepter en un clic.
  function afterFinish(work) {
    const s = suggestAfter(work);
    if (!s) return null;
    toast(`${s.label} · ${s.source}`, 'success', [
      {label: 'Ajouter', run: async () => {
        await store.upsert('interventions', {parcelId: s.parcelId, type: s.type, culture: s.culture, date: s.date, plannedDate: s.date, status: 'À faire', source: 'habit', note: `Proposé d’après vos habitudes (${s.source}).`}, {label: `Travail prévu : ${s.type}`});
        toast(`${s.type} ajouté au ${s.date.split('-').reverse().join('/')}.`, 'success');
      }},
      {label: 'Non merci', run: () => {}}
    ], {persist: true});
    return s;
  }

  // Pré-remplit produit, dose, unité et matériel quand ils sont vides, avec la mention « habituel ».
  function enhanceWorkForm(form, item = {}) {
    if (!form || item.id) return;
    const el = name => form.elements[name];
    const filled = new Set();
    let cultureTouched = Boolean(item.culture && item.culture !== (state().parcelles || []).find(p => p.id === item.parcelId)?.culture);
    form.elements.culture?.addEventListener('input', () => {cultureTouched = true;});
    const tag = (name, count) => {
      const label = el(name)?.closest('label');
      if (!label) return;
      label.querySelector('[data-habit-tag]')?.remove();
      label.insertAdjacentHTML('beforeend', `<small class="habit-tag" data-habit-tag>habituel · vu ${count} fois</small>`);
    };
    const untag = name => el(name)?.closest('label')?.querySelector('[data-habit-tag]')?.remove();
    const set = (name, value, count) => {
      const input = el(name);
      if (!input || value === undefined || value === null || value === '') return false;
      if (String(input.value || '').trim() && !filled.has(name)) return false;
      if (input.tagName === 'SELECT' && ![...input.options].some(o => o.value === String(value))) return false;
      input.value = String(value);
      // « change » seul : les pastilles se resynchronisent ; « input » est réservé à la saisie de l'utilisateur.
      input.dispatchEvent(new Event('change', {bubbles: true}));
      filled.add(name);
      tag(name, count);
      return true;
    };
    function apply() {
      for (const name of [...filled]) {
        const input = el(name);
        if (input) {input.value = ''; input.dispatchEvent(new Event('change', {bubbles: true}));}
        untag(name); filled.delete(name);
      }
      const data = state();
      const parcel = (data.parcelles || []).find(p => p.id === el('parcelId')?.value);
      // La culture pré-remplie vient de la première parcelle : celle de la parcelle choisie prime tant
      // que l'utilisateur n'a pas saisi la culture lui-même.
      const typed = cultureTouched ? String(el('culture')?.value || '').trim() : '';
      const culture = typed || parcel?.culture || String(el('culture')?.value || '').trim();
      const d = habitDefaults(data, {culture, type: String(el('type')?.value || '').trim(), now: now(), habits: habits(data)});
      const parts = [];
      if (d?.product && set('product', d.product.value, d.product.count)) parts.push(escapeHtml(d.product.value));
      if (d?.dose && set('dose', d.dose.value, d.dose.count)) {set('doseUnit', d.dose.unit, d.dose.count); parts.push(`${escapeHtml(d.dose.value)} ${escapeHtml(d.dose.unit || '')}`.trim());}
      if (d?.equipmentId && set('equipmentId', d.equipmentId.value, d.equipmentId.count)) parts.push(escapeHtml(el('equipmentId').selectedOptions[0]?.textContent || 'matériel'));
      let note = form.querySelector('[data-habit-note]');
      if (!parts.length) {note?.remove(); return;}
      if (!note) {
        note = form.ownerDocument.createElement('p');
        note.className = 'habit-note';
        note.dataset.habitNote = '';
        note.setAttribute('role', 'status');
        form.querySelector('.form-grid')?.after(note);
      }
      const count = Math.max(...[d.product, d.dose, d.equipmentId].filter(Boolean).map(x => x.count));
      note.innerHTML = `<strong>Habituel</strong> pour ${escapeHtml(culture || 'cette culture')} : ${parts.join(' · ')} <small>(vu ${count} fois, modifiable dans « Plus de détails »)</small>`;
    }
    // L'utilisateur reprend la main sur un champ : il n'est plus « habituel ».
    for (const name of ['product', 'dose', 'doseUnit', 'equipmentId']) el(name)?.addEventListener('input', () => {filled.delete(name); untag(name);});
    for (const name of ['type', 'parcelId', 'culture']) el(name)?.addEventListener('change', apply);
    apply();
  }

  return {afterFinish, suggestAfter, enhanceWorkForm, habits};
}
