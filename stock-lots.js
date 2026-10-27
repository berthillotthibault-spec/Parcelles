// n° 73 (et n° 97) — Stocks d'intrants : lots, péremption, AMM retirées, PPNU, inventaire valorisé
// au coût moyen pondéré (PMP glissant) et dérive de prix. Logique pure, sans écriture.
import {normalize} from './utils.js';
import {active} from './farm-memory.js';
import {phytoSheet} from './phyto.js';

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const r2=v=>Math.round(v*100)/100,r4=v=>Math.round(v*10000)/10000;
const day=v=>String(v||'').slice(0,10);
const dayMs=d=>Date.parse(`${d}T12:00:00`);
export const DRIFT_THRESHOLD=0.15;
export const EXPIRY_SOON_DAYS=30;
export const PPNU_STATUSES=Object.freeze(['à évacuer','évacué']);
export const ADIVALOR_NOTE='ADIVALOR organise les collectes de PPNU et d’emballages vides avec les distributeurs : demandez le calendrier à votre coopérative ou négoce. Conservez le bon de dépôt.';

const signed=m=>{const d=num(m.delta);if(d!==null)return d;const q=num(m.quantity)||0;return m.type==='Sortie'?-q:m.type==='Entrée'?q:0;};
export function movementsOf(state,itemId){
  return active(state,'stockMovements').filter(m=>m.stockItemId===itemId)
    .sort((a,b)=>day(a.date).localeCompare(day(b.date))||(a.createdAt||0)-(b.createdAt||0));
}
/** Quantité de départ (avant tout mouvement) : quantité actuelle − somme des mouvements. */
export function initialQuantity(item,moves){return r4(Math.max(0,(num(item.quantity)||0)-moves.reduce((s,m)=>s+signed(m),0)));}

/** Lots d'un article : entrées (et stock initial) consommées dans l'ordre d'entrée (FIFO). */
export function itemLots(state,item,{today=day(new Date().toISOString())}={}){
  const moves=movementsOf(state,item.id),lots=[];const q0=initialQuantity(item,moves);
  if(q0>0)lots.push({id:'initial',lotNumber:'',supplier:'',expiryDate:'',date:'',quantity:q0,remaining:q0});
  for(const m of moves){
    const d=signed(m);
    if(m.type==='Entrée'&&d>0){lots.push({id:m.id,lotNumber:m.lotNumber||m.lot||'',supplier:m.supplier||'',expiryDate:day(m.expiryDate),date:day(m.date),quantity:d,remaining:d,unitPrice:num(m.unitPrice)});continue;}
    if(m.type==='Ajustement'&&d>0){lots.push({id:m.id,lotNumber:'',supplier:'',expiryDate:'',date:day(m.date),quantity:d,remaining:d});continue;}
    // Sortie d'un lot désigné (travail phyto ou engrais) : prise d'abord sur ce lot, puis FIFO.
    let out=-d;const named=m.lotNumber?lots.filter(l=>l.lotNumber===m.lotNumber):[];for(const lot of [...named,...lots]){if(out<=1e-9)break;const take=Math.min(lot.remaining,out);lot.remaining=r4(lot.remaining-take);out-=take;}
  }
  return lots.map(l=>{const left=l.expiryDate?Math.round((dayMs(l.expiryDate)-dayMs(today))/864e5):null;return{...l,daysLeft:left,expired:left!==null&&left<0,expiringSoon:left!==null&&left>=0&&left<=EXPIRY_SOON_DAYS};});
}

/** Statut AMM : fiche de l'article complétée par le catalogue E-Phy (lookup facultatif). */
export function ammStatus(item,{today,lookup=null}={}){
  const own=phytoSheet(item),entry=typeof lookup==='function'?lookup({amm:own.amm,name:item.name}):null,cat=entry?phytoSheet(entry):null;
  const withdrawnAt=own.withdrawnAt||cat?.withdrawnAt||'',useUntil=own.useUntil||cat?.useUntil||'';
  if(useUntil&&useUntil<today)return{status:'interdit',withdrawnAt,useUntil,source:own.useUntil?'fiche':'catalogue'};
  if(withdrawnAt&&withdrawnAt<=today)return{status:'retiré',withdrawnAt,useUntil,source:own.withdrawnAt?'fiche':'catalogue'};
  return{status:'autorisé',withdrawnAt,useUntil};
}

/** Dérive de prix : dernière entrée chiffrée comparée au PMP juste avant elle. */
export function priceDrift(state,item,{threshold=DRIFT_THRESHOLD}={}){
  const moves=movementsOf(state,item.id),priced=moves.filter(m=>m.type==='Entrée'&&num(m.unitPrice)!==null&&signed(m)>0);
  if(!priced.length)return null;const last=priced[priced.length-1];
  const before=pmpReplay(item,moves,{until:last}).pmp;if(before===null||before<=0)return null;
  const ratio=(num(last.unitPrice)-before)/before;
  return Math.abs(ratio)>=threshold?{movement:last,price:num(last.unitPrice),pmp:r4(before),ratio:r4(ratio)}:null;
}

