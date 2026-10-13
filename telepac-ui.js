// n° 115 : guide « Depuis telepac » (3 étapes) avant de choisir le ZIP SHP des parcelles déclarées.
// L'analyse et l'import réutilisent le flux habituel (aperçu, correspondance, annulation de l'import).
import {TELEPAC_NOTICE, TELEPAC_STEPS} from './telepac.js';
import {TELEPAC_URL} from './pac.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function telepacStepsHtml(){
  return`<ol class="telepac-steps">${TELEPAC_STEPS.map((step,i)=>`<li><span class="telepac-step-num" aria-hidden="true">${i+1}</span><span><strong>${esc(step.title)}</strong><small>${esc(step.detail)}</small></span></li>`).join('')}</ol>`;
}

export function createTelepacUI({modal,closeModal,chooseFile}){
  function open(){
    modal('Importer depuis telepac','Récupérez le fichier de vos parcelles déclarées, puis importez-le tel quel.',
      `${telepacStepsHtml()}<p class="notice info"><small>Le ZIP contient les fichiers .shp, .dbf, .shx et .prj : inutile de le décompresser. Les colonnes telepac sont reconnues d’office (îlot, parcelle, code culture, surface admissible). Vous vérifiez l’aperçu avant tout enregistrement, et l’import reste annulable depuis l’historique des imports.</small></p><p class="muted"><small>${esc(TELEPAC_NOTICE)}</small></p><p><a class="text-button" href="${esc(TELEPAC_URL)}" target="_blank" rel="noopener">Ouvrir telepac ›</a></p>`,
      `<button class="button secondary" data-action="close-modal">Fermer</button><button class="button primary" id="telepac-choose-file">Choisir le fichier ZIP</button>`,'small');
    const button=document.getElementById('telepac-choose-file');
    if(button)button.onclick=()=>{closeModal();chooseFile();};
  }
  return{open};
}
