// Graphiques en SVG fait main (n° 27) : fonctions pures qui renvoient une chaîne SVG.
// Couleurs : jetons CSS (classes chart-*) pour le clair et le sombre ; la couleur d'une
// culture suit l'entité (même couleur que la carte), jamais son rang.
// Animation d'entrée : pathLength=1 + stroke-dashoffset (CSS), sautée si reduced-motion.
// Chaque graphique porte un aria-label textuel. Aucune dépendance.

const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[c]));
const fmt = (value, digits = 1) => new Intl.NumberFormat('fr-FR', {maximumFractionDigits: digits}).format(Number(value) || 0);
const r2 = n => Math.round(n * 100) / 100;
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayMs = day => Date.parse(`${day}T12:00:00`);
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const shortDate = day => { const d = new Date(`${day}T12:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

// --- 1) Anneau d'assolement -------------------------------------------------
function arc(cx, cy, r, a0, a1) {
  const p = a => [r2(cx + r * Math.sin(a)), r2(cy - r * Math.cos(a))];
  const [x0, y0] = p(a0), [x1, y1] = p(a1), large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0} ${y0}A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

// segments : [{label, value, color}] ; renvoie le SVG de l'anneau (légende à part, en HTML).
export function donutChart(segments, {size = 168, thickness = 18, unit = 'ha', caption = 'Assolement', centerLabel = 'ha'} = {}) {
  const rows = (segments || []).filter(s => Number(s.value) > 0);
  const total = rows.reduce((s, x) => s + Number(x.value), 0);
  const label = `${caption} : ${fmt(total)} ${unit} au total. ${rows.map(s => `${s.label} ${fmt(s.value)} ${unit} (${fmt(s.value / total * 100, 0)} %)`).join(', ')}.`;
  const c = size / 2, r = c - thickness / 2 - 2;
  if (!total) return `<svg class="chart chart-donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(caption)} : aucune surface"><circle class="chart-track" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${thickness}"/></svg>`;
  const gap = rows.length > 1 ? Math.min(0.04, 2 / r) : 0;
  let a = 0;
  const paths = rows.map((s, i) => {
    const sweep = Number(s.value) / total * Math.PI * 2, a0 = a + gap / 2, a1 = a + sweep - gap / 2;
    a += sweep;
    const d = rows.length === 1 ? `M${c} ${c - r}A${r} ${r} 0 1 1 ${r2(c - 0.01)} ${c - r}` : arc(c, c, r, a0, Math.max(a0 + 0.001, a1));
    return `<path class="chart-anim" pathLength="1" d="${d}" fill="none" stroke="${esc(s.color)}" stroke-width="${thickness}" style="animation-delay:${i * 70}ms"><title>${esc(`${s.label} : ${fmt(s.value)} ${unit} (${fmt(s.value / total * 100, 0)} %)`)}</title></path>`;
  }).join('');
  return `<svg class="chart chart-donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(label)}"><circle class="chart-track" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${thickness}"/>${paths}<text class="chart-total" x="${c}" y="${c + 4}" text-anchor="middle">${esc(fmt(total))}</text><text class="chart-total-unit" x="${c}" y="${c + 24}" text-anchor="middle">${esc(centerLabel)}</text></svg>`;
}

// Surfaces par culture, triées, prêtes pour l'anneau.
export function cropSegments(parcels, color) {
  const by = new Map();
  for (const p of parcels || []) {
    if (p.deletedAt || p.archived) continue;
    const label = String(p.culture || '').trim() || 'Non renseignée';
    by.set(label, (by.get(label) || 0) + (Number(p.surfaceHa) || 0));
  }
  return [...by.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({label, value, color: color(label)}));
}

// --- 2) Frise de pâturage -----------------------------------------------------
// rows : [{label, sessions:[{start, end, count, type}]}] sur [from, to] (jours ISO).
export function grazingTimeline(rows, {from, to, width = 320, rowHeight = 22, today = isoDay(new Date())} = {}) {
  const left = 0, top = 4, axis = 18, span = Math.max(1, dayMs(to) - dayMs(from));
  const x = day => r2(left + (Math.min(Math.max(dayMs(day), dayMs(from)), dayMs(to)) - dayMs(from)) / span * width);
  const height = top + rows.length * (rowHeight + 6) + axis;
  const parts = [], spoken = [];
  rows.forEach((row, i) => {
    const y = top + i * (rowHeight + 6);
    parts.push(`<rect class="chart-track-fill" x="0" y="${y}" width="${width}" height="${rowHeight}" rx="4"/>`);
    for (const s of row.sessions) {
      const end = s.end || today;
      if (end < from || s.start > to) continue;
      const x0 = x(s.start), x1 = Math.max(x0 + 4, x(end)), days = Math.round((dayMs(end) - dayMs(s.start)) / 864e5) + 1;
      const text = `${row.label} : ${s.count ? `${s.count} ${s.type || 'animaux'}` : s.type || 'pâturage'} du ${shortDate(s.start)} au ${s.end ? shortDate(s.end) : 'aujourd’hui'} (${days} j)`;
      spoken.push(text);
      parts.push(`<rect class="chart-bar${s.end ? '' : ' is-current'}" x="${x0}" y="${y + 3}" width="${r2(x1 - x0)}" height="${rowHeight - 6}" rx="4"><title>${esc(text)}</title></rect>`);
    }
  });
  // Graduations mensuelles.
  const ticks = [];
  const d = new Date(`${from}T12:00:00`); d.setDate(1); d.setMonth(d.getMonth() + 1);
  while (isoDay(d) <= to) { ticks.push(isoDay(d)); d.setMonth(d.getMonth() + 1); }
  const step = ticks.length > 8 ? 2 : 1;
  const axisY = height - axis + 12;
  ticks.forEach((t, i) => {
    parts.push(`<line class="chart-grid" x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${height - axis}"/>`);
    if (i % step === 0) parts.push(`<text class="chart-axis" x="${x(t)}" y="${axisY}" text-anchor="middle">${esc(MONTHS[new Date(`${t}T12:00:00`).getMonth()])}</text>`);
  });
  if (today >= from && today <= to) parts.push(`<line class="chart-today" x1="${x(today)}" x2="${x(today)}" y1="${top - 2}" y2="${height - axis}"/>`);
  const label = spoken.length ? `Pâturage du ${shortDate(from)} au ${shortDate(to)} : ${spoken.join(' ; ')}.` : `Aucun pâturage du ${shortDate(from)} au ${shortDate(to)}.`;
  return `<svg class="chart chart-timeline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(label)}">${parts.join('')}</svg>`;
}

// --- 3) Sparkline sur 7 jours ---------------------------------------------------
export function sparkline(values, {width = 72, height = 22, label = 'Évolution', days = []} = {}) {
  const v = (values || []).map(n => Number(n) || 0);
  if (v.length < 2) return '';
  const max = Math.max(...v), min = Math.min(...v), range = max - min || 1, pad = 3;
  const pts = v.map((n, i) => [r2(pad + i * (width - pad * 2) / (v.length - 1)), r2(height - pad - (max === min ? 0.5 : (n - min) / range) * (height - pad * 2))]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('');
  const last = pts.at(-1);
  const spoken = `${label}, 7 derniers jours : ${v.map((n, i) => days[i] ? `${shortDate(days[i])} ${fmt(n, 0)}` : fmt(n, 0)).join(', ')}`;
  return `<svg class="chart chart-spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(spoken)}"><path class="chart-line chart-anim" pathLength="1" d="${d}" fill="none"/><circle class="chart-dot" cx="${last[0]}" cy="${last[1]}" r="2.5"/></svg>`;
}

// Séries de 7 jours pour les KPI de l'accueil (à faire, en retard, animaux au pré).
export function homeKpiSeries(state, today = isoDay(new Date())) {
  const days = Array.from({length: 7}, (_, i) => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() - 6 + i); return isoDay(d); });
  const live = key => (state?.[key] || []).filter(x => x && !x.deletedAt);
  const closed = s => ['Terminé', 'Terminée', 'Annulé', 'Fait'].includes(s);
  const items = [
    ...live('interventions').filter(w => w.status !== 'Annulé').map(w => ({due: String((closed(w.status) ? w.plannedDate || w.date : w.plannedDate || w.date) || '').slice(0, 10), doneOn: closed(w.status) ? String(w.date || '').slice(0, 10) : ''})),
    ...live('tasks').filter(t => t.status !== 'Annulé').map(t => ({due: String(t.dueDate || '').slice(0, 10), doneOn: closed(t.status) ? String(t.completedAt ? isoDay(new Date(t.completedAt)) : t.updatedAt ? isoDay(new Date(t.updatedAt)) : '').slice(0, 10) : ''})),
  ].filter(x => x.due);
  const todo = days.map(day => items.filter(x => x.due === day).length);
  const late = days.map(day => items.filter(x => x.due < day && (!x.doneOn || x.doneOn > day)).length);
  const animals = days.map(day => live('grazingSessions').filter(s => s.startDate && String(s.startDate).slice(0, 10) <= day && (!s.endDate || String(s.endDate).slice(0, 10) > day)).reduce((sum, s) => sum + (Array.isArray(s.animals) && s.animals.length ? s.animals.length + (Number(s.additionalAnimalsCount) || 0) : Number(s.animalsCount ?? s.count) || 0), 0));
  return {days, today: todo, overdue: late, grazing: animals};
}

