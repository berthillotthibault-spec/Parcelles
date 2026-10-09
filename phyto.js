// n° 62 — Registre phytosanitaire et contrôles avant validation d'un traitement.
// Logique pure (testée sous Node). Les contrôles s'appuient sur la fiche produit saisie
// (stockItems/products, champ optionnel `phyto`), éventuellement complétée par le catalogue
// E-Phy local (n° 59). Ils restent indicatifs : seule l'étiquette du produit fait foi et
// l'absence d'alerte ne vaut jamais autorisation.
import {campaignFor,escapeHtml,formatNumber,localDate,normalize,toNullableNumber} from './utils.js';
import {active,completed} from './farm-memory.js';
import {printCss,printDocument} from './dossier.js';

export const PHYTO_DISCLAIMER='Contrôles indicatifs établis d’après la fiche produit saisie : vérifiez l’étiquette du produit et la réglementation en vigueur. L’absence d’alerte ne vaut pas autorisation.';
export const LABEL_REMINDER='Vérifiez l’étiquette.';
export const DRE_CHOICES=Object.freeze([6,24,48]);
export const DRE_DEFAULT_HOURS=6;        // délai minimal de rentrée en plein champ
export const LEGAL_WIND_KMH=19;          // 3 Beaufort : pulvérisation interdite au-delà
export const PHYTO_MENTIONS=Object.freeze([['cmr','CMR'],['abeille','Mention abeilles']]);
export const PHYTO_CATEGORIES=Object.freeze([['herbicide','Herbicide'],['fongicide','Fongicide'],['insecticide','Insecticide'],['autre','Autre'],['biocontrole','Biocontrôle']]);

const TREATMENT=/phyto|pulve|herbicide|fongicide|insecticide|desherb|traitement/;
const HARVEST=/recolte|moisson|battage|ensilage|arrachage|fauche/;
const HOUR=3600000,DAY=864e5;
const num=value=>toNullableNumber(value);
const text=value=>String(value??'').trim();
const posNum=value=>{const n=num(value);return n!==null&&n>=0?n:null;};

/** Une intervention relève-t-elle du registre phytosanitaire ? */
export function isTreatment(work){
  if(!work)return false;
  if(work.isPhytosanitary===true)return true;
  return TREATMENT.test(normalize(work.type));
}

/** Fiche phyto normalisée (champ optionnel `phyto` d'un stockItem/product ou entrée de catalogue). */
export function phytoSheet(source){
  const raw=source?.phyto&&typeof source.phyto==='object'?source.phyto:source||{};
  const usages=(Array.isArray(raw.usages)?raw.usages:[]).map(u=>({
    culture:text(u?.culture),target:text(u?.target),maxDose:posNum(u?.maxDose),doseUnit:text(u?.doseUnit),
    maxApplications:posNum(u?.maxApplications),dar:posNum(u?.dar),zntWater:posNum(u?.zntWater)
  })).filter(u=>u.culture||u.target);
  const dre=posNum(raw.dre);
  return{
    amm:text(raw.amm),name:text(raw.name||source?.name),usages,
    maxDose:posNum(raw.maxDose),doseUnit:text(raw.doseUnit),maxApplications:posNum(raw.maxApplications),
    dar:posNum(raw.dar),dre:dre,zntWater:posNum(raw.zntWater),zntResidents:posNum(raw.zntResidents),
    mentions:(Array.isArray(raw.mentions)?raw.mentions:[]).map(String).filter(Boolean),
    category:text(raw.category),refDose:posNum(raw.refDose),
    withdrawnAt:text(raw.withdrawnAt).slice(0,10),useUntil:text(raw.useUntil).slice(0,10),
    source:text(raw.source)
  };
}
export function hasPhytoData(sheet){
  const s=phytoSheet(sheet);
  return Boolean(s.amm||s.usages.length||[s.maxDose,s.maxApplications,s.dar,s.dre,s.zntWater,s.zntResidents].some(v=>v!==null)||s.mentions.length);
}

// Fusion : la fiche saisie par l'exploitant prime, le catalogue complète les vides.
function mergeSheets(primary,fallback){
  if(!fallback)return primary;if(!primary)return fallback;
  const out={...primary};
  for(const [k,v] of Object.entries(fallback))if(out[k]===null||out[k]===''||(Array.isArray(out[k])&&!out[k].length))out[k]=v;
  return out;
}

