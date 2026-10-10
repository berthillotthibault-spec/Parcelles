import {isPending} from './home-priorities.js';
import {normalizeActiveModules} from './activity-modules.js';

// Stable keys are shared by the editor, rendering and imported preferences.
export const HOME_CARDS = [
  {id:'weather', label:'Météo', detail:'Les prévisions pour votre exploitation'},
  {id:'today', label:'Travaux du jour', detail:'Les interventions à réaliser aujourd’hui'},
  {id:'tasks', label:'Tâches', detail:'Vos échéances et rappels'},
  {id:'alerts', label:'À surveiller', detail:'Les alertes utiles à votre journée'},
  {id:'recent', label:'Activité récente', detail:'Les derniers travaux enregistrés'},
  {id:'campaign', label:'Ma campagne', detail:'Marge estimée, ventes et montants à facturer (masqués au rôle lecture seule)'}
];
export const HOME_SHORTCUTS = [
  {id:'new-work',label:'Travail',icon:'plus'},
  {id:'open-field-mode',label:'Terrain',icon:'locate'},
  {id:'new-observation',label:'Observation',icon:'alert'},
  {id:'open-calendar',label:'Calendrier',icon:'calendar'},
  {id:'open-tasks',label:'Tâches',icon:'work'},
  {id:'open-weather',label:'Météo',icon:'weather'},
  {id:'open-day-route',label:'Tournée',icon:'map'},
  {id:'open-documents',label:'Documents',icon:'files'},
  {id:'open-equipment',label:'Matériel',icon:'tractor'},
  {id:'new-parcel',label:'Parcelle',icon:'plus'}
];
export const PERSONALIZATION_DEFAULTS = {
  homeCards:HOME_CARDS.map(item=>item.id),
  homeCardOrder:HOME_CARDS.map(item=>item.id),
  homeShortcuts:['new-work','open-field-mode','new-observation'],
  homeSummary:true,homeNextAction:true,assistantDock:true,nativeHaptics:true,startupDuration:0,startupDurationVersion:3
};
function knownUnique(value,allowed,fallback){
  return Array.isArray(value)?[...new Set(value.filter(key=>allowed.includes(key)))]:[...fallback];
}
// n° 142 : version 3 = accès direct par défaut. Les anciens défauts (2,2 s avant la version 2,
// 3,5 s avant la version 3) passent à 0 ; tout autre choix explicite est conservé, et un choix
// enregistré en version 3 (y compris 3,5 s) n’est plus jamais réécrit.
export const STARTUP_DURATIONS=[0,1200,2200,3500];
function normalizeStartupDuration(preferences){
  const value=preferences.startupDuration,version=Number(preferences.startupDurationVersion)||0;
  if(!STARTUP_DURATIONS.includes(value))return 0;
  if(version>=3)return value;
  if(value===3500||(version<2&&value===2200))return 0;
  return value;
}
export function normalizePersonalization(preferences={}){
  const cards=HOME_CARDS.map(item=>item.id),shortcuts=HOME_SHORTCUTS.map(item=>item.id);
  const order=knownUnique(preferences.homeCardOrder,cards,cards);
  return {
    // v6b n° 88 : une carte nouvelle (absente de l’ordre enregistré) est affichée une première fois.
    homeCards:(list=>Array.isArray(preferences.homeCardOrder)&&['weather','today','tasks','alerts','recent'].every(k=>preferences.homeCardOrder.includes(k))&&!preferences.homeCardOrder.includes('campaign')&&!list.includes('campaign')?[...list,'campaign']:list)(knownUnique(preferences.homeCards,cards,cards)),
    homeCardOrder:[...order,...cards.filter(key=>!order.includes(key))],
    homeShortcuts:knownUnique(preferences.homeShortcuts,shortcuts,PERSONALIZATION_DEFAULTS.homeShortcuts),
    homeSummary:preferences.homeSummary!==false,
    homeNextAction:preferences.homeNextAction!==false,
    assistantDock:preferences.assistantDock!==false,
    nativeHaptics:preferences.nativeHaptics!==false,
    // Plein champ : grands boutons, texte agrandi et contraste renforcé (champ facultatif, désactivé par défaut).
    pleinChamp:preferences.pleinChamp===true,
    // n° 116 : activités de l'exploitation ('all' = tout afficher, défaut).
    activeModules:normalizeActiveModules(preferences.activeModules),
    startupDuration:normalizeStartupDuration(preferences),
    startupDurationVersion:3
  };
}
export function moveHomeCard(order,id,direction){
  const next=[...order],index=next.indexOf(id),target=index+direction;
  if(index<0||target<0||target>=next.length)return next;
  [next[index],next[target]]=[next[target],next[index]];return next;
}
export const HOME_PRESETS = {
  essential:{label:'Essentiel',homeCards:['weather','today','tasks'],homeCardOrder:['today','weather','tasks','alerts','recent'],homeShortcuts:['new-work','open-tasks','open-weather'],homeSummary:true,homeNextAction:true},
  field:{label:'Terrain',homeCards:['weather','today','alerts'],homeCardOrder:['weather','today','alerts','tasks','recent'],homeShortcuts:['open-field-mode','new-observation','open-day-route','new-work'],homeSummary:false,homeNextAction:true},
  management:{label:'Gestion',homeCards:['today','tasks','alerts','recent'],homeCardOrder:['tasks','today','alerts','recent','weather'],homeShortcuts:['open-calendar','open-tasks','open-documents','open-equipment'],homeSummary:true,homeNextAction:true}
};
export function filterMapParcels(data,filter='all'){
  const pending=new Set([
    ...(data.interventions||[]).filter(item=>isPending(item)),
    ...(data.tasks||[]).filter(item=>isPending(item,'task'))
  ].map(item=>item.parcelId));
  return (data.parcelles||[]).filter(parcel=>{
    if(parcel.deletedAt||parcel.archived)return false;
    if(filter==='favorites')return Boolean(parcel.favorite);
    if(filter==='clients')return Boolean(parcel.clientId)||(parcel.ownershipType||'own')!=='own';
    if(filter==='todo')return pending.has(parcel.id)||String(parcel.status||'').toLowerCase().includes('faire');
    return true;
  });
}
