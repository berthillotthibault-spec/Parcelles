// n° 66 — Traçabilité récolte reliée au stock, aux ventes et aux traitements.
// Logique pure : poids aux normes, articles de silo, stock de grains, reste à vendre,
// fiche de traçabilité du lot (phyto avec DAR, engrais, semences) et route QR « #lot/<id> ».
// Aucune écriture ici : l'interface crée l'article et le mouvement sur action explicite.
import {campaignFor,normalize} from './utils.js';
import {active} from './farm-memory.js';
import {farmRecords} from './farm-records.js';
import {toTonnes} from './sales.js';
import {harvestTrace} from './harvest-traceability.js';
import {isTreatment,checkTreatment,PHYTO_DISCLAIMER} from './phyto.js';

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const r3=v=>Math.round(v*1000)/1000;
export const GRAIN_CATEGORY='Récolte';

// Normes commerciales usuelles (indicatives, modifiables) : humidité et impuretés de référence.
export const GRAIN_NORMS_SOURCE='Normes usuelles de commercialisation (blé 15 %, maïs 15,5 %, colza et tournesol 9 %) ; vérifiez celles de votre contrat ou de votre organisme stockeur.';
export const DEFAULT_GRAIN_NORMS=Object.freeze([
  {key:'ble',label:'Blé, orge, céréales à paille',match:'ble orge triticale seigle avoine epeautre',humidity:15,impurities:2},
  {key:'mais',label:'Maïs',match:'mais',humidity:15.5,impurities:2},
  {key:'colza',label:'Colza',match:'colza',humidity:9,impurities:2},
  {key:'tournesol',label:'Tournesol',match:'tournesol',humidity:9,impurities:2},
  {key:'proteagineux',label:'Pois, féverole, soja',match:'pois feverole soja lupin',humidity:14,impurities:2}
]);

/** Table des normes : préférences de l'exploitation, sinon valeurs par défaut. */
export function grainNorms(state){
  const own=state?.preferences?.grainNorms;
  if(!Array.isArray(own)||!own.length)return DEFAULT_GRAIN_NORMS.map(n=>({...n}));
  return DEFAULT_GRAIN_NORMS.map(d=>{const o=own.find(x=>x?.key===d.key)||{};return{...d,humidity:num(o.humidity)??d.humidity,impurities:num(o.impurities)??d.impurities};});
}
export function validateNorms(rows){
  for(const r of rows){const h=num(r.humidity),i=num(r.impurities);if(h===null||h<=0||h>=40||i===null||i<0||i>=20)return{error:`Norme invalide pour ${r.label||r.key} : humidité entre 0 et 40 %, impuretés entre 0 et 20 %.`};}
  return{value:rows.map(r=>({key:r.key,humidity:num(r.humidity),impurities:num(r.impurities)}))};
}
export function normFor(crop,norms=DEFAULT_GRAIN_NORMS){
  const words=normalize(crop).split(' ');
  return norms.find(n=>n.match.split(' ').some(m=>words.includes(m)))||null;
}

/**
 * Poids aux normes : réfaction d'humidité vers la norme (formule (100 − H) / (100 − Hn)),
 * puis réfaction des impuretés au-delà de la norme. Aucune bonification si le grain est plus sec.
 */
export function normalizedWeight(quantity,{humidity=null,impurities=null}={},norm=null){
  const q=num(quantity);if(q===null||q<0)return null;
  const h=num(humidity),imp=num(impurities);
  let out=q,humidityLoss=0,impurityLoss=0;
  if(norm&&h!==null&&h>norm.humidity){const next=out*(100-h)/(100-norm.humidity);humidityLoss=out-next;out=next;}
  if(norm&&imp!==null&&imp>norm.impurities){const next=out*(1-(imp-norm.impurities)/100);impurityLoss=out-next;out=next;}
  return{raw:q,normalized:r3(out),humidityLoss:r3(humidityLoss),impurityLoss:r3(impurityLoss),norm,applied:humidityLoss>0||impurityLoss>0};
}

export function lotCrop(state,lot){return String(lot?.crop||'').trim()||harvestTrace(state,lot).culture||'';}
/** Poids aux normes du lot, en tonnes. */
export function lotTonnes(state,lot){
  const crop=lotCrop(state,lot),norm=normFor(crop,grainNorms(state)),w=normalizedWeight(lot?.quantity,lot,norm);
  const t=w?toTonnes(w.normalized,lot.unit):null;
  return{crop,norm,weight:w,tonnes:t===null?null:r3(t),rawTonnes:toTonnes(lot?.quantity,lot?.unit)};
}

