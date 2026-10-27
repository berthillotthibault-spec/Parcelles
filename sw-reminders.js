// Rappels en arrière-plan (Periodic Background Sync, Android installé). Script classique chargé par
// sw.js via importScripts : un service worker ne peut pas importer de module ES dynamiquement.
// Lecture seule de l'état IndexedDB ; jamais d'écriture ni de création de base.
(function(root){
  const closed=new Set(['Terminé','Terminée','Annulé','Annulée']); // identique à home-priorities.js
  const pad=n=>String(n).padStart(2,'0');
  function localDay(date=new Date()){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;}
  function dueDay(item,kind){const v=String(kind==='task'?item.dueDate||'':item.plannedDate||item.date||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:'';}
  function pending(item,kind){return !item.deletedAt&&!closed.has(item.status||(kind==='work'?'Terminé':'À faire'));}

  // n° 17 — Échéances hors travaux et tâches, partagées avec l'export agenda (ics.js les lit sur
  // ParcellesReminders) : entretien à date ou au compteur, fin de DAR et de délai de rentrée (DRE)
  // d'après la fiche figée sur le traitement ou la fiche du produit en stock, lot à rentrer (sortie
  // prévue ou durée de pâturage de la règle d'automatisation). Lecture seule, sans import.
  const DONE=new Set(['Terminé','Terminée']);
  const TREATMENT=/phyto|pulve|herbicide|fongicide|insecticide|desherb|traitement/;
  const DRE_DEFAULT_HOURS=6; // identique à phyto.js
  const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const isoDay=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
  const clock=v=>/^\d{1,2}:\d{2}/.test(String(v||''))?String(v).slice(0,5).padStart(5,'0'):'';
  const positive=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>0?n:null;};
  function plusDays(day,n){const d=new Date(`${day}T12:00:00`);d.setDate(d.getDate()+n);return localDay(d);}
  const live=(state,type)=>((state&&state[type])||[]).filter(x=>x&&!x.deletedAt);
  function productSheet(state,work){
    const amm=String(work.amm||'').trim(),name=fold(work.product);if(!amm&&!name)return null;
    const items=[...live(state,'stockItems'),...live(state,'products')];
    const item=(amm&&items.find(i=>String(i.phyto?.amm||'').trim()===amm))||(name&&items.find(i=>fold(i.name||i.nom)===name))||null;
    return item?.phyto&&typeof item.phyto==='object'?item.phyto:null;
  }
  function dueDates(state,{today=localDay()}={}){
    const rows=[],parcels=new Map(live(state,'parcelles').map(p=>[p.id,p.nom||p.name||'']));
    const where=id=>parcels.get(id)||'';
    for(const m of live(state,'materiels')){
      const name=m.nom||'Matériel',day=isoDay(m.maintenanceDate);
      if(day)rows.push({kind:'maintenance',id:`${m.id}-date`,entityId:m.id,day,label:`Entretien · ${name}`,detail:'Entretien prévu à cette date.'});
      const due=Number(m.maintenanceDue),meter=Number(m.currentMeter);
      if(m.maintenanceDue!=null&&m.maintenanceDue!==''&&m.currentMeter!=null&&m.currentMeter!==''&&Number.isFinite(due)&&Number.isFinite(meter)&&due-meter<=0)
        rows.push({kind:'maintenance',id:`${m.id}-meter`,entityId:m.id,day:today,undated:true,label:`Entretien dû · ${name}`,detail:`Compteur ${meter} h pour un entretien prévu à ${due} h.`});
    }
    for(const w of live(state,'interventions')){
      if(!(w.isPhytosanitary===true||TREATMENT.test(fold(w.type))))continue;
      const status=w.status||'Terminé';if(!(DONE.has(status)||status==='En cours'))continue;
      const day=isoDay(w.date);if(!day)continue;
      const sheet=productSheet(state,w),frozen=w.phytoLimits||{},what=w.product||w.type||'Traitement',parcel=where(w.parcelId);
      const dar=positive(frozen.dar)??positive(sheet?.dar);
      if(dar!==null)rows.push({kind:'dar',id:w.id,entityId:w.id,parcelId:w.parcelId,day:plusDays(day,Math.ceil(dar)),label:`Fin du délai avant récolte${parcel?` · ${parcel}`:''}`,detail:`${what} du ${day} : DAR de ${dar} j. Vérifiez l’étiquette.`});
      const dre=positive(frozen.dre)??positive(sheet?.dre)??DRE_DEFAULT_HOURS;
      const end=new Date(`${day}T${clock(w.endTime)||clock(w.startTime)||'12:00'}:00`);end.setMinutes(end.getMinutes()+Math.round(dre*60));
      if(Number.isFinite(end.getTime()))rows.push({kind:'reentry',id:w.id,entityId:w.id,parcelId:w.parcelId,day:localDay(end),time:`${pad(end.getHours())}:${pad(end.getMinutes())}`,label:`Fin du délai de rentrée${parcel?` · ${parcel}`:''}`,detail:`${what} du ${day} : accès possible après ${dre} h. Vérifiez l’étiquette.`});
    }
    const thresholds=live(state,'automationRules').filter(r=>r.enabled&&r.kind==='grazing_duration'&&Number(r.threshold)>0).map(r=>Number(r.threshold));
    const threshold=thresholds.length?Math.min(...thresholds):null;
    for(const s of live(state,'grazingSessions')){
      // Le jour de la sortie prévue, le rappel tombe encore ; une sortie saisie le jour même (fiche modifiée ce jour-là) l'éteint.
      const start=isoDay(s.startDate),end=isoDay(s.endDate);if(!start||start>today||(end&&(end<today||(end===today&&!(isoDay(s.updatedAt)&&isoDay(s.updatedAt)<end)))))continue;
      const day=end||(threshold!==null?plusDays(start,threshold):'');if(!day)continue;
      rows.push({kind:'grazing',id:s.id,entityId:s.id,parcelId:s.parcelId,day,label:`Rentrer le lot${where(s.parcelId)?` · ${where(s.parcelId)}`:''}`,detail:end?'Sortie prévue du pâturage.':`Animaux présents depuis ${threshold} jours (seuil de la règle de pâturage).`});
    }
    return rows.sort((a,b)=>a.day.localeCompare(b.day)||String(a.time||'99').localeCompare(String(b.time||'99')));
  }
  // Rappel du jour : entretiens et lots dus (même en retard), fins de DAR et de DRE du jour seulement.
  const dueToday=(row,today)=>row.kind==='maintenance'||row.kind==='grazing'?row.day<=today:row.day===today;

  // Résumé à notifier : travaux et tâches du jour et en retard, puis échéances du jour (n° 17).
  function computeReminders(state,today=localDay()){
    const rows=[];
    for(const [type,kind] of [['interventions','work'],['tasks','task']])for(const item of (state&&state[type])||[]){
      if(!pending(item,kind))continue;const day=dueDay(item,kind);if(!day||day>today)continue;
      rows.push({kind,id:item.id,label:kind==='task'?(item.title||'Tâche'):(item.type||'Travail'),late:day<today,time:item.startTime||''});
    }
    for(const row of dueDates(state,{today}))if(dueToday(row,today))rows.push({kind:row.kind,id:row.id,label:row.label,late:row.day<today,time:row.time||''});
    rows.sort((a,b)=>(b.late-a.late)||String(a.time||'99').localeCompare(String(b.time||'99')));
    if(!rows.length)return null;
    const late=rows.filter(r=>r.late).length,todayCount=rows.length-late;
    const title=[todayCount&&`${todayCount} à faire aujourd’hui`,late&&`${late} en retard`].filter(Boolean).join(' · ');
    const body=rows.slice(0,4).map(r=>`${r.time?r.time+' ':''}${r.label}${r.late?' (retard)':''}`).join('\n')+(rows.length>4?`\n+ ${rows.length-4} autre(s)`:'');
    return {title:`Parcelles · ${title}`,body,tag:`parcelles-rappel-${today}`,count:rows.length};
  }

  function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  // n° 137 : état rangé par collection (<clé>/meta + <clé>/c/<nom>), sinon ancienne forme (un seul objet).
  // Une seule transaction, requêtes enchaînées dans les rappels : lecture cohérente, jamais à moitié écrite.
  function readStored(db,base){
    return new Promise(resolve=>{
      try{
        const tx=db.transaction('app','readonly'),store=tx.objectStore('app');let value=null;
        const metaReq=store.get(base+'/meta');
        metaReq.onsuccess=()=>{
          const meta=metaReq.result;
          if(!meta||!Array.isArray(meta.keys)){const legacyReq=store.get(base);legacyReq.onsuccess=()=>{value=legacyReq.result||null;};return;}
          value={};
          for(const name of meta.keys){const req=store.get(base+'/c/'+name);req.onsuccess=()=>{if(req.result!==undefined)value[name]=req.result;};}
        };
        tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>resolve(null);
      }catch{resolve(null);}
    });
  }
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
      return (await readStored(db,key))||(key!=='state'?await readStored(db,'state'):null);
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

  root.ParcellesReminders={computeReminders,dueDates,readState,notifyReminders,localDay};
})(typeof self!=='undefined'?self:globalThis);
