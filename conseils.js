// I2 — Veille agronomique quotidienne sur le prévu. Logique pure (aucun accès au DOM ni au réseau).
// farmAdvice(state) relit les travaux prévus, l'assolement et le troupeau et signale ce qui pose problème
// avant qu'il ne soit trop tard : DAR d'une récolte prévue, azote au-delà du PPF, épandage en période
// d'interdiction, successions à risque, vêlages, délais d'attente avant une sortie.
// Aucun produit n'est jamais recommandé. Sans donnée (pas de fiche DAR, composition inconnue, race
// inconnue), pas d'alerte : l'absence est seulement notée dans why[] quand elle compte.
// overdueLevel(state, work) reclasse un travail en retard (R8) pour notifications.js.
import {campaignFor,localIso,normalize} from './utils.js';
import {active,completed} from './farm-memory.js';
import {agendaDate,isPending,expectedCalvings} from './home-priorities.js';
import {darConflicts,harvestsFor,isTreatment,limitsFor,productFor} from './phyto.js';
import {banPeriodFor,cultureFor,cultureSeason,fertilizerFor,isFertilization,nitrogenPerHa,nitrogenReferences,parcelInZone,parcelPlan} from './nitrogen.js';
import {campaignYear,cultureHistory,rotationAlerts,rotationFamily} from './rotation-advice.js';
import {animalLot,animalTreatments,normalizeNationalId} from './herd.js';
import {grazingAnimalList,grazingDate,grazingStatus} from './grazing.js';
import {withdrawalEnd} from './herd-health.js';

const DAY=864e5;
const HARVEST=/recolte|moisson|battage|ensilage|arrachage|fauche/;
// Semis : le libellé doit commencer par le mot (« Désherbage post-semis » ou « Roulage après semis » n’en sont pas).
const SOWING=/^(semis|semer|semaille|implantation)\b/;
const ms=day=>Date.parse(`${day}T12:00:00Z`);
const addDays=(day,n)=>new Date(ms(day)+n*DAY).toISOString().slice(0,10);
const gap=(from,to)=>Math.round((ms(to)-ms(from))/DAY);
const ddmm=day=>`${String(day).slice(8,10)}/${String(day).slice(5,7)}`;
const mdLabel=md=>`${md.slice(3,5)}/${md.slice(0,2)}`;
const isDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
const days=n=>`${n} jour${Math.abs(n)>1?'s':''}`;
const round=v=>Math.round(v);
const workCampaign=w=>w.campaignId||campaignFor(w.date||w.plannedDate);
const parcelName=p=>p?.nom||'Parcelle';

/** Familles de cultures utilisées par les règles de succession (R4). */
export const ADVICE_FAMILIES=Object.freeze({
  pailles:Object.freeze({label:'Céréales à paille',match:/\bble\b|froment|\borge\b|escourgeon|triticale|seigle|avoine|epeautre/,exclude:/ble noir|sarrasin/}),
  maisGrain:Object.freeze({label:'Maïs grain',match:/\bmais\b/,exclude:/ensil|fourrage/}),
  sclerotinia:Object.freeze({label:'Cultures sensibles au sclérotinia',match:/colza|tournesol|soja|\bpois\b|\blin\b|haricot|lupin/,exclude:null})
});
const inFamily=(culture,key)=>{const f=ADVICE_FAMILIES[key],c=normalize(culture);return Boolean(c)&&f.match.test(c)&&!(f.exclude&&f.exclude.test(c));};

/** Dates limites de semis (MM-JJ), surchargeables par preferences.sowingLimits (mêmes clés). */
export const SOWING_LIMITS=Object.freeze({'blé tendre d’hiver':'11-15','orge d’hiver':'11-01',colza:'09-15','maïs':'05-31'});
const SOWING_MATCH=[
  ['maïs',c=>/\bmais\b/.test(c)],
  ['colza',c=>/colza/.test(c)],
  ['orge d’hiver',c=>/\borge\b|escourgeon/.test(c)&&!/printemps/.test(c)],
  ['blé tendre d’hiver',c=>/\bble\b|froment/.test(c)&&!/\bdur\b|printemps|noir/.test(c)]
];
const DAIRY_BREEDS=['Prim’Holstein','Montbéliarde','Normande'];
const DRY_DAYS=60;
const SOURCES={
  R4A:'Arvalis : le maïs grain laisse des résidus porteurs de fusarium ; une paille derrière est la situation la plus exposée aux mycotoxines (DON).',
  R4B:'Arvalis : les successions longues de céréales à paille favorisent piétin-verse, piétin-échaudage et graminées adventices.',
  R4C:'Terres Inovia : le sclérotinia se conserve plusieurs années dans le sol ; au moins 3 ans entre deux cultures sensibles.'
};

