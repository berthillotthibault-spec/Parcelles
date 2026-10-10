// n° 51 : découper une parcelle par une ligne tracée, fusionner deux parcelles adjacentes.
import {escapeHtml,formatNumber} from './utils.js';
import {simpleRing} from './geometry-ops.js';
import {previewSplit,buildSplit,previewMerge,buildMerge} from './parcel-split.js';
import {validateForm} from './form-chips-ui.js';

export const SPLIT_ACTIONS=Object.freeze(['split-undo','split-cancel','split-cut']);

export function createParcelSplitUI({getMap,store,toast,modal,closeModal,mapModes,parcelById,uid,showMap=null,snap=null,onDone=null}){
  let session=null; // {parcelId, points, layer, panel, click}

  function panelEl(){
    let panel=document.getElementById('map-split-panel');
    if(!panel){panel=document.createElement('div');panel.id='map-split-panel';panel.className='map-draw-panel map-split-panel hidden';panel.setAttribute('aria-live','polite');const anchor=document.getElementById('map-draw-panel');if(anchor)anchor.after(panel);else document.body.append(panel);}
    return panel;
  }

  function render(message=''){
    if(!session)return;
    const p=parcelById(session.parcelId),n=session.points.length;
    session.panel.innerHTML=`<div><strong>Découper · ${escapeHtml(p?.nom||'')}</strong><small data-split-count>${n?`${n} point${n>1?'s':''} · la ligne doit traverser la parcelle d’un bord à l’autre`:'Tracez la ligne de découpe en partant de l’extérieur de la parcelle.'}</small><small class="form-error" data-split-error ${message?'':'hidden'}>${escapeHtml(message)}</small></div><button class="small-button" data-action="split-undo" ${n?'':'disabled'}>Annuler le point</button><button class="small-button" data-action="split-cancel">Quitter</button><button class="button primary" data-action="split-cut" ${n>=2?'':'disabled'}>Découper</button>`;
    session.layer.clearLayers();
    const latlngs=session.points.map(([lng,lat])=>[lat,lng]);
    if(latlngs.length>=2)L.polyline(latlngs,{pane:'editingPane',color:'#b3261e',weight:3,dashArray:'8 6',interactive:false}).addTo(session.layer);
    latlngs.forEach(ll=>L.circleMarker(ll,{pane:'editingPane',radius:5,color:'#fff',weight:2,fillColor:'#b3261e',fillOpacity:1,interactive:false}).addTo(session.layer));
  }

  function stop(){
    if(!session)return;const pm=getMap();pm?.map?.off('click',session.click);session.layer.remove();session.panel.classList.add('hidden');session.panel.innerHTML='';session=null;
    if(pm){pm.editing=false;pm.map?.getContainer()?.classList.remove('is-drawing');pm.restorePopups?.();}
  }

  function startSplit(parcelId){
    const parcel=parcelById(parcelId);
    const check=simpleRing(parcel?.geometry);if(check.error){toast?.(check.error,'error');return false;}
    if(mapModes.current){mapModes.leave(()=>startSplit(parcelId),{reason:'switch'});return false;}
    showMap?.();
    const pm=getMap();pm?.init();const map=pm?.map;if(!map||!window.L){toast?.('La carte doit être disponible pour découper.','error');return false;}
    if(pm.multiple)pm.toggleMultiple(false);map.closePopup();
    const click=e=>{if(!session)return;const s=snap?.(e.latlng)||null,ll=s?.snapped?s.latlng:e.latlng;session.points.push([ll.lng,ll.lat]);render();};
    session={parcelId,points:[],layer:L.layerGroup().addTo(map),panel:panelEl(),click};
    pm.editing=true;pm.suspendPopups?.();map.getContainer().classList.add('is-drawing');map.on('click',click);
    mapModes.enter('split',{cleanup:()=>stop(),isDirty:()=>false});
    session.panel.classList.remove('hidden');render();
    try{const b=L.geoJSON(parcel.geometry).getBounds();setTimeout(()=>{if(session)map.fitBounds(b,{padding:[80,80],maxZoom:18});},60);}catch{}
    return true;
  }

  function cut(){
    if(!session)return;
    const parcel=parcelById(session.parcelId);if(!parcel){mapModes.exit({name:'split',force:true});return;}
    const prev=previewSplit(parcel,session.points);
    if(prev.error){render(prev.error);return;}
    // Aperçu des deux morceaux sur la carte.
    const colors=['#2f7d4f','#c26a1b'];
    prev.parts.forEach((part,i)=>L.geoJSON(part.geometry,{pane:'editingPane',interactive:false,style:()=>({color:colors[i],weight:3,fillColor:colors[i],fillOpacity:.25})}).addTo(session.layer));
    modal('Découper la parcelle',prev.summary,`<form id="split-form" class="form-grid">${prev.parts.map((part,i)=>`<label>Nom du morceau ${escapeHtml(part.label)} · ${formatNumber(part.areaHa)} ha<input name="name${i}" required maxlength="80" value="${escapeHtml(part.name)}"></label>`).join('')}<p class="notice info">« ${escapeHtml(parcel.nom)} » sera archivée avec son historique et ses travaux. Les deux nouvelles fiches indiqueront « issue de ${escapeHtml(parcel.nom)} ».</p></form>`,'<button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="split-save">Découper</button>','small');
    const form=document.getElementById('split-form');
    document.getElementById('split-save').onclick=async()=>{
      if(!validateForm(form))return;
      const current=parcelById(parcel.id);if(!current)return;
      const {children,original}=buildSplit(current,prev.parts,[form.elements.name0.value,form.elements.name1.value],[uid(),uid()]);
      await store.upsertMany('parcelles',[...children,original],{label:`Parcelle découpée : ${current.nom}`});
      closeModal();mapModes.exit({name:'split',force:true,reason:'close'});
      toast?.(`${current.nom} découpée en ${children.map(c=>c.nom).join(' et ')}.`,'success');
      onDone?.(children[0].id);
    };
  }

  function canMerge(ids){
    if(ids?.length!==2)return false;
    const [a,b]=ids.map(id=>parcelById(id));if(!a?.geometry||!b?.geometry)return false;
    return!previewMerge(a,b).error;
  }

  function openMerge(ids){
    if(ids?.length!==2){toast?.('Sélectionnez exactement deux parcelles qui se touchent.','error');return;}
    const [a,b]=ids.map(id=>parcelById(id));
    const prev=previewMerge(a,b);if(prev.error){toast?.(prev.error,'error');return;}
    modal('Fusionner les parcelles',`${a.nom} + ${b.nom} · ${formatNumber(prev.areaHa)} ha`,`<form id="merge-form" class="form-grid"><label>Nom de la parcelle fusionnée<input name="nom" required maxlength="80" value="${escapeHtml(a.nom)}"></label><p class="notice info">Les deux parcelles d’origine seront archivées avec leurs travaux. La nouvelle fiche reprend la culture et les informations de « ${escapeHtml(a.nom)} ».</p></form>`,'<button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="merge-save">Fusionner</button>','small');
    const form=document.getElementById('merge-form');
    document.getElementById('merge-save').onclick=async()=>{
      if(!validateForm(form))return;
      const {merged,originals}=buildMerge(parcelById(a.id),parcelById(b.id),prev.geometry,form.elements.nom.value,uid());
      await store.upsertMany('parcelles',[merged,...originals],{label:`Parcelles fusionnées : ${a.nom} + ${b.nom}`});
      closeModal();toast?.(`Parcelles fusionnées en ${merged.nom}.`,'success');onDone?.(merged.id,{merged:true});
    };
  }

  function handleAction(action){
    if(!session)return false;
    if(action==='split-undo'){session.points.pop();render();}
    else if(action==='split-cancel')mapModes.exit({name:'split',force:true,reason:'close'});
    else if(action==='split-cut')cut();
    else return false;
    return true;
  }

  return{startSplit,cut,canMerge,openMerge,handleAction,stop,get active(){return Boolean(session);}};
}
