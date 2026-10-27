// n° 79 — Troupeau bovin : identification, reproduction (saillies, vêlages), pesées et rappel BDNI.
// Logique pure (aucun accès au DOM), testée par test-herd.mjs.
//
// Collections (APP_VERSION 18) :
// - animals : {nationalId:'FR' + 10 chiffres, name, sex:'F'|'M', breed, birthDate, motherId, motherNationalId,
//   entryDate, entryReason, exitDate, exitReason, sessionId (lot à la naissance ou à l'import), origin, note}.
//   origin : 'birth' (né sur l'exploitation, saisi au vêlage), 'purchase', 'import' (inventaire CSV),
//   'grazing' (repris d'un lot de pâturage), 'manual'.
// - animalEvents : {animalId, kind:'insemination'|'mating'|'calving'|'weighing', date, sire, expectedCalvingDate,
//   calfId, bdniDeadline, bdniTaskId, bdniNotifiedAt, weightKg, note}.
// Les traitements restent dans le carnet sanitaire (vetTreatments) : la fiche animal les affiche seulement.
// Parcelles ne notifie jamais la BDNI : la tâche créée au vêlage est un rappel, la notification se fait sur le
// portail de l'EDE (ou le logiciel habituel de l'éleveur).
import {normalize} from './utils.js';
import {grazingDate,grazingAnimalList,grazingStatus,grazingType,animalNumberKey,nationalIdKey} from './grazing.js';
import {GESTATION_DAYS,BDNI_DAYS,BDNI_REMINDER_DAYS,addIsoDays,expectedCalvingDate,bdniDeadline,animalLabel,expectedCalvings,pendingBdni} from './home-priorities.js';
import {parseCsv} from './phyto-catalog.js';

export {GESTATION_DAYS,BDNI_DAYS,BDNI_REMINDER_DAYS,addIsoDays,expectedCalvingDate,bdniDeadline,animalLabel,expectedCalvings,pendingBdni};

export const SEXES=Object.freeze({F:'Femelle',M:'Mâle'});
export const ENTRY_REASONS=Object.freeze(['Naissance','Achat','Prêt / pension','Reprise d’inventaire','Autre']);
export const EXIT_REASONS=Object.freeze(['Vente','Boucherie','Mort','Prêt / pension','Autre']);
export const EVENT_KINDS=Object.freeze({insemination:'Insémination',mating:'Saillie naturelle',calving:'Vêlage',weighing:'Pesée'});
export const BREEDS=Object.freeze(['Charolaise','Limousine','Blonde d’Aquitaine','Salers','Aubrac','Montbéliarde','Prim’Holstein','Normande','Simmental','Croisée']);
export const BDNI_NOTICE='Parcelles ne notifie pas la BDNI : déclarez la naissance sur le portail de votre EDE (ou votre logiciel habituel), puis cochez « Notifié ».';
export const IMPORT_SOURCE='herd-csv';
export const HERD_IMPORT_MAX=5000;

const text=v=>typeof v==='string'||typeof v==='number'?String(v).trim():'';
const live=(state,key)=>(state?.[key]||[]).filter(x=>x&&!x.deletedAt);
const ddmm=day=>`${day.slice(8,10)}/${day.slice(5,7)}`;

/** Numéro national normalisé : 'FR' + 10 chiffres (espaces, points et tirets retirés ; 10 chiffres seuls → FR). */
export function normalizeNationalId(value){
  return nationalIdKey(value);
}
/** Format du numéro national bovin : FR suivi de 10 chiffres. */
export const isValidNationalId=value=>/^FR\d{10}$/.test(normalizeNationalId(value));
/** Numéro de travail : les 4 derniers chiffres. */
export const workNumber=value=>{const id=normalizeNationalId(value);return isValidNationalId(id)?id.slice(-4):'';};
/** Affichage lisible : FR 12 3456 7890. */
export const formatNationalId=value=>{const id=normalizeNationalId(value);return isValidNationalId(id)?`FR ${id.slice(2,4)} ${id.slice(4,8)} ${id.slice(8)}`:text(value);};

