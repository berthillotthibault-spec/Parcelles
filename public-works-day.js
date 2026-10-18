// n° 20 « Saisie rapide de fin de journée sur les chantiers de travaux publics » : logique pure
// (pavé numérique, différence de compteur avec le dernier relevé, contrôles, récapitulatif, texte du bon)
// et une seule écriture groupée annulable : lignes du journal TP, compteurs, pleins GNR et photo du bon.
import {clone,uid} from './utils.js';
import {normalizeEntity} from './state.js';
import {averagePrice} from './fuel.js';

export const TP_DAY_UNITS=Object.freeze([['volumeM3','m³'],['tonnage','t']]);
export const TP_DAY_FIELDS=Object.freeze(['meter','hours','quantity','fuel']);
const MAX_HOURS_PER_DAY=24;
const active=rows=>(Array.isArray(rows)?rows:[]).filter(row=>row&&!row.deletedAt);
const r2=v=>Math.round((v+Number.EPSILON)*100)/100;
const fr=v=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(v);

/** Nombre saisi (« 12,5 », 12.5) : null si vide, NaN si invalide ou négatif. */
export function parseDecimal(value){
  if(value===null||value===undefined)return null;
  if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:NaN;
  const str=String(value).replace(/\s/g,'').replace(',','.');
  if(!str)return null;
  // Virgule finale tolérée (« 12, » laissé par le pavé numérique) : vaut 12.
  return /^\d+(?:\.\d*)?$/.test(str)?Number(str):NaN;
}

/** Pavé numérique maison : applique une touche à la saisie en cours (texte, virgule décimale). */
export function keypadInput(current,key,{maxLength=9,maxDecimals=2}={}){
  const value=String(current??'');
  if(key==='clear')return '';
  if(key==='back')return value.slice(0,-1);
  if(key===','||key==='.'){if(value.includes(','))return value;return (value||'0')+',';}
  if(!/^\d$/.test(key))return value;
  const decimals=value.includes(',')?value.split(',')[1].length:-1;
  if(decimals>=maxDecimals||value.replace(',','').length>=maxLength)return value;
  if(value==='0')return key;
  return value+key;
}

const meterOf=machine=>{const n=parseDecimal(machine?.currentMeter);return Number.isFinite(n)?n:null;};

/** Engins proposés pour un chantier : engin principal, puis ceux déjà vus dans son journal (les plus récents d’abord). */
export function tpDayEquipment(state,chantier){
  const machines=active(state?.materiels),ids=[];
  const add=id=>{if(id&&!ids.includes(id)&&machines.some(m=>m.id===id))ids.push(id);};
  add(chantier?.equipmentId);
  [...active(chantier?.tpLogs)].sort((a,b)=>String(b.date).localeCompare(String(a.date))||(b.createdAt||0)-(a.createdAt||0)).forEach(log=>add(log.equipmentId));
  return ids.map(id=>{const m=machines.find(row=>row.id===id);return{id,name:m.nom||'Engin',previousMeter:meterOf(m)};});
}

/** Lignes déjà saisies par « Fin de journée » pour ce chantier et cette date (risque de double saisie). */
export const tpDayExisting=(chantier,date)=>active(chantier?.tpLogs).filter(log=>log.dayId&&log.date===date).length;

/**
 * Calcule le récapitulatif de la journée sans rien écrire. Une ligne vide est ignorée.
 * Heures : saisie directe si renseignée, sinon différence entre le compteur relevé et le dernier relevé connu.
 */
