// n° 87 et n° 69 — Coût réel du matériel à l'heure et à l'hectare, comparé au tarif saisi et à un
// barème d'entraide / CUMA saisi par l'exploitant (millésime et source cités, aucune valeur inventée).
// Logique pure. Coût complet de la campagne = amortissement + assurance + entretiens + carburant,
// divisé par les heures et les hectares tirés des travaux. Les heures non saisies faussent le €/h :
// le taux de complétude est toujours rendu. Réglages dans preferences.machineRates.
import {campaignFor,normalize} from './utils.js';
import {active,completed} from './farm-memory.js';
import {workArea,workCampaign} from './costs.js';
import {machineFills,averagePrice} from './fuel.js';

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const pos=v=>{const n=num(v);return n!==null&&n>0?n:null;};
const r2=v=>Math.round(v*100)/100;
export const UNDERUSE_HOURS=50;

// Catégories du barème : libellé, unité usuelle et motif de reconnaissance sur le nom de l'engin.
// Les montants restent vides : l'exploitant reporte ceux de son barème régional (BCMA, entraide, CUMA).
export const RATE_CATEGORIES=Object.freeze([
  {key:'tracteur',label:'Tracteur',unit:'h',match:/tracteur|\bjd\b|fendt|massey|claas arion|new holland t|valtra|deutz|case ih|kubota m/},
  {key:'moissonneuse',label:'Moissonneuse-batteuse',unit:'ha',match:/moissonn|batteuse/},
  {key:'ensileuse',label:'Ensileuse',unit:'h',match:/ensileuse/},
  {key:'pulverisateur',label:'Pulvérisateur',unit:'ha',match:/pulve|pulvé|automoteur/},
  {key:'semoir',label:'Semoir',unit:'ha',match:/semoir|monograine/},
  {key:'dechaumeur',label:'Déchaumeur / cultivateur',unit:'ha',match:/dechaum|déchaum|disque|cultivateur|chisel|vibro|scalpeur/},
  {key:'charrue',label:'Charrue',unit:'ha',match:/charrue/},
  {key:'herse',label:'Herse rotative / combiné',unit:'ha',match:/herse|combine de semis|combiné/},
  {key:'epandeur',label:'Épandeur / tonne à lisier',unit:'h',match:/epandeur|épandeur|tonne a lisier|tonne à lisier|distributeur d.engrais/},
  {key:'fauche',label:'Faucheuse / faneuse / andaineur',unit:'ha',match:/fauche|faneuse|andain|conditionneuse/},
  {key:'presse',label:'Presse',unit:'h',match:/presse|enrubann/},
  {key:'remorque',label:'Remorque / benne',unit:'h',match:/remorque|benne|plateau/},
  {key:'chargeur',label:'Chargeur / télescopique',unit:'h',match:/telescop|télescop|chargeur|manitou/},
  {key:'autre',label:'Autre matériel',unit:'h',match:null}
]);
export const categoryLabel=key=>RATE_CATEGORIES.find(c=>c.key===key)?.label||'Autre matériel';

export const RATES_NOTE='Barème indicatif saisi par vous (BCMA, entraide ou CUMA de votre région) : les références diffèrent selon les régions, citez le millésime et la source.';

/** Catégorie devinée d'après le nom, la marque et le modèle de l'engin. */
export function guessCategory(machine){
  const text=normalize(`${machine?.nom||''} ${machine?.brand||''} ${machine?.model||''} ${machine?.type||''}`);
  return RATE_CATEGORIES.find(c=>c.match&&c.match.test(text))?.key||'autre';
}

/** Barème de l'exploitant (préférences). Valeur absente = null, jamais 0. */
export function machineRates(state){
  const p=state?.preferences?.machineRates||{},values={};
  for(const c of RATE_CATEGORIES){const v=p.values?.[c.key]||{};values[c.key]={value:pos(v.value),unit:v.unit==='ha'||v.unit==='h'?v.unit:c.unit};}
  return{year:Number(p.year)||null,source:String(p.source||''),updatedAt:p.updatedAt||null,values,assign:{...(p.assign||{})},underuseHours:pos(p.underuseHours)??UNDERUSE_HOURS};
}

