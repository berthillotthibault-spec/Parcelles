// n° 114 — Consignes aux salariés : travail confié, « Mes tâches du jour », pointage et feuille d’heures.
// Logique pure, testable sous node:test. Aucun nouveau type d’entité : des champs optionnels sur les
// travaux (interventions) et les tâches existants :
//   assigneeName, assigneeId (uid cloud), instructions, assignedAt, assignedBy,
//   timeLog: [{id, personName, personId, start, end}] (horodatages en millisecondes).

const CLOSED = new Set(['Terminé', 'Terminée', 'Annulé', 'Annulée']);
const DONE = new Set(['Terminé', 'Terminée']);
const pad = n => String(n).padStart(2, '0');
export const isoDay = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const normalizeName = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const cleanName = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
const live = list => (Array.isArray(list) ? list : []).filter(item => item && !item.deletedAt);
const logOf = item => (Array.isArray(item?.timeLog) ? item.timeLog : []).filter(e => e && Number.isFinite(Number(e.start)));
const kindDate = (item, kind) => String(kind === 'task' ? item.dueDate || '' : item.plannedDate || item.date || '').slice(0, 10);
export const itemTitle = (item, kind) => (kind === 'task' ? item.title : item.type) || (kind === 'task' ? 'Tâche' : 'Travail');

export function isAssigned(item) {
  return Boolean(cleanName(item?.assigneeName) || item?.assigneeId);
}

// « Moi » : le nom choisi sur cet appareil, et l’identifiant du compte cloud s’il existe.
export function isMine(item, me = {}) {
  if (!item || !isAssigned(item)) return false;
  if (me.uid && item.assigneeId && item.assigneeId === me.uid) return true;
  const name = normalizeName(me.name);
  return Boolean(name) && normalizeName(item.assigneeName) === name;
}

export function runningEntry(item, person = null) {
  const key = person ? normalizeName(person.name) : null;
  return logOf(item).find(e => !e.end && (!key || normalizeName(e.personName) === key)) || null;
}

export function punchedHours(item, {now = null} = {}) {
  const ms = logOf(item).reduce((sum, e) => {
    const end = Number(e.end) || (now ? Number(now) : 0);
    return end > Number(e.start) ? sum + (end - Number(e.start)) : sum;
  }, 0);
  return ms / 3600000;
}

// Les travaux et tâches confiés à « moi » pour aujourd’hui : en cours, en retard, du jour ou sans date,
// et ceux terminés aujourd’hui (pour voir ce qui a été fait).
export function myAgenda(data = {}, me = {}, today = isoDay()) {
  const rows = [];
  for (const [kind, list] of [['work', data.interventions], ['task', data.tasks]]) {
    for (const item of live(list)) {
      if (!isMine(item, me)) continue;
      const date = kindDate(item, kind), closed = CLOSED.has(item.status);
      const running = runningEntry(item);
      if (closed) {
        const doneDay = kind === 'work' ? String(item.date || '').slice(0, 10) : isoDay(new Date(Number(item.completedAt || item.updatedAt || 0)));
        if (DONE.has(item.status) && doneDay === today) rows.push({kind, item, date, state: 'done'});
        continue;
      }
      if (running || item.status === 'En cours') rows.push({kind, item, date, state: 'running', since: running ? Number(running.start) : null});
      else if (!date || date <= today) rows.push({kind, item, date, state: 'todo', overdue: Boolean(date) && date < today});
    }
  }
  const rank = r => (r.state === 'running' ? 0 : r.state === 'todo' ? (r.overdue ? 1 : 2) : 3);
  return rows.sort((a, b) => rank(a) - rank(b) || String(a.date || '9999').localeCompare(String(b.date || '9999')) || String(a.item.startTime || '99').localeCompare(String(b.item.startTime || '99')) || String(a.item.id).localeCompare(String(b.item.id)));
}