export function planTpDay(state,chantier,input={},{today=''}={}){
  const errors=[],warnings=[],entries=[];
  const date=String(input.date||'');
  if(!chantier||chantier.deletedAt||chantier.kind!=='tp')errors.push('Ce chantier TP est introuvable ou supprimé.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))errors.push('Renseignez une date valide.');
  else if(today&&date>today)errors.push('La date ne peut pas être dans le futur.');
  const operator=String(input.operator||'').trim().slice(0,200),note=String(input.note||'').trim().slice(0,4000);
  const price=averagePrice(state||{},{today:today||null})??(Number.isFinite(parseDecimal(state?.preferences?.fuelPrice))?parseDecimal(state.preferences.fuelPrice):null);
  const machines=active(state?.materiels),seen=new Set();
  for(const row of Array.isArray(input.rows)?input.rows:[]){
    const machine=machines.find(m=>m.id===row?.equipmentId);
    const values={meter:parseDecimal(row?.meter),hours:parseDecimal(row?.hours),quantity:parseDecimal(row?.quantity),fuel:parseDecimal(row?.fuel)};
    if(Object.values(values).every(v=>v===null))continue;
    const name=machine?.nom||'Engin';
    if(!machine){errors.push('Un engin de la saisie est introuvable ou supprimé.');continue;}
    if(seen.has(machine.id)){errors.push(`${name} : engin saisi deux fois.`);continue;}
    seen.add(machine.id);
    const label={meter:'Compteur',hours:'Heures',quantity:'Quantité',fuel:'Carburant'};
    const bad=Object.keys(values).filter(key=>Number.isNaN(values[key]));
    if(bad.length){errors.push(`${name} : ${bad.map(key=>label[key]).join(', ')} invalide${bad.length>1?'s':''}.`);continue;}
    const previous=meterOf(machine),rowWarnings=[];
    let hours=values.hours,fromMeter=false;
    if(values.meter!==null&&previous!==null){
      if(values.meter<previous){errors.push(`${name} : compteur inférieur au dernier relevé (${fr(previous)} h).`);continue;}
      const diff=r2(values.meter-previous);
      if(hours===null){hours=diff;fromMeter=true;}
      else if(Math.abs(hours-diff)>0.01)rowWarnings.push(`heures saisies (${fr(hours)} h) différentes de l’écart de compteur (${fr(diff)} h)`);
      if(fromMeter&&diff>MAX_HOURS_PER_DAY)rowWarnings.push(`${fr(diff)} h depuis le dernier relevé : plusieurs journées ? Vérifiez le compteur`);
    }else if(values.meter!==null&&previous===null)rowWarnings.push('premier relevé du compteur : heures non déduites');
    if(hours!==null&&!fromMeter&&hours>MAX_HOURS_PER_DAY){errors.push(`${name} : ${MAX_HOURS_PER_DAY} h maximum par jour.`);continue;}
    const unit=TP_DAY_UNITS.some(([key])=>key===row?.unit)?row.unit:'volumeM3';
    const fuelLiters=values.fuel!==null&&values.fuel>0?values.fuel:null;
    if(fuelLiters!==null&&fuelLiters>2000)rowWarnings.push(`${fr(fuelLiters)} L de carburant : vérifiez la saisie`);
    const entry={equipmentId:machine.id,name,meterStart:previous,meterEnd:values.meter,hours,hoursFromMeter:fromMeter,
      volumeM3:unit==='volumeM3'?values.quantity:null,tonnage:unit==='tonnage'?values.quantity:null,
      fuelLiters,fuelAmount:fuelLiters!==null&&price!==null?r2(fuelLiters*price):null,warnings:rowWarnings};
    if(entry.hours===null&&entry.volumeM3===null&&entry.tonnage===null&&entry.fuelLiters===null&&entry.meterEnd===null)continue;
    entries.push(entry);
    for(const w of rowWarnings)warnings.push(`${name} : ${w}.`);
  }
  if(!entries.length&&!errors.length)errors.push('Renseignez au moins un engin : compteur, heures, quantité ou carburant.');
  const sum=key=>r2(entries.reduce((s,e)=>s+(e[key]??0),0));
  const totals={hours:sum('hours'),volumeM3:sum('volumeM3'),tonnage:sum('tonnage'),fuelLiters:sum('fuelLiters'),fuelAmount:entries.some(e=>e.fuelAmount!==null)?sum('fuelAmount'):null};
  if(chantier&&tpDayExisting(chantier,date))warnings.push('Une fin de journée a déjà été enregistrée pour cette date : attention aux doublons.');
  return{date,operator,note,entries,totals,fuelPrice:price,errors,warnings,ready:!errors.length&&entries.length>0};
}

/** Nombre d’écritures que créera la validation (lignes de journal, compteurs, pleins, photo). */
export function tpDayWriteCount(plan,{photo=false}={}){
  const e=plan?.entries||[];
  return{logs:e.length,meters:e.filter(x=>x.meterEnd!==null&&(x.meterStart===null||x.meterEnd>x.meterStart)).length,fuels:e.filter(x=>x.fuelLiters!==null).length,photo:photo?1:0};
}

/** Texte du bon de chantier à envoyer au client (sans carburant, donnée interne). */
export function tpDayShareText(plan,{chantier=null,clientName='',farmName=''}={}){
  const day=/^\d{4}-\d{2}-\d{2}$/.test(plan?.date||'')?plan.date.split('-').reverse().join('/'):'';
  const lines=[`Bon de chantier : ${chantier?.type||'Chantier'}`,[day,clientName].filter(Boolean).join(' · ')];
  if(chantier?.address)lines.push(chantier.address);
  lines.push('');
  for(const e of plan?.entries||[]){
    const parts=[];
    if(e.hours!==null)parts.push(`${fr(e.hours)} h`+(e.meterEnd!==null&&e.meterStart!==null?` (compteur ${fr(e.meterStart)} → ${fr(e.meterEnd)})`:''));
    if(e.volumeM3!==null)parts.push(`${fr(e.volumeM3)} m³`);
    if(e.tonnage!==null)parts.push(`${fr(e.tonnage)} t`);
    if(parts.length)lines.push(`- ${e.name} : ${parts.join(', ')}`);
  }
  const t=plan?.totals||{},total=[t.hours?`${fr(t.hours)} h`:'',t.volumeM3?`${fr(t.volumeM3)} m³`:'',t.tonnage?`${fr(t.tonnage)} t`:''].filter(Boolean);
  if(total.length)lines.push('',`Total : ${total.join(' · ')}`);
  if(plan?.operator)lines.push(`Opérateur : ${plan.operator}`);
  if(plan?.note)lines.push(`Travaux : ${plan.note}`);
  if(farmName)lines.push('',farmName);
  return lines.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

const signature=plan=>JSON.stringify((plan.entries||[]).map(e=>[e.equipmentId,e.meterStart,e.meterEnd,e.hours,e.volumeM3,e.tonnage,e.fuelLiters]));

/** Opérations soumises au garde-fou de rôle pour enregistrer une journée (compte de tpDayWriteCount). */
export function tpDaySaveOperations(chantierId,count={}){
  return [{entity:'chantiers',action:'update',entityId:chantierId},...(count.meters?[{entity:'materiels',action:'update'}]:[]),...(count.fuels?[{entity:'integrationImports',action:'create',farmKind:'fuel'}]:[]),...(count.photo?[{entity:'documents',action:'create'}]:[])];
}
/** Opérations pour annuler une journée : compteurs remis à leur valeur, pleins et photo à la corbeille. */
export function tpDayUndoOperations(chantierId,{meters=0,fuels=0,photo=0}={}){
  return [{entity:'chantiers',action:'update',entityId:chantierId},...(meters?[{entity:'materiels',action:'update'}]:[]),...(fuels?[{entity:'integrationImports',action:'delete',farmKind:'fuel'}]:[]),...(photo?[{entity:'documents',action:'delete'}]:[])];
}
/** Vrai si le garde-fou (store.writeGuard) autorise toutes ces opérations ; aucun garde-fou : tout est permis. */
export const tpDayAllowed=(writeGuard,operations)=>typeof writeGuard!=='function'||operations.every(op=>writeGuard(op));
/** Ce que l'annulation d'une journée déjà enregistrée devra écrire (état courant). */
export function tpDayUndoScope(state,chantierId,dayId){
  const chantier=(state?.chantiers||[]).find(row=>row.id===chantierId);
  const logs=active(chantier?.tpLogs).filter(log=>dayId&&log.dayId===dayId);
  const fills=active(state?.integrationImports).filter(r=>dayId&&r.tpDayId===dayId),docs=active(state?.documents).filter(r=>dayId&&r.tpDayId===dayId);
  const restores=logs.filter(log=>log.meterEnd!==null&&log.meterEnd!==undefined&&log.meterEnd!==log.meterStart);
  return{chantier,logs,fills,docs,restores,operations:tpDayUndoOperations(chantierId,{meters:restores.length,fuels:fills.length,photo:docs.length})};
}

function guard(store,operations){
  if(!tpDayAllowed(store.writeGuard,operations))throw new Error('Votre rôle ne permet pas cette saisie de fin de journée.');
}
function touch(store,type,record,action='update',queue=true){
  record.updatedAt=Date.now();record.version=(record.version||0)+1;
  if(queue)store.queue({entity:type,entityId:record.id,action,payload:action==='delete'?{id:record.id,deletedAt:record.deletedAt}:clone(record)});
}

/**
 * Une seule écriture : recalcule le récapitulatif sur l’état courant et refuse s’il a changé depuis l’affichage.
 * `document` : métadonnées d’une photo du bon dont le fichier est déjà rangé (blobPut) sous document.id.
 */
export function saveTpDay(store,chantierId,input,{expected,document=null,today=''}={}){
  return store.mutate('Fin de journée chantier enregistrée',state=>{
    const chantier=(state.chantiers||[]).find(row=>row.id===chantierId&&!row.deletedAt);
    const plan=planTpDay(state,chantier,input,{today});
    if(!plan.ready)throw new Error(plan.errors[0]||'Saisie incomplète.');
    if(expected&&signature(expected)!==signature(plan))throw new Error('Les compteurs ou les engins ont changé depuis le récapitulatif : vérifiez à nouveau.');
    const count=tpDayWriteCount(plan,{photo:!!document});
    guard(store,tpDaySaveOperations(chantierId,count));
    const dayId=uid('tpday'),timestamp=Date.now();
    if(document){
      const doc=normalizeEntity('documents',{...document,chantierId,clientId:chantier.clientId||null,tpDayId:dayId,documentDate:plan.date,category:'Bon de chantier',kind:'document',source:'local'});
      state.documents.push(doc);
    }
    const logs=Array.isArray(chantier.tpLogs)?clone(chantier.tpLogs):[];
    for(const e of plan.entries){
      // Ligne sans heures ni quantité (premier relevé, plein seul) : une note la garde modifiable dans le journal.
      const bare=e.hours===null&&e.volumeM3===null&&e.tonnage===null;
      const note=plan.note||(bare?[e.meterEnd!==null?`Relevé de compteur : ${fr(e.meterEnd)} h`:'',e.fuelLiters!==null?`Plein : ${fr(e.fuelLiters)} L`:''].filter(Boolean).join(' · '):'');
      logs.push({id:uid('tplog'),date:plan.date,equipmentId:e.equipmentId,operator:plan.operator,hours:e.hours,volumeM3:e.volumeM3,tonnage:e.tonnage,note,
        meterStart:e.meterStart,meterEnd:e.meterEnd,fuelLiters:e.fuelLiters,dayId,documentId:document?.id||null,createdAt:timestamp,updatedAt:timestamp,deletedAt:null});
      const machine=state.materiels.find(m=>m.id===e.equipmentId);
      if(e.meterEnd!==null&&(meterOf(machine)===null||e.meterEnd>meterOf(machine))){machine.currentMeter=e.meterEnd;touch(store,'materiels',machine);}
      if(e.fuelLiters!==null){
        const fill=normalizeEntity('integrationImports',{id:uid('fuel'),name:`Plein ${e.name} ${plan.date}`,farmKind:'fuel',format:'Parcelles',recordVersion:1,entry:'machine',date:plan.date,
          litres:e.fuelLiters,unitPrice:plan.fuelPrice,amount:e.fuelAmount,meter:e.meterEnd,equipmentId:e.equipmentId,fromTank:true,supplier:'',invoiceRef:'',documentId:document?.id||null,
          note:`Fin de journée chantier : ${chantier.type||''}`.trim(),chantierId,tpDayId:dayId});
        state.integrationImports.push(fill);store.queue({entity:'integrationImports',entityId:fill.id,action:'create',payload:clone(fill)});
      }
    }
    chantier.tpLogs=logs;touch(store,'chantiers',chantier);
    return{dayId,plan:clone(plan),count};
  },{entity:'chantiers',entityId:chantierId,action:'update',queue:false});
}

/** Annule toute une fin de journée : lignes, pleins et photo passent à la corbeille, compteurs remis à leur valeur précédente. */
export function undoTpDay(store,chantierId,dayId){
  return store.mutate('Fin de journée chantier annulée',state=>{
    const {chantier,logs,fills,docs,restores,operations}=tpDayUndoScope(state,chantierId,dayId);
    if(!chantier||!dayId)throw new Error('Cette fin de journée est introuvable.');
    if(!logs.length&&!fills.length&&!docs.length)throw new Error('Cette fin de journée a déjà été annulée.');
    if(!tpDayAllowed(store.writeGuard,operations))throw new Error('Votre rôle ne permet pas d’annuler cette journée (pleins, photo ou compteurs) : demandez à un responsable.');
    const at=Date.now();
    for(const log of logs){log.deletedAt=at;log.updatedAt=at;}
    let meters=0;
    for(const log of restores){const machine=(state.materiels||[]).find(m=>m.id===log.equipmentId);if(machine&&meterOf(machine)===log.meterEnd){machine.currentMeter=log.meterStart??null;touch(store,'materiels',machine);meters++;}}
    for(const r of fills){r.deletedAt=at;touch(store,'integrationImports',r,'delete');}
    for(const r of docs){r.deletedAt=at;touch(store,'documents',r,'delete');}
    touch(store,'chantiers',chantier);
    return{logs:logs.length,fuels:fills.length,documents:docs.length,meters};
  },{entity:'chantiers',entityId:chantierId,action:'update',queue:false});
}
