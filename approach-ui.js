// n° 46 : boussole d'approche, pastille « Vous êtes dans : … » et « Définir l'entrée ici ».
import {escapeHtml} from './utils.js';
import {approachInfo,arrowRotation,formatDistance,headingFromOrientation,headingFromGps,whereAmI,entryPointFor,APPROACH_MAX_M} from './approach.js';

const GPS_STALE_MS=120000;

export function createApproachUI({getMap,getState,store,toast,modal,closeModal,parcelById}){
  let lastFix=null,pillTimer=null;

  // --- Consentement GPS (préférence existante gpsConsent).
  function withGps(run,reason){
    if(getState()?.preferences?.gpsConsent){run();return;}
    modal('Utiliser votre position ?',reason,'<div class="notice info">La position reste sur cet appareil.</div>','<button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="approach-allow-gps">Continuer</button>','small');
    document.getElementById('approach-allow-gps').onclick=async()=>{await store.setPreferences({gpsConsent:true});closeModal();run();};
  }

  // --- Pastille « Où suis-je ? » sur la carte, tant que le GPS est actif.
  function pillEl(){
    let el=document.getElementById('map-whereami');
    if(!el){const anchor=document.getElementById('map-draw-panel');if(!anchor)return null;el=document.createElement('div');el.id='map-whereami';el.className='map-whereami hidden';el.setAttribute('role','status');anchor.before(el);}
    return el;
  }
  function renderPill(){
    const el=pillEl();if(!el)return;
    const fresh=lastFix&&Date.now()-lastFix.at<GPS_STALE_MS;
    const info=fresh?whereAmI(lastFix,getState()):null;
    if(!info){el.classList.add('hidden');el.innerHTML='';return;}
    const id=escapeHtml(info.parcel.id);
    el.innerHTML=`<span class="whereami-text">${escapeHtml(info.text)}</span><span class="whereami-actions"><button type="button" class="small-button" data-action="new-observation" data-parcel-id="${id}">Observation</button><button type="button" class="small-button" data-action="new-work" data-parcel-id="${id}">Travail</button></span>`;
    el.classList.remove('hidden');
  }
  function onGps(event){
    const d=event.detail||{};if(!Number.isFinite(Number(d.latitude)))return;
    lastFix={latitude:Number(d.latitude),longitude:Number(d.longitude),accuracy:Number(d.accuracy),at:Date.now()};
    renderPill();clearTimeout(pillTimer);pillTimer=setTimeout(renderPill,GPS_STALE_MS+500);
  }
  function attach(){document.addEventListener('parcelles:gps',onGps);}

  // --- Boussole d'approche.
  function openApproach(parcelId){
    const parcel=parcelById(parcelId);
    if(!parcel?.geometry){toast?.('Cette parcelle n’a pas de contour : guidage impossible.','error');return;}
    withGps(()=>showCompass(parcel),'Le guidage utilise votre position et l’orientation du téléphone.');
  }

  function showCompass(parcel){
    const needsPermission=typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function';
    modal(`Aller à ${parcel.nom}`,'Guidage à vue jusqu’à l’entrée de la parcelle.',`<div class="approach" data-approach><div class="approach-dial"><svg class="approach-arrow" data-approach-arrow viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6 L80 86 L50 70 L20 86 Z"/></svg></div><p class="approach-distance" data-approach-distance>Recherche de la position…</p><p class="approach-side" data-approach-side></p><p class="approach-status" data-approach-status></p>${needsPermission?'<button type="button" class="button secondary" data-approach-compass>Activer la boussole</button>':''}</div>`,`<button class="button secondary" data-action="close-modal">Fermer</button><button class="button primary" data-action="route-parcel" data-id="${escapeHtml(parcel.id)}">Itinéraire</button>`,'small');
    const root=document.querySelector('[data-approach]');if(!root)return;
    let heading=null,gpsHeading=null,info=null,watchId=null;
    const $=s=>root.querySelector(s);
    const draw=()=>{
      if(!info)return;
      const arrow=$('[data-approach-arrow]'),h=Number.isFinite(gpsHeading)?gpsHeading:heading;
      $('[data-approach-side]').textContent=info.entrySide;
      if(info.arrived){$('[data-approach-distance]').textContent='Vous êtes arrivé';arrow.style.transform='';root.classList.add('is-arrived');$('[data-approach-status]').textContent='';return;}
      root.classList.remove('is-arrived');
      if(!info.near){root.classList.add('is-far');$('[data-approach-distance]').textContent=formatDistance(info.distanceM);$('[data-approach-status]').textContent=`La boussole s’active à moins de ${formatDistance(APPROACH_MAX_M)} : suivez l’itinéraire.`;return;}
      root.classList.remove('is-far');
      $('[data-approach-distance]').textContent=`${formatDistance(info.distanceM)} restants`;
      arrow.style.transform=`rotate(${Math.round(arrowRotation(info.bearing,h))}deg)`;
      $('[data-approach-status]').textContent=Number.isFinite(h)?'Tenez le téléphone à plat, flèche devant vous.':'Orientation inconnue : la flèche indique la direction depuis le nord (haut de l’écran = nord).';
    };
    const alive=()=>root.isConnected;
    const cleanup=()=>{if(watchId!==null)navigator.geolocation?.clearWatch(watchId);watchId=null;window.removeEventListener('deviceorientationabsolute',onOrient);window.removeEventListener('deviceorientation',onOrient);clearInterval(guard);};
    const onOrient=e=>{if(!alive())return cleanup();const h=headingFromOrientation(e);if(h!==null){heading=h;draw();}};
    const onPos=p=>{if(!alive())return cleanup();const c=p.coords;gpsHeading=headingFromGps(c);info=approachInfo({latitude:c.latitude,longitude:c.longitude},parcelById(parcel.id)||parcel,getState()?.points||[]);getMap()?.setPosition?.(c.latitude,c.longitude,c.accuracy);draw();};
    const guard=setInterval(()=>{if(!alive())cleanup();},1000);
    if(navigator.geolocation)watchId=navigator.geolocation.watchPosition(onPos,e=>{if(alive()&&e?.code===1)$('[data-approach-status]').textContent='Position refusée : autorisez la localisation.';},{enableHighAccuracy:true,maximumAge:2000,timeout:20000});
    window.addEventListener('deviceorientationabsolute',onOrient);window.addEventListener('deviceorientation',onOrient);
    $('[data-approach-compass]')?.addEventListener('click',async e=>{try{const r=await DeviceOrientationEvent.requestPermission();if(r==='granted')e.target.remove();else toast?.('Boussole refusée : la flèche reste orientée vers le nord.','info');}catch{toast?.('Boussole indisponible sur cet appareil.','info');}});
  }

  // --- « Définir l'entrée ici » en un geste.
  function defineEntryHere(parcelId){
    const parcel=parcelById(parcelId);if(!parcel)return;
    withGps(()=>{
      if(!navigator.geolocation){toast?.('La géolocalisation n’est pas disponible sur cet appareil.','error');return;}
      toast?.('Position en cours…','info');
      navigator.geolocation.getCurrentPosition(async p=>{
        const c=p.coords,entry=entryPointFor(parcel,getState()?.points||[],{latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy});
        await store.upsert('points',entry,{label:`Entrée de champ définie : ${parcel.nom}`});
        getMap()?.setPosition?.(c.latitude,c.longitude,c.accuracy);
        document.querySelectorAll(`[data-entry-status="${CSS.escape(parcel.id)}"]`).forEach(el=>{el.textContent=`Entrée définie ici (± ${Math.round(c.accuracy)} m)`;});
        toast?.(`Entrée de ${parcel.nom} définie ici (± ${Math.round(c.accuracy)} m).`,c.accuracy>30?'info':'success');
      },e=>toast?.(`Position indisponible : ${e?.code===1?'autorisez la localisation.':'réessayez à découvert.'}`,'error'),{enableHighAccuracy:true,maximumAge:5000,timeout:20000});
    },'Votre position actuelle devient l’entrée de la parcelle.');
  }

  function entryStatus(parcelId){
    const has=(getState()?.points||[]).some(pt=>!pt.deletedAt&&pt.parcelId===parcelId&&String(pt.type||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().includes('entree'));
    return`<div class="parcel-entry-row"><span data-entry-status="${escapeHtml(parcelId)}">${has?'Entrée de champ enregistrée':'Aucune entrée de champ'}</span><button type="button" class="button secondary" data-action="parcel-entry-here" data-id="${escapeHtml(parcelId)}">Définir l’entrée ici</button></div>`;
  }

  return{attach,openApproach,defineEntryHere,entryStatus,renderPill};
}
