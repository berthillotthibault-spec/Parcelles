// Interface « Carte hors connexion » (idée n° 40) : Plus › Mes données.
// Pré-télécharge les tuiles IGN autour des parcelles dans un cache dédié (« tiles-v1 »)
// que le service worker sert en priorité ; ce cache survit aux mises à jour de l'application.
import {escapeHtml} from './utils.js';
import {BATCH_SIZE, OFFLINE_LAYERS, TILE_CAP_BYTES, chunk, evictionList, fitPlan, formatBytes, formatCount, normalizeMeta, offlineLayer, offlineSummary, plannedUrls, tileCacheName} from './offline-map.js';

const META_KEY='parcelles:offline-map';

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
      <div class="notice ${meta?'success':'info'} om-status" id="om-status"><strong>Carte hors ligne : ${escapeHtml(meta?offlineSummary(meta).replace(/^À jour/,'à jour'):'pas encore téléchargée')}</strong>${meta&&!meta.complete?'<br>Téléchargement interrompu : relancez-le pour compléter.':''}</div>
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
    $('#om-download').onclick=()=>download();
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
    if(!job)return;const box=$('#om-progress');if(!box)return;box.hidden=false;
    const bar=$('#om-bar');bar.max=job.total;bar.value=job.done;
    $('#om-progress-text').textContent=`${formatCount(job.done)} / ${formatCount(job.total)} tuiles · ${formatBytes(job.bytes)}${job.failed?` · ${formatCount(job.failed)} indisponible${job.failed>1?'s':''}`:''}`;
    const button=$('#om-download');if(button){button.disabled=true;button.textContent='Téléchargement en cours…';}
  }

  // ---------- Téléchargement ----------
  async function download(){
    if(job)return;
    if(navigator.onLine===false)return showError('Connectez-vous à Internet pour télécharger la carte.');
    const {layer,cadastre}=options(),plan=fitPlan(parcels(),{layer,cadastre});
    if(!plan.tiles.length)return showError('Aucune parcelle n’a de contour à télécharger.');
    if(plan.tooLarge)return showError('L’emprise est trop grande pour le plafond de stockage.');
    try{const estimate=await navigator.storage?.estimate?.();if(estimate?.quota&&estimate.quota-(estimate.usage||0)<plan.estimatedBytes*1.2)return showError(`Espace insuffisant sur l’appareil : environ ${formatBytes(plan.estimatedBytes)} nécessaires.`);}catch{}
    try{await navigator.storage?.persist?.();}catch{}
    const urls=plannedUrls(plan,{layer,cadastre}),controller=new AbortController(),startedAt=Date.now();
    job={controller,total:urls.length,done:0,bytes:0,failed:0,fresh:0};
    const onOffline=()=>controller.abort('offline');window.addEventListener('offline',onOffline);
    renderProgress();
    let cache;
    try{cache=await caches.open(await cacheName());}catch{job=null;window.removeEventListener('offline',onOffline);return showError('Le stockage de la carte est indisponible (navigation privée ?).');}
    for(const batch of chunk(urls,BATCH_SIZE)){
      if(controller.signal.aborted)break;
      await Promise.all(batch.map(async url=>{
        try{
          const hit=await cache.match(url);
          if(hit){job.bytes+=Number(hit.headers.get('x-parcelles-size'))||0;return;}
          const response=await fetch(url,{mode:'cors',credentials:'omit',signal:controller.signal});
          if(!response.ok)throw new Error(`HTTP ${response.status}`);
          const blob=await response.blob();
          await cache.put(url,new Response(blob,{status:200,headers:{'content-type':response.headers.get('content-type')||blob.type||'image/png','x-parcelles-cached-at':String(Date.now()),'x-parcelles-size':String(blob.size)}}));
          job.bytes+=blob.size;job.fresh++;
        }catch{if(!controller.signal.aborted)job.failed++;}
        finally{if(!controller.signal.aborted)job.done++;}
      }));
      renderProgress();
    }
    window.removeEventListener('offline',onOffline);
    const reason=controller.signal.aborted?controller.signal.reason:'',current=job;job=null;
    const complete=!reason&&current.failed<current.total;
    if(current.done>current.failed)writeMeta({at:Date.now(),layer,cadastre,tiles:current.done-current.failed,bytes:current.bytes,failed:current.failed,maxZoom:plan.zooms[plan.zooms.length-1],complete:complete&&current.done===current.total});
    await evict(cache,startedAt).catch(()=>{});
    if(document.getElementById('om-form'))open();
    if(reason==='offline')return toast('Connexion perdue : téléchargement interrompu. Les tuiles déjà reçues restent disponibles.','error',null,{persist:true});
    if(reason)return toast('Téléchargement interrompu. Les tuiles déjà reçues restent disponibles.');
    if(current.failed&&current.failed===current.total)return toast('Le service IGN ne répond pas : réessayez plus tard.','error');
    const usable=current.total-current.failed;
    const switchAction=state().preferences?.mapLayer!==layer?{label:'Utiliser ce fond',run:()=>host.setBaseLayer?.(layer)}:null;
    toast(`Carte hors ligne prête : ${formatCount(usable)} tuile${usable>1?'s':''} (${formatBytes(current.bytes)})${current.failed?`, ${formatCount(current.failed)} indisponible${current.failed>1?'s':''}`:''}.`,'success',switchAction,{persist:Boolean(switchAction)});
  }
  async function evict(cache,keepAfter){
    const keys=await cache.keys();let total=0;const rows=[];
    for(const request of keys){const response=await cache.match(request);const size=Number(response?.headers.get('x-parcelles-size'))||0,cachedAt=Number(response?.headers.get('x-parcelles-cached-at'))||0;total+=size;rows.push({url:request.url,size,cachedAt:cachedAt>=keepAfter?Number.MAX_SAFE_INTEGER:cachedAt});}
    if(total<=TILE_CAP_BYTES)return 0;
    const drop=evictionList(rows,TILE_CAP_BYTES);for(const url of drop)await cache.delete(url);
    return drop.length;
  }
  async function remove(){
    if(job)job.controller.abort('user');
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

  return {open,summary,download,remove,isBusy:()=>Boolean(job),readMeta,checkConnectivity:onConnectivity};
}
