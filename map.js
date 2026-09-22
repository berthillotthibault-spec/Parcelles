import {parcelGrazingHtml} from './grazing-ui.js';
import {escapeHtml, formatNumber, geometryCentroid, geometryAreaHa, haversineMeters, normalize} from './utils.js';
import {fetchRpgFeatures, rpgFeatureId} from './rpg.js';

const DEFAULT_CENTER=[46.31,4.95];
const CULTURE_PALETTE=['#287a4a','#4b8f6a','#7a9d44','#b08a32','#7f6bb2','#3f83a8','#bd6f4a','#699b8a','#9a6d3f','#557a9c','#8c7a3f','#a36d8e'];
const STATUS_COLORS={'a faire':'#d89821','en cours':'#3178c6','termine':'#2f8a57','en retard':'#c33b36','a jour':'#4d8f67'};
const RPG_STYLE={color:'#805000',weight:2.5,opacity:1,fillColor:'#f6ce59',fillOpacity:.34,dashArray:'6 3'};

function cultureColor(culture=''){
  const key=normalize(culture);let hash=0;for(let i=0;i<key.length;i++)hash=(hash*31+key.charCodeAt(i))>>>0;return CULTURE_PALETTE[hash%CULTURE_PALETTE.length];
}
function statusColor(status=''){const key=normalize(status);return Object.entries(STATUS_COLORS).find(([k])=>key.includes(k))?.[1]||'#4d8f67';}
function bboxSquare(lat,lon,radiusKm){
  const dLat=radiusKm/111.32,dLon=radiusKm/(111.32*Math.max(.2,Math.cos(lat*Math.PI/180)));
  return{type:'Polygon',coordinates:[[[lon-dLon,lat-dLat],[lon+dLon,lat-dLat],[lon+dLon,lat+dLat],[lon-dLon,lat+dLat],[lon-dLon,lat-dLat]]]};
}

export class ParcelMap{
  constructor({onSelect=null,onToast=null,onPointPlaced=null}={}){
    this.onSelect=onSelect;this.onToast=onToast;this.onPointPlaced=onPointPlaced;
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
    this.layers.parcels=L.featureGroup().addTo(this.map);this.layers.points=L.layerGroup().addTo(this.map);this.layers.rpg=L.layerGroup().addTo(this.map);this.layers.gps=L.layerGroup().addTo(this.map);this.layers.drawing=L.layerGroup().addTo(this.map);this.layers.measure=L.layerGroup().addTo(this.map);
    this.setBaseLayer('osm');
  }

