// Raccourcis de l'application installée et routes profondes vers le mode terrain (n° 15). Logique pure.
export const LAUNCH_ROUTES={field:'field','new/work':'work','new/observation':'observation','new/photo':'photo',voice:'voice'};

// Les 4 raccourcis du manifeste (appui long sur l'icône) : nom, route et icône 96 px.
export const PWA_SHORTCUTS=[
  {name:'Terrain',short_name:'Terrain',description:'Ouvrir le mode terrain',url:'./#field',icon:'shortcut-field-96.png'},
  {name:'J’ai fait',short_name:'J’ai fait',description:'Noter un travail fait',url:'./#new/work',icon:'shortcut-work-96.png'},
  {name:'Photo',short_name:'Photo',description:'Prendre une photo de parcelle',url:'./#new/photo',icon:'shortcut-photo-96.png'},
  {name:'Dicter',short_name:'Dicter',description:'Dicter un mémo vocal',url:'./#voice',icon:'shortcut-voice-96.png'}
];

// « #field », « field/ », « #/new/work?x=1 » → type d'ouverture, sinon null.
export function parseLaunchRoute(route){
  const key=String(route||'').replace(/^#/,'').replace(/^\/+/,'').replace(/[?#].*$/,'').replace(/\/+$/,'').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LAUNCH_ROUTES,key)?LAUNCH_ROUTES[key]:null;
}

// Au lancement : rouvrir le mode terrain si une session est en cours et qu'aucune route précise n'est demandée.
export function shouldResumeField(hash,hasActiveSession){
  const route=String(hash||'').replace(/^#/,'');
  return Boolean(hasActiveSession)&&(route===''||route==='today');
}