/** Fiche produit d'un traitement : stock/produits par AMM puis par nom, complétée par le catalogue. */
export function productFor(state,work,{catalog=null}={}){
  const amm=text(work?.amm),name=normalize(work?.product);
  if(!amm&&!name)return null;
  const items=[...active(state||{},'stockItems'),...active(state||{},'products')];
  const byAmm=amm?items.find(i=>text(i.phyto?.amm)===amm):null;
  const item=byAmm||(name?items.find(i=>normalize(i.name||i.nom)===name&&(i.phyto||!amm)):null)||null;
  const own=item&&hasPhytoData(item)?{...phytoSheet(item),source:'fiche'}:null;
  const entry=typeof catalog==='function'?catalog({amm:amm||own?.amm,name:work?.product}):null;
  const fromCatalog=entry?{...phytoSheet(entry),source:'catalogue'}:null;
  const frozen=work?.phytoLimits?phytoSheet(work.phytoLimits):null;
  const sheet=mergeSheets(mergeSheets(own,fromCatalog),frozen&&hasPhytoData(frozen)?frozen:null);
  if(!sheet)return item?{item,sheet:null}:null;
  return{item,sheet};
}

/** Usage (culture × cible) correspondant, sinon null. */
export function usageFor(sheet,culture,target){
  if(!sheet?.usages?.length)return null;
  const c=normalize(culture),t=normalize(target);
  const cultureMatch=u=>{const uc=normalize(u.culture);if(!uc||!c)return false;return c.includes(uc)||uc.includes(c)||uc.split(' ')[0]===c.split(' ')[0];};
  const targetMatch=u=>{const ut=normalize(u.target);return !ut||!t||ut.includes(t)||t.includes(ut);};
  return sheet.usages.find(u=>cultureMatch(u)&&targetMatch(u)&&normalize(u.target)&&t)||sheet.usages.find(u=>cultureMatch(u)&&targetMatch(u))||null;
}

/** Limites applicables : celles de l'usage, sinon celles du produit. */
export function limitsFor(sheet,work,parcel=null){
  if(!sheet)return{maxDose:null,doseUnit:'',maxApplications:null,dar:null,usage:null};
  const usage=usageFor(sheet,work?.culture||parcel?.culture,work?.target);
  return{
    maxDose:usage?.maxDose??sheet.maxDose,doseUnit:usage?.doseUnit||sheet.doseUnit,
    maxApplications:usage?.maxApplications??sheet.maxApplications,dar:usage?.dar??sheet.dar,
    zntWater:usage?.zntWater??sheet.zntWater,usage
  };
}

const sameProduct=(a,b)=>(text(a.amm)&&text(a.amm)===text(b.amm))||(normalize(a.product)&&normalize(a.product)===normalize(b.product));
const workCampaign=w=>w.campaignId||campaignFor(w.date||w.plannedDate);
const isCancelled=w=>w.status==='Annulé';

/** Applications du même produit sur la même parcelle et la même campagne (hors ce travail). */
export function previousApplications(state,work){
  const campaign=workCampaign(work);
  return active(state,'interventions').filter(w=>w.id!==work.id&&!isCancelled(w)&&w.parcelId===work.parcelId&&isTreatment(w)&&sameProduct(w,work)&&workCampaign(w)===campaign);
}

