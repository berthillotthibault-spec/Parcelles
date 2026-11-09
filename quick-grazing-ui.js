// Pâturage dans la feuille du « + » : choix du geste, puis Mettre au pré (prés, puis détails), Rentrer ou retirer du
// pré, Changer de pré. Écrit des passages (grazingSessions), jamais d'intervention, sauf date future (travail à faire).
// Logique dans quick-grazing.js ; ouvert par quick-work-ui.js, dans le même élément racine.
import {html, raw} from './safe-html.js';
import {icon} from './ui.js';
import {uid} from './utils.js';
import {endGrazingSession, moveGrazingLot, saveGrazingEntries} from './grazing-records.js';
import {longOpenLots} from './grazing.js';
import {herdLots, moveDestinations} from './herd-home.js';
import {closingCandidates, draftDate, draftSummary, formatDose, parcelFilters} from './quick-work.js';
import {HERD_FILTERS, buildGrazingEntries, categoryShortLabel, defaultGrazingFilter, finishedEntry, freshEntry, fullFormAllowed, grazingCategories, grazingClosings, grazingEntryAlerts,
  grazingGestures, grazingParcelRows, herdGroups, planLotMoves, plannedEntry, plannedGrazingWorks, presentPicks, selectedParcels, splitByArea} from './quick-grazing.js';

const DATES = [['today', 'Aujourd’hui'], ['yesterday', 'Hier'], ['custom', 'Autre date']];
const TITLES = {gesture: 'Que faites-vous ?', parcels: 'Sur quels prés ?', details: 'Mettre au pré', exit: 'Rentrer ou retirer du pré', move: 'Changer de pré', denied: 'Pâturage'};
const live = list => (Array.isArray(list) ? list : []).filter(item => item && !item.deletedAt);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const frDay = iso => String(iso).split('-').reverse().join('/');
const chip = (attrs, label, on) => html`<button type="button" class="qw-pill${on ? ' is-on' : ''}" aria-pressed="${on ? 'true' : 'false'}" ${attrs}>${label}</button>`;
const selected = on => (on ? raw(' selected') : '');