export function validateRates(v){
  const year=String(v?.year??'').trim()===''?null:Number(v.year);
  if(year!==null&&(!Number.isInteger(year)||year<2000||year>2100))return{error:'Millésime du barème invalide.'};
  const values={};
  for(const c of RATE_CATEGORIES){
    const raw=v?.[`rate_${c.key}`],value=num(raw),unit=v?.[`unit_${c.key}`]==='ha'?'ha':v?.[`unit_${c.key}`]==='h'?'h':c.unit;
    if(String(raw??'').trim()!==''&&(value===null||value<0||value>5000))return{error:`Montant invalide pour « ${c.label} » (0 à 5 000 €).`};
    values[c.key]={value:value!==null&&value>0?value:null,unit};
  }
  const under=num(v?.underuseHours);if(String(v?.underuseHours??'').trim()!==''&&(under===null||under<1||under>2000))return{error:'Seuil de sous-utilisation invalide (1 à 2 000 h).'};
  return{value:{year,source:String(v?.source||'').trim(),values,underuseHours:under}};
}

const workHours=w=>pos(w?.resourceEffects?.hours)??pos(w?.duration??w?.durationHours);
const usesMachine=(w,id)=>w.equipmentId===id||w.machineId===id||w.resourceEffects?.machineId===id;
const inCampaign=(date,campaign)=>Boolean(date)&&campaignFor(date)===campaign;

/** Coût réel d'un engin sur une campagne. */
export function machineCost(state,machine,{campaign=campaignFor(),rates=machineRates(state),fuelPrice=pos(state?.preferences?.fuelPrice)}={}){
  const id=machine.id;
  const works=active(state,'interventions').filter(w=>usesMachine(w,id)&&completed(w)&&w.status!=='Annulé'&&workCampaign(w)===campaign);
  const tp=active(state,'chantiers').filter(c=>c.kind==='tp').flatMap(c=>(c.tpLogs||[]).filter(l=>!l.deletedAt&&l.equipmentId===id&&inCampaign(l.date,campaign)));
  let hours=0,withHours=0,hectares=0,withArea=0;
  for(const w of works){const h=workHours(w);if(h!==null){hours+=h;withHours+=1;}const a=workArea(state,w);if(a!==null){hectares+=a;withArea+=1;}}
  for(const l of tp){const h=pos(l.hours);if(h!==null){hours+=h;withHours+=1;}}
  const entries=works.length+tp.length,completeness=entries?Math.round(withHours/entries*100):null;
  const amortization=pos(machine.amortization),insurance=pos(machine.insurance);
  const maintenanceRows=active(state,'maintenanceRecords').filter(r=>r.equipmentId===id&&inCampaign(r.date,campaign));
  const maintenance=maintenanceRows.reduce((s,r)=>s+(pos(r.cost)||0),0);
  // Carburant : pleins de l'engin (n° 95), sinon carburant des travaux, sinon estimation l/h × heures.
  const fills=machineFills(state,id).filter(r=>inCampaign(r.date,campaign)),avg=averagePrice(state);
  let fuel=null,fuelSource=null,fuelLitres=null;
  if(fills.length){fuelLitres=fills.reduce((s,r)=>s+(pos(r.litres)||0),0);const priced=fills.map(r=>pos(r.amount)??(pos(r.litres)!==null&&(pos(r.unitPrice)??avg??fuelPrice)!==null?pos(r.litres)*(pos(r.unitPrice)??avg??fuelPrice):null));if(priced.some(v=>v!==null)){fuel=priced.reduce((s,v)=>s+(v||0),0);fuelSource='pleins';}}
  if(fuel===null){const parts=works.map(w=>pos(w.fuelCost)??(pos(w.fuel)!==null&&fuelPrice!==null?pos(w.fuel)*fuelPrice:null)).filter(v=>v!==null);if(parts.length){fuel=parts.reduce((s,v)=>s+v,0);fuelSource='travaux';}}
  if(fuel===null&&pos(machine.actualFuel)!==null&&hours>0&&(avg??fuelPrice)!==null){fuelLitres=pos(machine.actualFuel)*hours;fuel=fuelLitres*(avg??fuelPrice);fuelSource='estimé';}
  const fixed=(amortization||0)+(insurance||0),total=fixed+maintenance+(fuel||0);
  const perHour=hours>0&&total>0?r2(total/hours):null,perHa=hectares>0&&total>0?r2(total/hectares):null;
  const entered=pos(machine.hourlyCost),gapPct=perHour!==null&&entered!==null?Math.round((perHour/entered-1)*100):null;
  const category=rates.assign[id]&&RATE_CATEGORIES.some(c=>c.key===rates.assign[id])?rates.assign[id]:guessCategory(machine);
  const ref=rates.values[category]||{value:null,unit:'h'},refValue=ref.value,refUnit=ref.unit;
  const compared=refValue===null?null:refUnit==='ha'?perHa:perHour,refGapPct=compared!==null?Math.round((compared/refValue-1)*100):null;
  const meter=num(machine.currentMeter),due=num(machine.maintenanceDue),remaining=meter!==null&&due!==null?r2(due-meter):null;
  const missing=[];if(amortization===null)missing.push('amortissement');if(insurance===null)missing.push('assurance');if(fuel===null)missing.push('carburant');if(!entries)missing.push('travaux');else if(withHours<entries)missing.push(`${entries-withHours} travail(aux) sans heures`);
  const underused=hours>0&&hours<rates.underuseHours&&perHour!==null;
  return{machine,id,name:machine.nom||'Matériel',campaign,hours:r2(hours),hectares:r2(hectares),entries,withHours,withArea,completeness,
    amortization,insurance,maintenance:r2(maintenance),maintenanceCount:maintenanceRows.length,fuel:fuel===null?null:r2(fuel),fuelSource,fuelLitres:fuelLitres===null?null:r2(fuelLitres),
    fixed:r2(fixed),total:r2(total),perHour,perHa,entered,gapPct,category,refValue,refUnit,refGapPct,remaining,underused,missing,
    estimated:fuelSource==='estimé',reliable:completeness!==null&&completeness>=80&&amortization!==null};
}