function sowingLimitFor(culture,prefs={}){
  const c=normalize(culture);if(!c)return null;
  const hit=SOWING_MATCH.find(([,test])=>test(c));if(!hit)return null;
  const own=prefs?.sowingLimits?.[hit[0]],md=/^\d{2}-\d{2}$/.test(String(own||''))?own:SOWING_LIMITS[hit[0]];
  return {key:hit[0],md};
}
// Date limite la plus proche de la date prévue (année précédente, même année ou suivante).
function limitDateNear(day,md){
  const y=Number(day.slice(0,4));
  return [y-1,y,y+1].map(year=>`${year}-${md}`).filter(isDay).sort((a,b)=>Math.abs(gap(day,a))-Math.abs(gap(day,b)))[0];
}

function parcelsById(state){return new Map(active(state,'parcelles').map(p=>[p.id,p]));}
function cropOf(state,parcel,work,today){
  return work?.culture||(parcel?cultureFor(state,parcel,workCampaign(work),today)||parcel.culture:'')||'';
}
// Période d'interdiction en cours pour un apport de fertilisant (null si hors zone, type inconnu ou hors période).
function banFor(state,work,parcel,day,refs){
  if(!parcel||!parcelInZone(state,parcel))return null;
  const fert=fertilizerFor(state,work.product);if(!fert)return null;
  const season=cultureSeason(cropOf(state,parcel,work,day),refs),ban=banPeriodFor(day,fert.type,season,refs);
  return ban?{ban,fert,season}:null;
}

/**
 * R8 : niveau d'un travail en retard. Urgent si attendre davantage a une conséquence datée
 * (DAR qui déborde sur une récolte prévue, fenêtre de semis dépassée, épandage désormais interdit),
 * sinon « warning ».
 * @returns {{level:'urgent'|'warning', rule:'R8', why:string[]}}
 */
export function overdueLevel(state,work,{today=localIso(),catalog=null,prefs=state?.preferences||{}}={}){
  const date=agendaDate(work),late=date&&date<today?gap(date,today):0,why=[];
  const parcel=parcelsById(state||{}).get(work?.parcelId)||null;
  if(work&&isTreatment(work)){
    const found=productFor(state,work,{catalog}),dar=limitsFor(found?.sheet||null,work,parcel).dar;
    if(dar===null||dar===undefined){if(found||work.product)why.push(`Pas de délai avant récolte connu pour ${work.product||'ce produit'} : contrôle de la récolte impossible.`);}
    else{
      const until=addDays(today,dar),harvest=harvestsFor(state,work.parcelId,{exceptId:work.id}).filter(h=>h.date>=today&&h.date<until).sort((a,b)=>a.date.localeCompare(b.date))[0];
      if(harvest){
        why.push(`Traitement en retard de ${days(late)} : fait aujourd’hui, le délai avant récolte de ${dar} j court jusqu’au ${ddmm(until)}, après la récolte prévue le ${ddmm(harvest.date)}.`);
        return {level:'urgent',rule:'R8',why};
      }
    }
  }
  if(work&&!isTreatment(work)&&!isFertilization(work)&&(SOWING.test(normalize(work.type).trim())||work.kind==='sow')){
    const crop=cropOf(state,parcel,work,today),limit=sowingLimitFor(crop,prefs);
    if(limit&&date){
      const end=limitDateNear(date,limit.md);
      if(today>end){why.push(`Fenêtre de semis dépassée : date limite indicative du ${ddmm(end)} pour ${limit.key} (réglable). Changer de culture ou de variété.`);return {level:'urgent',rule:'R8',why};}
    }else if(!limit&&crop)why.push(`Pas de date limite de semis connue pour ${crop}.`);
  }
  if(work&&isFertilization(work)){
    const refs=nitrogenReferences(state),hit=banFor(state,work,parcel,today,refs);
    if(hit){why.push(`Fertilisation en retard : l’épandage de type ${hit.fert.type} est interdit du ${mdLabel(hit.ban.from)} au ${mdLabel(hit.ban.to)} sur cette culture (zone vulnérable).`);return {level:'urgent',rule:'R8',why};}
  }
  why.unshift(`En retard de ${days(late)}, sans conséquence datée connue (récolte, semis, période d’interdiction).`);
  return {level:'warning',rule:'R8',why};
}