/**
 * PMP glissant : rejoue les mouvements dans l'ordre. Une entrée chiffrée recalcule le PMP,
 * une sortie ne le change pas, un ajustement chiffré le fixe. Sans prix connu au départ, le
 * stock initial est valorisé au premier prix connu (signalé « estimé »).
 */
function pmpReplay(item,moves,{date=null,until=null}={}){
  let qty=initialQuantity(item,moves),pmp=null,estimated=false;
  const anyPriced=moves.some(m=>num(m.unitPrice)!==null&&m.type!=='Sortie');
  if(!anyPriced&&num(item.unitPrice)!==null)pmp=num(item.unitPrice);
  else if(num(item.initialUnitPrice)!==null)pmp=num(item.initialUnitPrice);
  for(const m of moves){
    if(until&&m.id===until.id)break;if(date&&day(m.date)>date)break;
    const d=signed(m),price=num(m.unitPrice);
    if(m.type==='Entrée'&&d>0&&price!==null){if(pmp===null){pmp=price;estimated=qty>0;}pmp=qty+d>0?(qty*pmp+d*price)/(qty+d):price;}
    else if(m.type==='Ajustement'&&price!==null)pmp=price;
    qty=Math.max(0,qty+d);
  }
  return{qty:r4(qty),pmp:pmp===null?null:r4(pmp),estimated};
}
export function pmpAt(state,item,date){return pmpReplay(item,movementsOf(state,item.id),{date}).pmp;}

/** Inventaire valorisé à une date : quantité, PMP et valeur par article. */
export function valuationAt(state,date,{today=date}={}){
  const end=dayMs(date)+12*36e5;
  const rows=active(state,'stockItems').filter(i=>!i.createdAt||i.createdAt<=end).map(item=>{
    const moves=movementsOf(state,item.id),r=pmpReplay(item,moves,{date}),lots=itemLots(state,item,{today});
    const next=lots.filter(l=>l.remaining>0&&l.expiryDate).sort((a,b)=>a.expiryDate.localeCompare(b.expiryDate))[0]||null;
    return{item,quantity:r.qty,pmp:r.pmp,estimated:r.estimated,value:r.pmp===null?null:r2(r.qty*r.pmp),nextExpiry:next?.expiryDate||'',lots:lots.filter(l=>l.lotNumber).map(l=>l.lotNumber)};
  }).sort((a,b)=>String(a.item.name||'').localeCompare(String(b.item.name||''),'fr'));
  return{date,rows,total:r2(rows.reduce((s,r)=>s+(r.value||0),0)),unpriced:rows.filter(r=>r.value===null&&r.quantity>0).length};
}

