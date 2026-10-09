// n° 74 — Couverts et intercultures en zone vulnérable (CIPAN). Logique pure (testable sous Node).
// Une rotation peut porter une interculture (champ facultatif interculture) : le couvert implanté
// AVANT la culture de cette campagne (entre la récolte précédente et le semis).
import {campaignFor,isoDate,localDate,normalize} from './utils.js';
import {active} from './farm-memory.js';
import {cultureFor,cultureSeason,nitrogenReferences,parcelInZone} from './nitrogen.js';

export const COVER_SOURCE='Programme d’actions régional nitrates Auvergne-Rhône-Alpes (mesure 7 : couverture des sols en interculture), complétant le programme d’actions national.';
export const COVER_VERIFY='Dates plausibles saisies pour la simulation : à vérifier dans le programme d’actions de votre zone et à adapter dans les réglages.';
// Réglages par défaut, modifiables (exploitation.couverts). minDestruction : MM-JJ.
export const COVER_DEFAULTS=Object.freeze({minDestruction:'11-01',minDays:60});
export const DESTRUCTION_MODES=Object.freeze(['Broyage','Roulage','Labour','Travail superficiel','Gel','Pâturage','Chimique (cas dérogatoires)','Autre']);

const MD=/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const dayMs=864e5;
const days=(a,b)=>Math.round((new Date(`${b}T12:00:00`)-new Date(`${a}T12:00:00`))/dayMs);

export function coverSettings(state){
  const raw=state?.exploitation?.couverts||{},minDays=Math.round(Number(raw.minDays));
  return{minDestruction:MD.test(raw.minDestruction||'')?raw.minDestruction:COVER_DEFAULTS.minDestruction,minDays:Number.isFinite(minDays)&&minDays>=0&&minDays<=365?minDays:COVER_DEFAULTS.minDays};
}

/** Interculture normalisée, ou null si rien n’est saisi. */
export function normalizeInterculture(raw){
  if(!raw||typeof raw!=='object')return null;
  const especes=String(raw.especes||'').trim().slice(0,120),semisDate=DATE.test(raw.semisDate||'')?raw.semisDate:'',destructionDate=DATE.test(raw.destructionDate||'')?raw.destructionDate:'';
  const destructionMode=DESTRUCTION_MODES.includes(raw.destructionMode)?raw.destructionMode:'';
  const legumineuse=raw.legumineuse===true||raw.legumineuse==='true';
  if(!especes&&!semisDate&&!destructionDate&&!destructionMode)return null;
  return{especes,semisDate,destructionMode,destructionDate,legumineuse};
}
/** Erreur de saisie bloquante (texte), ou ''. */
export function intercultureError(ic){
  if(!ic)return'';
  if(!ic.especes)return'Champ obligatoire : espèces du couvert.';
  if(ic.semisDate&&ic.destructionDate&&ic.destructionDate<ic.semisDate)return'La destruction du couvert ne peut pas précéder son semis.';
  return'';
}
export const hasCover=rotation=>Boolean(normalizeInterculture(rotation?.interculture)?.especes);

/** Date minimale de destruction pour une campagne (automne qui précède la culture). */
export function minDestructionDate(campaign,settings=COVER_DEFAULTS){
  const year=Number(String(campaign).slice(0,4)),month=Number(settings.minDestruction.slice(0,2));
  return`${month<8?year+1:year}-${settings.minDestruction}`;
}

const ownParcels=state=>active(state,'parcelles').filter(p=>(p.ownershipType||'own')==='own'&&!p.archived);
const nextCampaign=c=>{const y=Number(String(c).slice(0,4))+1;return`${y}/${String(y+1).slice(-2)}`;};

/** État des couverts d’une campagne : une ligne par parcelle de terre arable. */
export function coverRows(state,campaign,{today=isoDate(new Date())}={}){
  const refs=nitrogenReferences(state),settings=coverSettings(state),rotations=active(state,'rotations');
  return ownParcels(state).map(p=>{
    const culture=cultureFor(state,p,campaign,today),season=cultureSeason(culture,refs),rotation=rotations.find(r=>r.parcelId===p.id&&r.campaignId===campaign)||null;
    const ic=normalizeInterculture(rotation?.interculture),zone=parcelInZone(state,p),issues=[];
    if(zone&&season==='printemps'&&!ic?.especes)issues.push({kind:'missing',text:`Culture de printemps (${culture}) sans couvert prévu.`});
    if(ic?.destructionDate){
      const min=minDestructionDate(campaign,settings);
      if(ic.destructionDate<min)issues.push({kind:'early',text:`Destruction prévue le ${localDate(ic.destructionDate)}, avant la date minimale du ${localDate(min)}.`});
      else if(ic.semisDate&&days(ic.semisDate,ic.destructionDate)<settings.minDays)issues.push({kind:'early',text:`Couvert maintenu ${days(ic.semisDate,ic.destructionDate)} jours, moins que les ${settings.minDays} jours retenus.`});
    }
    return{parcel:p,culture,season,rotation,interculture:ic,zone,issues,arable:Boolean(culture)&&!['prairie'].includes(season)&&!/vigne|verger/.test(normalize(culture))};
  }).filter(r=>r.arable||r.interculture);
}

/** Alertes des campagnes en cours et suivante (planification). */
export function coverAlerts(state,{today=isoDate(new Date())}={}){
  const current=campaignFor(today),out=[];
  for(const c of [current,nextCampaign(current)])
    for(const r of coverRows(state,c,{today}))
      for(const issue of r.issues)if(c===current||r.rotation)out.push({...issue,campaign:c,parcel:r.parcel,label:`${r.parcel.nom} · ${c}`});
  return out;
}

/** Surface de terres arables avec un couvert saisi (pour l’éco-régime et la BCAE 6). */
export function coveredParcelIds(state,campaign){
  return new Set(active(state,'rotations').filter(r=>r.campaignId===campaign&&hasCover(r)).map(r=>r.parcelId));
}

/** Entrée pour le tableau de conformité (n° 55). */
export function coverComplianceChecks(state,{today=isoDate(new Date())}={}){
  const labels={ko:'À corriger',warn:'À vérifier',unknown:'Non suivi',ok:'À jour',na:'Non concerné'};
  const anyZone=ownParcels(state).some(p=>parcelInZone(state,p));
  if(!anyZone)return[{id:'cipan',label:'Intercultures prévues avant les cultures de printemps (CIPAN)',status:'na',statusLabel:labels.na,detail:'Aucune parcelle en zone vulnérable.',items:[],action:{type:'covers',label:'Couverts'},hint:''}];
  const alerts=coverAlerts(state,{today}),missing=alerts.filter(a=>a.kind==='missing'),early=alerts.filter(a=>a.kind==='early');
  const status=early.length?'ko':missing.length?'warn':'ok';
  const detail=alerts.length?`${missing.length?`${missing.length} culture${missing.length>1?'s':''} de printemps sans couvert prévu`:''}${missing.length&&early.length?' · ':''}${early.length?`${early.length} destruction${early.length>1?'s':''} trop précoce${early.length>1?'s':''}`:''}.`:'Couverts prévus avant les cultures de printemps des parcelles en zone vulnérable.';
  return[{id:'cipan',label:'Intercultures prévues avant les cultures de printemps (CIPAN)',status,statusLabel:labels[status],detail,
    items:alerts.map(a=>({label:a.label,note:a.text,status:a.kind==='early'?'ko':'warn'})),action:{type:'covers',label:'Couverts'},hint:'Dates paramétrables dans Couverts › Réglages : à vérifier dans votre programme d’actions.'}];
}
