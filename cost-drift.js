// Dérive de coûts et seuils d'équilibre par parcelle.
// Logique pure : compare les charges €/ha de la campagne à l'historique de la même culture
// (la parcelle d'abord, puis les parcelles de l'exploitation), poste par poste.
// On n'invente jamais de référence : moins de 2 campagnes comparables, pas de comparaison.
import {campaignFor,normalize} from './utils.js';
import {active,isObservationWork} from './farm-memory.js';
import {economicSituation} from './advanced-economics.js';
import {netMargin} from './net-margin.js';

const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const r0=v=>Math.round(v);
const r1=v=>Math.round(v*10)/10;
const r2=v=>Math.round(v*100)/100;
const MAX_CAMPAIGNS=5;
const MIN_DELTA_EUR=10;

/** Moyenne olympique : sans min ni max dès 5 valeurs, moyenne simple dès 2, null en dessous. */
export function olympicMean(values){
  const list=(Array.isArray(values)?values:[]).filter(v=>Number.isFinite(v));
  if(list.length<2)return null;
  if(list.length<5)return list.reduce((s,v)=>s+v,0)/list.length;
  const sorted=[...list].sort((a,b)=>a-b).slice(1,-1);
  return sorted.reduce((s,v)=>s+v,0)/sorted.length;
}

const isCancelled=w=>/^annul/.test(normalize(w?.status||''));
const workCampaign=w=>w.campaignId||(w.date?campaignFor(w.date):null);

/** Vue de l'état sans travaux annulés ni observations (et sans entités supprimées). */
function cleanState(state){
  const s=state||{};
  return{...s,interventions:active(s,'interventions').filter(w=>!isCancelled(w)&&!isObservationWork(w))};
}

const PRODUCT_POSTS=[[/fongicid/,'fongicides'],[/herbicid|desherb/,'herbicides'],[/insecticid/,'insecticides'],[/regulat/,'régulateurs'],[/molluscicid|anti-limace/,'molluscicides']];
/** Poste d'un travail : type de produit s'il est connu, sinon catégorie de travail normalisée. */
export function postFor(work){
  const productText=normalize([work?.productType,work?.productCategory,typeof work?.product==='string'?work.product:work?.product?.type,work?.target].filter(Boolean).join(' '));
  const type=normalize(work?.type||'');
  for(const [re,label] of PRODUCT_POSTS)if(re.test(productText)||re.test(type))return label;
  if(/phyto|pulve|traitement/.test(type))return 'traitement';
  if(/ferti|engrais|epand|azote|amend|chaul/.test(type))return 'fertilisation';
  if(/sem|plant/.test(type))return 'semis';
  if(/labour|dechaum|hers|travail du sol|cultivat|rotative|strip|bin|roul|decompact/.test(type))return 'travail du sol';
  if(/recolt|moisson|ensil|fauch|press|andain|battage/.test(type))return 'récolte';
  return 'autre';
}

/** Culture d'une parcelle pour une campagne : rotation, sinon culture des travaux, sinon (campagne visée) celle de la fiche. */
function cultureAt(state,parcel,campaign,fallback=false){
  const r=active(state,'rotations').find(x=>x.parcelId===parcel.id&&x.campaignId===campaign);
  if(r?.culture)return String(r.culture);
  const w=state.interventions.find(x=>x.parcelId===parcel.id&&workCampaign(x)===campaign&&x.culture);
  if(w)return String(w.culture);
  return fallback?String(parcel.culture||''):'';
}

/** Coût €/ha d'une parcelle pour une campagne (réalisé + prévu + charges manuelles), et ventilation par poste. */
function campaignCost(state,parcel,campaign){
  const s=economicSituation(state,parcel,campaign),area=num(parcel.surfaceHa);
  if(!(area>0))return null;
  const totalEur=s.total+s.remaining+s.manualCosts,posts=new Map();
  for(const w of [...s.actual,...s.planned]){const c=num(w.cost);if(c===null)continue;const k=postFor(w);posts.set(k,(posts.get(k)||0)+c);}
  if(s.manualCosts>0)posts.set('charges de campagne',(posts.get('charges de campagne')||0)+s.manualCosts);
  const perHa=new Map([...posts].map(([k,v])=>[k,v/area]));
  return{parcelId:parcel.id,campaign,area,totalEur,eurPerHa:totalEur/area,posts:perHa,hasData:totalEur>0,unknown:s.unknown+s.unknownPlanned,econ:s};
}

function previousCampaignIds(state,campaign,parcelId){
  const ids=new Set();
  for(const type of ['interventions','rotations'])for(const r of (state[type]||[]).filter(r=>!r.deletedAt&&(!parcelId||r.parcelId===parcelId))){const id=r.campaignId||(r.date?campaignFor(r.date):null);if(id&&String(id)<String(campaign))ids.add(String(id));}
  return [...ids].sort().reverse();
}