/** Sexe lu d'un formulaire ou d'un export (F, M, femelle, mâle, 1 = mâle, 2 = femelle comme dans la BDNI). */
export function parseSex(value){
  const v=normalize(value);
  if(['f','femelle','female','2','vache','genisse'].includes(v))return 'F';
  if(['m','male','1','taureau','boeuf','taurillon'].includes(v))return 'M';
  return '';
}
const day=(value,label,{required=false}={})=>{
  const raw=text(value);if(!raw){if(required)throw new Error(`${label} : date obligatoire.`);return null;}
  const d=strictDate(raw);if(!d)throw new Error(`${label} : date invalide.`);return d;
};
// Dates acceptées : AAAA-MM-JJ ou JJ/MM/AAAA (jamais l'interprétation américaine de Date()).
export const strictDate=raw=>{const v=text(raw);return /^\d{4}-\d{2}-\d{2}/.test(v)?grazingDate(v.slice(0,10))||null:parseFrDate(v);};
function parseFrDate(raw){
  const m=String(raw).trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);if(!m)return null;
  const iso=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;return grazingDate(iso);
}

/** Animal présent sur l'exploitation à la date donnée (pas de sortie enregistrée avant ou ce jour). */
export const isPresent=(animal,today=grazingDate())=>Boolean(animal)&&!animal.deletedAt&&!(animal.exitDate&&String(animal.exitDate).slice(0,10)<=today);

/** Recherche d'un animal vivant par numéro national (dédoublonnage). */
export function findByNationalId(state,nationalId,{exceptId=null}={}){
  const id=normalizeNationalId(nationalId);if(!id)return null;
  return live(state,'animals').find(a=>a.id!==exceptId&&normalizeNationalId(a.nationalId)===id)||null;
}

/** Valide et complète une fiche animal ; lève une erreur lisible. */
export function normalizeAnimal(input,{state=null,id=null,today=grazingDate()}={}){
  const raw=text(input?.nationalId),nationalId=normalizeNationalId(raw);
  if(raw&&!isValidNationalId(nationalId))throw new Error('Numéro national invalide : FR suivi de 10 chiffres (exemple FR1234567890).');
  const name=text(input?.name);
  if(!nationalId&&!name)throw new Error('Indiquez le numéro national ou un nom.');
  if(state&&nationalId){const twin=findByNationalId(state,nationalId,{exceptId:id});if(twin)throw new Error(`Le numéro ${nationalId} est déjà attribué à ${animalLabel(twin)}.`);}
  const sex=parseSex(input?.sex)||(text(input?.sex)?null:'');
  if(sex===null)throw new Error('Sexe invalide : femelle ou mâle.');
  const birthDate=day(input?.birthDate,'Naissance');
  if(birthDate&&birthDate>today)throw new Error('La date de naissance est dans le futur.');
  const entryDate=day(input?.entryDate,'Entrée')||birthDate;
  const exitDate=day(input?.exitDate,'Sortie');
  if(exitDate&&entryDate&&exitDate<entryDate)throw new Error('La sortie doit être postérieure ou égale à l’entrée.');
  const exitReason=text(input?.exitReason);
  if(exitDate&&!exitReason)throw new Error('Indiquez le motif de sortie.');
  const motherId=text(input?.motherId)||null;let motherNationalId=normalizeNationalId(input?.motherNationalId);
  if(motherId&&state){
    const mother=live(state,'animals').find(a=>a.id===motherId);
    if(!mother)throw new Error('La mère choisie est introuvable.');
    if(mother.id===id)throw new Error('Un animal ne peut pas être sa propre mère.');
    if(mother.sex==='M')throw new Error('La mère choisie est enregistrée comme mâle.');
    if(birthDate&&mother.birthDate&&mother.birthDate>=birthDate)throw new Error('La mère doit être née avant l’animal.');
    motherNationalId=normalizeNationalId(mother.nationalId)||motherNationalId;
  }
  if(motherNationalId&&!isValidNationalId(motherNationalId))motherNationalId='';
  const sessionId=text(input?.sessionId)||null;
  if(sessionId&&state&&!live(state,'grazingSessions').some(s=>s.id===sessionId))throw new Error('Le lot choisi est introuvable.');
  const origin=['birth','purchase','import','grazing','manual'].includes(input?.origin)?input.origin:'manual';
  return{nationalId,name,sex,breed:text(input?.breed),birthDate,motherId,motherNationalId,entryDate,entryReason:text(input?.entryReason)||(origin==='birth'?'Naissance':''),exitDate,exitReason:exitDate?exitReason:'',sessionId,origin,note:text(input?.note)};
}

