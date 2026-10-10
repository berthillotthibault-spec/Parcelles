import {mapEconomics,economicColor} from './pilotage.js';
import {parcelSituation,localDay} from './home-priorities.js';
import {parcelGrazingHtml} from './grazing-ui.js';
import {escapeHtml, formatNumber, geometryCentroid, geometryAreaHa, haversineMeters, normalize, pointInGeometry} from './utils.js';
import {labelPoint,labelLevel,labelLines,resolveLabelCollisions} from './map-labels.js';
import {legendGroups,legendLine,legendStyle,groupBounds} from './map-legend.js';
import {fetchRpgFeatures, rpgFeatureId} from './rpg.js';
import {bcae7ColorInfo} from './pac.js'; // v5b n° 58
import {activeReentries} from './phyto.js';
import {parcelIft,iftColor} from './ift.js';
import {windToward,windTowardWater,compass,forecastAge} from './spray-window.js';
import {baseLayerDefinition,CADASTRE_OVERLAY,normalizeCadastreOpacity,cadastreQueryUrl,parseCadastreResponse,cadastreReference} from './basemaps.js';

const DEFAULT_CENTER=[46.31,4.95];
const CULTURE_PALETTE=['#287a4a','#4b8f6a','#7a9d44','#b08a32','#7f6bb2','#3f83a8','#bd6f4a','#699b8a','#9a6d3f','#557a9c','#8c7a3f','#a36d8e'];
// Couleurs de culture de la maquette v3 (table CULT), avant la palette de repli.
const DESIGN_CULTURE_COLORS=[['prairie temp','#9ccb83'],['prairie','#6fb37a'],['ble','#d9a441'],['colza','#e3d34a'],['mais','#e0873a'],['orge','#c7b06a'],['tournesol','#f0b429'],['jachere','#b3aa9b']];
const STATUS_COLORS={'a faire':'#d89821','en cours':'#3178c6','termine':'#2f8a57','en retard':'#c33b36','a jour':'#4d8f67'};
const RPG_STYLE={color:'#805000',weight:2.5,opacity:1,fillColor:'#f6ce59',fillOpacity:.34,dashArray:'6 3'};

function cultureColor(culture=''){
  const key=normalize(culture);const known=DESIGN_CULTURE_COLORS.find(([prefix])=>key.startsWith(prefix));if(known)return known[1];let hash=0;for(let i=0;i<key.length;i++)hash=(hash*31+key.charCodeAt(i))>>>0;return CULTURE_PALETTE[hash%CULTURE_PALETTE.length];
}
function statusColor(status=''){const key=normalize(status);return Object.entries(STATUS_COLORS).find(([k])=>key.includes(k))?.[1]||'#4d8f67';}
function bboxSquare(lat,lon,radiusKm){
  const dLat=radiusKm/111.32,dLon=radiusKm/(111.32*Math.max(.2,Math.cos(lat*Math.PI/180)));
  return{type:'Polygon',coordinates:[[[lon-dLon,lat-dLat],[lon+dLon,lat-dLat],[lon+dLon,lat+dLat],[lon-dLon,lat+dLat],[lon-dLon,lat-dLat]]]};
}

export class ParcelMap{
  constructor({onSelect=null,onToast=null,onPointPlaced=null}={}){
    this.multiple=false;this.selectedIds=new Set();this.situations=new Map();this.onSelect=onSelect;this.onToast=onToast;this.onPointPlaced=onPointPlaced;
    this.map=null;this.layers={};this.baseLayer=null;this.baseLayerName=null;this.lastState={parcelles:[],points:[]};this.selectedId=null;this.watchId=null;this.gpsMarker=null;this.colorMode='culture';this.rpgVisible=false;this.rpgData=null;this.pointPlacementHandler=null;this.polygonDraw=null;this.measure=null;this.followGps=false;this.unavailable=false;
    this.suspendedPopups=new Map();this.pointMarkers=new Map();this.pointPlacementCancel=null;this.rpgFeatures=new Map();this.rpgLoadController=null;this.rpgLoadSequence=0;
  }

  init(){
    if(this.map)return;
    if(!window.L){this.unavailable=true;const el=document.querySelector('#map');if(el&&!el.querySelector('.map-unavailable'))el.innerHTML='<div class="map-unavailable"><strong>Carte temporairement indisponible</strong><span>Les parcelles, travaux et données restent utilisables. Reconnectez-vous puis rechargez pour activer le fond cartographique.</span></div>';return;}
    this.unavailable=false;const el=document.querySelector('#map');if(el)el.innerHTML='';
    // SVG uses per-shape hit testing; full-pane canvases would intercept taps
    // meant for RPG geometries in the panes below points or owned parcels.
    // Rapid taps on a feature then its popup action can become a synthetic
    // double click on the map. Pinch, wheel and +/- controls remain available.
    this.map=L.map('map',{zoomControl:false,preferCanvas:false,doubleClickZoom:false}).setView(DEFAULT_CENTER,12);
    L.control.zoom({position:'bottomright'}).addTo(this.map);
    for(const [name,zIndex] of [['rpgPane',350],['parcelPane',410],['selectedParcelPane',430],['mapPointPane',500],['editingPane',550]]){this.map.createPane(name).style.zIndex=String(zIndex);}
    this.layers.parcels=L.featureGroup().addTo(this.map);this.layers.points=L.layerGroup().addTo(this.map);this.layers.rpg=L.layerGroup().addTo(this.map);this.layers.gps=L.layerGroup().addTo(this.map);this.layers.drawing=L.layerGroup().addTo(this.map);this.layers.measure=L.layerGroup().addTo(this.map);this.layers.labels=L.layerGroup().addTo(this.map);this.labelEntries=[];this.map.on('moveend resize',()=>this.updateLabels());
    this.map.createPane('cadastrePane').style.zIndex='300';this.map.getPane('cadastrePane').style.pointerEvents='none';
    this.map.on('click',event=>this.handleCadastreClick(event));
    this.setBaseLayer('osm');
  }

