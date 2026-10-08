// n° 114 — Consignes aux salariés : « Confier à… », « Mes tâches du jour » avec Démarrer / Terminer,
// vue du jour par personne et feuille d’heures hebdomadaire exportable en CSV.
// L’identité « Je suis… » est une préférence de cet appareil (non synchronisée).
import {
  myAgenda, knownPeople, assignPatch, unassignPatch, startPunch, finishPunch, runningEntry, punchedHours,
  isAssigned, itemTitle, timesheet, timesheetCsv, weekStart, formatHours, laborCostCandidates, applyLaborCost,
  normalizeName, isoDay
} from './team-work.js';
import {escapeHtml as e, downloadBlob} from './utils.js';

const CLOSED = new Set(['Terminé', 'Terminée', 'Annulé', 'Annulée']);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const clock = ms => new Date(ms).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'}).replace(':', ' h ');
const dayLabel = iso => {const d = new Date(`${iso}T12:00:00`); return `${d.toLocaleDateString('fr-FR', {weekday: 'short'})}<br>${d.getDate()}`;};
const shortDate = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short'});
const decimal = h => (Math.round(h * 100) / 100).toLocaleString('fr-FR', {maximumFractionDigits: 2});
const euro = v => Number(v).toLocaleString('fr-FR', {style: 'currency', currency: 'EUR'});

