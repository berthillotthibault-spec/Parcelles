import {clone} from './utils.js';
import {normalizeEntity} from './state.js';
import {grazingAnimalList,grazingDate,grazingStatus,grazingTotal} from './grazing.js';
import {grazingReentryConflict} from './phyto.js';

const fields=['parcelId','animalType','animalCategory','startDate','endDate','animals','additionalAnimalsCount','animalsCount','note'];
const revision=row=>JSON.stringify(fields.map(key=>row?.[key]??null));
function currentSession(store,id){
  const matches=store.state.grazingSessions.filter(row=>row.id===id);
  if(matches.length!==1||matches[0].deletedAt)throw new Error('Ce lot est introuvable ou supprimé. Rouvrez la liste des pâturages.');
  return matches[0];
}
function requireWrite(store,id){
  if(store.writeGuard&&!store.writeGuard({entity:'grazingSessions',action:id?'update':'create',entityId:id}))throw new Error('Votre rôle ne permet pas cette modification.');
}
async function persist(store,patch,current,label){
  const saved=normalizeEntity('grazingSessions',patch,current);
  await store._mutate(label,state=>{
    if(current)state.grazingSessions[state.grazingSessions.findIndex(row=>row.id===current.id)]=saved;
    else state.grazingSessions.push(saved);
  },{entity:'grazingSessions',entityId:saved.id,action:current?'update':'create',payload:saved});
  return clone(saved);
}

export function saveGrazingSession(store,input,{id=null,expected=null}={}){
  const values=clone(input),expectedRevision=expected?revision(expected):null;
  return store.enqueueWrite(async()=>{
    requireWrite(store,id);const current=id?currentSession(store,id):null;
    if(current&&expectedRevision!==null&&revision(current)!==expectedRevision)throw new Error('Ce lot a changé depuis l’ouverture du formulaire. Revenez à la liste puis rouvrez-le pour conserver les dernières modifications.');
    if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(key=>!fields.includes(key)))throw new Error('Informations de pâturage invalides.');
    if(store.state.parcelles.filter(row=>row.id===values.parcelId&&!row.deletedAt).length!==1)throw new Error('La parcelle est introuvable ou supprimée. Choisissez une parcelle disponible.');
    const start=grazingDate(values.startDate),end=values.endDate?grazingDate(values.endDate):null;
    if(!start||!/^\d{4}-\d{2}-\d{2}$/.test(values.startDate)||(values.endDate&&!end)||(end&&end<start))throw new Error('Vérifiez les dates d’entrée et de sortie.');
    const additional=values.additionalAnimalsCount;
    if(!Number.isSafeInteger(additional)||additional<0)throw new Error('Indiquez un nombre entier positif ou nul d’animaux sans numéro.');
    const animals=values.animals,identified=grazingAnimalList({animals});
    if(Array.isArray(animals)){
      if(identified.length!==animals.length)throw new Error('Chaque animal doit avoir un numéro ou un nom.');
      const ids=identified.map(animal=>String(animal.number||animal.name).replace(/\s+/g,'').toLocaleUpperCase('fr'));
      if(new Set(ids).size!==ids.length)throw new Error('Un animal apparaît plusieurs fois dans ce lot.');
    }else if(typeof animals!=='string'||animals!==current?.animals)throw new Error('La liste des animaux est invalide.');
    if(identified.length+additional<1)throw new Error('Le lot doit contenir au moins un animal.');
    if(typeof values.note!=='string'||typeof values.animalType!=='string')throw new Error('Le type et le commentaire doivent être du texte.');
    if(values.animalCategory!==undefined&&values.animalCategory!==null&&typeof values.animalCategory!=='string')throw new Error('Catégorie d’animaux invalide.');
    return persist(store,{...values,...(id?{id}:{}),startDate:start,endDate:end,animalsCount:identified.length+additional},current,`Pâturage ${current?'modifié':'enregistré'}.`);
  });
}

export function endGrazingSession(store,id,{date=grazingDate()}={}){
  return store.enqueueWrite(async()=>{
    requireWrite(store,id);const current=currentSession(store,id),day=grazingDate(date);
    if(!day||grazingStatus(current,{date:day})!=='current')throw new Error('Ce lot n’est pas au pré à cette date. Actualisez la liste.');
    return persist(store,{id,endDate:day},current,'Sortie de pâturage enregistrée.');
  });
}

// n° 62 — mise au pâturage pendant le délai de rentrée d’un traitement : alerte (pas de blocage).
export function grazingReentryAlert(state,parcelId,startDate,options={}){return grazingReentryConflict(state,parcelId,startDate,options);}

// n° 77 — déplacement d’un lot (fiche ou terrain) : clôt le passage actuel et en ouvre un nouveau.
// En cas d’échec de la création, le passage d’origine est rouvert.
export async function moveGrazingLot(store,session,parcelId,{date=grazingDate()}={}){
  const day=grazingDate(date),animals=grazingAnimalList(session);
  const additional=Math.max(0,grazingTotal(session)-animals.length);
  const moved={parcelId,animalType:session.animalType||'Non précisé',animalCategory:session.animalCategory||null,startDate:day,endDate:null,animals,additionalAnimalsCount:additional,note:session.note||''};
  await endGrazingSession(store,session.id,{date:day});
  try{return await saveGrazingSession(store,moved);}
  catch(failure){await saveGrazingSession(store,{parcelId:session.parcelId,animalType:session.animalType||'Non précisé',animalCategory:session.animalCategory||null,startDate:String(session.startDate).slice(0,10),endDate:null,animals:session.animals??[],additionalAnimalsCount:Number(session.additionalAnimalsCount)||0,note:session.note||''},{id:session.id}).catch(()=>{});throw failure;}
}

// n° 77 — mise à jour de l’effectif après comptage (sur confirmation) : seuls les animaux sans numéro changent.
export function updateGrazingCount(store,id,counted){
  const current=currentSession(store,id),identified=grazingAnimalList(current).length,n=Math.floor(Number(counted));
  if(!Number.isSafeInteger(n)||n<1)return Promise.reject(new Error('Comptez au moins un animal.'));
  if(n<identified)return Promise.reject(new Error(`Le lot compte ${identified} animaux identifiés : retirez les numéros concernés dans la fiche du lot.`));
  return saveGrazingSession(store,{parcelId:current.parcelId,animalType:current.animalType||'Non précisé',animalCategory:current.animalCategory||null,startDate:grazingDate(current.startDate),endDate:current.endDate?grazingDate(current.endDate):null,animals:Array.isArray(current.animals)?current.animals:current.animals??[],additionalAnimalsCount:n-identified,note:current.note||''},{id,expected:current});
}
