// n° 91 — Charges de structure, fermages et aides PAC : de la marge directe à la marge nette.
// Logique pure. Aucun second calcul de marge : on part des lignes de cropMargins (moteur unique
// marginModel) puis on retire fermages (land.js, n° 93) et charges de structure, et on ajoute les
// aides. Fiche par campagne dans preferences.structureByCampaign : pas de nouvelle collection.
import {campaignFor,normalize} from './utils.js';
import {cropMargins,pacAids} from './crop-margins.js';
import {fermageIndex,parcelRent} from './land.js';

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const r2=v=>Math.round(v*100)/100;

export const STRUCTURE_CHARGES=Object.freeze([
  ['social','Charges sociales de l’exploitant (MSA)'],['insurance','Assurances (hors matériel)'],['management','Gestion : comptable, banque, adhésions'],
  ['annuities','Annuités d’emprunts'],['buildings','Bâtiments, énergie, eau'],['other','Autres charges de structure']
]);
export const STRUCTURE_AIDS=Object.freeze([
  ['dpb','DPB (paiement de base)'],['redistributive','Paiement redistributif'],['ecoScheme','Éco-régime'],['ichn','ICHN'],['coupled','Aides couplées (bovines, protéines…)'],['otherAid','Autres aides']
]);
export const AIDS_DISCLAIMER='Montants d’aides estimés, non contractuels : vérifiez-les sur votre relevé de paiement PAC.';
export const NET_RULES=Object.freeze([
  'Marge directe : celle de « Marges par culture » (produit − charges opérationnelles − mécanisation des travaux).',
  'Fermages : calculés parcelle par parcelle depuis le foncier (bail, indice) et affectés à la culture de la parcelle.',
  'Charges de structure et aides : réparties au prorata des hectares, ou affectées à une culture choisie.',
  'Amortissements et assurances du matériel ne sont pas recomptés : ils sont dans le coût machine des travaux.'
]);

const KEYS=[...STRUCTURE_CHARGES,...STRUCTURE_AIDS].map(x=>x[0]);
const kindOf=key=>STRUCTURE_AIDS.some(a=>a[0]===key)?'aid':'charge';
export const itemLabel=key=>[...STRUCTURE_CHARGES,...STRUCTURE_AIDS].find(x=>x[0]===key)?.[1]||key;

/** Fiche de structure d'une campagne : montants annuels en €, cible '' = prorata des hectares. */
export function structureSheet(state,campaign){
  const raw=state?.preferences?.structureByCampaign?.[campaign]||{},items={};
  for(const key of KEYS){const v=raw.items?.[key]||{};items[key]={amount:num(v.amount),target:String(v.target||'')};}
  return{campaign,items,updatedAt:raw.updatedAt||null,exists:KEYS.some(k=>items[k].amount!==null)};
}

export function validateSheet(values){
  const items={};
  for(const key of KEYS){
    const raw=values?.[`amount_${key}`],amount=num(raw);
    if(String(raw??'').trim()!==''&&(amount===null||amount<0||amount>10000000))return{error:`Montant invalide pour « ${itemLabel(key)} ».`};
    items[key]={amount,target:normalize(values?.[`target_${key}`]||'')?String(values[`target_${key}`]):''};
  }
  return{value:{items}};
}

/** Copie de la fiche d'une autre campagne (montants à revoir). */
export function copySheet(state,from){const s=structureSheet(state,from);return s.exists?{items:s.items}:null;}

/** Fermages par culture, à partir des baux des parcelles de marginModel. */
export function rentsByCulture(state,model){
  const index=fermageIndex(state),quintalPrice=num(state?.preferences?.fermageIndex?.quintalPrice),out=new Map();let missing=0,noLease=0;
  for(const row of model.rows){
    const key=normalize(row.culture),g=out.get(key)||{total:0,parcels:0};
    if(!row.parcel?.lease){noLease+=1;out.set(key,g);continue;}
    const r=parcelRent(row.parcel,{index,quintalPrice});
    if(r.total!==null){g.total+=r.total;g.parcels+=1;}else if(row.parcel.lease.leaseType!=='propriete')missing+=1;
    out.set(key,g);
  }
  return{byCulture:out,missing,noLease,index};
}

/** Répartition d'un montant : sur une culture ciblée si elle existe, sinon au prorata des hectares. */
function allocate(amount,target,lines,totalArea){
  const out=new Map();if(amount===null||!amount)return out;
  const hit=target?lines.find(l=>l.key===normalize(target)):null;
  if(hit){out.set(hit.key,amount);return out;}
  for(const l of lines)out.set(l.key,totalArea>0?amount*l.area/totalArea:0);
  return out;
}

