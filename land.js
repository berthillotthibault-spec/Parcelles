// n° 93 — Foncier : propriétaires, baux et fermages indexés. Logique pure.
// Le bail est un champ optionnel `lease` de la parcelle : pas de nouvelle collection.
import {normalize} from './utils.js';
import {active} from './farm-memory.js';

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const r2=v=>Math.round(v*100)/100;
const text=v=>String(v??'').trim();
const dayMs=d=>Date.parse(`${d}T12:00:00`);
export const REMINDER_MONTHS=18;

export const LEASE_TYPES=Object.freeze([
  ['fermage','Bail rural (9 ans)'],['long','Bail à long terme (18 ou 25 ans)'],['carriere','Bail de carrière'],
  ['cessible','Bail cessible hors cadre familial'],['pature','Convention pluriannuelle de pâturage'],
  ['precaire','Convention précaire / vente d’herbe'],['mad','Mise à disposition (société)'],['propriete','Propriété de l’exploitant']
]);
export const leaseTypeLabel=k=>LEASE_TYPES.find(t=>t[0]===k)?.[1]||'Non renseigné';

// Valeur pré-remplie de l'indice national des fermages, datée et sourcée ; à remplacer chaque année.
export const FERMAGE_INDEX_REFERENCE=Object.freeze({
  year:2025,value:123.06,date:'2025-07-18',
  source:'Indice national des fermages 2025 (arrêté ministériel publié en juillet 2025), applicable aux échéances du 1er octobre 2025 au 30 septembre 2026.',
  verify:'Valeur pré-remplie à vérifier sur Légifrance ; saisissez le nouvel indice dès sa publication (juillet). Le prix du quintal de blé fermage est fixé par arrêté préfectoral de votre département.'
});

/** Indice retenu : saisi par l'exploitant pour l'année, sinon la valeur pré-remplie. */
export function fermageIndex(state){
  const own=state?.preferences?.fermageIndex,value=num(own?.value);
  if(value!==null&&value>0)return{year:Number(own.year)||null,value,date:own.enteredAt?new Date(own.enteredAt).toISOString().slice(0,10):'',source:'Saisi par l’exploitant',prefilled:false};
  return{...FERMAGE_INDEX_REFERENCE,prefilled:true};
}
export function validateIndex(v){
  const year=Number(v?.year),value=num(v?.value),qp=num(v?.quintalPrice);
  if(!Number.isInteger(year)||year<2000||year>2100)return{error:'Année d’indice invalide.'};
  if(value===null||value<50||value>500)return{error:'Indice invalide (valeur attendue autour de 100 à 200).'};
  if(qp!==null&&(qp<=0||qp>100))return{error:'Prix du quintal invalide (en € par quintal).'};
  return{value:{year,value,quintalPrice:qp}};
}

export function normalizeLease(v){
  const lease={ownerName:text(v?.ownerName),ownerContact:text(v?.ownerContact),cadastre:text(v?.cadastre),leaseType:LEASE_TYPES.some(t=>t[0]===v?.leaseType)?v.leaseType:'',
    startDate:text(v?.startDate).slice(0,10),endDate:text(v?.endDate).slice(0,10),rentMode:v?.rentMode==='q'?'q':'eur',rent:num(v?.rent),baseIndex:num(v?.baseIndex),landTaxShare:num(v?.landTaxShare)};
  if(lease.startDate&&lease.endDate&&lease.endDate<=lease.startDate)return{error:'L’échéance doit suivre la date de début.'};
  if(lease.rent!==null&&(lease.rent<0||lease.rent>(lease.rentMode==='q'?100:5000)))return{error:lease.rentMode==='q'?'Fermage en quintaux par hectare invalide.':'Fermage en €/ha invalide.'};
  if(lease.baseIndex!==null&&(lease.baseIndex<50||lease.baseIndex>500))return{error:'Indice de référence du bail invalide.'};
  if(lease.landTaxShare!==null&&lease.landTaxShare<0)return{error:'Part de taxe foncière invalide.'};
  return{value:lease};
}
export const hasLease=p=>Boolean(p?.lease&&(p.lease.ownerName||p.lease.leaseType||p.lease.endDate||p.lease.rent!==null&&p.lease.rent!==undefined));

/**
 * Fermage d'une parcelle pour l'échéance : en €/ha, loyer de base × indice / indice de référence du bail ;
 * en quintaux, quintaux/ha × prix du quintal fixé par arrêté préfectoral.
 */
export function parcelRent(parcel,{index,quintalPrice=null}){
  const l=parcel?.lease||{},area=num(parcel?.surfaceHa)||0,rent=num(l.rent);
  if(rent===null||l.leaseType==='propriete')return{perHa:null,total:null,indexed:false,missing:rent===null?'loyer':null};
  if(l.rentMode==='q'){if(quintalPrice===null)return{perHa:null,total:null,indexed:false,missing:'prix du quintal'};const perHa=rent*quintalPrice;return{perHa:r2(perHa),total:r2(perHa*area),indexed:true,mode:'q'};}
  const base=num(l.baseIndex),factor=base&&index?.value?index.value/base:1,perHa=rent*factor;
  return{perHa:r2(perHa),total:r2(perHa*area),indexed:Boolean(base),mode:'eur',factor:r2(factor*10000)/10000};
}