/** Campagnes antérieures comparables (même culture, coûts saisis) : la parcelle, sinon l'exploitation. */
function referenceEntries(state,parcel,culture,campaign){
  const key=normalize(culture),own=[];
  for(const c of previousCampaignIds(state,campaign,parcel.id)){
    if(own.length>=MAX_CAMPAIGNS)break;
    if(normalize(cultureAt(state,parcel,c))!==key)continue;
    const cost=campaignCost(state,parcel,c);if(cost?.hasData)own.push(cost);
  }
  if(own.length>=2)return{entries:own,scope:'parcelle'};
  const window=previousCampaignIds(state,campaign).slice(0,MAX_CAMPAIGNS),farm=[];
  for(const p of active(state,'parcelles'))for(const c of window){
    if(normalize(cultureAt(state,p,c))!==key)continue;
    const cost=campaignCost(state,p,c);if(cost?.hasData)farm.push(cost);
  }
  return{entries:farm,scope:'exploitation'};
}

/** Aides €/ha de la culture, d'après la marge nette (net-margin.js). */
function aidsPerHa(state,culture,campaign,cache){
  try{
    const nm=cache?.get(campaign)||netMargin(state,{campaign});cache?.set(campaign,nm);
    if(!nm.aidsSource)return null;
    const row=nm.rows.find(r=>r.key===normalize(culture));
    return row?num(row.aidsHa):null;
  }catch{return null;}
}

/** Rendement attendu (t/ha) : saisi pour la campagne, sinon moyenne olympique des campagnes antérieures de même culture. */
function expectedYield(state,parcel,culture,campaign){
  // Unité absente = t/ha, comme economicSituation, pilotage et crop-margins.
  const unitOf=e=>e?.yieldUnit==='q/ha'?'q/ha':'t/ha',toT=(v,u)=>u==='t/ha'?v:v/10;
  const econ=parcel.economicsByCampaign?.[campaign]||(campaign===campaignFor()?parcel.economics:null)||{};
  const unit=unitOf(econ);
  const y=num(econ.yield);
  if(y!==null&&y>0)return{tPerHa:toT(y,unit),unit,source:'saisi'};
  const past=[];
  for(const c of previousCampaignIds(state,campaign,parcel.id).slice(0,MAX_CAMPAIGNS)){
    if(normalize(cultureAt(state,parcel,c))!==normalize(culture))continue;
    const e=parcel.economicsByCampaign?.[c],v=num(e?.yield);
    if(v!==null&&v>0)past.push(toT(v,unitOf(e)));
  }
  const m=olympicMean(past);
  return{tPerHa:m,unit,source:m===null?null:'historique',count:past.length};
}

const pct=v=>`${v>=0?'+':'−'}${Math.abs(Math.round(v*100))} %`;
const eur=v=>`${v>=0?'+':'−'}${Math.abs(r0(v))} €/ha`;

/**
 * Dérive des coûts d'une parcelle pour une campagne, avec prix et rendement d'équilibre.
 * @returns {{parcelId,parcelName,culture,surfaceHa,campaign,totalEurPerHa,refEurPerHa,refCampaigns,status,posts,breakEvenPrice,breakEvenYield,yieldUnit,why:string[],message:string}}
 */
