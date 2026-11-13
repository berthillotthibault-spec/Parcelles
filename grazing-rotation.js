// @ts-check
// Conseiller de rotation du pâturage (W6) : pression du lot (UGB.j/ha), jours d'herbe restants, prochain paddock reposé.
// Logique pure : aucune lecture DOM, aucun réseau ; la date du jour est passée en option.
import {localIso} from './utils.js';
import {filterGrazingSessions,grazingContinuousStart,grazingDate,grazingType,isForageParcel,stockingRate,ugbOf,ugbTable} from './grazing.js';

const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'||typeof value==='number'?String(value).trim():'';
const num=value=>{if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(String(value).replace(',','.'));return Number.isFinite(n)?n:null;};
const dayMs=day=>Date.parse(`${day}T12:00:00Z`);
const daysBetween=(from,to)=>Math.round((dayMs(to)-dayMs(from))/86400000);
const half=value=>Math.round(value*2)/2;
const fr=(value,digits=1)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:digits}).format(value);

/** Repos jamais descendu sous ce seuil : un paddock pâturé il y a moins de 15 jours n'est jamais proposé. */
export const MIN_REST_DAYS=15;
/** Seuil d'alerte : 80 % de la pression maximale, ou sortie à prévoir sous 4 jours. */
export const WARNING_RATIO=0.8;
export const WARNING_DAYS=4;
/** Un candidat doit offrir au moins 5 jours d'herbe au lot pour passer devant les autres. */
export const GOOD_GRASS_DAYS=5;
const SEASON_REST={printemps:21,ete:35,automne:30,hiver:45};

/**
 * Repos conseillé selon la saison : printemps 21 j, été 35 j, automne 30 j, hiver 45 j.
 * preferences.grazingRestDays (si renseigné) remplace la valeur de saison.
 * @param {Date|string} [date] @param {{preferences?:any}|null} [state]
 */
export function seasonRestTarget(date=new Date(),state=null){
  const custom=num(state?.preferences?.grazingRestDays);
  if(custom!==null&&custom>0)return custom;
  const day=grazingDate(date)||localIso();
  const month=Number(day.slice(5,7));
  if(month>=3&&month<=5)return SEASON_REST.printemps;
  if(month>=6&&month<=8)return SEASON_REST.ete;
  if(month>=9&&month<=11)return SEASON_REST.automne;
  return SEASON_REST.hiver;
}

const surfaceOf=parcel=>{const s=num(parcel?.surfaceHa);return s!==null&&s>0?s:null;};

/**
 * Pression d'un lot sur son paddock : UGB × jours de présence continue / surface.
 * @returns {{ugb:number, days:number, pressure:number|null}}
 */
export function grazingPressure(session,parcel,{today=localIso(),table=ugbTable(null),sessions=null}={}){
  const ugb=ugbOf(session,table).ugb;
  const start=grazingContinuousStart(sessions||[session],session);
  const days=start?Math.max(0,daysBetween(start,grazingDate(today)||today)):0;
  const surface=surfaceOf(parcel);
  return{ugb,days,pressure:surface?Math.round(ugb*days/surface*100)/100:null};
}

// Centroïde approximatif (moyenne des sommets) d'une géométrie GeoJSON, en [lon, lat].
function centroid(geometry){
  const g=isRecord(geometry)&&isRecord(geometry.geometry)?geometry.geometry:geometry;
  if(!isRecord(g))return null;
  let coords=g.coordinates;
  if(typeof coords==='string'){try{coords=JSON.parse(coords);}catch{return null;}}
  const points=[];
  const walk=value=>{if(!Array.isArray(value))return;if(value.length>=2&&typeof value[0]==='number'&&typeof value[1]==='number'){points.push(value);return;}value.forEach(walk);};
  walk(coords);
  if(!points.length)return null;
  const lon=points.reduce((s,p)=>s+p[0],0)/points.length,lat=points.reduce((s,p)=>s+p[1],0)/points.length;
  return Number.isFinite(lon)&&Number.isFinite(lat)?[lon,lat]:null;
}
function haversineKm(a,b){
  if(!a||!b)return null;
  const rad=x=>x*Math.PI/180,dLat=rad(b[1]-a[1]),dLon=rad(b[0]-a[0]);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dLon/2)**2;
  return 6371*2*Math.asin(Math.min(1,Math.sqrt(h)));
}

