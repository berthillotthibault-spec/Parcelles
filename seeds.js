// n° 67 — Variétés, semences et lots : traçabilité du semis et comparaison variétale pluriannuelle.
// Logique pure. Champs optionnels portés par l'intervention de semis (work.seed) : variété, densité,
// PMG, lot, semence certifiée ou de ferme, traitement de semence, article de stock « Semence ».
// Compatible avec les anciennes sauvegardes (champ absent = pas de semence renseignée).
// Le rendement vient des lots de récolte existants (enregistrements « harvest ») de la parcelle.
import {normalize,campaignFor} from './utils.js';
import {active,completed} from './farm-memory.js';
import {farmRecords} from './farm-records.js';

export const DENSITY_UNITS=['grains/m²','kg/ha'];
export const SEED_ORIGINS=['certifiée','ferme'];
export const CVO_NOTE='Semences de ferme : la contribution volontaire obligatoire (CVO) concerne certaines espèces (céréales à paille, protéagineux…) et est en général prélevée à la livraison de la récolte. Volumes indicatifs, à vérifier auprès de votre organisme stockeur ou de la SICASOV.';

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const r1=v=>Math.round(v*10)/10,r2=v=>Math.round(v*100)/100;
const txt=(v,max=80)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,max);
const day=v=>String(v||'').slice(0,10);
const dayMs=d=>Date.parse(`${d}T12:00:00Z`);

export const isSowingWork=work=>/\b(semis|seme|semer|semee|resemis|implantation|plantation)\b/.test(normalize(work?.type));

/** Normalise la saisie du formulaire (champs seed*) ; null si rien n'est renseigné. */
export function normalizeSeed(v={}){
  const seed={variety:txt(v.seedVariety),density:num(v.seedDensity),densityUnit:DENSITY_UNITS.includes(v.seedDensityUnit)?v.seedDensityUnit:'grains/m²',tgw:num(v.seedTgw),
    lot:txt(v.seedLot,60),origin:SEED_ORIGINS.includes(v.seedOrigin)?v.seedOrigin:'',treatment:txt(v.seedTreatment,120),stockItemId:txt(v.seedStockItemId,80)||null,quantityKg:num(v.seedQuantityKg)};
  if([seed.density,seed.tgw,seed.quantityKg].some(x=>x!==null&&x<0))return{error:'Valeurs de semence négatives impossibles.'};
  if(seed.tgw!==null&&seed.tgw>2000)return{error:'PMG en grammes pour 1 000 grains (2 000 g au plus).'};
  const empty=!seed.variety&&seed.density===null&&seed.tgw===null&&!seed.lot&&!seed.origin&&!seed.treatment&&!seed.stockItemId&&seed.quantityKg===null;
  return{value:empty?null:seed};
}

/** Dose en kg/ha : saisie directe, ou grains/m² × PMG (g) ÷ 100. */
export function seedKgPerHa(seed){
  if(!seed)return null;const d=num(seed.density);if(d===null)return null;
  if(seed.densityUnit==='kg/ha')return d;const tgw=num(seed.tgw);return tgw===null?null:r1(d*tgw/100);
}
/** Quantité semée en kg : saisie, sinon dose × surface semée. */
export function seedQuantityKg(work,surface=num(work?.surfaceWorked)){
  const q=num(work?.seed?.quantityKg);if(q!==null)return q;const k=seedKgPerHa(work?.seed);return k!==null&&surface?r1(k*surface):null;
}

const sowings=state=>active(state,'interventions').filter(w=>w.seed&&isSowingWork(w)&&w.status!=='Annulé').sort((a,b)=>day(a.date).localeCompare(day(b.date)));

export function seedLabel(work){
  const s=work?.seed;if(!s)return'';const parts=[[work.culture,s.variety].filter(Boolean).join(' ')];
  if(num(s.density)!==null)parts.push(`${String(num(s.density)).replace('.',',')} ${s.densityUnit==='kg/ha'?'kg/ha':'gr/m²'}`);
  if(work.date)parts.push(`semé le ${day(work.date).slice(8,10)}/${day(work.date).slice(5,7)}`);
  return parts.filter(Boolean).join(', ');
}

/** Dernier semis renseigné d'une parcelle (campagne donnée, ou le plus récent). */
export function parcelSowing(state,parcelId,{campaign=null}={}){
  return sowings(state).filter(w=>w.parcelId===parcelId&&(!campaign||(w.campaignId||campaignFor(w.date))===campaign)).at(-1)||null;
}

/** Variétés déjà saisies, les plus fréquentes d'abord (liste apprise). */
export function varietyNames(state,{culture=''}={}){
  const counts=new Map(),c=normalize(culture);
  for(const w of sowings(state)){const v=txt(w.seed.variety);if(!v||(c&&normalize(w.culture)!==c))continue;const k=normalize(v),o=counts.get(k)||{name:v,count:0};o.count++;o.name=v;counts.set(k,o);}
  return[...counts.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'fr')).map(o=>o.name);
}

const toT=(q,unit)=>{const n=num(q);if(n===null)return null;return/^kg$/i.test(String(unit||'').trim())?n/1000:n;};
/** Récolte rattachée à un semis : lots de la parcelle après le semis et avant le semis suivant (13 mois au plus). */
export function harvestForSowing(state,work,next=null){
  const from=day(work.date),limit=new Date(dayMs(from)+400*864e5).toISOString().slice(0,10),to=next&&day(next.date)<limit?day(next.date):limit;
  const lots=farmRecords(state,'harvest').filter(l=>l.parcelId===work.parcelId&&day(l.date)>from&&day(l.date)<=to);
  const tonnes=lots.reduce((s,l)=>s+(toT(l.quantity,l.unit)||0),0);
  return{lots,tonnes:r2(tonnes)};
}