const weight=v=>{const t=text(v);if(!t)return null;const n=Number(t.replace(/\s/g,'').replace(',','.'));if(!Number.isFinite(n)||n<=0||n>3000)throw new Error('Poids invalide (kg).');return Math.round(n*10)/10;};

/** Valide un événement (insémination, saillie, pesée ; le vêlage passe par calvingPlan). */
export function normalizeAnimalEvent(input,{state=null,today=grazingDate()}={}){
  const kind=Object.hasOwn(EVENT_KINDS,input?.kind)?input.kind:null;if(!kind)throw new Error('Type d’événement inconnu.');
  const date=day(input?.date,'Date',{required:true});
  if(date>today)throw new Error('La date est dans le futur.');
  const animal=state?live(state,'animals').find(a=>a.id===input?.animalId):{id:input?.animalId};
  if(!animal?.id)throw new Error('Animal introuvable.');
  const out={animalId:animal.id,kind,date,note:text(input?.note)};
  if(kind==='insemination'||kind==='mating'){
    if(animal.sex==='M')throw new Error('Insémination ou saillie : choisissez une femelle.');
    return{...out,sire:text(input?.sire),expectedCalvingDate:expectedCalvingDate(date)};
  }
  if(kind==='weighing'){const kg=weight(input?.weightKg);if(kg===null)throw new Error('Indiquez le poids en kg.');return{...out,weightKg:kg};}
  return out;
}

/** Titre de la tâche de rappel BDNI. */
export const bdniTaskTitle=(birth,calf=null)=>`Notifier la naissance${calf?` de ${animalLabel(calf)}`:''} à l’EDE/BDNI avant le ${ddmm(bdniDeadline(birth))}`;

/**
 * Vêlage : événement de la mère, veau prérempli (mère, naissance, lot de la mère) et tâche de rappel BDNI
 * (échéance J+7, rappel à J+5). Renvoie les trois fiches à écrire ensemble ; ne modifie rien.
 */
export function calvingPlan(input,{state,today=grazingDate(),ids}){
  const mother=live(state,'animals').find(a=>a.id===input?.animalId);
  if(!mother)throw new Error('Mère introuvable.');
  if(mother.sex==='M')throw new Error('Vêlage : choisissez une femelle.');
  const date=day(input?.date,'Date du vêlage',{required:true});
  if(date>today)throw new Error('La date du vêlage est dans le futur.');
  if(live(state,'animalEvents').some(e=>e.animalId===mother.id&&e.kind==='calving'&&e.date===date))throw new Error('Un vêlage est déjà enregistré ce jour pour cette mère.');
  const lot=animalLot(state,mother,{today:date})||animalLot(state,mother,{today});
  const calf={id:ids.calf,...normalizeAnimal({nationalId:input?.calfNationalId,name:input?.calfName||(text(input?.calfNationalId)?'':`Veau de ${animalLabel(mother)}`),sex:input?.calfSex,breed:input?.calfBreed||mother.breed,birthDate:date,motherId:mother.id,entryDate:date,entryReason:'Naissance',sessionId:lot?.id||null,origin:'birth',note:text(input?.calfNote)},{state,id:ids.calf,today})};
  const birthWeightKg=weight(input?.birthWeightKg);
  const deadline=bdniDeadline(date);
  const event={id:ids.event,animalId:mother.id,kind:'calving',date,calfId:calf.id,birthWeightKg,calvingEase:text(input?.calvingEase),bdniDeadline:deadline,bdniTaskId:ids.task,bdniNotifiedAt:null,note:text(input?.note)};
  const task={id:ids.task,title:bdniTaskTitle(date,calf.nationalId?calf:null),dueDate:deadline,remindOn:addIsoDays(date,BDNI_REMINDER_DAYS),status:'À faire',priority:'Haute',parcelId:lot?.parcelId||null,kind:'bdni',animalId:calf.id,animalEventId:event.id,note:BDNI_NOTICE};
  return{event,calf,task};
}

