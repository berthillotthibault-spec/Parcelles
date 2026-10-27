export const ROLES={
  owner:{label:'Propriétaire',rank:6},
  manager:{label:'Responsable',rank:5},
  editor:{label:'Collaborateur',rank:4},
  operator:{label:'Opérateur terrain',rank:3},
  accountant:{label:'Gestion / comptabilité',rank:2},
  advisor:{label:'Conseiller / technicien',rank:2},
  viewer:{label:'Lecture seule',rank:1}
};

export const ROLE_CAPABILITIES={
  owner:new Set(['read','write','delete','purge','restore','manage-members','manage-workspace','export','import','sync','platform-jobs']),
  manager:new Set(['read','write','delete','restore','export','import','sync','platform-jobs']),
  editor:new Set(['read','write','delete','export','sync']),
  operator:new Set(['read','write','sync']),
  accountant:new Set(['read','write','export','sync']),
  // n° 129 : le conseiller ou technicien lit l'agronomie et n'écrit que ses commentaires / préconisations.
  advisor:new Set(['read','write','sync']),
  viewer:new Set(['read','export'])
};

const OPERATOR_ENTITIES=new Set(['interventions','tasks','observations','fieldSessions','chantiers','points','photos','documents','routeSessions','gpsTracks','integrationImports']);
// Facturation (factures, devis, catalogue d'articles, facturation récurrente) et contrats de vente
// (integrationImports, farmKind) : la comptabilité les gère, pas l'opérateur terrain. Même liste que
// firestore.rules (financeKind).
export const FINANCE_KINDS=new Set(['invoice','quote','billingItem','billingSchedule','salesContract']);
const financeRecord=operation=>FINANCE_KINDS.has(operation.farmKind??operation.payload?.farmKind);
// v13 (messages) : carnet de contacts et modèles de messages réservés à la gestion (propriétaire, responsable,
// collaborateur) ; le journal des messages (« message ») est aussi écrit par l'opérateur terrain (planning,
// consignes) et par la comptabilité (envoi des factures). Même découpage que firestore.rules.
export const DIRECTORY_KINDS=new Set(['contact','messageTemplate']);
export const MESSAGE_LOG_KINDS=new Set(['message']);
const kindOf=operation=>operation.farmKind??operation.payload?.farmKind;
/** Journal des messages : l'opérateur terrain n'écrit que ses propres messages, jamais ceux de la facturation ;
 * la comptabilité ses propres messages et ceux de la facturation ; la gestion, tout. uid vide (pas de compte
 * cloud) : pas de contrôle d'auteur. Même règle que firestore.rules (messageWritable). */
export function messageWritable(role,record,uid=''){
  const r=normalizeRole(role);
  if(!record||['owner','manager','editor'].includes(r))return true;
  if(record.finance===true)return r==='accountant';
  return !uid||record.authorUid===uid;
}
// Enregistrement écrit (operation.record) et version déjà présente (operation.previous) : les deux doivent passer.
const messageOk=(role,operation)=>!MESSAGE_LOG_KINDS.has(kindOf(operation))||messageWritable(role,operation.record,operation.uid)&&messageWritable(role,operation.previous,operation.uid);
// n° 20 (vague 12) : l'opérateur terrain relève le compteur d'un engin (fin de journée chantier) sans rien
// modifier d'autre sur la fiche. Même liste que firestore.rules (operatorMeterUpdate), hors métadonnées
// updatedAt / version que toute écriture fait avancer.
export const OPERATOR_MATERIEL_FIELDS=Object.freeze(['currentMeter']);
/** Opération de relevé de compteur : mise à jour d'un engin limitée aux champs déclarés (operation.fields). */
export const meterOnlyOperation=operation=>operation?.entity==='materiels'&&operation.action==='update'
  &&Array.isArray(operation.fields)&&operation.fields.length>0&&operation.fields.every(field=>OPERATOR_MATERIEL_FIELDS.includes(field));
