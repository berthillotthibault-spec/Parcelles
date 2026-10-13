// n° 75 — Bilan fourrager et calendrier de récolte de l'herbe (foin, enrubannage, ensilage).
// Logique pure. Les récoltes et inventaires de fourrage sont des enregistrements d'exploitation
// (integrationImports, farmKind « forage ») : pas de nouvelle collection ni de nouvelle unité de
// stock. Les besoins (lots, période d'hivernage, pertes) sont dans preferences.forageWinter.
// Réutilise grazing.js (catégories UGB, surface fourragère, lots au pré), phenology.js (sommes de
// températures) et, sur demande, les articles de stock « Aliment » exprimés en tonnes.
import {normalize} from './utils.js';
import {farmRecords} from './farm-records.js';
import {active} from './farm-memory.js';
import {UGB_REFERENCES,grazingStatus,grazingTotal,isForageParcel} from './grazing.js';
import {degreeDays} from './phenology.js';

export const FORAGE_KIND='forage';
// Valeurs indicatives, datées et modifiables dans chaque saisie (taux de MS, poids, densité).
export const FORAGE_REFERENCES=Object.freeze({
  date:'2026-10-01',
  source:'Ordres de grandeur usuels (Idele, chambres d’agriculture) : à remplacer par vos pesées et analyses.',
  types:Object.freeze([
    {key:'foin',label:'Foin',msPct:85,baleKg:280,density:null},
    {key:'enrubannage',label:'Enrubannage',msPct:55,baleKg:650,density:null},
    {key:'ensilage-herbe',label:'Ensilage d’herbe',msPct:30,baleKg:null,density:700},
    {key:'ensilage-mais',label:'Ensilage de maïs',msPct:33,baleKg:null,density:750}
  ]),
  // Ingestion indicative en hivernage (kg de matière sèche par animal et par jour).
  needs:Object.freeze({'vache-laitiere':18,'vache-allaitante':13,'genisse-2ans':10,'genisse-1-2ans':7.5,'veau':4.5,'taureau':14,other:12}),
  lossPct:10,
  // Repères de coupe en sommes de températures base 0 °C depuis le 1er février, puis repousse.
  firstCut:Object.freeze({'ensilage-herbe':800,enrubannage:900,foin:1200}),
  regrowth:550
});
export const forageType=key=>FORAGE_REFERENCES.types.find(t=>t.key===key)||null;
export const CUT_TYPES=['ensilage-herbe','enrubannage','foin'];

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const r1=v=>Math.round(v*10)/10,r2=v=>Math.round(v*100)/100;
const isDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
const ms=d=>Date.parse(`${d}T12:00:00Z`);
export const daysBetween=(a,b)=>Math.round((ms(b)-ms(a))/86400000);
export const shiftDay=(d,n)=>new Date(ms(d)+n*86400000).toISOString().slice(0,10);
const byDate=(a,b)=>String(a.date).localeCompare(String(b.date))||(a.createdAt||0)-(b.createdAt||0);

/** Tonnes de matière sèche d'une saisie : balles × poids, silo L × l × h × densité, ou tonnes brutes. */
export function tonnesMs(v){
  if(v.mode==='tms')return num(v.tms);
  const t=forageType(v.type),pct=num(v.msPct)??t?.msPct??null;if(pct===null)return null;
  if(v.mode==='bales'){const n=num(v.bales),kg=num(v.baleKg)??t?.baleKg;return n===null||kg===null?null:r2(n*kg*pct/100/1000);}
  if(v.mode==='silo'){const l=num(v.length),w=num(v.width),h=num(v.height),d=num(v.density)??t?.density;return[l,w,h,d].some(x=>x===null)?null:r2(l*w*h*d*pct/100/1000);}
  if(v.mode==='tonnes'){const t2=num(v.tonnes);return t2===null?null:r2(t2*pct/100);}
  return null;
}

