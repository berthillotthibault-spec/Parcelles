// n° 93 — Interface du foncier : onglet « Foncier » de la parcelle, écran « Calculer les fermages »,
// avis d'échéance PDF par bailleur et rappels d'échéance à 18 mois.
import {escapeHtml as e,localDate} from './utils.js';
import {validateForm} from './form-chips-ui.js';
import {flowPdf,pdfFile,sharePdf} from './pdf-lite.js';
import {LEASE_TYPES,leaseTypeLabel,normalizeLease,fermageIndex,validateIndex,parcelRent,rentNotices,leaseReminders,noticePdfBlocks,FERMAGE_INDEX_REFERENCE,REMINDER_MONTHS} from './land.js';

const n2=new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
const eur=v=>v===null||v===undefined?'—':`${n2.format(v)} €`;
const todayIso=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

export function createLandUI({store,modal,toast}){
  const $=s=>document.querySelector(s);
  const data=()=>store.snapshot();
  const quintal=()=>{const v=Number(data().preferences?.fermageIndex?.quintalPrice);return Number.isFinite(v)&&v>0?v:null;};

  function reminderHtml(r){return`<li class="${r.expired?'is-danger':'is-warning'}">${e(r.parcel.nom)}${r.owner?` · ${e(r.owner)}`:''} : ${r.expired?`bail échu le ${e(localDate(r.endDate))}`:`échéance le ${e(localDate(r.endDate))} (dans ${Math.round(r.days/30)} mois)`}. Préparez le renouvellement ou le congé.</li>`;}

  function parcelHtml(p){
    const l=p.lease||{},r=parcelRent(p,{index:fermageIndex(data()),quintalPrice:quintal()}),rem=leaseReminders({parcelles:[p]},{today:todayIso()});
    return`<section class="panel land-panel"><div class="panel-heading"><h2>Foncier</h2></div>
${rem.length?`<ul class="stock-alerts">${rem.map(reminderHtml).join('')}</ul>`:''}
<form id="land-form" class="form-grid" data-id="${e(p.id)}">
<label>Propriétaire (bailleur)<input name="ownerName" maxlength="120" value="${e(l.ownerName||'')}" autocomplete="off"></label>
<label>Contact<input name="ownerContact" maxlength="160" value="${e(l.ownerContact||'')}" placeholder="Téléphone, e-mail ou adresse"></label>
<label class="span-2">Références cadastrales<input name="cadastre" maxlength="200" value="${e(l.cadastre||'')}" placeholder="Section et numéro, ex. AB 123, AB 124"></label>
<label>Type de bail<select name="leaseType"><option value="">Non renseigné</option>${LEASE_TYPES.map(([k,v])=>`<option value="${k}" ${l.leaseType===k?'selected':''}>${e(v)}</option>`).join('')}</select></label>
<label>Fermage exprimé en<select name="rentMode"><option value="eur" ${l.rentMode!=='q'?'selected':''}>€ par hectare</option><option value="q" ${l.rentMode==='q'?'selected':''}>Quintaux par hectare</option></select></label>
<label>Date de début<input name="startDate" type="date" value="${e(l.startDate||'')}"></label>
<label>Échéance<input name="endDate" type="date" value="${e(l.endDate||'')}"></label>
<label>Fermage de base (€/ha ou q/ha)<input name="rent" type="number" min="0" step="any" inputmode="decimal" value="${e(l.rent??'')}"></label>
<label>Indice de référence du bail<input name="baseIndex" type="number" min="50" max="500" step="any" inputmode="decimal" value="${e(l.baseIndex??'')}" placeholder="Indice de l’année de fixation"></label>
<label>Part de taxe foncière due (€/an)<input name="landTaxShare" type="number" min="0" step="any" inputmode="decimal" value="${e(l.landTaxShare??'')}"></label>
<p class="form-error span-2" id="land-error" role="alert" hidden></p></form>
<p class="form-note">${l.rent!==null&&l.rent!==undefined?`Fermage de l’échéance : ${r.total===null?`incalculable (${e(r.missing||'')} manquant)`:`${eur(r.perHa)}/ha, soit ${eur(r.total)}${r.indexed&&r.mode==='eur'?` (indexé × ${String(r.factor).replace('.',',')})`:r.mode==='eur'?' (non indexé : indice de référence absent)':''}`}.`:'Renseignez le fermage pour le calculer.'} Données nominatives : voir la page Confidentialité.</p>
<div class="land-actions"><button type="button" class="button primary" data-land="save">Enregistrer le foncier</button><button type="button" class="button secondary" data-action="open-land">Calculer les fermages</button></div></section>`;
  }

  async function saveParcel(){
    const form=$('#land-form');if(!form||!validateForm(form))return;const err=$('#land-error');
    const r=normalizeLease(Object.fromEntries(new FormData(form)));if(r.error){err.textContent=r.error;err.hidden=false;return;}
    const p=store.get('parcelles',form.dataset.id);if(!p)return;
    await store.upsert('parcelles',{...p,lease:r.value},{label:`Foncier de ${p.nom} enregistré`});toast('Foncier enregistré.','success');
  }

  function open(){
    const d=data(),idx=fermageIndex(d),q=quintal(),notices=rentNotices(d,{index:idx,quintalPrice:q}),rem=leaseReminders(d,{today:todayIso()});
    const total=notices.reduce((s,n)=>s+n.total,0);
    modal('Foncier et fermages',`${notices.length} bailleur(s) · total des échéances ${eur(total)}`,`
${rem.length?`<h3>Échéances à moins de ${REMINDER_MONTHS} mois</h3><ul class="stock-alerts">${rem.map(reminderHtml).join('')}</ul>`:''}
<details class="land-index"${idx.prefilled?' open':''}><summary>Indice national des fermages ${e(idx.year||'')} : ${e(String(idx.value).replace('.',','))}${idx.prefilled?' (pré-rempli)':''}</summary>
<form id="land-index-form" class="form-grid"><label>Année<input name="year" type="number" min="2000" max="2100" step="1" required value="${e(idx.year||new Date().getFullYear())}"></label><label>Indice<input name="value" type="number" min="50" max="500" step="0.01" required inputmode="decimal" value="${e(idx.value)}"></label><label>Prix du quintal de blé fermage (€/q)<input name="quintalPrice" type="number" min="0" step="0.01" inputmode="decimal" value="${e(q??'')}"></label><p class="form-error span-2" id="land-index-error" role="alert" hidden></p></form>
<p class="form-note">${e(idx.prefilled?`${FERMAGE_INDEX_REFERENCE.source} ${FERMAGE_INDEX_REFERENCE.verify}`:`Indice saisi le ${idx.date?localDate(idx.date):'—'}. ${FERMAGE_INDEX_REFERENCE.verify}`)}</p>
<button type="button" class="button secondary" data-land="index-save">Enregistrer l’indice</button></details>
<div class="stack-list">${notices.map((n,i)=>`<div class="list-row"><div><strong>${e(n.owner)}</strong><small>${n.parcels.length} parcelle(s) · ${e(String(n.area).replace('.',','))} ha · fermages ${e(eur(n.rent))} · taxe foncière ${e(eur(n.tax))}${n.missing?` · ${n.missing} non calculable(s)`:''}</small></div><div class="land-row-actions"><strong>${e(eur(n.total))}</strong><button type="button" class="small-button" data-land="pdf" data-index="${i}">Avis PDF</button></div></div>`).join('')||'<div class="empty-state">Aucun bail renseigné : ouvrez une parcelle, onglet « Foncier ».</div>'}</div>
<p class="form-note">Calcul indicatif : fermage de base × indice de l’année / indice de référence du bail ; en quintaux, quintaux × prix fixé par arrêté préfectoral. Vérifiez les clauses de chaque bail.</p>`,
      `<button type="button" class="button primary" data-action="close-modal">Fermer</button>`,'large');
  }

  async function action(name,control){
    if(name==='save')return saveParcel();
    if(name==='index-save'){const f=$('#land-index-form');if(!validateForm(f))return;const r=validateIndex(Object.fromEntries(new FormData(f)));if(r.error){const err=$('#land-index-error');err.textContent=r.error;err.hidden=false;return;}await store.setPreferences({fermageIndex:{...r.value,enteredAt:Date.now()}});toast('Indice enregistré.','success');return open();}
    if(name==='pdf'){
      const d=data(),idx=fermageIndex(d),q=quintal(),n=rentNotices(d,{index:idx,quintalPrice:q})[Number(control.dataset.index)];if(!n)return;
      const title=`Avis d’échéance ${n.owner}`;
      const file=pdfFile(flowPdf(noticePdfBlocks(n,{farm:d.exploitation||{},index:idx,quintalPrice:q,today:todayIso()}),{title,footer:`${title} · calcul indicatif`}),title);
      const how=await sharePdf(file,{title});if(how!=='cancelled')toast(how==='shared'?'Avis partagé.':'Avis téléchargé.','success');
    }
  }
  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-land]');if(!c||c.disabled)return;c.disabled=true;action(c.dataset.land,c).catch(err=>toast(err.message,'error')).finally(()=>{c.disabled=false;});});
  return{parcelHtml,open};
}
