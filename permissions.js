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
  if(normalized==='operator')return OPERATOR_ENTITIES.has(operation.entity);
  if(normalized==='accountant')return ACCOUNTANT_ENTITIES.has(operation.entity);
  return false;
}

export function roleScope(role){
  const r=normalizeRole(role);
  if(['owner','manager','editor'].includes(r))return {all:true,entities:[]};
  if(r==='operator')return {all:false,entities:[...OPERATOR_ENTITIES]};
  if(r==='accountant')return {all:false,entities:[...ACCOUNTANT_ENTITIES]};
  return {all:false,entities:[]};
}