/** Lot de pâturage actuel : lot en cours qui liste l'animal (identifiant ou numéro), sinon le lot noté sur la fiche. */
export function animalLot(state,animal,{today=grazingDate()}={}){
  if(!animal)return null;
  const key=normalizeNationalId(animal.nationalId),sessions=live(state,'grazingSessions');
  const current=sessions.filter(s=>['current','planned'].includes(grazingStatus(s,{date:today})));
  const listed=current.find(s=>grazingAnimalList(s).some(item=>item.animalId===animal.id||key&&normalizeNationalId(item.number)===key));
  if(listed)return listed;
  const noted=animal.sessionId?sessions.find(s=>s.id===animal.sessionId):null;
  return noted&&grazingStatus(noted,{date:today})!=='ended'?noted:null;
}
/**
 * Lien lot ↔ animal réel : retire l'animal des lots en cours ou prévus qui le listent et l'ajoute au lot choisi
 * (élément {number, name, animalId, gestation}). Renvoie les lots à enregistrer ; un lot saisi en texte libre
 * (ancienne forme) n'est pas modifiable ici.
 */
export function lotAssignment(state,animal,sessionId,{today=grazingDate()}={}){
  const key=normalizeNationalId(animal?.nationalId),mine=item=>item.animalId===animal.id||Boolean(key)&&normalizeNationalId(item.number)===key;
  const out=[];
  // La gestation notée dans le lot quitté suit l'animal dans le lot choisi.
  const previous=live(state,'grazingSessions').filter(s=>s.id!==sessionId&&['current','planned'].includes(grazingStatus(s,{date:today}))).flatMap(s=>grazingAnimalList(s)).find(mine);
  for(const s of live(state,'grazingSessions')){
    const target=s.id===sessionId,status=grazingStatus(s,{date:today});
    if(!target&&!['current','planned'].includes(status))continue;
    if(!Array.isArray(s.animals)){if(target)throw new Error('Ce lot a une liste d’animaux en texte libre : modifiez-le dans Pâturage.');continue;}
    const list=grazingAnimalList(s),has=list.some(mine);
    if(target&&!has)out.push({...s,animals:[...list,{number:animal.nationalId||animal.name,name:animal.name||'',animalId:animal.id,gestation:Boolean(previous?.gestation)}]});
    else if(target&&has)out.push({...s,animals:list.map(item=>mine(item)?{...item,animalId:animal.id}:item)});
    else if(has)out.push({...s,animals:list.filter(item=>!mine(item))});
  }
  if(sessionId&&!out.some(s=>s.id===sessionId)&&!live(state,'grazingSessions').some(s=>s.id===sessionId))throw new Error('Le lot choisi est introuvable.');
  return out;
}
export const lotLabel=session=>session?(text(session.note)||grazingType(session)):'';