export const siloLabel=lot=>String(lot?.silo||'').trim();
export const siloItemName=(crop,silo)=>`${crop||'Grain'} · silo ${silo}`;
/** Article de stock du silo pour la culture du lot (existant ou à créer). */
export function siloItemFor(state,lot){
  const silo=siloLabel(lot);if(!silo)return{error:'Indiquez d’abord le silo ou le lieu de stockage du lot.'};
  const crop=lotCrop(state,lot),name=siloItemName(crop,silo);
  const found=active(state,'stockItems').find(s=>s.category===GRAIN_CATEGORY&&normalize(s.silo)===normalize(silo)&&normalize(s.crop)===normalize(crop));
  return{item:found||null,draft:found?null:{name,category:GRAIN_CATEGORY,unit:'t',quantity:0,unitPrice:null,alertBelow:null,silo,crop,note:'Créé depuis un lot de récolte.'}};
}

/** Ventes déclarées d'un lot, en tonnes. */
export function soldTonnes(lot){return(lot?.sales||[]).reduce((s,x)=>s+(toTonnes(x.quantity,lot.unit)||0),0);}

/** Stock de grains par silo et reste à vendre par lot. */
export function grainStock(state){
  const items=active(state,'stockItems').filter(s=>s.category===GRAIN_CATEGORY),lots=farmRecords(state,'harvest');
  const silos=new Map();
  for(const item of items){const key=normalize(item.silo)||'—',s=silos.get(key)||{silo:item.silo||'Sans silo',items:[],tonnes:0};s.items.push(item);s.tonnes+=num(item.quantity)||0;silos.set(key,s);}
  const lotRows=lots.map(lot=>{const t=lotTonnes(state,lot),sold=soldTonnes(lot);return{lot,crop:t.crop,tonnes:t.tonnes,sold:r3(sold),remaining:t.tonnes===null?null:r3(Math.max(0,t.tonnes-sold)),inStock:Boolean(lot.stockMovementId),campaign:lot.date?campaignFor(lot.date):null};})
    .sort((a,b)=>String(b.lot.date||'').localeCompare(String(a.lot.date||'')));
  return{silos:[...silos.values()].sort((a,b)=>String(a.silo).localeCompare(String(b.silo),'fr')),lots:lotRows,remaining:r3(lotRows.reduce((s,r)=>s+(r.remaining||0),0))};
}

const FERT=/engrais|fertilis|azote|ammonitrate|uree|epandage|lisier|fumier|digestat|amendement|chaul/;
const SEED=/semis|semence|plantation|resemis/;
const dayDiff=(a,b)=>Math.round((Date.parse(`${a}T12:00:00`)-Date.parse(`${b}T12:00:00`))/864e5);

/** Fiche de traçabilité : phyto avec DAR, engrais, semences, ventes et mouvements. */
export function lotSheet(state,lot,{catalog=null}={}){
  const trace=harvestTrace(state,lot),t=lotTonnes(state,lot),harvestDay=String(lot.date||'').slice(0,10);
  const treatments=[],fertilizers=[],seeds=[];
  for(const w of trace.works){
    const label=normalize(`${w.type} ${w.category||''}`);
    if(isTreatment(w)){
      const check=checkTreatment(state,w,{catalog}),dar=check.limits?.dar??null,gap=w.date&&harvestDay?dayDiff(harvestDay,String(w.date).slice(0,10)):null;
      treatments.push({work:w,product:w.product||'Produit non renseigné',amm:w.amm||check.sheet?.amm||'',dose:w.dose,doseUnit:w.doseUnit||'',dar,gap,darStatus:dar===null?'inconnu':gap===null?'inconnu':gap>=dar?'respecté':'non respecté'});
    }else if(FERT.test(label))fertilizers.push({work:w,product:w.product||w.type,dose:w.dose,doseUnit:w.doseUnit||''});
    else if(SEED.test(label))seeds.push({work:w,product:w.product||w.variety||'Semence non renseignée',variety:w.variety||'',dose:w.dose,doseUnit:w.doseUnit||''});
  }
  const movements=active(state,'stockMovements').filter(m=>m.harvestLotId===lot.id||(lot.stockMovementId&&m.id===lot.stockMovementId)).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  return{lot,parcel:trace.parcel,campaign:trace.campaign,crop:t.crop,weight:t.weight,tonnes:t.tonnes,sold:r3(soldTonnes(lot)),treatments,fertilizers,seeds,sales:lot.sales||[],movements,
    darIssues:treatments.filter(x=>x.darStatus==='non respecté').length,disclaimer:PHYTO_DISCLAIMER};
}

/** Route du QR code de la fiche : « #lot/<id> ». */
export const lotLink=(base,id)=>`${base}#lot/${encodeURIComponent(String(id||''))}`;
export function parseLotRoute(route){
  const m=String(route||'').replace(/^#/,'').match(/^lot\/([^/]+)\/?$/);if(!m)return null;
  try{const id=decodeURIComponent(m[1]);return id?{id}:null;}catch{return null;}
}
