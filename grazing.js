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
