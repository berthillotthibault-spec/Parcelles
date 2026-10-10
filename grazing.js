import {normalize} from './utils.js';

const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'||typeof value==='number'?String(value).trim():'';
const count=value=>{
  if(value===null||value===undefined||value==='')return null;
  const number=Number(String(value).trim().replace(',','.'));
  return Number.isFinite(number)&&number>=0?Math.floor(number):null;
};

// Calendar dates stay calendar dates. Timestamps are interpreted in the user's
// local timezone, as is the date shown by the application's date inputs.
export function grazingDate(value=new Date()){
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.trim())){
    const day=value.trim(),parsed=new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===day?day:'';
  }
  if(value===null||value===undefined||value==='')return '';
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

export function grazingAnimalList(session){
  if(!Array.isArray(session?.animals))return [];
  return session.animals.flatMap(item=>{
    if(typeof item==='string'||typeof item==='number'){
      const number=text(item);
      return number?[{number,name:'',gestation:false}]:[];
    }
    if(!isRecord(item))return [];
    const number=text(item.number??item.numero),name=text(item.name??item.nom);
    if(!number&&!name)return [];
    const gestation=item.gestation===true||item.gestation===1||['true','oui','1','gestante','gestant'].includes(normalize(item.gestation));
    return [{...item,number,name,gestation}];
  });
}

export function grazingAnimalText(session){
  if(typeof session?.animals==='string')return session.animals;
  return grazingAnimalList(session).map(animal=>`${animal.number||animal.name}${animal.gestation?' | gestante':''}`).join('\n');
}

export function parseGrazingAnimals(value){
  const seen=new Set();
  return String(value??'').split(/\r?\n/).flatMap((line,index)=>{
    if(!line.trim())return [];
    const [number,...flags]=line.split('|').map(part=>part.trim());
    if(!number)throw new Error(`Ligne ${index+1} : renseignez le numéro de l’animal.`);
    const key=number.replace(/\s+/g,'').toLocaleUpperCase('fr');
    if(seen.has(key))throw new Error(`Ligne ${index+1} : le numéro ${number} est présent plusieurs fois.`);
    seen.add(key);
    return [{number,gestation:flags.some(flag=>['gestante','gestant','oui'].includes(normalize(flag)))}];
  });
}

export function grazingTotal(session){
  const animals=grazingAnimalList(session),additional=count(session?.additionalAnimalsCount)??0;
  // The explicit list is authoritative in the current format. Count-only
  // sessions from earlier versions retain their stored total without inflation.
  if(animals.length)return animals.length+additional;
  return count(session?.animalsCount)??count(session?.count)??additional;
}

export function grazingType(session){
  return text(session?.animalType)||text(session?.type)||'Non précisé';
}

export function grazingStatus(session,{date=new Date()}={}){
  if(!isRecord(session))return 'invalid';
  if(session.deletedAt)return 'deleted';
  const day=grazingDate(date),hasStart=Boolean(session.startDate),hasEnd=Boolean(session.endDate);
  const start=hasStart?grazingDate(session.startDate):'',end=hasEnd?grazingDate(session.endDate):'';
  if(!day||(hasStart&&!start)||(hasEnd&&!end)||(start&&end&&end<start))return 'invalid';
  // A recorded exit takes effect on its date, including an exit made today.
  if(end&&end<=day)return 'ended';
  if(start&&start>day)return 'planned';
  return 'current';
}

export function filterGrazingSessions(sessions,{status='current',animalType='',parcelId='',query='',parcels=[],date=new Date(),gestation='all'}={}){
  const parcelNames=new Map((Array.isArray(parcels)?parcels:[]).filter(isRecord).map(parcel=>[parcel.id,text(parcel.nom)||text(parcel.name)]));
  const search=normalize(query),type=normalize(animalType);
  return (Array.isArray(sessions)?sessions:[]).filter(session=>{
    if(!isRecord(session))return false;
    const currentStatus=grazingStatus(session,{date});
    if(currentStatus==='deleted'||(status!=='all'&&currentStatus!==status))return false;
    if(parcelId&&session.parcelId!==parcelId)return false;
    if(type&&normalize(grazingType(session))!==type)return false;
    const animals=grazingAnimalList(session);
    if(gestation==='yes'&&!animals.some(animal=>animal.gestation))return false;
    if(gestation==='no'&&!animals.some(animal=>!animal.gestation))return false;
    if(!search)return true;
    const searchable=[grazingType(session),session.note,session.name,session.nom,session.parcelId,parcelNames.get(session.parcelId),grazingAnimalText(session),...animals.map(animal=>`${animal.number} ${animal.name}`)].map(text).join(' ');
    return normalize(searchable).includes(search);
  });
}

