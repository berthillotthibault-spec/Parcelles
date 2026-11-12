// Interface « Carte hors connexion » (idée n° 40) : Plus › Mes données.
// Pré-télécharge les tuiles IGN autour des parcelles dans un cache dédié (« tiles-v1 »)
// que le service worker sert en priorité ; ce cache survit aux mises à jour de l'application.
import {escapeHtml} from './utils.js';
import {BATCH_SIZE, OFFLINE_LAYERS, TILE_CAP_BYTES, autoRenewDue, chunk, evictionList, fitPlan, formatBytes, formatCount, normalizeMeta, offlineLayer, offlineSummary, planCoverageGap, plannedUrls, tileCacheName, tileNeedsRefresh} from './offline-map.js';

const META_KEY='parcelles:offline-map';
// Dernière tentative de renouvellement automatique : au plus une par jour, même si des tuiles
// restent introuvables chez l'IGN (sinon chaque démarrage relancerait le même essai).
const AUTO_KEY='parcelles:offline-map:auto';
const AUTO_MIN_INTERVAL_MS=24*3600*1000;

export function createOfflineMapUI(host){
  const {state,active,modal,toast}=host;
  const $=selector=>document.querySelector(selector);
  let job=null,offlineHinted=false;

  const supported=()=>typeof caches!=='undefined'&&typeof fetch==='function';
  const readMeta=()=>{try{return normalizeMeta(JSON.parse(localStorage.getItem(META_KEY)||'null'));}catch{return null;}};
  const writeMeta=meta=>{try{localStorage.setItem(META_KEY,JSON.stringify(meta));}catch{}};
  const clearMeta=()=>{try{localStorage.removeItem(META_KEY);}catch{}};
  async function cacheName(){
    let scope=new URL('./',location.href).pathname;
    try{const registration=await navigator.serviceWorker?.getRegistration?.();if(registration?.scope)scope=new URL(registration.scope).pathname;}catch{}
    return tileCacheName(scope);
  }
  const parcels=()=>active('parcelles').filter(p=>p.geometry);
  const defaultLayer=()=>{const pref=state().preferences?.mapLayer,meta=readMeta();return offlineLayer(pref)?pref:meta?.layer||'ign-photo';};

  function summary(){return supported()?offlineSummary(readMeta()):'Non disponible dans ce navigateur';}

  // ---------- Fenêtre ----------
  function open(){
    const meta=readMeta(),layer=defaultLayer(),count=parcels().length;
    const canDownload=supported()&&count>0;
    modal('Carte hors connexion','Les fonds IGN autour de vos parcelles restent visibles sans réseau, au champ comme au fond d’une vallée.',`<form id="om-form" class="om-form" novalidate>
      <div class="notice ${meta?(meta.complete&&!autoRenewDue(meta)?'success':'warning'):'info'} om-status" id="om-status"><strong>Carte hors ligne : ${escapeHtml(meta?offlineSummary(meta).replace(/^(À jour|Incomplète|Téléchargée)/,m=>m.toLowerCase()):'pas encore téléchargée')}</strong>${meta&&!meta.complete?'<br>Téléchargement interrompu : relancez-le pour compléter.':''}</div>
      ${!supported()?'<div class="notice warning">Ce navigateur ne permet pas de garder des tuiles de carte.</div>':count===0?'<div class="notice warning">Aucune parcelle n’a de contour : dessinez ou importez vos parcelles d’abord.</div>':''}
      <div class="field-label"><span>Fond à télécharger *</span><input type="hidden" name="layer" value="${escapeHtml(layer)}"><div class="chip-choices om-chips" data-chip-target="layer" role="group" aria-label="Fond à télécharger">${OFFLINE_LAYERS.map(l=>`<button type="button" class="choice-chip${l.id===layer?' is-on':''}" data-value="${l.id}" aria-pressed="${l.id===layer}">${escapeHtml(l.label)}</button>`).join('')}</div></div>
      <label class="om-check"><input type="checkbox" name="cadastre"${meta?.cadastre||state().preferences?.mapCadastre?' checked':''}> Inclure le cadastre</label>
      <p class="om-estimate" id="om-estimate" aria-live="polite"></p>
      <div class="om-progress" id="om-progress" hidden><progress id="om-bar" max="1" value="0" aria-label="Progression du téléchargement"></progress><p id="om-progress-text" role="status" aria-live="polite"></p><button type="button" class="button secondary" id="om-cancel">Interrompre</button></div>
      <p class="form-error hidden" id="om-error" role="alert"></p>
      <p class="form-note">Seules les tuiles IGN (Géoplateforme, © IGN) sont téléchargées : les conditions d’usage d’OSM et d’Esri ne le permettent pas. Hors connexion, la carte reste nette jusqu’au zoom 17 (environ 1 : 4 000). Plafond : ${formatBytes(TILE_CAP_BYTES)}, les tuiles les plus anciennes sont retirées au-delà.</p>
    </form>`,`${meta?'<button type="button" class="button secondary" id="om-delete">Supprimer la carte hors ligne</button>':''}<button type="button" class="button primary om-wide" id="om-download"${canDownload?'':' disabled'}>${meta?'Mettre à jour la carte de l’exploitation':'Télécharger la carte de l’exploitation'}</button>`);
    const form=$('#om-form');host.bindChipChoices?.(form);
    form.addEventListener('click',event=>{if(event.target.closest('.choice-chip'))setTimeout(renderEstimate);});
    form.elements.cadastre.addEventListener('change',renderEstimate);
    $('#om-download').onclick=()=>download({refresh:Boolean(meta)});
    $('#om-delete')?.addEventListener('click',remove);
    $('#om-cancel').onclick=()=>job?.controller.abort('user');
    renderEstimate();
    if(job)renderProgress();
  }
  function options(){const form=$('#om-form');return {layer:form?.elements.layer.value||'ign-photo',cadastre:Boolean(form?.elements.cadastre.checked)};}
  function renderEstimate(){
    const el=$('#om-estimate');if(!el)return;const list=parcels();if(!list.length){el.textContent='';return;}
    const plan=fitPlan(list,options());
    el.innerHTML=`<strong>${formatCount(plan.requests)} tuile${plan.requests>1?'s':''}</strong> · environ ${escapeHtml(formatBytes(plan.estimatedBytes))} <small>(estimation)</small><br><small>${formatCount(plan.parcelCount)} parcelle${plan.parcelCount>1?'s':''} + ${500} m autour · zooms ${plan.zooms[0]} à ${plan.zooms[plan.zooms.length-1]}${plan.reduced?' (zoom maximal réduit pour rester sous le plafond)':''}</small>`;
    const button=$('#om-download');if(button&&!job)button.disabled=!supported()||plan.tooLarge;
    if(plan.tooLarge)showError('L’emprise est trop grande pour le plafond de stockage. Retirez le cadastre ou téléchargez le Plan IGN.');else $('#om-error')?.classList.add('hidden');
  }
  function showError(message){const el=$('#om-error');if(!el)return toast(message,'error');el.textContent=message;el.classList.remove('hidden');}
  function renderProgress(){
    if(!job||job.silent&&!document.getElementById('om-form'))return;const box=$('#om-progress');if(!box)return;box.hidden=false;
    const bar=$('#om-bar');bar.max=job.total;bar.value=job.done;
    $('#om-progress-text').textContent=`${formatCount(job.done)} / ${formatCount(job.total)} tuiles · ${formatBytes(job.bytes)}${job.failed?` · ${formatCount(job.failed)} indisponible${job.failed>1?'s':''}`:''}`;
    const button=$('#om-download');if(button){button.disabled=true;button.textContent='Téléchargement en cours…';}
  }

  // ---------- Téléchargement ----------
  // refresh : retélécharge aussi les tuiles en cache depuis plus de 30 jours (tileNeedsRefresh) ;
  // en cas d'échec, l'ancienne tuile reste servie. silent : ni progression, ni toast, ni demande
  // de stockage persistant (renouvellement automatique). Renvoie un bilan pour les appels silencieux.
  async function download({refresh=false,silent=false,layer:forcedLayer,cadastre:forcedCadastre,parcels:forcedParcels}={}){
    if(job)return {started:false,reason:'busy'};
    const fail=(reason,message)=>{if(!silent)showError(message);return {started:false,reason};};
    if(navigator.onLine===false)return fail('offline','Connectez-vous à Internet pour télécharger la carte.');
    const picked=options(),layer=forcedLayer||picked.layer,cadastre=forcedCadastre??picked.cadastre,plan=fitPlan(forcedParcels||parcels(),{layer,cadastre});
    if(!plan.tiles.length)return fail('empty','Aucune parcelle n’a de contour à télécharger.');
    if(plan.tooLarge)return fail('too-large','L’emprise est trop grande pour le plafond de stockage.');
    try{const estimate=await navigator.storage?.estimate?.();if(estimate?.quota&&estimate.quota-(estimate.usage||0)<plan.estimatedBytes*1.2)return fail('quota',`Espace insuffisant sur l’appareil : environ ${formatBytes(plan.estimatedBytes)} nécessaires.`);}catch{}
    if(!silent){try{await navigator.storage?.persist?.();}catch{}}
    const urls=plannedUrls(plan,{layer,cadastre}),controller=new AbortController(),startedAt=Date.now(),previous=readMeta();
    job={controller,total:urls.length,done:0,bytes:0,failed:0,fresh:0,stale:0,silent};
    const onOffline=()=>controller.abort('offline');window.addEventListener('offline',onOffline);
    renderProgress();
    let cache;
    try{cache=await caches.open(await cacheName());}catch{job=null;window.removeEventListener('offline',onOffline);return fail('storage','Le stockage de la carte est indisponible (navigation privée ?).');}
    for(const batch of chunk(urls,BATCH_SIZE)){
      if(controller.signal.aborted)break;
      await Promise.all(batch.map(async url=>{
        let hit=null;
        try{
          hit=await cache.match(url);
          if(hit&&!(refresh&&tileNeedsRefresh(hit.headers,startedAt))){job.bytes+=Number(hit.headers.get('x-parcelles-size'))||0;return;}
          const response=await fetch(url,{mode:'cors',credentials:'omit',signal:controller.signal});
          if(!response.ok)throw new Error(`HTTP ${response.status}`);
          const blob=await response.blob();
          await cache.put(url,new Response(blob,{status:200,headers:{'content-type':response.headers.get('content-type')||blob.type||'image/png','x-parcelles-cached-at':String(Date.now()),'x-parcelles-size':String(blob.size)}}));
          job.bytes+=blob.size;job.fresh++;
        }catch{
          // Renouvellement raté : l'ancienne tuile reste en cache et utilisable.
          if(hit){job.bytes+=Number(hit.headers.get('x-parcelles-size'))||0;job.stale++;}
          else if(!controller.signal.aborted)job.failed++;
        }
        finally{if(!controller.signal.aborted)job.done++;}
      }));
      renderProgress();
    }
    window.removeEventListener('offline',onOffline);
    const reason=controller.signal.aborted?controller.signal.reason:'',current=job;job=null;if(current.removed)return {started:true,reason:'removed'};
    const complete=!reason&&current.failed<current.total;
    // Des tuiles anciennes n'ont pas pu être renouvelées : la carte garde sa date d'avant (sinon elle
    // s'afficherait « à jour » et le renouvellement automatique attendrait 90 jours de plus).
    const keepDate=current.stale>0&&previous&&previous.layer===layer&&previous.cadastre===cadastre;
    if(current.done>current.failed)writeMeta({at:keepDate?Math.min(previous.at,Date.now()):Date.now(),layer,cadastre,tiles:current.done-current.failed,total:current.total,bytes:current.bytes,failed:current.failed,maxZoom:plan.zooms[plan.zooms.length-1],complete:complete&&current.done===current.total});
    await evict(cache,startedAt).catch(()=>{});
    if(document.getElementById('om-form'))open();
    const result={started:true,reason:reason||'',total:current.total,fresh:current.fresh,stale:current.stale,failed:current.failed,bytes:current.bytes};
    if(silent)return result;
    if(reason==='offline'){toast('Connexion perdue : téléchargement interrompu. Les tuiles déjà reçues restent disponibles.','error',null,{persist:true});return result;}
    if(reason){toast('Téléchargement interrompu. Les tuiles déjà reçues restent disponibles.');return result;}
    if(current.failed&&current.failed===current.total){toast('Le service IGN ne répond pas : réessayez plus tard.','error');return result;}
    const usable=current.total-current.failed;
    const switchAction=state().preferences?.mapLayer!==layer?{label:'Utiliser ce fond',run:()=>host.setBaseLayer?.(layer)}:null;
    toast(`Carte hors ligne prête : ${formatCount(usable)} tuile${usable>1?'s':''} (${formatBytes(current.bytes)})${current.failed?`, ${formatCount(current.failed)} indisponible${current.failed>1?'s':''}`:''}.`,'success',switchAction,{persist:Boolean(switchAction)});
    return result;
  }
  // Renouvellement automatique, en tâche de fond après le rendu : seulement avec une carte déjà
  // téléchargée, en ligne, hors économiseur de données et hors réseau mobile (quand il est connu),
  // sans téléchargement en cours. Déclenché si la carte a plus de 90 jours ou si des tuiles prévues
  // manquent au cache (nouvelle parcelle, téléchargement interrompu). Renvoie {started, reason}.
  async function maybeAutoRenew({parcels:list,connection=navigator.connection,online=navigator.onLine!==false,now=Date.now()}={}){
    if(!supported())return {started:false,reason:'unsupported'};
    const meta=readMeta();if(!meta)return {started:false,reason:'no-meta'};
    if(!online)return {started:false,reason:'offline'};
    if(connection?.saveData===true)return {started:false,reason:'save-data'};
    if(connection?.type==='cellular')return {started:false,reason:'cellular'};
    if(job)return {started:false,reason:'busy'};
    // now-last<0 : horloge reculée depuis la dernière tentative, on ne bloque pas indéfiniment.
    try{const last=Number(localStorage.getItem(AUTO_KEY));if(Number.isFinite(last)&&last>0&&now-last>=0&&now-last<AUTO_MIN_INTERVAL_MS)return {started:false,reason:'recent'};}catch{}
    const items=(Array.isArray(list)?list:parcels()).filter(p=>p&&!p.deletedAt&&p.geometry);
    const plan=fitPlan(items,{layer:meta.layer,cadastre:meta.cadastre});
    if(!plan.tiles.length||plan.tooLarge)return {started:false,reason:'no-plan'};
    let trigger=autoRenewDue(meta,now)?'age':'';
    if(!trigger){
      let cachedUrls;
      try{const cache=await caches.open(await cacheName());cachedUrls=new Set((await cache.keys()).map(request=>request.url));}catch{return {started:false,reason:'storage'};}
      if(planCoverageGap(plannedUrls(plan,{layer:meta.layer,cadastre:meta.cadastre}),cachedUrls).length)trigger='gap';
    }
    if(!trigger)return {started:false,reason:'up-to-date'};
    if(job)return {started:false,reason:'busy'};
    try{localStorage.setItem(AUTO_KEY,String(now));}catch{}
    const result=await download({refresh:true,silent:true,layer:meta.layer,cadastre:meta.cadastre,parcels:items});
    return {...result,trigger};
  }
  async function evict(cache,keepAfter){
    const keys=await cache.keys();let total=0;const rows=[];
    for(const request of keys){const response=await cache.match(request);const size=Number(response?.headers.get('x-parcelles-size'))||0,cachedAt=Number(response?.headers.get('x-parcelles-cached-at'))||0;total+=size;rows.push({url:request.url,size,cachedAt:cachedAt>=keepAfter?Number.MAX_SAFE_INTEGER:cachedAt});}
    if(total<=TILE_CAP_BYTES)return 0;
    const drop=evictionList(rows,TILE_CAP_BYTES);for(const url of drop)await cache.delete(url);
    return drop.length;
  }
  async function remove(){
    if(job){job.removed=true;job.controller.abort('user');}
    try{await caches.delete(await cacheName());}catch{}
    clearMeta();open();toast('Carte hors ligne supprimée de l’appareil.');
  }

  // Hors connexion avec une carte prête mais un autre fond affiché : proposer de basculer.
  function onConnectivity(){
    if(navigator.onLine!==false){offlineHinted=false;return;}
    const meta=readMeta();if(!meta||offlineHinted||state().preferences?.mapLayer===meta.layer)return;
    offlineHinted=true;
    toast(`Hors connexion : la carte téléchargée utilise le fond « ${offlineLayer(meta.layer).label} ».`,'success',{label:'Afficher',run:()=>host.setBaseLayer?.(meta.layer)},{persist:true});
  }
  window.addEventListener('offline',onConnectivity);window.addEventListener('online',onConnectivity);

  return {open,summary,download,maybeAutoRenew,remove,isBusy:()=>Boolean(job),readMeta,checkConnectivity:onConnectivity};
}