export function dayIso(ms){const d=new Date(ms);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
const clock=t=>/^\d{1,2}:\d{2}/.test(String(t||''))?String(t).slice(0,5).padStart(5,'0'):'';
/** Horodatage local d'une date ISO et d'une heure « HH:MM ». */
export function at(date,time='00:00'){const d=String(date||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return NaN;return new Date(`${d}T${clock(time)||'00:00'}:00`).getTime();}

/** Récoltes prévues ou lots de récolte de la parcelle (date ISO). */
export function harvestsFor(state,parcelId,{exceptId=null}={}){
  const works=active(state,'interventions').filter(w=>w.id!==exceptId&&w.parcelId===parcelId&&!isCancelled(w)&&HARVEST.test(normalize(w.type))).map(w=>({date:String(w.plannedDate&&!completed(w)?w.plannedDate:w.date||w.plannedDate||'').slice(0,10),label:w.type||'Récolte',kind:'travail',id:w.id}));
  const lots=(state?.integrationImports||[]).filter(r=>!r.deletedAt&&r.farmKind==='harvest'&&r.parcelId===parcelId).map(r=>({date:String(r.date||'').slice(0,10),label:`Lot ${r.code||''}`.trim(),kind:'lot',id:r.id}));
  return[...works,...lots].filter(h=>/^\d{4}-\d{2}-\d{2}$/.test(h.date));
}

const unitsCompatible=(a,b)=>!a||!b||normalize(a)===normalize(b);
const fmt=v=>formatNumber(v);

/**
 * Contrôle d'un traitement avant validation.
 * @returns {{applies:boolean, blocking:{code,message}[], warnings:{code,message}[], sheet, limits, reentryUntil:number|null}}
 */
export function checkTreatment(state,work,{catalog=null}={}){
  const out={applies:false,blocking:[],warnings:[],sheet:null,limits:null,reentryUntil:null};
  if(!work||!isTreatment(work)||isCancelled(work))return out;
  out.applies=true;
  const parcel=active(state,'parcelles').find(p=>p.id===work.parcelId)||null;
  const found=productFor(state,work,{catalog}),sheet=found?.sheet||null;
  out.sheet=sheet;
  if(!text(work.product)&&!text(work.amm))out.warnings.push({code:'product',message:'Produit non renseigné : le registre restera incomplet.'});
  else if(!sheet)out.warnings.push({code:'no-sheet',message:`Aucune fiche produit (dose maximale, DAR, DRE) : contrôles impossibles. ${LABEL_REMINDER}`});
  const limits=limitsFor(sheet,work,parcel);out.limits=limits;
  if(sheet?.usages?.length&&!limits.usage)out.warnings.push({code:'usage',message:`Aucun usage de la fiche ne correspond à « ${work.culture||parcel?.culture||'culture non renseignée'}${work.target?` × ${work.target}`:''} ». ${LABEL_REMINDER}`});
  const dose=num(work.dose);
  if(dose!==null&&limits.maxDose!==null&&unitsCompatible(work.doseUnit,limits.doseUnit)&&dose>limits.maxDose+1e-9)
    out.blocking.push({code:'dose',message:`Dose ${fmt(dose)} ${work.doseUnit||limits.doseUnit||''} supérieure à la dose maximale homologuée (${fmt(limits.maxDose)} ${limits.doseUnit||work.doseUnit||''}).`.replace(/\s+\)/,')')});
  else if(dose!==null&&limits.maxDose!==null&&!unitsCompatible(work.doseUnit,limits.doseUnit))
    out.warnings.push({code:'dose-unit',message:`Unité de dose différente de la fiche (${limits.doseUnit}) : comparaison impossible. ${LABEL_REMINDER}`});
  if(limits.maxApplications!==null){
    const count=previousApplications(state,work).length+1;
    if(count>limits.maxApplications)out.blocking.push({code:'applications',message:`${count}ᵉ application de ce produit sur la parcelle cette campagne : maximum ${fmt(limits.maxApplications)}.`});
  }
  const date=String(work.date||work.plannedDate||'').slice(0,10);
  if(limits.dar!==null&&date){
    const start=at(date),end=start+limits.dar*DAY;
    for(const h of harvestsFor(state,work.parcelId,{exceptId:work.id})){
      const t=at(h.date);
      if(t>=start&&t<end)out.blocking.push({code:'dar',message:`${h.kind==='lot'?'Lot de récolte':'Récolte prévue'} le ${localDate(h.date)} (${h.label}) dans le délai avant récolte de ${fmt(limits.dar)} jours.`});
    }
  }
  if(sheet?.useUntil&&date&&date>sheet.useUntil)out.blocking.push({code:'withdrawn',message:withdrawalLabel(sheet)});
  else if(sheet?.withdrawnAt)out.warnings.push({code:'withdrawn',message:withdrawalLabel(sheet)});
  const wind=num(work.weatherSnapshot?.window?.windMax??work.weatherSnapshot?.wind);
  if(wind!==null&&wind>LEGAL_WIND_KMH)out.warnings.push({code:'wind',message:`Vent relevé ${fmt(wind)} km/h : au-delà de ${LEGAL_WIND_KMH} km/h (3 Beaufort), la pulvérisation est interdite.`});
  if(sheet?.mentions?.includes('cmr'))out.warnings.push({code:'cmr',message:'Produit CMR : équipements de protection et délai de rentrée renforcés. '+LABEL_REMINDER});
  const missing=[];if(!text(work.target))missing.push('cible');if(!clock(work.startTime))missing.push('heure de début');if(!clock(work.endTime))missing.push('heure de fin');
  if(missing.length)out.warnings.push({code:'incomplete',message:`À compléter pour le registre : ${missing.join(', ')}.`});
  out.reentryUntil=reentryUntil(work,sheet);
  return out;
}

/** Délai de rentrée (heures) : fiche, sinon minimum réglementaire de 6 h. */
export function reentryHours(sheet){return sheet?.dre&&sheet.dre>0?sheet.dre:DRE_DEFAULT_HOURS;}
/** Fin du délai de rentrée (ms) : fin du traitement (ou début, ou midi) + DRE. */
export function reentryUntil(work,sheet){
  const date=String(work?.date||'').slice(0,10);
  const base=at(date,clock(work?.endTime)||clock(work?.startTime)||'12:00');
  return Number.isFinite(base)?base+reentryHours(sheet)*HOUR:null;
}

const SAME_DAY=(a,b)=>dayIso(a)===dayIso(b);
/** « Accès interdit jusqu'à 18 h », « … jusqu'à demain 9 h 30 », « … jusqu'au 12/10 à 9 h ». */
export function reentryLabel(until,now=Date.now()){
  const d=new Date(until),h=d.getHours(),m=d.getMinutes(),hh=m?`${h} h ${String(m).padStart(2,'0')}`:`${h} h`;
  if(SAME_DAY(until,now))return`Accès interdit jusqu’à ${hh}`;
  if(SAME_DAY(until,now+DAY))return`Accès interdit jusqu’à demain ${hh}`;
  return`Accès interdit jusqu’au ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} à ${hh}`;
}

/** Parcelles en délai de rentrée : Map parcelId → {until, work, label}. Traitements terminés ou en cours. */
export function activeReentries(state,{now=Date.now(),catalog=null}={}){
  const map=new Map();
  for(const w of active(state||{},'interventions')){
    if(!isTreatment(w)||!(completed(w)||w.status==='En cours')||isCancelled(w))continue;
    const date=String(w.date||'').slice(0,10);if(!date||at(date)>now+DAY)continue;
    const until=reentryUntil(w,productFor(state,w,{catalog})?.sheet||null);
    if(until===null||until<=now)continue;
    const prev=map.get(w.parcelId);
    if(!prev||until>prev.until)map.set(w.parcelId,{until,work:w,label:reentryLabel(until,now)});
  }
  return map;
}

/** Alerte pour une mise au pâturage pendant un délai de rentrée, ou null. */
export function grazingReentryConflict(state,parcelId,startDate,{now=Date.now(),catalog=null}={}){
  const day=String(startDate||'').slice(0,10);if(!parcelId||!day)return null;
  const startMs=day===dayIso(now)?now:at(day);
  let worst=null;
  for(const w of active(state||{},'interventions')){
    if(w.parcelId!==parcelId||!isTreatment(w)||isCancelled(w)||!(completed(w)||w.status==='En cours'))continue;
    const date=String(w.date||'').slice(0,10);if(!date||at(date)>startMs)continue;
    const until=reentryUntil(w,productFor(state,w,{catalog})?.sheet||null);
    if(until!==null&&until>startMs&&(!worst||until>worst.until))worst={until,work:w};
  }
  if(!worst)return null;
  return{...worst,message:`${reentryLabel(worst.until,now)} : traitement « ${worst.work.product||worst.work.type||'phytosanitaire'} » du ${localDate(worst.work.date)} (délai de rentrée). Mise au pâturage déconseillée avant cette heure. ${LABEL_REMINDER}`};
}

/** Instantané des limites retenues, enregistré sur le travail au moment de la validation. */
export function limitsSnapshot(result,now=Date.now()){
  const s=result?.sheet,l=result?.limits;if(!s)return null;
  return{amm:s.amm||'',maxDose:l?.maxDose??null,doseUnit:l?.doseUnit||'',maxApplications:l?.maxApplications??null,dar:l?.dar??null,dre:s.dre,zntWater:l?.zntWater??s.zntWater,zntResidents:s.zntResidents,mentions:s.mentions||[],category:s.category||'',source:s.source||'fiche',checkedAt:now};
}

export function withdrawalLabel(sheet){
  const w=sheet?.withdrawnAt,u=sheet?.useUntil;
  if(!w&&!u)return'';
  return`AMM retirée${w?` le ${localDate(w)}`:''}${u?` : utilisation interdite après le ${localDate(u)}`:''}.`;
}

// --- Registre ---------------------------------------------------------------------------------

export const REGISTER_REQUIRED=['Parcelle','Culture','Date','Produit','AMM','Dose','Unité','Surface traitée','Cible','Heure de début','Opérateur'];
export const REGISTER_COLUMNS=['Date','Début','Fin','Parcelle','Surface traitée (ha)','Culture','Stade','Cible','Produit','AMM','Dose','Unité','DAR (j)','DRE (h)','Vent (km/h)','Température (°C)','Hygrométrie (%)','Opérateur','Matériel','Dérogation','Complet','Manquants'];

const round1=v=>v===null||v===undefined||v===''?'':Math.round(Number(v)*10)/10;
function weatherCells(snapshot){
  const w=snapshot?.window;
  if(w)return{wind:w.windMax,temperature:w.tempMin===w.tempMax?w.tempMax:`${round1(w.tempMin)}–${round1(w.tempMax)}`,humidity:w.humidityMin===w.humidityMax?w.humidityMin:`${round1(w.humidityMin)}–${round1(w.humidityMax)}`,origin:'fenêtre'};
  return{wind:snapshot?.wind,temperature:snapshot?.temperature,humidity:snapshot?.humidity,origin:snapshot?'relevé':''};
}

/** Lignes du registre pour une campagne (traitements terminés). */
export function registerRows(state,campaign,{catalog=null}={}){
  const parcels=new Map(active(state||{},'parcelles').map(p=>[p.id,p])),machines=new Map(active(state||{},'materiels').map(m=>[m.id,m]));
  return active(state||{},'interventions').filter(w=>isTreatment(w)&&completed(w)&&workCampaign(w)===campaign)
    .sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.startTime||'').localeCompare(String(b.startTime||'')))
    .map(w=>{
      const parcel=parcels.get(w.parcelId),sheet=productFor(state,w,{catalog})?.sheet||null,limits=limitsFor(sheet,w,parcel),weather=weatherCells(w.weatherSnapshot);
      const fields={Parcelle:parcel?.nom,Culture:w.culture||parcel?.culture,Date:w.date,Produit:w.product,AMM:w.amm||sheet?.amm,Dose:num(w.dose),Unité:w.doseUnit,'Surface traitée':num(w.surfaceWorked),Cible:w.target,'Heure de début':clock(w.startTime),Opérateur:w.operator};
      const missing=REGISTER_REQUIRED.filter(k=>fields[k]===null||fields[k]===undefined||fields[k]==='');
      return{work:w,parcel,sheet,missing,complete:!missing.length,cells:{
        'Date':w.date||'','Début':clock(w.startTime),'Fin':clock(w.endTime),'Parcelle':parcel?.nom||'','Surface traitée (ha)':num(w.surfaceWorked)??'','Culture':fields.Culture||'','Stade':w.stage||'','Cible':w.target||'',
        'Produit':w.product||'','AMM':fields.AMM||'','Dose':num(w.dose)??(w.dose||''),'Unité':w.doseUnit||'','DAR (j)':limits.dar??'','DRE (h)':sheet?.dre??'',
        'Vent (km/h)':round1(weather.wind),'Température (°C)':typeof weather.temperature==='string'?weather.temperature:round1(weather.temperature),'Hygrométrie (%)':typeof weather.humidity==='string'?weather.humidity:round1(weather.humidity),
        'Opérateur':w.operator||'','Matériel':machines.get(w.equipmentId)?.nom||'','Dérogation':w.phytoOverride?.reason||'','Complet':missing.length?'incomplet':'complet','Manquants':missing.join(', ')
      }};
    });
}

