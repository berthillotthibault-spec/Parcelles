import {isPending} from './home-priorities.js';

// Stable keys are shared by the editor, rendering and imported preferences.
export const HOME_CARDS = [
  {id:'weather', label:'Météo', detail:'Les prévisions pour votre exploitation'},
  {id:'today', label:'Travaux du jour', detail:'Les interventions à réaliser aujourd’hui'},
  {id:'tasks', label:'Tâches', detail:'Vos échéances et rappels'},
  {id:'alerts', label:'À surveiller', detail:'Les alertes utiles à votre journée'},
  {id:'recent', label:'Activité récente', detail:'Les derniers travaux enregistrés'}
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
  homeSummary:true,homeNextAction:true,assistantDock:true,nativeHaptics:true,startupDuration:3500,startupDurationVersion:2
};
function knownUnique(value,allowed,fallback){
  return Array.isArray(value)?[...new Set(value.filter(key=>allowed.includes(key)))]:[...fallback];
}
export function normalizePersonalization(preferences={}){
  const cards=HOME_CARDS.map(item=>item.id),shortcuts=HOME_SHORTCUTS.map(item=>item.id);
  const order=knownUnique(preferences.homeCardOrder,cards,cards);
  return {
    homeCards:knownUnique(preferences.homeCards,cards,cards),
    homeCardOrder:[...order,...cards.filter(key=>!order.includes(key))],
    homeShortcuts:knownUnique(preferences.homeShortcuts,shortcuts,PERSONALIZATION_DEFAULTS.homeShortcuts),
    homeSummary:preferences.homeSummary!==false,
    homeNextAction:preferences.homeNextAction!==false,
    assistantDock:preferences.assistantDock!==false,
    nativeHaptics:preferences.nativeHaptics!==false,
    // Plein champ : grands boutons, texte agrandi et contraste renforcé (champ facultatif, désactivé par défaut).
    pleinChamp:preferences.pleinChamp===true,
    startupDuration:[0,1200,2200,3500].includes(preferences.startupDuration)&&(preferences.startupDurationVersion===2||preferences.startupDuration!==2200)?preferences.startupDuration:3500,
    startupDurationVersion:2
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
