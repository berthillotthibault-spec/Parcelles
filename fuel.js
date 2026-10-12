// n° 95 — Carburant GNR : pleins de cuve et d'engin, consommation l/h par tracteur, niveau de cuve
// estimé, prix moyen et remboursement TICPE annuel (montant estimé, pas une déclaration).
// Logique pure. Les pleins sont des enregistrements d'exploitation (integrationImports, farmKind
// « fuel ») : pas de nouvelle collection. Réglages de cuve et taux TICPE dans les préférences.
import {farmRecords} from './farm-records.js';
import {active} from './farm-memory.js';

export const FUEL_KIND='fuel';
export const DRIFT_PCT=20;
// Valeur pré-remplie, datée et à vérifier : remboursement partiel de TICPE sur le GNR agricole
// (écart entre le tarif plein et le tarif réduit agricole), en €/hL.
export const TICPE_REFERENCE=Object.freeze({value:14.96,date:'2024-01-01',source:'Taux de remboursement historique du GNR agricole (€/hL), à vérifier chaque année auprès des douanes ou de la DGFiP.'});
const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const r2=v=>Math.round(v*100)/100,r3=v=>Math.round(v*1000)/1000;
const byDate=(a,b)=>String(a.date).localeCompare(String(b.date))||(a.createdAt||0)-(b.createdAt||0);

export const fuelEntries=(state,entry)=>farmRecords(state,FUEL_KIND).filter(r=>!entry||r.entry===entry).sort(byDate);
export const tankFills=state=>fuelEntries(state,'tank');
export const machineFills=(state,equipmentId)=>fuelEntries(state,'machine').filter(r=>!equipmentId||r.equipmentId===equipmentId);

export function validateFill(v,{entry,currentMeter=null}={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v.date||'')))return{error:'Date invalide.'};
  const litres=num(v.litres);if(litres===null||litres<=0)return{error:'Indiquez le nombre de litres.'};
  const unitPrice=num(v.unitPrice),amount=num(v.amount),meter=num(v.meter);
  if([unitPrice,amount,meter].some(x=>x!==null&&x<0))return{error:'Valeurs négatives impossibles.'};
  if(entry==='machine'){
    if(!v.equipmentId)return{error:'Choisissez l’engin.'};
    if(meter!==null&&currentMeter!==null&&meter<currentMeter-0.01&&!v.allowLowerMeter)return{error:`Compteur inférieur au dernier relevé (${currentMeter} h).`};
  }
  const price=unitPrice??(amount!==null?r3(amount/litres):null);
  return{value:{entry,date:v.date,litres,unitPrice:price,amount:amount??(price!==null?r2(price*litres):null),meter:entry==='machine'?meter:null,equipmentId:entry==='machine'?v.equipmentId:null,
    fromTank:entry==='machine'?v.fromTank!==false&&v.fromTank!=='false':null,supplier:String(v.supplier||'').trim(),invoiceRef:String(v.invoiceRef||'').trim(),documentId:v.documentId||null,note:String(v.note||'').trim()}};
}

/** Prix moyen pondéré des pleins de cuve (sur les 12 derniers mois si une date est donnée). */
export function averagePrice(state,{today=null}={}){
  const since=today?`${Number(today.slice(0,4))-1}${today.slice(4,10)}`:'';
  const rows=tankFills(state).filter(r=>num(r.unitPrice)!==null&&(!since||String(r.date)>since));
  const l=rows.reduce((s,r)=>s+num(r.litres),0);return l>0?r3(rows.reduce((s,r)=>s+num(r.litres)*num(r.unitPrice),0)/l):null;
}

/** Niveau de cuve estimé : niveau initial + pleins de cuve − pleins d'engin pris à la cuve. */
export function tankLevel(state,{today=null}={}){
  const t=state.preferences?.fuelTank||{},capacity=num(t.capacity),start=String(t.initialDate||''),initial=num(t.initialLevel)??0,reorderBelow=num(t.reorderBelow);
  const after=r=>!start||String(r.date)>=start;
  const inL=tankFills(state).filter(after).reduce((s,r)=>s+num(r.litres),0),outL=machineFills(state).filter(r=>r.fromTank!==false&&after(r)).reduce((s,r)=>s+num(r.litres),0);
  const raw=r2(initial+inL-outL),level=capacity!==null?Math.min(Math.max(raw,0),capacity):Math.max(raw,0);
  const threshold=reorderBelow??(capacity!==null?r2(capacity*0.2):null);
  return{configured:capacity!==null||t.initialLevel!==undefined,capacity,level,raw,pct:capacity?Math.round(level/capacity*100):null,threshold,reorder:threshold!==null&&level<=threshold,negative:raw<0,
    averagePrice:averagePrice(state,{today}),lastFill:tankFills(state).at(-1)||null};
}

/** Consommation l/h d'un engin, méthode plein à plein : litres d'un plein ÷ heures depuis le précédent. */
export function consumption(state,equipmentId,{driftPct=DRIFT_PCT}={}){
  const fills=machineFills(state,equipmentId).filter(r=>num(r.meter)!==null).sort((a,b)=>num(a.meter)-num(b.meter)||byDate(a,b));
  const intervals=[];for(let i=1;i<fills.length;i++){const h=num(fills[i].meter)-num(fills[i-1].meter);if(h>0)intervals.push({date:fills[i].date,hours:r2(h),litres:num(fills[i].litres),lph:r2(num(fills[i].litres)/h)});}
  const sum=a=>a.reduce((s,x)=>s+x,0),avg=a=>sum(a.map(x=>x.hours))>0?r2(sum(a.map(x=>x.litres))/sum(a.map(x=>x.hours))):null;
  const last=intervals.at(-1)||null,reference=intervals.length>=3?avg(intervals.slice(0,-1)):null;
  const drift=last&&reference?Math.round((last.lph/reference-1)*100):null;
  return{intervals,average:avg(intervals),last,reference,drift,alert:drift!==null&&drift>=driftPct,litres:r2(sum(machineFills(state,equipmentId).map(r=>num(r.litres)||0)))};
}

export function consumptionAlerts(state,opts){
  return active(state,'materiels').map(m=>({machine:m,c:consumption(state,m.id,opts)})).filter(x=>x.c.alert);
}

export function ticpeRate(state){
  const r=state.preferences?.ticpeRate;const v=num(r?.value);
  return v!==null?{value:v,date:r.date||'',source:r.source||'Saisi par l’exploitant',prefilled:false}:{...TICPE_REFERENCE,prefilled:true};
}
export function validateRate(v){
  const value=num(v.value);if(value===null||value<0||value>100)return{error:'Taux en €/hL entre 0 et 100.'};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v.date||'')))return{error:'Indiquez la date du taux.'};
  return{value:{value,date:v.date,source:String(v.source||'').trim()}};
}

/** Remboursement TICPE estimé pour une année d'achats : litres facturés × taux (€/hL). */
export function ticpeRefund(state,year,rate=ticpeRate(state)){
  const y=String(year),invoices=fuelEntries(state).filter(r=>String(r.date).startsWith(y)&&(r.entry==='tank'||r.fromTank===false));
  const litres=r2(invoices.reduce((s,r)=>s+num(r.litres),0)),amount=r2(litres/100*num(rate.value));
  return{year:Number(y),litres,rate,amount,invoices,missingInvoice:invoices.filter(r=>!r.invoiceRef&&!r.documentId).length,
    spent:r2(invoices.reduce((s,r)=>s+(num(r.amount)||0),0))};
}