/** Âge lisible (mois jusqu'à 2 ans, puis années). */
export function ageLabel(birthDate,today=grazingDate()){
  if(!birthDate)return '';
  const [y1,m1,d1]=birthDate.split('-').map(Number),[y2,m2,d2]=today.split('-').map(Number);
  const months=(y2-y1)*12+(m2-m1)-(d2<d1?1:0);if(months<0)return '';
  if(months<1){const days=Math.round((Date.parse(`${today}T12:00:00Z`)-Date.parse(`${birthDate}T12:00:00Z`))/864e5);return `${days} j`;}
  return months<24?`${months} mois`:`${Math.floor(months/12)} ans`;
}

/** Liste filtrée et triée du troupeau. status : 'present' | 'exited' | 'all' ; sex : '' | 'F' | 'M'. */
export function filterAnimals(state,{query='',status='present',sex='',sessionId='',today=grazingDate()}={}){
  const q=normalize(query),qKey=animalNumberKey(query);
  return live(state,'animals').filter(a=>{
    if(status==='present'&&!isPresent(a,today))return false;
    if(status==='exited'&&isPresent(a,today))return false;
    if(sex&&a.sex!==sex)return false;
    if(sessionId&&animalLot(state,a,{today})?.id!==sessionId)return false;
    if(!q)return true;
    return normalize(`${a.name} ${a.breed} ${a.nationalId} ${workNumber(a.nationalId)}`).includes(q)||Boolean(qKey)&&animalNumberKey(a.nationalId).includes(qKey);
  }).sort((a,b)=>String(a.name||a.nationalId).localeCompare(String(b.name||b.nationalId),'fr')||String(a.id).localeCompare(String(b.id)));
}

/** Soins du carnet sanitaire qui concernent l'animal (champ animalId, ou numéro / nom saisi dans « Animal »). */
export function animalTreatments(state,animal){
  if(!animal)return[];
  const key=animalNumberKey(animal.nationalId),name=normalize(animal.name),work=workNumber(animal.nationalId);
  return live(state,'vetTreatments').filter(t=>{
    if(t.animalId)return t.animalId===animal.id;
    const v=text(t.animal);if(!v)return false;
    const vk=animalNumberKey(v);
    return Boolean(key)&&(vk.includes(key)||vk.includes(key.replace(/^FR/,'')))||Boolean(work)&&vk===work||Boolean(name)&&normalize(v)===name;
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}

/** Historique de la fiche : événements de l'animal, sa naissance (vêlage de la mère) et ses soins, du plus récent au plus ancien. */
export function animalTimeline(state,animal){
  if(!animal)return[];
  const events=live(state,'animalEvents').filter(e=>e.animalId===animal.id).map(e=>({date:e.date,type:e.kind,label:EVENT_KINDS[e.kind]||e.kind,event:e}));
  const birth=live(state,'animalEvents').find(e=>e.kind==='calving'&&e.calfId===animal.id);
  const care=animalTreatments(state,animal).map(t=>({date:t.date,type:'treatment',label:t.medicine||({prophylaxis:'Prophylaxie',visit:'Visite sanitaire'}[t.kind])||'Soin',treatment:t}));
  return[...events,...(birth?[{date:birth.date,type:'birth',label:'Naissance',event:birth}]:[]),...care].sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.type.localeCompare(b.type));
}
export function lastWeight(state,animalId){
  return live(state,'animalEvents').filter(e=>e.animalId===animalId&&e.kind==='weighing'&&e.weightKg).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0]||null;
}
/** GMQ (g/j) entre les deux dernières pesées, ou null. */
export function dailyGain(state,animalId){
  const w=live(state,'animalEvents').filter(e=>e.animalId===animalId&&e.kind==='weighing'&&e.weightKg).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  if(w.length<2)return null;const days=(Date.parse(w[0].date)-Date.parse(w[1].date))/864e5;
  return days>0?Math.round((w[0].weightKg-w[1].weightKg)/days*1000):null;
}
export const offspring=(state,animalId)=>live(state,'animals').filter(a=>a.motherId===animalId).sort((a,b)=>String(b.birthDate||'').localeCompare(String(a.birthDate||'')));