export function createTeamWorkUI({store, state, modal, closeModal, toast, bindChipChoices = () => {}, sync = null, canWrite = () => true, doc = globalThis.document, now = () => Date.now()} = {}) {
  let members = [];
  let sheetWeek = null;
  const data = () => state() || {};
  const prefs = () => data().preferences || {};
  const identity = () => String(prefs().teamIdentity || '').trim();
  const me = () => ({name: identity(), uid: sync?.user?.uid || ''});
  const today = () => isoDay(new Date(now()));
  const parcelName = id => (data().parcelles || []).find(p => p.id === id && !p.deletedAt)?.nom || '';
  const machineName = id => (data().materiels || []).find(m => m.id === id && !m.deletedAt)?.nom || '';
  const collection = kind => (kind === 'task' ? 'tasks' : 'interventions');
  const getItem = (kind, id) => store.get(collection(kind), id);

  async function loadMembers() {
    if (!sync?.workspaceId || typeof sync.listMembers !== 'function') return members;
    try {members = await sync.listMembers();} catch {members = [];}
    return members;
  }

  // ——— Accueil : « Mes tâches du jour » ———
  function rowHtml(r) {
    const {item, kind, state: st} = r;
    const parcel = parcelName(item.parcelId), machine = machineName(item.equipmentId);
    const meta = [parcel, r.overdue ? `en retard (${shortDate(r.date)})` : '', machine ? `Matériel : ${machine}` : '', item.product ? `Produit : ${item.product}` : ''].filter(Boolean).join(' · ');
    const running = runningEntry(item, me()) || runningEntry(item);
    let action = '';
    if (st === 'todo') action = `<button type="button" class="button primary team-act" data-team="start" data-kind="${kind}" data-id="${e(item.id)}">Démarrer</button>`;
    else if (st === 'running') action = `<span class="team-since">${running ? `Depuis ${clock(running.start)}` : 'En cours'}</span><button type="button" class="button primary team-act" data-team="finish" data-kind="${kind}" data-id="${e(item.id)}">Terminer</button>`;
    else action = `<span class="team-done">Terminé${punchedHours(item) > 0 ? ` · ${formatHours(punchedHours(item))}` : ''}</span>`;
    return `<li class="team-row is-${st}"><div class="team-row-main"><strong>${e(itemTitle(item, kind))}</strong>${meta ? `<small>${e(meta)}</small>` : ''}${item.instructions ? `<p class="team-instructions"><span class="sr-only">Consigne : </span>${e(item.instructions)}</p>` : ''}</div><div class="team-row-actions">${canWrite() ? action : ''}</div></li>`;
  }

  function homeHtml() {
    const name = identity();
    if (name) {
      const rows = myAgenda(data(), me(), today());
      if (!rows.length) return '';
      const todo = rows.filter(r => r.state !== 'done').length;
      return `<section class="panel team-home" aria-labelledby="team-home-title"><div class="panel-heading"><h2 id="team-home-title">Mes tâches du jour</h2><button type="button" class="text-button" data-team="open">Équipe</button></div>
        <p class="team-sub">${e(name)} · ${todo ? `${plural(todo, 'travail', 'travaux')} à faire` : 'tout est fait'}</p>
        <ul class="team-list">${rows.map(rowHtml).join('')}</ul></section>`;
    }
    const pending = [...(data().interventions || []).map(i => ['work', i]), ...(data().tasks || []).map(i => ['task', i])]
      .filter(([kind, i]) => i && !i.deletedAt && isAssigned(i) && !CLOSED.has(i.status) && (String(kind === 'task' ? i.dueDate || '' : i.plannedDate || i.date || '').slice(0, 10) || '0000') <= today());
    if (!pending.length) return '';
    const names = [...new Set(pending.map(([, i]) => i.assigneeName).filter(Boolean))];
    return `<button type="button" class="team-home-line" data-team="open"><span><strong>${plural(pending.length, 'travail confié', 'travaux confiés')} aujourd’hui</strong><small>${e(names.slice(0, 3).join(', '))}${names.length > 3 ? '…' : ''} · Choisissez qui vous êtes pour voir vos tâches</small></span><b aria-hidden="true">›</b></button>`;
  }

  function renderHome() {
    if (!doc) return;
    let root = doc.getElementById('my-tasks-home');
    if (!root) {
      const anchor = doc.getElementById('next-action');
      if (!anchor) return;
      root = doc.createElement('div'); root.id = 'my-tasks-home'; root.className = 'my-tasks-home';
      anchor.after(root);
    }
    root.innerHTML = homeHtml();
  }

  async function punch(kind, id, mode) {
    const item = getItem(kind, id);
    if (!item) return;
    if (!identity()) {openTeam(); return;}
    try {
      if (mode === 'start') {
        await store.upsert(collection(kind), startPunch(item, me(), now()), {label: `Démarré : ${itemTitle(item, kind)}`});
        toast(`Démarré : ${itemTitle(item, kind)} à ${clock(now())}.`);
      } else {
        const {item: done, hours} = finishPunch(item, me(), {kind, now: now(), today: today()});
        await store.upsert(collection(kind), done, {label: `Terminé : ${itemTitle(item, kind)}`});
        toast(`Terminé : ${itemTitle(item, kind)}${hours > 0 ? ` · ${formatHours(hours)} pointées` : ''}.`, 'success', {label: 'Annuler', run: () => store.upsert(collection(kind), item, {label: 'Pointage restauré'})});
      }
    } catch (error) {toast(error?.message || 'Pointage impossible.', 'error');}
  }

  // ——— Feuille « Consignes & heures » ———
  function identityHtml() {
    const name = identity();
    const people = knownPeople(data(), {members, identity: name}).slice(0, 6);
    if (name) return `<div class="team-identity"><span>Sur cet appareil, vous êtes <strong>${e(name)}</strong>.</span><button type="button" class="text-button" data-team="who-reset">Changer</button></div>`;
    return `<form id="team-who-form" class="team-who" novalidate><p class="team-who-title">Qui êtes-vous sur cet appareil ?</p>
      <input type="hidden" name="who" value="">
      ${people.length ? `<div class="chip-choices" data-chip-target="who" role="group" aria-label="Personnes">${people.map(p => `<button type="button" class="choice-chip" data-value="${e(p.name)}" aria-pressed="false">${e(p.name)}</button>`).join('')}</div>` : ''}
      <label class="field-label">Ou votre prénom<input name="whoOther" autocomplete="given-name" maxlength="60" placeholder="Ex. Paul"></label>
      <p class="form-error hidden" id="team-who-error" role="alert"></p>
      <button type="button" class="button secondary" data-team="who-save">Valider</button></form>`;
  }

  function overviewHtml() {
    const t = today();
    const groups = new Map();
    for (const [kind, list] of [['work', data().interventions], ['task', data().tasks]]) {
      for (const item of list || []) {
        if (!item || item.deletedAt || !isAssigned(item)) continue;
        const date = String(kind === 'task' ? item.dueDate || '' : item.plannedDate || item.date || '').slice(0, 10);
        const closed = CLOSED.has(item.status), doneToday = closed && kind === 'work' ? String(item.date || '').slice(0, 10) === t : closed && isoDay(new Date(Number(item.completedAt || item.updatedAt || 0))) === t;
        if (closed ? !doneToday : date && date > t) continue;
        const key = normalizeName(item.assigneeName) || item.assigneeId;
        if (!groups.has(key)) groups.set(key, {name: item.assigneeName || 'Sans nom', rows: []});
        groups.get(key).rows.push({kind, item, closed});
      }
    }
    if (!groups.size) return '<p class="team-empty">Aucun travail confié pour aujourd’hui.</p>';
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(g => `<section class="team-person"><h3>${e(g.name)}</h3><ul class="team-list">${g.rows.map(({kind, item, closed}) => {
      const run = runningEntry(item);
      const status = closed ? `Terminé${kind === 'work' && punchedHours(item) > 0 ? ` · ${formatHours(punchedHours(item))}` : ''}` : run ? `En cours depuis ${clock(run.start)}` : 'À faire';
      return `<li><button type="button" class="team-line" data-action="${kind === 'task' ? 'edit-task' : 'edit-work'}" data-id="${e(item.id)}"><span><strong>${e(itemTitle(item, kind))}</strong><small>${e([parcelName(item.parcelId), item.instructions ? `« ${item.instructions.slice(0, 60)}${item.instructions.length > 60 ? '…' : ''} »` : ''].filter(Boolean).join(' · '))}</small></span><span class="team-status is-${closed ? 'done' : run ? 'running' : 'todo'}">${e(status)}</span></button></li>`;
    }).join('')}</ul></section>`).join('');
  }

  function openTeam() {
    modal('Consignes & heures', 'Travail confié, pointage et feuille d’heures', `<div id="team-body" class="team-body">${identityHtml()}<h3 class="team-h">Aujourd’hui</h3><div id="team-overview">${overviewHtml()}</div></div>`,
      `${canWrite() ? '<button type="button" class="button primary team-wide" data-team="assign">Confier un travail</button>' : ''}<button type="button" class="button secondary team-wide" data-team="sheet">Feuille d’heures</button>`, 'small');
    bindWho();
    loadMembers().then(() => {const form = doc.getElementById('team-who-form'); if (form && members.length) {form.outerHTML = identityHtml(); bindWho();}});
  }

  function bindWho() {
    const form = doc.getElementById('team-who-form');
    if (form) bindChipChoices(form);
  }

  async function saveWho() {
    const form = doc.getElementById('team-who-form'), error = doc.getElementById('team-who-error');
    if (!form) return;
    const name = String(form.elements.whoOther.value || form.elements.who.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!name) {error.textContent = 'Champ obligatoire : votre prénom.'; error.classList.remove('hidden'); return;}
    await store.setPreferences({teamIdentity: name});
    toast(`Bonjour ${name} : vos tâches s’affichent sur l’accueil.`);
    openTeam();
  }

  // ——— « Confier à… » ———
  function pendingOptions(selected) {
    const works = (data().interventions || []).filter(w => w && !w.deletedAt && !CLOSED.has(w.status));
    const tasks = (data().tasks || []).filter(t => t && !t.deletedAt && !CLOSED.has(t.status));
    const label = (kind, item) => {
      const date = String(kind === 'task' ? item.dueDate || '' : item.plannedDate || item.date || '').slice(0, 10);
      return [itemTitle(item, kind), parcelName(item.parcelId), date ? shortDate(date) : '', item.assigneeName ? `confié à ${item.assigneeName}` : ''].filter(Boolean).join(' · ');
    };
    const opt = (kind, item) => `<option value="${kind}:${e(item.id)}" ${selected === `${kind}:${item.id}` ? 'selected' : ''}>${e(label(kind, item))}</option>`;
    return `<option value="new" ${selected === 'new' ? 'selected' : ''}>Nouvelle tâche…</option>${works.length ? `<optgroup label="Travaux à faire">${works.map(w => opt('work', w)).join('')}</optgroup>` : ''}${tasks.length ? `<optgroup label="Tâches">${tasks.map(t => opt('task', t)).join('')}</optgroup>` : ''}`;
  }

  async function openAssign({kind = '', id = ''} = {}) {
    await loadMembers();
    const selected = kind && id ? `${kind}:${id}` : 'new';
    const current = selected ? getItem(kind, id) : null;
    const people = knownPeople(data(), {members, identity: identity()}).slice(0, 6);
    const chosen = current?.assigneeName || '';
    const parcels = (data().parcelles || []).filter(p => p && !p.deletedAt && !p.archived).sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));
    const machines = (data().materiels || []).filter(m => m && !m.deletedAt);
    modal('Confier un travail', 'La personne le retrouve dans « Mes tâches du jour »', `<form id="team-assign-form" class="form-grid team-assign" novalidate>
      <input type="hidden" name="who" value="${e(people.some(p => p.name === chosen) ? chosen : '')}">
      <fieldset class="span-2"><legend>Confier à *</legend>${people.length ? `<div class="chip-choices" data-chip-target="who" role="group">${people.map(p => `<button type="button" class="choice-chip${p.name === chosen ? ' is-on' : ''}" data-value="${e(p.name)}" data-uid="${e(p.id)}" aria-pressed="${p.name === chosen}">${e(p.name)}</button>`).join('')}</div>` : ''}
        <label class="team-other">${people.length ? 'Autre personne' : 'Prénom de la personne'}<input name="whoOther" maxlength="60" autocomplete="off" value="${e(chosen && !people.some(p => p.name === chosen) ? chosen : '')}" placeholder="Ex. Paul"></label></fieldset>
      <label class="span-2">Travail *<select name="target">${pendingOptions(selected)}</select></label>
      <div class="span-2 team-new" id="team-new"${selected === 'new' ? '' : ' hidden'}>
        <label>Intitulé de la tâche *<input name="title" maxlength="120" placeholder="Ex. Déchaumage"></label>
        <label>Parcelle<select name="parcelId"><option value="">Aucune</option>${parcels.map(p => `<option value="${e(p.id)}">${e(p.nom || 'Parcelle')}</option>`).join('')}</select></label>
        <label>Échéance<input name="dueDate" type="date" value="${today()}"></label>
      </div>
      <label class="span-2">Consigne<textarea name="instructions" rows="3" maxlength="1000" placeholder="Ex. Commencer par le bas, attention au fossé côté route.">${e(current?.instructions || '')}</textarea></label>
      ${machines.length ? `<label class="span-2">Matériel<select name="equipmentId"><option value="">Aucun</option>${machines.map(m => `<option value="${e(m.id)}" ${current?.equipmentId === m.id ? 'selected' : ''}>${e(m.nom || 'Matériel')}</option>`).join('')}</select></label>` : ''}
      <p class="span-2 form-error hidden" id="team-assign-error" role="alert"></p></form>`,
    `${current && isAssigned(current) ? `<button type="button" class="button secondary" data-team="unassign" data-kind="${kind}" data-id="${e(id)}">Retirer l’attribution</button>` : ''}<button type="button" class="button primary team-save" data-team="assign-save">Confier</button>`, 'small');
    const form = doc.getElementById('team-assign-form');
    bindChipChoices(form);
    const toggleNew = () => {doc.getElementById('team-new').hidden = form.elements.target.value !== 'new';};
    form.elements.target.addEventListener('change', toggleNew);
    form.addEventListener('click', event => {if (event.target.closest('.choice-chip')) {form.elements.whoOther.value = ''; doc.getElementById('team-assign-error').classList.add('hidden');}});
  }

  async function saveAssign() {
    const form = doc.getElementById('team-assign-form'), error = doc.getElementById('team-assign-error');
    if (!form) return;
    const fail = (message, field) => {error.textContent = message; error.classList.remove('hidden'); field?.focus?.();};
    const other = form.elements.whoOther.value.trim();
    const chip = form.querySelector('.chip-choices .choice-chip.is-on');
    const name = other || form.elements.who.value;
    const uid = other ? '' : chip?.dataset.uid || '';
    if (!name) return fail('Champ obligatoire : confier à.', form.querySelector('.choice-chip') || form.elements.whoOther);
    const target = form.elements.target.value || 'new';
    const instructions = form.elements.instructions.value;
    const equipmentId = form.elements.equipmentId?.value || '';
    let kind, item;
    if (target === 'new') {
      const title = form.elements.title.value.trim();
      if (!title) return fail('Champ obligatoire : intitulé de la tâche.', form.elements.title);
      kind = 'task';
      item = {title, parcelId: form.elements.parcelId.value, dueDate: form.elements.dueDate.value, status: 'À faire', priority: 'Normale', note: ''};
    } else {
      const [k, id] = target.split(':');
      kind = k; item = getItem(k, id);
      if (!item) return fail('Ce travail n’existe plus.');
    }
    try {
      const patched = assignPatch(item, {name, id: uid, instructions, by: identity(), now: now()});
      if (equipmentId) patched.equipmentId = equipmentId;
      await store.upsert(collection(kind), patched, {label: `Confié à ${patched.assigneeName} : ${itemTitle(patched, kind)}`});
      closeModal();
      toast(`Confié à ${patched.assigneeName} : ${itemTitle(patched, kind)}.`);
    } catch (err) {fail(err?.message || 'Enregistrement impossible.');}
  }

  async function unassign(kind, id) {
    const item = getItem(kind, id);
    if (!item) return;
    await store.upsert(collection(kind), unassignPatch(item), {label: `Attribution retirée : ${itemTitle(item, kind)}`});
    closeModal();
    toast('Attribution retirée.', 'success', {label: 'Annuler', run: () => store.upsert(collection(kind), item, {label: 'Attribution restaurée'})});
  }

  // ——— Feuille d’heures ———
  function sheetBody() {
    const sheet = timesheet(data(), sheetWeek, {parcelName});
    const rate = Number(prefs().laborHourlyRate) || '';
    const candidates = laborCostCandidates(data(), rate);
    const people = sheet.people.length ? sheet.people.map(p => `<section class="team-sheet-person"><div class="team-sheet-head"><h3>${e(p.name)}</h3><strong>${formatHours(p.total)}</strong></div>
        <div class="team-week" role="table" aria-label="Heures de ${e(p.name)}"><div role="row" class="team-week-row">${sheet.days.map(d => `<span role="columnheader">${dayLabel(d)}</span>`).join('')}</div><div role="row" class="team-week-row">${sheet.days.map(d => `<span role="cell" class="${p.days[d] ? 'has-hours' : ''}">${p.days[d] ? decimal(p.days[d]) : '—'}</span>`).join('')}</div></div></section>`).join('')
      : '<p class="team-empty">Aucun pointage terminé cette semaine.</p>';
    return `<div class="team-week-nav"><button type="button" class="icon-button" data-team="week-prev" aria-label="Semaine précédente">‹</button><strong>Semaine du ${e(shortDate(sheet.start))}</strong><button type="button" class="icon-button" data-team="week-next" aria-label="Semaine suivante">›</button></div>
      ${people}
      ${sheet.running.length ? `<p class="team-note">${plural(sheet.running.length, 'pointage en cours, non compté', 'pointages en cours, non comptés')} tant qu’il n’est pas terminé.</p>` : ''}
      ${sheet.people.length ? `<p class="team-total">Total de la semaine : <strong>${formatHours(sheet.total)}</strong></p><button type="button" class="button secondary team-wide" data-team="csv">Exporter en CSV (paie)</button>` : ''}
      ${canWrite() ? `<form id="team-rate-form" class="team-rate" novalidate><label class="field-label">Coût horaire de main-d’œuvre (€/h, estimé)<input name="rate" type="text" inputmode="decimal" value="${rate ? String(rate).replace('.', ',') : ''}" placeholder="Ex. 18,50"></label>
        <p class="form-note">Sert à reporter les heures pointées dans le coût de main-d’œuvre des travaux terminés dont ce coût est vide. Valeur gardée sur cet appareil.</p>
        <p class="form-error hidden" id="team-rate-error" role="alert"></p>
        <button type="button" class="button secondary team-wide" data-team="labor">${candidates.length ? `Reporter dans les coûts (${plural(candidates.length, 'travail', 'travaux')}, ${euro(candidates.reduce((s, c) => s + c.cost, 0))})` : 'Reporter dans les coûts'}</button></form>` : ''}
      <p class="team-privacy">Les heures pointées sont des données personnelles : ne transmettez la feuille qu’à la personne concernée et au service de paie ou de remplacement.</p>`;
  }

  function openSheet() {
    sheetWeek = sheetWeek || weekStart(today());
    modal('Feuille d’heures', 'Pointages Démarrer / Terminer, par personne', `<div id="team-sheet-body" class="team-sheet">${sheetBody()}</div>`, '', 'small');
  }
  function refreshSheet() {const body = doc.getElementById('team-sheet-body'); if (body) body.innerHTML = sheetBody();}

  function exportCsv() {
    const sheet = timesheet(data(), sheetWeek, {parcelName});
    downloadBlob(`feuille-heures-${sheet.start}.csv`, new Blob([timesheetCsv(sheet)], {type: 'text/csv;charset=utf-8'}));
    toast('Feuille d’heures exportée.');
  }

  async function reportLabor() {
    const form = doc.getElementById('team-rate-form'), error = doc.getElementById('team-rate-error');
    const raw = String(form?.elements.rate.value || '').replace(',', '.').trim();
    const rate = Number(raw);
    if (!raw) {error.textContent = 'Champ obligatoire : coût horaire.'; error.classList.remove('hidden'); form.elements.rate.focus(); return;}
    if (!(Number.isFinite(rate) && rate > 0 && rate < 1000)) {error.textContent = 'Le coût horaire doit être un nombre positif.'; error.classList.remove('hidden'); return;}
    await store.setPreferences({laborHourlyRate: rate});
    const candidates = laborCostCandidates(data(), rate);
    if (!candidates.length) {refreshSheet(); toast('Aucun travail terminé à compléter : coût horaire enregistré.'); return;}
    const updated = candidates.map(c => applyLaborCost(store.get('interventions', c.id), rate)).filter(Boolean);
    try {
      if (typeof store.upsertMany === 'function') await store.upsertMany('interventions', updated, {label: `Main-d’œuvre reportée : ${updated.length}`});
      else for (const w of updated) await store.upsert('interventions', w, {label: `Main-d’œuvre : ${w.type}`});
      refreshSheet();
      toast(`Main-d’œuvre reportée sur ${plural(updated.length, 'travail', 'travaux')} (estimation).`);
    } catch (err) {error.textContent = err?.message || 'Report impossible.'; error.classList.remove('hidden');}
  }

  const shiftWeek = days => {const d = new Date(`${sheetWeek}T12:00:00`); d.setDate(d.getDate() + days); sheetWeek = isoDay(d); refreshSheet();};

  doc?.addEventListener('click', event => {
    const control = event.target.closest?.('[data-team]');
    if (!control) return;
    const action = control.dataset.team, kind = control.dataset.kind, id = control.dataset.id;
    if (action === 'open') openTeam();
    else if (action === 'start' || action === 'finish') punch(kind, id, action);
    else if (action === 'who-save') saveWho();
    else if (action === 'who-reset') store.setPreferences({teamIdentity: ''}).then(openTeam);
    else if (action === 'assign') openAssign();
    else if (action === 'assign-save') saveAssign();
    else if (action === 'unassign') unassign(kind, id);
    else if (action === 'sheet') {sheetWeek = weekStart(today()); openSheet();}
    else if (action === 'week-prev') shiftWeek(-7);
    else if (action === 'week-next') shiftWeek(7);
    else if (action === 'csv') exportCsv();
    else if (action === 'labor') reportLabor();
  });
  doc?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.target?.tagName !== 'INPUT') return;
    const form = event.target.closest?.('#team-who-form,#team-rate-form');
    if (!form) return;
    event.preventDefault();
    if (form.id === 'team-who-form') saveWho(); else reportLabor();
  });

  return {renderHome, open: openTeam, openAssign, openSheet};
}