/** Campagnes ayant au moins un traitement, de la plus récente à la plus ancienne. */
export function registerCampaigns(state,today=Date.now()){
  const set=new Set([campaignFor(today)]);
  for(const w of active(state||{},'interventions'))if(isTreatment(w))set.add(workCampaign(w));
  return[...set].filter(Boolean).sort().reverse();
}

export function registerCsv(rows){
  const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  return'﻿'+[REGISTER_COLUMNS,...rows.map(r=>REGISTER_COLUMNS.map(c=>r.cells[c]))].map(row=>row.map(cell).join(';')).join('\r\n');
}

/** Registre imprimable (PDF via « Imprimer / PDF »). */
export function registerHtml(state,campaign,{catalog=null,today=Date.now(),assetBase=''}={}){
  const rows=registerRows(state,campaign,{catalog}),complete=rows.filter(r=>r.complete).length;
  const e=escapeHtml,farm=state?.exploitation?.nom||'Exploitation';
  const cols=['Date','Début','Fin','Parcelle','Surface traitée (ha)','Culture','Stade','Cible','Produit','AMM','Dose','Unité','DAR (j)','DRE (h)','Vent (km/h)','Température (°C)','Hygrométrie (%)','Opérateur','Complet'];
  const body=`<main class="page"><div class="dz-body"><h1>Registre phytosanitaire</h1><p class="muted">${e(farm)} · campagne ${e(campaign)} · édité le ${localDate(today)}</p>
  <p><strong>${rows.length}</strong> traitement${rows.length>1?'s':''} · <strong>${complete}</strong> complet${complete>1?'s':''} · <strong>${rows.length-complete}</strong> incomplet${rows.length-complete>1?'s':''}</p>
  <table class="phyto-register"><thead><tr>${cols.map(c=>`<th>${e(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>c==='Date'?`<td>${e(localDate(r.cells.Date))}</td>`:c==='Complet'?`<td>${r.complete?'complet':`incomplet<br><small>${e(r.cells.Manquants)}</small>`}</td>`:`<td>${e(String(r.cells[c]).replace(/(\d)\.(\d)/g,'$1,$2'))}</td>`).join('')}</tr>${r.cells.Dérogation?`<tr><td colspan="${cols.length}"><small>Dérogation motivée : ${e(r.cells.Dérogation)}</small></td></tr>`:''}`).join('')||`<tr><td colspan="${cols.length}">Aucun traitement terminé pour cette campagne.</td></tr>`}</tbody></table>
  <p class="muted"><small>${e(PHYTO_DISCLAIMER)} Vent, température et hygrométrie : valeurs de la fenêtre de traitement si elle est connue, sinon relevé au moment de la saisie (prévision météo, pas une mesure sur la parcelle).</small></p></div></main>`;
  return printDocument({title:`Registre phytosanitaire ${campaign}`,css:printCss({assetBase,footer:`Registre phytosanitaire ${campaign}`,cover:false})+'@page{size:A4 landscape}.phyto-register{font-size:7.5pt;width:100%;border-collapse:collapse}.phyto-register th,.phyto-register td{border:1px solid #ccc;padding:3px 4px;vertical-align:top}',body});
}