// --- 4) Courbe NDVI ---------------------------------------------------------------
// points : [{date, ndvi, usable}] ; seules les images exploitables sont tracées.
export function ndviChart(points, {width = 320, height = 140} = {}) {
  const rows = (points || []).filter(p => p.usable && Number.isFinite(p.ndvi)).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 2) return '';
  const left = 26, right = 8, top = 8, bottom = 22, w = width - left - right, h = height - top - bottom;
  const t0 = dayMs(rows[0].date), t1 = dayMs(rows.at(-1).date), span = Math.max(1, t1 - t0);
  const lo = Math.min(0, ...rows.map(r => r.ndvi)), hi = 1;
  const X = d => r2(left + (dayMs(d) - t0) / span * w), Y = v => r2(top + (hi - v) / (hi - lo) * h);
  const grid = [0, 0.5, 1].filter(v => v >= lo).map(v => `<line class="chart-grid" x1="${left}" x2="${width - right}" y1="${Y(v)}" y2="${Y(v)}"/><text class="chart-axis" x="${left - 4}" y="${Y(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join('');
  const d = rows.map((r, i) => `${i ? 'L' : 'M'}${X(r.date)} ${Y(r.ndvi)}`).join('');
  const dots = rows.map(r => `<circle class="chart-dot" cx="${X(r.date)}" cy="${Y(r.ndvi)}" r="4"><title>${esc(`${shortDate(r.date)} : NDVI ${r.ndvi.toFixed(2)}`)}</title></circle>`).join('');
  const last = rows.at(-1), first = rows[0];
  const peak = rows.reduce((a, b) => (b.ndvi > a.ndvi ? b : a));
  const label = `NDVI de ${shortDate(first.date)} à ${shortDate(last.date)}, ${rows.length} images exploitables : ${first.ndvi.toFixed(2)} au départ, maximum ${peak.ndvi.toFixed(2)} le ${shortDate(peak.date)}, ${last.ndvi.toFixed(2)} à la dernière image.`;
  const axis = `<text class="chart-axis" x="${left}" y="${height - 6}">${esc(shortDate(first.date))}</text><text class="chart-axis" x="${width - right}" y="${height - 6}" text-anchor="end">${esc(shortDate(last.date))}</text>`;
  return `<svg class="chart chart-ndvi" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(label)}">${grid}<path class="chart-line chart-anim" pathLength="1" d="${d}" fill="none"/>${dots}${axis}</svg>`;
}