function adviceId(rule,entityId,n=0){return `advice-${rule}-${entityId}${n?`-${n}`:''}`;}

// R1 : récolte, fauche ou ensilage prévus pendant le délai avant récolte d'un traitement terminé.
function ruleR1(state,{today,catalog},parcels,out){
  for(const w of active(state,'interventions')){
    if(!isPending(w)||!HARVEST.test(normalize(w.type)))continue;
    const date=agendaDate(w);if(!date)continue;
    // Une seule ligne par récolte (identifiant stable) : le traitement qui impose la date la plus tardive ;
    // les autres traitements en conflit sont cités dans why[].
    // until recalculé en jours civils : darConflicts ajoute dar × 24 h à minuit local, ce qui recule d’un jour
    // quand le délai traverse le passage à l’heure d’hiver.
    const conflicts=darConflicts(state,w.parcelId,date,{catalog}).map(c=>isDay(String(c.work.date).slice(0,10))?{...c,until:addDays(String(c.work.date).slice(0,10),c.dar)}:c).filter(c=>c.until>date).sort((a,b)=>b.until.localeCompare(a.until));
    const c=conflicts[0];if(!c)continue;
    const shift=gap(date,c.until),parcel=parcels.get(w.parcelId),product=c.work.product||c.work.type||'Le traitement';
    const others=conflicts.slice(1).map(o=>`Autre traitement en conflit : ${o.work.product||o.work.type||'traitement'} du ${ddmm(o.work.date)}, délai avant récolte de ${o.dar} j jusqu’au ${ddmm(o.until)}.`);
    out.push({id:adviceId('R1',w.id),rule:'R1',level:gap(today,date)<=7?'urgent':'warning',title:'Récolte dans le délai avant récolte',
      message:`${parcelName(parcel)} : ${normalize(w.type).startsWith('fauche')?'fauche':normalize(w.type).includes('ensil')?'ensilage':'récolte'} prévue le ${ddmm(date)}, mais ${product} (traité le ${ddmm(c.work.date)}) impose ${c.dar} j avant récolte, jusqu’au ${ddmm(c.until)}. Décalez la récolte de ${days(shift)} ou vérifiez l’étiquette.`,
      why:[`Traitement terminé le ${ddmm(c.work.date)} : délai avant récolte de ${c.dar} j (fiche produit).`,...others,`Récolte prévue le ${ddmm(date)}, ${days(gap(today,date))} après aujourd’hui : urgent à 7 jours ou moins.`,'Seule l’étiquette du produit fait foi.'],
      entity:'interventions',entityId:w.id,action:{type:'postpone-work',label:'Décaler la récolte',id:w.id}});
  }
}

