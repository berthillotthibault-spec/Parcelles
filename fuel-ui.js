// n° 95 — Interface carburant GNR : cuve (niveau estimé, rappel de commande, prix moyen), pleins
// de cuve et d'engin, consommation l/h par tracteur avec alerte de dérive, remboursement TICPE.
import {escapeHtml as e,localDate,uid} from './utils.js';
import {saveFarmRecord} from './farm-records.js';
import {active} from './farm-memory.js';
import {FUEL_KIND,DRIFT_PCT,fuelEntries,tankLevel,consumption,consumptionAlerts,validateFill,ticpeRate,validateRate,ticpeRefund} from './fuel.js';

const n2=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}),n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
const eur=v=>v===null||v===undefined?'—':`${n2.format(v)} €`;
const todayIso=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

export function createFuelUI({store,modal,toast}){
  const $=s=>document.querySelector(s);
  const data=()=>store.snapshot();
  const machines=()=>active(data(),'materiels').sort((a,b)=>String(a.nom).localeCompare(String(b.nom),'fr'));
  const err=(id,msg)=>{const el=$(id);if(el){el.textContent=msg;el.hidden=false;}};

  function tankHtml(t){
    if(!t.configured)return'<div class="notice info">Renseignez la capacité et le niveau de la cuve pour suivre le niveau estimé.</div>';
    return`<div class="preview-summary"><div class="preview-stat"><strong>${n0.format(t.level)} L</strong><small>niveau estimé${t.pct!==null?` · ${t.pct} %`:''}</small></div><div class="preview-stat"><strong>${t.averagePrice===null?'—':`${n2.format(t.averagePrice)} €/L`}</strong><small>prix moyen 12 mois</small></div><div class="preview-stat"><strong>${t.lastFill?e(localDate(t.lastFill.date)):'—'}</strong><small>dernier plein de cuve</small></div></div>
${t.reorder?`<div class="notice warning">Cuve sous le seuil de commande (${n0.format(t.threshold)} L) : pensez à commander du GNR.</div>`:''}${t.negative?'<div class="notice warning">Plus de litres sortis qu’entrés : vérifiez le niveau initial ou un plein de cuve oublié.</div>':''}`;
  }

  function equipmentHtml(m){
    const c=consumption(data(),m.id);if(!c.intervals.length&&!c.litres)return'';
    return`<h3>Carburant</h3><div class="notice ${c.alert?'warning':'info'}">${c.average!==null?`Consommation moyenne ${n2.format(c.average)} l/h`:'Consommation l/h : deux pleins avec compteur nécessaires'}${c.last?` · dernier plein ${n2.format(c.last.lph)} l/h`:''} · ${n0.format(c.litres)} L au total.${c.alert?` Dérive de +${c.drift} % : vérifiez filtres, pneus, réglages ou une fuite.`:''}</div>`;
  }

  function open(){
    const d=data(),t=tankLevel(d,{today:todayIso()}),alerts=consumptionAlerts(d),recent=fuelEntries(d).slice(-10).reverse(),names=new Map(machines().map(m=>[m.id,m.nom]));
    const rows=machines().map(m=>({m,c:consumption(d,m.id)})).filter(x=>x.c.litres>0);
    modal('Carburant GNR','Cuve, pleins d’engins, consommation et remboursement TICPE.',`${tankHtml(t)}
${alerts.length?`<ul class="stock-alerts">${alerts.map(a=>`<li class="is-warning">${e(a.machine.nom)} : ${n2.format(a.c.last.lph)} l/h au dernier plein, +${a.c.drift} % par rapport à sa moyenne (${n2.format(a.c.reference)} l/h).</li>`).join('')}</ul>`:''}
<h3>Consommation par engin</h3><div class="stack-list">${rows.length?rows.map(({m,c})=>`<div class="list-row"><div><strong>${e(m.nom)}</strong><small>${c.average!==null?`${n2.format(c.average)} l/h en moyenne`:'l/h : deux pleins avec compteur nécessaires'} · ${n0.format(c.litres)} L</small></div>${c.alert?`<strong class="is-warning">+${c.drift} %</strong>`:''}</div>`).join(''):'<div class="empty-state">Aucun plein d’engin enregistré.</div>'}</div>
<h3>Derniers pleins</h3><div class="stack-list">${recent.length?recent.map(r=>`<div class="list-row"><div><strong>${r.entry==='tank'?'Plein de cuve':e(names.get(r.equipmentId)||'Engin')}</strong><small>${e(localDate(r.date))} · ${n2.format(r.litres)} L${r.unitPrice!==null&&r.unitPrice!==undefined?` · ${n2.format(r.unitPrice)} €/L`:''}${r.meter!==null&&r.meter!==undefined?` · ${n2.format(r.meter)} h`:''}${r.entry==='machine'&&r.fromTank===false?' · hors cuve':''}${r.invoiceRef?` · facture ${e(r.invoiceRef)}`:''}</small></div><button class="small-button" data-fuel="edit" data-id="${e(r.id)}">Modifier</button></div>`).join(''):'<div class="empty-state">Aucun plein.</div>'}</div>
<p class="form-note">Le niveau de cuve est une estimation : faites une jauge de temps en temps et corrigez le niveau dans « Cuve ». Alerte de consommation à +${DRIFT_PCT} % de la moyenne de l’engin.</p>`,
    `<button class="button secondary" data-fuel="tank-settings">Cuve</button><button class="button secondary" data-fuel="ticpe">Remboursement TICPE</button><button class="button secondary" data-fuel="new-tank">Plein de cuve</button><button class="button primary" data-fuel="new-machine">Plein d’engin</button>`,'large');
  }

  function openFill(entry,record=null){
    const r=record||{date:todayIso(),litres:'',unitPrice:'',amount:'',meter:'',equipmentId:'',fromTank:true,supplier:'',invoiceRef:'',note:''},list=machines();
    const t=tankLevel(data(),{today:todayIso()});
    modal(entry==='tank'?'Plein de cuve':'Plein d’engin',entry==='tank'?'Livraison de GNR dans la cuve de l’exploitation.':'Litres mis dans l’engin et compteur horaire.',`<form id="fuel-form" class="form-grid" data-entry="${entry}" data-id="${e(record?.id||'')}">
${entry==='machine'?`<label>Engin<select name="equipmentId" required><option value="">Choisir…</option>${list.map(m=>`<option value="${e(m.id)}" ${r.equipmentId===m.id?'selected':''}>${e(m.nom)}${m.currentMeter!==null&&m.currentMeter!==undefined&&m.currentMeter!==''?` · ${e(m.currentMeter)} h`:''}</option>`).join('')}</select></label>`:''}
<label>Date<input type="date" name="date" value="${e(r.date)}"></label>
<label>Litres<input name="litres" type="number" min="0" step="any" inputmode="decimal" value="${e(r.litres??'')}" required></label>
${entry==='machine'?`<label>Compteur horaire (h)<input name="meter" type="number" min="0" step="any" inputmode="decimal" value="${e(r.meter??'')}" placeholder="Relevé au moment du plein"></label>
<label><input type="checkbox" name="fromTank" ${r.fromTank!==false?'checked':''}> Pris à la cuve de l’exploitation</label>`:''}
<label>Prix (€/L)<input name="unitPrice" type="number" min="0" step="any" inputmode="decimal" value="${e(r.unitPrice??'')}" placeholder="${entry==='machine'&&t.averagePrice!==null?`Moyenne cuve ${n2.format(t.averagePrice)}`:''}"></label>
<label>Montant TTC (€)<input name="amount" type="number" min="0" step="any" inputmode="decimal" value="${e(r.amount??'')}"></label>
<label>Fournisseur<input name="supplier" maxlength="120" value="${e(r.supplier||'')}"></label>
<label>N° de facture<input name="invoiceRef" maxlength="80" value="${e(r.invoiceRef||'')}"></label>
<label class="span-2">Facture (photo ou PDF, facultatif)<input type="file" name="invoiceFile" accept="image/*,application/pdf"></label>
<label class="span-2">Note<input name="note" maxlength="200" value="${e(r.note||'')}"></label>
<p class="form-error span-2" id="fuel-error" role="alert" hidden></p></form>`,
    `<button class="button secondary" data-fuel="back">Annuler</button>${record?`<button class="button danger" data-fuel="delete" data-id="${e(record.id)}">Supprimer</button>`:''}<button class="button primary" data-fuel="save-fill">Enregistrer</button>`,'large');
  }

  async function attachInvoice(file,date){
    const id=uid('doc');await store.storage.blobPut(id,file);
    try{await store.upsert('documents',{id,parcelId:null,name:file.name||'facture-gnr',mimeType:file.type||'application/octet-stream',size:file.size,originalSize:file.size,note:'Facture GNR',category:'Facture',documentDate:date,tags:['gnr','facture'],kind:'document',capturedAt:Date.now(),source:'local'},{label:`Facture GNR : ${file.name}`,queue:false});}
    catch(error){await store.storage.blobDelete(id).catch(()=>{});throw error;}
    return id;
  }

  async function saveFill(){
    const form=$('#fuel-form');if(!form)return;const entry=form.dataset.entry,existing=form.dataset.id?fuelEntries(data()).find(r=>r.id===form.dataset.id):null;
    const v=Object.fromEntries(new FormData(form));v.fromTank=entry==='machine'?form.elements.fromTank.checked:null;
    const machine=entry==='machine'?active(data(),'materiels').find(m=>m.id===v.equipmentId):null,cur=machine&&machine.currentMeter!==''&&machine.currentMeter!==null&&machine.currentMeter!==undefined?Number(machine.currentMeter):null;
    const res=validateFill({...v,allowLowerMeter:!!existing},{entry,currentMeter:Number.isFinite(cur)?cur:null});if(res.error)return err('#fuel-error',res.error);
    const file=form.elements.invoiceFile?.files?.[0];const documentId=file?await attachInvoice(file,res.value.date):existing?.documentId||null;
    await saveFarmRecord(store,FUEL_KIND,{...res.value,documentId,name:entry==='tank'?`Plein de cuve ${res.value.date}`:`Plein ${machine?.nom||'engin'} ${res.value.date}`},existing);
    if(machine&&res.value.meter!==null&&(cur===null||!Number.isFinite(cur)||res.value.meter>cur))await store.upsert('materiels',{...machine,currentMeter:res.value.meter},{label:`Compteur ${machine.nom} : ${res.value.meter} h`});
    toast('Plein enregistré.','success');open();
  }

  function openTankSettings(){
    const t=data().preferences?.fuelTank||{};
    modal('Cuve de GNR','Capacité, niveau de référence et seuil de commande.',`<form id="fuel-tank-form" class="form-grid">
<label>Capacité (L)<input name="capacity" type="number" min="0" step="any" inputmode="decimal" value="${e(t.capacity??'')}"></label>
<label>Seuil de commande (L)<input name="reorderBelow" type="number" min="0" step="any" inputmode="decimal" value="${e(t.reorderBelow??'')}" placeholder="20 % de la capacité par défaut"></label>
<label>Niveau mesuré (L)<input name="initialLevel" type="number" min="0" step="any" inputmode="decimal" value="${e(t.initialLevel??'')}"></label>
<label>Date de la jauge<input name="initialDate" type="date" value="${e(t.initialDate||todayIso())}"></label>
<p class="form-note span-2">Les pleins de cuve et les pleins d’engin pris à la cuve à partir de cette date font varier le niveau estimé.</p>
<p class="form-error span-2" id="fuel-tank-error" role="alert" hidden></p></form>`,`<button class="button secondary" data-fuel="back">Annuler</button><button class="button primary" data-fuel="save-tank">Enregistrer</button>`,'small');
  }

  async function saveTank(){
    const v=Object.fromEntries(new FormData($('#fuel-tank-form'))),n=k=>v[k]===''?null:Number(String(v[k]).replace(',','.'));
    const out={capacity:n('capacity'),reorderBelow:n('reorderBelow'),initialLevel:n('initialLevel'),initialDate:v.initialDate||todayIso()};
    if(Object.values(out).some(x=>typeof x==='number'&&(!Number.isFinite(x)||x<0)))return err('#fuel-tank-error','Valeurs positives attendues.');
    if(out.capacity!==null&&out.initialLevel!==null&&out.initialLevel>out.capacity)return err('#fuel-tank-error','Le niveau dépasse la capacité.');
    await store.setPreferences({fuelTank:out});toast('Cuve enregistrée.','success');open();
  }

  function openTicpe(year=new Date().getFullYear()-1){
    const d=data(),rate=ticpeRate(d),r=ticpeRefund(d,year,rate),years=[...new Set([new Date().getFullYear(),new Date().getFullYear()-1,...fuelEntries(d).map(x=>Number(String(x.date).slice(0,4))).filter(Boolean)])].sort((a,b)=>b-a);
    const docs=new Map(active(d,'documents').map(x=>[x.id,x]));
    modal('Remboursement TICPE',`Achats de GNR ${year} · montant estimé, pas une déclaration`,`<div class="chip-row">${years.map(y=>`<button type="button" class="small-button ${y===year?'is-active':''}" data-fuel="ticpe-year" data-year="${y}">${y}</button>`).join('')}</div>
<div class="preview-summary"><div class="preview-stat"><strong>${n0.format(r.litres)} L</strong><small>GNR facturé</small></div><div class="preview-stat"><strong>${n2.format(rate.value)} €/hL</strong><small>taux ${rate.prefilled?'pré-rempli':'saisi'}</small></div><div class="preview-stat"><strong>${eur(r.amount)}</strong><small>remboursement estimé</small></div><div class="preview-stat"><strong>${eur(r.spent)}</strong><small>achats TTC</small></div></div>
<form id="fuel-rate-form" class="form-grid"><label>Taux (€/hL)<input name="value" type="number" min="0" max="100" step="any" inputmode="decimal" value="${e(rate.value)}"></label><label>Date du taux<input name="date" type="date" value="${e(rate.date)}"></label><label class="span-2">Source<input name="source" maxlength="200" value="${e(rate.source)}"></label><p class="form-error span-2" id="fuel-rate-error" role="alert" hidden></p></form>
${rate.prefilled?'<div class="notice warning">Taux pré-rempli à titre indicatif : vérifiez le taux de l’année sur le site des douanes ou auprès de votre centre de gestion.</div>':''}
<h3>Factures (${r.invoices.length})</h3><div class="stack-list">${r.invoices.length?r.invoices.map(x=>`<div class="list-row"><div><strong>${e(localDate(x.date))} · ${n2.format(x.litres)} L</strong><small>${e(x.supplier||'Fournisseur non renseigné')}${x.invoiceRef?` · n° ${e(x.invoiceRef)}`:''}${x.amount!==null&&x.amount!==undefined?` · ${eur(x.amount)}`:''}${!x.invoiceRef&&!x.documentId?' · facture manquante':''}</small></div>${x.documentId&&docs.has(x.documentId)?`<button class="small-button" data-action="view-attachment" data-type="documents" data-id="${e(x.documentId)}">Facture</button>`:''}</div>`).join(''):'<div class="empty-state">Aucun achat de GNR sur cette année.</div>'}</div>
${r.missingInvoice?`<p class="form-note">${r.missingInvoice} achat${r.missingInvoice>1?'s':''} sans facture rattachée : la demande se fait sur justificatifs.</p>`:''}`,
    `<button class="button secondary" data-fuel="back">Retour</button><button class="button primary" data-fuel="save-rate" data-year="${year}">Enregistrer le taux</button>`,'large');
  }

  async function saveRate(year){
    const res=validateRate(Object.fromEntries(new FormData($('#fuel-rate-form'))));if(res.error)return err('#fuel-rate-error',res.error);
    await store.setPreferences({ticpeRate:{...res.value,enteredAt:Date.now()}});toast('Taux enregistré.','success');openTicpe(year);
  }

  async function action(name,control){
    const id=control.dataset.id;
    if(name==='back')return open();
    if(name==='new-tank')return openFill('tank');
    if(name==='new-machine')return openFill('machine');
    if(name==='edit'){const r=fuelEntries(data()).find(x=>x.id===id);if(r)openFill(r.entry,r);return;}
    if(name==='delete'){const r=fuelEntries(data()).find(x=>x.id===id);if(!r)return;await store.remove('integrationImports',r.id);toast('Plein supprimé.','success');return open();}
    if(name==='save-fill')return saveFill();
    if(name==='tank-settings')return openTankSettings();
    if(name==='save-tank')return saveTank();
    if(name==='ticpe')return openTicpe();
    if(name==='ticpe-year')return openTicpe(Number(control.dataset.year));
    if(name==='save-rate')return saveRate(Number(control.dataset.year));
  }
  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-fuel]');if(!c||c.disabled)return;c.disabled=true;action(c.dataset.fuel,c).catch(err=>toast(err.message,'error')).finally(()=>{c.disabled=false;});});
  return{open,equipmentHtml,openTicpe};
}
