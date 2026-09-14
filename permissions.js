export const ROLES={
  owner:{label:'Propriétaire',rank:3},
  editor:{label:'Collaborateur',rank:2},
  viewer:{label:'Lecture seule',rank:1}
};

export const ROLE_CAPABILITIES={
  owner:new Set(['read','write','delete','purge','restore','manage-members','manage-workspace','export','import','sync']),
  editor:new Set(['read','write','delete','export','sync']),
  viewer:new Set(['read','export'])
};

export function normalizeRole(role){return ROLES[role]?role:'viewer';}
export function roleLabel(role){return ROLES[normalizeRole(role)].label;}
export function roleCan(role,capability){return ROLE_CAPABILITIES[normalizeRole(role)]?.has(capability)||false;}

export function capabilityForMutation({entity,action}={}){
  if(entity==='preferences')return 'read';
  if(entity==='state'&&['restore','replace'].includes(action))return 'restore';
  if(entity==='members'||entity==='workspace')return 'manage-members';
  if(action==='purge')return 'purge';
  if(action==='delete')return 'delete';
  return 'write';
}

export function canMutate(role,operation){return roleCan(role,capabilityForMutation(operation));}