/**
 * Tableau « Mes variétés » : une ligne par semis renseigné (variété, campagne, date, surface,
 * rendement mesuré, coût semence/ha), puis une synthèse par culture et variété sur plusieurs années.
 */
export function varietyTrials(state,{culture=''}={}){
  const parcels=new Map(active(state,'parcelles').map(p=>[p.id,p])),all=sowings(state),c=normalize(culture);
  const rows=all.filter(w=>txt(w.seed.variety)&&(!c||normalize(w.culture)===c)).map(w=>{
    const next=all.find(x=>x.parcelId===w.parcelId&&day(x.date)>day(w.date))||null,h=harvestForSowing(state,w,next),p=parcels.get(w.parcelId);
    const area=num(w.surfaceWorked)??num(p?.surfaceHa),ic=num(w.inputCost),cost=(ic>0?ic:null)??((num(w.productUnitPrice)!==null&&num(w.dose)!==null&&area)?num(w.productUnitPrice)*num(w.dose)*area:null);
    return{work:w,parcel:p||null,culture:txt(w.culture)||txt(p?.culture)||'—',variety:txt(w.seed.variety),campaign:w.campaignId||campaignFor(w.date),date:day(w.date),area,
      tonnes:h.lots.length?h.tonnes:null,yieldTHa:h.lots.length&&area?r2(h.tonnes/area):null,seedCostHa:cost!==null&&area?r2(cost/area):null,origin:w.seed.origin||'',lot:w.seed.lot||''};
  });
  const groups=new Map();
  for(const r of rows){const k=`${normalize(r.culture)}|${normalize(r.variety)}`,g=groups.get(k)||{culture:r.culture,variety:r.variety,rows:[],campaigns:new Set()};g.rows.push(r);g.campaigns.add(r.campaign);groups.set(k,g);}
  const summary=[...groups.values()].map(g=>{
    const y=g.rows.filter(r=>r.yieldTHa!==null),area=y.reduce((s,r)=>s+r.area,0),costs=g.rows.filter(r=>r.seedCostHa!==null);
    const doy=g.rows.map(r=>{const d=new Date(`${r.date}T12:00:00Z`);return Math.floor((d-Date.UTC(d.getUTCFullYear(),0,0))/864e5);});
    return{culture:g.culture,variety:g.variety,sowings:g.rows.length,campaigns:[...g.campaigns].sort(),area:r2(g.rows.reduce((s,r)=>s+(r.area||0),0)),
      yieldTHa:area?r2(y.reduce((s,r)=>s+r.tonnes,0)/area):null,measured:y.length,measuredArea:r2(area),seedCostHa:costs.length?r2(costs.reduce((s,r)=>s+r.seedCostHa,0)/costs.length):null,
      meanSowingDay:doy.length?Math.round(doy.reduce((s,x)=>s+x,0)/doy.length):null};
  });
  // Écart au rendement moyen de la culture (toutes variétés mesurées).
  const byCulture=new Map();for(const s of summary){if(s.yieldTHa===null)continue;const k=normalize(s.culture),o=byCulture.get(k)||{t:0,a:0};const a=s.measuredArea||0;o.t+=s.yieldTHa*a;o.a+=a;byCulture.set(k,o);}
  for(const s of summary){const o=byCulture.get(normalize(s.culture));s.gapPct=s.yieldTHa!==null&&o?.a?Math.round((s.yieldTHa/(o.t/o.a)-1)*100):null;}
  summary.sort((a,b)=>a.culture.localeCompare(b.culture,'fr')||(b.yieldTHa??-1)-(a.yieldTHa??-1)||a.variety.localeCompare(b.variety,'fr'));
  return{rows,summary};
}

/** Volumes de semences de ferme ressemées par campagne et culture (aide à la déclaration CVO). */
export function farmSavedSeed(state,{campaign=campaignFor(new Date())}={}){
  const parcels=new Map(active(state,'parcelles').map(p=>[p.id,p])),out=new Map();
  for(const w of sowings(state)){
    if(w.seed.origin!=='ferme'||(w.campaignId||campaignFor(w.date))!==campaign||!completed(w))continue;
    const area=num(w.surfaceWorked)??num(parcels.get(w.parcelId)?.surfaceHa),kg=seedQuantityKg(w,area),k=normalize(w.culture)||'—';
    const o=out.get(k)||{culture:txt(w.culture)||'—',kg:0,area:0,sowings:0,unknown:0};o.sowings++;o.area=r2(o.area+(area||0));if(kg===null)o.unknown++;else o.kg=r1(o.kg+kg);out.set(k,o);
  }
  return[...out.values()].sort((a,b)=>a.culture.localeCompare(b.culture,'fr'));
}

/** Articles de stock de catégorie « Semence » (pour relier un semis à un lot de stock). */
export const seedStockItems=state=>active(state,'stockItems').filter(i=>/semence/i.test(String(i.category||''))).sort((a,b)=>String(a.name).localeCompare(String(b.name),'fr'));

export const TRIAL_HEADERS=['Culture','Variété','Campagne','Parcelle','Date de semis','Surface (ha)','Origine','Lot','Rendement (t/ha)','Coût semence (€/ha)'];
export function trialsCsv(t){
  const cell=x=>{const s=typeof x==='number'?String(x).replace('.',','):String(x??'');return/[;"\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
  return'﻿'+[TRIAL_HEADERS,...t.rows.map(r=>[r.culture,r.variety,r.campaign,r.parcel?.nom||'',r.date,r.area??'',r.origin,r.lot,r.yieldTHa??'',r.seedCostHa??''])].map(r=>r.map(cell).join(';')).join('\r\n');
}
