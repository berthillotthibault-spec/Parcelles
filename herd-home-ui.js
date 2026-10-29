// Vue Troupeau (n° 160) : onglet de premier niveau qui agrège le pâturage, le registre du troupeau et le carnet
// sanitaire existants. Actions rapides, lots au pré (« Jour N »), animaux au bâtiment, « À venir » sur 14 jours,
// et feuille « Déplacer · lot » qui passe par moveGrazingLot / endGrazingSession (grazing-records.js).
// Module différé (clé herdHome de lazy-modules.js) ; logique dans herd-home.js.
import {html} from './safe-html.js';
import {herdLots, animalsInside, herdHeadline, herdUpcoming, moveDestinations} from './herd-home.js';
import {moveGrazingLot, endGrazingSession, grazingReentryAlert} from './grazing-records.js';
import {filterAnimals} from './herd.js';

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const dayBlock = iso => {
  const d = new Date(`${iso}T12:00:00`);
  return html`<span class="herd-date"><small>${d.toLocaleDateString('fr-FR', {weekday: 'short'}).replace('.', '')}</small><b>${d.getDate()}</b></span>`;
};

export function createHerdHomeUI({store, state, modal, closeModal, toast, todayIso, cultureColor = () => 'var(--brand)', doc = document}) {
  let pendingAlert = null;
  let moving = false;

  function render(root = doc.getElementById('herd-home')) {
    if (!root) return;
    const data = state(), today = todayIso();
    const lots = herdLots(data, {today}), inside = animalsInside(data, {today}), upcoming = herdUpcoming(data, {today});
    const summary = doc.getElementById('herd-summary');
    if (summary) summary.textContent = herdHeadline(data, {today});
    root.innerHTML = String(html`
      <div class="herd-actions" role="group" aria-label="Actions rapides">
        <button type="button" class="herd-action" data-action="herd-pick" data-kind="calving"><b>Vêlage</b><small>Naissance</small></button>
        <button type="button" class="herd-action" data-action="open-herd-health"><b>Soin</b><small>Traitement</small></button>
        <button type="button" class="herd-action" data-action="herd-pick" data-kind="weighing"><b>Pesée</b><small>Poids</small></button>
      </div>
      <section class="herd-section" aria-labelledby="herd-lots-title"><h2 id="herd-lots-title" class="herd-h">Lots</h2>
        ${lots.length ? lots.map(l => html`<article class="herd-lot">
          <div class="herd-lot-head"><span class="herd-badge is-out"><b>${l.n}</b><small>têtes</small></span>
            <span class="herd-lot-text"><b>${l.name}</b><small>${l.parcelName} · depuis le ${new Date(`${l.startDate}T12:00:00`).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short'})}</small></span></div>
          <p class="herd-lot-days">Jour ${l.days} au pré</p>
          <button type="button" class="herd-lot-button" data-action="herd-move" data-id="${l.id}">Déplacer le lot</button></article>`)
        : html`<p class="herd-empty">Aucun lot au pré.</p>`}
        ${inside.length ? html`<article class="herd-lot">
          <div class="herd-lot-head"><span class="herd-badge"><b>${inside.length}</b><small>têtes</small></span>
            <span class="herd-lot-text"><b>Au bâtiment</b><small>${plural(inside.length, 'animal enregistré', 'animaux enregistrés')} hors d’un lot au pré</small></span></div>
          <button type="button" class="herd-lot-button" data-action="new-grazing">Mettre au pré</button></article>` : ''}
      </section>
      <section class="herd-section" aria-labelledby="herd-next-title"><h2 id="herd-next-title" class="herd-h">À venir</h2>
        ${upcoming.length ? html`<div class="herd-events">${upcoming.map(e => html`<button type="button" class="herd-event" data-action="${e.action}"${e.id ? html` data-id="${e.id}"` : ''}>
          ${dayBlock(e.date)}<span class="herd-event-text"><b>${e.title}</b>${e.sub ? html`<small>${e.sub}</small>` : ''}</span></button>`)}</div>`
        : html`<p class="herd-empty">Rien de prévu dans les 14 prochains jours.</p>`}
      </section>
      <p class="herd-more"><button type="button" class="text-button" data-action="open-herd">Ouvrir le registre complet</button><button type="button" class="text-button" data-action="open-grazing">Tout le pâturage</button></p>`);
  }

  function openMove(sessionId) {
    const data = state(), today = todayIso();
    const lot = herdLots(data, {today}).find(l => l.id === sessionId);
    if (!lot) { toast('Ce lot n’est plus au pré.', 'error'); return; }
    pendingAlert = null;
    const rows = moveDestinations(data, {fromParcelId: lot.parcelId, today});
    const body = html`<div class="herd-move">
      <p class="herd-move-lead">Choisissez la destination. L’entrée est datée d’aujourd’hui.</p>
      ${rows.length ? rows.map(r => html`<button type="button" class="herd-dest" data-move-to="${r.parcel.id}">
        <span class="qw-dot" style="background:${cultureColor(r.parcel.culture || '')}" aria-hidden="true"></span>
        <span class="herd-event-text"><b>${r.parcel.nom}</b><small>${(Number(r.parcel.surfaceHa) || 0).toLocaleString('fr-FR', {maximumFractionDigits: 1})} ha · ${r.status}</small></span><span aria-hidden="true">›</span></button>`)
      : html`<p class="herd-empty">Aucune autre prairie : renseignez une culture de prairie sur vos parcelles.</p>`}
      <button type="button" class="herd-dest" data-move-to=""><span class="qw-dot is-inside" aria-hidden="true"></span>
        <span class="herd-event-text"><b>Rentrer au bâtiment</b><small>Sortie du pré aujourd’hui</small></span><span aria-hidden="true">›</span></button>
      <div class="herd-move-alert" role="alert" hidden></div></div>`;
    modal(`Déplacer · ${lot.name}`, `${plural(lot.n, 'tête', 'têtes')} · ${lot.parcelName} · jour ${lot.days}`, String(body), '', 'herd-move-sheet');
    doc.querySelector('#modal-root .herd-move')?.addEventListener('click', event => {
      const confirm = event.target.closest('[data-move-confirm]');
      if (confirm) { pendingAlert = confirm.dataset.moveConfirm; move(lot, pendingAlert); return; }
      const button = event.target.closest('[data-move-to]');
      if (button) move(lot, button.dataset.moveTo);
    });
  }

  async function move(lot, parcelId) {
    const today = todayIso();
    if (moving) return; // double appui (gants, rebond) : un seul déplacement
    if (parcelId && pendingAlert !== parcelId) {
      const alert = grazingReentryAlert(state(), parcelId, today);
      if (alert) {
        // Confirmation par un bouton distinct, jamais par un second appui sur la même ligne.
        const box = doc.querySelector('#modal-root .herd-move-alert');
        if (box) {
          box.hidden = false;
          box.innerHTML = String(html`<p>${alert.message || 'Parcelle encore sous délai de rentrée après un traitement.'}</p><button type="button" class="button secondary" data-move-confirm="${parcelId}">Déplacer quand même</button>`);
          box.querySelector('button')?.focus();
        }
        return;
      }
    }
    moving = true;
    doc.querySelectorAll('#modal-root .herd-dest').forEach(b => { b.disabled = true; });
    const before = {...lot.session};
    let created = null;
    try {
      if (parcelId) created = await moveGrazingLot(store, lot.session, parcelId, {date: today});
      else await endGrazingSession(store, lot.id, {date: today});
    } catch (error) {
      toast(error?.message || 'Déplacement impossible.', 'error');
      doc.querySelectorAll('#modal-root .herd-dest').forEach(b => { b.disabled = false; });
      return;
    } finally { moving = false; }
    closeModal();
    const name = (state().parcelles || []).find(p => p.id === parcelId)?.nom;
    // Annuler : le passage d'origine est rouvert tel qu'il était, le nouveau passage retiré.
    const undo = async () => {
      if (created?.id) await store.remove('grazingSessions', created.id);
      await store.upsert('grazingSessions', {...before, endDate: before.endDate || null}, {label: `Déplacement annulé : ${lot.name}`});
    };
    toast(parcelId ? `${lot.name} → ${name}` : `${lot.name} rentrés au bâtiment`, 'success', {label: 'Annuler', run: undo});
  }

  // Vêlage et pesée se font depuis la fiche de l'animal (formulaires existants de herd-ui.js) : on choisit l'animal.
  function openPick(kind) {
    const today = todayIso();
    const animals = filterAnimals(state(), {status: 'present', today, sex: kind === 'calving' ? 'F' : ''});
    const title = kind === 'calving' ? 'Vêlage : quelle mère ?' : 'Pesée : quel animal ?';
    const body = animals.length
      ? html`<div class="herd-move">${animals.map(a => html`<button type="button" class="herd-dest" data-action="open-herd-animal" data-id="${a.id}">
          <span class="herd-event-text"><b>${a.name || a.nationalId || 'Animal'}</b><small>${[a.nationalId, a.breed].filter(Boolean).join(' · ')}</small></span><span aria-hidden="true">›</span></button>`)}</div>`
      : html`<p class="herd-empty">Aucun animal enregistré.</p><p><button type="button" class="button primary" data-action="open-herd">Ouvrir le registre</button></p>`;
    modal(title, kind === 'calving' ? 'La fiche s’ouvre : « Vêlage » y enregistre la naissance.' : 'La fiche s’ouvre : « Pesée » y enregistre le poids.', String(body), '', 'herd-move-sheet');
  }

  return {render, openMove, openPick};
}