// Personnes proposées pour « Confier à… » : membres cloud, personnes déjà désignées, opérateurs saisis.
export function knownPeople(data = {}, {members = [], identity = ''} = {}) {
  const people = new Map();
  const add = (name, id = '', weight = 1) => {
    const label = cleanName(name), key = normalizeName(label);
    if (!key) return;
    const previous = people.get(key);
    if (previous) {previous.score += weight; if (id && !previous.id) previous.id = id;}
    else people.set(key, {name: label, id: id || '', score: weight});
  };
  for (const m of Array.isArray(members) ? members : []) add(m.displayName || m.name || String(m.email || '').split('@')[0], m.uid || m.id || '', 3);
  for (const item of [...live(data.interventions), ...live(data.tasks)]) {
    if (item.assigneeName) add(item.assigneeName, item.assigneeId, 2);
    if (item.operator) add(item.operator, '', 1);
  }
  if (identity) add(identity, '', 0.5);
  return [...people.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr'));
}

export function assignPatch(item, {name, id = '', instructions = '', by = '', now = Date.now()} = {}) {
  const assigneeName = cleanName(name);
  if (!assigneeName) throw new Error('Champ obligatoire : personne.');
  return {...item, assigneeName, assigneeId: id || '', instructions: String(instructions || '').trim().slice(0, 1000), assignedAt: now, assignedBy: cleanName(by)};
}

export function unassignPatch(item) {
  return {...item, assigneeName: '', assigneeId: '', assignedAt: null};
}

export function startPunch(item, person = {}, now = Date.now()) {
  const personName = cleanName(person.name);
  if (!personName) throw new Error('Choisissez d’abord qui vous êtes.');
  if (CLOSED.has(item?.status)) throw new Error('Ce travail est déjà terminé.');
  if (runningEntry(item, person)) throw new Error('Pointage déjà démarré.');
  const entry = {id: `tl-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, personName, personId: person.uid || '', start: now, end: null};
  return {...item, status: 'En cours', timeLog: [...logOf(item), entry]};
}

// Termine : ferme le pointage en cours, passe le travail « Terminé » daté du jour (l’échéance reste
// dans plannedDate, comme « Terminer ») et reporte la durée pointée si aucune durée n’était saisie.
export function finishPunch(item, person = {}, {kind = 'work', now = Date.now(), today = isoDay(new Date(now))} = {}) {
  const key = normalizeName(person.name);
  const timeLog = logOf(item).map(e => (!e.end && (!key || normalizeName(e.personName) === key) ? {...e, end: Math.max(now, Number(e.start))} : e));
  const next = {...item, timeLog, status: 'Terminé'};
  const hours = punchedHours(next);
  if (kind === 'work') {
    next.plannedDate = item.plannedDate || item.date || '';
    next.date = today;
    const current = Number(item.duration);
    if (!(Number.isFinite(current) && current > 0) && hours > 0) next.duration = Math.round(hours * 100) / 100;
    if (!String(item.operator || '').trim() && cleanName(person.name)) next.operator = cleanName(person.name);
  } else {
    next.completedAt = now;
  }
  return {item: next, hours};
}

export function weekStart(dateIso = isoDay()) {
  const d = new Date(`${dateIso}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDay(d);
}
export function weekDays(start) {
  return Array.from({length: 7}, (_, i) => {const d = new Date(`${start}T12:00:00`); d.setDate(d.getDate() + i); return isoDay(d);});
}

// Feuille d’heures hebdomadaire par personne, à partir des pointages clos de la semaine.
// Un pointage à cheval sur minuit est compté au jour de son début.
export function timesheet(data = {}, start = weekStart(), {parcelName = () => ''} = {}) {
  const days = weekDays(start), inWeek = new Set(days);
  const people = new Map();
  const running = [];
  for (const [kind, list] of [['work', data.interventions], ['task', data.tasks]]) {
    for (const item of live(list)) {
      for (const e of logOf(item)) {
        const day = isoDay(new Date(Number(e.start)));
        if (!inWeek.has(day)) continue;
        if (!e.end) {running.push({personName: e.personName, item, kind, start: Number(e.start)}); continue;}
        const hours = Math.max(0, Number(e.end) - Number(e.start)) / 3600000;
        const key = normalizeName(e.personName) || '?';
        if (!people.has(key)) people.set(key, {name: cleanName(e.personName) || 'Sans nom', days: Object.fromEntries(days.map(d => [d, 0])), total: 0, entries: []});
        const p = people.get(key);
        p.days[day] += hours; p.total += hours;
        p.entries.push({day, start: Number(e.start), end: Number(e.end), hours, title: itemTitle(item, kind), parcel: parcelName(item.parcelId) || '', kind, id: item.id});
      }
    }
  }
  const list = [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  list.forEach(p => p.entries.sort((a, b) => a.start - b.start));
  return {start, days, people: list, running, total: list.reduce((s, p) => s + p.total, 0)};
}

const hhmm = ms => {const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`;};
const csvCell = value => {const s = String(value ?? ''); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;};
// CSV pour la paie ou le service de remplacement : séparateur « ; » et virgule décimale (Excel français).
export function timesheetCsv(sheet) {
  const rows = [['Personne', 'Date', 'Début', 'Fin', 'Durée (h)', 'Travail', 'Parcelle']];
  for (const p of sheet.people) for (const e of p.entries) rows.push([p.name, e.day, hhmm(e.start), hhmm(e.end), (Math.round(e.hours * 100) / 100).toString().replace('.', ','), e.title, e.parcel]);
  for (const p of sheet.people) rows.push([p.name, 'Total semaine', '', '', (Math.round(p.total * 100) / 100).toString().replace('.', ','), '', '']);
  return '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export function formatHours(hours) {
  const total = Math.round(Math.max(0, Number(hours) || 0) * 60);
  const h = Math.floor(total / 60), m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${pad(m)}` : `${h} h`;
}

// Report des heures pointées dans le coût de main-d’œuvre, uniquement là où il est vide.
// Le total du travail n’est ajusté que s’il était la somme des composantes (calcul automatique).
const COMPONENTS = ['machineCost', 'fuelCost', 'inputCost', 'operatorCost', 'otherCost'];
const n = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
export function laborCostCandidates(data = {}, rate) {
  const r = Number(rate);
  if (!(Number.isFinite(r) && r > 0)) return [];
  return live(data.interventions).filter(w => DONE.has(w.status) && !(n(w.operatorCost) > 0) && punchedHours(w) > 0).map(w => {
    const hours = Math.round(punchedHours(w) * 100) / 100;
    return {id: w.id, hours, cost: Math.round(hours * r * 100) / 100, title: itemTitle(w, 'work')};
  });
}
export function applyLaborCost(work, rate) {
  const hours = Math.round(punchedHours(work) * 100) / 100, r = Number(rate);
  if (!(hours > 0) || !(Number.isFinite(r) && r > 0) || n(work.operatorCost) > 0) return null;
  const operatorCost = Math.round(hours * r * 100) / 100;
  const components = COMPONENTS.reduce((s, k) => s + n(work[k]), 0);
  const auto = !(n(work.cost) > 0) || Math.abs(n(work.cost) - components) < 0.01;
  return {...work, operatorCost, laborRate: r, laborFromPunch: true, cost: auto ? Math.round((components + operatorCost) * 100) / 100 : work.cost};
}
