// n° 76 — Carnet sanitaire d’élevage : traitements vétérinaires, délais d’attente,
// prophylaxie et visite sanitaire. Logique pure (aucun accès au DOM).
// Collection vetTreatments : {kind:'treatment'|'prophylaxis'|'visit', date, sessionId, lotLabel,
// parcelId, animal, animalCount, medicine, prescriptionNumber, attachmentId, dose, doseUnit, route,
// veterinarian, withdrawalMeatDays, withdrawalMilkDays, note}.
// Conservation : 5 ans minimum. Aucune purge automatique n’est faite par l’application.
import {normalize} from './utils.js';
import {grazingTotal,grazingType,grazingDate,grazingStatus} from './grazing.js';

export const RETENTION_YEARS=5;
export const VET_ROUTES=Object.freeze(['Orale','Injectable intramusculaire','Injectable sous-cutanée','Injectable intraveineuse','Pour-on (cutanée)','Intramammaire','Intra-utérine','Autre']);
export const HERD_HEALTH_REFERENCES=Object.freeze({
  version:'2026.1',date:'2026-10-01',
  prophylaxisMonths:12,visitMonths:24,
  source:'Registre d’élevage (arrêté du 5 juin 2000) ; visite sanitaire bovine biennale ; prophylaxies selon le calendrier de votre GDS.',
  verify:'Rappels indicatifs : vérifiez le calendrier de prophylaxie de votre GDS et l’échéance de visite sanitaire avec votre vétérinaire.'
});

const text=v=>typeof v==='string'||typeof v==='number'?String(v).trim():'';
const dayMs=day=>Date.parse(`${day}T12:00:00Z`);
const addDays=(day,n)=>new Date(dayMs(day)+n*86400000).toISOString().slice(0,10);
const addMonths=(day,n)=>{const d=new Date(dayMs(day));d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,10);};
const days=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)&&n>=0?Math.ceil(n):NaN;};
const live=(state,key)=>(state?.[key]||[]).filter(x=>x&&!x.deletedAt);
const ddmm=day=>`${day.slice(8,10)}/${day.slice(5,7)}`;

/** Fin du délai d’attente : dernier jour où la denrée ne doit pas être livrée (date + délai). */
export function withdrawalEnd(date,delay){const d=grazingDate(date),n=days(delay);return d&&Number.isFinite(n)&&n>0?addDays(d,n):null;}

/** Valide et complète un soin ; lève une erreur lisible. */
export function normalizeTreatment(input,{state=null}={}){
  const kind=['treatment','prophylaxis','visit'].includes(input?.kind)?input.kind:'treatment';
  const date=grazingDate(input?.date);if(!date)throw new Error('Date du soin invalide.');
  const out={kind,date,note:text(input?.note),veterinarian:text(input?.veterinarian)};
  if(kind!=='treatment')return{...out,sessionId:input?.sessionId||null,lotLabel:text(input?.lotLabel)};
  const medicine=text(input?.medicine);if(!medicine)throw new Error('Indiquez le médicament.');
  const meat=days(input?.withdrawalMeatDays),milk=days(input?.withdrawalMilkDays);
  if(Number.isNaN(meat)||Number.isNaN(milk))throw new Error('Les délais d’attente sont des nombres de jours positifs.');
  const session=state?(state.grazingSessions||[]).find(s=>s.id===input?.sessionId&&!s.deletedAt):null;
  if(input?.sessionId&&state&&!session)throw new Error('Le lot choisi est introuvable.');
  const animal=text(input?.animal);
  let count=input?.animalCount===undefined||input?.animalCount===null||input?.animalCount===''?null:Math.floor(Number(input.animalCount));
  if(count===null)count=animal?1:session?grazingTotal(session):null;
  if(count===null||!Number.isSafeInteger(count)||count<1)throw new Error('Indiquez le lot ou le nombre d’animaux traités.');
  if(!session&&!animal&&!text(input?.lotLabel))throw new Error('Choisissez un lot ou indiquez l’animal traité.');
  const dose=input?.dose===undefined||input?.dose===null||input?.dose===''?null:Number(String(input.dose).replace(',','.'));
  if(dose!==null&&(!Number.isFinite(dose)||dose<=0))throw new Error('Dose invalide.');
  return{...out,sessionId:session?.id||null,lotLabel:text(input?.lotLabel)||(session?text(session.note)||grazingType(session):''),parcelId:session?.parcelId||input?.parcelId||null,
    animal,animalCount:count,species:text(input?.species)||(session?grazingType(session):''),medicine,prescriptionNumber:text(input?.prescriptionNumber),attachmentId:input?.attachmentId||null,
    dose,doseUnit:text(input?.doseUnit),route:VET_ROUTES.includes(input?.route)?input.route:text(input?.route),
    withdrawalMeatDays:meat,withdrawalMilkDays:milk,meatUntil:withdrawalEnd(date,meat),milkUntil:withdrawalEnd(date,milk)};
}

