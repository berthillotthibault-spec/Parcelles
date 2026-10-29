// @ts-check
// Accueil (n° 160) : blocs de la maquette « Parcelles, sans le fourre-tout ». Fonctions pures qui rendent
// du HTML sûr (safe-html.js) à partir de l'état ; app.js les pose dans #view-today.
// Bandeau « En retard », liste « Aujourd'hui » qui mêle travaux et tâches du jour (cocher, décocher),
// carte « animaux au pré » et « Activité récente ».
import {html} from './safe-html.js';
import {typeBadge} from './quick-work.js';
import {filterGrazingSessions, grazingTotal} from './grazing.js';

const num = value => Number(value || 0).toLocaleString('fr-FR', {maximumFractionDigits: 1});
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const badge = type => { const b = typeBadge(type || 'Travail'); return html`<span class="wk-badge" data-family="${b.family}" aria-hidden="true">${b.ab}</span>`; };
const titleOf = entry => entry.kind === 'work' ? (entry.item.type || 'Travail') : (entry.item.title || 'Tâche');

/**
 * Bandeau « En retard » : nombre, deux premiers éléments (« Labour à Bois Brûlé »), « +N » au-delà.
 * @param {{kind: string, item: any, overdue?: boolean}[]} entries @param {Map<string, string>} parcelNames
 */
export function lateBannerHtml(entries, parcelNames) {
  const late = entries.filter(e => e.overdue);
  if (!late.length) return '';
  const label = e => { const where = parcelNames.get(e.item.parcelId); return where ? `${titleOf(e)} à ${where}` : titleOf(e); };
  const first = late.slice(0, 2).map(label).join(', ');
  const more = late.length > 2 ? ` +${late.length - 2}` : '';
  return html`<button type="button" class="home-late" data-action="today-summary-open" data-target="overdue" aria-label="${plural(late.length, 'élément en retard', 'éléments en retard')} : ouvrir le planning">
    <span class="home-late-count" aria-hidden="true">${late.length}</span>
    <span class="home-late-text"><b>En retard</b><span>${first}${more}</span></span><span class="home-chevron" aria-hidden="true">›</span></button>`;
}

/**
 * Lignes « Aujourd'hui » : à faire (sans les retards, déjà dans le bandeau) puis faites aujourd'hui.
 * Triées par heure, puis par échéance. Un tap coche ou décoche (finish-*, reopen-*), « ··· » ouvre la fiche.
 * @param {{pending: {kind: string, item: any, overdue?: boolean, date?: string}[], done: {kind: string, item: any}[]}} rows
 * @param {Map<string, any>} parcels
 */
export function todayListHtml({pending, done}, parcels) {
  const time = e => String(e.item.startTime || '99:99');
  const due = e => String(e.kind === 'work' ? (e.item.plannedDate || e.item.date || '') : (e.item.dueDate || ''));
  const open = pending.filter(e => !e.overdue).sort((a, b) => time(a).localeCompare(time(b)) || due(a).localeCompare(due(b)));
  const closed = done.filter(d => !open.some(e => e.item.id === d.item.id));
  const list = [...open.map(e => ({...e, isDone: false})), ...closed.map(e => ({...e, isDone: true}))];
  if (!list.length) return ''; // état vide illustré posé par app.js (emptyState)
  return html`<div class="home-today">${list.map(e => {
    const p = parcels.get(e.item.parcelId);
    const ha = e.kind === 'work' ? (Number(e.item.surfaceWorked) || Number(p?.surfaceHa) || 0) : 0;
    const meta = [p?.nom || (e.kind === 'task' ? 'Tâche' : ''), ha ? `${num(ha)} ha` : '', e.item.startTime ? `à ${e.item.startTime.replace(':', ' h ').replace(/ 00$/, '')}` : ''].filter(Boolean).join(' · ');
    const action = e.isDone ? (e.kind === 'work' ? 'reopen-work' : 'reopen-task') : (e.kind === 'work' ? 'finish-work' : 'finish-task');
    const title = titleOf(e);
    return html`<div class="home-row${e.isDone ? ' is-done' : ''}">
      <button type="button" class="home-row-main" data-action="${action}" data-id="${e.item.id}" aria-pressed="${e.isDone ? 'true' : 'false'}" aria-label="${title}${meta ? `, ${meta}` : ''} : ${e.isDone ? 'remettre à faire' : 'marquer comme fait'}">
        <span class="home-check" aria-hidden="true">${e.isDone ? '✓' : ''}</span>
        <span class="home-row-text"><b>${title}</b>${meta ? html`<small>${meta}</small>` : ''}</span>${badge(e.kind === 'work' ? e.item.type : e.item.title)}</button>
      <button type="button" class="home-row-more" data-action="${e.kind === 'work' ? 'edit-work' : 'edit-task'}" data-id="${e.item.id}" aria-label="Ouvrir ${title}">···</button></div>`;
  })}</div>`;
}

/**
 * Animaux au pré (sessions de pâturage en cours) : total et répartition par parcelle.
 * @param {any} data @param {Date} [date]
 */
export function animalsOut(data, date = new Date()) {
  const sessions = filterGrazingSessions(data?.grazingSessions || [], {status: 'current', date});
  const byParcel = new Map();
  for (const s of sessions) byParcel.set(s.parcelId, (byParcel.get(s.parcelId) || 0) + grazingTotal(s));
  const names = new Map((data?.parcelles || []).map(p => [p.id, p.nom]));
  const groups = [...byParcel.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    .map(([parcelId, n]) => ({parcelId, name: names.get(parcelId) || 'Parcelle', n}));
  return {total: groups.reduce((sum, g) => sum + g.n, 0), groups};
}

/** Carte « animaux au pré » : tap → onglet Troupeau. @param {{total: number, groups: {name: string, n: number}[]}} out */
export function animalsCardHtml(out) {
  const line = out.groups.length ? out.groups.slice(0, 3).map(g => `${g.name} : ${g.n}`).join(' · ') : 'Tous au bâtiment';
  return html`<button type="button" class="home-animals" data-view="herd">
    <span class="home-animals-n">${out.total}</span>
    <span class="home-animals-text"><b>${out.total > 1 ? 'animaux au pré' : 'animal au pré'}</b><small>${line}</small></span><span class="home-chevron" aria-hidden="true">›</span></button>`;
}

/**
 * Activité récente : trois derniers travaux terminés, pastille du type, parcelle et date.
 * @param {any[]} works @param {Map<string, string>} parcelNames @param {{today: string, dateOf: (w: any) => string, label: (iso: string) => string}} options
 */
export function recentListHtml(works, parcelNames, {today, dateOf, label}) {
  if (!works.length) return '';
  return html`<div class="home-recent">${works.slice(0, 3).map(w => {
    const d = dateOf(w);
    return html`<button type="button" class="home-recent-row" data-action="edit-work" data-id="${w.id}">${badge(w.type)}
      <span class="home-row-text"><b>${w.type || 'Travail'}</b><small>${parcelNames.get(w.parcelId) || 'Parcelle supprimée'}</small></span>
      <span class="home-recent-when">${d === today ? 'Aujourd’hui' : d ? label(d) : '—'}</span></button>`;
  })}</div>`;
}
