// Historique des fiches (n° 130) : logique pure, sans DOM ni IndexedDB.
// Chaque modification enregistrée produit une ligne { avant, différences } conservée hors de l’état
// synchronisé (object store IndexedDB « history ») ; la géométrie n’y est jamais copiée en entier.

export const HISTORY_MAX_PER_ENTITY=50;
export const HISTORY_MAX_AGE_DAYS=90;
// Taille au-delà de laquelle une valeur n’est pas recopiée dans l’historique (photos, longues listes…).
export const HISTORY_MAX_VALUE_CHARS=4000;
// Fiches dont l’historique n’a pas d’intérêt pour l’utilisateur (journaux techniques, messages, files d’attente).
export const HISTORY_SKIPPED_TYPES=new Set(['importSessions','syncConflicts','notifications','assistantMessages','devices','automationRuns','platformJobs','platformEvents','integrationImports','routeSessions','gpsTracks']);
// Champs techniques jamais comparés ni affichés.
const META_FIELDS=new Set(['id','createdAt','updatedAt','version','source','sourceId','deletedAt']);
const HEAVY_FIELDS=new Set(['geometry']);

const LABELS={
  nom:'Nom',name:'Nom',title:'Titre',type:'Travail',culture:'Culture',variete:'Variété',variety:'Variété',surfaceHa:'Surface',surfaceWorked:'Surface travaillée',
  date:'Date',plannedDate:'Échéance',dueDate:'Échéance',startTime:'Début',endTime:'Fin',status:'Statut',product:'Produit',dose:'Dose',doseUnit:'Unité de dose',
  productUnitPrice:'Prix du produit',duration:'Durée',fuel:'Carburant',operator:'Opérateur',equipmentId:'Matériel',parcelId:'Parcelle',cost:'Coût total',
  machineCost:'Coût machine',fuelCost:'Coût carburant',inputCost:'Coût intrants',operatorCost:'Coût opérateur',otherCost:'Autres coûts',note:'Note',notes:'Note',
  commune:'Commune',favorite:'Favori',archived:'Archivée',clientId:'Client',priority:'Priorité',assignee:'Responsable',description:'Description',
  quantity:'Quantité',unit:'Unité',unitPrice:'Prix unitaire',alertBelow:'Seuil d’alerte',location:'Emplacement',hourlyCost:'Coût horaire',
  animalType:'Animaux',animalsCount:'Effectif',startDate:'Entrée',endDate:'Sortie',severity:'Gravité',category:'Catégorie',isPhytosanitary:'Phytosanitaire',
  geometry:'Contour',economics:'Économie',campaignId:'Campagne',ilot:'Îlot',pacCode:'Code PAC',
  hours:'Heures',kind:'Nature',supplier:'Fournisseur',reference:'Référence',
};
const UNITS={surfaceHa:'ha',surfaceWorked:'ha',duration:'h',fuel:'L',cost:'€',machineCost:'€',fuelCost:'€',inputCost:'€',operatorCost:'€',otherCost:'€',productUnitPrice:'€',unitPrice:'€',hourlyCost:'€',hours:'h'};

// Plus récent d’abord ; à la même milliseconde, l’ordre d’écriture départage.
export function compareHistoryDesc(a,b){return ((b?.at||0)-(a?.at||0))||((b?.seq||0)-(a?.seq||0));}
export function historyKey(workspaceId,type,id){return `${String(workspaceId||'local')}|${type}|${id}`;}
export function shouldRecordHistory(type){return Boolean(type)&&!HISTORY_SKIPPED_TYPES.has(type);}

function json(value){try{return JSON.stringify(value)??'';}catch{return '';}}
function same(a,b){if(a===b)return true;if((a===null||a===undefined||a==='')&&(b===null||b===undefined||b===''))return true;return json(a)===json(b);}
function storable(value){if(value===null||value===undefined)return null;if(typeof value==='string')return value.length>200?`${value.slice(0,197)}…`:value;if(typeof value!=='object')return value;const text=json(value);return text.length<=300?JSON.parse(text):undefined;}

// Copie allégée de la fiche : sans géométrie ni valeur volumineuse (les clés retirées sont listées).
export function stripHeavy(entity){
  if(!entity||typeof entity!=='object')return {value:null,omitted:[]};
  const value={},omitted=[];
  for(const [key,item] of Object.entries(entity)){
    if(HEAVY_FIELDS.has(key)&&item){omitted.push(key);continue;}
    if(item!==null&&typeof item==='object'&&json(item).length>HISTORY_MAX_VALUE_CHARS){omitted.push(key);continue;}
    if(typeof item==='string'&&item.length>HISTORY_MAX_VALUE_CHARS){omitted.push(key);continue;}
    value[key]=item;
  }
  return {value:structuredClone(value),omitted};
}

// Différences champ par champ (hors champs techniques). Les objets volumineux sont seulement signalés comme modifiés.
export function diffEntities(before,after){
  const a=before||{},b=after||{},keys=new Set([...Object.keys(a),...Object.keys(b)]),changes=[];
  for(const field of keys){
    if(META_FIELDS.has(field)||same(a[field],b[field]))continue;
    const from=storable(a[field]),to=storable(b[field]);
    if(HEAVY_FIELDS.has(field)||from===undefined||to===undefined)changes.push({field,changed:true});
    else changes.push({field,from,to});
  }
  return changes;
}