export function summarizeParcelGrazing(sessions,parcelId,{date=new Date()}={}){
  // Match parcel IDs, never display names: two fields can have the same name.
  const current=parcelId?filterGrazingSessions(sessions,{parcelId,date}):[];
  const groups=current.map(session=>{
    const animals=grazingAnimalList(session),total=grazingTotal(session);
    return {
      id:session.id,parcelId:session.parcelId,type:grazingType(session),total,
      animals,identifiedCount:animals.length,unidentifiedCount:Math.max(0,total-animals.length),
      gestatingCount:animals.filter(animal=>animal.gestation).length,
      animalDescription:typeof session.animals==='string'?session.animals:'',
      note:text(session.note),startDate:session.startDate??null,endDate:session.endDate??null
    };
  });
  const sum=key=>groups.reduce((total,group)=>total+group[key],0);
  return {
    parcelId,total:sum('total'),identifiedCount:sum('identifiedCount'),
    unidentifiedCount:sum('unidentifiedCount'),gestatingCount:sum('gestatingCount'),
    sessionCount:groups.length,groups,
    animals:groups.flatMap(group=>group.animals.map(animal=>({...animal,sessionId:group.id,type:group.type}))),
    types:[...new Set(groups.map(group=>group.type))]
  };
}

// ---------- n° 78 · Chargement UGB/ha et bilan de pâturage ----------
// Table versionnée, modifiable (préférences ugbCoefficients) et marquée « à vérifier ».
// ugb : coefficient UGB alimentation herbivore ; nPerYear : azote excrété par animal et par an (kg N).
export const UGB_REFERENCES=Object.freeze({
  version:'2026.1',
  date:'2026-10-01',
  source:'Coefficients UGB alimentation herbivores usuels (Institut de l’Élevage) ; azote excrété : valeurs forfaitaires de l’arrêté du 19 décembre 2011 (programme d’actions nitrates, annexe I).',
  verify:'Valeurs indicatives à vérifier avec le barème en vigueur et votre conseiller avant tout usage réglementaire.',
  defaultRestDays:21,
  unknownNPerUgb:85,
  categories:Object.freeze([
    {key:'vache-laitiere',label:'Vache laitière',ugb:1,nPerYear:101},
    {key:'vache-allaitante',label:'Vache allaitante',ugb:0.85,nPerYear:73},
    {key:'genisse-2ans',label:'Génisse de plus de 2 ans',ugb:0.8,nPerYear:53},
    {key:'genisse-1-2ans',label:'Génisse de 1 à 2 ans',ugb:0.6,nPerYear:42},
    {key:'veau',label:'Veau (moins de 1 an)',ugb:0.4,nPerYear:25},
    {key:'taureau',label:'Taureau',ugb:1,nPerYear:73}
  ])
});

const finite=value=>{const n=Number(String(value??'').replace(',','.'));return value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(n)?n:null;};
const dayMs=day=>Date.parse(`${day}T12:00:00Z`);
const daysBetween=(from,to)=>Math.round((dayMs(to)-dayMs(from))/86400000);
const shiftDay=(day,delta)=>new Date(dayMs(day)+delta*86400000).toISOString().slice(0,10);

/** Table effective : coefficients de référence remplacés par ceux saisis dans les préférences. */
export function ugbTable(state){
  const custom=isRecord(state?.preferences?.ugbCoefficients)?state.preferences.ugbCoefficients:{};
  const modified=[];
  const categories=UGB_REFERENCES.categories.map(category=>{
    const value=finite(custom[category.key]);
    if(value!==null&&value>0&&value<=3&&value!==category.ugb){modified.push(category.key);return{...category,ugb:value,reference:category.ugb};}
    return{...category,reference:category.ugb};
  });
  return{...UGB_REFERENCES,categories,modified};
}
export function ugbCategory(key,table=UGB_REFERENCES){return table.categories.find(category=>category.key===key)||null;}

/** UGB d’un lot : effectif × coefficient de sa catégorie ; sans catégorie, 1 UGB par animal (avertissement). */
export function ugbOf(session,table=UGB_REFERENCES){
  const heads=grazingTotal(session),category=ugbCategory(session?.animalCategory,table);
  const perHead=category?category.ugb:1;
  return{heads,perHead,ugb:Math.round(heads*perHead*1000)/1000,category,known:Boolean(category),warning:category||!heads?'':'Catégorie d’animaux non renseignée : 1 UGB par animal.'};
}

