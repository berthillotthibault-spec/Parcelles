// n° 96 — Écran « Pour mon comptable » : période, aperçu par compte et TVA, exports CSV et XLSX,
// plan de catégories modifiable (préférences). Présenté comme une aide, jamais comme une comptabilité.
import {escapeHtml as e,download,downloadBlob} from './utils.js';
import {validateForm} from './form-chips-ui.js';
import {loadVendor} from './vendor-loader.js';
import {accountingRows,accountSummary,operationsCsv,stocksCsv,workbookSheets,validatePlan,accountingPlan,ACCOUNT_CATEGORIES,VAT_CHOICES,DISCLAIMER} from './accounting-export.js';

const n2=new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
const eur=v=>v===null||v===undefined?'—':`${n2.format(v)} €`;
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export function createAccountingExportUI({store,modal,toast}){
  const data=()=>store.snapshot?store.snapshot():store.state;
  const now=new Date();
  let period={from:`${now.getFullYear()}-01-01`,to:iso(now)};

  function planForm(plan){
    return`<details class="ae-plan"><summary>Plan de catégories (comptes et TVA)</summary><form id="ae-plan-form" class="form-grid">${ACCOUNT_CATEGORIES.map(c=>`<label>${e(c.label)}<span class="nm-field"><input name="account_${c.key}" inputmode="numeric" pattern="[0-9]{3,10}" value="${e(plan[c.key].account)}" aria-label="Compte ${e(c.label)}"><select name="vat_${c.key}" aria-label="TVA ${e(c.label)}"><option value="">TVA à saisir</option>${VAT_CHOICES.map(v=>`<option value="${v}"${plan[c.key].vatRate===v?' selected':''}>${String(v).replace('.',',')} %</option>`).join('')}</select></span></label>`).join('')}<p class="form-error span-2" id="ae-plan-error" role="alert" hidden></p></form>
<p class="form-note">Comptes indicatifs du plan comptable agricole, à faire valider par votre comptable. Les taux de TVA ne sont jamais devinés : saisissez celui de chaque catégorie (les factures émises gardent la TVA du document).</p><button type="button" class="button secondary" data-ae="save-plan">Enregistrer le plan</button></details>`;
  }

  function open(){
    const d=data(),res=accountingRows(d,period),sum=accountSummary(res.rows),plan=accountingPlan(d);
    const tot=side=>sum.filter(g=>g.side===side).reduce((s,g)=>s+g.ht,0);
    modal('Pour mon comptable','Export CSV ou Excel ventilé par compte et par taux de TVA',`
<p class="notice warning" role="note">${e(DISCLAIMER)}</p>
<form id="ae-period" class="form-grid"><label>Du<input type="date" name="from" value="${e(period.from)}" required></label><label>Au (date de clôture des stocks)<input type="date" name="to" value="${e(period.to)}" required></label><p class="form-error span-2" id="ae-period-error" role="alert" hidden></p></form>
<div class="mc-actions"><button type="button" class="button secondary" data-ae="refresh">Mettre à jour l’aperçu</button></div>
<div class="preview-summary"><div class="preview-stat"><strong>${res.rows.length}</strong><small>opérations chiffrées</small></div><div class="preview-stat"><strong>${eur(tot('vente'))}</strong><small>produits HT</small></div><div class="preview-stat"><strong>${eur(tot('achat'))}</strong><small>charges HT</small></div></div>
${res.warnings.length?`<ul class="stock-alerts">${res.warnings.map(w=>`<li class="is-warning">${e(w)}</li>`).join('')}</ul>`:''}
<h3>Synthèse par compte</h3><div class="econ-table-wrap"><table class="econ-table"><thead><tr><th>Compte</th><th>TVA</th><th>HT</th><th>TVA</th><th>Lignes</th></tr></thead><tbody>${sum.map(g=>`<tr><th scope="row">${e(g.account)} <small>${e(g.label)}</small></th><td>${g.vatRate===null?'à saisir':`${String(g.vatRate).replace('.',',')} %`}</td><td>${eur(g.ht)}</td><td>${g.tvaUnknown?'—':eur(g.tva)}</td><td>${g.count}</td></tr>`).join('')||'<tr><td colspan="5">Aucune opération chiffrée sur la période.</td></tr>'}</tbody></table></div>
${planForm(plan)}`,
    `<button type="button" class="button secondary" data-ae="csv">CSV opérations</button><button type="button" class="button secondary" data-ae="csv-stocks">CSV stocks</button><button type="button" class="button primary" data-ae="xlsx">Classeur Excel</button>`,'large');
  }

  function readPeriod(){
    const f=document.querySelector('#ae-period'),err=document.querySelector('#ae-period-error');if(!f)return true;
    if(!validateForm(f))return false;const v=Object.fromEntries(new FormData(f));
    if(v.from>v.to){err.textContent='La date de début doit précéder la date de fin.';err.hidden=false;return false;}
    period={from:v.from,to:v.to};return true;
  }
  const name=ext=>`comptable-${period.from}_${period.to}.${ext}`;

  async function action(kind){
    if(kind==='refresh'){if(readPeriod())open();return;}
    if(kind==='save-plan'){
      const form=document.querySelector('#ae-plan-form'),err=document.querySelector('#ae-plan-error');if(!form||!validateForm(form))return;
      const r=validatePlan(Object.fromEntries(new FormData(form)));if(r.error){err.textContent=r.error;err.hidden=false;return;}
      readPeriod();await store.setPreferences({accountingPlan:r.value});toast('Plan de catégories enregistré.','success');return open();
    }
    if(!readPeriod())return;const d=data(),res=accountingRows(d,period);
    if(kind==='csv'){download(name('csv'),operationsCsv(res),'text/csv;charset=utf-8');return toast(`${res.rows.length} opération(s) exportée(s).`,'success');}
    if(kind==='csv-stocks'){download(`stocks-${period.to}.csv`,stocksCsv(d,period.to),'text/csv;charset=utf-8');return;}
    if(kind==='xlsx'){
      const XLSX=await loadVendor('xlsx').catch(()=>null);
      if(!XLSX){toast('Excel indisponible hors connexion : export CSV proposé.','error');download(name('csv'),operationsCsv(res),'text/csv;charset=utf-8');return;}
      const wb=XLSX.utils.book_new();for(const s of workbookSheets(d,res))XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.rows),s.name);
      downloadBlob(name('xlsx'),new Blob([XLSX.write(wb,{type:'array',bookType:'xlsx'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      toast('Classeur exporté : Opérations, Ventes, Synthèse et Stocks.','success');
    }
  }
  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-ae]');if(!c||c.disabled)return;c.disabled=true;action(c.dataset.ae).catch(err=>toast(err.message,'error')).finally(()=>{c.disabled=false;});});
  return{open};
}