export const INVENTORY_HEADERS=['Article','Catégorie','Unité','Quantité','PMP (€)','Valeur (€)','Lots','Péremption la plus proche','PPNU'];
export function inventoryTable(v){return v.rows.map(r=>[r.item.name||'',r.item.category||'',r.item.unit||'',r.quantity,r.pmp??'',r.value??'',r.lots.join(' '),r.nextExpiry,r.item.ppnu||'']);}
export function inventoryCsv(v){
  const cell=x=>{const s=typeof x==='number'?String(x).replace('.',','):String(x??'');return/[;"\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
  return'﻿'+[INVENTORY_HEADERS,...inventoryTable(v),['Total','','','','',String(v.total).replace('.',','),'','','']].map(r=>r.map(cell).join(';')).join('\r\n');
}

/** Sorties de travaux dont le coût d'intrant diffère du PMP du jour (revalorisation à confirmer). */
export function workRevaluations(state){
  const items=new Map(active(state,'stockItems').map(i=>[i.id,i]));
  return active(state,'interventions').filter(w=>w.resourceEffects?.stockItemId&&num(w.resourceEffects.quantity)>0).map(w=>{
    const item=items.get(w.resourceEffects.stockItemId);if(!item)return null;
    const pmp=pmpAt(state,item,day(w.date));if(pmp===null)return null;
    const expected=r2(num(w.resourceEffects.quantity)*pmp),current=num(w.inputCost);
    return current!==null&&Math.abs(current-expected)<0.01?null:{work:w,item,pmp,expected,current};
  }).filter(Boolean);
}
export function revaluedWork(work,expected){
  const parts=['machineCost','fuelCost','operatorCost','otherCost'].reduce((s,k)=>s+(num(work[k])||0),0);
  return{...work,inputCost:expected,cost:r2(parts+expected),costRevaluedAt:Date.now()};
}

/** Alertes d'intrants : péremption, AMM retirée, PPNU, dérive de prix. */
export function inputAlerts(state,{today=day(new Date().toISOString()),lookup=null}={}){
  const out=[];
  for(const item of active(state,'stockItems')){
    const name=item.name||'Produit';
    if(item.ppnu==='à évacuer'){out.push({kind:'ppnu',level:'warning',item,text:`${name} : PPNU à évacuer (collecte ADIVALOR).`});continue;}
    if(item.ppnu==='évacué')continue;
    for(const l of itemLots(state,item,{today}).filter(l=>l.remaining>0)){
      if(l.expired)out.push({kind:'expired',level:'danger',item,lot:l,text:`${name}${l.lotNumber?` lot ${l.lotNumber}`:''} : périmé depuis le ${l.expiryDate} (${l.remaining} ${item.unit||''} restants).`});
      else if(l.expiringSoon)out.push({kind:'expiring',level:'info',item,lot:l,text:`${name}${l.lotNumber?` lot ${l.lotNumber}`:''} : périme le ${l.expiryDate}.`});
    }
    const amm=ammStatus(item,{today,lookup});
    if(amm.status==='interdit')out.push({kind:'amm',level:'danger',item,text:`${name} : AMM retirée, utilisation interdite depuis le ${amm.useUntil}. À déclarer en PPNU.`});
    else if(amm.status==='retiré')out.push({kind:'amm',level:'warning',item,text:`${name} : AMM retirée le ${amm.withdrawnAt}${amm.useUntil?`, utilisable jusqu’au ${amm.useUntil}`:''}.`});
    const drift=priceDrift(state,item);
    if(drift)out.push({kind:'drift',level:'info',item,text:`${name} : dernier prix ${drift.price} € (${drift.ratio>0?'+':''}${Math.round(drift.ratio*100)} % par rapport au PMP de ${drift.pmp} €).`});
  }
  const rank={danger:0,warning:1,info:2};
  return out.sort((a,b)=>rank[a.level]-rank[b.level]||normalize(a.item.name).localeCompare(normalize(b.item.name)));
}

/** Emballages vides à rapporter, compteur entier par article (`emptyPackages`). */
export const packageCount=item=>{const n=Math.floor(num(item?.emptyPackages)||0);return n>0?n:0;};
export function emptyPackages(state){
  const items=active(state,'stockItems').map(item=>({item,count:packageCount(item)})).filter(r=>r.count>0).sort((a,b)=>b.count-a.count||String(a.item.name).localeCompare(String(b.item.name),'fr'));
  return{total:items.reduce((s,r)=>s+r.count,0),items};
}
/** Nouveau compteur après +n / −n (borné à 0..9999) ; `null` remet à zéro (emballages rapportés). */
export function packagesAfter(item,delta){return delta===null?0:Math.max(0,Math.min(9999,packageCount(item)+Math.trunc(Number(delta)||0)));}

/** Rappel de collecte ADIVALOR : PPNU à évacuer, emballages vides à rapporter et date de collecte saisie. */
export function adivalorReminder(state,{today=day(new Date().toISOString())}={}){
  const ppnu=active(state,'stockItems').filter(i=>i.ppnu==='à évacuer'),next=day(state?.preferences?.adivalorNextCollection);
  const packages=emptyPackages(state).total,any=ppnu.length>0||packages>0;
  const days=next?Math.round((dayMs(next)-dayMs(today))/864e5):null;
  return{count:ppnu.length,items:ppnu,packages,next:next||null,days,due:any&&days!==null&&days>=0&&days<=30,missingDate:any&&(!next||days<0)};
}

/**
 * Lots en stock proposés sur un travail phyto ou engrais : articles du même nom que le produit saisi
 * (ou de même AMM), lots numérotés encore disponibles, le plus ancien d'abord. Les semences ont leur
 * propre champ (seeds-ui.js).
 */
export function productLotChoices(state,{product='',amm=''}={},{today=day(new Date().toISOString())}={}){
  const p=normalize(product),a=String(amm||'').replace(/\D/g,'');if(!p&&!a)return[];
  const items=active(state,'stockItems').filter(i=>!/semence|récolte/i.test(String(i.category||''))&&((a&&String(i.amm||'').replace(/\D/g,'')===a)||(p&&normalize(i.name)===p)));
  const out=[],seen=new Set();
  for(const item of items)for(const l of itemLots(state,item,{today}))if(l.lotNumber&&l.remaining>0&&!seen.has(l.lotNumber)){seen.add(l.lotNumber);out.push({lotNumber:l.lotNumber,item,remaining:l.remaining,expiryDate:l.expiryDate,expired:l.expired,supplier:l.supplier});}
  return out;
}