// Nombre de jours de présence d’un passage dans [from, to] (bornes incluses ; sortie le jour J non comptée).
export function presenceDays(session,{from,to}){
  const start=grazingDate(session?.startDate);if(!start)return 0;
  const end=session?.endDate?grazingDate(session.endDate):'';
  const a=start>from?start:from,b=end?(end<=to?end:shiftDay(to,1)):shiftDay(to,1);
  return Math.max(0,daysBetween(a,b));
}
const liveSessions=sessions=>(Array.isArray(sessions)?sessions:[]).filter(s=>isRecord(s)&&!s.deletedAt&&grazingStatus(s)!=='invalid');
const seasonStart=day=>`${day.slice(0,4)}-01-01`;

/** Chargement d’une parcelle : instantané (UGB/ha), cumul de la saison (jours UGB/ha) et repos. */
export function stockingRate(state,parcelId,{date=new Date(),table=ugbTable(state),restDays=null}={}){
  const day=grazingDate(date),parcel=(state?.parcelles||[]).find(p=>p.id===parcelId&&!p.deletedAt),area=finite(parcel?.surfaceHa);
  const sessions=liveSessions(state?.grazingSessions).filter(s=>s.parcelId===parcelId);
  const current=sessions.filter(s=>grazingStatus(s,{date:day})==='current');
  const ugbNow=current.reduce((sum,s)=>sum+ugbOf(s,table).ugb,0);
  const from=seasonStart(day);
  const ugbDays=sessions.reduce((sum,s)=>sum+ugbOf(s,table).ugb*presenceDays(s,{from,to:day}),0);
  const exits=sessions.map(s=>s.endDate?grazingDate(s.endDate):'').filter(end=>end&&end<=day).sort();
  const lastExit=current.length?null:exits.at(-1)||null;
  const advised=finite(restDays)??finite(state?.preferences?.grazingRestDays)??table.defaultRestDays;
  const rest=lastExit?daysBetween(lastExit,day):null;
  return{
    parcelId,area,grazed:current.length>0,ugb:Math.round(ugbNow*100)/100,
    instant:area>0?Math.round(ugbNow/area*100)/100:null,
    seasonUgbDays:Math.round(ugbDays*10)/10,seasonPerHa:area>0?Math.round(ugbDays/area*10)/10:null,
    lastExit,restDays:rest,advisedRest:advised,rested:rest===null?null:rest>=advised,
    unknownCategory:current.some(s=>!ugbOf(s,table).known)
  };
}

export function restLabel(rate){
  if(!rate||rate.restDays===null)return '';
  return `Repos depuis ${rate.restDays} j, ${rate.advisedRest} j conseillés`;
}

const FORAGE=/prairie|herbe|pature|paturage|luzerne|trefle|ray.?grass|fetuque|dactyle|fourrag|ensil|sainfoin|meteil/;
/** Surface fourragère principale : prairies, fourrages et parcelles déjà pâturées. */
export function isForageParcel(parcel,sessions=[]){
  return FORAGE.test(normalize(parcel?.culture))||sessions.some(s=>s.parcelId===parcel?.id);
}

const lotKey=session=>normalize(text(session?.note)||`${grazingType(session)} ${session?.animalCategory||''}`);
const lotLabel=session=>text(session?.note)||[grazingType(session),ugbCategory(session?.animalCategory)?.label].filter(Boolean).join(' · ');

/** Bilan de l’exploitation sur une année civile, arrêté à la date du jour. */
export function farmGrazingBalance(state,{date=new Date(),year=null,table=ugbTable(state)}={}){
  const day=grazingDate(date),y=year||Number(day.slice(0,4)),from=`${y}-01-01`,yearEnd=`${y}-12-31`,to=yearEnd<day?yearEnd:day;
  const sessions=liveSessions(state?.grazingSessions).filter(s=>grazingDate(s.startDate)<=to);
  const parcels=(state?.parcelles||[]).filter(p=>!p.deletedAt&&!p.archived);
  const sfpParcels=parcels.filter(p=>isForageParcel(p,sessions));
  const sfp=Math.round(sfpParcels.reduce((sum,p)=>sum+(finite(p.surfaceHa)||0),0)*100)/100;
  let ugbDays=0,nitrogen=0,unknown=0;const lots=new Map();
  for(const s of sessions){
    const days=presenceDays(s,{from,to});if(!days)continue;
    const u=ugbOf(s,table),n=u.category?u.heads*u.category.nPerYear:u.heads*table.unknownNPerUgb;
    ugbDays+=u.ugb*days;nitrogen+=n*days/365;if(!u.known)unknown+=1;
    const key=lotKey(s),lot=lots.get(key)||{key,label:lotLabel(s),days:0,ugbDays:0,passages:0,parcels:new Set(),sessions:[]};
    lot.days+=days;lot.ugbDays+=u.ugb*days;lot.passages+=1;lot.parcels.add(s.parcelId);
    lot.sessions.push({start:grazingDate(s.startDate)<from?from:grazingDate(s.startDate),end:s.endDate&&grazingDate(s.endDate)<=to?grazingDate(s.endDate):'',count:u.heads,type:(parcels.find(p=>p.id===s.parcelId)?.nom)||'Parcelle'});
    lots.set(key,lot);
  }
  const yearDays=daysBetween(from,`${y+1}-01-01`);
  return{
    year:y,from,to,sfp,sfpParcels:sfpParcels.length,
    ugbDays:Math.round(ugbDays),meanStocking:sfp>0?Math.round(ugbDays/yearDays/sfp*100)/100:null,
    nitrogen:Math.round(nitrogen),unknownCategory:unknown,table,
    lots:[...lots.values()].map(lot=>({...lot,parcels:lot.parcels.size})).sort((a,b)=>b.days-a.days||a.label.localeCompare(b.label,'fr'))
  };
}

