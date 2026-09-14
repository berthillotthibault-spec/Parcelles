import {escapeHtml, formatNumber, geometryCentroid, geometryAreaHa, haversineMeters, normalize} from './utils.js';

const DEFAULT_CENTER=[46.31,4.95];
const CULTURE_PALETTE=['#287a4a','#4b8f6a','#7a9d44','#b08a32','#7f6bb2','#3f83a8','#bd6f4a','#699b8a','#9a6d3f','#557a9c','#8c7a3f','#a36d8e'];
const STATUS_COLORS={'a faire':'#d89821','en cours':'#3178c6','termine':'#2f8a57','en retard':'#c33b36','a jour':'#4d8f67'};

function cultureColor(culture=''){
  const key=normalize(culture);let hash=0;for(let i=0;i<key.length;i++)hash=(hash*31+key.charCodeAt(i))>>>0;return CULTURE_PALETTE[hash%CULTURE_PALETTE.length];
}
function statusColor(status=''){const key=normalize(status);return Object.entries(STATUS_COLORS).find(([k])=>key.includes(k))?.[1]||'#4d8f67';}
function bboxSquare(lat,lon,radiusKm){
  const dLat=radiusKm/111.32,dLon=radiusKm/(111.32*Math.max(.2,Math.cos(lat*Math.PI/180)));
  return{type:'Polygon',coordinates:[[[lon-dLon,lat-dLat],[lon+dLon,lat-dLat],[lon+dLon,lat+dLat],[lon-dLon,lat+dLat],[lon-dLon,lat-dLat]]]};
}

export class ParcelMap{
  constructor({onSelect,onToast,onPointPlaced}){
    this.onSelect=onSelect;this.onToast=onToast;this.onPointPlaced=onPointPlaced;
    this.map=null;this.layers={};this.baseLayer=null;this.lastState={parcelles:[],points:[]};this.selectedId=null;this.watchId=null;this.gpsMarker=null;this.colorMode='culture';this.rpgVisible=false;this.rpgData=null;this.pointPlacementHandler=null;this.polygonDraw=null;this.measure=null;this.followGps=false;this.unavailable=false;
  }

  init(){
    if(this.map)return;
    if(!window.L){this.unavailable=true;const el=document.querySelector('#map');if(el&&!el.querySelector('.map-unavailable'))el.innerHTML='<div class="map-unavailable"><strong>Carte temporairement indisponible</strong><span>Les parcelles, travaux et données restent utilisables. Reconnectez-vous puis rechargez pour activer le fond cartographique.</span></div>';return;}
    this.unavailable=false;const el=document.querySelector('#map');if(el)el.innerHTML='';
    this.map=L.map('map',{zoomControl:false,preferCanvas:true}).setView(DEFAULT_CENTER,12);
    L.control.zoom({position:'bottomright'}).addTo(this.map);
    this.layers.parcels=L.layerGroup().addTo(this.map);this.layers.points=L.layerGroup().addTo(this.map);this.layers.rpg=L.layerGroup().addTo(this.map);this.layers.gps=L.layerGroup().addTo(this.map);this.layers.drawing=L.layerGroup().addTo(this.map);this.layers.measure=L.layerGroup().addTo(this.map);
    this.setBaseLayer('osm');
  }

