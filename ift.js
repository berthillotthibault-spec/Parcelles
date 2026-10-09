// n° 64 — Indice de fréquence de traitement (IFT) par parcelle, culture et campagne.
// Calcul seulement (rien n'est stocké) :
//   IFT d'un traitement = (dose appliquée / dose de référence) × (surface traitée / surface de la parcelle)
// somme par parcelle, puis moyenne pondérée par la surface pour une culture et pour l'exploitation.
// Détail herbicides / hors herbicides / biocontrôle ; le biocontrôle est exclu du total.
import {campaignFor,formatNumber,normalize,toNullableNumber} from './utils.js';
import {active,completed} from './farm-memory.js';
import {isTreatment,productFor,usageFor} from './phyto.js';

// Table de référence embarquée. Les doses de référence officielles sont publiées par le ministère
// de l'Agriculture par culture × cible et par millésime : la table livrée est volontairement vide
// (aucune valeur inventée). L'exploitant la complète (exploitation.iftReferences), sinon la dose de
// référence de la fiche produit, sinon la dose homologuée de l'usage, est retenue.
export const IFT_REFERENCE_TABLE=Object.freeze({
  method:'IFT « référence » : dose appliquée / dose de référence × part de surface traitée (méthode nationale du ministère de l’Agriculture)',
  vintage:'2024',
  updatedAt:'2026-10-01',
  doses:Object.freeze([])  // [{culture, product|amm, target?, dose, unit}]
});

const num=v=>toNullableNumber(v);
const sameUnit=(a,b)=>!a||!b||normalize(a).replace(/\s/g,'')===normalize(b).replace(/\s/g,'');
const workCampaign=w=>w.campaignId||campaignFor(w.date||w.plannedDate);
const round=v=>Math.round(v*100)/100;

function tableDose(rows,work,culture,sheet,label){
  const c=normalize(culture),p=normalize(work.product),amm=String(work.amm||sheet?.amm||''),t=normalize(work.target);
  const hit=(rows||[]).filter(r=>num(r?.dose)>0).find(r=>{
    const rc=normalize(r.culture),byProduct=(r.amm&&String(r.amm)===amm)||(r.product&&normalize(r.product)===p);
    return byProduct&&(!rc||c.startsWith(rc.split(' ')[0]))&&(!r.target||!t||normalize(r.target)===t);
  });
  return hit?{dose:num(hit.dose),unit:hit.unit||'',source:label}:null;
}

/** Dose de référence retenue et sa provenance, ou null. */
export function referenceDose(state,work,{catalog=null,culture=''}={}){
  const sheet=productFor(state,work,{catalog})?.sheet||null;
  const user=tableDose(state?.exploitation?.iftReferences,work,culture,sheet,'table de l’exploitation');if(user)return user;
  const table=tableDose(IFT_REFERENCE_TABLE.doses,work,culture,sheet,`table ${IFT_REFERENCE_TABLE.vintage}`);if(table)return table;
  if(sheet?.refDose>0)return{dose:sheet.refDose,unit:sheet.doseUnit,source:'fiche produit (dose de référence)'};
  const usage=usageFor(sheet,culture,work.target);
  const homolog=usage?.maxDose??sheet?.maxDose;
  if(homolog>0)return{dose:homolog,unit:usage?.doseUnit||sheet.doseUnit,source:'fiche produit (dose homologuée)'};
  return null;
}

/** Famille d'un traitement : herbicide, biocontrole ou autre (hors herbicides). */
export function treatmentFamily(state,work,{catalog=null}={}){
  const cat=productFor(state,work,{catalog})?.sheet?.category||'';
  if(cat==='biocontrole'||work.biocontrol===true)return'biocontrole';
  if(cat==='herbicide'||(!cat&&/herbicide|desherb/.test(normalize(`${work.type} ${work.target||''}`))))return'herbicide';
  return'autre';
}

/** IFT d'un traitement : {value|null, family, reference, reason}. */
export function treatmentIft(state,work,{catalog=null}={}){
  const parcel=active(state,'parcelles').find(p=>p.id===work.parcelId);
  const family=treatmentFamily(state,work,{catalog}),culture=work.culture||parcel?.culture||'';
  const dose=num(work.dose),reference=referenceDose(state,work,{catalog,culture});
  if(dose===null)return{value:null,family,reference,reason:'dose non renseignée'};
  if(!reference)return{value:null,family,reference,reason:'dose de référence inconnue'};
  if(!sameUnit(work.doseUnit,reference.unit))return{value:null,family,reference,reason:`unité différente (${reference.unit})`};
  const area=num(parcel?.surfaceHa),treated=num(work.surfaceWorked);
  const share=area>0&&treated!==null?Math.min(1,Math.max(0,treated/area)):1;
  return{value:dose/reference.dose*share,family,reference,share,reason:''};
}

