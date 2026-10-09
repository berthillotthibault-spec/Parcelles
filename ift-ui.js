// n° 64 — Affichage de l'IFT : ligne de la fiche parcelle, historique sur 3 campagnes,
// détail par culture et pour l'exploitation. Calcul à la volée, rien n'est stocké.
import {escapeHtml as e,formatNumber,campaignFor} from './utils.js';
import {parcelIft,farmIft,iftHistory,iftLabel,IFT_REFERENCE_TABLE} from './ift.js';

const fr=v=>formatNumber(Math.round(v*100)/100);

export function createIftUI({store,modal,catalogLookup=()=>null}){
  const opts=()=>({catalog:catalogLookup});

  function parcelHtml(data,parcel){
    const r=parcelIft(data,parcel.id,campaignFor(),opts());
    if(!r.treatments)return'';
    return`<button type="button" class="ift-line" data-action="ift-open" data-id="${e(parcel.id)}"><span><small>IFT ${e(campaignFor())}</small><strong>${e(iftLabel(r))}</strong>${r.missing?`<small>${r.missing} traitement${r.missing>1?'s':''} sans dose de référence</small>`:''}</span><b aria-hidden="true">›</b></button>`;
  }

  function open(parcelId){
    const data=store.state,parcel=(data.parcelles||[]).find(p=>p.id===parcelId),campaign=campaignFor();
    const history=parcel?iftHistory(data,parcel.id,campaign,opts()):[],farm=farmIft(data,campaign,opts());
    const row=(label,r,extra='')=>`<tr><th scope="row">${e(label)}${extra}</th><td>${fr(r.total)}</td><td>${fr(r.herbicide)}</td><td>${fr(r.other)}</td><td>${fr(r.biocontrol)}</td></tr>`;
    const head='<thead><tr><th scope="col"></th><th scope="col">Total</th><th scope="col">Herbicides</th><th scope="col"><abbr title="Hors herbicides">Autres</abbr></th><th scope="col">Biocontrôle</th></tr></thead>';
    modal('Indice de fréquence de traitement',parcel?`${parcel.nom} · ${parcel.culture||'culture non renseignée'}`:'Exploitation',
      `<div class="ift-view">${parcel?`<h3>Historique de la parcelle</h3><div class="ift-table-wrap"><table class="ift-table">${head}<tbody>${history.map(h=>row(h.campaign,h,h.missing?` <small>(${h.missing} sans réf.)</small>`:'')).join('')}</tbody></table></div>`:''}
      <h3>Campagne ${e(campaign)} par culture</h3><div class="ift-table-wrap"><table class="ift-table">${head}<tbody>${farm.cultures.map(c=>row(`${c.culture} (${fr(c.surface)} ha)`,c)).join('')}${row('Exploitation',farm.farm)}</tbody></table></div>
      <p class="phyto-disclaimer"><strong>Indicatif.</strong> ${e(IFT_REFERENCE_TABLE.method)}. Table de référence millésime ${e(IFT_REFERENCE_TABLE.vintage)} (embarquée vide : saisissez vos doses de référence dans la fiche produit), à défaut dose homologuée de l’usage. Le biocontrôle est exclu du total. Moyennes pondérées par la surface.</p></div>`,
      '<button class="button primary" data-action="close-modal">Fermer</button>','large');
  }
  return{parcelHtml,open};
}
