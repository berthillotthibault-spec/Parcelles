// Rappels en arrière-plan (Periodic Background Sync, Android installé). Script classique chargé par
// sw.js via importScripts : un service worker ne peut pas importer de module ES dynamiquement.
// Lecture seule de l'état IndexedDB ; jamais d'écriture ni de création de base.
(function(root){
  const closed=new Set(['Terminé','Terminée','Annulé','Annulée']); // identique à home-priorities.js
  const pad=n=>String(n).padStart(2,'0');
  function localDay(date=new Date()){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;}
  function dueDay(item,kind){const v=String(kind==='task'?item.dueDate||'':item.plannedDate||item.date||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:'';}
  function pending(item,kind){return !item.deletedAt&&!closed.has(item.status||(kind==='work'?'Terminé':'À faire'));}

  // Résumé à notifier : travaux et tâches du jour et en retard.
  function computeReminders(state,today=localDay()){
    const rows=[];
    for(const [type,kind] of [['interventions','work'],['tasks','task']])for(const item of (state&&state[type])||[]){
      if(!pending(item,kind))continue;const day=dueDay(item,kind);if(!day||day>today)continue;
      rows.push({kind,id:item.id,label:kind==='task'?(item.title||'Tâche'):(item.type||'Travail'),late:day<today,time:item.startTime||''});
    }
    rows.sort((a,b)=>(b.late-a.late)||String(a.time||'99').localeCompare(String(b.time||'99')));
    if(!rows.length)return null;
    const late=rows.filter(r=>r.late).length,todayCount=rows.length-late;
    const title=[todayCount&&`${todayCount} à faire aujourd’hui`,late&&`${late} en retard`].filter(Boolean).join(' · ');
    const body=rows.slice(0,4).map(r=>`${r.time?r.time+' ':''}${r.label}${r.late?' (retard)':''}`).join('\n')+(rows.length>4?`\n+ ${rows.length-4} autre(s)`:'');
    return {title:`Parcelles · ${title}`,body,tag:`parcelles-rappel-${today}`,count:rows.length};
  }

  function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async function readState(){
    if(!root.indexedDB)return null;
    // Ne jamais créer la base : si elle n'existe pas encore, l'ouverture est annulée.
    const db=await new Promise(resolve=>{let req;try{req=root.indexedDB.open('parcelles-app');}catch{resolve(null);return;}
      req.onupgradeneeded=()=>{req.transaction.abort();};req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null);req.onblocked=()=>resolve(null);});
    if(!db)return null;
    try{
      if(!db.objectStoreNames.contains('app'))return null;
      const store=db.transaction('app','readonly').objectStore('app');
      const active=await request(store.get('active-workspace')).catch(()=>null);
      const id=String(active?.id||'local');
      const key=id!=='local'?`state:workspace:${id.replace(/[^a-zA-Z0-9_-]/g,'_')}`:'state';
      const tx=db.transaction('app','readonly').objectStore('app');
      return (await request(tx.get(key)).catch(()=>null))||(key!=='state'?await request(db.transaction('app','readonly').objectStore('app').get('state')).catch(()=>null):null);
    }finally{db.close();}
  }

  async function notifyReminders(registration,{now=new Date()}={}){
    if(!registration||typeof registration.showNotification!=='function')return false;
    if(root.Notification&&root.Notification.permission!=='granted')return false;
    const state=await readState();if(!state||state.preferences?.backgroundReminders===false)return false;
    const summary=computeReminders(state,localDay(now));if(!summary)return false;
    // Même étiquette dans la journée : la notification est remplacée sans resonner.
    const shown=await registration.getNotifications?.({tag:summary.tag}).catch(()=>[]);
    if(shown&&shown.length)return false;
    await registration.showNotification(summary.title,{body:summary.body,tag:summary.tag,icon:'./icon-192.png',badge:'./icon-192.png',data:{url:'./index.html#today'}});
    return true;
  }

  root.ParcellesReminders={computeReminders,readState,notifyReminders,localDay};
})(typeof self!=='undefined'?self:globalThis);