export function buildHistoryEntry({workspaceId='local',type,before=null,after=null,action='update',by='',label='',at=Date.now(),seq=0}){
  const entityId=String(after?.id||before?.id||'');
  const stripped=stripHeavy(before);
  const effective=action==='update'&&before?.deletedAt&&after&&!after.deletedAt?'restore':action==='update'&&after?.deletedAt&&before&&!before.deletedAt?'delete':action;
  return {
    id:`h_${at.toString(36)}_${Math.random().toString(36).slice(2,8)}_${seq}`,
    key:historyKey(workspaceId,type,entityId),workspaceId:String(workspaceId||'local'),type,entityId,at,seq,by:String(by||''),action:before?effective:'create',label:String(label||''),
    before:before?stripped.value:null,omitted:stripped.omitted,diff:diffEntities(before,after),
  };
}
// Une modification sans aucune différence visible (réenregistrement à l’identique) n’est pas conservée.
export function isMeaningfulEntry(entry){return Boolean(entry)&&(entry.action!=='update'&&entry.action!=='remote'||entry.diff.length>0);}

// Lignes à supprimer pour respecter les plafonds (50 versions par fiche, 90 jours).
export function historyRowsToPrune(rows,{max=HISTORY_MAX_PER_ENTITY,maxAgeDays=HISTORY_MAX_AGE_DAYS,at=Date.now()}={}){
  const cutoff=at-maxAgeDays*86400000,sorted=[...rows].sort(compareHistoryDesc);
  return sorted.filter((row,index)=>index>=max||(row.at||0)<cutoff).map(row=>row.id);
}

// Fiche à réenregistrer pour revenir à `target` : les champs apparus depuis sont vidés,
// ceux non conservés dans l’historique (géométrie, valeurs volumineuses) gardent leur valeur actuelle.
export function revertEntity(current,target,omitted=[]){
  const next={...structuredClone(target||{})};
  for(const key of omitted||[])if(current&&key in current)next[key]=structuredClone(current[key]);
  for(const key of Object.keys(current||{}))if(!META_FIELDS.has(key)&&!(key in next))next[key]=null;
  next.id=current?.id||target?.id;
  for(const key of ['createdAt','updatedAt','version','deletedAt'])delete next[key];
  return next;
}

function formatValue(field,value,entity){
  if(value===null||value===undefined||value==='')return '—';
  if(typeof value==='boolean')return value?'oui':'non';
  if(/date$/i.test(field)&&/^\d{4}-\d{2}-\d{2}/.test(String(value))){const [y,m,d]=String(value).slice(0,10).split('-');return `${d}/${m}/${y}`;}
  let text=typeof value==='number'?String(value).replace('.',','):typeof value==='object'?'…':String(value);
  if(text.length>40)text=`${text.slice(0,39)}…`;
  const unit=field==='dose'?(entity?.doseUnit||''):UNITS[field]||'';
  return unit?`${text} ${unit}`:text;
}
export function fieldLabel(field){return LABELS[field]||field.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());}
// « Dose 120 → 140 L/ha » ; les champs techniques imbriqués ne sont pas détaillés.
export function describeChange(change,entity){
  if(change.changed)return change.field==='geometry'?'Contour modifié':`Modification\u00a0: ${fieldLabel(change.field)}`;
  return `${fieldLabel(change.field)} ${formatValue(change.field,change.from,entity)} → ${formatValue(change.field,change.to,entity)}`;
}
const ACTION_TEXT={create:'Création',delete:'Mise à la corbeille',restore:'Restauration',revert:'Retour à une version'};
export function describeEntry(entry,entity,{limit=3}={}){
  // Champs connus d’abord, et parmi eux ceux qui avaient déjà une valeur (une valeur par défaut ajoutée importe moins).
  const empty=v=>v===null||v===undefined||v==='';
  const visible=(entry.diff||[]).filter(c=>LABELS[c.field]).sort((a,b)=>Number(!a.changed&&empty(a.from))-Number(!b.changed&&empty(b.from)));
  if(entry.action==='create')return ACTION_TEXT.create;
  if(entry.action==='delete'||entry.action==='restore')return ACTION_TEXT[entry.action];
  const parts=(visible.length?visible:entry.diff||[]).slice(0,limit).map(c=>describeChange(c,entity));
  const rest=(visible.length?visible:entry.diff||[]).length-parts.length;
  return parts.length?`${parts.join(' · ')}${rest>0?` · et ${rest} autre${rest>1?'s':''} champ${rest>1?'s':''}`:''}`:'Modification';
}
export function formatHistoryDate(at){const d=new Date(at);const p=n=>String(n).padStart(2,'0');return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`;}
export function historyAuthor(by,members=[]){
  const value=String(by||'').trim();if(!value)return 'Cet appareil';
  if(value==='remote')return 'Synchronisation';
  const member=(members||[]).find(m=>!m?.deletedAt&&(m.email===value||m.uid===value));
  if(member?.name||member?.nom)return member.name||member.nom;
  return value.includes('@')?value.split('@')[0]:value;
}