  clearFarmOverlay(){this.farmOverlay?.remove();this.farmControl?.remove();this.farmRenderer?.remove();this.farmOverlay=null;this.farmControl=null;this.farmRenderer=null;}
  clearYieldOverlay(){const had=!!this.yieldOverlay;this.yieldOverlay?.remove();this.yieldRenderer?.remove();this.yieldRenderer=null;this.yieldControl?.remove();this.yieldOverlay=null;this.yieldControl=null;if(had&&this.map)this.render(this.lastState);}
  clearSatelliteOverlay(){const hadOverlay=!!this.satelliteOverlay;this.satelliteOverlay?.remove();this.satelliteControl?.remove();this.satelliteOverlay=null;this.satelliteControl=null;this.satelliteLabel='';if(hadOverlay&&this.map)this.render(this.lastState);}
  setSatelliteOpacity(value){this.satelliteOpacity=value;this.satelliteImage?.setOpacity(value);}
  setSatelliteOverlay({url,bounds,geometry,zones=[],label}){
    this.clearFarmOverlay();this.clearYieldOverlay();
    this.init();if(!this.map)return;this.clearSatelliteOverlay();
    if(!this.map.getPane('satelliteDataPane')){const pane=this.map.createPane('satelliteDataPane');pane.style.zIndex='420';pane.style.pointerEvents='none';}
    this.satelliteParcelId=this.selectedId;this.satelliteOverlay=L.layerGroup().addTo(this.map);this.satelliteOpacity=.7;this.satelliteLabel=label;
    this.satelliteImage=url?L.imageOverlay(url,[[bounds[1],bounds[0]],[bounds[3],bounds[2]]],{pane:'satelliteDataPane',opacity:.7,interactive:false}).addTo(this.satelliteOverlay):null;
    if(!url)L.geoJSON(geometry,{pane:'satelliteDataPane',interactive:false,style:{color:'#d89821',weight:3,fill:false,dashArray:'5 4'}}).addTo(this.satelliteOverlay);
    for(const zone of zones)L.geoJSON(zone.geometry,{pointToLayer:(_,latlng)=>L.circleMarker(latlng,{pane:'satelliteDataPane',radius:3,color:'#d36d14',fillOpacity:.7,interactive:false})}).addTo(this.satelliteOverlay);
    const control=L.control({position:'topleft'});control.onAdd=()=>{const div=L.DomUtil.create('div','satellite-map-label');const text=document.createElement('span');text.textContent=label+(zones.length?' · points : secteurs de faible NDVI':'');div.append(text);const legend=document.createElement('small');legend.textContent=url?' · indice : brun = faible, vert/bleu = élevé':'';div.append(legend);const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent='Désactiver';button.onclick=()=>this.clearSatelliteOverlay();div.append(button);L.DomEvent.disableClickPropagation(div);return div;};control.addTo(this.map);this.satelliteControl=control;this.render(this.lastState);
  }

  setBaseLayer(name='osm'){
    this.init();if(!this.map)return;
    const def=baseLayerDefinition(name);
    if(this.baseLayer&&this.baseLayerName===def.id)return;
    if(this.baseLayer)this.map.removeLayer(this.baseLayer);
    this.baseLayer=L.tileLayer(def.url,{maxZoom:def.maxZoom,...(def.maxNativeZoom?{maxNativeZoom:def.maxNativeZoom}:{}),attribution:def.attribution});
    this.baseLayer.addTo(this.map);this.baseLayerName=def.id;
  }

