import {clone,validateParcel} from './utils.js';
import {normalizeEntity} from './state.js';
import {rpgFeatureId,rpgFeatureToParcel} from './rpg.js';

const OWNERSHIP_TYPES=new Set(['own','client','service']);
const POINT_FIELDS=new Set(['nom','type','note','parcelId','latitude','longitude']);
const CURRENT_RPG_ID=/^rpg:\d{4}:(?:parcel|feature):/;

function requireWrite(store,entity,action,entityId){
  if(store.writeGuard&&!store.writeGuard({entity,action,entityId}))throw new Error('Votre rôle ne permet pas cette modification.');
}

function rpgMatch(parcels,sourceId,geometry){
  const exact=parcels.filter(parcel=>parcel.sourceId===sourceId);
  if(exact.length>1)throw new Error('Plusieurs parcelles portent cet identifiant RPG. Vérifiez les doublons avant de continuer.');
  if(exact.length)return exact[0];
  // Older RPG records may predate the namespaced source ID. Their exact outline
  // is usable as an identity only if the record is explicitly of RPG origin.
  const serialized=JSON.stringify(geometry);
  const legacy=parcels.filter(parcel=>String(parcel.source||'').toLowerCase()==='rpg'&&!CURRENT_RPG_ID.test(String(parcel.sourceId||''))&&JSON.stringify(parcel.geometry)===serialized);
  if(legacy.length>1)throw new Error('Plusieurs anciennes parcelles RPG ont ce contour. Vérifiez les doublons avant de continuer.');
  return legacy[0]||null;
}

export function addRpgParcel(store,feature,options={}){
  const input=clone(feature),settings=clone(options);
  return store.enqueueWrite(async()=>{
    requireWrite(store,'parcelles','create');
    const base=rpgFeatureToParcel(input,{year:settings.year});
    const sourceId=rpgFeatureId(input,{year:settings.year});
    const existing=rpgMatch(store.state.parcelles,sourceId,base.geometry);
    if(existing){
      if(existing.deletedAt)throw new Error('Cette parcelle RPG se trouve dans la corbeille. Restaurez-la depuis Mes données → Corbeille.');
      return{parcel:clone(existing),created:false};
    }
    const ownershipType=settings.ownershipType??'own';
    if(!OWNERSHIP_TYPES.has(ownershipType))throw new Error('Choisissez Mon exploitation, Client ou Prestation.');
    const newClientName=String(settings.newClientName??'').trim();
    const requestedClientId=String(settings.clientId??'').trim();
    let clientId=null,newClient=null;
    if(ownershipType!=='own'){
      if(requestedClientId&&newClientName)throw new Error('Choisissez un client existant ou créez un nouveau client, pas les deux.');
      if(requestedClientId){
        const clients=store.state.clients.filter(client=>client.id===requestedClientId&&!client.deletedAt);
        if(clients.length!==1)throw new Error('Le client sélectionné est introuvable ou supprimé. Choisissez un client actif.');
        clientId=clients[0].id;
      }else if(newClientName){
        requireWrite(store,'clients','create');
        newClient=normalizeEntity('clients',{name:newClientName,source:'local'});clientId=newClient.id;
      }else throw new Error('Sélectionnez un client ou renseignez le nom du nouveau client.');
    }
    const parcel=normalizeEntity('parcelles',{
      ...base,sourceId,nom:settings.nom===undefined?base.nom:String(settings.nom).trim(),
      culture:settings.culture===undefined?base.culture:String(settings.culture).trim(),
      ownershipType,clientId,status:'À jour'
    });
    const errors=validateParcel(parcel);if(errors.length)throw new Error(errors.join(' — '));
    await store._mutate(`Parcelle RPG ajoutée : ${parcel.nom}`,state=>{
      if(newClient){state.clients.push(newClient);store.queue({entity:'clients',entityId:newClient.id,action:'create',payload:clone(newClient)});}
      state.parcelles.push(parcel);store.queue({entity:'parcelles',entityId:parcel.id,action:'create',payload:clone(parcel)});
    },{entity:'parcelles',entityId:parcel.id,action:'create',kind:'rpg-add',queue:false});
    return{parcel:clone(parcel),created:true};
  });
}

function coordinate(value,label,max){
  const text=typeof value==='string'?value.trim().replace(',','.'):null;
  const validType=typeof value==='number'||(text!==null&&/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text));
  const number=typeof value==='number'?value:Number(text);
  if(!validType||!Number.isFinite(number)||Math.abs(number)>max)throw new Error(`${label} invalide : renseignez une coordonnée comprise entre -${max} et ${max}.`);
  return number;
}

export function updateMapPoint(store,id,changes){
  const input=clone(changes);
  return store.enqueueWrite(async()=>{
    requireWrite(store,'points','update',id);
    const matches=store.state.points.filter(point=>point.id===id);
    if(matches.length!==1||matches[0].deletedAt)throw new Error('Ce point est introuvable, supprimé ou son identifiant est ambigu. Rouvrez la liste des points.');
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Les modifications du point sont invalides.');
    const patch={};
    for(const [field,value] of Object.entries(input)){
      if(!POINT_FIELDS.has(field))throw new Error(`Le champ ${field} ne peut pas être modifié depuis la carte.`);
      if(['nom','type','note'].includes(field)){
        if(typeof value!=='string')throw new Error('Le nom, le type et la note doivent être du texte.');
        patch[field]=field==='note'?value:value.trim();
        if(field==='type'&&!patch.type)throw new Error('Le type du point est obligatoire.');
      }else if(field==='parcelId'){
        if(value!==null&&typeof value!=='string')throw new Error('La parcelle associée est invalide.');
        patch.parcelId=value?.trim()||null;
        if(patch.parcelId&&!store.get('parcelles',patch.parcelId))throw new Error('La parcelle associée est introuvable ou supprimée.');
      }else patch[field]=coordinate(value,field==='latitude'?'Latitude':'Longitude',field==='latitude'?90:180);
    }
    if(!Object.keys(patch).length)return clone(matches[0]);
    const current=matches[0];
    coordinate(patch.latitude??current.latitude,'Latitude',90);
    coordinate(patch.longitude??current.longitude,'Longitude',180);
    const point=normalizeEntity('points',{...patch,id},current);
    await store._mutate(`Point modifié : ${point.nom||point.name||point.type||'Point'}`,state=>{
      const index=state.points.findIndex(row=>row.id===id);state.points[index]=point;
    },{entity:'points',entityId:id,action:'update',payload:point});
    return clone(point);
  });
}
