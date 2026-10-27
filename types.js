// @ts-check
// Types JSDoc du schéma de données (outil de développement, n° 151).
// Ce fichier ne contient aucun code exécuté : aucun module servi ne l'importe, il n'est donc ni dans CORE
// (sw.js) ni dans REQUIRED_ASSETS (runtime.js). Les modules l'utilisent seulement dans leurs commentaires :
//   /** @param {import('parcelles/types').Parcelle} parcel */
// « parcelles/types » est un alias déclaré dans jsconfig.json (paths) : un chemin « ./types.js » serait pris
// pour un vrai import par le graphe de tools/release.mjs et test-static.mjs, qui l'ajouteraient à CORE.
// tsc (`npm run typecheck`) et l'éditeur lisent ces types ; le navigateur ne les voit jamais.
// Source de vérité : emptyState(), normalizeEntity() et migrateData() de state.js. Les entités gardent
// une signature d'index ouverte : les anciens exports et les imports portent des champs non listés ici.

/**
 * Date de calendrier au format AAAA-MM-JJ (ex. « 2026-10-19 »).
 * @typedef {string} IsoDay
 */

/**
 * Horodatage en millisecondes depuis l'époque Unix (Date.now()).
 * @typedef {number} Timestamp
 */

/**
 * Géométrie GeoJSON acceptée par validateGeometry() (WGS84, [longitude, latitude]).
 * @typedef {{type:'Point', coordinates:number[]}
 *   | {type:'Polygon', coordinates:number[][][]}
 *   | {type:'MultiPolygon', coordinates:number[][][][]}} Geometry
 */

/**
 * Champs communs posés par normalizeEntity() sur toute entité enregistrée.
 * @typedef {object} BaseEntity
 * @property {string} id
 * @property {Timestamp} [createdAt]
 * @property {Timestamp} [updatedAt]
 * @property {Timestamp|null} [deletedAt] Corbeille : l'entité reste stockée tant qu'elle n'est pas purgée.
 * @property {number} [version] Incrémentée à chaque modification (détection des conflits de synchronisation).
 * @property {string} [source] Origine de la fiche : 'local', 'import', 'remote', etc.
 * @property {string|null} [sourceId] Identifiant d'origine pour un import.
 */

/**
 * Champs libres conservés tels quels (anciens exports, imports, champs ajoutés par un module).
 * @typedef {{[key:string]:any}} OpenFields
 */

/**
 * Parcelle (état « parcelles »).
 * @typedef {BaseEntity & OpenFields & {
 *   nom:string,
 *   surfaceHa?:number|null,
 *   culture?:string,
 *   commune?:string,
 *   ilot?:string,
 *   geometry?:Geometry|null,
 *   ownershipType?:'own'|string,
 *   clientId?:string|null,
 *   favorite?:boolean,
 *   archived?:boolean,
 *   notes?:string,
 *   latitude?:number|null,
 *   longitude?:number|null,
 * }} Parcelle
 */

/**
 * Travail / intervention (état « interventions »). workDate() renvoie plannedDate||date tant que le travail
 * est en attente, date (achèvement) une fois terminé.
 * @typedef {BaseEntity & OpenFields & {
 *   parcelId:string,
 *   type:string,
 *   date:IsoDay,
 *   plannedDate?:IsoDay|null,
 *   status?:'Terminé'|'Planifié'|'En cours'|'Annulé'|string,
 *   campaignId?:string,
 *   product?:string,
 *   dose?:number|string|null,
 *   doseUnit?:string,
 *   surfaceWorked?:number|null,
 *   duration?:number|null,
 *   operator?:string,
 *   equipmentId?:string|null,
 *   chantierId?:string|null,
 *   cost?:number|null,
 *   fuel?:number|null,
 *   productUnitPrice?:number|null,
 *   machineCost?:number|null,
 *   inputCost?:number|null,
 *   operatorCost?:number|null,
 *   otherCost?:number|null,
 *   isPhytosanitary?:boolean,
 *   note?:string,
 * }} Intervention
 */

/**
 * Tâche (état « tasks »).
 * @typedef {BaseEntity & OpenFields & {
 *   title:string,
 *   status?:'À faire'|'Terminé'|string,
 *   dueDate?:IsoDay|null,
 *   parcelId?:string|null,
 *   priority?:string,
 *   note?:string,
 *   remindOn?:IsoDay|null,
 * }} Task
 */

/**
 * Animal d'un lot au pâturage (forme normalisée par grazingAnimalList()).
 * animalId (n° 79) : fiche du troupeau choisie pour cette ligne.
 * @typedef {OpenFields & {number:string, name:string, gestation:boolean, animalId?:string}} GrazingAnimal
 */

/**
 * Bovin du troupeau (état « animals », n° 79). nationalId : 'FR' + 10 chiffres, ou vide (veau non bouclé).
 * origin : 'birth' (vêlage), 'purchase', 'import' (inventaire CSV), 'grazing' (repris d'un lot), 'manual'.
 * @typedef {BaseEntity & OpenFields & {
 *   nationalId:string, name:string, sex:'F'|'M'|'', breed:string, birthDate:IsoDay|null,
 *   motherId:string|null, motherNationalId:string, entryDate:IsoDay|null, entryReason:string,
 *   exitDate:IsoDay|null, exitReason:string, sessionId:string|null, origin:string, note:string,
 * }} Animal
 */