// R3A : azote réalisé + prévu au-delà du PPF (dose × 1,1).
function ruleR3A(state,{today},parcels,out){
  const campaign=campaignFor(today),refs=nitrogenReferences(state);
  const ferts=active(state,'interventions').filter(w=>w.status!=='Annulé'&&isFertilization(w)&&workCampaign(w)===campaign);
  for(const parcel of parcels.values()){
    const mine=ferts.filter(w=>w.parcelId===parcel.id),pending=mine.filter(w=>isPending(w));
    if(!pending.length)continue;
    const plan=parcelPlan(state,parcel,campaign,{today,refs});if(plan.dose===null||plan.dose===undefined)continue;
    let realized=0,planned=0;const unknown=[];
    for(const w of mine){
      const n=nitrogenPerHa(w,fertilizerFor(state,w.product));
      if(!n){unknown.push(w.product||w.type||'un apport');continue;}
      if(isPending(w))planned+=n.nEff;else if(completed(w))realized+=n.nEff;
    }
    const total=round(realized+planned);
    if(!planned||total<=plan.dose*1.1)continue;
    const over=total-round(plan.dose),last=[...pending].sort((a,b)=>agendaDate(b).localeCompare(agendaDate(a)))[0],lastDate=agendaDate(last);
    const why=[`PPF de la campagne ${campaign} : ${round(plan.dose)} kg N efficace/ha (alerte au-delà de ${round(plan.dose*1.1)}).`,`Réalisé : ${round(realized)} kg N efficace/ha ; prévu : ${round(planned)} kg N efficace/ha.`];
    for(const u of unknown)why.push(`Composition inconnue pour ${u} : apport non compté.`);
    out.push({id:adviceId('R3A',parcel.id),rule:'R3A',level:'warning',title:'Azote au-delà du PPF',
      message:`${plan.culture||parcel.culture||'Culture'}, ${parcelName(parcel)} : ${total} kg N efficace/ha prévus et réalisés pour ${round(plan.dose)} au PPF (+${over}). Réduisez le dernier apport${lastDate?` du ${ddmm(lastDate)}`:''} d’environ ${over} kg N/ha.`,
      why,entity:'parcelles',entityId:parcel.id,action:{type:'edit-work',label:'Modifier le dernier apport',id:last.id}});
  }
}

// R3B : apport prévu, non fait, dont la période d'interdiction a commencé (zone vulnérable).
function ruleR3B(state,{today},parcels,out){
  const refs=nitrogenReferences(state);
  for(const w of active(state,'interventions')){
    if(!isPending(w)||!isFertilization(w))continue;
    const date=agendaDate(w);if(!date||date>=today)continue;
    const parcel=parcels.get(w.parcelId),hit=banFor(state,w,parcel,today,refs);if(!hit)continue;
    out.push({id:adviceId('R3B',w.id),rule:'R3B',level:'urgent',title:'Apport en période d’interdiction',
      message:`${w.product||w.type||'Apport'} prévu le ${ddmm(date)} sur ${parcelName(parcel)}, non fait : l’épandage de type ${hit.fert.type} est interdit du ${mdLabel(hit.ban.from)} au ${mdLabel(hit.ban.to)} sur cette culture. Annulez ou reportez après le ${mdLabel(hit.ban.to)}.`,
      why:[`Parcelle en zone vulnérable.`,`Fertilisant de type ${hit.fert.type} (${hit.fert.name||w.product}).`,`Période d’interdiction de la table de références : du ${mdLabel(hit.ban.from)} au ${mdLabel(hit.ban.to)}.`],
      entity:'interventions',entityId:w.id,action:{type:'postpone-work',label:'Reporter l’apport',id:w.id}});
  }
}

// R4 : successions à risque, sur le prévu (campagne en cours et suivantes).
function ruleR4(state,{today},parcels,out){
  const current=campaignFor(today);
  const known=rotationAlerts(state,{current});
  for(const parcel of parcels.values()){
    if(parcel.archived)continue;
    const hist=cultureHistory(state,parcel.id,{current});
    hist.forEach((entry,i)=>{
      if(entry.campaignId<current)return;
      const year=campaignYear(entry.campaignId),prev=hist[i-1];
      const base={entity:'parcelles',entityId:parcel.id,action:{type:'open-rotations',label:'Ouvrir l’assolement',id:parcel.id}};
      if(inFamily(entry.culture,'pailles')&&prev&&campaignYear(prev.campaignId)===year-1&&inFamily(prev.culture,'maisGrain')){
        out.push({...base,id:adviceId('R4A',parcel.id,year),rule:'R4A',level:'warning',title:'Paille après maïs grain',
          message:`${parcelName(parcel)} : ${entry.culture} prévu en ${entry.campaignId} après maïs grain : risque de fusariose et de DON. Labour ou broyage fin des résidus, variété peu sensible.`,
          why:[`${prev.campaignId} : ${prev.culture} ; ${entry.campaignId} : ${entry.culture}.`,SOURCES.R4A]});
      }
      if(inFamily(entry.culture,'pailles')){
        let n=1;for(let j=i-1;j>=0&&campaignYear(hist[j].campaignId)===year-(i-j)&&inFamily(hist[j].culture,'pailles');j--)n++;
        if(n>=3)out.push({...base,id:adviceId('R4B',parcel.id,year),rule:'R4B',level:'warning',title:'Pailles sur pailles',
          message:`${parcelName(parcel)} : ${n} campagnes de céréales à paille d’affilée jusqu’en ${entry.campaignId}, pas de tête d’assolement depuis ${n} ans.`,
          why:[hist.slice(i-n+1,i+1).map(h=>`${h.campaignId} : ${h.culture}`).join(' ; ')+'.',SOURCES.R4B]});
      }
      if(inFamily(entry.culture,'sclerotinia')){
        const before=hist.slice(0,i).reverse().find(h=>inFamily(h.culture,'sclerotinia'));
        if(before&&year-campaignYear(before.campaignId)<3){
          const already=known.filter(a=>a.parcelId===parcel.id&&a.campaignId===entry.campaignId&&a.family===rotationFamily(entry.culture));
          out.push({...base,id:adviceId('R4C',parcel.id,year),rule:'R4C',level:'warning',title:'Sclérotinia : retour trop rapide',
            message:`${parcelName(parcel)} : ${entry.culture} prévu en ${entry.campaignId}, ${before.culture} en ${before.campaignId} : moins de 3 ans entre deux cultures sensibles au sclérotinia.`,
            why:[`${before.campaignId} : ${before.culture} ; ${entry.campaignId} : ${entry.culture}.`,SOURCES.R4C,...already.map(a=>a.message)]});
        }
      }
    });
  }
}