const emptyIft=()=>({total:0,herbicide:0,other:0,biocontrol:0,treatments:0,missing:0});
/** IFT d'une parcelle pour une campagne. */
export function parcelIft(state,parcelId,campaign=campaignFor(),{catalog=null}={}){
  const r=emptyIft();
  for(const w of active(state||{},'interventions')){
    if(w.parcelId!==parcelId||!isTreatment(w)||!completed(w)||workCampaign(w)!==campaign)continue;
    r.treatments++;
    const t=treatmentIft(state,w,{catalog});
    if(t.value===null){r.missing++;continue;}
    if(t.family==='biocontrole')r.biocontrol+=t.value;else if(t.family==='herbicide')r.herbicide+=t.value;else r.other+=t.value;
  }
  r.total=r.herbicide+r.other;
  for(const k of ['total','herbicide','other','biocontrol'])r[k]=round(r[k]);
  return r;
}

function weighted(rows){
  const out=emptyIft();let area=0;
  for(const {ift,surface} of rows){if(!(surface>0))continue;area+=surface;for(const k of ['total','herbicide','other','biocontrol'])out[k]+=ift[k]*surface;out.treatments+=ift.treatments;out.missing+=ift.missing;}
  if(area>0)for(const k of ['total','herbicide','other','biocontrol'])out[k]=round(out[k]/area);
  return{...out,surface:round(area)};
}
/** IFT par culture (moyenne pondérée par la surface) et pour l'exploitation. */
export function farmIft(state,campaign=campaignFor(),{catalog=null}={}){
  const parcels=active(state||{},'parcelles').filter(p=>!p.archived&&(p.ownershipType||'own')==='own');
  const rows=parcels.map(p=>({parcel:p,culture:p.culture||'Sans culture',surface:num(p.surfaceHa)||0,ift:parcelIft(state,p.id,campaign,{catalog})}));
  const groups=new Map();for(const r of rows){if(!groups.has(r.culture))groups.set(r.culture,[]);groups.get(r.culture).push(r);}
  const cultures=[...groups].map(([culture,list])=>({culture,...weighted(list),parcels:list.length})).sort((a,b)=>b.total-a.total||a.culture.localeCompare(b.culture,'fr'));
  return{campaign,parcels:rows,cultures,farm:weighted(rows)};
}

export function previousCampaigns(campaign,n=3){
  const y=Number(String(campaign).slice(0,4));
  return Array.from({length:n},(_,i)=>`${y-i}/${String((y-i+1)%100).padStart(2,'0')}`);
}
/** Historique sur n campagnes (la plus récente d'abord). */
export function iftHistory(state,parcelId,campaign=campaignFor(),{n=3,catalog=null}={}){
  return previousCampaigns(campaign,n).map(c=>({campaign:c,...parcelIft(state,parcelId,c,{catalog})}));
}

const fr=v=>formatNumber(Math.round(v*10)/10);
/** « IFT 2,4 · herbicide 1,1 » (biocontrôle ajouté s'il y en a). */
export function iftLabel(r){
  if(!r||!r.treatments)return'IFT 0';
  return`IFT ${fr(r.total)} · herbicide ${fr(r.herbicide)}${r.biocontrol>0?` · biocontrôle ${fr(r.biocontrol)}`:''}`;
}
/** Couleur de carte : du vert (faible) au rouge (élevé). */
export function iftColor(value){
  if(value===null||value===undefined)return{label:'IFT non calculé',color:'#9aa39b'};
  const steps=[[0,'#2f8a57','IFT 0'],[1,'#7aa64a','IFT < 1'],[2,'#d6b23a','IFT 1 à 2'],[3,'#e0873a','IFT 2 à 3'],[Infinity,'#c33b36','IFT ≥ 3']];
  if(value===0)return{label:steps[0][2],color:steps[0][1]};
  const s=steps.slice(1).find(([max])=>value<max);
  return{label:s[2],color:s[1]};
}