/**
 * Événement d'élevage (état « animalEvents », n° 79). Vêlage : calfId, bdniDeadline (J+7), bdniTaskId, bdniNotifiedAt.
 * @typedef {BaseEntity & OpenFields & {
 *   animalId:string, kind:'insemination'|'mating'|'calving'|'weighing', date:IsoDay,
 *   sire?:string, expectedCalvingDate?:IsoDay, calfId?:string, bdniDeadline?:IsoDay, bdniTaskId?:string,
 *   bdniNotifiedAt?:Timestamp|null, weightKg?:number, note?:string,
 * }} AnimalEvent
 */

/**
 * Commentaire ou préconisation sur une parcelle (état « parcelComments », n° 129). Auteur figé à la création
 * (authorUid contrôlé par firestore.rules) ; taskId : tâche créée par « Transformer en tâche ».
 * @typedef {BaseEntity & OpenFields & {
 *   parcelId:string, text:string, kind:'preco'|'comment', workId?:string|null, taskId?:string|null,
 *   authorUid:string, authorName:string, authorEmail:string, authorRole:string, editedAt?:Timestamp|null,
 * }} ParcelComment
 */

/**
 * Séjour d'un lot sur une parcelle (état « grazingSessions »). endDate vide : animaux encore présents.
 * @typedef {BaseEntity & OpenFields & {
 *   parcelId:string,
 *   startDate:IsoDay,
 *   endDate?:IsoDay|'',
 *   animalType?:string,
 *   animals?:Array<GrazingAnimal|string|number>|string,
 *   animalsCount?:number|null,
 *   additionalAnimalsCount?:number|null,
 *   note?:string,
 * }} GrazingSession
 */

/**
 * Matériel (état « materiels »).
 * @typedef {BaseEntity & OpenFields & {
 *   nom:string,
 *   type?:string,
 *   brand?:string,
 *   model?:string,
 *   registration?:string,
 *   currentMeter?:number|null,
 *   maintenanceDue?:number|null,
 *   insurance?:number|null,
 *   insuranceDue?:IsoDay|null,
 *   amortization?:number|null,
 *   hourlyCost?:number|null,
 *   workingWidthM?:number|null,
 * }} Equipment
 */

/**
 * Observation de terrain (état « observations »).
 * @typedef {BaseEntity & OpenFields & {
 *   parcelId?:string|null,
 *   date?:IsoDay,
 *   type?:string,
 *   title?:string,
 *   note?:string,
 *   severity?:string,
 *   status?:'À surveiller'|'Résolu'|string,
 *   latitude?:number|null,
 *   longitude?:number|null,
 * }} Observation
 */

/**
 * Chantier de travaux publics (état « chantiers »).
 * @typedef {BaseEntity & OpenFields & {nom?:string, clientId?:string|null, status?:string}} Chantier
 */

/**
 * Entité générique d'un type sans typedef dédié (produits, clients, documents…).
 * @typedef {BaseEntity & OpenFields} Entity
 */

/**
 * Opération en attente de synchronisation (state.queue).
 * @typedef {OpenFields & {
 *   id:string,
 *   entity:string,
 *   entityId:string,
 *   action:'create'|'update'|'delete'|'remote'|string,
 *   status?:'pending'|'error'|'conflict'|'done'|string,
 *   payload?:any,
 * }} QueueItem
 */

/**
 * Exploitation (state.exploitation).
 * @typedef {OpenFields & {
 *   id:string,
 *   nom:string,
 *   commune?:string,
 *   latitude?:number|null,
 *   longitude?:number|null,
 *   createdAt?:Timestamp,
 *   updatedAt?:Timestamp,
 * }} Exploitation
 */

/**
 * État complet de l'application, persisté d'un bloc dans IndexedDB (voir emptyState()).
 * version vaut APP_VERSION (utils.js) une fois migrateData() passé.
 * @typedef {OpenFields & {
 *   version:number,
 *   exploitation:Exploitation,
 *   campagnes:Entity[],
 *   parcelles:Parcelle[],
 *   interventions:Intervention[],
 *   tasks:Task[],
 *   rotations:Entity[],
 *   grazingSessions:GrazingSession[],
 *   materiels:Equipment[],
 *   products:Entity[],
 *   clients:Entity[],
 *   documents:Entity[],
 *   photos:Entity[],
 *   observations:Observation[],
 *   stockItems:Entity[],
 *   stockMovements:Entity[],
 *   chantiers:Chantier[],
 *   animals:Animal[],
 *   animalEvents:AnimalEvent[],
 *   parcelComments:ParcelComment[],
 *   preferences:OpenFields,
 *   metadata:OpenFields & {revision:number, syncCursors:OpenFields},
 *   queue:QueueItem[],
 *   journal:Array<OpenFields>,
 * }} AppState
 */

export {};
