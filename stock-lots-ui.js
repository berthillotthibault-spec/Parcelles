// n° 73 (et n° 97) — Interface des stocks d'intrants : champs de lot à l'entrée, alertes,
// statut PPNU et rappel ADIVALOR, inventaire valorisé au PMP, export CSV/XLSX, revalorisation confirmée.
import {escapeHtml as e,download,downloadBlob,localDate} from './utils.js';
import {validateForm} from './form-chips-ui.js';
import {loadVendor} from './vendor-loader.js';
import {inputAlerts,adivalorReminder,itemLots,valuationAt,inventoryCsv,inventoryTable,INVENTORY_HEADERS,workRevaluations,revaluedWork,ADIVALOR_NOTE} from './stock-lots.js';

const n2=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2});
const eur=v=>v===null||v===undefined?'—':`${n2.format(v)} €`;
const todayIso=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

export function createStockLotsUI({store,modal,closeModal,toast,lookup=()=>null}){
  const $=s=>document.querySelector(s);
  const data=()=>store.snapshot();
  const alerts=()=>inputAlerts(data(),{today:todayIso(),lookup:q=>lookup(q)});

  // Champs facultatifs du formulaire de mouvement (entrée).
  function movementFieldsHtml(){
    return`<details class="span-2 stock-lot-fields"><summary>Lot, fournisseur et péremption (facultatif)</summary><div class="form-grid"><label>N° de lot<input name="lotNumber" maxlength="60" autocomplete="off"></label><label>Fournisseur<input name="supplier" maxlength="80"></label><label>Date de péremption<input name="expiryDate" type="date"></label></div></details>`;
  }
  function readMovementFields(v){for(const k of ['lotNumber','supplier','expiryDate']){const s=String(v[k]??'').trim();if(s&&v.type==='Entrée')v[k]=s;else delete v[k];}return v;}

  function sectionHtml(){
    const a=alerts(),adv=adivalorReminder(data(),{today:todayIso()}),danger=a.filter(x=>x.level==='danger').length;
    return`<div class="stock-lots-summary"><h3>Intrants : lots et alertes</h3>${a.length?`<ul class="stock-alerts">${a.slice(0,4).map(x=>`<li class="is-${e(x.level)}">${e(x.text)}</li>`).join('')}</ul>${a.length>4?`<p class="form-note">${a.length-4} autre(s) alerte(s).</p>`:''}`:'<p class="form-note">Aucun produit périmé, retiré ou à évacuer.</p>'}
${adv.due?`<p class="notice warning">Collecte ADIVALOR le ${e(localDate(adv.next))} : ${adv.count} PPNU à apporter.</p>`:adv.missingDate?`<p class="notice info">${adv.count} PPNU à évacuer : renseignez la prochaine collecte ADIVALOR.</p>`:''}
<div class="stock-lots-actions"><button type="button" class="button secondary" data-sl="lots">Lots et alertes${danger?` (${danger})`:''}</button><button type="button" class="button secondary" data-sl="inventory">Inventaire valorisé</button></div></div>`;
  }

  function openLots(){
    const d=data(),today=todayIso(),a=alerts(),adv=adivalorReminder(d,{today});
    const items=(d.stockItems||[]).filter(i=>!i.deletedAt&&i.category!=='Récolte');
    modal('Lots et alertes d’intrants','Péremption, AMM retirées, PPNU et dérive de prix.',`
${a.length?`<ul class="stock-alerts">${a.map(x=>`<li class="is-${e(x.level)}">${e(x.text)}</li>`).join('')}</ul>`:'<p class="form-note">Aucune alerte.</p>'}
<p class="form-note">AMM d’après la fiche produit et le catalogue E-Phy chargé (indicatif). Vérifiez l’étiquette et le site E-Phy de l’Anses.</p>
<div class="stack-list">${items.map(i=>{const lots=itemLots(d,i,{today}).filter(l=>l.remaining>0&&(l.lotNumber||l.expiryDate||l.supplier));return`<div class="list-row stock-lot-row"><div><strong>${e(i.name||'Produit')}</strong><small>${e(n2.format(Number(i.quantity)||0))} ${e(i.unit||'')}${i.ppnu?` · PPNU ${e(i.ppnu)}${i.ppnuAt?` le ${e(localDate(i.ppnuAt))}`:''}`:''}</small>${lots.map(l=>`<small class="${l.expired?'negative':''}">Lot ${e(l.lotNumber||'—')} · ${e(n2.format(l.remaining))} ${e(i.unit||'')}${l.supplier?` · ${e(l.supplier)}`:''}${l.expiryDate?` · péremption ${e(localDate(l.expiryDate))}`:''}</small>`).join('')}</div>
<div class="stock-lot-actions">${i.ppnu==='à évacuer'?`<button type="button" class="small-button" data-sl="ppnu-done" data-id="${e(i.id)}">Évacué</button><button type="button" class="small-button" data-sl="ppnu-clear" data-id="${e(i.id)}">Annuler PPNU</button>`:i.ppnu==='évacué'?'':`<button type="button" class="small-button" data-sl="ppnu" data-id="${e(i.id)}">PPNU à évacuer</button>`}</div></div>`;}).join('')||'<div class="empty-state">Aucun intrant suivi.</div>'}</div>
<h3>Collecte ADIVALOR</h3><form id="adivalor-form" class="form-grid"><label>Prochaine collecte<input name="next" type="date" value="${e(adv.next||'')}"></label></form><p class="form-note">${e(ADIVALOR_NOTE)}</p>`,
      `<button type="button" class="button secondary" data-action="open-stock">Stocks</button><button type="button" class="button primary" data-sl="adivalor-save">Enregistrer la collecte</button>`,'large');
  }

  function openInventory(date=todayIso()){
    const v=valuationAt(data(),date,{today:todayIso()}),rev=workRevaluations(data());
    modal('Inventaire valorisé',`Au ${localDate(date)} · coût moyen pondéré (PMP glissant)`,`
<form id="inventory-form" class="form-grid"><label>Date d’inventaire<input name="date" type="date" required max="${e(todayIso())}" value="${e(date)}"></label></form>
<div class="preview-summary"><div class="preview-stat"><strong>${e(eur(v.total))}</strong><small>valeur au PMP</small></div><div class="preview-stat"><strong>${v.rows.length}</strong><small>articles</small></div>${v.unpriced?`<div class="preview-stat"><strong>${v.unpriced}</strong><small>sans prix connu</small></div>`:''}</div>
<div class="table-wrap"><table class="inventory-table"><thead><tr><th>Article</th><th>Quantité</th><th>PMP</th><th>Valeur</th></tr></thead><tbody>${v.rows.map(r=>`<tr><td>${e(r.item.name||'')}${r.nextExpiry?`<small> · pér. ${e(localDate(r.nextExpiry))}</small>`:''}</td><td>${e(n2.format(r.quantity))} ${e(r.item.unit||'')}</td><td>${e(r.pmp===null?'—':`${n2.format(r.pmp)} €`)}${r.estimated?' *':''}</td><td>${e(eur(r.value))}</td></tr>`).join('')}</tbody></table></div>
<p class="form-note">PMP recalculé à chaque entrée chiffrée ; les sorties sont valorisées au PMP du jour. * stock initial valorisé au premier prix connu.</p>
${rev.length?`<h3>Sorties de travaux à revaloriser</h3><p class="form-note">Le coût d’intrant de ces travaux diffère du PMP à leur date. Rien n’est modifié sans votre confirmation.</p><div class="stack-list">${rev.map(r=>`<div class="list-row"><div><strong>${e(r.work.type||'Travail')} · ${e(localDate(r.work.date))}</strong><small>${e(r.item.name)} · actuel ${e(eur(r.current))} → PMP du jour ${e(eur(r.expected))}</small></div><button type="button" class="small-button" data-sl="revalue" data-id="${e(r.work.id)}">Revaloriser</button></div>`).join('')}</div>`:''}`,
      `<button type="button" class="button secondary" data-action="open-stock">Stocks</button><button type="button" class="button secondary" data-sl="export-csv">CSV</button><button type="button" class="button primary" data-sl="export-xlsx">Excel</button>`,'large');
    $('#inventory-form [name=date]').onchange=ev=>{if(ev.target.value)openInventory(ev.target.value);};
  }
  const currentDate=()=>$('#inventory-form [name=date]')?.value||todayIso();

  async function setPpnu(id,status){
    const item=store.get('stockItems',id);if(!item)return;
    await store.upsert('stockItems',{...item,ppnu:status||null,ppnuAt:status?todayIso():null},{label:status?`${item.name} : PPNU ${status}`:`${item.name} : statut PPNU retiré`});
    openLots();
  }
  function confirmRevalue(id){
    const r=workRevaluations(data()).find(x=>x.work.id===id);if(!r)return;
    modal('Revaloriser ce travail ?',`${r.work.type||'Travail'} du ${localDate(r.work.date)}`,`<p>Le coût d’intrant passera de ${e(eur(r.current))} à ${e(eur(r.expected))} (${e(n2.format(r.work.resourceEffects.quantity))} ${e(r.item.unit||'')} × PMP ${e(n2.format(r.pmp))} €). Le coût total du travail et les marges seront recalculés. Annulable.</p>`,
      `<button type="button" class="button secondary" data-sl="inventory">Annuler</button><button type="button" class="button primary" data-sl="revalue-ok" data-id="${e(id)}">Revaloriser</button>`,'small');
  }

  async function action(name,control){
    if(name==='lots')return openLots();
    if(name==='inventory')return openInventory();
    if(name==='ppnu')return setPpnu(control.dataset.id,'à évacuer');
    if(name==='ppnu-done')return setPpnu(control.dataset.id,'évacué');
    if(name==='ppnu-clear')return setPpnu(control.dataset.id,null);
    if(name==='adivalor-save'){const f=$('#adivalor-form');if(!validateForm(f))return;await store.setPreferences({adivalorNextCollection:f.elements.next.value||null});toast('Date de collecte enregistrée.','success');return openLots();}
    if(name==='revalue')return confirmRevalue(control.dataset.id);
    if(name==='revalue-ok'){const r=workRevaluations(data()).find(x=>x.work.id===control.dataset.id);if(!r)return openInventory();await store.upsert('interventions',revaluedWork(r.work,r.expected),{label:'Coût d’intrant revalorisé au PMP'});toast('Travail revalorisé.','success');return openInventory();}
    if(name==='export-csv'){const d=currentDate();download(`inventaire-${d}.csv`,inventoryCsv(valuationAt(data(),d)),'text/csv;charset=utf-8');return;}
    if(name==='export-xlsx'){
      const d=currentDate(),XLSX=await loadVendor('xlsx');if(!XLSX){toast('Excel indisponible hors connexion : export CSV proposé.','error');download(`inventaire-${d}.csv`,inventoryCsv(valuationAt(data(),d)),'text/csv;charset=utf-8');return;}
      const v=valuationAt(data(),d),ws=XLSX.utils.aoa_to_sheet([[`Inventaire au ${d}`],INVENTORY_HEADERS,...inventoryTable(v),['Total','','','','',v.total]]),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Inventaire');
      downloadBlob(`inventaire-${d}.xlsx`,new Blob([XLSX.write(wb,{type:'array',bookType:'xlsx'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    }
  }
  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-sl]');if(!c||c.disabled)return;c.disabled=true;action(c.dataset.sl,c).catch(err=>toast(err.message,'error')).finally(()=>{c.disabled=false;});});
  return{movementFieldsHtml,readMovementFields,sectionHtml,openLots,openInventory,alerts};
}
