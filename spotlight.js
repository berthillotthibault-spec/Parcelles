// n° 120 : recherche globale « à la Spotlight ».
// Logique pure (testable sous Node) : index des outils et actions, tolérance d'une faute,
// recherches récentes et filtre de période (« travaux semaine dernière »).
import {normalize} from './utils.js';
import {parsePeriod} from './query-engine.js';

// Actions directes, en plus des outils de Plus : [mots-clés, libellé, action, description].
export const SPOTLIGHT_ACTIONS = [
  ['nouveau travail ajouter travail saisir', 'Nouveau travail', 'new-work', 'Saisir un travail'],
  ['nouvelle tache rappel', 'Nouvelle tâche', 'new-task', 'Ajouter une tâche'],
  ['nouvelle parcelle creer parcelle', 'Nouvelle parcelle', 'new-parcel', 'Dessiner ou saisir une parcelle'],
  ['nouveau lot sortir les vaches mise a l herbe animaux pre paturage', 'Sortir un lot au pré', 'new-grazing', 'Nouveau pâturage'],
  ['nouvelle observation constat anomalie', 'Nouvelle observation', 'new-observation', 'Noter un constat terrain'],
  ['nouveau materiel tracteur machine', 'Nouveau matériel', 'new-equipment', 'Ajouter un engin'],
  ['nouveau stock produit intrant', 'Nouveau produit en stock', 'new-stock', 'Ajouter un article'],
  ['nouveau client prestation', 'Nouveau client', 'new-client', 'Ajouter un client'],
  ['nouveau chantier', 'Nouveau chantier', 'new-chantier', 'Travail multi-parcelles'],
  ['exporter pac telepac declaration', 'Exporter / préparer la PAC', 'open-pac', 'Assistant PAC'],
  ['sauvegarde complete exporter mes donnees', 'Sauvegarde complète', 'export-complete-backup', 'Exporter toutes les données'],
  ['espace stockage plein quota proteger donnees liberer', 'Espace et protection des données', 'open-storage-care', 'Quota, protection et nettoyage'],
  ['corbeille restaurer supprime', 'Corbeille', 'open-trash', 'Restaurer un élément supprimé'],
  ['carte hors connexion tuiles', 'Carte hors connexion', 'open-offline-map', 'Télécharger les fonds de carte'],
  ['dicter journal vocal voix', 'Journal vocal', 'voice-journal', 'Dicter une note'],
  ['carte', 'Carte', 'palette-map', 'Ouvrir la carte'],
  ['theme sombre clair nuit', 'Basculer clair / sombre', 'toggle-theme', 'Apparence'],
  ['terrain gps', 'Mode terrain', 'open-field-mode', 'GPS et actions rapides'],
  ['meteo pluie vent', 'Météo', 'open-weather', 'Prévisions et seuils']
];

function levenshtein(a, b) {
  if (a === b) return 0; if (!a) return b.length; if (!b) return a.length;
  const prev = Array.from({length: b.length + 1}, (_, i) => i), cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) { cur[0] = i; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); for (let j = 0; j <= b.length; j++) prev[j] = cur[j]; }
  return prev[b.length];
}

// Score d'un mot cherché dans un texte : préfixe > inclusion > une faute (mots de 4 lettres et plus).
function wordScore(words, hay, token) {
  if (words.some(w => w.startsWith(token))) return 5;
  if (hay.includes(token)) return 3;
  if (token.length >= 4 && words.some(w => Math.abs(w.length - token.length) <= 1 && levenshtein(w, token) <= 1)) return 2;
  if (token.length >= 4 && words.some(w => w.length > token.length && levenshtein(w.slice(0, token.length), token) <= 1)) return 1;
  return 0;
}

// Fusionne les outils de Plus (MORE_CATEGORIES) et les actions directes, sans doublon d'action.
export function buildCommandIndex(categories = {}, actions = SPOTLIGHT_ACTIONS) {
  const out = [], seen = new Set();
  for (const [keywords, label, action, description] of actions) {
    if (seen.has(action)) continue; seen.add(action);
    out.push({label, action, description: description || '', kind: 'action', text: normalize(`${label} ${keywords} ${description || ''}`)});
  }
  for (const [key, category] of Object.entries(categories)) {
    for (const [title, description, action, iconName] of category.items || []) {
      if (seen.has(action)) continue; seen.add(action);
      out.push({label: title, action, description: description || '', icon: iconName, kind: 'tool', category: category.title || key, text: normalize(`${title} ${description || ''} ${category.title || ''}`)});
    }
  }
  return out;
}

// Commandes correspondant à la saisie : tous les mots doivent toucher (tolérance d'une faute).
export function matchCommands(query, index, {limit = 6, visible = () => true} = {}) {
  const tokens = normalize(query).split(/[^a-z0-9]+/).filter(t => t.length >= 2);
  if (!tokens.length) return [];
  const hits = [];
  for (const command of index) {
    if (!visible(command.action)) continue;
    const words = command.text.split(/[^a-z0-9]+/).filter(Boolean);
    let score = 0, ok = true;
    for (const token of tokens) { const s = wordScore(words, command.text, token); if (!s) { ok = false; break; } score += s; }
    if (!ok) continue;
    if (normalize(command.label).startsWith(tokens.join(' '))) score += 4;
    hits.push({command, score});
  }
  return hits.sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label, 'fr')).slice(0, limit).map(h => h.command);
}