export function machineCosts(state,{campaign=campaignFor()}={}){
  const rates=machineRates(state),fuelPrice=pos(state?.preferences?.fuelPrice);
  const rows=active(state,'materiels').map(m=>machineCost(state,m,{campaign,rates,fuelPrice})).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'fr'));
  return{campaign,rates,rows,alerts:rows.filter(r=>r.underused),updateable:rows.filter(r=>r.perHour!==null&&(r.entered===null||Math.abs(r.gapPct)>=10))};
}

/** Texte d'alerte de sous-utilisation, avec la comparaison au barème quand elle est possible. */
export function underuseText(r){
  const fr=v=>Number(v).toLocaleString('fr-FR',{maximumFractionDigits:0});
  let t=`${r.name} : ${fr(r.hours)} h sur la campagne, coût réel ${fr(r.perHour)} €/h`;
  if(r.refValue!==null)t+=r.refUnit==='ha'?`${r.perHa!==null?` (${fr(r.perHa)} €/ha)`:''} ; une ETA ou l’entraide facturerait environ ${fr(r.refValue)} €/ha selon votre barème`:` ; votre barème indique environ ${fr(r.refValue)} €/h`;
  return`${t}.`;
}

/** Couleur de l'écart au barème : vert si moins cher, orange jusqu'à +20 %, rouge au-delà. */
export function gapTone(pct){return pct===null||pct===undefined?'':pct<=0?'is-good':pct<=20?'is-warn':'is-bad';}

/** Correctif « coût horaire saisi » : ne réécrit que hourlyCost, avec la trace de la valeur réelle. */
export function hourlyCostPatch(machine,row,at=Date.now()){
  if(row.perHour===null)throw Error('Coût réel inconnu : renseignez les heures des travaux.');
  return{...machine,hourlyCost:row.perHour,hourlyCostSource:{value:row.perHour,campaign:row.campaign,previous:pos(machine.hourlyCost),at}};
}