export function validateForage(v){
  if(!isDay(v.date))return{error:'Date invalide.'};
  const entry=v.entry==='inventory'?'inventory':'harvest';
  if(entry==='harvest'&&!forageType(v.type))return{error:'Choisissez le type de fourrage.'};
  const mode=['bales','silo','tonnes','tms'].includes(v.mode)?v.mode:'tms';
  const fields=['bales','baleKg','length','width','height','density','tonnes','tms','msPct'];
  if(fields.some(k=>num(v[k])!==null&&num(v[k])<0))return{error:'Valeurs négatives impossibles.'};
  const pct=num(v.msPct);if(pct!==null&&(pct<=0||pct>100))return{error:'Taux de matière sèche entre 1 et 100 %.'};
  const tms=tonnesMs({...v,mode});if(tms===null||tms<=0)return{error:mode==='silo'?'Indiquez longueur, largeur, hauteur et densité du silo.':mode==='bales'?'Indiquez le nombre de balles et leur poids.':'Indiquez la quantité.'};
  const cut=num(v.cut);
  return{value:{entry,type:entry==='harvest'?v.type:(forageType(v.type)?v.type:''),date:v.date,mode,tms,parcelId:entry==='harvest'?(v.parcelId||null):null,cut:entry==='harvest'&&cut?Math.min(Math.max(Math.round(cut),1),6):null,
    bales:num(v.bales),baleKg:num(v.baleKg),length:num(v.length),width:num(v.width),height:num(v.height),density:num(v.density),tonnes:num(v.tonnes),msPct:num(v.msPct)??forageType(v.type)?.msPct??null,note:String(v.note||'').trim().slice(0,200)}};
}

export const forageRecords=(state,entry)=>farmRecords(state,FORAGE_KIND).filter(r=>!entry||r.entry===entry).sort(byDate);

/** Réglages d'hivernage : début, fin, pertes et lots (catégorie, effectif, kg MS/j). */
export function winterSettings(state,{today}){
  const w=state.preferences?.forageWinter||{},y=Number(today.slice(0,4)),m=Number(today.slice(5,7));
  const startYear=m>=8?y:y-1;
  let start=isDay(w.start)?w.start:`${startYear}-11-15`,end=isDay(w.end)?w.end:`${startYear+1}-03-31`;
  // Hiver enregistré déjà terminé : on garde le mois-jour et on le recale sur la saison en cours.
  if(end<today&&isDay(w.start)&&isDay(w.end)){const ms=w.start.slice(4),me=w.end.slice(4);start=`${startYear}${ms}`;end=`${me>ms?startYear:startYear+1}${me}`;}
  return{start,end,lossPct:num(w.lossPct)??FORAGE_REFERENCES.lossPct,
    includeStockItems:w.includeStockItems===true,lots:(Array.isArray(w.lots)?w.lots:[]).filter(l=>num(l.heads)>0),configured:Array.isArray(w.lots)&&w.lots.length>0};
}
export const needPerDay=lot=>r2((num(lot.heads)||0)*(num(lot.kgMsDay)??FORAGE_REFERENCES.needs[lot.category]??FORAGE_REFERENCES.needs.other)/1000);

/** Lots proposés depuis le pâturage en cours (effectif par catégorie UGB). */
export function lotsFromGrazing(state,{date}){
  const lots=new Map();
  for(const s of active(state,'grazingSessions')){
    if(grazingStatus(s,{date})!=='current')continue;
    const key=s.animalCategory&&FORAGE_REFERENCES.needs[s.animalCategory]?s.animalCategory:'other',heads=grazingTotal(s)||0;if(!heads)continue;
    const lot=lots.get(key)||{category:key,label:UGB_REFERENCES.categories.find(c=>c.key===key)?.label||'Autres animaux',heads:0,kgMsDay:FORAGE_REFERENCES.needs[key]};
    lot.heads+=heads;lots.set(key,lot);
  }
  return[...lots.values()];
}

const FORAGE_NAME=[['ensilage-mais',/ensil.*mais|mais.*ensil/],['ensilage-herbe',/ensil/],['enrubannage',/enrubann/],['foin',/foin/]];
/** Articles de stock « Aliment » en tonnes dont le nom évoque un fourrage (convertis en t MS). */
export function forageStockItems(state){
  return active(state,'stockItems').filter(i=>/^t$|tonne/i.test(String(i.unit||''))).map(i=>{const n=normalize(i.name),hit=FORAGE_NAME.find(([,re])=>re.test(n));return hit?{item:i,type:hit[0],tms:r2((num(i.quantity)||0)*forageType(hit[0]).msPct/100)}:null;}).filter(Boolean);
}