const bovine=t=>/bovin|vache|genisse|veau|taureau|boeuf|taurillon/.test(normalize(t));
const noun=(rows,n)=>rows.every(r=>bovine(r.species||r.lotLabel))?(n>1?'bovins':'bovin'):(n>1?'animaux':'animal');

/** Soins dont le délai d’attente court encore (viande ou lait) au jour donné. */
export function activeWithdrawals(state,{today=grazingDate()}={}){
  const rows=live(state,'vetTreatments').filter(t=>(t.kind||'treatment')==='treatment').map(t=>({...t,meatUntil:t.meatUntil||withdrawalEnd(t.date,t.withdrawalMeatDays),milkUntil:t.milkUntil||withdrawalEnd(t.date,t.withdrawalMilkDays)}));
  const meat=rows.filter(t=>t.meatUntil&&t.meatUntil>=today&&t.date<=today),milk=rows.filter(t=>t.milkUntil&&t.milkUntil>=today&&t.date<=today);
  const sum=list=>list.reduce((s,t)=>s+(Number(t.animalCount)||1),0),max=(list,k)=>list.map(t=>t[k]).sort().at(-1)||null;
  const meatCount=sum(meat),milkCount=sum(milk),meatEnd=max(meat,'meatUntil'),milkEnd=max(milk,'milkUntil');
  const messages=[];
  if(meatCount)messages.push(`${meatCount} ${noun(meat,meatCount)} sous délai d’attente jusqu’au ${ddmm(meatEnd)}, ne pas vendre ni abattre`);
  if(milkCount)messages.push(`Lait de ${milkCount} ${milkCount>1?'animaux':'animal'} à écarter jusqu’au ${ddmm(milkEnd)}`);
  return{meat,milk,meatCount,milkCount,meatEnd,milkEnd,messages,active:meatCount+milkCount>0};
}

/** Rappels de prophylaxie et de visite sanitaire (indicatifs), d’après les derniers enregistrements. */
export function healthReminders(state,{today=grazingDate(),refs=HERD_HEALTH_REFERENCES}={}){
  const rows=live(state,'vetTreatments'),hasAnimals=live(state,'grazingSessions').some(s=>grazingStatus(s,{date:today})!=='invalid')||rows.length>0;
  if(!hasAnimals)return[];
  const last=kind=>rows.filter(r=>r.kind===kind).map(r=>r.date).sort().at(-1)||null;
  return[['prophylaxis','Prophylaxie annuelle',refs.prophylaxisMonths],['visit','Visite sanitaire',refs.visitMonths]].map(([kind,label,months])=>{
    const done=last(kind),due=done?addMonths(done,months):null,status=!done?'unknown':due<today?'late':addMonths(today,1)>=due?'soon':'ok';
    return{kind,label,last:done,due,status,text:!done?`${label} : aucune date enregistrée.`:status==='late'?`${label} à faire (échéance indicative ${ddmm(due)}/${due.slice(0,4)}).`:status==='soon'?`${label} à prévoir avant le ${ddmm(due)}/${due.slice(0,4)}.`:`${label} faite le ${ddmm(done)}/${done.slice(0,4)}.`};
  });
}

export function registerYears(state,{today=grazingDate()}={}){
  const years=new Set(live(state,'vetTreatments').map(t=>t.date?.slice(0,4)).filter(Boolean));years.add(today.slice(0,4));
  return[...years].sort().reverse();
}

