// n° 43 — Carte « État des cultures » : logique pure, sans DOM ni Leaflet ni réseau.
// Les valeurs viennent uniquement du cache satellite (satellite.js) ; rien n'est écrit
// dans les données de l'exploitation.
import {anomalies} from './satellite.js';

const DAY=86400000;
export const NDVI_MODES=['ndvi','ndvitrend'];
export const NDVI_REFRESH_KEY='ndvi-map-refresh-v1';
export const NDVI_REFRESH_PERIOD='30';
export const NDVI_CONCURRENCY=2;
export const NDVI_HATCH_ID='ndvi-hatch';

// Classes graduées de vigueur (du sol nu à la végétation dense).
export const NDVI_CLASSES=[
  {min:-Infinity,label:'NDVI < 0,2 · sol nu ou très faible',short:'< 0,2',color:'#9c6b3e'},
  {min:.2,label:'NDVI 0,2 à 0,4 · faible',short:'0,2–0,4',color:'#c9a248'},
  {min:.4,label:'NDVI 0,4 à 0,6 · moyenne',short:'0,4–0,6',color:'#a9bd4f'},
  {min:.6,label:'NDVI 0,6 à 0,8 · bonne',short:'0,6–0,8',color:'#5c9f45'},
  {min:.8,label:'NDVI ≥ 0,8 · très forte',short:'≥ 0,8',color:'#22703a'}
];
export const NDVI_NO_DATA={label:'Sans donnée satellite',color:'#a4a79f',hatch:true};
export const TREND_CLASSES={
  up:{label:'Hausse sur 15 j',color:'#2f8a57'},
  flat:{label:'Stable sur 15 j',color:'#8f958c'},
  down:{label:'Baisse sur 15 j',color:'#c33b36'},
  unknown:{label:'Historique insuffisant',color:'#d8d2c2'}
};

const decimal=value=>value.toFixed(2).replace('.',',');
const signed=value=>(value>=0?'+':'−')+decimal(Math.abs(value));
const dayStart=value=>{const d=new Date(value);d.setHours(0,0,0,0);return d.getTime();};
const frDate=iso=>{const [y,m,d]=String(iso).split('-');return `${d}/${m}/${y}`;};