/** Synthèse du troupeau pour l'en-tête de l'écran. */
export function herdSummary(state,{today=grazingDate()}={}){
  const present=live(state,'animals').filter(a=>isPresent(a,today));
  return{present:present.length,females:present.filter(a=>a.sex==='F').length,males:present.filter(a=>a.sex==='M').length,calvings:expectedCalvings(state,{today,horizon:60,past:30}).length,bdni:pendingBdni(state,today)};
}

// ---------- Reprise des animaux déjà listés dans les lots de pâturage (action explicite) ----------

/** Animaux saisis dans les lots (numéro ou nom) qui n'ont pas encore de fiche dans le troupeau. */
export function grazingCandidates(state){
  const known=new Set(live(state,'animals').map(a=>animalNumberKey(a.nationalId)).filter(Boolean));
  const ids=new Set(live(state,'animals').map(a=>a.id)),seen=new Set(),out=[];
  const sessions=live(state,'grazingSessions').sort((a,b)=>String(b.startDate||'').localeCompare(String(a.startDate||'')));
  for(const s of sessions)for(const item of grazingAnimalList(s)){
    if(item.animalId&&ids.has(item.animalId))continue;
    const nationalId=normalizeNationalId(item.number),key=isValidNationalId(nationalId)?nationalId:'';
    if(!key)continue; // seuls les numéros nationaux valides sont repris (pas de fiche créée pour un nom seul)
    if(known.has(key)||seen.has(key))continue;seen.add(key);
    out.push({nationalId:key,name:text(item.name),sessionId:s.id,lot:lotLabel(s),gestation:Boolean(item.gestation),status:grazingStatus(s)});
  }
  return out;
}
/** Fiches à créer pour les candidats retenus (source 'grazing', sourceId = numéro). */
export function candidatesToAnimals(candidates,{today=grazingDate()}={}){
  return candidates.map(c=>({...normalizeAnimal({nationalId:c.nationalId,name:c.name,sex:c.gestation?'F':'',sessionId:['current','planned'].includes(c.status)?c.sessionId:null,origin:'grazing',entryReason:'Reprise d’inventaire'},{today}),source:'grazing',sourceId:c.nationalId}));
}

// ---------- Import CSV de l'inventaire (export du portail éleveur / BDNI) ----------

export const HERD_CSV_FIELDS=Object.freeze([
  {key:'nationalId',label:'Numéro national',required:true,aliases:[/^(n(umero)?|no)? ?(national|identification|ipg|bovin|animal)$/,/^numero$/,/^n identification$/,/^identifiant$/,/^numero national/,/^n ?national/,/^ipg/,/^copaip/]},
  {key:'name',label:'Nom',aliases:[/^nom/,/^name$/]},
  {key:'sex',label:'Sexe',aliases:[/^sexe?$/,/^sex$/,/^code sexe/]},
  {key:'breed',label:'Race',aliases:[/^race/,/^type racial/,/^breed$/]},
  {key:'birthDate',label:'Date de naissance',aliases:[/naissance/,/^ne le$/,/^date nais/,/^birth/]},
  {key:'motherNationalId',label:'Numéro de la mère',aliases:[/mere/,/^n ?mere/,/^dam$/]}
]);

/** Lit un CSV (séparateur ; , ou tabulation) : en-têtes et lignes. */
export function readHerdCsv(textValue){
  const rows=parseCsv(textValue);
  const headers=rows.length?Object.keys(rows[0]):[];
  return{headers,rows};
}
/** Correspondance proposée champ → colonne, d'après les en-têtes. */
export function guessColumns(headers){
  const used=new Set(),map={};
  for(const field of HERD_CSV_FIELDS){
    const hit=headers.find(h=>!used.has(h)&&field.aliases.some(re=>re.test(normalize(h))));
    if(hit){map[field.key]=hit;used.add(hit);}else map[field.key]='';
  }
  return map;
}