export function netMargin(state,{campaign=campaignFor()}={}){
  const cm=cropMargins(state,{campaign}),sheet=structureSheet(state,campaign),lines=cm.rows,totalArea=lines.reduce((s,l)=>s+(l.area||0),0);
  const rents=rentsByCulture(state,cm.model);
  const charges=new Map(),aids=new Map();let chargesTotal=0,aidsTotal=0,chargesSource='fiche',aidsSource='fiche';
  const add=(map,alloc)=>{for(const [k,v] of alloc)map.set(k,(map.get(k)||0)+v);};
  for(const [key] of STRUCTURE_CHARGES){const it=sheet.items[key];if(it.amount!==null){chargesTotal+=it.amount;add(charges,allocate(it.amount,it.target,lines,totalArea));}}
  for(const [key] of STRUCTURE_AIDS){const it=sheet.items[key];if(it.amount!==null){aidsTotal+=it.amount;add(aids,allocate(it.amount,it.target,lines,totalArea));}}
  // Repli : forfait de structure €/ha (prix d'équilibre) et aides €/ha de « Marges par culture ».
  const structureHa=num(state?.preferences?.structureCostHa);
  if(!STRUCTURE_CHARGES.some(([k])=>sheet.items[k].amount!==null)){if(structureHa!==null&&structureHa>0){chargesTotal=structureHa*totalArea;for(const l of lines)charges.set(l.key,structureHa*l.area);chargesSource='forfait';}else chargesSource=null;}
  const pac=pacAids(state);
  if(!STRUCTURE_AIDS.some(([k])=>sheet.items[k].amount!==null)){if(pac.total!==null){aidsTotal=pac.total*totalArea;for(const l of lines)aids.set(l.key,pac.total*l.area);aidsSource='marges';}else aidsSource=null;}
  const perHa=(map,l)=>l.area>0?(map.get(l.key)||0)/l.area:0;
  const build=(l,rentHa,chargeHa,aidHa)=>{
    const netHa=l.directHa===null?null:l.directHa-rentHa-chargeHa+aidHa;
    return{culture:l.culture,key:l.key,area:l.area,productHa:l.productHa,operationalHa:l.operationalHa,grossHa:l.grossHa,mechanizationHa:l.mechanizationHa,directHa:l.directHa,
      rentHa:r2(rentHa),structureHa:r2(chargeHa),aidsHa:r2(aidHa),netHa:netHa===null?null:r2(netHa),net:netHa===null?null:r2(netHa*l.area),partial:l.partial,missing:l.missing};
  };
  const rows=lines.map(l=>build(l,l.area>0?(rents.byCulture.get(l.key)?.total||0)/l.area:0,perHa(charges,l),perHa(aids,l)));
  const rentTotal=[...rents.byCulture.values()].reduce((s,g)=>s+g.total,0),t=cm.total;
  const total=build({...t,key:'exploitation',culture:'Exploitation',area:totalArea},totalArea>0?rentTotal/totalArea:0,totalArea>0?chargesTotal/totalArea:0,totalArea>0?aidsTotal/totalArea:0);
  return{campaign,sheet,rows,total,area:r2(totalArea),rentTotal:r2(rentTotal),chargesTotal:r2(chargesTotal),aidsTotal:r2(aidsTotal),chargesSource,aidsSource,
    rentMissing:rents.missing,noLease:rents.noLease,index:rents.index,missing:cm.missing,aidsAreEstimates:aidsTotal>0};
}

/** Cascade €/ha jusqu'à la marge nette. */
export function netWaterfall(line){
  if(!line||line.productHa===null||line.directHa===null)return[];
  return[{label:'Produit',short:'Produit',value:line.productHa,kind:'start'},{label:'Charges opérationnelles',short:'Ch. op.',value:-line.operationalHa,kind:'delta'},{label:'Marge brute',short:'MB',value:line.grossHa,kind:'total'},
    {label:'Mécanisation',short:'Méca.',value:-line.mechanizationHa,kind:'delta'},{label:'Marge directe',short:'MD',value:line.directHa,kind:'total'},
    {label:'Fermages',short:'Ferm.',value:-line.rentHa,kind:'delta'},{label:'Charges de structure',short:'Struct.',value:-line.structureHa,kind:'delta'},
    {label:'Aides (estimées)',short:'Aides',value:line.aidsHa,kind:'delta'},{label:'Marge nette',short:'Nette',value:line.netHa,kind:'total'}];
}
