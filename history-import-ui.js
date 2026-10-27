// n° 124 — Interface « Je viens d'un autre logiciel » (module différé historyImport) : guide d'export
// par logiciel, choix du fichier d'historique et écran de correspondance des colonnes (parcelle et
// intervention), puis aperçu et import existants (session annulable).
import {escapeHtml as e} from './utils.js';
import {HISTORY_ACCEPT, HISTORY_PRESETS, DAPLOS_NOTE, presetKey, presetSteps, historyMapping, cleanMapping} from './history-import.js';

export function createHistoryImportUI({store, modal, closeModal, impex, inspect, chooseParcelsFile, doc = globalThis.document} = {}) {
  const $ = s => doc.querySelector(s);

  function openGuide(key = 'mesparcelles') {
    const k = presetKey(key);
    modal('Je viens d’un autre logiciel', 'Reprenez vos parcelles puis l’historique de vos travaux. Rien n’est écrit avant l’aperçu.',
      `<div class="chip-choices history-presets" role="group" aria-label="Logiciel d’origine">${Object.entries(HISTORY_PRESETS).map(([id, p]) => `<button type="button" class="choice-chip${id === k ? ' is-on' : ''}" data-preset="${e(id)}" aria-pressed="${id === k}">${e(p.label)}</button>`).join('')}</div>
      <ol class="history-steps">${presetSteps(k).map(t => `<li>${e(t)}</li>`).join('')}</ol>
      <p class="form-note">Colonnes attendues : parcelle, date et type d’intervention (obligatoires), produit, dose, unité et surface travaillée. Vous les associez à l’écran suivant.</p>
      <p class="notice info">${e(DAPLOS_NOTE)}</p>
      <input type="file" id="history-file" accept="${e(HISTORY_ACCEPT)}" multiple hidden><p class="form-error" id="history-error" hidden></p>`,
      `<button class="button secondary" id="history-parcels">Importer mes parcelles</button><button class="button primary" id="history-choose">Choisir l’historique (CSV, Excel)</button>`);
    doc.querySelectorAll('.history-presets [data-preset]').forEach(b => {b.onclick = () => openGuide(b.dataset.preset);});
    $('#history-parcels').onclick = () => {done(); closeModal(); chooseParcelsFile();}; // sans attente : le sélecteur de fichier exige le geste en cours
    const input = $('#history-file');
    $('#history-choose').onclick = () => input.click();
    input.onchange = async () => {
      const files = [...(input.files || [])], err = $('#history-error');
      if (!files.length) return;
      if (files.some(f => !/\.(csv|xlsx|xls)$/i.test(f.name))) {err.textContent = `Fichier non pris en charge : choisissez un CSV ou un Excel. ${DAPLOS_NOTE}`; err.hidden = false; input.value = ''; return;}
      await done();
      await inspect(files, historyMapping(k));
    };
  }
  // L'accueil de première ouverture est considéré comme fait dès qu'une reprise commence.
  const done = () => (store.state?.preferences?.onboardingComplete ? null : store.setPreferences({onboardingComplete: true}));

  function openMapping(preview, files) {
    const lib = impex(), options = lib.mappingOptions(preview), history = Boolean(preview.history), suggested = preview.suggestedMapping || {};
    const select = (key, label, required) => `<label>${e(label)}${required ? ' *' : ''}<select name="${e(key)}"><option value="">Non associé</option>${options.map(o => `<option value="${e(o)}" ${suggested[key] === o ? 'selected' : ''}>${e(o)}</option>`).join('')}</select></label>`;
    const parcelFields = history ? select('name', 'Parcelle', true) + select('commune', 'Commune', false) : lib.PARCEL_MAPPING_FIELDS.map(([k, l]) => select(k, l, k === 'name')).join('');
    const workFields = lib.WORK_MAPPING_FIELDS.map(([k, l]) => select(k, l, history && (k === 'date' || k === 'type'))).join('');
    modal('Correspondance des colonnes', history ? `Historique ${HISTORY_PRESETS[presetKey(preview.mapping?.preset)].label} : indiquez la colonne de chaque information. Les colonnes reconnues sont déjà choisies.` : 'Aucune parcelle n’a été reconnue automatiquement. Associez au minimum le nom.',
      `${history ? '' : '<p class="muted"><small>Fichier telepac ? <button type="button" class="text-button" data-action="open-telepac-import">Voir où le télécharger</button> · Historique d’un autre logiciel ? <button type="button" class="text-button" data-action="open-history-import">Je viens d’un autre logiciel</button></small></p>'}
      <form id="mapping-form" class="form-grid">${parcelFields}
      ${history ? `<h3 class="span-2">Intervention</h3>${workFields}<p class="form-note span-2">Chaque ligne devient un travail terminé, rattaché à la parcelle du même nom. ${e(DAPLOS_NOTE)}</p>` : `<details class="span-2 form-section"><summary>Historique de travaux (facultatif)</summary><div class="form-grid">${workFields}</div></details>`}
      <p class="form-error span-2" id="mapping-error" role="alert" hidden></p></form>`,
      `<button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="apply-mapping">${history ? 'Voir l’aperçu' : 'Ré-analyser'}</button>`);
    $('#apply-mapping').onclick = async () => {
      const mapping = cleanMapping(Object.fromEntries(new FormData($('#mapping-form'))), {history, preset: preview.mapping?.preset});
      const problem = lib.mappingErrors(mapping, {history}), err = $('#mapping-error');
      if (problem) {err.textContent = problem; err.hidden = false; return;}
      err.hidden = true;
      await inspect(files, mapping);
    };
  }

  return {openGuide, openMapping};
}