/**
 * Aperçu de l'import : chaque ligne devient une création, une mise à jour (même numéro national déjà au troupeau)
 * ou une ligne ignorée (raison). Dédoublonnage par numéro dans le fichier et dans le troupeau.
 */
export function herdImportPreview(state,rows,mapping,{today=grazingDate()}={}){
  if(!mapping?.nationalId)return{rows:[],create:0,update:0,skip:0,error:'Choisissez la colonne du numéro national.'};
  if((rows||[]).length>HERD_IMPORT_MAX)return{rows:[],create:0,update:0,skip:0,error:`Fichier trop long : ${HERD_IMPORT_MAX} lignes au plus.`};
  const seen=new Set(),out=[];
  for(const [index,row] of (rows||[]).entries()){
    const get=key=>mapping[key]?text(row[mapping[key]]):'';
    const line=index+2,raw=get('nationalId'),nationalId=normalizeNationalId(raw);
    if(!raw){out.push({line,action:'skip',reason:'Numéro absent'});continue;}
    if(!isValidNationalId(nationalId)){out.push({line,action:'skip',reason:`Numéro invalide : ${raw}`,nationalId:raw});continue;}
    if(seen.has(nationalId)){out.push({line,action:'skip',reason:'Numéro en double dans le fichier',nationalId});continue;}
    seen.add(nationalId);
    const existing=findByNationalId(state,nationalId);
    let value;
    try{
      const sexRaw=get('sex'),sex=parseSex(sexRaw);
      const birth=get('birthDate');let birthDate=null;
      if(birth){birthDate=strictDate(birth);if(!birthDate)throw new Error(`Date de naissance invalide : ${birth}`);if(birthDate>today)throw new Error('Date de naissance dans le futur');}
      const mother=normalizeNationalId(get('motherNationalId'));
      value={nationalId,name:get('name'),sex,breed:get('breed'),birthDate,motherNationalId:isValidNationalId(mother)&&mother!==nationalId?mother:''};
      if(sexRaw&&!sex)value.sex='';
    }catch(error){out.push({line,action:'skip',reason:error.message,nationalId});continue;}
    out.push({line,action:existing?'update':'create',nationalId,value,existingId:existing?.id||null});
  }
  return{rows:out,create:out.filter(r=>r.action==='create').length,update:out.filter(r=>r.action==='update').length,skip:out.filter(r=>r.action==='skip').length,error:''};
}

/**
 * Fiches à écrire après confirmation : créations (origin 'import', source herd-csv, sourceId = numéro) et
 * mises à jour qui ne remplacent que les champs vides ou fournis par le fichier. Les mères sont reliées par
 * numéro (fichier ou troupeau existant) ; newId fabrique les identifiants des créations.
 */
export function herdImportEntities(state,preview,{newId,sessionId=null,today=grazingDate()}){
  const byNational=new Map(live(state,'animals').filter(a=>a.nationalId).map(a=>[normalizeNationalId(a.nationalId),a]));
  const writes=[];
  for(const row of preview.rows.filter(r=>r.action!=='skip')){
    const existing=row.existingId?byNational.get(row.nationalId):null;
    if(existing){
      const next={...existing};
      for(const [k,v] of Object.entries(row.value))if(v)next[k]=v;
      writes.push(next);byNational.set(row.nationalId,next);
    }else{
      const entity={id:newId(),...row.value,motherId:null,entryDate:row.value.birthDate||today,entryReason:'Reprise d’inventaire',exitDate:null,exitReason:'',sessionId,origin:'import',note:'',source:IMPORT_SOURCE,sourceId:row.nationalId};
      writes.push(entity);byNational.set(row.nationalId,entity);
    }
  }
  for(const a of writes){
    if(a.motherNationalId&&!a.motherId){const m=byNational.get(a.motherNationalId);if(m&&m.id!==a.id&&m.sex!=='M')a.motherId=m.id;}
  }
  return writes;
}