// Recherches récentes : la plus récente en tête, sans doublon (casse et accents ignorés).
export function rememberSearch(list, query, max = 6) {
  const q = String(query || '').trim().replace(/\s+/g, ' ');
  const prev = Array.isArray(list) ? list.filter(x => typeof x === 'string') : [];
  if (q.length < 2) return prev.slice(0, max);
  return [q, ...prev.filter(x => normalize(x) !== normalize(q))].slice(0, max);
}

const PERIOD_WORDS = [
  /\b(la |cette )?semaine (derniere|passee)\b/, /\bcette semaine\b/, /\b(le )?mois (dernier|passe)\b/, /\bce mois( ci)?\b/,
  /\bcette annee\b/, /\bl an (dernier|passe)\b/, /\bl annee (derniere|passee)\b/, /\b(cette|la) campagne( en cours)?\b/,
  /\bcampagne (derniere|precedente)\b/, /\b(derniere|precedente) campagne\b/, /\bcampagne \d{4} ?[/ -] ?\d{2,4}\b/,
  /\b(en|au mois de|au mois d|mois de|de|d) ?(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)( \d{4})?\b/,
  /\ben 20\d{2}\b/, /\bhier\b/, /\baujourd hui\b/
];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Repère une période dans la saisie et renvoie le reste à chercher : {period:{from,to,label}|null, rest}.
export function extractPeriod(query, {now = Date.now()} = {}) {
  const q = String(query || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
  let period = null;
  const day = new Date(now); day.setHours(12, 0, 0, 0);
  if (/\b(la |cette )?semaine (derniere|passee)\b/.test(q)) {
    const d = new Date(day); d.setDate(d.getDate() - (d.getDay() + 6) % 7 - 7); const from = iso(d); d.setDate(d.getDate() + 6);
    period = {from, to: iso(d), label: 'la semaine dernière'};
  } else if (/\bhier\b/.test(q)) { const d = new Date(day); d.setDate(d.getDate() - 1); period = {from: iso(d), to: iso(d), label: 'hier'}; }
  else if (/\baujourd hui\b/.test(q)) period = {from: iso(day), to: iso(day), label: 'aujourd’hui'};
  else period = parsePeriod(q, {now});
  if (!period) return {period: null, rest: String(query || '').trim()};
  let rest = q; for (const re of PERIOD_WORDS) rest = rest.replace(re, ' ');
  return {period, rest: rest.replace(/\s+/g, ' ').trim()};
}

// Date de référence d'un résultat daté (null si le type n'est pas daté).
function rowDate(row, state) {
  const find = (type) => (state[type] || []).find(x => x.id === row.id);
  if (row.type === 'work') { const w = find('interventions'); return w ? String(w.status === 'Terminé' ? (w.date || w.plannedDate) : (w.plannedDate || w.date) || '').slice(0, 10) : null; }
  if (row.type === 'observation') { const o = find('observations'); return o ? String(o.date || '').slice(0, 10) : null; }
  if (row.type === 'task') { const t = find('tasks'); return t ? String(t.dueDate || '').slice(0, 10) : null; }
  if (row.type === 'chantier') { const c = find('chantiers'); return c ? String(c.plannedDate || '').slice(0, 10) : null; }
  return null;
}

// Ne garde que les résultats datés compris dans la période.
export function filterRowsByPeriod(rows, state, period) {
  if (!period) return rows;
  return rows.filter(row => { const d = rowDate(row, state); return Boolean(d) && d >= period.from && d <= period.to; });
}

// Une période repérée dans un nom de lieu (« La Campagne », « Champ de Mars ») ne doit pas masquer
// les résultats non datés (parcelles, clients…) trouvés avec la saisie complète.
const DATED_TYPES = new Set(['work', 'observation', 'task', 'chantier']);
export function withUndatedMatches(datedRows, allRows) {
  const seen = new Set(datedRows.map(r => `${r.type}:${r.id}`));
  return [...datedRows, ...allRows.filter(r => !DATED_TYPES.has(r.type) && !seen.has(`${r.type}:${r.id}`))];
}

// Quand la saisie n'est qu'un type + une période (« travaux semaine dernière »), liste les éléments datés de ce type.
const TYPE_WORDS = new Map([['travaux', 'work'], ['travail', 'work'], ['interventions', 'work'], ['observations', 'observation'], ['observation', 'observation'], ['taches', 'task'], ['tache', 'task'], ['chantiers', 'chantier'], ['chantier', 'chantier']]);
export function periodListing(rest, state, period) {
  const type = TYPE_WORDS.get(normalize(rest).trim());
  if (!type || !period) return null;
  const parcels = new Map((state.parcelles || []).map(p => [p.id, p.nom]));
  const source = {work: 'interventions', observation: 'observations', task: 'tasks', chantier: 'chantiers'}[type];
  return (state[source] || []).filter(x => !x.deletedAt).map(x => ({
    type, id: x.id,
    title: x.type || x.title || 'Élément',
    subtitle: [parcels.get(x.parcelId), x.status].filter(Boolean).join(' · ')
  })).filter(row => { const d = rowDate(row, state); return d && d >= period.from && d <= period.to; })
    .sort((a, b) => String(rowDate(b, state)).localeCompare(String(rowDate(a, state))));
}
