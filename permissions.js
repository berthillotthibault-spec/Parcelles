export const ROLES={
  owner:{label:'Propriétaire',rank:6},
  manager:{label:'Responsable',rank:5},
  editor:{label:'Collaborateur',rank:4},
  operator:{label:'Opérateur terrain',rank:3},
  accountant:{label:'Gestion / comptabilité',rank:2},
  viewer:{label:'Lecture seule',rank:1}
};

export const ROLE_CAPABILITIES={
  owner:new Set(['read','write','delete','purge','restore','manage-members','manage-workspace','export','import','sync','platform-jobs']),
  manager:new Set(['read','write','delete','restore','export','import','sync','platform-jobs']),
  editor:new Set(['read','write','delete','export','sync']),
  operator:new Set(['read','write','sync']),
  accountant:new Set(['read','write','export','sync']),
  viewer:new Set(['read','export'])
};

const OPERATOR_ENTITIES=new Set(['interventions','tasks','observations','fieldSessions','chantiers','points','photos','documents','routeSessions','gpsTracks','integrationImports']);
// Factures et contrats de vente (integrationImports, farmKind) : la comptabilité les gère, pas l'opérateur terrain.
export const FINANCE_KINDS=new Set(['invoice','salesContract']);
const financeRecord=operation=>FINANCE_KINDS.has(operation.farmKind??operation.payload?.farmKind);
// n° 20 (vague 12) : l'opérateur terrain relève le compteur d'un engin (fin de journée chantier) sans rien
// modifier d'autre sur la fiche. Même liste que firestore.rules (operatorMeterUpdate), hors métadonnées
// updatedAt / version que toute écriture fait avancer.
export const OPERATOR_MATERIEL_FIELDS=Object.freeze(['currentMeter']);
/** Opération de relevé de compteur : mise à jour d'un engin limitée aux champs déclarés (operation.fields). */
export const meterOnlyOperation=operation=>operation?.entity==='materiels'&&operation.action==='update'
  &&Array.isArray(operation.fields)&&operation.fields.length>0&&operation.fields.every(field=>OPERATOR_MATERIEL_FIELDS.includes(field));
const ACCOUNTANT_ENTITIES=new Set(['clients','documents','stockItems','stockMovements','products','maintenanceRecords']);

export function normalizeRole(role){return ROLES[role]?role:'viewer';}
export function roleLabel(role){return ROLES[normalizeRole(role)].label;}
export function roleCan(role,capability){return ROLE_CAPABILITIES[normalizeRole(role)]?.has(capability)||false;}
export function assignableRoles(){return ['manager','editor','operator','accountant','viewer'];}

export function capabilityForMutation({entity,action}={}){
  if(entity==='preferences')return 'read';
  if(entity==='state'&&['restore','replace'].includes(action))return 'restore';
  if(entity==='members'||entity==='workspace')return 'manage-members';
  if(entity==='platformJobs')return 'platform-jobs';
  if(action==='purge')return 'purge';
  if(action==='delete')return 'delete';
  return 'write';
}

export function canMutate(role,operation={}){
  if(operation.entity==='preferences')return true;
  const normalized=normalizeRole(role),capability=capabilityForMutation(operation);
  if(!roleCan(normalized,capability))return false;
  if(['owner','manager','editor'].includes(normalized))return true;
  if(normalized==='operator')return meterOnlyOperation(operation)||OPERATOR_ENTITIES.has(operation.entity)&&!(operation.entity==='integrationImports'&&financeRecord(operation));
  if(normalized==='accountant')return ACCOUNTANT_ENTITIES.has(operation.entity)||operation.entity==='integrationImports'&&financeRecord(operation);
  return false;
}

export function roleScope(role){
  const r=normalizeRole(role);
  if(['owner','manager','editor'].includes(r))return {all:true,entities:[]};
  if(r==='operator')return {all:false,entities:[...OPERATOR_ENTITIES]};
  if(r==='accountant')return {all:false,entities:[...ACCOUNTANT_ENTITIES]};
  return {all:false,entities:[]};
}

// n° 141 : en exploitation cloud, seule la personne propriétaire purge la corbeille (suppression définitive).
// n° 86 : le prévisionnel de trésorerie est masqué au rôle lecture seule.
export const canSeeTreasury=role=>normalizeRole(role)!=='viewer';

export function canPurgeTrash({role,cloud=false}={}){return !cloud||normalizeRole(role)==='owner';}
