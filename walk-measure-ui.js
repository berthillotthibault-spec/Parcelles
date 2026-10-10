// n° 50 : mesurer en marchant, puis transformer la mesure en parcelle, en contour ou en zone.
import {escapeHtml,formatNumber,geometryCentroid,geometryAreaHa} from './utils.js';
import {acceptFix,walkStats,walkSummary,accuracyLevel,walkGeometry,nearestParcels} from './walk-measure.js';
import {nextSurfaceHa} from './contour-edit.js';
import {chipify,validateForm} from './form-chips-ui.js';

export const WALK_ACTIONS=Object.freeze(['walk-undo','walk-finish','walk-cancel','walk-keep','walk-discard']);

export function createWalkMeasureUI({getMap,store,toast,modal,closeModal,mapModes,getState,showMap=null,createParcel=null,onSaved=null}){
  let session=null; // {watchId, points, last, layer, panel, confirm}

  function panelEl(){
    let panel=document.getElementById('map-walk-panel');
    if(!panel){panel=document.createElement('div');panel.id='map-walk-panel';panel.className='map-draw-panel map-walk-panel hidden';panel.setAttribute('aria-live','polite');const anchor=document.getElementById('map-measure-panel')||document.getElementById('map-draw-panel');if(anchor)anchor.after(panel);else document.body.append(panel);}
    return panel;
  }

  function render(){
    if(!session)return;
    const stats=walkStats(session.points),acc=accuracyLevel(session.last?.accuracy);
    const confirm=session.confirm?'<div class="map-mode-confirm" role="alertdialog"><strong>Abandonner la mesure en cours ?</strong><div><button type="button" class="button secondary" data-action="walk-keep">Continuer</button><button type="button" class="button danger" data-action="walk-discard">Abandonner</button></div></div>':'';
    session.panel.innerHTML=`<div><strong>Mesure en marchant</strong><small class="walk-stats" data-walk-stats>${escapeHtml(walkSummary(stats))}</small><small class="walk-accuracy is-${acc.level}" data-walk-accuracy>${escapeHtml(acc.label)}</small></div><button class="small-button" data-action="walk-undo" ${session.points.length?'':'disabled'}>Annuler le point</button><button class="small-button" data-action="walk-cancel">Quitter</button><button class="button primary" data-action="walk-finish" ${session.points.length>=3?'':'disabled'}>Terminer</button>${confirm}`;
    session.panel.classList.toggle('is-confirming',Boolean(session.confirm));
    const map=getMap()?.map;if(!map||!window.L)return;
    session.layer.clearLayers();
    const latlngs=session.points.map(p=>[p.latitude,p.longitude]);
    if(latlngs.length>=3)L.polygon(latlngs,{pane:'editingPane',color:'#6d4fd3',weight:3,fillColor:'#8c78da',fillOpacity:.16,interactive:false}).addTo(session.layer);
    else if(latlngs.length>=2)L.polyline(latlngs,{pane:'editingPane',color:'#6d4fd3',weight:3,interactive:false}).addTo(session.layer);
    latlngs.forEach(ll=>L.circleMarker(ll,{pane:'editingPane',radius:3,color:'#6d4fd3',weight:1,fillColor:'#fff',fillOpacity:1,interactive:false}).addTo(session.layer));
  }

  function onFix(position){
    if(!session)return;
    const {latitude,longitude,accuracy}=position.coords;
    session.last={latitude,longitude,accuracy};
    getMap()?.setPosition?.(latitude,longitude,accuracy); // cercle de précision et événement parcelles:gps
    const res=acceptFix(session.points,session.last);
    if(res.accept)session.points.push({latitude,longitude,accuracy});
    render();
  }

  function stopWatch(){if(session?.watchId!=null)navigator.geolocation?.clearWatch(session.watchId);if(session)session.watchId=null;}

  function stop(){if(!session)return;stopWatch();session.layer.remove();session.panel.classList.add('hidden');session.panel.innerHTML='';const pm=getMap();session=null;if(pm){pm.editing=false;pm.restorePopups?.();}}

  function begin(){
    if(!navigator.geolocation){toast?.('La géolocalisation n’est pas disponible sur cet appareil.','error');return false;}
    showMap?.();
    const pm=getMap();pm?.init();const map=pm?.map;if(!map||!window.L){toast?.('La carte doit être disponible pour mesurer.','error');return false;}
    if(pm.multiple)pm.toggleMultiple(false);map.closePopup();
    session={watchId:null,points:[],last:null,layer:L.layerGroup().addTo(map),panel:panelEl(),confirm:null};
    pm.editing=true;pm.suspendPopups?.();
    mapModes.enter('walk',{cleanup:()=>stop(),isDirty:()=>Boolean(session&&session.points.length>=3)});
    session.panel.classList.remove('hidden');render();
    session.watchId=navigator.geolocation.watchPosition(p=>{onFix(p);if(!session)return;const ll=L.latLng(p.coords.latitude,p.coords.longitude);if(map.getZoom()<16||!map.getBounds().pad(-0.2).contains(ll))map.setView(ll,Math.max(map.getZoom(),17),{animate:false});},error=>{if(error?.code!==1&&(error?.code===3||session?.last))return; // perte passagère ou délai dépassé : on continue d'attendre
      toast?.(`Position indisponible : ${error?.code===1?'autorisez la localisation pour cette application.':error?.message||'vérifiez le GPS.'}`,'error');},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    return true;
  }

  function start(){
    if(mapModes.current){mapModes.leave(()=>start(),{reason:'switch'});return;}
    if(getState()?.preferences?.gpsConsent){begin();return;}
    modal('Utiliser votre position ?','La mesure en marchant enregistre votre trace GPS sur cet appareil.','<div class="notice info">Un point est posé tous les 3 m quand la précision vaut 8 m ou moins. La position reste sur cet appareil.</div>','<button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="walk-allow-gps">Continuer</button>','small');
    document.getElementById('walk-allow-gps').onclick=async()=>{await store.setPreferences({gpsConsent:true});closeModal();begin();};
  }

  function finish(){
    if(!session)return;
    const {geometry,error}=walkGeometry(session.points);
    if(error){toast?.(error,'error');return;}
    const stats=walkStats(session.points);
    stopWatch();stop();mapModes.release('walk');
    openResult(geometry,stats);
  }

  function openResult(geometry,stats){
    const area=geometryAreaHa(geometry);
    modal('Mesure terminée',walkSummary(stats),`<div class="walk-result-choices"><button class="menu-row" data-walk-choice="parcel"><span>◇</span><span><strong>Créer une parcelle</strong><small>Nouvelle fiche avec ce contour (${formatNumber(area)} ha)</small></span><b>›</b></button><button class="menu-row" data-walk-choice="replace"><span>◈</span><span><strong>Remplacer le contour de…</strong><small>Une parcelle existante, la plus proche en premier</small></span><b>›</b></button><button class="menu-row" data-walk-choice="zone"><span>▱</span><span><strong>Enregistrer comme zone</strong><small>Repère avec contour : zone humide, mouillère, dégât…</small></span><b>›</b></button></div>`,'<button class="button secondary" data-action="close-modal">Fermer sans enregistrer</button>','small');
    const root=document.querySelector('.walk-result-choices');
    root?.querySelector('[data-walk-choice="parcel"]')?.addEventListener('click',()=>{closeModal();createParcel?.(geometry,area);});
    root?.querySelector('[data-walk-choice="replace"]')?.addEventListener('click',()=>openReplace(geometry));
    root?.querySelector('[data-walk-choice="zone"]')?.addEventListener('click',()=>openZone(geometry,stats));
  }

  function openReplace(geometry){
    const rows=nearestParcels(geometry,(getState()?.parcelles||[]).filter(p=>!p.archived));
    if(!rows.length){toast?.('Aucune parcelle avec contour à remplacer.','error');return;}
    modal('Remplacer le contour','Choisissez la parcelle dont le contour sera remplacé par la mesure.',`<form id="walk-replace-form"><label>Parcelle<select name="parcelId" required><option value="">Choisir…</option>${rows.map(r=>`<option value="${escapeHtml(r.parcel.id)}">${escapeHtml(r.parcel.nom)} · ${r.distance<1000?`${Math.round(r.distance)} m`:`${formatNumber(r.distance/1000)} km`}</option>`).join('')}</select></label></form>`,'<button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="walk-replace-save">Remplacer</button>','small');
    const form=document.getElementById('walk-replace-form'),select=form.elements.parcelId;
    chipify(select,{options:rows.map(r=>({value:r.parcel.id,label:r.parcel.nom})),other:null,ariaLabel:'Parcelle'});
    document.getElementById('walk-replace-save').onclick=async()=>{
      if(!validateForm(form))return;
      const parcel=(getState()?.parcelles||[]).find(p=>p.id===select.value);if(!parcel)return;
      const before=geometryAreaHa(parcel.geometry),after=geometryAreaHa(geometry);
      await store.upsert('parcelles',{...parcel,geometry,surfaceHa:nextSurfaceHa(parcel.surfaceHa,before,after)},{label:`Contour remplacé par une mesure à pied : ${parcel.nom}`});
      closeModal();toast?.(`Contour de ${parcel.nom} remplacé (${formatNumber(after)} ha).`,'success');onSaved?.('parcelles',parcel.id);
    };
  }

  function openZone(geometry,stats){
    modal('Enregistrer comme zone','La zone apparaît sur la carte comme un repère avec son contour.',`<form id="walk-zone-form"><label>Nom<input name="nom" required maxlength="80" value="Zone mesurée du ${escapeHtml(new Date().toLocaleDateString('fr-FR'))}"></label><label>Note<textarea name="note" rows="2" placeholder="Ex. zone humide à contourner"></textarea></label></form>`,'<button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="walk-zone-save">Enregistrer</button>','small');
    const form=document.getElementById('walk-zone-form');
    document.getElementById('walk-zone-save').onclick=async()=>{
      if(!validateForm(form))return;
      const c=geometryCentroid(geometry),area=geometryAreaHa(geometry);
      const saved=await store.upsert('points',{nom:form.elements.nom.value.trim(),type:'Zone',note:form.elements.note.value.trim(),latitude:c.latitude,longitude:c.longitude,geometry,areaHa:Number(area.toFixed(4)),perimeterM:Math.round(stats.perimeterM),source:'local'},{label:`Zone enregistrée : ${form.elements.nom.value.trim()}`});
      closeModal();toast?.(`Zone enregistrée (${formatNumber(area)} ha).`,'success');onSaved?.('points',saved?.id);
    };
  }

  function askAbandon(confirm,cancel){if(!session){confirm();return;}session.confirm={confirm,cancel};render();}

  function handleAction(action){
    if(!session)return false;
    if(action==='walk-undo'){session.points.pop();render();}
    else if(action==='walk-finish')finish();
    else if(action==='walk-cancel'){if(session.points.length>=3)askAbandon(()=>mapModes.exit({name:'walk',force:true,reason:'close'}),()=>{});else mapModes.exit({name:'walk',force:true,reason:'close'});}
    else if(action==='walk-keep'){const c=session.confirm;session.confirm=null;render();c?.cancel?.();}
    else if(action==='walk-discard'){const c=session.confirm;session.confirm=null;c?.confirm?.();if(session)mapModes.exit({name:'walk',force:true,reason:'close'});}
    else return false;
    return true;
  }

  return{start,stop,finish,askAbandon,handleAction,get active(){return Boolean(session);},get points(){return session?[...session.points]:[];}};
}
