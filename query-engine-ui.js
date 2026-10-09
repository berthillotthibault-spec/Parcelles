// Affichage des réponses du moteur de requêtes (n° 101) : chiffre, mini-tableau,
// recette du calcul et export CSV. Lecture seule.
import {answerQuery, formatDay, queryCsv, querySuggestions} from './query-engine.js';
import {escapeHtml as e, formatNumber, download} from './utils.js';

const MAX_ROWS = 8;
const isNum = v => /^-?[\d\s\u202f\u00a0,.]+$/.test(String(v));
const cell = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? formatDay(v) : v);

export function createQueryEngineUI({doc = globalThis.document, getState = () => ({}), toast = () => {}, now = () => Date.now()} = {}) {
  const results = new Map();
  let seq = 0;

  function answer(question) {
    const res = answerQuery(question, getState(), {now: now()});
    return res.recognized ? res : null;
  }

  function figure(res) {
    if (res.mixedUnits) return `<p class="query-figure is-text">${e(res.answer)}</p>`;
    const value = ['dates', 'parcels'].includes(res.query.measure) ? res.rows.length : res.value;
    return `<p class="query-figure"><strong>${e(formatNumber(value))}</strong> <span>${e(res.query.measure === 'dates' ? (value > 1 ? 'passages' : 'passage') : res.unit)}</span></p><p class="query-sentence">${e(res.answer)}</p>`;
  }

  function table(res) {
    if (!res.rows.length) return '<p class="query-empty">Aucune ligne à afficher.</p>';
    const shown = res.rows.slice(0, MAX_ROWS), more = res.rows.length - shown.length;
    return `<div class="query-table-wrap"><table class="query-table"><thead><tr>${res.columns.map((c, i) => `<th scope="col"${i && isNum(shown[0][i]) ? ' class="num"' : ''}>${e(c)}</th>`).join('')}</tr></thead><tbody>${shown.map(r => `<tr>${r.map((c, i) => `<td${i && isNum(c) ? ' class="num"' : ''}>${e(cell(c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${more > 0 ? `<p class="query-more">${more} ligne${more > 1 ? 's' : ''} de plus dans l’export.</p>` : ''}`;
  }

  function html(res) {
    const id = `q${++seq}`;
    results.set(id, res);
    if (results.size > 20) results.delete(results.keys().next().value);
    return `<section class="query-answer" data-query-result="${id}" aria-label="Réponse calculée">
<p class="query-eyebrow">Réponse calculée · lecture seule</p>
${figure(res)}
${res.filtersText.length ? `<p class="query-filters">${res.filtersText.map(t => `<span>${e(t)}</span>`).join('')}</p>` : ''}
${table(res)}
<details class="query-recipe"><summary>Comment c’est calculé</summary><p>${e(res.recipe)}</p>${res.notes.length ? `<ul>${res.notes.map(n => `<li>${e(n)}</li>`).join('')}</ul>` : ''}</details>
<div class="query-actions"><button type="button" class="small-button" data-query-export="${id}">Exporter (CSV)</button></div>
</section>`;
  }

  // Texte court enregistré dans l'historique de l'assistant.
  const text = res => `${res.answer} ${res.recipe}`;

  function suggestionsHtml({attr = 'data-assistant-ask', className = 'small-button'} = {}) {
    const list = querySuggestions(getState());
    return `<div class="query-suggestions" aria-label="Questions possibles"><p class="form-note">Questions possibles</p><div class="filter-row">${list.map(q => attr === 'data-query' ? `<button type="button" class="${className}" data-action="search-hint" data-query="${e(q)}">${e(q)}</button>` : `<button type="button" class="${className}" ${attr}="${e(q)}">${e(q)}</button>`).join('')}</div></div>`;
  }

  function exportResult(id) {
    const res = results.get(id);
    if (!res) return;
    download(`parcelles-question-${new Date(now()).toISOString().slice(0, 10)}.csv`, queryCsv(res), 'text/csv;charset=utf-8');
    toast('Tableau exporté en CSV.', 'success');
  }

  doc?.addEventListener?.('click', event => {
    const button = event.target?.closest?.('[data-query-export]');
    if (button) { event.preventDefault(); exportResult(button.dataset.queryExport); }
  });

  return {answer, html, text, suggestionsHtml, exportResult};
}