/** Bilan stock contre besoins sur l'hivernage, arrêté à « today ». */
export function forageBalance(state,{today}){
  const w=winterSettings(state,{today}),year=w.start.slice(0,4),from=`${year}-01-01`,keep=1-w.lossPct/100;
  const daily=r2(w.lots.reduce((s,l)=>s+needPerDay(l),0));
  const inventory=forageRecords(state,'inventory').filter(r=>r.date>=from&&r.date<=today).at(-1)||null;
  const baseDate=inventory?inventory.date:from;
  const harvests=forageRecords(state,'harvest').filter(r=>r.date>=from&&r.date<=today&&(!inventory||r.date>inventory.date));
  const byType=Object.fromEntries(FORAGE_REFERENCES.types.map(t=>[t.key,0]));
  for(const r of harvests)if(byType[r.type]!==undefined)byType[r.type]=r2(byType[r.type]+num(r.tms)*keep);
  const items=w.includeStockItems?forageStockItems(state):[];
  for(const i of items)byType[i.type]=r2(byType[i.type]+i.tms);
  const harvested=r2(harvests.reduce((s,r)=>s+num(r.tms)*keep,0)),fromItems=r2(items.reduce((s,i)=>s+i.tms,0));
  const consFrom=baseDate>w.start?baseDate:w.start,consTo=today<w.end?today:w.end;
  const consumedDays=Math.max(0,daysBetween(consFrom,consTo)),consumed=r2(consumedDays*daily);
  const available=r2((inventory?num(inventory.tms):0)+harvested+fromItems-consumed);
  const startDay=today>w.start?today:w.start,remainingDays=Math.max(0,daysBetween(startDay,w.end)),remainingNeed=r2(remainingDays*daily);
  const coverDays=daily>0?Math.max(0,Math.floor(available/daily)):null;
  const coveredUntil=coverDays===null?null:shiftDay(startDay,coverDays);
  const missing=r2(Math.max(0,remainingNeed-available)),surplus=r2(Math.max(0,available-remainingNeed));
  // Frise : stock projeté au 1er de chaque mois de la période d'hivernage.
  const nextMonth=x=>{const m=Number(x.slice(5,7));return m===12?`${Number(x.slice(0,4))+1}-01-01`:`${x.slice(0,4)}-${String(m+1).padStart(2,'0')}-01`;};
  const timeline=[{date:w.start}];for(let x=nextMonth(w.start);x<w.end&&timeline.length<13;x=nextMonth(x))timeline.push({date:x});
  if(w.end>w.start)timeline.push({date:w.end});
  for(const p of timeline){p.stock=p.date<=today?null:r1(available-Math.max(0,daysBetween(startDay,p.date))*daily);p.past=p.date<=today;}
  return{settings:w,daily,inventory,harvests,byType,harvested,fromItems,items,consumed,consumedDays,available,remainingDays,remainingNeed,coverDays,coveredUntil,
    coversAll:coverDays!==null&&coveredUntil>=w.end,missing,surplus,timeline,pct:remainingNeed>0?Math.min(100,Math.round(Math.max(0,available)/remainingNeed*100)):100};
}

/** Calendrier de coupe des prairies : coupes faites dans l'année, prochaine coupe et repère en °C·j. */
export function cutCalendar(state,{today,days=[],type='ensilage-herbe'}){
  const year=today.slice(0,4),feb=`${year}-01-31`,sessions=active(state,'grazingSessions');
  const parcels=active(state,'parcelles').filter(p=>!p.archived&&isForageParcel(p,sessions)&&!/mais/.test(normalize(p.culture)));
  const cuts=forageRecords(state,'harvest').filter(r=>r.date.startsWith(year)&&r.parcelId&&CUT_TYPES.includes(r.type));
  const recent=days.filter(x=>x.date<=today&&Number.isFinite(x.tmax)&&Number.isFinite(x.tmin)).slice(-7);
  const pace=recent.length?recent.reduce((s,x)=>s+Math.max(0,(x.tmax+x.tmin)/2),0)/recent.length:null;
  return parcels.map(p=>{
    const done=cuts.filter(c=>c.parcelId===p.id),last=done.at(-1)||null,next=done.length+1;
    const ref=last?last.date:feb,target=last?FORAGE_REFERENCES.regrowth:FORAGE_REFERENCES.firstCut[type]||FORAGE_REFERENCES.firstCut['ensilage-herbe'];
    const g=days.length?degreeDays(days,{from:ref,to:today,base:0}):null,sum=g&&g.counted?g.sum:null;
    const status=sum===null?'unknown':sum>=target?'ready':sum>=target*0.85?'soon':'growing';
    const eta=sum!==null&&sum<target&&pace>0?shiftDay(today,Math.ceil((target-sum)/pace)):null;
    return{parcel:p,done,last,next,ref,target,sum,status,eta,incomplete:g?g.missing>0:true};
  }).sort((a,b)=>({ready:0,soon:1,growing:2,unknown:3}[a.status]-{ready:0,soon:1,growing:2,unknown:3}[b.status])||String(a.parcel.nom).localeCompare(String(b.parcel.nom),'fr'));
}
