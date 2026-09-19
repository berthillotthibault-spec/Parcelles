import {clone,now,uid} from './utils.js';

// Exact CP_CULTU labels verified against fixtures/Export_SHP_Le_Sougey.zip.
// These labels restore known lost accents only; arbitrary missing text is never guessed.
const CULTURE_LABELS=[
  "Orge 2 rangs d'hiver",'Prairie perm. pât fauchée','Maïs grain','Maïs fourrage',
  'Prairie temp. pât fauchée',"Blé tendre d'hiver",'Soja',"Colza oléagineux d'hiver",
  'Autres utilisations','Bande enherbée','Ray-grass dérobé','Jachère autre semée',"Triticale d'hiver"
];
const TEXT_FIELDS=['nom','culture','commune','exploitant'];
const damaged=value=>typeof value==='string'&&/[\uFFFD?]/u.test(value);
const sourceKey=row=>typeof row?.sourceId==='string'&&row.sourceId.trim()?row.sourceId:null;

function matchesLostAccents(before,after){
  if(!damaged(before)||typeof after!=='string'||damaged(after))return false;
  const oldChars=[...before],newChars=[...after];
  return oldChars.length===newChars.length&&oldChars.every((char,index)=>
    char===newChars[index]||(/[\uFFFD?]/u.test(char)&&/^[A-Za-z][\u0300-\u036f]+$/u.test(newChars[index].normalize('NFD')))
  );
}

function groupBySource(rows){
  const groups=new Map();
  for(const row of rows){const key=sourceKey(row);if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  return groups;
}

export function buildTextRepairPlan(state,sourceRows=[]){
  const parcels=(state?.parcelles||[]).filter(row=>row&&typeof row==='object'&&!row.deletedAt);
  const storedBySource=groupBySource(parcels);
  const sourceById=groupBySource((Array.isArray(sourceRows)?sourceRows:[]).filter(row=>row&&typeof row==='object'&&!row.type));
  const changes=[],unresolved=[];
  for(const parcel of parcels){
    const key=sourceKey(parcel),sources=key?sourceById.get(key)||[]:[];
    const ambiguous=Boolean(key&&((storedBySource.get(key)?.length||0)>1||sources.length>1));
    const original=!ambiguous&&sources.length===1?sources[0]:null;
    for(const field of TEXT_FIELDS){
      const before=parcel[field];if(!damaged(before))continue;
      const label=String(parcel.nom||'Parcelle');
      const sourceValue=original?.[field];
      const sourceHasValue=typeof sourceValue==='string'&&sourceValue!=='';
      const sourceConflict=sourceHasValue&&!matchesLostAccents(before,sourceValue);
      const candidates=new Set();
      if(!ambiguous&&!sourceConflict){
        if(field==='culture')for(const value of CULTURE_LABELS)if(matchesLostAccents(before,value))candidates.add(value);
        if(sourceHasValue&&matchesLostAccents(before,sourceValue))candidates.add(sourceValue);
      }
      if(candidates.size===1&&parcel.id){
        changes.push({entity:'parcelles',id:parcel.id,label,field,before,after:[...candidates][0]});
      }else unresolved.push({id:parcel.id,label,field,value:before});
    }
  }
  return{changes,unresolved};
}

export function applyTextRepairs(store,plan){
  // Copy the reviewed plan before waiting on earlier writes.
  const changes=clone(plan?.changes||[]);
  return store.enqueueWrite(async()=>{
    if(!Array.isArray(changes))throw new Error('La liste des corrections est invalide. Relancez l’analyse.');
    if(!changes.length)return{repaired:0,parcels:0,backupId:null};
    const grouped=new Map();
    for(const change of changes){
      if(change.entity!=='parcelles'||!change.id||!TEXT_FIELDS.includes(change.field)||!matchesLostAccents(change.before,change.after)){
        throw new Error('Une correction est invalide. Relancez l’analyse des caractères.');
      }
      const matches=store.state.parcelles.filter(row=>row.id===change.id&&!row.deletedAt);
      if(matches.length!==1||matches[0][change.field]!==change.before){
        throw new Error('Les données ont changé depuis l’analyse. Relancez l’analyse avant de corriger les caractères.');
      }
      if(!grouped.has(change.id))grouped.set(change.id,new Map());
      const fields=grouped.get(change.id);
      if(fields.has(change.field))throw new Error('Une correction est présente plusieurs fois. Relancez l’analyse.');
      fields.set(change.field,change.after);
    }
    for(const id of grouped.keys()){
      if(store.writeGuard&&!store.writeGuard({entity:'parcelles',entityId:id,action:'update'})){
        throw new Error('Votre rôle ne permet pas de corriger ces parcelles.');
      }
    }
    if(store.storage.usingFallback)throw new Error('La sauvegarde préalable est indisponible. Rétablissez le stockage avant de corriger les caractères.');
    const timestamp=now(),backupId=uid('text_repair');
    const backup=await store.storage.backupPut({id:backupId,workspaceId:store.workspaceId||'local',period:'pre-text-repair',createdAt:timestamp,state:store.snapshot()});
    if(backup?.id!==backupId)throw new Error('La sauvegarde préalable n’a pas pu être confirmée. Aucun caractère n’a été modifié.');
    await store._mutate('Caractères accentués restaurés.',state=>{
      for(const [id,fields] of grouped){
        const parcel=state.parcelles.find(row=>row.id===id);
        for(const [field,value] of fields)parcel[field]=value;
        parcel.updatedAt=timestamp;parcel.version=(Number(parcel.version)||0)+1;
        store.queue({entity:'parcelles',entityId:id,action:'update',payload:clone(parcel)});
      }
    },{entity:'parcelles',action:'update',kind:'text-repair',queue:false,details:{fields:changes.length,parcels:grouped.size,backupId}});
    return{repaired:changes.length,parcels:grouped.size,backupId};
  });
}