// Le maïs ou le sorgho fourrage ne se pâturent pas, même si leur culture contient « fourrage ».
const NOT_GRAZED=/\b(mais|sorgho)\b/;
const plain=value=>text(value).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

/** Paddocks libres et reposés : prairie, sans lot en cours, repos >= cible (jamais moins de 15 j). */
function restedPaddocks(state,{today,target}){
  const sessions=(state?.grazingSessions||[]).filter(s=>isRecord(s)&&!s.deletedAt);
  const occupied=new Set(filterGrazingSessions(sessions,{status:'current',date:today}).map(s=>s.parcelId));
  return (state?.parcelles||[]).filter(p=>isRecord(p)&&!p.deletedAt&&!p.archived&&p.id&&!occupied.has(p.id)&&isForageParcel(p,sessions)&&!NOT_GRAZED.test(plain(p.culture))).flatMap(parcel=>{
    const rate=stockingRate(state,parcel.id,{date:today});
    // Jamais pâturée (aucune sortie enregistrée) : considérée comme reposée.
    const restDays=rate.restDays;
    if(restDays!==null&&(restDays<MIN_REST_DAYS||restDays<target))return [];
    return [{parcel,restDays,surfaceHa:surfaceOf(parcel),center:centroid(parcel.geometry)}];
  });
}

/** Vrai quand aucun paddock libre n'a atteint son temps de repos. */
export function noRestedPaddock(state,{today=localIso(),restTargetDays=null}={}){
  const target=num(restTargetDays)??seasonRestTarget(today,state);
  return restedPaddocks(state,{today,target}).length===0;
}

const lotName=session=>text(session?.note)||grazingType(session).toLocaleLowerCase('fr');
const restText=restDays=>restDays===null?'jamais pâturée':`reposée depuis ${restDays} j`;

/** Jours que le lot peut tenir sur une surface donnée avant d'atteindre la pression maximale, repousse comprise. */
function grassDays({pressure,pressureMax,surface,ugb,growth,intake}){
  if(!(ugb>0)||!(surface>0))return{days:null,coveredByGrowth:false};
  const base=Math.max(0,(pressureMax-pressure)*surface/ugb);
  if(growth===null)return{days:half(base),coveredByGrowth:false};
  // Seuil déjà atteint : sortie due, même si la repousse estimée couvrirait la consommation.
  if(base<=0)return{days:0,coveredByGrowth:false};
  const regrowth=growth*surface/(ugb*intake);// jours d'herbe rendus par jour de pâturage
  if(regrowth>=1)return{days:null,coveredByGrowth:true};
  return{days:half(base/(1-regrowth)),coveredByGrowth:false};
}

/**
 * Conseil de rotation pour chaque lot au pré.
 * @param {any} state
 * growthNote / growthEstimated : pousse estimée (grass-growth.js) et non mesurée : explication ajoutée, confiance « moyenne » au plus.
 * @param {{today?:string, growthKgMsHaDay?:number|null, growthNote?:string, growthEstimated?:boolean, intakeKgMsUgbDay?:number, pressureMax?:number, restTargetDays?:number|null}} [options]
 */
