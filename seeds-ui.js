// n° 67 — Interface semences : section « Semence » du formulaire de travail (affichée pour un semis),
// ligne de semis dans la fiche parcelle et écran « Mes variétés » (essai variétal maison, semences
// de ferme pour la CVO, export CSV).
import {escapeHtml as e,download,localDate,campaignFor} from './utils.js';
import {DENSITY_UNITS,SEED_ORIGINS,CVO_NOTE,isSowingWork,normalizeSeed,seedKgPerHa,seedLabel,parcelSowing,varietyNames,varietyTrials,farmSavedSeed,seedStockItems,trialsCsv} from './seeds.js';
import {itemLots} from './stock-lots.js';

const n1=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}),n2=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}),n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
const FIELDS=['seedVariety','seedDensity','seedDensityUnit','seedTgw','seedLot','seedOrigin','seedTreatment','seedStockItemId','seedQuantityKg'];
const dayLabel=doy=>{if(doy===null)return'—';const d=new Date(Date.UTC(2025,0,doy));return d.toLocaleDateString('fr-FR',{day:'numeric',month:'short',timeZone:'UTC'});};

export function createSeedsUI({store,modal,toast}){
  const $=s=>document.querySelector(s);
  const data=()=>store.snapshot();
  let filter='';

  function sectionHtml(item){
    const s=item.seed||{},d=data(),items=seedStockItems(d);
    const lots=[...new Set(items.flatMap(i=>itemLots(d,i).map(l=>l.lotNumber)).filter(Boolean))];
    return`<details class="form-section seed-section" ${s.variety||s.lot?'open':''}><summary>Semence (variété, densité, lot)</summary><div class="form-grid">
<datalist id="seed-varieties">${varietyNames(d).map(v=>`<option value="${e(v)}"></option>`).join('')}</datalist><datalist id="seed-lots">${lots.map(v=>`<option value="${e(v)}"></option>`).join('')}</datalist>
<label>Variété<input name="seedVariety" list="seed-varieties" maxlength="80" autocomplete="off" value="${e(s.variety||'')}" placeholder="Cherchez ou saisissez"></label>
<label>Densité<input name="seedDensity" type="number" min="0" step="any" inputmode="decimal" value="${e(s.density??'')}"></label>
<label>Unité<select name="seedDensityUnit">${DENSITY_UNITS.map(u=>`<option ${s.densityUnit===u?'selected':''}>${u}</option>`).join('')}</select></label>
<label>PMG (g/1 000 grains)<input name="seedTgw" type="number" min="0" step="any" inputmode="decimal" value="${e(s.tgw??'')}"></label>
<label>Semence<select name="seedOrigin"><option value="">—</option>${SEED_ORIGINS.map(o=>`<option value="${o}" ${s.origin===o?'selected':''}>${o==='ferme'?'de ferme':o}</option>`).join('')}</select></label>
<label>Article de stock<select name="seedStockItemId"><option value="">—</option>${items.map(i=>`<option value="${e(i.id)}" ${s.stockItemId===i.id?'selected':''}>${e(i.name)}</option>`).join('')}</select></label>
<label>N° de lot<input name="seedLot" list="seed-lots" maxlength="60" value="${e(s.lot||'')}"></label>
<label>Quantité semée (kg)<input name="seedQuantityKg" type="number" min="0" step="any" inputmode="decimal" value="${e(s.quantityKg??'')}"></label>
<label class="span-2">Traitement de semence<input name="seedTreatment" maxlength="120" value="${e(s.treatment||'')}" placeholder="Produit appliqué sur la semence (à reporter au registre phyto)"></label>
<p class="form-note span-2" data-seed-dose></p></div></details>`;
  }

  /** Ajoute la section « Semence » au formulaire de travail ; visible seulement pour un semis. */
  function enhanceWorkForm(form,item={}){
    if(!form||form.querySelector('.seed-section'))return;
    const anchor=[...form.querySelectorAll('details.form-section')].at(-1);
    (anchor||form).insertAdjacentHTML(anchor?'beforebegin':'beforeend',sectionHtml(item));
    const section=form.querySelector('.seed-section');
    const refresh=()=>{const type=form.elements.type?.value||'';section.hidden=!(isSowingWork({type})||item.seed);
      const v=Object.fromEntries(FIELDS.map(k=>[k,form.elements[k]?.value??'']));const res=normalizeSeed(v),kg=seedKgPerHa(res.value),area=Number(String(form.elements.surfaceWorked?.value||'').replace(',','.'));
      const note=section.querySelector('[data-seed-dose]');if(note)note.textContent=kg!==null?`≈ ${n1.format(kg)} kg/ha${area>0?` · ${n0.format(kg*area)} kg pour ${n2.format(area)} ha`:''}`:'Densité en grains/m² + PMG : la dose en kg/ha est calculée.';};
    form.addEventListener('input',refresh);form.addEventListener('change',refresh);refresh();
  }

  /** Transforme les champs seed* du formulaire en work.seed ; renvoie un message d'erreur éventuel. */
  function applyToWork(entity){
    const v=Object.fromEntries(FIELDS.map(k=>[k,entity[k]]));for(const k of FIELDS)delete entity[k];
    if(!FIELDS.some(k=>v[k]!==undefined))return'';
    const res=normalizeSeed(v);if(res.error)return res.error;
    entity.seed=res.value||null; // null et non delete : upsert fusionne avec l’existant
    return'';
  }

  function parcelHtml(p){
    const w=parcelSowing(data(),p.id);if(!w)return'';const s=w.seed;
    return`<section class="panel seed-panel"><div class="panel-heading"><h2>Semis</h2><span class="pheno-flag">${e(w.campaignId||campaignFor(w.date))}</span></div><p><strong>${e(seedLabel(w))}</strong></p><p class="form-note">${[s.origin?`semence ${s.origin==='ferme'?'de ferme':'certifiée'}`:'',s.lot?`lot ${e(s.lot)}`:'',seedKgPerHa(s)!==null?`${n1.format(seedKgPerHa(s))} kg/ha`:'',s.treatment?`traitement : ${e(s.treatment)}`:''].filter(Boolean).join(' · ')||'Variété renseignée au semis.'}</p><button class="small-button" data-seeds="open">Mes variétés</button></section>`;
  }

  function open(){
    const d=data(),t=varietyTrials(d,{culture:filter}),cultures=[...new Set(varietyTrials(d).rows.map(r=>r.culture))].sort((a,b)=>a.localeCompare(b,'fr'));
    const campaign=campaignFor(new Date()),prev=campaignFor(new Date(Date.now()-365*864e5)),cvo=[...farmSavedSeed(d,{campaign}).map(x=>({...x,campaign})),...farmSavedSeed(d,{campaign:prev}).map(x=>({...x,campaign:prev}))];
    modal('Mes variétés','Essai variétal maison : variété, date de semis, rendement mesuré et coût semence, sur plusieurs campagnes.',`${cultures.length>1?`<div class="chip-row"><button type="button" class="small-button ${!filter?'is-active':''}" data-seeds="filter" data-culture="">Toutes</button>${cultures.map(c=>`<button type="button" class="small-button ${filter===c?'is-active':''}" data-seeds="filter" data-culture="${e(c)}">${e(c)}</button>`).join('')}</div>`:''}
${t.summary.length?`<div class="table-wrap"><table><thead><tr><th>Culture</th><th>Variété</th><th>Campagnes</th><th>Surface</th><th>Semis moyen</th><th>Rendement</th><th>Écart</th><th>Semence</th></tr></thead><tbody>${t.summary.map(s=>`<tr><td>${e(s.culture)}</td><td><strong>${e(s.variety)}</strong></td><td>${s.campaigns.length}</td><td>${n1.format(s.area)} ha</td><td>${dayLabel(s.meanSowingDay)}</td><td>${s.yieldTHa===null?'—':`${n2.format(s.yieldTHa)} t/ha`}${s.measured&&s.measured<s.sowings?` <small>(${s.measured}/${s.sowings})</small>`:''}</td><td>${s.gapPct===null?'—':`${s.gapPct>0?'+':''}${s.gapPct} %`}</td><td>${s.seedCostHa===null?'—':`${n0.format(s.seedCostHa)} €/ha`}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">Aucune variété renseignée : ouvrez un travail de semis et complétez la section « Semence ».</div>'}
${t.rows.length?`<h3>Détail des semis</h3><div class="stack-list">${t.rows.slice().reverse().slice(0,40).map(r=>`<div class="list-row"><div><strong>${e(r.variety)} · ${e(r.parcel?.nom||'Parcelle')}</strong><small>${e(r.culture)} · semé le ${e(localDate(r.date))} · ${r.area?`${n2.format(r.area)} ha`:'surface ?'}${r.yieldTHa!==null?` · ${n2.format(r.yieldTHa)} t/ha`:' · pas de lot de récolte'}${r.lot?` · lot ${e(r.lot)}`:''}${r.origin==='ferme'?' · semence de ferme':''}</small></div><button class="small-button" data-action="edit-work" data-id="${e(r.work.id)}">Semis</button></div>`).join('')}</div>`:''}
<h3>Semences de ferme ressemées</h3>${cvo.length?`<div class="stack-list">${cvo.map(c=>`<div class="list-row"><div><strong>${e(c.culture)} · ${e(c.campaign)}</strong><small>${n2.format(c.area)} ha · ${c.sowings} semis${c.unknown?` · ${c.unknown} sans dose`:''}</small></div><strong>${n2.format(c.kg/1000)} t</strong></div>`).join('')}</div>`:'<div class="empty-state">Aucun semis de semence de ferme sur les deux dernières campagnes.</div>'}
<p class="form-note">Le rendement vient des lots de récolte de la parcelle enregistrés après le semis (fiche parcelle › Récolte). Comparaison indicative : le sol, le précédent et l’année pèsent autant que la variété. ${e(CVO_NOTE)}</p>`,
    `<button class="button secondary" data-seeds="csv"${t.rows.length?'':' disabled'}>Export CSV</button><button class="button primary" data-action="close-modal">Fermer</button>`,'large');
  }

  async function action(name,control){
    if(name==='open')return open();
    if(name==='filter'){filter=control.dataset.culture||'';return open();}
    if(name==='csv'){download(`varietes-${new Date().toISOString().slice(0,10)}.csv`,trialsCsv(varietyTrials(data(),{culture:filter})),'text/csv;charset=utf-8');}
  }
  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-seeds]');if(!c||c.disabled)return;action(c.dataset.seeds,c).catch(error=>toast(error.message,'error'));});
  return{open,enhanceWorkForm,applyToWork,parcelHtml};
}