/** Lignes du registre d’une année, triées par date. */
export function registerRows(state,year){
  return live(state,'vetTreatments').filter(t=>String(t.date||'').startsWith(String(year))).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}

const kindLabel={treatment:'Soin',prophylaxis:'Prophylaxie',visit:'Visite sanitaire'};
/** Blocs du registre PDF (pdf-lite flowPdf). */
export function registerPdfBlocks(state,year,{today=grazingDate()}={}){
  const farm=state?.exploitation||{},rows=registerRows(state,year),fr=d=>d?`${d.slice(8,10)}/${d.slice(5,7)}/${d.slice(0,4)}`:'—';
  const table=rows.map(t=>[fr(t.date),kindLabel[t.kind||'treatment'],[t.lotLabel,t.animal].filter(Boolean).join(' · ')||'—',t.animalCount?String(t.animalCount):'—',t.medicine||'—',t.dose?`${t.dose} ${t.doseUnit||''}`.trim():'—',t.route||'—',t.prescriptionNumber||'—',t.veterinarian||'—',t.meatUntil?fr(t.meatUntil):'—',t.milkUntil?fr(t.milkUntil):'—']);
  return[{type:'h1',text:`Registre sanitaire d’élevage ${year}`},
    {type:'p',text:`${farm.nom||'Mon exploitation'}${farm.commune?` · ${farm.commune}`:''} · édité le ${fr(today)}`,muted:true},
    {type:'note',text:`Document établi à partir des soins saisis. À conserver ${RETENTION_YEARS} ans avec les ordonnances.`},
    {type:'table',head:['Date','Nature','Lot / animal','Nb','Médicament','Dose','Voie','Ordonnance','Vétérinaire','Attente viande','Attente lait'],rows:table.length?table:[['Aucun soin enregistré','','','','','','','','','','']],align:['','','','right','','right','','','','','']},
    {type:'p',text:`${HERD_HEALTH_REFERENCES.source} ${HERD_HEALTH_REFERENCES.verify}`,small:true,muted:true}];
}

/** Entrée du tableau de conformité (n° 55). */
export function herdHealthComplianceChecks(state,{today=grazingDate()}={}){
  const rows=live(state,'vetTreatments'),animals=live(state,'grazingSessions').length>0;
  const make=(status,detail,items=[])=>({id:'herd-health',label:'Registre sanitaire d’élevage',status,statusLabel:{ko:'À corriger',warn:'À vérifier',unknown:'Non suivi',ok:'À jour',na:'Non concerné'}[status],detail,items,action:{type:'herdHealth',label:'Carnet sanitaire'},hint:HERD_HEALTH_REFERENCES.verify});
  if(!animals&&!rows.length)return[make('na','Aucun animal enregistré.')];
  const treatments=rows.filter(t=>(t.kind||'treatment')==='treatment'),incomplete=treatments.filter(t=>!t.prescriptionNumber||(t.withdrawalMeatDays===null&&t.withdrawalMilkDays===null));
  const reminders=healthReminders(state,{today}).filter(r=>r.status!=='ok');
  const items=[...incomplete.map(t=>({label:`${t.medicine} le ${t.date.slice(8,10)}/${t.date.slice(5,7)}`,note:!t.prescriptionNumber?'N° d’ordonnance manquant':'Délai d’attente non renseigné',status:'warn'})),...reminders.map(r=>({label:r.label,note:r.text,status:r.status==='late'?'warn':'unknown'}))];
  const status=!rows.length?'unknown':incomplete.length||reminders.some(r=>r.status==='late')?'warn':'ok';
  const w=activeWithdrawals(state,{today});
  const detail=!rows.length?'Aucun soin enregistré dans le carnet sanitaire.':`${treatments.length} soin${treatments.length>1?'s':''} enregistré${treatments.length>1?'s':''}${incomplete.length?` · ${incomplete.length} incomplet${incomplete.length>1?'s':''}`:''}${w.active?` · ${w.messages.join(' · ')}`:''}.`;
  return[make(status,detail,items)];
}
