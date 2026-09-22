import {clone} from './utils.js';
import {normalizeEntity} from './state.js';
import {grazingAnimalList,grazingDate,grazingStatus} from './grazing.js';

const fields=['parcelId','animalType','startDate','endDate','animals','additionalAnimalsCount','animalsCount','note'];
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
