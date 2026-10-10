// n° 41 : mode « Modifier le contour » sur la carte (Leaflet).
// Sommets déplaçables, poignées fantômes au milieu des segments, appui long pour
// supprimer, bandeau de surface avant/après, pile d'annulation.
import {escapeHtml,geometryAreaHa} from './utils.js';
import {createContourEdit,currentRing,applyRingChange,undoEdit,nextRing,isEditDirty,editError,editAreas,areaChangeLabel,nextSurfaceHa,midpoints,moveVertex} from './contour-edit.js';
import {ringSelfIntersects} from './geometry-ops.js';

const LONG_PRESS_MS=650;
export const CONTOUR_EDIT_ACTIONS=Object.freeze(['edit-contour-undo','edit-contour-save','edit-contour-cancel','edit-contour-ring','edit-contour-keep','edit-contour-discard']);

export function createContourEditUI({getMap,store,toast,mapModes,parcelById,showMap=null,snap=null,snapToggleHtml=null,onSaved=null}){
  let session=null; // {parcelId, edit, layer, panel, lastRemoval, confirm}
  const coarse=()=>typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches;
  const handleSize=()=>coarse()?44:24;

  function panelEl(){
    let panel=document.getElementById('map-edit-panel');
    if(!panel){
      panel=document.createElement('div');panel.id='map-edit-panel';panel.className='map-draw-panel map-edit-panel hidden';panel.setAttribute('aria-live','polite');
      const anchor=document.getElementById('map-draw-panel');
      if(anchor)anchor.after(panel);else(getMap()?.map?.getContainer()?.parentElement||document.body).append(panel);
    }
    return panel;
  }

  function renderPanel(message=''){
    if(!session)return;
    const {edit,panel}=session,parcel=parcelById(session.parcelId),{before,after}=editAreas(edit),ring=edit.rings[edit.current];
    const confirmBox=session.confirm?`<div class="map-mode-confirm" role="alertdialog" aria-label="Abandonner les modifications ?"><strong>Abandonner les modifications du contour ?</strong><div><button type="button" class="button secondary" data-action="edit-contour-keep">Continuer</button><button type="button" class="button danger" data-action="edit-contour-discard">Abandonner</button></div></div>`:'';
    panel.innerHTML=`<div><strong>Modifier le contour · ${escapeHtml(parcel?.nom||'')}</strong><small class="edit-area" data-edit-area>${escapeHtml(areaChangeLabel(before,after))}</small>${edit.rings.length>1?`<small>${escapeHtml(ring.label)} (${edit.current+1}/${edit.rings.length})</small>`:''}<small class="form-error" data-edit-error ${message?'':'hidden'}>${escapeHtml(message)}</small><small class="edit-hint">Glissez un sommet · rond pâle : ajouter · appui long ou clic droit : supprimer</small></div>${snapToggleHtml?.()||''}${edit.rings.length>1?'<button class="small-button" data-action="edit-contour-ring">Anneau suivant</button>':''}<button class="small-button" data-action="edit-contour-undo" ${edit.stack.length?'':'disabled'}>Annuler</button><button class="small-button" data-action="edit-contour-cancel">Abandonner</button><button class="button primary" data-action="edit-contour-save" ${isEditDirty(edit)?'':'disabled'}>Valider</button>${confirmBox}`;
    panel.classList.toggle('is-confirming',Boolean(session.confirm));
  }

  function setLive(points){
    if(!session)return;
    const {edit}=session,ref=edit.rings[edit.current];
    const preview=structuredClone(edit.geometry),ring=[...points,points[0]];
    if(preview.type==='Polygon')preview.coordinates[ref.ring]=ring;else preview.coordinates[ref.poly][ref.ring]=ring;
    session.outline?.setLatLngs(points.map(([lng,lat])=>[lat,lng]));
    const label=session.panel.querySelector('[data-edit-area]');if(label)label.textContent=areaChangeLabel(editAreas(edit).before,geometryAreaHa(preview));
    session.outline?.setStyle({color:ringSelfIntersects(points)?'#b3261e':'#17663f'});
  }

  const snapLonLat=(latlng)=>{const res=snap?.(latlng,{excludeParcelId:session?.parcelId,ring:currentRing(session.edit)})||null;return res?.snapped?{lonlat:[res.latlng.lng,res.latlng.lat],snapped:true}:{lonlat:[latlng.lng,latlng.lat],snapped:false};};

  function commit(op,index,lonlat){
    const res=applyRingChange(session.edit,op,index,lonlat);
    draw();renderPanel(res.ok?'':res.error);
    if(!res.ok)toast?.(res.error,'error');
    return res.ok;
  }

  function icon(ghost=false){const s=ghost?Math.round(handleSize()*0.8):handleSize();return L.divIcon({className:`edit-handle${ghost?' is-ghost':''}`,html:'<span></span>',iconSize:[s,s],iconAnchor:[s/2,s/2]});}

  function draw(){
    if(!session)return;
    const map=getMap()?.map;if(!map||!window.L)return;
    const {edit}=session;session.layer.clearLayers();
    // Autres anneaux en pointillé, anneau courant en trait plein.
    edit.rings.forEach((ref,i)=>{if(i===edit.current)return;const poly=edit.geometry.type==='Polygon'?edit.geometry.coordinates:edit.geometry.coordinates[ref.poly];L.polyline(poly[ref.ring].map(([lng,lat])=>[lat,lng]),{pane:'editingPane',color:'#17663f',weight:2,dashArray:'4 6',interactive:false}).addTo(session.layer);});
    const pts=currentRing(edit);
    session.outline=L.polygon(pts.map(([lng,lat])=>[lat,lng]),{pane:'editingPane',color:'#17663f',weight:3,fillColor:'#61b985',fillOpacity:.18,interactive:false}).addTo(session.layer);
    pts.forEach(([lng,lat],index)=>{
      const marker=L.marker([lat,lng],{draggable:true,icon:icon(),keyboard:false,zIndexOffset:1000,title:`Sommet ${index+1}`}).addTo(session.layer);
      let timer=null;const clear=()=>{clearTimeout(timer);timer=null;};
      const remove=()=>{clear();if(!session||Date.now()-session.lastRemoval<800)return;session.lastRemoval=Date.now();if(commit('remove',index))toast?.('Sommet supprimé.','info');};
      marker.on('dragstart',clear);
      marker.on('drag',e=>{const s=snapLonLat(e.target.getLatLng());e.target.getElement()?.classList.toggle('is-snapped',s.snapped);setLive(moveVertex(pts,index,s.lonlat));});
      marker.on('dragend',e=>{const s=snapLonLat(e.target.getLatLng());if(s.snapped)try{navigator.vibrate?.(10);}catch{}commit('move',index,s.lonlat);});
      marker.on('contextmenu',e=>{L.DomEvent.preventDefault(e.originalEvent||e);remove();});
      const el=marker.getElement();
      if(el){el.dataset.vertex=String(index);el.addEventListener('pointerdown',()=>{clear();timer=setTimeout(remove,LONG_PRESS_MS);});['pointerup','pointercancel','pointerleave'].forEach(t=>el.addEventListener(t,clear));}
    });
    midpoints(pts).forEach(([lng,lat],index)=>{
      const ghost=L.marker([lat,lng],{draggable:true,icon:icon(true),keyboard:false,zIndexOffset:900,title:'Ajouter un sommet'}).addTo(session.layer);
      ghost.getElement()?.setAttribute('data-ghost',String(index));
      ghost.on('drag',e=>{const s=snapLonLat(e.target.getLatLng());const live=pts.map(p=>[...p]);live.splice(index+1,0,s.lonlat);setLive(live);});
      ghost.on('dragend',e=>{const s=snapLonLat(e.target.getLatLng());if(s.snapped)try{navigator.vibrate?.(10);}catch{}commit('insert',index,s.lonlat);});
      ghost.on('click',()=>commit('insert',index,[lng,lat]));
    });
  }

  function stop(){
    if(!session)return;
    const pm=getMap();session.layer.remove();session.panel.classList.add('hidden');session.panel.innerHTML='';
    session=null;if(pm){pm.editing=false;pm.map?.getContainer()?.classList.remove('is-editing');pm.restorePopups?.();}
  }

  function start(parcelId){
    const parcel=parcelById(parcelId);
    if(!parcel?.geometry){toast?.('Cette parcelle n’a pas encore de contour : dessinez-le d’abord.','error');return false;}
    if(mapModes.current){mapModes.leave(()=>start(parcelId),{reason:'switch'});return false;}
    let edit;try{edit=createContourEdit(parcel.geometry);}catch(error){toast?.(error.message,'error');return false;}
    showMap?.();
    const pm=getMap();pm?.init();const map=pm?.map;if(!map||!window.L){toast?.('La carte doit être disponible pour modifier le contour.','error');return false;}
    if(pm.multiple)pm.toggleMultiple(false);
    map.closePopup();
    session={parcelId,edit,layer:L.layerGroup().addTo(map),panel:panelEl(),lastRemoval:0,confirm:null};
    pm.editing=true;pm.suspendPopups?.();map.getContainer().classList.add('is-editing');
    mapModes.enter('edit',{cleanup:()=>stop(),isDirty:()=>isEditDirty(session?.edit)});
    session.panel.classList.remove('hidden');
    draw();renderPanel();
    const bounds=session.outline?.getBounds();setTimeout(()=>{try{map.invalidateSize();if(bounds&&session){const m=map.getContainer().getBoundingClientRect(),r=session.panel.getBoundingClientRect(),top=r.bottom<m.top+m.height/2?Math.max(0,r.bottom-m.top):0,bottom=r.top>m.top+m.height/2?Math.max(0,m.bottom-r.top):0;map.fitBounds(bounds,{paddingTopLeft:[50,top+50],paddingBottomRight:[50,bottom+50],maxZoom:18});}}catch{}},60);
    return true;
  }

  async function save(){
    if(!session)return;
    const error=editError(session.edit);if(error){renderPanel(error);toast?.(error,'error');return;}
    const current=parcelById(session.parcelId);if(!current){stop();mapModes.release('edit');return;}
    const {before,after}=editAreas(session.edit),geometry=session.edit.geometry,id=session.parcelId;
    await store.upsert('parcelles',{...current,geometry,surfaceHa:nextSurfaceHa(current.surfaceHa,before,after)},{label:`Contour modifié : ${current.nom}`});
    stop();mapModes.release('edit');
    toast?.(`Contour enregistré · ${areaChangeLabel(before,after)}.`,'success');
    onSaved?.(id);
  }

  // Confirmation dans le bandeau quand une autre action veut quitter le mode.
  function askAbandon(confirm,cancel){if(!session){confirm();return;}session.confirm={confirm,cancel};renderPanel();session.panel.querySelector('[data-action="edit-contour-keep"]')?.focus({preventScroll:true});}

  function handleAction(action){
    if(!session)return false;
    if(action==='edit-contour-undo'){if(undoEdit(session.edit)){draw();renderPanel();}}
    else if(action==='edit-contour-ring'){nextRing(session.edit);draw();renderPanel();}
    else if(action==='edit-contour-save')save();
    else if(action==='edit-contour-cancel'){if(isEditDirty(session.edit))askAbandon(()=>{mapModes.exit({name:'edit',force:true,reason:'close'});},()=>{});else mapModes.exit({name:'edit',force:true,reason:'close'});}
    else if(action==='edit-contour-keep'){const c=session.confirm;session.confirm=null;renderPanel();c?.cancel?.();}
    else if(action==='edit-contour-discard'){const c=session.confirm;session.confirm=null;c?.confirm?.();if(session){mapModes.exit({name:'edit',force:true,reason:'close'});}}
    else return false;
    return true;
  }

  return{start,stop,save,askAbandon,handleAction,get active(){return Boolean(session);},get edit(){return session?.edit||null;}};
}