// R6 : vêlages attendus (tarissement, case de vêlage, vêlage dépassé).
function ruleR6(state,{today,prefs},out){
  const dairy=(Array.isArray(prefs?.dairyBreeds)&&prefs.dairyBreeds.length?prefs.dairyBreeds:DAIRY_BREEDS).map(normalize);
  const events=active(state,'animalEvents');
  for(const row of expectedCalvings(state,{today,horizon:75,past:30})){
    const a=row.animal,label=[a.nationalId||a.name||'Animal',a.nationalId&&a.name?`(${a.name}${a.breed?`, ${a.breed}`:''})`:a.breed?`(${a.breed})`:''].filter(Boolean).join(' ');
    const base={entity:'animals',entityId:a.id,action:{type:'open-herd-animal',label:'Ouvrir la fiche',id:a.id}};
    const service=`${row.event.kind==='mating'?'Saillie':'Insémination'} du ${ddmm(row.event.date)} : vêlage prévu le ${ddmm(row.date)}.`;
    if(row.days<-10){
      out.push({...base,id:adviceId('R6C',a.id),rule:'R6C',level:'urgent',title:'Vêlage dépassé',
        message:`${label} : vêlage dépassé de ${days(-row.days)} : vérifiez la gestation.`,why:[service,'Aucun vêlage saisi depuis : alerte au-delà de 10 jours de retard.']});
      continue;
    }
    if(row.days<0)continue;
    const dry=addDays(row.date,-DRY_DAYS);
    if(a.breed&&dairy.includes(normalize(a.breed))&&gap(today,dry)<=7&&gap(today,dry)>=-7
      &&!events.some(e=>e.animalId===a.id&&['tarissement','drying','dry-off'].includes(e.kind)&&String(e.date)>=String(row.event.date))){
      out.push({...base,id:adviceId('R6A',a.id),rule:'R6A',level:'warning',title:'Tarissement à prévoir',
        message:`${label} : vêlage prévu le ${ddmm(row.date)}, tarissement conseillé vers le ${ddmm(dry)}.`,
        why:[service,`Race laitière (${a.breed}) : tarissement environ ${DRY_DAYS} jours avant le vêlage.`,'Aucun tarissement saisi.']});
    }
    if(row.days<=15){
      const lot=animalLot(state,a,{today});
      if(lot&&grazingStatus(lot,{date:today})==='current')out.push({...base,id:adviceId('R6B',a.id),rule:'R6B',level:'warning',title:'Vêlage proche, animal au pré',
        message:`${label} : vêlage prévu le ${ddmm(row.date)}, dans ${days(row.days)}, et l’animal est au pré. Rentrez-la en case de vêlage.`,
        why:[service,`Lot en cours : ${lot.note||lot.id}.`,'Alerte à 15 jours ou moins du vêlage.']});
    }
  }
}