export function parcelCostDrift(state,parcelId,{campaign=campaignFor(),threshold=0.15,aidsCache=null}={}){
  const s=cleanState(state),parcel=active(s,'parcelles').find(p=>p.id===parcelId);
  if(!parcel)return null;
  const culture=cultureAt(s,parcel,campaign,true),surfaceHa=num(parcel.surfaceHa),why=[];
  const out={parcelId:parcel.id,parcelName:String(parcel.nom||'Parcelle'),culture,surfaceHa,campaign,totalEurPerHa:null,refEurPerHa:null,refCampaigns:0,status:'reference-insuffisante',posts:[],breakEvenPrice:null,breakEvenYield:null,yieldUnit:'q/ha',why,message:''};
  if(!(surfaceHa>0)){why.push('Surface de la parcelle inconnue : coûts à l’hectare non calculables.');out.message=`${out.parcelName} : surface inconnue, comparaison impossible.`;return out;}
  const current=campaignCost(s,parcel,campaign);
  out.totalEurPerHa=r2(current.eurPerHa);
  if(current.unknown)why.push(`${current.unknown} travaux sans coût renseigné : total sous-estimé.`);
  // Seuils d'équilibre (même sans référence).
  const aids=aidsPerHa(s,culture,campaign,aidsCache);
  if(aids===null)why.push('Aides non comptées : renseignez-les dans la marge nette.');
  const netCharges=Math.max(0,current.eurPerHa-(aids||0));
  const y=expectedYield(s,parcel,culture,campaign);out.yieldUnit=y.unit;
  if(y.tPerHa!==null&&y.tPerHa>0)out.breakEvenPrice=r0(netCharges/y.tPerHa);
  else why.push('Rendement attendu absent : prix d’équilibre non calculé.');
  if(y.source==='historique')why.push(`Rendement attendu : moyenne de ${y.count} campagnes (${r1(y.unit==='q/ha'?y.tPerHa*10:y.tPerHa)} ${y.unit}).`);
  const price=current.econ.price;// €/t
  if(price!==null&&price>0){const t=netCharges/price;out.breakEvenYield=r1(y.unit==='q/ha'?t*10:t);}
  else why.push('Prix de vente absent : rendement d’équilibre non calculé.');
  // Référence.
  const label=normalize(culture)?String(culture).toLowerCase():'culture inconnue';
  if(!normalize(culture)){why.unshift('Culture inconnue pour cette campagne : pas de référence.');out.message=`${out.parcelName} : ${r0(current.eurPerHa)} €/ha engagés, culture inconnue.`;return out;}
  const ref=referenceEntries(s,parcel,culture,campaign);
  out.refCampaigns=ref.entries.length;
  if(ref.entries.length<2){
    why.unshift(`Moins de 2 campagnes de ${label} comparables : pas de référence.`);
    out.message=`${culture}, ${out.parcelName} : ${r0(current.eurPerHa)} €/ha engagés. Référence insuffisante.${breakEvenText(out)}`;
    return out;
  }
  const refTotal=olympicMean(ref.entries.map(e=>e.eurPerHa));
  out.refEurPerHa=r2(refTotal);
  const names=new Set([...current.posts.keys(),...ref.entries.flatMap(e=>[...e.posts.keys()])]);
  // Le seuil se juge sur les valeurs brutes : un +14,6 % arrondi à 0,15 ne doit pas passer pour une dérive.
  const raw=[...names].map(post=>{
    const v=current.posts.get(post)||0,r=olympicMean(ref.entries.map(e=>e.posts.get(post)||0)),d=v-r;
    return{post,eurPerHa:r2(v),refEurPerHa:r2(r),deltaEurPerHa:r2(d),deltaPct:r>0?r2(d/r):null,drift:r>0&&d/r>=threshold&&d>=MIN_DELTA_EUR};
  }).sort((a,b)=>b.deltaEurPerHa-a.deltaEurPerHa);
  out.posts=raw.map(({drift,...p})=>p);
  const driftSet=new Set(raw.filter(p=>p.drift).map(p=>p.post));
  Object.defineProperty(out,'driftPosts',{value:driftSet,enumerable:false});
  const totalDelta=current.eurPerHa-refTotal,totalPct=refTotal>0?totalDelta/refTotal:null;
  const drifting=out.posts.filter(p=>driftSet.has(p.post));
  out.status=(totalPct!==null&&totalPct>=threshold&&totalDelta>=MIN_DELTA_EUR)||drifting.length?'derive':'ok';
  why.unshift(ref.scope==='parcelle'?`Référence : ${ref.entries.length} campagnes de ${label} sur cette parcelle${ref.entries.length>=5?' (moyenne sans la plus haute ni la plus basse)':''}.`:`Référence : ${ref.entries.length} campagnes de ${label} sur l’exploitation (moins de 2 sur cette parcelle).`);
  const top=drifting[0]||out.posts.find(p=>p.deltaEurPerHa>0);
  out.message=`${culture}, ${out.parcelName} : ${r0(current.eurPerHa)} €/ha engagés, ${totalPct===null?'référence nulle':`${pct(totalPct)} sur votre moyenne`}${top&&top.deltaEurPerHa>=MIN_DELTA_EUR?` (poste ${top.post} ${eur(top.deltaEurPerHa)})`:''}.${breakEvenText(out)}`;
  return out;
}

function breakEvenText(r){
  const parts=[];
  if(r.breakEvenPrice!==null)parts.push(`Prix d’équilibre ${r.breakEvenPrice} €/t`);
  if(r.breakEvenYield!==null)parts.push(`${parts.length?'rendement':'Rendement'} d’équilibre ${r.breakEvenYield} ${r.yieldUnit}`);
  return parts.length?` ${parts.join(', ')}.`:'';
}

/** Postes en dérive sur toute l'exploitation, triés par enjeu (écart €/ha × surface). */
export function farmCostDrift(state,{campaign=campaignFor(),threshold=0.15}={}){
  const out=[],aidsCache=new Map();// netMargin calculé une seule fois pour toute l'exploitation.
  for(const p of active(state||{},'parcelles')){
    const r=parcelCostDrift(state,p.id,{campaign,threshold,aidsCache});
    if(!r||r.status==='reference-insuffisante')continue;
    for(const post of r.posts)if(r.driftPosts.has(post.post))out.push({parcelId:r.parcelId,parcelName:r.parcelName,culture:r.culture,post:post.post,eurPerHa:post.eurPerHa,refEurPerHa:post.refEurPerHa,deltaEurPerHa:post.deltaEurPerHa,deltaPct:post.deltaPct,surfaceHa:r.surfaceHa,stake:r2(post.deltaEurPerHa*r.surfaceHa),
      why:`${r.culture}, ${r.parcelName} : poste ${post.post} ${r0(post.eurPerHa)} €/ha contre ${r0(post.refEurPerHa)} €/ha en moyenne (${pct(post.deltaPct)}, ${eur(post.deltaEurPerHa)} sur ${r1(r.surfaceHa)} ha).`});
  }
  return out.sort((a,b)=>b.stake-a.stake);
}