/** Avis d'échéance regroupés par bailleur. */
export function rentNotices(state,{index=fermageIndex(state),quintalPrice=num(state?.preferences?.fermageIndex?.quintalPrice)}={}){
  const groups=new Map();
  for(const p of active(state,'parcelles').filter(hasLease)){
    if(p.lease.leaseType==='propriete')continue;
    const owner=text(p.lease.ownerName)||'Bailleur non renseigné',key=normalize(owner),r=parcelRent(p,{index,quintalPrice});
    const g=groups.get(key)||{owner,contact:'',parcels:[],rent:0,tax:0,missing:0,area:0};
    if(!g.contact&&p.lease.ownerContact)g.contact=p.lease.ownerContact;
    const tax=num(p.lease.landTaxShare)||0;
    g.parcels.push({parcel:p,area:num(p.surfaceHa)||0,cadastre:p.lease.cadastre||'',rent:r,tax});g.area+=num(p.surfaceHa)||0;
    if(r.total===null)g.missing+=1;else g.rent+=r.total;g.tax+=tax;groups.set(key,g);
  }
  return[...groups.values()].map(g=>({...g,area:r2(g.area),rent:r2(g.rent),tax:r2(g.tax),total:r2(g.rent+g.tax)})).sort((a,b)=>a.owner.localeCompare(b.owner,'fr'));
}

/** Rappels : baux arrivant à échéance dans les 18 mois (ou échus). */
export function leaseReminders(state,{today}){
  const limit=new Date(`${today}T12:00:00`);limit.setMonth(limit.getMonth()+REMINDER_MONTHS);const max=limit.toISOString().slice(0,10);
  return active(state,'parcelles').filter(p=>p.lease?.endDate&&p.lease.endDate<=max).map(p=>{const days=Math.round((dayMs(p.lease.endDate)-dayMs(today))/864e5);return{parcel:p,endDate:p.lease.endDate,days,expired:days<0,owner:p.lease.ownerName||''};})
    .sort((a,b)=>a.endDate.localeCompare(b.endDate));
}

const PALETTE=['#2f6b4a','#2c5a85','#9a5a24','#7d2f3a','#5b4a8a','#3f7f86','#8a7a1f','#a2475e','#4f6b2a','#6b4f3a'];
/** Couleur du mode carte « Propriétaires » : stable par bailleur. */
export function ownerColorInfo(parcel){
  const l=parcel?.lease;
  if(!l||(!l.ownerName&&l.leaseType!=='propriete'))return{label:'Bailleur non renseigné',color:'#7c8580'};
  if(l.leaseType==='propriete')return{label:'Propriété de l’exploitant',color:'#22643f'};
  let h=0;for(const c of normalize(l.ownerName))h=(h*31+c.charCodeAt(0))>>>0;
  return{label:l.ownerName,color:PALETTE[h%PALETTE.length]};
}

/** Blocs du PDF d'avis d'échéance (pdf-lite flowPdf). */
export function noticePdfBlocks(notice,{farm={},index,quintalPrice=null,today}){
  const fr=d=>d?`${d.slice(8,10)}/${d.slice(5,7)}/${d.slice(0,4)}`:'—',eur=v=>v===null||v===undefined?'—':`${v.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})} €`;
  const rows=notice.parcels.map(x=>[x.parcel.nom||'Parcelle',x.cadastre||'—',x.area.toLocaleString('fr-FR',{maximumFractionDigits:2}),x.rent.mode==='q'?`${x.parcel.lease.rent} q/ha`:x.rent.perHa===null?'—':`${eur(x.rent.perHa)}/ha`,eur(x.rent.total),eur(x.tax)]);
  return[{type:'h1',text:`Avis d’échéance de fermage`},
    {type:'p',text:`Bailleur : ${notice.owner}${notice.contact?` · ${notice.contact}`:''}`,bold:true},
    {type:'p',text:`Preneur : ${farm.nom||'Mon exploitation'}${farm.commune?` · ${farm.commune}`:''} · édité le ${fr(today)}`,muted:true},
    {type:'table',head:['Parcelle','Cadastre','Surface (ha)','Fermage','Montant','Part taxe foncière'],rows,align:['','','right','right','right','right']},
    {type:'p',text:`Fermages : ${eur(notice.rent)} · part de taxe foncière : ${eur(notice.tax)} · total : ${eur(notice.total)}`,bold:true},
    {type:'note',text:`Indice national des fermages ${index.year||''} : ${String(index.value).replace('.',',')} (${index.prefilled?'valeur pré-remplie':'saisie'}${index.date?` le ${fr(index.date)}`:''}).${quintalPrice?` Prix du quintal : ${String(quintalPrice).replace('.',',')} €.`:''} Calcul indicatif : vérifiez les clauses du bail et l’arrêté préfectoral.`},
    ...(notice.missing?[{type:'p',text:`${notice.missing} parcelle(s) sans fermage calculable (loyer ou prix du quintal manquant).`,muted:true}]:[])];
}