export function grazingRotationAdvice(state,{today=localIso(),growthKgMsHaDay=null,growthNote='',growthEstimated=false,intakeKgMsUgbDay=15,pressureMax=Number(state?.preferences?.grazingPressureMax)||100,restTargetDays=null}={}){
  const day=grazingDate(today)||localIso();
  const sessions=(state?.grazingSessions||[]).filter(s=>isRecord(s)&&!s.deletedAt);
  const current=filterGrazingSessions(sessions,{status:'current',date:day});
  if(!current.length)return [];
  const table=ugbTable(state),rawGrowth=num(growthKgMsHaDay),growth=rawGrowth===null?null:Math.max(0,rawGrowth),rawIntake=num(intakeKgMsUgbDay),intake=rawIntake!==null&&rawIntake>0?rawIntake:15;
  // Seuil nul, négatif ou illisible : 100 UGB.j/ha (sinon tous les lots seraient « à sortir »).
  const rawMax=Number(pressureMax),max=Number.isFinite(rawMax)&&rawMax>0?rawMax:100;
  const target=num(restTargetDays)??seasonRestTarget(day,state);
  const parcels=new Map((state?.parcelles||[]).filter(p=>isRecord(p)&&!p.deletedAt).map(p=>[p.id,p]));
  const paddocks=restedPaddocks(state,{today:day,target});

  // Plusieurs lots sur le même pré : l'herbe est partagée, la pression et les jours restants se calculent pour la parcelle entière.
  const sharing=new Map();
  for(const s of current){const list=sharing.get(s.parcelId)||[];list.push(s);sharing.set(s.parcelId,list);}
  const entries=current.map(session=>{
    const parcel=parcels.get(session.parcelId)||null,parcelName=text(parcel?.nom)||'Parcelle';
    const u=ugbOf(session,table),own=grazingPressure(session,parcel,{today:day,table,sessions});
    const {ugb,days}=own,others=(sharing.get(session.parcelId)||[]).filter(s=>s!==session);
    const otherRows=others.map(s=>({u:ugbOf(s,table),p:grazingPressure(s,parcel,{today:day,table,sessions})}));
    const pressure=own.pressure===null?null:Math.round((ugb*days+otherRows.reduce((sum,o)=>sum+o.p.ugb*o.p.days,0))/surfaceOf(parcel)*100)/100;
    const totalUgb=ugb+otherRows.reduce((sum,o)=>sum+o.p.ugb,0),allKnown=u.known&&otherRows.every(o=>o.u.known);
    const surface=surfaceOf(parcel),why=[];
    const base={lotId:session.id,sessionId:session.id,parcelId:session.parcelId,parcelName,ugb,days,pressure,pressureMax:max,daysLeft:/** @type {number|null} */(null),level:/** @type {'urgent'|'warning'|'info'|null} */(null),confidence:/** @type {'haute'|'moyenne'|'basse'} */(allKnown?(growth===null||growthEstimated?'moyenne':'haute'):'basse'),next:/** @type {any[]} */([]),why,_session:session,_surface:surface,_center:centroid(parcel?.geometry)};
    if(!u.known&&u.heads)why.push('Catégorie d’animaux non renseignée : 1 UGB par animal, conseil indicatif.');
    else if(!allKnown)why.push('Catégorie d’un autre lot du pré non renseignée : 1 UGB par animal, conseil indicatif.');
    if(!surface||pressure===null){why.unshift(`Surface inconnue pour ${parcelName} : pression non calculée.`);return base;}
    if(!(ugb>0)){why.unshift(`Effectif inconnu pour le lot sur ${parcelName}.`);return base;}
    const left=grassDays({pressure,pressureMax:max,surface,ugb:totalUgb,growth,intake});
    base.daysLeft=left.days;
    const ratio=pressure/max;
    let level=/** @type {'urgent'|'warning'|'info'} */('info');
    if(ratio>=1)level='urgent';
    else if(ratio>=WARNING_RATIO||(left.days!==null&&left.days<=WARNING_DAYS))level='warning';
    // Catégorie inconnue : UGB incertaines, jamais d'urgence.
    if(level==='urgent'&&!allKnown)level='warning';
    base.level=level;
    const exit=left.coveredByGrowth?'La repousse couvre la consommation du lot'
      :left.days===0?'Sortie conseillée dès aujourd’hui'
      :`Sortie conseillée d’ici ${fr(left.days)} jour${left.days>1?'s':''}`;
    why.unshift(`Lot ${lotName(session)} (${fr(ugb)} UGB) sur ${parcelName} (${fr(surface)} ha) depuis ${days} j${others.length?`, avec ${others.length} autre${others.length>1?'s':''} lot${others.length>1?'s':''} (${fr(totalUgb)} UGB au total)`:''} : ${fr(pressure,0)} UGB.j/ha, seuil ${fr(max,0)}. ${exit}`);
    if(growth!==null&&text(growthNote))why.push(text(growthNote));
    return base;
  });

  // Les lots les plus pressés choisissent en premier ; deux lots n'ont jamais le même premier choix.
  const urgency=e=>e.daysLeft===null?(e.level?1e6:2e6):e.daysLeft;
  const order=[...entries].sort((a,b)=>urgency(a)-urgency(b));
  const taken=new Set();
  for(const entry of order){
    if(!(entry.ugb>0))continue;
    const ranked=paddocks.filter(p=>p.parcel.id!==entry.parcelId).map(p=>{
      const g=p.surfaceHa?grassDays({pressure:0,pressureMax:max,surface:p.surfaceHa,ugb:entry.ugb,growth,intake}):{days:null,coveredByGrowth:false};
      const daysOfGrass=g.coveredByGrowth?null:g.days;
      const good=g.coveredByGrowth||(daysOfGrass!==null&&daysOfGrass>=GOOD_GRASS_DAYS);
      return{parcelId:p.parcel.id,parcelName:text(p.parcel.nom)||'Parcelle',restDays:p.restDays,surfaceHa:p.surfaceHa,daysOfGrass,_good:good,_km:haversineKm(entry._center,p.center)};
    }).sort((a,b)=>{
      if(a._good!==b._good)return a._good?-1:1;
      if(a._km!==null&&b._km!==null&&a._km!==b._km)return a._km-b._km;
      if((a._km!==null)!==(b._km!==null))return a._km!==null?-1:1;
      return (b.restDays??1e6)-(a.restDays??1e6)||a.parcelName.localeCompare(b.parcelName,'fr');
    });
    const firstIndex=ranked.findIndex(c=>!taken.has(c.parcelId));
    if(firstIndex<0)continue;
    const [first]=ranked.splice(firstIndex,1);
    taken.add(first.parcelId);
    entry.next=[first,...ranked.filter(c=>!taken.has(c.parcelId))].slice(0,3).map(({_good,_km,...c})=>c);
    if(entry.why.length&&entry.level)entry.why[0]+=` ; ${first.parcelName} est ${restText(first.restDays)}.`;
  }
  const result=entries.map(({_session,_surface,_center,...entry})=>{
    if(entry.level&&entry.why.length&&!entry.why[0].endsWith('.'))entry.why[0]+='.';
    return entry;
  });
  if(!paddocks.length)result.push({lotId:null,sessionId:null,parcelId:null,parcelName:'',ugb:0,days:0,pressure:null,pressureMax:max,daysLeft:null,level:'info',confidence:'moyenne',next:[],why:['Aucun paddock reposé : affouragez ou ouvrez une parcelle de fauche']});
  return result;
}

/** Entrées à faire remonter dans les priorités du jour (W4) : sortie sous 3 jours. */
export function urgentRotationAdvice(advice,{maxDays=3}={}){
  return (Array.isArray(advice)?advice:[]).filter(a=>a.lotId&&a.daysLeft!==null&&a.daysLeft<=maxDays&&a.level);
}

/** Ligne courte pour la liste des lots : « Herbe ≈ 4 j · Suivant : La Noue (repos 32 j) ». */
export function rotationLine(entry){
  if(!entry||!entry.level)return '';
  const grass=entry.daysLeft===null?'Herbe suffisante (repousse)':`Herbe ≈ ${fr(entry.daysLeft)} j`;
  const next=entry.next?.[0];
  return next?`${grass} · Suivant : ${next.parcelName} (${next.restDays===null?'jamais pâturée':`repos ${next.restDays} j`})`:grass;
}