// R7 : sortie Vente ou Boucherie pendant le délai d'attente viande d'un traitement (animal ou lot).
function ruleR7(state,{today},out){
  const sessions=new Map(active(state,'grazingSessions').map(s=>[s.id,s]));
  const lotTreatments=active(state,'vetTreatments').filter(t=>(t.kind||'treatment')==='treatment'&&t.sessionId);
  for(const a of active(state,'animals')){
    const exit=String(a.exitDate||'').slice(0,10);
    if(!isDay(exit)||!['Vente','Boucherie'].includes(a.exitReason)||exit<addDays(today,-1))continue;
    const key=normalizeNationalId(a.nationalId),mine=item=>item.animalId===a.id||Boolean(key)&&normalizeNationalId(item.number)===key;
    // Lot en place à la date du soin (entrée au plus tard ce jour-là, sortie au plus tôt ce jour-là) et qui comptait l’animal.
    const inLot=t=>{const s=sessions.get(t.sessionId),d=String(t.date||'').slice(0,10);if(!s)return false;
      const start=s.startDate?grazingDate(s.startDate):'',end=s.endDate?grazingDate(s.endDate):'';
      if(isDay(d)&&(start&&start>d||end&&end<d))return false;
      return grazingAnimalList(s).some(mine)||a.sessionId===t.sessionId;};
    const own=animalTreatments(state,a).filter(t=>(t.kind||'treatment')==='treatment');
    const all=[...own,...lotTreatments.filter(t=>!own.includes(t)&&inLot(t))]
      .map(t=>({t,until:t.meatUntil||withdrawalEnd(t.date,t.withdrawalMeatDays)}))
      // meatUntil est le dernier jour où la viande ne doit pas être livrée (withdrawalEnd) : une sortie ce jour-là est encore dans le délai.
      .filter(x=>isDay(String(x.until).slice(0,10))&&String(x.t.date).slice(0,10)<=exit&&String(x.until).slice(0,10)>=exit)
      .sort((x,y)=>y.until.localeCompare(x.until));
    const hit=all[0];if(!hit)continue;
    const until=String(hit.until).slice(0,10),who=a.nationalId||a.name||'Animal',shift=gap(exit,until)+1;
    out.push({id:adviceId('R7',a.id),rule:'R7',level:'urgent',title:'Sortie pendant un délai d’attente',
      message:`${who} : sortie ${a.exitReason} le ${ddmm(exit)}, mais traitement ${hit.t.medicine||'vétérinaire'} du ${ddmm(hit.t.date)} : attente viande jusqu’au ${ddmm(until)} inclus. Décalez la sortie de ${days(shift)}, au ${ddmm(addDays(until,1))} au plus tôt.`,
      why:[`Soin ${hit.t.sessionId&&!hit.t.animalId&&!own.includes(hit.t)?'du lot':'de l’animal'} le ${ddmm(hit.t.date)}, délai viande jusqu’au ${ddmm(until)} inclus (carnet sanitaire).`,'Le délai lait seul n’est pas pris en compte ici.'],
      entity:'animals',entityId:a.id,action:{type:'open-herd-animal',label:'Ouvrir la fiche',id:a.id}});
  }
}

const ORDER={urgent:0,warning:1,info:2};
/**
 * Conseils du jour, triés (urgent, warning, info) puis par identifiant.
 * @returns {Array<{id:string,rule:string,level:string,title:string,message:string,why:string[],entity:string,entityId:string,action:{type:string,label:string,id:string}}>}
 */
export function farmAdvice(state,{today=localIso(),catalog=null,prefs=state?.preferences||{}}={}){
  const data=state||{},out=[],parcels=parcelsById(data),ctx={today,catalog,prefs};
  const run=fn=>{try{fn();}catch{/* une règle en erreur n’empêche pas les autres */}};
  run(()=>ruleR1(data,ctx,parcels,out));
  run(()=>ruleR3A(data,ctx,parcels,out));
  run(()=>ruleR3B(data,ctx,parcels,out));
  run(()=>ruleR4(data,ctx,parcels,out));
  run(()=>ruleR6(data,ctx,out));
  run(()=>ruleR7(data,ctx,out));
  const seen=new Set();
  return out.filter(a=>!seen.has(a.id)&&seen.add(a.id)).sort((a,b)=>(ORDER[a.level]??9)-(ORDER[b.level]??9)||a.id.localeCompare(b.id));
}