  setBaseLayer(name='osm'){
    this.init();if(!this.map)return;
    name=name==='satellite'?'satellite':'osm';
    if(this.baseLayer&&this.baseLayerName===name)return;
    if(this.baseLayer)this.map.removeLayer(this.baseLayer);
    if(name==='satellite'){
      this.baseLayer=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20,attribution:'Tiles © Esri — Sources Esri, Maxar, Earthstar Geographics'});
    }else{
      this.baseLayer=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap contributors'});
    }
    this.baseLayer.addTo(this.map);this.baseLayerName=name;
  }

  setColorMode(mode){const next=mode==='status'?'status':'culture';if(this.colorMode===next)return;this.colorMode=next;this.render(this.lastState);}
  colorFor(parcel){return this.colorMode==='status'?statusColor(parcel.status):cultureColor(parcel.culture||'Sans culture');}

  render(state){
    this.lastState=state;this.init();if(!this.map)return;
    const parcels=(state.parcelles||[]).filter(item=>!item.deletedAt),points=(state.points||[]).filter(item=>!item.deletedAt);this.layers.parcels.clearLayers();this.layers.points.clearLayers();this.pointMarkers.clear();
    parcels.filter(parcel=>parcel.geometry).forEach(parcel=>this.addParcel(parcel));
    points.filter(point=>point.latitude!==null&&point.latitude!==undefined&&point.latitude!==''&&point.longitude!==null&&point.longitude!==undefined&&point.longitude!==''&&Number.isFinite(Number(point.latitude))&&Number.isFinite(Number(point.longitude))).forEach(point=>{
      const marker=L.circleMarker([Number(point.latitude),Number(point.longitude)],{pane:'mapPointPane',radius:9,color:'#fff',weight:3,fillColor:'#824510',fillOpacity:1}).addTo(this.layers.points),id=escapeHtml(point.id),note=point.note??point.notes;
      this.bindMapPopup(marker,`<div class="map-point-popup"><strong>${escapeHtml(point.nom||point.name||point.type||'Point')}</strong><small>${escapeHtml(point.type||'Point repéré')}</small>${note?`<p>${escapeHtml(note)}</p>`:''}<div class="map-popup-actions"><button type="button" data-action="edit-map-point" data-id="${id}">Modifier</button><button type="button" data-action="move-map-point" data-id="${id}">Déplacer</button><button type="button" class="danger" data-action="delete-map-point" data-id="${id}">Supprimer</button></div></div>`,{maxWidth:320});
      this.pointMarkers.set(String(point.id),marker);
    });
    this.setLegend();
  }

  // Leaflet's native popup click handler stops propagation. Unbinding during a
  // map tool keeps parcel/RPG/point clicks available to the placement handler.
  mapToolActive(){return Boolean(this.pointPlacementHandler||this.polygonDraw||this.measure);}
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
    layer.bindPopup(content,{...this.mapPopupPadding(),...options});if(this.mapToolActive())this.suspendPopups(layer);return layer;
  }

  focusPoint(id,{openPopup=true}={}){
    this.init();const marker=this.pointMarkers.get(String(id));if(!this.map||!marker)return false;
    this.map.setView(marker.getLatLng(),Math.max(this.map.getZoom(),17));if(openPopup){const popup=marker.getPopup();if(popup)Object.assign(popup.options,this.mapPopupPadding());marker.openPopup();}return true;
  }

  addParcel(parcel){
    try{
      const selected=parcel.id===this.selectedId,color=this.colorFor(parcel);
      const pane=selected?'selectedParcelPane':'parcelPane';
      if(selected)L.geoJSON(parcel.geometry,{pane,interactive:false,style:{color:'#fff',weight:9,opacity:1,fill:false}}).addTo(this.layers.parcels);
      const layer=L.geoJSON(parcel.geometry,{pane,style:()=>({color:selected?'#092c1c':color,weight:selected?5:3,opacity:1,fillColor:color,fillOpacity:selected?.52:.3}),pointToLayer:(feature,latlng)=>L.circleMarker(latlng,{pane,radius:8,color,fillColor:color,fillOpacity:.8})});
      layer.on('click',()=>{if(!this.pointPlacementHandler&&!this.polygonDraw&&!this.measure)this.select(parcel.id,{zoom:false});});
      this.bindMapPopup(layer,`<div class="parcel-popup"><strong>${escapeHtml(parcel.nom)}</strong><small>${escapeHtml(parcel.culture||'Culture non renseignée')} · ${formatNumber(parcel.surfaceHa)} ha${parcel.commune?` · ${escapeHtml(parcel.commune)}`:''}</small>${parcelGrazingHtml(this.lastState.grazingSessions,parcel.id,{compact:true})}<button type="button" data-map-open="${escapeHtml(parcel.id)}">Ouvrir la fiche</button></div>`);
      layer.addTo(this.layers.parcels);
    }catch(error){console.warn('[Parcelles] Géométrie ignorée',parcel.id,error);}
  }

  setLegend(){
    const legend=document.querySelector('#map-legend');if(!legend)return;
    const parcels=(this.lastState.parcelles||[]).filter(p=>!p.deletedAt&&p.geometry);
    const values=this.colorMode==='status'?[...new Set(parcels.map(p=>p.status||'À jour'))]:[...new Set(parcels.map(p=>p.culture||'Sans culture'))];
    legend.innerHTML=`<button class="legend-toggle" type="button" data-action="toggle-legend">Légende</button><div class="legend-content">${values.slice(0,10).map(value=>`<div class="legend-item"><span class="legend-dot" style="background:${this.colorMode==='status'?statusColor(value):cultureColor(value)}"></span>${escapeHtml(value)}</div>`).join('')}${this.rpgVisible?'<div class="legend-item"><span class="legend-swatch rpg"></span> RPG/PAC</div>':''}<div class="legend-item"><span class="legend-dot gps"></span> Position</div></div>`;
  }

  select(id,{zoom=true}={}){
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
    this.init();if(!this.map){this.onToast?.('La carte doit être disponible pour dessiner une parcelle.','error');onCancel?.();return;}this.cancelPolygonDrawing(false);this.cancelPointPlacement();this.cancelMeasurement();this.map.closePopup();
    const points=[];const click=event=>{points.push([event.latlng.lng,event.latlng.lat]);this.layers.drawing.clearLayers();const latlngs=points.map(([lng,lat])=>[lat,lng]);if(points.length>=3)L.polygon(latlngs,{pane:'editingPane',color:'#17663f',weight:3,fillColor:'#61b985',fillOpacity:.2,dashArray:'6 5'}).addTo(this.layers.drawing);else if(points.length>=2)L.polyline(latlngs,{pane:'editingPane',color:'#17663f',weight:3,dashArray:'6 5'}).addTo(this.layers.drawing);points.forEach(([lng,lat],index)=>L.circleMarker([lat,lng],{pane:'editingPane',radius:5,color:'#fff',weight:2,fillColor:'#17663f',fillOpacity:1}).bindTooltip(String(index+1),{permanent:false}).addTo(this.layers.drawing));onUpdate?.(points.length);};
    this.polygonDraw={points,click,onUpdate,onComplete,onCancel};this.suspendPopups();this.map.on('click',click);this.map.getContainer().classList.add('is-drawing');onUpdate?.(0);
  }
  finishPolygonDrawing(){
    if(!this.polygonDraw)return null;const {points,onComplete}=this.polygonDraw;if(points.length<3)throw new Error('Ajoutez au moins 3 points pour dessiner la parcelle.');const ring=[...points,points[0]];const geometry={type:'Polygon',coordinates:[ring]};this.cancelPolygonDrawing(false);onComplete?.(geometry);return geometry;
  }
  cancelPolygonDrawing(notify=true){
    if(!this.polygonDraw)return;const {click,onCancel}=this.polygonDraw;this.map?.off('click',click);this.layers.drawing?.clearLayers();this.map?.getContainer()?.classList.remove('is-drawing');this.polygonDraw=null;this.restorePopups();if(notify)onCancel?.();
  }
  undoPolygonPoint(){if(!this.polygonDraw?.points.length)return 0;this.polygonDraw.points.pop();const pts=[...this.polygonDraw.points],cfg={...this.polygonDraw};this.cancelPolygonDrawing(false);this.startPolygonDrawing({onUpdate:cfg.onUpdate,onComplete:cfg.onComplete,onCancel:cfg.onCancel});for(const [lng,lat] of pts){const event={latlng:{lng,lat}};this.polygonDraw.click(event);}return pts.length;}

  startMeasurement(kind='distance',{onUpdate,onComplete,onCancel}={}){
    this.init();if(!this.map){this.onToast?.('La carte doit être disponible pour mesurer.','error');return;}this.cancelMeasurement(false);this.cancelPointPlacement();this.cancelPolygonDrawing();this.map.closePopup();const points=[];const render=()=>{this.layers.measure.clearLayers();const latlngs=points.map(p=>[p.latitude,p.longitude]);if(kind==='area'&&points.length>=3)L.polygon(latlngs,{pane:'editingPane',color:'#6d4fd3',weight:3,fillColor:'#8c78da',fillOpacity:.16,dashArray:'6 5'}).addTo(this.layers.measure);else if(points.length>=2)L.polyline(latlngs,{pane:'editingPane',color:'#6d4fd3',weight:3,dashArray:'6 5'}).addTo(this.layers.measure);points.forEach((p,i)=>L.circleMarker([p.latitude,p.longitude],{pane:'editingPane',radius:5,color:'#fff',weight:2,fillColor:'#6d4fd3',fillOpacity:1}).bindTooltip(String(i+1)).addTo(this.layers.measure));let value=0;if(kind==='distance'&&points.length>1)for(let i=1;i<points.length;i++)value+=haversineMeters(points[i-1],points[i]);if(kind==='area'&&points.length>=3){const ring=points.map(p=>[p.longitude,p.latitude]);ring.push(ring[0]);value=geometryAreaHa({type:'Polygon',coordinates:[ring]});}onUpdate?.({kind,points:[...points],value});};const click=e=>{points.push({latitude:e.latlng.lat,longitude:e.latlng.lng});render();};this.measure={kind,points,click,onUpdate,onComplete,onCancel};this.suspendPopups();this.map.on('click',click);this.map.getContainer().classList.add('is-measuring');render();
  }
  finishMeasurement(){if(!this.measure)return null;const {kind,points,onComplete}=this.measure;let value=0;if(kind==='distance'){if(points.length<2)throw new Error('Ajoutez au moins deux points.');for(let i=1;i<points.length;i++)value+=haversineMeters(points[i-1],points[i]);}else{if(points.length<3)throw new Error('Ajoutez au moins trois points.');const ring=points.map(p=>[p.longitude,p.latitude]);ring.push(ring[0]);value=geometryAreaHa({type:'Polygon',coordinates:[ring]});}this.map.off('click',this.measure.click);this.map.getContainer().classList.remove('is-measuring');this.measure=null;this.restorePopups();onComplete?.({kind,points,value});return value;}
  undoMeasurementPoint(){if(!this.measure?.points.length)return;this.measure.points.pop();const cfg={kind:this.measure.kind,onUpdate:this.measure.onUpdate,onComplete:this.measure.onComplete,onCancel:this.measure.onCancel},pts=[...this.measure.points];this.cancelMeasurement(false);this.startMeasurement(cfg.kind,cfg);for(const p of pts)this.measure.click({latlng:{lat:p.latitude,lng:p.longitude}});}
  cancelMeasurement(notify=true){if(!this.measure)return;const {click,onCancel}=this.measure;this.map?.off('click',click);this.layers.measure?.clearLayers();this.map?.getContainer()?.classList.remove('is-measuring');this.measure=null;this.restorePopups();if(notify)onCancel?.();}

  centroidOfParcel(parcel){return geometryCentroid(parcel?.geometry);}
  dispose(){this.cancelRpgLoad();if(this.watchId!==null)navigator.geolocation.clearWatch(this.watchId);this.cancelPointPlacement();this.cancelPolygonDrawing(false);this.cancelMeasurement();}
}