// n° 79 (troupeau) : l'opérateur terrain enregistre un vêlage (événement « calving » et veau né sur
// l'exploitation, origin 'birth') et une pesée, sans toucher aux autres fiches du troupeau ni rien
// supprimer. Même règle que firestore.rules (herdOperatorDoc). Fiche écrite et version existante.
export const HERD_OPERATOR_EVENT_KINDS=new Set(['calving','weighing']);
export const HERD_OPERATOR_ANIMAL_ORIGINS=new Set(['birth']);
export function herdOperatorRecord(entity,record){
  if(!record)return true;
  if(record.deletedAt)return false;
  if(entity==='animalEvents')return HERD_OPERATOR_EVENT_KINDS.has(record.kind);
  if(entity==='animals')return HERD_OPERATOR_ANIMAL_ORIGINS.has(record.origin);
  return false;
}
const herdOperatorOk=operation=>['animals','animalEvents'].includes(operation.entity)&&operation.action!=='delete'
  &&Boolean(operation.record||operation.payload)&&herdOperatorRecord(operation.entity,operation.record||operation.payload)&&herdOperatorRecord(operation.entity,operation.previous);
const ACCOUNTANT_ENTITIES=new Set(['clients','documents','stockItems','stockMovements','products','maintenanceRecords']);

// n° 129 : fil de commentaires par parcelle (« Préco : fongicide T2 la semaine prochaine »). Tout rôle qui écrit
// commente ; hors gestion, on n'écrit que ses propres commentaires (authorUid), jamais ceux d'autrui. La gestion
// (propriétaire, responsable, collaborateur) écrit tout : modération, lien vers la tâche créée.
// Même règle que firestore.rules (parcelCommentWritable), appliquée à la fiche écrite et à la version existante.
export const COMMENT_ENTITY='parcelComments';
export const MANAGEMENT_ROLES=new Set(['owner','manager','editor']);
// Hors gestion : compte connecté obligatoire (sans uid, la règle refuserait l'envoi pour toujours), auteur = soi,
// rôle affiché = son rôle, et adresse affichée = la sienne quand elle est connue (comme la règle).
export function parcelCommentWritable(role,record,uid='',email=''){
  const r=normalizeRole(role);
  if(r==='viewer')return false;
  if(!record||MANAGEMENT_ROLES.has(r))return true;
  if(!uid||record.authorUid!==uid||String(record.authorRole||'')!==r)return false;
  return !email||String(record.authorEmail||'')===String(email).toLowerCase();
}
// Suppression (corbeille) : l'opération ne porte que {id, deletedAt} ; l'auteur se lit sur la version existante.
const commentOk=(role,operation)=>parcelCommentWritable(role,operation.record||operation.payload?{...operation.previous,...(operation.record||operation.payload)}:null,operation.uid,operation.email)
  &&parcelCommentWritable(role,operation.previous,operation.uid,operation.email);

// n° 129 : lecture du conseiller / technicien, cloisonnée dans firestore.rules (allow read de data/{docId}) et
// storage.rules. Firestore ne filtre pas : sync.js n'interroge, pour ce rôle, que ces trois périmètres
// (readFilters), que les règles savent prouver. Mêmes listes que firestore.rules (advisorReadable).
// - collections agronomiques entières ;
export const ADVISOR_READ_ENTITIES=Object.freeze(['parcelles','interventions','tasks','rotations','observations','photos','points','weatherStations','products','grazingSessions','parcelComments']);
// - fiches integrationImports agronomiques (farmKind) : analyses de sol, zonages, préconisations de modulation,
//   décisions agronomiques, haies et IAE ; jamais factures, ventes, contacts, messages, capteurs, récoltes vendues ;
export const ADVISOR_READ_FARM_KINDS=Object.freeze(['soilAnalysis','zones','prescription','decision','agroInfra']);
// - documents des catégories agronomiques (traceability.js : DOCUMENT_CATEGORIES ; « Analyse » vient de soil-analysis-ui.js).
export const ADVISOR_READ_DOCUMENT_CATEGORIES=Object.freeze(['Analyse de sol','Analyse','Plan / carte','Photo / constat','Réglementaire']);
export function advisorCanRead(entityType,record={}){
  if(ADVISOR_READ_ENTITIES.includes(entityType))return true;
  if(entityType==='integrationImports')return ADVISOR_READ_FARM_KINDS.includes(record?.farmKind);
  if(entityType==='documents')return ADVISOR_READ_DOCUMENT_CATEGORIES.includes(record?.category);
  return false;
}
/** Filtres des lectures Firestore d'un rôle (null : aucune restriction). Chaque entrée est une liste de
 * conditions [champ, opérateur, valeur] à appliquer à une même requête ; une requête par entrée. */
export function readFilters(role){
  if(normalizeRole(role)!=='advisor')return null;
  return [
    [['entityType','in',[...ADVISOR_READ_ENTITIES]]],
    [['entityType','==','integrationImports'],['payload.farmKind','in',[...ADVISOR_READ_FARM_KINDS]]],
    [['entityType','==','documents'],['payload.category','in',[...ADVISOR_READ_DOCUMENT_CATEGORIES]]]
  ];
}