// Fusionne les séries de plusieurs périodes d'une même parcelle (7 j, 30 j, campagne…) :
// pour une même date, l'entrée la plus récemment enregistrée l'emporte.
export function mergeSeries(entries){
  const days=new Map();
  for(const entry of [...(entries||[])].filter(Boolean).sort((a,b)=>(a.savedAt||0)-(b.savedAt||0)))for(const row of entry.series||[])if(row&&row.date)days.set(row.date,row);
  return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export function lastUsable(series){return (series||[]).filter(r=>r.usable&&Number.isFinite(r.ndvi)).at(-1)||null;}

// Âge en jours entiers (jour civil local) entre la date d'image et maintenant.
export function ageDays(date,now=Date.now()){
  const t=Date.parse(String(date)+'T12:00:00');if(!Number.isFinite(t))return null;
  return Math.max(0,Math.round((dayStart(now)-dayStart(t))/DAY));
}
export function ageLabel(date,now=Date.now()){
  const days=ageDays(date,now);if(days===null)return '';
  return days===0?'aujourd’hui':days===1?'hier':`il y a ${days} j`;
}

// Tendance : dernière valeur exploitable contre celle prise environ `days` jours avant
// (la plus proche dans une fenêtre de ± `tolerance` jours). Sans référence : inconnue.
export function ndviTrend(series,{days=15,tolerance=7,threshold=.05}={}){
  const usable=(series||[]).filter(r=>r.usable&&Number.isFinite(r.ndvi)),last=usable.at(-1);
  if(!last)return{kind:'unknown',delta:null,reference:null};
  const target=Date.parse(last.date)-days*DAY;let reference=null,best=Infinity;
  for(const row of usable.slice(0,-1)){const gap=Math.abs(Date.parse(row.date)-target);if(gap<=tolerance*DAY&&gap<best){best=gap;reference=row;}}
  if(!reference)return{kind:'unknown',delta:null,reference:null};
  const delta=Math.round((last.ndvi-reference.ndvi)*1000)/1000;
  return{kind:delta>=threshold?'up':delta<=-threshold?'down':'flat',delta,reference};
}

export function ndviClass(value){
  if(!Number.isFinite(value))return null;
  let found=NDVI_CLASSES[0];for(const c of NDVI_CLASSES)if(value>=c.min)found=c;return found;
}

// Résumé d'une parcelle à partir de ses entrées de cache (déjà filtrées sur son contour).
export function ndviSummary(entries,{now=Date.now()}={}){
  const list=(entries||[]).filter(Boolean);if(!list.length)return null;
  const series=mergeSeries(list),last=lastUsable(series);
  const ignored=new Set(list.flatMap(e=>e.ignored||[]));
  const signals=last?anomalies(series).filter(s=>!ignored.has(s.id)):[];
  const savedAt=Math.max(...list.map(e=>e.savedAt||0));
  return{last,series,savedAt,age:last?ageDays(last.date,now):null,ageLabel:last?ageLabel(last.date,now):'',trend:ndviTrend(series),signals};
}

// Couleur et libellés pour la carte. `label` sert de clé de légende ; `detail` va dans la
// bulle ; `short` sert de seconde ligne d'étiquette.
export function ndviColorInfo(summary,mode='ndvi'){
  const last=summary?.last;
  if(!last)return{...NDVI_NO_DATA,detail:summary?'Aucune image exploitable en cache (nuages ou qualité insuffisante).':'Aucune donnée satellite en cache pour cette parcelle.',short:'Sans donnée',alert:false};
  const when=`image du ${frDate(last.date)} · ${summary.ageLabel}`,alert=Boolean(summary.signals?.length);
  if(mode==='ndvitrend'){
    const t=summary.trend||{kind:'unknown'},info=TREND_CLASSES[t.kind]||TREND_CLASSES.unknown;
    const delta=t.delta===null||t.delta===undefined?'':`${signed(t.delta)} depuis le ${frDate(t.reference.date)}`;
    return{label:info.label,color:info.color,detail:[`NDVI ${decimal(last.ndvi)}`,delta,when].filter(Boolean).join(' · '),short:`${t.delta===null||t.delta===undefined?'NDVI '+decimal(last.ndvi):signed(t.delta)} · ${summary.ageLabel}`,alert};
  }
  const c=ndviClass(last.ndvi);
  return{label:c.label,color:c.color,detail:`NDVI ${decimal(last.ndvi)} · ${when}`,short:`NDVI ${decimal(last.ndvi)} · ${summary.ageLabel}`,alert};
}

// Ordre de la légende graduée : classes croissantes, puis l'absence de donnée.
export function legendRank(mode,label){
  const labels=mode==='ndvitrend'?[TREND_CLASSES.up,TREND_CLASSES.flat,TREND_CLASSES.down,TREND_CLASSES.unknown].map(c=>c.label):NDVI_CLASSES.map(c=>c.label).reverse();
  const i=labels.indexOf(label);return i<0?labels.length+(label===NDVI_NO_DATA.label?1:0):i;
}

// Fourchette d'âge des valeurs affichées (« il y a 2 à 13 j »).
export function ageRange(summaries){
  const ages=[...(summaries||[])].map(s=>s?.age).filter(Number.isFinite);if(!ages.length)return '';
  const min=Math.min(...ages),max=Math.max(...ages);
  const one=d=>d===0?'aujourd’hui':d===1?'hier':`il y a ${d} j`;
  return min===max?one(min):min===0?`aujourd’hui à il y a ${max} j`:`il y a ${min} à ${max} j`;
}

// Rafraîchissement global : au plus une fois par jour civil (local) et par espace.
export function refreshDue(lastAt,now=Date.now()){return !Number.isFinite(lastAt)||lastAt<=0||dayStart(lastAt)<dayStart(now);}
export function nextRefreshAt(lastAt,now=Date.now()){if(refreshDue(lastAt,now))return now;const d=new Date(lastAt);d.setHours(24,0,0,0);return d.getTime();}

// Parcelles à interroger : contour exploitable, celles sans donnée ou à la plus vieille
// donnée d'abord, pour que l'annulation laisse le moins de trous possible.
export function refreshOrder(parcels,savedAtOf=()=>0){
  return [...(parcels||[])].filter(p=>p&&!p.deletedAt&&p.geometry&&['Polygon','MultiPolygon'].includes(p.geometry.type)).sort((a,b)=>(savedAtOf(a)||0)-(savedAtOf(b)||0)||String(a.nom||'').localeCompare(String(b.nom||''),'fr'));
}

// File d'attente à concurrence limitée, annulable par un AbortSignal. `stopOn(error)`
// arrête la file (compte non autorisé, configuration absente…).
export async function runQueue(items,worker,{concurrency=NDVI_CONCURRENCY,signal=null,onProgress=()=>{},stopOn=()=>false}={}){
  const list=[...(items||[])],results=new Array(list.length);let next=0,done=0,failed=0,stopped=null;
  const lane=async()=>{
    while(next<list.length&&!signal?.aborted&&!stopped){
      const index=next++,item=list[index];
      try{results[index]={ok:true,value:await worker(item,signal,index)};}
      catch(error){results[index]={ok:false,error};if(error?.name!=='AbortError'){failed++;if(stopOn(error))stopped=error;}}
      done++;try{onProgress({done,failed,total:list.length,item,result:results[index]});}catch{}
    }
  };
  await Promise.all(Array.from({length:Math.max(0,Math.min(Math.max(1,concurrency|0),list.length))},lane));
  const ok=results.filter(r=>r?.ok).length;
  return{results,total:list.length,done,ok,failed,cancelled:Boolean(signal?.aborted),stopped};
}

// Images déjà en cache pour une parcelle : clés « kind@AAAA-MM-JJ », ou ancienne clé
// « kind » qui correspond à la dernière image exploitable de l'entrée.
export function rasterFrames(entries,kind='indices'){
  const frames=new Map();
  for(const entry of [...(entries||[])].filter(Boolean).sort((a,b)=>(a.savedAt||0)-(b.savedAt||0))){
    const lastDate=lastUsable(entry.series)?.date;
    for(const [key,url] of Object.entries(entry.images||{})){
      if(!url)continue;const [k,date]=key.split('@');if(k!==kind)continue;const d=date||lastDate;
      if(d&&/^\d{4}-\d{2}-\d{2}$/.test(d))frames.set(d,{date:d,key,entry});
    }
  }
  return [...frames.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

// Frise d'une parcelle : toutes les dates exploitables, en marquant celles dont l'image est en cache.
export function timelineDates(entries,kind='indices'){
  const cached=new Map(rasterFrames(entries,kind).map(f=>[f.date,f]));
  const usable=mergeSeries(entries).filter(r=>r.usable).map(r=>r.date);
  return [...new Set([...usable,...cached.keys()])].sort().map(date=>({date,label:frDate(date),cached:cached.has(date),frame:cached.get(date)||null}));
}

// Rideau : pourcentage de l'image situé à gauche de la ligne (bornes 0–100).
export function curtainPercent(lineX,imageLeft,imageWidth){
  if(!(imageWidth>0))return 50;return Math.max(0,Math.min(100,(lineX-imageLeft)/imageWidth*100));
}
export function formatImageDate(iso){return frDate(iso);}