/** Azote organique déposé au pâturage sur une période (kg N), pour le plafond de 170 kg N. */
export function grazingNitrogen(state,{from,to,table=ugbTable(state)}){
  let total=0,unknown=0;
  for(const s of liveSessions(state?.grazingSessions)){
    const days=presenceDays(s,{from,to});if(!days)continue;
    const u=ugbOf(s,table);if(!u.known)unknown+=1;
    total+=(u.category?u.heads*u.category.nPerYear:u.heads*table.unknownNPerUgb)*days/365;
  }
  return{total:Math.round(total),unknown};
}

// ---------- n° 77 · Pâturage en un geste depuis le terrain ----------
const nounFor=(type,total)=>{const t=normalize(type);if(!t||t==='non precise')return total>1?'animaux':'animal';return text(type).toLocaleLowerCase('fr');};
/** Carte terrain d’une prairie : lots présents, en-tête « Pré Bas · 24 vaches depuis 9 j », lots déplaçables ailleurs. */
export function fieldGrazingSummary(state,parcelId,{date=new Date()}={}){
  const day=grazingDate(date),parcels=(state?.parcelles||[]).filter(p=>!p.deletedAt),parcel=parcels.find(p=>p.id===parcelId)||null;
  const current=liveSessions(state?.grazingSessions).filter(s=>grazingStatus(s,{date:day})==='current');
  const describe=s=>{const total=grazingTotal(s),start=grazingDate(s.startDate),days=start?Math.max(0,daysBetween(start,day)):null;return{id:s.id,total,type:grazingType(s),noun:nounFor(grazingType(s),total),days,label:text(s.note)||`${total} ${nounFor(grazingType(s),total)}`,parcelId:s.parcelId,parcelName:text(parcels.find(p=>p.id===s.parcelId)?.nom)||'Parcelle'};};
  const here=current.filter(s=>s.parcelId===parcelId).map(describe),elsewhere=current.filter(s=>s.parcelId!==parcelId).map(describe);
  const name=text(parcel?.nom)||'Parcelle';
  const headline=here.length?`${name} · ${here.map(l=>`${l.total} ${l.noun}${l.days!==null?` depuis ${l.days} j`:''}`).join(' + ')}`:`${name} · aucun animal au pré`;
  return{parcel,here,elsewhere,headline,known:here.reduce((sum,l)=>sum+l.total,0),pasture:Boolean(parcel)&&(here.length>0||isForageParcel(parcel,[]))};
}
/** Écart du comptage avec l’effectif connu (aucune écriture). */
export function countGap(known,counted){
  const k=Math.max(0,Math.floor(Number(known)||0)),c=Math.max(0,Math.floor(Number(counted)||0)),gap=c-k;
  return{known:k,counted:c,gap,label:gap===0?`Effectif conforme : ${c}`:`Écart de ${gap>0?'+':'−'}${Math.abs(gap)} sur ${k} connu${k>1?'s':''}`};
}
const CHECKS={water:{type:'Eau',title:'Abreuvoir à voir'},fence:{type:'Clôture',title:'Clôture cassée'}};
/** Observation géolocalisée créée par « Abreuvoir à voir » ou « Clôture cassée ». */
export function grazingCheckObservation(kind,{parcel,gps=null,date=new Date(),lot=''}={}){
  const check=CHECKS[kind];if(!check||!parcel)return null;
  const finiteOrNull=v=>Number.isFinite(Number(v))&&v!==null&&v!==''?Number(v):null;
  return{parcelId:parcel.id,date:grazingDate(date),type:check.type,title:`${check.title} · ${text(parcel.nom)}`,note:lot?`Contrôle au pré, lot : ${lot}.`:'Contrôle au pré.',severity:'warning',status:'À surveiller',latitude:finiteOrNull(gps?.latitude),longitude:finiteOrNull(gps?.longitude),accuracy:finiteOrNull(gps?.accuracy),observedAt:new Date(date instanceof Date?date:Date.now()).toISOString(),resolvedAt:null};
}