  // Surcouche cadastrale IGN (Parcellaire Express). Le clic sur la carte
  // interroge API Carto uniquement quand cette surcouche est visible.
  setCadastreOverlay(visible,opacity){
    this.init();if(!this.map)return;
    const value=normalizeCadastreOpacity(opacity??this.cadastreOpacity);this.cadastreOpacity=value;
    if(!visible){if(this.cadastreLayer){this.map.removeLayer(this.cadastreLayer);this.cadastreLayer=null;}this.clearCadastreSelection();return;}
    if(this.cadastreLayer){this.cadastreLayer.setOpacity(value);return;}
    this.cadastreLayer=L.tileLayer(CADASTRE_OVERLAY.url,{pane:'cadastrePane',opacity:value,maxZoom:CADASTRE_OVERLAY.maxZoom,maxNativeZoom:CADASTRE_OVERLAY.maxNativeZoom,attribution:CADASTRE_OVERLAY.attribution}).addTo(this.map);
  }
  setCadastreOpacity(value){this.cadastreOpacity=normalizeCadastreOpacity(value);this.cadastreLayer?.setOpacity(this.cadastreOpacity);}
  getCadastreInfo(idu){return this.cadastreInfo&&this.cadastreInfo.idu===idu?structuredClone(this.cadastreInfo):null;}
  clearCadastreSelection(){this.cadastreController?.abort();this.cadastreController=null;this.cadastreHighlight?.remove();this.cadastreHighlight=null;if(this.cadastrePopup){const popup=this.cadastrePopup;this.cadastrePopup=null;this.map?.closePopup(popup);}}
  cadastrePopupHtml(info){
    const area=info.contenanceM2===null?'':`Contenance : ${formatNumber(info.contenanceM2/10000)} ha (${new Intl.NumberFormat('fr-FR').format(info.contenanceM2)} m²)`;
    return`<div class="rpg-popup cadastre-popup"><strong>Parcelle cadastrale</strong><small>${escapeHtml(cadastreReference(info))}${info.commune?` · ${escapeHtml(info.commune)}`:''}</small>${area?`<small>${area}</small>`:''}<small class="cadastre-note">Indicatif : le cadastre n’a pas de valeur de bornage.</small>${info.geometry&&info.idu?`<button type="button" data-action="add-cadastre-parcel" data-id="${escapeHtml(info.idu)}">Créer une parcelle depuis ce contour</button>`:''}</div>`;
  }
  async handleCadastreClick(event){
    if(!this.cadastreLayer||!this.map||this.mapToolActive()||this.multiple)return;
    const target=event?.originalEvent?.target;
    if(target?.closest?.('.leaflet-interactive,.leaflet-marker-icon,.leaflet-popup,.leaflet-control'))return;
    const latlng=event?.latlng;if(!latlng)return;
    this.clearCadastreSelection();
    const popup=L.popup({...this.mapPopupPadding(),maxWidth:320}).setLatLng(latlng);this.cadastrePopup=popup;
    popup.on('remove',()=>{if(this.cadastrePopup===popup){this.cadastrePopup=null;this.cadastreController?.abort();this.cadastreController=null;this.cadastreHighlight?.remove();this.cadastreHighlight=null;}});
    const show=html=>{if(this.cadastrePopup===popup){popup.setContent(html);if(!this.map.hasLayer(popup))popup.openOn(this.map);}};
    if(typeof navigator!=='undefined'&&navigator.onLine===false){show('<div class="rpg-popup cadastre-popup"><strong>Cadastre indisponible</strong><small>Hors connexion : la consultation cadastrale reprendra au retour du réseau.</small></div>');return;}
    show('<div class="rpg-popup cadastre-popup" role="status"><strong>Cadastre</strong><small>Recherche de la parcelle cadastrale…</small></div>');
    const controller=new AbortController();this.cadastreController=controller;const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(cadastreQueryUrl(latlng.lat,latlng.lng),{signal:controller.signal,headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const info=parseCadastreResponse(await response.json());
      if(this.cadastreController!==controller)return;
      if(!info){show('<div class="rpg-popup cadastre-popup"><strong>Aucune parcelle cadastrale</strong><small>Ce point n’est pas couvert par une parcelle cadastrée (route, cours d’eau, domaine public…).</small></div>');return;}
      this.cadastreInfo=info;
      if(info.geometry)this.cadastreHighlight=L.geoJSON(info.geometry,{pane:'editingPane',interactive:false,style:{color:'#b3261e',weight:3,dashArray:'6 4',fill:true,fillOpacity:.08}}).addTo(this.map);
      show(this.cadastrePopupHtml(info));
    }catch(error){
      if(this.cadastreController!==controller)return;
      show('<div class="rpg-popup cadastre-popup"><strong>Cadastre injoignable</strong><small>Le service cadastral de l’IGN ne répond pas pour le moment. Réessayez dans un instant.</small></div>');
    }finally{clearTimeout(timer);if(this.cadastreController===controller)this.cadastreController=null;}
  }

  setColorMode(mode){const next=['culture','status','work','animals','last','client','cost','margin','ift','bcae7'].includes(mode)?mode:'culture';if(this.colorMode===next)return;this.colorMode=next;this.legendFocus=null;this.render(this.lastState);}
  colorInfo(parcel){
    if(this.colorMode==='bcae7')return bcae7ColorInfo(this.lastState,parcel); // v5b n° 58
    if(['cost','margin'].includes(this.colorMode)){const row=this.economics?.get(parcel.id);return economicColor(row?.[this.colorMode==='cost'?'costHa':'marginHa'],this.colorMode);}
    if(this.colorMode==='ift'){const r=this.ift?.get(parcel.id);return iftColor(!r?null:r.treatments&&r.missing===r.treatments?null:r.total);}
    const context=this.situations.get(parcel.id),status=context?.status;
    if(this.colorMode==='status')return {label:status?.label||'Rien d’urgent signalé',color:status?.color||'#2f8054'};
    if(this.colorMode==='animals')return {label:context?.grazing.length?'Animaux présents':'Sans animaux',color:context?.grazing.length?'#3178c6':'#778579'};
    const label=this.colorMode==='client'?(this.lastState.clients||[]).find(c=>!c.deletedAt&&c.id===parcel.clientId)?.name||'Sans client':
      this.colorMode==='work'?context?.next?.item.type||context?.next?.item.title||'Aucun travail prévu':
      this.colorMode==='last'?context?.last?.date?.slice(0,10)||'Aucune intervention réalisée':parcel.culture||'Sans culture';
    return {label,color:cultureColor(label)};
  }
  colorFor(parcel){return this.colorInfo(parcel).color;}
  // n° 60 — vent actuel (prévision de l’exploitation) : flèche sur la parcelle sélectionnée.
  setWind(wind){this.wind=wind&&Number.isFinite(Number(wind.direction))?wind:null;}
  drawWind(){
    if(!this.map)return;this.layers.wind??=L.layerGroup().addTo(this.map);this.layers.wind.clearLayers();
    const parcel=this.wind&&!this.multiple?(this.lastState.parcelles||[]).find(p=>p.id===this.selectedId&&!p.deletedAt&&p.geometry):null;if(!parcel)return;
    const c=geometryCentroid(parcel.geometry);if(!c)return;
    const from=Number(this.wind.direction),toward=windToward(from),water=windTowardWater(parcel,(this.lastState.points||[]).filter(p=>!p.deletedAt),from),speed=Number(this.wind.speed);
    const age=this.wind.loadedAt&&Date.now()-this.wind.loadedAt>3600000?` · ${forecastAge({loadedAt:this.wind.loadedAt},Date.now(),{online:navigator.onLine!==false})}`:'';
    const text=`Vent ${Number.isFinite(speed)?formatNumber(Math.round(speed)):'?'} km/h du ${compass(from)}${water?' · vent vers le cours d’eau':''}`;
    const html=`<div class="map-wind${water?' is-water':''}" role="img" aria-label="${escapeHtml(text+age)}"><svg viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${Math.round(toward)}deg)"><path d="M12 2l6 9h-4.2v11h-3.6V11H6z"/></svg><span>${escapeHtml(`Vent ${Number.isFinite(speed)?formatNumber(Math.round(speed)):'?'} km/h du ${compass(from)}`)}<small>${escapeHtml([water?'Vers le cours d’eau':'',age.replace(/^ · /,'')].filter(Boolean).join(' · '))}</small></span></div>`;
    L.marker([c.latitude,c.longitude],{interactive:false,keyboard:false,icon:L.divIcon({className:'map-wind-icon',html,iconSize:null})}).addTo(this.layers.wind);
  }
  toggleMultiple(enabled=!this.multiple){
    this.cancelPointPlacement();this.cancelPolygonDrawing();this.cancelMeasurement();this.multiple=enabled;
    if(!enabled){this.selectedIds.clear();this.restorePopups();}this.map?.closePopup();this.render(this.lastState);this.notifySelection();
  }
  notifySelection(){document.dispatchEvent(new CustomEvent('parcelles:selection',{detail:{enabled:this.multiple,ids:[...this.selectedIds]}}));}

  render(state){
    this.lastState=state;try{this.reentries=activeReentries(state);}catch{this.reentries=new Map();}this.economics=['cost','margin'].includes(this.colorMode)?mapEconomics(state):null;this.ift=this.colorMode==='ift'?new Map((state.parcelles||[]).filter(p=>!p.deletedAt).map(p=>[p.id,parcelIft(state,p.id)])):null;
    const grouped=new Map((state.parcelles||[]).filter(p=>!p.deletedAt).map(p=>[p.id,{}]));
    for(const type of ['interventions','tasks','grazingSessions','observations'])for(const row of state[type]||[]){const group=grouped.get(row.parcelId);if(group)(group[type]??=[]).push(row);}
    this.situations=new Map([...grouped].map(([id,group])=>[id,parcelSituation(group,id,localDay())]));
    for(const id of this.selectedIds)if(!grouped.has(id))this.selectedIds.delete(id);
    this.init();if(!this.map)return;
    const parcels=(state.parcelles||[]).filter(item=>!item.deletedAt),points=(state.points||[]).filter(item=>!item.deletedAt);const forget=layer=>{this.suspendedPopups.delete(layer);layer.eachLayer?.(forget);};forget(this.layers.parcels);forget(this.layers.points);this.layers.parcels.clearLayers();this.layers.points.clearLayers();this.pointMarkers.clear();
    this.labelEntries=[];parcels.filter(parcel=>parcel.geometry).forEach(parcel=>this.addParcel(parcel));this.updateLabels();
    points.filter(point=>point.latitude!==null&&point.latitude!==undefined&&point.latitude!==''&&point.longitude!==null&&point.longitude!==undefined&&point.longitude!==''&&Number.isFinite(Number(point.latitude))&&Number.isFinite(Number(point.longitude))).forEach(point=>{
      if(point.geometry&&['Polygon','MultiPolygon'].includes(point.geometry.type))L.geoJSON(point.geometry,{pane:'parcelPane',interactive:false,style:()=>({color:'#824510',weight:2,dashArray:'5 4',fillColor:'#c98a4b',fillOpacity:.14})}).addTo(this.layers.points); // v6a n° 50 : zone mesurée
      const marker=L.circleMarker([Number(point.latitude),Number(point.longitude)],{pane:'mapPointPane',radius:9,color:'#fff',weight:3,fillColor:'#824510',fillOpacity:1}).addTo(this.layers.points),id=escapeHtml(point.id),note=point.note??point.notes;
      this.bindMapPopup(marker,`<div class="map-point-popup"><strong>${escapeHtml(point.nom||point.name||point.type||'Point')}</strong><small>${escapeHtml(point.type||'Point repéré')}</small>${note?`<p>${escapeHtml(note)}</p>`:''}<div class="map-popup-actions"><button type="button" data-action="edit-map-point" data-id="${id}">Modifier</button><button type="button" data-action="move-map-point" data-id="${id}">Déplacer</button><button type="button" class="danger" data-action="delete-map-point" data-id="${id}">Supprimer</button></div></div>`,{maxWidth:320});
      this.pointMarkers.set(String(point.id),marker);
    });
    this.setLegend();this.drawWind();
  }

  // Leaflet's native popup click handler stops propagation. Unbinding during a
  // map tool keeps parcel/RPG/point clicks available to the placement handler.
  mapToolActive(){return Boolean(this.pointPlacementHandler||this.polygonDraw||this.measure||this.editing);}
  suspendPopups(layer){
    const visit=item=>{const popup=item.getPopup?.();if(popup){this.suspendedPopups.set(item,popup);item.unbindPopup();}item.eachLayer?.(visit);};
    if(layer)visit(layer);else for(const group of Object.values(this.layers))visit(group);
  }
  restorePopups(){
    if(this.mapToolActive())return;
    for(const [layer,popup] of this.suspendedPopups)layer.bindPopup(popup);
    this.suspendedPopups.clear();
  }
  mapPopupPadding(){
    const style=typeof getComputedStyle==='function'&&document.documentElement?getComputedStyle(document.documentElement):null;
    const inset=Math.max(0,Number.parseFloat(style?.getPropertyValue('--map-top-inset'))||0);
    const bar=document.querySelector('.map-topbar')?.getBoundingClientRect?.(),bounds=this.map?.getContainer?.()?.getBoundingClientRect?.();
    const top=Math.max(80+inset,bar&&bounds?bar.bottom-bounds.top+10:0);
    return{autoPanPaddingTopLeft:[12,top],autoPanPaddingBottomRight:[12,10]};
  }
  bindMapPopup(layer,content,options){
    // Update before Leaflet opens the popup, including after a screen rotation.
    layer.on('click',()=>{const popup=layer.getPopup?.();if(popup)Object.assign(popup.options,this.mapPopupPadding());});
    layer.bindPopup(content,{...this.mapPopupPadding(),...options});if(this.mapToolActive()||this.multiple)this.suspendPopups(layer);return layer;
  }

  focusPoint(id,{openPopup=true}={}){
    this.init();const marker=this.pointMarkers.get(String(id));if(!this.map||!marker)return false;
    this.map.setView(marker.getLatLng(),Math.max(this.map.getZoom(),17));if(openPopup){const popup=marker.getPopup();if(popup)Object.assign(popup.options,this.mapPopupPadding());marker.openPopup();}return true;
  }

  addParcel(parcel){
    try{
      const selected=this.multiple?this.selectedIds.has(parcel.id):parcel.id===this.selectedId,color=this.colorFor(parcel);
      const pane=selected?'selectedParcelPane':'parcelPane';
      if(selected)L.geoJSON(parcel.geometry,{pane,interactive:false,style:{color:'#fff',weight:9,opacity:1,fill:false}}).addTo(this.layers.parcels);
      const dimmed=this.legendFocus!=null&&!selected&&this.colorInfo(parcel).label!==this.legendFocus;
      const reentry=this.reentries?.get(parcel.id);
      const layer=L.geoJSON(parcel.geometry,{pane,style:()=>legendStyle({color:selected?'#092c1c':reentry?'#b3261e':color,weight:selected?5:3,opacity:1,...(reentry&&!selected?{dashArray:'7 5'}:{}),fillColor:color,fillOpacity:((this.satelliteOverlay&&this.satelliteParcelId===parcel.id)||(this.yieldOverlay&&this.yieldParcelId===parcel.id))?0:(selected?.52:.3)},{focus:dimmed?this.legendFocus:null,label:''}),pointToLayer:(feature,latlng)=>L.circleMarker(latlng,{pane,radius:8,color,fillColor:color,fillOpacity:.8})});
      layer.on('click',()=>{if(this.mapToolActive())return;if(this.multiple){if(this.selectedIds.has(parcel.id))this.selectedIds.delete(parcel.id);else this.selectedIds.add(parcel.id);this.render(this.lastState);this.notifySelection();}else this.select(parcel.id,{zoom:false});});
      this.bindMapPopup(layer,`<div class="parcel-popup"><strong>${escapeHtml(parcel.nom)}</strong><small>${escapeHtml(parcel.culture||'Culture non renseignée')} · ${formatNumber(parcel.surfaceHa)} ha${parcel.commune?` · ${escapeHtml(parcel.commune)}`:''}</small><small>${escapeHtml(this.colorInfo(parcel).label)}</small>${reentry?`<small class="map-reentry">${escapeHtml(reentry.label)}</small>`:''}${parcelGrazingHtml(this.lastState.grazingSessions,parcel.id,{compact:true,state:this.lastState})}<button type="button" data-map-open="${escapeHtml(parcel.id)}">Ouvrir la fiche</button></div>`);
      if(parcel.nom&&parcel.geometry?.type!=='Point')if(!dimmed)this.labelEntries.push({parcel,selected,reentry,point:labelPoint(parcel.geometry),areaHa:Number(parcel.surfaceHa)||geometryAreaHa(parcel.geometry)||0});
      layer.addTo(this.layers.parcels);
    }catch(error){console.warn('[Parcelles] Géométrie ignorée',parcel.id,error);}
  }

  // n° 45 : étiquettes selon le zoom, au pôle d'inaccessibilité, masquées si elles chevauchent ou débordent.
  updateLabels(){
    const group=this.layers?.labels;if(!this.map||!group)return;group.clearLayers();
    if(document.documentElement.classList.contains('hide-parcel-labels'))return;
    const size=this.map.getSize();if(!size.x||!size.y)return;
    const zoom=this.map.getZoom(),view=this.map.getBounds().pad(.2),box=this.map.getContainer().getBoundingClientRect(),items=[];
    for(const entry of this.labelEntries||[]){
      if(!entry.point)continue;const latlng=L.latLng(entry.point[1],entry.point[0]);if(!view.contains(latlng))continue;
      const lines=labelLines(entry.parcel,{level:labelLevel(zoom,entry.areaHa),colorMode:this.colorMode,grazingSessions:this.lastState.grazingSessions,areaHa:entry.areaHa});if(!lines.length)continue;
      const html=`<span class="pl-name">${escapeHtml(lines[0])}</span>${lines[1]?`<span class="pl-sub">${escapeHtml(lines[1])}</span>`:''}${entry.reentry?`<span class="parcel-label-reentry">${escapeHtml(entry.reentry.label)}</span>`:''}`;
      const tooltip=L.tooltip({permanent:true,direction:'center',className:entry.reentry?'parcel-label has-reentry':'parcel-label',interactive:false,opacity:1}).setLatLng(latlng).setContent(html);group.addLayer(tooltip);
      items.push({id:entry.parcel.id,tooltip,geometry:entry.parcel.geometry,priority:(entry.selected?1e9:0)+entry.areaHa});
    }
    // Mesure en une passe après insertion, pour ne forcer qu'une mise en page.
    for(const item of items){const r=item.tooltip.getElement()?.getBoundingClientRect();item.rect=r&&r.width?{x:r.left-box.left,y:r.top-box.top,w:r.width,h:r.height}:null;}
    const fits=item=>{const {x,y,w,h}=item.rect;if(x<0||y<0||x+w>size.x||y+h>size.y)return false;return [[x+1,y+1],[x+w-1,y+1],[x+1,y+h-1],[x+w-1,y+h-1],[x+w/2,y+h/2]].every(([px,py])=>{const ll=this.map.containerPointToLatLng([px,py]);return pointInGeometry(ll.lng,ll.lat,item.geometry);});};
    const visible=resolveLabelCollisions(items,{fits});
    for(const item of items)if(!visible.has(item.id))item.tooltip.getElement()?.classList.add('is-label-hidden');
  }

  // n° 53 : appui = isoler la catégorie et cadrer ; appui long (ou Maj + Entrée) = liste filtrée. Affichage seulement.
  bindLegend(legend){
    if(legend.dataset.legendBound)return;legend.dataset.legendBound='1';let timer=null,longPressed=false;
    const groupOf=target=>this.legendValues?.[Number(target?.closest?.('[data-legend-index]')?.dataset.legendIndex)];
    const openList=group=>{if(group)document.dispatchEvent(new CustomEvent('parcelles:legend-filter',{detail:{label:group.label,ids:[...group.ids],mode:this.colorMode}}));};
    const cancel=()=>{clearTimeout(timer);timer=null;};
    legend.addEventListener('pointerdown',event=>{const group=groupOf(event.target);if(!group)return;longPressed=false;cancel();timer=setTimeout(()=>{longPressed=true;timer=null;openList(group);},550);});
    for(const type of ['pointerup','pointerleave','pointercancel'])legend.addEventListener(type,cancel);
    legend.addEventListener('contextmenu',event=>{if(groupOf(event.target))event.preventDefault();});
    legend.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.shiftKey){const group=groupOf(event.target);if(group){event.preventDefault();openList(group);}}});
    legend.addEventListener('click',event=>{
      if(event.target.closest('[data-legend-reset]')){this.isolateLegend(null);return;}
      const group=groupOf(event.target);if(!group)return;
      if(longPressed){longPressed=false;event.preventDefault();return;}
      this.isolateLegend(this.legendFocus===group.label?null:group.label);
    });
  }
  isolateLegend(label){
    this.legendFocus=label??null;this.render(this.lastState);
    const group=label!=null?this.legendValues?.find(v=>v.label===label):null;
    const bounds=group&&groupBounds(this.lastState.parcelles,group.ids);
    if(this.map&&bounds){try{this.map.fitBounds(L.latLngBounds(bounds).pad(.15),{maxZoom:17});}catch{}}
    document.querySelector('#map-legend [aria-pressed="true"]')?.focus({preventScroll:true});
  }

  setLegend(){
    const legend=document.querySelector('#map-legend');if(!legend)return;
    const parcels=(this.lastState.parcelles||[]).filter(p=>!p.deletedAt&&p.geometry);
    const values=legendGroups(parcels,p=>this.colorInfo(p));this.legendValues=values;if(this.legendFocus!=null&&!values.some(v=>v.label===this.legendFocus))this.legendFocus=null;this.bindLegend(legend);
    legend.innerHTML=`<button class="legend-toggle" type="button" data-action="toggle-legend">Légende · ${{culture:'Culture',status:'État',work:'Travaux',animals:'Animaux',last:'Dernière intervention',client:'Client',cost:'Coût/ha',margin:'Marge/ha',ift:'IFT',bcae7:'BCAE 7'}[this.colorMode]}${['cost','margin','bcae7'].includes(this.colorMode)?` · ${this.economics?.values().next().value?.campaign||''}`:''}</button><div class="legend-content">${this.legendFocus!=null?'<button type="button" class="legend-reset" data-legend-reset="1">Tout afficher</button>':''}${values.map((info,index)=>`<button type="button" class="legend-item legend-filter${this.legendFocus===info.label?' is-focused':''}${this.legendFocus!=null&&this.legendFocus!==info.label?' is-dimmed':''}" data-legend-index="${index}" aria-pressed="${this.legendFocus===info.label}" title="Appui : isoler sur la carte · appui long : voir la liste"><span class="legend-dot" style="background:${info.color}"></span><span class="legend-text">${escapeHtml(legendLine(info))}</span></button>`).join('')}${this.rpgVisible?'<div class="legend-item"><span class="legend-swatch rpg"></span> RPG/PAC</div>':''}<div class="legend-item"><span class="legend-dot gps"></span> Position</div></div>`;
  }

  select(id,{zoom=true}={}){
    if(this.farmOverlay&&this.selectedId!==id)this.clearFarmOverlay();
    if(this.yieldOverlay&&this.yieldParcelId!==id)this.clearYieldOverlay();
    if(this.satelliteOverlay&&this.satelliteParcelId!==id)this.clearSatelliteOverlay();
    this.selectedId=id;const parcel=(this.lastState.parcelles||[]).find(item=>item.id===id&&!item.deletedAt);if(!parcel)return;
    this.render(this.lastState);
    if(zoom&&parcel.geometry){try{const bounds=L.geoJSON(parcel.geometry).getBounds();if(bounds.isValid())this.map.fitBounds(bounds.pad(.18),{maxZoom:17});}catch{}}
    this.onSelect?.(parcel);
  }

  fitParcels(){
    if(!this.layers.parcels?.getLayers().length){this.onToast?.('Aucune géométrie de parcelle à cadrer.');return;}
    const bounds=this.layers.parcels.getBounds();if(bounds.isValid())this.map.fitBounds(bounds.pad(.12));
  }

  locate({tracking=false}={}){
    if(!navigator.geolocation){this.onToast?.('La géolocalisation n’est pas disponible sur cet appareil.','error');return;}
    const onPosition=position=>{const{latitude,longitude,accuracy}=position.coords;this.setPosition(latitude,longitude,accuracy);if(!tracking&&this.map)this.map.setView([latitude,longitude],Math.max(this.map.getZoom(),16));};
    const onError=error=>this.onToast?.(`Position indisponible : ${error.message||'vérifiez l’autorisation GPS.'}`,'error');
    if(tracking){if(this.watchId!==null)return;this.watchId=navigator.geolocation.watchPosition(onPosition,onError,{enableHighAccuracy:true,maximumAge:5000,timeout:15000});}
    else navigator.geolocation.getCurrentPosition(onPosition,onError,{enableHighAccuracy:true,maximumAge:30000,timeout:15000});
  }

  setPosition(latitude,longitude,accuracy){
    const status=accuracy<=10?'GPS précis':accuracy<=30?'GPS correct':'GPS faible';document.dispatchEvent(new CustomEvent('parcelles:gps',{detail:{latitude,longitude,accuracy,status}}));
    this.init();if(!this.map||!window.L||!this.layers.gps)return;
    this.layers.gps.clearLayers();L.circle([latitude,longitude],{radius:accuracy,color:'#1f67c1',weight:1,fillColor:'#4f8edb',fillOpacity:.12}).addTo(this.layers.gps);
    this.gpsMarker=this.bindMapPopup(L.marker([latitude,longitude],{icon:L.divIcon({className:'',html:'<div class="gps-marker"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(this.layers.gps),`Position GPS · précision ± ${Math.round(accuracy)} m`);if(this.followGps)this.map.setView([latitude,longitude],Math.max(this.map.getZoom(),16),{animate:true});
  }

  toggleTracking({follow=false}={}){
    if(this.watchId===null){this.followGps=Boolean(follow);this.locate({tracking:true});this.onToast?.(this.followGps?'Suivi GPS avec recentrage activé.':'Suivi GPS activé.');return true;}
    navigator.geolocation.clearWatch(this.watchId);this.watchId=null;this.followGps=false;this.onToast?.('Suivi GPS arrêté.');return false;
  }
  setFollowGps(value){this.followGps=Boolean(value);return this.followGps;}

  cancelRpgLoad(){
    this.rpgLoadSequence++;this.rpgLoadController?.abort();this.rpgLoadController=null;
  }

  async loadRpgNearby({latitude,longitude,radiusKm=5,year=2024,signal,onProgress}={}){
    this.init();if(!this.map)throw new Error('La carte n’est pas disponible sur cet appareil pour le moment.');
    latitude=Number(latitude);longitude=Number(longitude);radiusKm=Number(radiusKm);year=Number(year);
    if(!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180||!Number.isFinite(radiusKm)||radiusKm<=0)throw new Error('Coordonnées ou rayon RPG invalides.');
    this.cancelRpgLoad();const sequence=this.rpgLoadSequence,controller=new AbortController();this.rpgLoadController=controller;
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try{
      const data=await fetchRpgFeatures({geometry:bboxSquare(latitude,longitude,radiusKm),year,signal:controller.signal,onProgress:progress=>{if(sequence===this.rpgLoadSequence&&!controller.signal.aborted)onProgress?.(progress);}});
      if(controller.signal.aborted||sequence!==this.rpgLoadSequence)throw new DOMException('Chargement RPG annulé.','AbortError');
      if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))throw new Error('Réponse RPG inattendue.');
      const loadedYear=Number(data.rpg?.year||year),features=new Map(data.features.map(feature=>[rpgFeatureId(feature,{year:loadedYear}),feature]));
      // Préparer la géométrie complète avant de remplacer le dernier résultat valide.
      const layer=this.createRpgLayer(data,loadedYear);this.replaceRpgLayer(layer);
      this.rpgData=data;this.rpgYear=loadedYear;this.rpgFeatures=features;this.rpgVisible=true;this.setLegend();return features.size;
    }finally{
      signal?.removeEventListener('abort',abort);if(this.rpgLoadController===controller)this.rpgLoadController=null;
    }
  }

  getRpgFeature(id){const feature=this.rpgFeatures.get(String(id));return feature?structuredClone(feature):null;}

  createRpgLayer(data,year=this.rpgYear||2024){
    return L.geoJSON(data,{pane:'rpgPane',style:RPG_STYLE,onEachFeature:(feature,layer)=>{
      const p=feature.properties||{},id=rpgFeatureId(feature,{year}),culture=p.CODE_CULTU||p.code_cultu||p.GROUPE_CULTURE||p.groupe_culture||'Culture non renseignée',surface=p.SURF_PARC??p.surf_parc??p.SURFACE??p.surface;
      this.bindMapPopup(layer,`<div class="rpg-popup"><strong>Parcelle RPG · ${escapeHtml(year)}</strong><small>${escapeHtml(culture)}${surface!==undefined&&surface!==null?` · ${formatNumber(surface)} ha`:''}</small><button type="button" data-action="add-rpg-parcel" data-id="${escapeHtml(id)}">Ajouter cette parcelle</button></div>`,{maxWidth:320});
      layer.on('mouseover',()=>layer.setStyle({weight:4,fillOpacity:.5}));layer.on('mouseout',()=>layer.setStyle(RPG_STYLE));
    }});
  }

  replaceRpgLayer(layer){
    const previous=this.layers.rpg.getLayers();
    try{layer.addTo(this.layers.rpg);}catch(error){this.layers.rpg.removeLayer(layer);throw error;}
    previous.forEach(item=>this.layers.rpg.removeLayer(item));
  }

  renderRpg(){
    if(!this.layers.rpg)return;if(!this.rpgVisible||!this.rpgData){this.layers.rpg.clearLayers();return;}
    this.replaceRpgLayer(this.createRpgLayer(this.rpgData));
  }
  setRpgVisible(value){this.rpgVisible=Boolean(value);if(!this.rpgVisible){this.cancelRpgLoad();this.layers.rpg?.clearLayers();}else if(this.rpgData)this.renderRpg();this.setLegend();}

  startPointPlacement(callback,{onCancel=null}={}){
    if(this.multiple)this.toggleMultiple(false);
    this.init();if(!this.map){this.onToast?.('La carte doit être disponible pour placer un point.','error');onCancel?.();return false;}
    this.cancelPointPlacement();this.cancelPolygonDrawing();this.cancelMeasurement();this.map.closePopup();
    this.pointPlacementCancel=onCancel;this.pointPlacementHandler=event=>{this.cancelPointPlacement(false);callback?.({latitude:event.latlng.lat,longitude:event.latlng.lng});};
    this.suspendPopups();this.map.on('click',this.pointPlacementHandler);this.map.getContainer().classList.add('is-point-placement');return true;
  }
  cancelPointPlacement(notify=true){
    const onCancel=this.pointPlacementCancel,wasActive=Boolean(this.pointPlacementHandler);if(this.pointPlacementHandler)this.map?.off('click',this.pointPlacementHandler);
    this.pointPlacementHandler=null;this.pointPlacementCancel=null;this.map?.getContainer()?.classList.remove('is-point-placement');this.restorePopups();if(wasActive&&notify)onCancel?.();
  }

  startPolygonDrawing({onUpdate,onComplete,onCancel}={}){
    if(this.multiple)this.toggleMultiple(false);
    this.init();if(!this.map){this.onToast?.('La carte doit être disponible pour dessiner une parcelle.','error');onCancel?.();return;}this.cancelPolygonDrawing(false);this.cancelPointPlacement();this.cancelMeasurement();this.map.closePopup();
    const points=[],snaps=[];const click=event=>{const snapped=this.snapper?.(event.latlng),ll=snapped?.snapped?snapped.latlng:event.latlng;points.push([ll.lng,ll.lat]);snaps.push(snapped?.snapped?snapped:null);this.layers.drawing.clearLayers();const latlngs=points.map(([lng,lat])=>[lat,lng]);if(points.length>=3)L.polygon(latlngs,{pane:'editingPane',color:'#17663f',weight:3,fillColor:'#61b985',fillOpacity:.2,dashArray:'6 5'}).addTo(this.layers.drawing);else if(points.length>=2)L.polyline(latlngs,{pane:'editingPane',color:'#17663f',weight:3,dashArray:'6 5'}).addTo(this.layers.drawing);points.forEach(([lng,lat],index)=>L.circleMarker([lat,lng],{pane:'editingPane',radius:5,color:'#fff',weight:2,fillColor:'#17663f',fillOpacity:1}).bindTooltip(String(index+1),{permanent:false}).addTo(this.layers.drawing));onUpdate?.(points.length);this.onDrawPoint?.();};
    this.polygonDraw={points,snaps,click,onUpdate,onComplete,onCancel};this.suspendPopups();this.map.on('click',click);this.map.getContainer().classList.add('is-drawing');onUpdate?.(0);this.onDrawPoint?.();
  }
  finishPolygonDrawing(){
    if(!this.polygonDraw)return null;const {points,onComplete}=this.polygonDraw;if(points.length<3)throw new Error('Ajoutez au moins 3 points pour dessiner la parcelle.');const ring=[...points,points[0]];const geometry={type:'Polygon',coordinates:[ring]};this.cancelPolygonDrawing(false);onComplete?.(geometry);return geometry;
  }
  cancelPolygonDrawing(notify=true){
    if(!this.polygonDraw)return;const {click,onCancel}=this.polygonDraw;this.map?.off('click',click);this.layers.drawing?.clearLayers();this.map?.getContainer()?.classList.remove('is-drawing');this.polygonDraw=null;this.restorePopups();if(notify)onCancel?.();
  }
  undoPolygonPoint(){if(!this.polygonDraw?.points.length)return 0;this.polygonDraw.points.pop();this.polygonDraw.snaps?.pop();const pts=[...this.polygonDraw.points],cfg={...this.polygonDraw};this.cancelPolygonDrawing(false);this.startPolygonDrawing({onUpdate:cfg.onUpdate,onComplete:cfg.onComplete,onCancel:cfg.onCancel});for(const [lng,lat] of pts){const event={latlng:{lng,lat}};this.polygonDraw.click(event);}return pts.length;}

  startMeasurement(kind='distance',{onUpdate,onComplete,onCancel}={}){
    if(this.multiple)this.toggleMultiple(false);
    this.init();if(!this.map){this.onToast?.('La carte doit être disponible pour mesurer.','error');return;}this.cancelMeasurement(false);this.cancelPointPlacement();this.cancelPolygonDrawing();this.map.closePopup();const points=[];const render=()=>{this.layers.measure.clearLayers();const latlngs=points.map(p=>[p.latitude,p.longitude]);if(kind==='area'&&points.length>=3)L.polygon(latlngs,{pane:'editingPane',color:'#6d4fd3',weight:3,fillColor:'#8c78da',fillOpacity:.16,dashArray:'6 5'}).addTo(this.layers.measure);else if(points.length>=2)L.polyline(latlngs,{pane:'editingPane',color:'#6d4fd3',weight:3,dashArray:'6 5'}).addTo(this.layers.measure);points.forEach((p,i)=>L.circleMarker([p.latitude,p.longitude],{pane:'editingPane',radius:5,color:'#fff',weight:2,fillColor:'#6d4fd3',fillOpacity:1}).bindTooltip(String(i+1)).addTo(this.layers.measure));let value=0;if(kind==='distance'&&points.length>1)for(let i=1;i<points.length;i++)value+=haversineMeters(points[i-1],points[i]);if(kind==='area'&&points.length>=3){const ring=points.map(p=>[p.longitude,p.latitude]);ring.push(ring[0]);value=geometryAreaHa({type:'Polygon',coordinates:[ring]});}onUpdate?.({kind,points:[...points],value});};const click=e=>{points.push({latitude:e.latlng.lat,longitude:e.latlng.lng});render();};this.measure={kind,points,click,onUpdate,onComplete,onCancel};this.suspendPopups();this.map.on('click',click);this.map.getContainer().classList.add('is-measuring');render();
  }
  finishMeasurement(){if(!this.measure)return null;const {kind,points,onComplete}=this.measure;let value=0;if(kind==='distance'){if(points.length<2)throw new Error('Ajoutez au moins deux points.');for(let i=1;i<points.length;i++)value+=haversineMeters(points[i-1],points[i]);}else{if(points.length<3)throw new Error('Ajoutez au moins trois points.');const ring=points.map(p=>[p.longitude,p.latitude]);ring.push(ring[0]);value=geometryAreaHa({type:'Polygon',coordinates:[ring]});}this.map.off('click',this.measure.click);this.map.getContainer().classList.remove('is-measuring');this.measure=null;this.restorePopups();onComplete?.({kind,points,value});return value;}
  undoMeasurementPoint(){if(!this.measure?.points.length)return;this.measure.points.pop();const cfg={kind:this.measure.kind,onUpdate:this.measure.onUpdate,onComplete:this.measure.onComplete,onCancel:this.measure.onCancel},pts=[...this.measure.points];this.cancelMeasurement(false);this.startMeasurement(cfg.kind,cfg);for(const p of pts)this.measure.click({latlng:{lat:p.latitude,lng:p.longitude}});}
  cancelMeasurement(notify=true){this.layers.measure?.clearLayers();if(!this.measure)return;const {click,onCancel}=this.measure;this.map?.off('click',click);this.layers.measure?.clearLayers();this.map?.getContainer()?.classList.remove('is-measuring');this.measure=null;this.restorePopups();if(notify)onCancel?.();}

  centroidOfParcel(parcel){return geometryCentroid(parcel?.geometry);}
  dispose(){this.cancelRpgLoad();if(this.watchId!==null)navigator.geolocation.clearWatch(this.watchId);this.cancelPointPlacement();this.cancelPolygonDrawing(false);this.cancelMeasurement();}
}