/** Entrée du tableau « Prêt pour un contrôle ? » (compliance.js). */
export function phytoComplianceCheck(state,{today=Date.now(),catalog=null}={}){
  const campaign=campaignFor(today),label='Contrôles des traitements (dose, DAR, DRE)';
  const base={id:'phyto-controls',label,hint:LABEL_REMINDER,action:{type:'phytoRegister',label:'Registre phyto'}};
  const works=active(state||{},'interventions').filter(w=>isTreatment(w)&&completed(w)&&workCampaign(w)===campaign);
  if(!works.length)return{...base,status:'na',detail:`Aucun traitement terminé pour la campagne ${campaign}.`,items:[]};
  const items=[];let ko=0,warn=0,unknown=0;
  for(const w of works){
    const r=checkTreatment(state,w,{catalog}),where=`${localDate(w.date)} · ${active(state,'parcelles').find(p=>p.id===w.parcelId)?.nom||'Parcelle inconnue'} · ${w.product||w.type||'Traitement'}`;
    if(r.blocking.length&&!w.phytoOverride?.reason){ko++;items.push({label:where,note:r.blocking.map(b=>b.message).join(' '),action:'edit-work',id:w.id});}
    else if(r.blocking.length){warn++;items.push({label:where,note:`Dérogation motivée : ${w.phytoOverride.reason}`,action:'edit-work',id:w.id});}
    else if(!r.sheet){unknown++;items.push({label:where,note:'Fiche produit absente : dose, DAR et DRE non contrôlés.',action:'edit-work',id:w.id});}
  }
  const status=ko?'ko':warn?'warn':unknown?'unknown':'ok';
  const detail=ko?`${ko} traitement${ko>1?'s':''} hors limites de la fiche produit, sans motif.`:warn?`${warn} dépassement${warn>1?'s':''} avec dérogation motivée.`:unknown?`${unknown} traitement${unknown>1?'s':''} sans fiche produit sur ${works.length}.`:`${works.length} traitement${works.length>1?'s':''} conforme${works.length>1?'s':''} aux fiches saisies.`;
  return{...base,status,detail,items};
}