export function createQuickGrazingUI({store, state, toast, closeModal, todayIso, root, persistDraft, clearDraft, onBack, openGrazingForm = () => {}, openGrazingList = () => {}, cultureColor = () => 'var(--brand)'}) {
  let g = null;
  let saving = false;
  const can = action => !store.writeGuard || store.writeGuard({entity: 'grazingSessions', action, entityId: 'x'});
  const parcelName = id => live(state().parcelles).find(p => p.id === id)?.nom || 'Parcelle';
  const entryDate = () => draftDate(g.entry.dateChoice, todayIso(), g.entry.customDate);

  /** Ouvre le parcours ; options : parcelIds, entry (reprise du brouillon), workId et finishPlain (finish-work), date, note. */
  function start({type = 'Pâturage', parcelIds = [], entry = null, screen = '', workId = '', finishPlain = null, date = '', note = ''} = {}) {
    const data = state(), today = todayIso();
    const fresh = entry || freshEntry(data, {parcelIds});
    if (!entry && date && date !== today) { fresh.dateChoice = 'custom'; fresh.customDate = date; }
    const plan = !entry && workId ? store.get('interventions', workId)?.grazingPlan : null;
    if (plan) Object.assign(fresh, plannedEntry(plan));
    if (entry) fresh.picks = presentPicks(data, fresh.picks, draftDate(fresh.dateChoice, today, fresh.customDate)); // animal sorti depuis le brouillon
    const ways = grazingGestures(data, {today, parcelIds});
    const first = !can('create') ? 'denied' : screen || (workId || entry ? (fresh.parcelIds.length ? 'details' : 'parcels')
      : ways.skipToEntry ? (parcelIds.length ? 'details' : 'parcels') : 'gesture');
    g = {screen: first, type, entry: fresh, filter: defaultGrazingFilter(data), query: '', herdQuery: '', herdFilter: 'all', error: '', workId, finishPlain, workNote: note,
      exit: {ids: ways.hereIds.length ? ways.hereIds : (ways.lots.length === 1 ? [ways.lots[0].id] : []), date: today}, move: {lotId: ways.hereIds[0] || (ways.lots.length === 1 ? ways.lots[0].id : ''), dest: '', date: today, ack: '', all: false}, retry: null};
    render();
  }

  // ---------- Rendu ----------
  function headHtml() {
    const summary = ['parcels', 'details'].includes(g.screen) ? draftSummary(state(), {type: g.type, parcelIds: g.entry.parcelIds}) : '';
    return html`<div class="qw-head">
      <div class="qw-bar"><button type="button" class="qw-back" data-qg="back">‹ Retour</button>
        <span class="qw-kicker">Pâturage</span>
        <button type="button" class="qw-close" data-action="close-modal" aria-label="Fermer">${raw(icon('close', {size: 20}))}</button></div>
      <h3 class="qw-title" id="qw-title">${TITLES[g.screen]}</h3>
      ${summary ? html`<p class="qw-summary">${summary}</p>` : ''}</div>`;
  }

  function gestureHtml() {
    const today = todayIso(), {lots} = grazingGestures(state(), {today, parcelIds: g.entry.parcelIds}), long = longOpenLots(state(), {date: today});
    const row = (what, title, sub) => html`<button type="button" class="herd-dest" data-qg="${what}"><span class="herd-event-text"><b>${title}</b><small>${sub}</small></span><span aria-hidden="true">›</span></button>`;
    return html`<div class="herd-move">
      ${row('go-entry', 'Mettre au pré', 'Sortir un lot : effectif, catégorie, prés')}
      ${row('go-exit', 'Rentrer ou retirer du pré', plural(lots.length, 'lot au pré', 'lots au pré'))}
      ${row('go-move', 'Changer de pré', 'Le passage actuel est clos, un nouveau commence')}
      ${long.map(l => html`<div class="notice warning qg-long"><p>${l.label}</p><span class="qg-row">
        <button type="button" class="button secondary" data-qg="long-exit" data-id="${l.id}">Rentrer</button>
        <button type="button" class="button secondary" data-qg="long-move" data-id="${l.id}">Changer de pré</button>
        <button type="button" class="button secondary" data-qg="long-still" data-id="${l.id}">Toujours là</button></span></div>`)}</div>`;
  }

  function parcelRows() {
    const rows = grazingParcelRows(state(), {type: g.type, today: todayIso(), date: entryDate(), selected: g.entry.parcelIds, query: g.query, filter: g.filter});
    if (!rows.length) return html`<p class="qw-empty">Aucun pré ne correspond.</p>`;
    return rows.map(({parcel: p, selected: on, status, forage}) => html`<button type="button" class="qw-parcel${on ? ' is-on' : ''}" data-qg="parcel" data-id="${p.id}" role="checkbox" aria-checked="${on ? 'true' : 'false'}">
      <span class="qw-box" aria-hidden="true">${on ? '✓' : ''}</span>
      <span class="qw-parcel-text"><b>${p.nom}</b><small>${[p.culture, `${formatDose(Number(p.surfaceHa) || 0, 0)} ha`].filter(Boolean).join(' · ')}</small><small>${forage ? status : `Hors prairie · ${status}`}</small></span>
      <span class="qw-dot" style="background:${cultureColor(p.culture || '')}" aria-hidden="true"></span></button>`);
  }
  function parcelsHtml() {
    return html`<label class="qw-search"><span class="sr-only">Rechercher un pré</span>${raw(icon('search', {size: 18}))}<input id="qg-query" type="search" value="${g.query}" placeholder="Nom, culture ou commune" autocomplete="off"></label>
      <div class="qw-filters" role="group" aria-label="Filtrer les parcelles">${parcelFilters(state()).map(f => chip(html`data-qg="filter" data-filter="${f.id}"`, f.label, g.filter === f.id))}</div>
      <div class="qw-parcels" id="qg-parcels">${parcelRows()}</div>`;
  }

  function herdHtml() {
    const date = entryDate(), today = todayIso(), history = finishedEntry(g.entry, today);
    const origin = x => (history ? '' : x.lotName ? (x.lotOpen ? `déplacée depuis ${x.lotName}` : `dans ${x.lotName} à cette date`) : x.leavesName ? `quittera ${x.leavesName}` : '');
    const groups = herdGroups(state(), {date, today, query: g.herdQuery, filter: g.herdFilter});
    return html`<div class="qw-filters" role="group" aria-label="Filtrer le troupeau">${HERD_FILTERS.map(([id, label]) => chip(html`data-qg="herd-filter" data-filter="${id}"`, label, g.herdFilter === id))}</div>
      ${groups.length ? groups.map(group => html`<div class="qg-group"><div class="qg-group-head"><b>${group.label} (${group.animals.length})</b>
        <button type="button" class="text-button" data-qg="check-all" data-group="${group.id}">${group.animals.every(x => g.entry.picks[x.animal.id]) ? 'Tout décocher' : 'Tout cocher'}</button></div>
        ${group.animals.map(({animal: a, gestation, ...x}) => html`<label class="qg-animal"><input type="checkbox" data-qg-pick="${a.id}"${g.entry.picks[a.id] ? raw(' checked') : ''}>
          <span><b>${a.name || a.nationalId}</b><small>${[a.name ? a.nationalId : '', a.sex === 'F' ? 'femelle' : a.sex === 'M' ? 'mâle' : '', gestation ? 'gestante' : '', origin(x)].filter(Boolean).join(' · ')}</small></span></label>`)}</div>`)
      : html`<p class="qw-empty">Aucun animal ne correspond.</p>`}`;
  }

  function linesHtml(hasHerd) {
    const cats = grazingCategories(state()), lines = g.entry.lines;
    return html`<div class="qw-field"><span>${hasHerd ? 'Animaux sans numéro' : 'Combien d’animaux ?'}</span>
      ${lines.map((line, i) => html`<div class="qg-line"><input type="number" min="0" step="1" inputmode="numeric" data-qg-count="${i}" value="${line.count}" aria-label="Effectif" placeholder="0">
        <select data-qg-cat="${i}" aria-label="Catégorie"><option value=""${selected(!line.category)}>Catégorie non précisée (1 UGB)</option>${cats.map(c => html`<option value="${c.key}"${selected(line.category === c.key)}>${c.label} · ${formatDose(c.ugb, 0)} UGB</option>`)}</select>
        ${lines.length > 1 ? html`<button type="button" class="text-button" data-qg="del-line" data-line="${i}" aria-label="Retirer cette catégorie">Retirer</button>` : ''}</div>`)}
      <button type="button" class="text-button" data-qg="add-line">+ Autre catégorie dans ce lot</button>
      <small class="qg-note">Ovins, caprins, équins, bœufs : 1 UGB par animal, sans coefficient propre, à valider par vos soins.</small></div>`;
  }

  // Répartition à somme contrôlée : un tableau par catégorie, une ligne par pré.
  function splitHtml() {
    const e = g.entry, ids = e.parcelIds;
    if (ids.length < 2) return '';
    const parcels = selectedParcels(state(), ids);
    return html`<div class="qw-field"><span id="qg-split-label">Répartition entre les prés</span>
      <div class="qw-dates" role="group" aria-labelledby="qg-split-label">${chip(raw('data-qg="rotate" data-on=""'), 'Répartir', !e.rotate)}${chip(raw('data-qg="rotate" data-on="1"'), 'Le lot tourne entre ces prés', e.rotate)}</div>
      ${e.rotate ? html`<label class="qw-field"><span>Pré d’entrée</span><select id="qg-entry-parcel">${parcels.map(p => html`<option value="${p.id}"${selected(e.entryParcelId === p.id)}>${p.nom}</option>`)}</select></label>
        <small class="qg-note">Un seul passage, sur le pré d’entrée ; indiquez chaque rotation par « Changer de pré ». La présence simultanée sur plusieurs prés n’est pas modélisée.</small>`
      : e.lines.map((line, l) => {
        const total = Number(line.count) || 0, auto = splitByArea(total, parcels), alloc = e.alloc[l] || auto;
        return total ? html`<div class="qg-split"><b>${categoryShortLabel(line.category) || 'Animaux sans numéro'} : ${total}</b>
          ${parcels.map(p => html`<label class="qg-split-row"><span>${p.nom}</span><input type="number" min="0" step="1" inputmode="numeric" data-qg-alloc="${l}" data-parcel="${p.id}" value="${alloc[p.id] ?? 0}"></label>`)}
          <small id="qg-sum-${l}">${sumLabel(l, parcels)}</small></div>` : '';
      })}</div>`;
  }
  function sumLabel(l, parcels) {
    const line = g.entry.lines[l], total = Number(line.count) || 0, alloc = g.entry.alloc[l];
    if (!alloc) return 'Prérempli au prorata des surfaces.';
    const sum = parcels.reduce((n, p) => n + (Number(alloc[p.id]) || 0), 0);
    return sum === total ? `Somme correcte : ${sum}.` : `Somme ${sum} pour ${total} : à corriger.`;
  }
  // Avec plusieurs prés ou catégories, chaque animal coché va dans un seul pré et une seule catégorie.
  function pickedHtml() {
    const e = g.entry, ids = Object.keys(e.picks), manyParcels = e.parcelIds.length > 1 && !e.rotate, manyLines = e.lines.length > 1;
    if (!ids.length) return '';
    const animals = new Map(live(state().animals).map(a => [a.id, a]));
    const cat = categoryShortLabel(e.lines[0]?.category);
    const count = html`<p class="qg-note"><b>${plural(ids.length, 'animal coché', 'animaux cochés')}</b>${!manyLines ? ` · catégorie : ${cat || 'non précisée (1 UGB)'}, la même que les animaux sans numéro` : ''}</p>`;
    if (!manyParcels && !manyLines) return count;
    return html`${count}${ids.map(id => html`<div class="qg-line"><span>${animals.get(id)?.name || animals.get(id)?.nationalId || 'Animal'}</span>
      ${manyParcels ? html`<select data-qg-pick-parcel="${id}" aria-label="Pré">${e.parcelIds.map(p => html`<option value="${p}"${selected((e.picks[id].parcelId || e.parcelIds[0]) === p)}>${parcelName(p)}</option>`)}</select>` : ''}
      ${manyLines ? html`<select data-qg-pick-line="${id}" aria-label="Catégorie">${e.lines.map((line, i) => html`<option value="${i}"${selected((Number(e.picks[id].line) || 0) === i)}>${categoryShortLabel(line.category) || `Ligne ${i + 1}`}</option>`)}</select>` : ''}</div>`)}`;
  }

  function reentryKey() { return `${entryDate()}|${g.entry.parcelIds.join(',')}`; }
  function alertsHtml() {
    const date = entryDate(), e = g.entry, today = todayIso();
    const list = grazingEntryAlerts(state(), {parcelIds: e.rotate && e.parcelIds.length > 1 ? [e.entryParcelId] : e.parcelIds, date, endDate: e.endDate});
    const notes = [];
    const hasHerd = herdGroups(state(), {date}).length > 0, unnumbered = e.lines.reduce((n, line) => n + (Number(line.count) || 0), 0);
    if (hasHerd && unnumbered && !Object.keys(e.picks).length) notes.push(`${unnumbered > 1 ? `Ces ${unnumbered} animaux sans numéro s’ajoutent` : 'Cet animal sans numéro s’ajoute'} au troupeau enregistré, qui restera compté au bâtiment : cochez plutôt les animaux concernés.`);
    if (date < today && !e.endDate) notes.push(`Entrée du ${frDay(date)} : ce lot comptera comme encore au pré tant qu’aucune sortie n’est indiquée.`);
    if (date > today) notes.push(`Date future : un travail « À faire » sera créé pour le ${frDay(date)} ; à sa clôture, cette saisie s’ouvrira préremplie. Aucun animal n’est mis au pré d’ici là.`);
    const reentry = list.filter(a => a.kind === 'reentry');
    try {
      if (date <= today) {
        const plan = planLotMoves(state(), buildGrazingEntries(e, state(), {today, date}).animals, {date, today, endDate: e.endDate});
        for (const lot of plan.emptied) notes.push(`« ${lot.name} » se retrouve sans animal : il sera clos à son entrée.`);
        for (const lot of plan.closed) notes.push(`« ${lot.name} » sera clos le ${frDay(date)} : son historique est conservé.`);
        for (const row of plan.creates) notes.push(`${row.note || row.animalType} : le reste du lot (${row.animalsCount}) continue dans un nouveau passage à partir du ${frDay(date)}.`);
      }
    } catch { /* saisie incomplète : rien à annoncer */ }
    return html`${[...list.filter(a => a.kind !== 'reentry').map(a => a.message), ...notes].map(m => html`<p class="qw-phyto-line">${m}</p>`)}
      ${date <= today && reentry.length ? html`<div class="qw-phyto is-blocking" role="alert">${reentry.map(a => html`<p class="qw-phyto-line is-error">${a.message}</p>`)}
        ${e.reentryAck === reentryKey() ? html`<p class="qw-phyto-line">Mise au pré confirmée malgré le délai.</p>` : html`<button type="button" class="button secondary" data-qg="reentry-ack">Mettre au pré quand même</button>`}</div>` : ''}`;
  }

  function closingHtml() {
    const date = entryDate(), today = todayIso();
    const {works, tasks} = closingCandidates(state(), {type: g.type, parcelIds: g.entry.parcelIds, date, today});
    const items = [...works.filter(w => w.id !== g.workId).map(w => ({id: w.id, label: w.type || 'Travail', kind: 'travail prévu', parcelId: w.parcelId})),
      ...tasks.map(t => ({id: t.id, label: t.title || 'Tâche', kind: 'tâche', parcelId: t.parcelId}))];
    if (!items.length) return '';
    return html`<fieldset class="qw-closing"><legend>Sera aussi marqué fait</legend>${items.map(i => html`<label class="qw-close-item">
      <input type="checkbox" data-qg-skip="${i.id}"${g.entry.skip.includes(i.id) ? '' : raw(' checked')}><span><b>${i.label}</b><small>${i.kind} · ${parcelName(i.parcelId)}</small></span></label>`)}</fieldset>`;
  }

  // Le formulaire complet n'écrit que le passage : absent dès qu'il y a un lot à quitter ou un travail à clore.
  function fullHtml() {
    const e = g.entry, single = e.parcelIds.length === 1 && e.lines.length === 1 && entryDate() <= todayIso();
    return single && !g.retry && fullFormAllowed(e, {workId: g.workId}) ? html`<button type="button" class="text-button qw-full" data-qg="full">Formulaire complet</button>` : '';
  }

  function detailsHtml() {
    const e = g.entry, date = entryDate(), today = todayIso(), hasHerd = herdGroups(state(), {date}).length > 0;
    return html`<div class="qw-details">
      ${g.workNote ? html`<p class="notice info">${/^Prévu\b/.test(g.workNote) ? g.workNote : `Prévu : ${g.workNote}`}</p>` : ''}
      <div class="qw-field"><span id="qg-when">Date d’entrée</span><div class="qw-dates" role="group" aria-labelledby="qg-when">${DATES.map(([id, label]) => chip(html`data-qg="date" data-date="${id}"`, label, e.dateChoice === id))}</div>
        <input id="qg-custom-date" type="date" value="${e.customDate || today}"${e.dateChoice === 'custom' ? '' : raw(' hidden')} aria-label="Date d’entrée"></div>
      ${hasHerd ? html`<details class="qg-herd" open><summary>Choisir dans le troupeau</summary>
        <label class="qw-search"><span class="sr-only">Rechercher un animal</span>${raw(icon('search', {size: 18}))}<input id="qg-herd-query" type="search" value="${g.herdQuery}" placeholder="Nom ou numéro" autocomplete="off"></label>
        <div id="qg-herd">${herdHtml()}</div></details>` : ''}
      ${linesHtml(hasHerd)}
      <div id="qg-picked">${pickedHtml()}</div>
      <label class="qw-field"><span>Type d’animaux</span><input id="qg-type" list="qg-types" value="${e.animalType}" placeholder="Bovins, ovins, chevaux…"><datalist id="qg-types"><option value="Bovins"></option><option value="Ovins"></option><option value="Caprins"></option><option value="Chevaux"></option></datalist></label>
      <details class="qg-numbers"${e.numbers ? raw(' open') : ''}><summary>Saisir des numéros</summary><label class="qw-field"><span>Une ligne par numéro ou nom. Ajoutez « | gestante » si nécessaire.</span><textarea id="qg-numbers" rows="3" placeholder="FR1234567890&#10;FR1234567891 | gestante">${e.numbers}</textarea></label></details>
      <label class="qw-field"><span>Nom du lot</span><input id="qg-lot" value="${e.lotName}" placeholder="Facultatif, ex. Génisses du haut" autocomplete="off"></label>
      <div id="qg-split">${splitHtml()}</div>
      ${date > today ? '' : html`<label class="qw-field"><span>${date < today ? 'Encore au pré ? Sinon, date de sortie' : 'Sortie (facultative)'}</span><input id="qg-end" type="date" value="${e.endDate}" min="${date}"></label>`}
      <div id="qg-alerts">${alertsHtml()}</div>
      <div id="qg-closing">${closingHtml()}</div>
      <div id="qg-full">${fullHtml()}</div>
      ${g.finishPlain ? html`<button type="button" class="text-button qw-full" data-qg="finish-plain">Terminer sans animaux</button>` : ''}
      ${g.error ? html`<p class="form-error" role="alert">${g.error}</p>` : ''}</div>`;
  }

  function exitHtml() {
    const lots = herdLots(state(), {today: todayIso()});
    if (!lots.length) return html`<p class="qw-empty">Aucun lot au pré.</p>`;
    const minDate = lots.filter(l => g.exit.ids.includes(l.id)).reduce((a, l) => l.startDate > a ? l.startDate : a, '');
    return html`<div class="herd-move">${lots.map(l => html`<label class="qg-animal"><input type="checkbox" data-qg-exit="${l.id}"${g.exit.ids.includes(l.id) ? raw(' checked') : ''}><span><b>${l.name}</b><small>${plural(l.n, 'tête', 'têtes')} · ${l.parcelName} · jour ${l.days}</small></span></label>`)}
      <label class="qw-field"><span>Date de sortie</span><input id="qg-exit-date" type="date" value="${g.exit.date}" max="${todayIso()}"${minDate ? html` min="${minDate}"` : ''}></label>
      ${g.error ? html`<p class="form-error" role="alert">${g.error}</p>` : ''}</div>`;
  }

  function moveAlerts() {
    const m = g.move;
    if (!m.dest) return '';
    const list = grazingEntryAlerts(state(), {parcelIds: [m.dest], date: m.date}), reentry = list.filter(a => a.kind === 'reentry');
    return html`${list.filter(a => a.kind !== 'reentry').map(a => html`<p class="qw-phyto-line">${a.message}</p>`)}
      ${reentry.length ? html`<div class="qw-phyto is-blocking" role="alert">${reentry.map(a => html`<p class="qw-phyto-line is-error">${a.message}</p>`)}
        ${m.ack === `${m.dest}|${m.date}` ? html`<p class="qw-phyto-line">Déplacement confirmé malgré le délai.</p>` : html`<button type="button" class="button secondary" data-qg="move-ack">Déplacer quand même</button>`}</div>` : ''}`;
  }
  function moveHtml() {
    const today = todayIso(), m = g.move, lots = herdLots(state(), {today}), lot = lots.find(l => l.id === m.lotId);
    if (!lots.length) return html`<p class="qw-empty">Aucun lot au pré.</p>`;
    const dests = lot ? moveDestinations(state(), {fromParcelId: lot.parcelId, today: m.date, all: m.all}) : [];
    return html`<div class="herd-move"><div class="qw-field"><span id="qg-lot-label">Quel lot ?</span><div class="qw-filters" role="group" aria-labelledby="qg-lot-label">${lots.map(l => chip(html`data-qg="move-lot" data-id="${l.id}"`, `${l.name} · ${l.n} · ${l.parcelName}`, m.lotId === l.id))}</div></div>
      <label class="qw-field"><span>Date du changement</span><input id="qg-move-date" type="date" value="${m.date}" max="${today}"${lot ? html` min="${lot.startDate}"` : ''}></label>
      ${lot ? html`<div class="qw-field"><span>Vers quel pré ?</span>${dests.length ? dests.map(r => html`<button type="button" class="qw-parcel${m.dest === r.parcel.id ? ' is-on' : ''}" data-qg="move-dest" data-id="${r.parcel.id}" aria-pressed="${m.dest === r.parcel.id ? 'true' : 'false'}">
        <span class="qw-parcel-text"><b>${r.parcel.nom}</b><small>${formatDose(Number(r.parcel.surfaceHa) || 0, 0)} ha · ${r.status}</small></span></button>`) : html`<p class="qw-empty">Aucune autre prairie.</p>`}
        ${m.all ? '' : html`<button type="button" class="text-button" data-qg="move-all">Voir toutes les parcelles</button>`}</div>` : ''}
      <div id="qg-move-alerts">${moveAlerts()}</div>
      ${g.error ? html`<p class="form-error" role="alert">${g.error}</p>` : ''}</div>`;
  }

  function footHtml() {
    const labels = {parcels: g.entry.parcelIds.length ? 'Continuer' : 'Choisissez au moins un pré', details: g.retry ? 'Enregistrer le reste' : 'Enregistrer', exit: 'Enregistrer la sortie', move: 'Changer de pré'};
    const label = labels[g.screen];
    if (!label) return '';
    const off = g.screen === 'parcels' && !g.entry.parcelIds.length;
    return html`<div class="qw-foot"><button type="button" class="button primary qw-next" data-qg="next"${off ? raw(' disabled') : ''}>${label}</button></div>`;
  }

  function render({focus = ''} = {}) {
    const el = root();
    if (!el || !g) return;
    const body = {gesture: gestureHtml, parcels: parcelsHtml, details: detailsHtml, exit: exitHtml, move: moveHtml,
      denied: () => html`<p class="notice warning">Votre rôle ne permet pas d’enregistrer un pâturage.</p>`}[g.screen]();
    const scroller = el.querySelector('.qw-body'), top = scroller?.scrollTop || 0;
    el.innerHTML = String(html`${headHtml()}<div class="qw-body">${body}</div>${footHtml()}`);
    el.dataset.step = g.screen === 'parcels' ? '2' : '3';
    if (focus) { el.querySelector(focus)?.focus({preventScroll: true}); const next = el.querySelector('.qw-body'); if (next) next.scrollTop = top; }
    else {
      // Pas de focus par défaut dans un champ texte : le clavier virtuel cacherait la liste.
      const fallback = g.screen === 'parcels' ? el.querySelector('.qw-parcel.is-on') || el.querySelector('.qw-parcel') || el.querySelector('.qw-next')
        : el.querySelector('.qw-body button, .qw-body input[type="checkbox"]');
      fallback?.focus({preventScroll: true});
    }
  }
  function refresh() {
    const el = root();
    if (!el) return;
    for (const [id, fn] of [['#qg-alerts', alertsHtml], ['#qg-closing', closingHtml], ['#qg-picked', pickedHtml], ['#qg-full', fullHtml]]) { const box = el.querySelector(id); if (box) box.innerHTML = String(html`${fn()}`); }
  }
  // Échec partiel puis saisie modifiée : « le reste » calculé avant ne correspond plus, on l'oublie (n° 160).
  function dropRetry() {
    if (!g.retry) return;
    const n = g.retry.saved.length;
    g.retry = null;
    g.error = `Saisie modifiée : ${n > 1 ? `les ${n} passages déjà enregistrés restent` : 'le passage déjà enregistré reste'} ; le prochain enregistrement écrira toute la saisie, retirez ce qui l’est déjà.`;
    const box = root()?.querySelector('.form-error'); if (box) box.textContent = g.error;
  }
  function save() { dropRetry(); persistDraft({type: g.type, parcelIds: g.entry.parcelIds, step: 3, grazing: {entry: g.entry, screen: g.screen, workId: g.workId}}); }
  // Retour au choix du geste : la mise au pré est abandonnée, son brouillon aussi.
  function go(screen) { g.screen = screen; g.error = ''; if (['parcels', 'details'].includes(screen)) save(); else if (screen === 'gesture') clearDraft(); render(); }
  // L'erreur est en bas du contenu : on l'amène à l'écran, sinon l'appui semble sans effet sur téléphone.
  function fail(message) { g.error = message; render({focus: '.qw-next'}); root()?.querySelector('.form-error')?.scrollIntoView?.({block: 'center'}); }

  // ---------- Écritures ----------
  async function guarded(fn) {
    if (saving) return; // double appui : une seule écriture
    saving = true;
    const button = root()?.querySelector('.qw-next');
    if (button) button.disabled = true;
    try { await fn(); } finally {
      saving = false;
      const again = root()?.querySelector('.qw-next');
      if (again) again.disabled = false;
    }
  }

  async function saveEntry() {
    const data = state(), today = todayIso(), date = entryDate(), e = g.entry;
    if (date > today && g.workId) { fail('Ce travail est clos aujourd’hui ou à une date passée : choisissez-en une.'); return; }
    if (date > today) {
      let works;
      try { works = plannedGrazingWorks(e, data, {type: g.type, date, today, batchId: uid('batch')}); } catch (error) { fail(error.message); return; }
      try { await store.upsertMany('interventions', works, {label: `Pâturage prévu : ${works.length} pré${works.length > 1 ? 's' : ''}`}); }
      catch (error) { fail(error.message || 'Enregistrement impossible.'); return; }
      clearDraft(); closeModal();
      toast(`Entrée prévue le ${frDay(date)} : à retrouver dans le Planning.`, 'success');
      return;
    }
    let built;
    try { built = buildGrazingEntries(e, data, {today, date}); } catch (error) { fail(error.message); return; }
    const parcelsToCheck = [...new Set(built.entries.map(row => row.parcelId))];
    if (grazingEntryAlerts(data, {parcelIds: parcelsToCheck, date}).some(a => a.kind === 'reentry') && e.reentryAck !== reentryKey()) {
      fail('Délai de rentrée en cours : confirmez avec « Mettre au pré quand même », ou changez de pré ou de date.');
      return;
    }
    const plan = g.retry?.plan || planLotMoves(data, built.animals, {date, today, endDate: e.endDate});
    plan.creates = plan.creates.map(row => ({...row, id: row.id || uid('grazingSession')})); // ids fixés : un nouvel essai n'en crée pas d'autres
    const closing = closingCandidates(data, {type: g.type, parcelIds: e.parcelIds, date, today});
    const undoList = [];
    let saved;
    try {
      saved = [...(g.retry?.saved || []), ...await saveGrazingEntries(store, g.retry?.remaining || built.entries)];
    } catch (error) {
      if (error.remaining) g.retry = {saved: [...(g.retry?.saved || []), ...error.saved], remaining: error.remaining, plan};
      fail(error.message || 'Enregistrement impossible.');
      return;
    }
    g.retry = null;
    // Le passage existe : le reste (autres lots, fiches, travaux prévus) ne doit plus faire perdre la saisie.
    const after = [];
    const write = async (type, rows, label) => {
      if (!rows.length) return;
      const before = rows.map(row => store.get(type, row.id)).filter(Boolean);
      try { await store.upsertMany(type, rows, {label}); undoList.push(...before.map(row => [type, row])); }
      catch (error) { after.push(error?.message || label); }
    };
    // Une seule écriture : clore le lot d'origine et rouvrir le reste réussissent ou échouent ensemble.
    await write('grazingSessions', [...plan.updates, ...plan.creates], 'Lots d’origine mis à jour');
    if (!finishedEntry(e, today)) for (const row of saved) for (const item of grazingAnimalListOf(row)) {
      const animal = item.animalId ? store.get('animals', item.animalId) : null;
      if (animal) await store.upsert('animals', {...animal, sessionId: row.id}, {label: 'Lot de l’animal mis à jour'}).then(() => undoList.push(['animals', animal])).catch(() => {}); // sous contrôle du droit, comme la fiche animal
    }
    const closes = grazingClosings(store.state, {closing, date, skip: e.skip, workId: g.workId});
    await write('interventions', closes.works, `Travail prévu terminé : ${g.type}`);
    await write('tasks', closes.tasks, `Tâche terminée : ${g.type}`);
    clearDraft(); closeModal();
    const total = saved.reduce((sum, row) => sum + (Number(row.animalsCount) || 0), 0);
    const reminder = [built.unknownCategory ? 'Catégorie à préciser : 1 UGB par animal.' : '', built.noLotName ? 'Lot sans nom.' : '', after.length ? `À vérifier : ${after.join(' ; ')}` : ''].filter(Boolean).join(' ');
    const message = `${plural(total, 'animal au pré', 'animaux au pré')} depuis le ${frDay(date)} · à retrouver dans Troupeau.${reminder ? ` ${reminder}` : ''}`;
    // Annuler retire les passages créés : réservé aux rôles qui ont le droit de suppression.
    const undo = async () => {
      // Un lot d'origine jamais écrit (écriture refusée) n'est pas à retirer : l'annulation va jusqu'au bout.
      for (const row of [...saved, ...plan.creates].filter(r => store.get('grazingSessions', r.id))) await store.remove('grazingSessions', row.id);
      for (const [type, row] of undoList) await store.upsert(type, type === 'grazingSessions' ? {...row, endDate: row.endDate || null} : type === 'animals' ? {...row, sessionId: row.sessionId || ''} : row, {label: 'Mise au pré annulée'}); // upsert fusionne : les champs ajoutés se remettent explicitement
    };
    toast(message, after.length ? 'warning' : 'success', can('delete') ? {label: 'Annuler', run: undo} : {label: 'Voir', run: () => openGrazingList()});
  }

  async function saveExit() {
    const {ids, date} = g.exit, today = todayIso();
    if (!ids.length) { fail('Choisissez au moins un lot.'); return; }
    if (!date || date > today) { fail('La date de sortie ne peut pas être future.'); return; }
    const early = herdLots(state(), {today}).find(l => ids.includes(l.id) && date < l.startDate);
    if (early) { fail(`${early.name} : la sortie doit être au plus tôt le ${frDay(early.startDate)}, jour de l’entrée.`); return; }
    const before = [];
    for (const id of ids) {
      const row = store.get('grazingSessions', id);
      try { await endGrazingSession(store, id, {date}); before.push(row); }
      catch (error) {
        g.exit.ids = ids.filter(x => !before.some(b => b.id === x));
        fail(`${before.length ? `${plural(before.length, 'lot sorti', 'lots sortis')}. ` : ''}${error.message}`);
        return;
      }
    }
    clearDraft(); closeModal();
    const undo = async () => { for (const row of before) await store.upsert('grazingSessions', {...row, endDate: row.endDate || null}, {label: 'Sortie annulée'}); };
    toast(`${plural(before.length, 'lot retiré', 'lots retirés')} du pré le ${frDay(date)}.`, 'success', {label: 'Annuler', run: undo});
  }

  async function saveMove() {
    const m = g.move, today = todayIso();
    const lot = herdLots(state(), {today}).find(l => l.id === m.lotId);
    if (!lot) { fail('Choisissez le lot.'); return; }
    if (!m.dest) { fail('Choisissez le pré.'); return; }
    if (!m.date || m.date > today) { fail('La date ne peut pas être future.'); return; }
    if (m.date < lot.startDate) { fail(`La date doit être au plus tôt celle de l’entrée, le ${frDay(lot.startDate)}.`); return; }
    if (grazingEntryAlerts(state(), {parcelIds: [m.dest], date: m.date}).some(a => a.kind === 'reentry') && m.ack !== `${m.dest}|${m.date}`) { fail('Délai de rentrée en cours : confirmez avec « Déplacer quand même ».'); return; }
    const before = {...lot.session};
    let created;
    try { created = await moveGrazingLot(store, lot.session, m.dest, {date: m.date}); } catch (error) { fail(error.message || 'Déplacement impossible.'); return; }
    clearDraft(); closeModal();
    const undo = async () => { await store.remove('grazingSessions', created.id); await store.upsert('grazingSessions', {...before, endDate: before.endDate || null}, {label: `Déplacement annulé : ${lot.name}`}); };
    toast(`${lot.name} → ${parcelName(m.dest)}`, 'success', can('delete') ? {label: 'Annuler', run: undo} : {label: 'Voir', run: () => openGrazingList()});
  }

  function openFull() {
    const e = g.entry, date = entryDate(), line = e.lines[0];
    let animals = [], additional = Number(line.count) || 0;
    try { const built = buildGrazingEntries(e, state(), {today: todayIso(), date}); animals = built.entries[0]?.animals || []; additional = built.entries[0]?.additionalAnimalsCount ?? additional; } catch { /* saisie incomplète : le formulaire la fera compléter */ }
    clearDraft(); closeModal();
    openGrazingForm(null, {parcelId: e.parcelIds[0], startDate: date, endDate: e.endDate, animalType: e.animalType, animalCategory: line.category, note: e.lotName, additionalAnimalsCount: additional, animals});
  }

  // ---------- Interactions ----------
  function onClick(event) {
    const el = event.target.closest('[data-qg]');
    if (!el || !root()?.contains(el) || !g) return;
    const what = el.dataset.qg, e = g.entry;
    if (what === 'back') {
      if (g.screen === 'details') go('parcels');
      else if (g.screen === 'parcels' || g.screen === 'exit' || g.screen === 'move') {
        if (grazingGestures(state(), {today: todayIso()}).skipToEntry) { g = null; onBack(); } else go('gesture');
      } else { g = null; onBack(); }
    } else if (what === 'go-entry') go(e.parcelIds.length ? 'details' : 'parcels');
    else if (what === 'go-exit') go('exit');
    else if (what === 'go-move') go('move');
    else if (what === 'long-exit') { g.exit.ids = [el.dataset.id]; go('exit'); }
    else if (what === 'long-move') { g.move.lotId = el.dataset.id; go('move'); }
    else if (what === 'long-still') {
      store.setPreferences({grazingStillThere: {...(state().preferences?.grazingStillThere || {}), [el.dataset.id]: todayIso()}}).then(() => render()).catch(error => toast(error.message, 'error'));
    } else if (what === 'filter') { g.filter = el.dataset.filter; render({focus: `.qw-pill[data-filter="${CSS.escape(g.filter)}"]`}); }
    else if (what === 'parcel') {
      const id = el.dataset.id;
      e.parcelIds = e.parcelIds.includes(id) ? e.parcelIds.filter(x => x !== id) : [...e.parcelIds, id];
      if (!e.parcelIds.includes(e.entryParcelId)) e.entryParcelId = e.parcelIds[0] || '';
      e.alloc = {}; save(); render({focus: `.qw-parcel[data-id="${CSS.escape(id)}"]`});
    } else if (what === 'date') {
      e.dateChoice = el.dataset.date; e.reentryAck = ''; e.picks = presentPicks(state(), e.picks, entryDate()); save(); render({focus: `.qw-pill[data-date="${el.dataset.date}"]`});
    } else if (what === 'herd-filter') { g.herdFilter = el.dataset.filter; render({focus: `.qw-pill[data-qg="herd-filter"][data-filter="${el.dataset.filter}"]`}); }
    else if (what === 'check-all') {
      const group = herdGroups(state(), {date: entryDate(), query: g.herdQuery, filter: g.herdFilter}).find(x => x.id === el.dataset.group);
      if (group) {
        const all = group.animals.every(x => e.picks[x.animal.id]);
        for (const {animal} of group.animals) { if (all) delete e.picks[animal.id]; else e.picks[animal.id] ||= {line: 0, parcelId: ''}; }
        save(); render({focus: `[data-qg="check-all"][data-group="${CSS.escape(el.dataset.group)}"]`});
      }
    } else if (what === 'add-line') { e.lines.push({category: '', count: ''}); save(); render({focus: `[data-qg-count="${e.lines.length - 1}"]`}); }
    else if (what === 'del-line') {
      const i = Number(el.dataset.line);
      e.lines.splice(i, 1); e.alloc = {};
      // Seuls les animaux de la ligne retirée passent sur la 1re ; les lignes suivantes descendent d'un rang.
      for (const pick of Object.values(e.picks)) { const n = Number(pick.line) || 0; pick.line = n === i ? 0 : n > i ? n - 1 : n; }
      save(); render({focus: '[data-qg="add-line"]'});
    } else if (what === 'rotate') { e.rotate = el.dataset.on === '1'; if (!e.entryParcelId) e.entryParcelId = e.parcelIds[0]; save(); render({focus: `[data-qg="rotate"][data-on="${el.dataset.on}"]`}); }
    else if (what === 'reentry-ack') { e.reentryAck = reentryKey(); g.error = ''; refresh(); }
    else if (what === 'full') openFull();
    else if (what === 'finish-plain') { const run = g.finishPlain; clearDraft(); closeModal(); run?.(); }
    else if (what === 'move-lot') { g.move.lotId = el.dataset.id; g.move.dest = ''; g.move.ack = ''; g.error = ''; render({focus: `[data-qg="move-lot"][data-id="${CSS.escape(el.dataset.id)}"]`}); }
    else if (what === 'move-dest') { g.move.dest = el.dataset.id; g.error = ''; render({focus: `[data-qg="move-dest"][data-id="${CSS.escape(el.dataset.id)}"]`}); }
    else if (what === 'move-all') { g.move.all = true; render({focus: '#qg-move-date'}); }
    else if (what === 'move-ack') { g.move.ack = `${g.move.dest}|${g.move.date}`; g.error = ''; const box = root().querySelector('#qg-move-alerts'); if (box) box.innerHTML = String(html`${moveAlerts()}`); }
    else if (what === 'next') {
      if (g.screen === 'parcels') { if (e.parcelIds.length) go('details'); }
      else if (g.screen === 'details') guarded(saveEntry);
      else if (g.screen === 'exit') guarded(saveExit);
      else if (g.screen === 'move') guarded(saveMove);
    }
  }

  function onInput(event) {
    if (!g) return;
    const t = event.target, e = g.entry, data = t.dataset || {};
    if (t.id === 'qg-query') { g.query = t.value; const box = root().querySelector('#qg-parcels'); if (box) box.innerHTML = String(html`${parcelRows()}`); return; }
    if (t.id === 'qg-herd-query') { g.herdQuery = t.value; const box = root().querySelector('#qg-herd'); if (box) box.innerHTML = String(html`${herdHtml()}`); return; }
    if (t.id === 'qg-exit-date') { g.exit.date = t.value; return; }
    if (data.qgExit) { g.exit.ids = t.checked ? [...new Set([...g.exit.ids, data.qgExit])] : g.exit.ids.filter(x => x !== data.qgExit); return; }
    if (t.id === 'qg-move-date') { if (event.type === 'change') { g.move.date = t.value; g.move.ack = ''; render({focus: '#qg-move-date'}); } return; }
    if (t.id === 'qg-custom-date') { if (event.type !== 'change') return; e.customDate = t.value; e.reentryAck = ''; e.picks = presentPicks(state(), e.picks, entryDate()); save(); render({focus: '#qg-custom-date'}); return; }
    // Champ tapé : « change » arrive à la sortie du champ et réécrirait le bloc sous le doigt, le toucher suivant serait perdu.
    if (event.type === 'change' && t.matches('input:not([type="checkbox"]), textarea')) return;
    if (t.id === 'qg-end') e.endDate = t.value;
    else if (t.id === 'qg-type') e.animalType = t.value;
    else if (t.id === 'qg-lot') e.lotName = t.value;
    else if (t.id === 'qg-numbers') e.numbers = t.value;
    else if (t.id === 'qg-entry-parcel') { e.entryParcelId = t.value; e.reentryAck = ''; }
    else if (data.qgCount !== undefined) {
      e.lines[Number(data.qgCount)].count = t.value; delete e.alloc[data.qgCount];
      const box = root().querySelector('#qg-split'); if (box) box.innerHTML = String(html`${splitHtml()}`);
    } else if (data.qgCat !== undefined) {
      e.lines[Number(data.qgCat)].category = t.value;
      const box = root().querySelector('#qg-split'); if (box) box.innerHTML = String(html`${splitHtml()}`);
    } else if (data.qgAlloc !== undefined) {
      const parcels = selectedParcels(state(), e.parcelIds), l = data.qgAlloc;
      e.alloc[l] ||= splitByArea(Number(e.lines[l].count) || 0, parcels);
      e.alloc[l][data.parcel] = t.value;
      const sum = root().querySelector(`#qg-sum-${l}`); if (sum) sum.textContent = sumLabel(Number(l), parcels);
    } else if (data.qgPick) { if (t.checked) e.picks[data.qgPick] = {line: 0, parcelId: ''}; else delete e.picks[data.qgPick]; }
    else if (data.qgPickParcel) e.picks[data.qgPickParcel].parcelId = t.value;
    else if (data.qgPickLine) e.picks[data.qgPickLine].line = Number(t.value);
    else if (data.qgSkip) { e.skip = t.checked ? e.skip.filter(x => x !== data.qgSkip) : [...e.skip, data.qgSkip]; save(); return; }
    else return;
    save();
    // Ne pas réécrire un menu pendant qu'on le manipule : seuls les blocs de contrôle changent.
    if (!data.qgPickParcel && !data.qgPickLine) refresh();
  }

  return {start, onClick, onInput, active: () => Boolean(g), stop: () => { g = null; }};
}

function grazingAnimalListOf(row) { return Array.isArray(row?.animals) ? row.animals.filter(item => item && typeof item === 'object') : []; }