  setBaseLayer(name='osm'){
    this.init();if(!this.map)return;
    if(this.baseLayer)this.map.removeLayer(this.baseLayer);
    if(name==='satellite'){
      this.baseLayer=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20,attribution:'Tiles © Esri — Sources Esri, Maxar, Earthstar Geographics'});
    }else{
      this.baseLayer=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap contributors'});
    }
    this.baseLayer.addTo(this.map);
  }

  setColorMode(mode){this.colorMode=mode==='status'?'status':'culture';this.render(this.lastState);}
  colorFor(parcel){return this.colorMode==='status'?statusColor(parcel.status):cultureColor(parcel.culture||'Sans culture');}

  render(state){
    this.init();if(!this.map)return;this.lastState=state;
    const parcels=(state.parcelles||[]).filter(item=>!item.deletedAt),points=(state.points||[]).filter(item=>!item.deletedAt);this.layers.parcels.clearLayers();this.layers.points.clearLayers();
    parcels.filter(parcel=>parcel.geometry).forEach(parcel=>this.addParcel(parcel));
    points.filter(point=>Number.isFinite(Number(point.latitude))&&Number.isFinite(Number(point.longitude))).forEach(point=>{
      const marker=L.circleMarker([point.latitude,point.longitude],{radius:7,color:'#6a4b1f',weight:2,fillColor:'#c28a32',fillOpacity:.95}).addTo(this.layers.points);
      marker.bindPopup(`<strong>${escapeHtml(point.nom||point.type||'Point')}</strong><br>${escapeHtml(point.type||'')}${point.note?`<br>${escapeHtml(point.note)}`:''}`);
    });
    if(this.rpgVisible&&this.rpgData)this.renderRpg();this.setLegend();
  }

  addParcel(parcel){
    try{
      const selected=parcel.id===this.selectedId,color=this.colorFor(parcel);
      const layer=L.geoJSON(parcel.geometry,{style:()=>({color:selected?'#123f2c':color,weight:selected?4:2.2,fillColor:color,fillOpacity:selected?.42:.24}),pointToLayer:(feature,latlng)=>L.circleMarker(latlng,{radius:8,color,fillColor:color,fillOpacity:.8})});
      layer.on('click',()=>this.select(parcel.id,{zoom:false}));
      layer.bindPopup(`<div class="parcel-popup"><strong>${escapeHtml(parcel.nom)}</strong><small>${escapeHtml(parcel.culture||'Culture non renseignée')} · ${formatNumber(parcel.surfaceHa)} ha${parcel.commune?` · ${escapeHtml(parcel.commune)}`:''}</small><button type="button" data-map-open="${parcel.id}">Ouvrir la fiche</button></div>`);
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
    this.gpsMarker=L.marker([latitude,longitude],{icon:L.divIcon({className:'',html:'<div class="gps-marker"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(this.layers.gps).bindPopup(`Position GPS · précision ± ${Math.round(accuracy)} m`);if(this.followGps)this.map.setView([latitude,longitude],Math.max(this.map.getZoom(),16),{animate:true});
  }

  toggleTracking({follow=false}={}){
    if(this.watchId===null){this.followGps=Boolean(follow);this.locate({tracking:true});this.onToast?.(this.followGps?'Suivi GPS avec recentrage activé.':'Suivi GPS activé.');return true;}
    navigator.geolocation.clearWatch(this.watchId);this.watchId=null;this.followGps=false;this.onToast?.('Suivi GPS arrêté.');return false;
  }
  setFollowGps(value){this.followGps=Boolean(value);return this.followGps;}

  async loadRpgNearby({latitude,longitude,radiusKm=5,year=2024}){
    this.init();if(!this.map)throw new Error('La carte n’est pas disponible sur cet appareil pour le moment.');const geom=bboxSquare(latitude,longitude,radiusKm);const url=`https://apicarto.ign.fr/api/rpg/v2?annee=${encodeURIComponent(year)}&geom=${encodeURIComponent(JSON.stringify(geom))}&_limit=1000`;
    const response=await fetch(url,{headers:{accept:'application/json'}});if(!response.ok)throw new Error(`RPG indisponible (${response.status})`);
    const data=await response.json();if(data.type!=='FeatureCollection')throw new Error('Réponse RPG inattendue.');this.rpgData=data;this.rpgVisible=true;this.renderRpg();this.setLegend();return data.features?.length||0;
  }

  renderRpg(){
    this.layers.rpg.clearLayers();if(!this.rpgVisible||!this.rpgData)return;
    L.geoJSON(this.rpgData,{style:{color:'#6e7982',weight:1,fillColor:'#b4bdc4',fillOpacity:.12},onEachFeature:(feature,layer)=>{const p=feature.properties||{};layer.bindPopup(`<strong>Parcelle RPG</strong><br>${escapeHtml(p.CODE_CULTU||p.code_cultu||p.GROUPE_CULTURE||'Culture non renseignée')}${p.SURF_PARC?` · ${formatNumber(p.SURF_PARC)} ha`:''}`);}}).addTo(this.layers.rpg);
  }
  setRpgVisible(value){this.rpgVisible=Boolean(value);if(!this.rpgVisible)this.layers.rpg?.clearLayers();else if(this.rpgData)this.renderRpg();this.setLegend();}

  startPointPlacement(callback){
    this.init();if(!this.map){this.onToast?.('La carte doit être disponible pour placer un point.','error');return;}if(this.pointPlacementHandler)this.map.off('click',this.pointPlacementHandler);
    this.pointPlacementHandler=event=>{this.map.off('click',this.pointPlacementHandler);this.pointPlacementHandler=null;callback?.({latitude:event.latlng.lat,longitude:event.latlng.lng});};
    this.map.on('click',this.pointPlacementHandler);
  }
  cancelPointPlacement(){if(this.pointPlacementHandler){this.map.off('click',this.pointPlacementHandler);this.pointPlacementHandler=null;}}

  startPolygonDrawing({onUpdate,onComplete,onCancel}={}){
    this.init();if(!this.map){this.onToast?.('La carte doit être disponible pour dessiner une parcelle.','error');onCancel?.();return;}this.cancelPolygonDrawing(false);this.cancelPointPlacement();
    const points=[];const click=event=>{points.push([event.latlng.lng,event.latlng.lat]);this.layers.drawing.clearLayers();const latlngs=points.map(([lng,lat])=>[lat,lng]);if(points.length>=3)L.polygon(latlngs,{color:'#17663f',weight:3,fillColor:'#61b985',fillOpacity:.2,dashArray:'6 5'}).addTo(this.layers.drawing);else if(points.length>=2)L.polyline(latlngs,{color:'#17663f',weight:3,dashArray:'6 5'}).addTo(this.layers.drawing);points.forEach(([lng,lat],index)=>L.circleMarker([lat,lng],{radius:5,color:'#fff',weight:2,fillColor:'#17663f',fillOpacity:1}).bindTooltip(String(index+1),{permanent:false}).addTo(this.layers.drawing));onUpdate?.(points.length);};
    this.polygonDraw={points,click,onUpdate,onComplete,onCancel};this.map.on('click',click);this.map.getContainer().classList.add('is-drawing');onUpdate?.(0);
  }
  finishPolygonDrawing(){
    if(!this.polygonDraw)return null;const {points,onComplete}=this.polygonDraw;if(points.length<3)throw new Error('Ajoutez au moins 3 points pour dessiner la parcelle.');const ring=[...points,points[0]];const geometry={type:'Polygon',coordinates:[ring]};this.cancelPolygonDrawing(false);onComplete?.(geometry);return geometry;
  }
  cancelPolygonDrawing(notify=true){
    if(!this.polygonDraw)return;const {click,onCancel}=this.polygonDraw;this.map?.off('click',click);this.layers.drawing?.clearLayers();this.map?.getContainer()?.classList.remove('is-drawing');this.polygonDraw=null;if(notify)onCancel?.();
  }
  undoPolygonPoint(){if(!this.polygonDraw?.points.length)return 0;this.polygonDraw.points.pop();const pts=[...this.polygonDraw.points],cfg={...this.polygonDraw};this.cancelPolygonDrawing(false);this.startPolygonDrawing({onUpdate:cfg.onUpdate,onComplete:cfg.onComplete,onCancel:cfg.onCancel});for(const [lng,lat] of pts){const event={latlng:{lng,lat}};this.polygonDraw.click(event);}return pts.length;}

  startMeasurement(kind='distance',{onUpdate,onComplete}={}){
    this.init();if(!this.map){this.onToast?.('La carte doit être disponible pour mesurer.','error');return;}this.cancelMeasurement();this.cancelPointPlacement();const points=[];const render=()=>{this.layers.measure.clearLayers();const latlngs=points.map(p=>[p.latitude,p.longitude]);if(kind==='area'&&points.length>=3)L.polygon(latlngs,{color:'#6d4fd3',weight:3,fillColor:'#8c78da',fillOpacity:.16,dashArray:'6 5'}).addTo(this.layers.measure);else if(points.length>=2)L.polyline(latlngs,{color:'#6d4fd3',weight:3,dashArray:'6 5'}).addTo(this.layers.measure);points.forEach((p,i)=>L.circleMarker([p.latitude,p.longitude],{radius:5,color:'#fff',weight:2,fillColor:'#6d4fd3',fillOpacity:1}).bindTooltip(String(i+1)).addTo(this.layers.measure));let value=0;if(kind==='distance'&&points.length>1)for(let i=1;i<points.length;i++)value+=haversineMeters(points[i-1],points[i]);if(kind==='area'&&points.length>=3){const ring=points.map(p=>[p.longitude,p.latitude]);ring.push(ring[0]);value=geometryAreaHa({type:'Polygon',coordinates:[ring]});}onUpdate?.({kind,points:[...points],value});};const click=e=>{points.push({latitude:e.latlng.lat,longitude:e.latlng.lng});render();};this.measure={kind,points,click,onUpdate,onComplete};this.map.on('click',click);this.map.getContainer().classList.add('is-measuring');render();
  }
  finishMeasurement(){if(!this.measure)return null;const {kind,points,onComplete}=this.measure;let value=0;if(kind==='distance'){if(points.length<2)throw new Error('Ajoutez au moins deux points.');for(let i=1;i<points.length;i++)value+=haversineMeters(points[i-1],points[i]);}else{if(points.length<3)throw new Error('Ajoutez au moins trois points.');const ring=points.map(p=>[p.longitude,p.latitude]);ring.push(ring[0]);value=geometryAreaHa({type:'Polygon',coordinates:[ring]});}this.map.off('click',this.measure.click);this.map.getContainer().classList.remove('is-measuring');this.measure=null;onComplete?.({kind,points,value});return value;}
  undoMeasurementPoint(){if(!this.measure?.points.length)return;this.measure.points.pop();const cfg={kind:this.measure.kind,onUpdate:this.measure.onUpdate,onComplete:this.measure.onComplete},pts=[...this.measure.points];this.cancelMeasurement();this.startMeasurement(cfg.kind,cfg);for(const p of pts)this.measure.click({latlng:{lat:p.latitude,lng:p.longitude}});}
  cancelMeasurement(){if(!this.measure)return;this.map?.off('click',this.measure.click);this.layers.measure?.clearLayers();this.map?.getContainer()?.classList.remove('is-measuring');this.measure=null;}

  centroidOfParcel(parcel){return geometryCentroid(parcel?.geometry);}
  dispose(){if(this.watchId!==null)navigator.geolocation.clearWatch(this.watchId);this.cancelPointPlacement();this.cancelPolygonDrawing(false);this.cancelMeasurement();}
}