export function normalizeRole(role){return ROLES[role]?role:'viewer';}
export function roleLabel(role){return ROLES[normalizeRole(role)].label;}
export function roleCan(role,capability){return ROLE_CAPABILITIES[normalizeRole(role)]?.has(capability)||false;}
export function assignableRoles(){return ['manager','editor','operator','accountant','advisor','viewer'];}

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
  // n° 129 : commentaires de parcelle. Hors gestion, l'auteur met aussi le sien à la corbeille (sans le droit « delete »).
  if(operation.entity===COMMENT_ENTITY&&!MANAGEMENT_ROLES.has(normalized))return ['write','delete'].includes(capability)&&roleCan(normalized,'write')&&commentOk(normalized,operation);
  if(!roleCan(normalized,capability))return false;
  if(['owner','manager','editor'].includes(normalized))return true;
  if(normalized==='operator')return meterOnlyOperation(operation)||herdOperatorOk(operation)||OPERATOR_ENTITIES.has(operation.entity)&&!(operation.entity==='integrationImports'&&(financeRecord(operation)||DIRECTORY_KINDS.has(kindOf(operation))||!messageOk(normalized,operation)));
  // Réglages de facturation (exploitation.invoicing, propres à l’appareil, jamais synchronisés) : la comptabilité les tient.
  if(normalized==='accountant')return ACCOUNTANT_ENTITIES.has(operation.entity)||operation.entity==='exploitation'&&financeRecord(operation)||operation.entity==='integrationImports'&&(financeRecord(operation)||MESSAGE_LOG_KINDS.has(kindOf(operation))&&messageOk(normalized,operation));
  return false;
}

export function roleScope(role){
  const r=normalizeRole(role);
  if(['owner','manager','editor'].includes(r))return {all:true,entities:[]};
  if(r==='operator')return {all:false,entities:[...OPERATOR_ENTITIES,'animals','animalEvents',COMMENT_ENTITY]};
  if(r==='accountant')return {all:false,entities:[...ACCOUNTANT_ENTITIES,COMMENT_ENTITY]};
  if(r==='advisor')return {all:false,entities:[COMMENT_ENTITY]};
  return {all:false,entities:[]};
}

// n° 141 : en exploitation cloud, seule la personne propriétaire purge la corbeille (suppression définitive).
// n° 86 : le prévisionnel de trésorerie est masqué au rôle lecture seule.
export const canSeeTreasury=role=>!['viewer','advisor'].includes(normalizeRole(role));
// Centre Facturation : gestion et comptabilité seulement (comme billing-hub-ui.js). Masquage d’interface :
// en espace cloud, tout membre lit et synchronise ces documents (firestore.rules, ARCHITECTURE.md §4).
export const canSeeBilling=role=>!['viewer','operator','advisor'].includes(normalizeRole(role));
// n° 129 : économie, facturation, trésorerie, contacts / messages, heures et gestion de l'exploitation masquées
// au conseiller / technicien (Plus, recherche de Plus, recherche globale, accueil). Ses données ne sont de toute
// façon pas synchronisées sur son appareil (readFilters).
export const canSeeEconomy=role=>normalizeRole(role)!=='advisor';
export const ECONOMY_ACTIONS=new Set(['open-statistics','open-clients','open-invoices','new-invoice','open-treasury','open-crop-margins','open-herd-economics','open-land','open-claims','open-fuel','open-net-margin','open-campaign-history','open-accounting-export','open-machine-costs','open-team-work','open-messages','open-stock','open-equipment','open-public-works','open-chantiers','new-machine-mission','open-herd','open-herd-health','open-regulated-ops','open-automations','open-integrations','open-telepac-import','open-farm','open-simulator','stock-capture']);
/** Outil de Plus ou commande de recherche visible pour ce rôle (masquage d'interface, les règles font foi). */
export function actionVisibleForRole(role,action){
  if(action==='open-treasury'&&!canSeeTreasury(role))return false;
  if(['open-invoices','new-invoice'].includes(action)&&!canSeeBilling(role))return false;
  return canSeeEconomy(role)||!ECONOMY_ACTIONS.has(action);
}

export function canPurgeTrash({role,cloud=false}={}){return !cloud||normalizeRole(role)==='owner';}
