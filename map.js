import {escapeHtml, formatNumber} from './utils.js';

const DEFAULT_CENTER = [46.18,5.15];

export class ParcelMap {
  constructor({onSelect,onToast}){ this.onSelect=onSelect;this.onToast=onToast;this.map=null;this.layers={parcels:null,points:null,gps:null};this.selectedId=null;this.gpsMarker=null;this.watchId=null;this.lastParcels=[]; }
  init(){
    if(this.map || !window.L) return;
    this.map=L.map('map',{zoomControl:false}).setView(DEFAULT_CENTER,12);
    L.control.zoom({position:'bottomright'}).addTo(this.map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap contributors'}).addTo(this.map);
    this.layers.parcels=L.layerGroup().addTo(this.map);this.layers.points=L.layerGroup().addTo(this.map);this.layers.gps=L.layerGroup().addTo(this.map);
  }
  render(state){
    this.init();if(!this.map)return;
    const parcels=state.parcelles.filter(item=>!item.deletedAt);this.lastParcels=parcels;
    this.layers.parcels.clearLayers();this.layers.points.clearLayers();
    parcels.filter(parcel=>parcel.geometry).forEach(parcel=>this.addParcel(parcel));
    state.points.filter(point=>!point.deletedAt && point.latitude && point.longitude).forEach(point=>{
      L.circleMarker([point.latitude,point.longitude],{radius:7,color:'#8b5e19',weight:2,fillOpacity:.95}).addTo(this.layers.points).bindPopup(`<strong>${escapeHtml(point.nom || 'Point')}</strong><br>${escapeHtml(point.type || '')}`);
    });
    this.setLegend();
  }
  addParcel(parcel){
    try{
      const selected=parcel.id===this.selectedId;
      const layer=L.geoJSON(parcel.geometry,{style:()=>({color:selected?'#0a3d27':'#1e6b45',weight:selected?4:2,fillColor:parcel.status==='À faire'?'#d69b2d':'#4aa369',fillOpacity:selected?.45:.24}),pointToLayer:(feature,latlng)=>L.circleMarker(latlng,{radius:8,color:'#1e6b45',fillOpacity:.8})});
      layer.on('click',()=>this.select(parcel.id,{zoom:false}));
      layer.bindPopup(`<div class="parcel-popup"><strong>${escapeHtml(parcel.nom)}</strong><small>${escapeHtml(parcel.culture || 'Culture non renseignée')} · ${formatNumber(parcel.surfaceHa)} ha${parcel.commune?` · ${escapeHtml(parcel.commune)}`:''}</small><button type="button" data-map-open="${parcel.id}">Ouvrir la fiche</button></div>`);
      layer.addTo(this.layers.parcels);
    }catch(error){console.warn('Géométrie ignorée',parcel.id,error);}
  }
  setLegend(){
    const legend=document.querySelector('#map-legend');if(!legend)return;
    legend.innerHTML='<div class="legend-item"><span class="legend-dot" style="background:#4aa369"></span> Mes parcelles</div><div class="legend-item"><span class="legend-dot" style="background:#d69b2d"></span> À faire</div><div class="legend-item"><span class="legend-dot" style="background:#2563eb"></span> Position GPS</div><div class="legend-item"><span class="legend-dot" style="background:#8b5e19"></span> Points</div>';
  }
  select(id,{zoom=true}={}){
    this.selectedId=id;
    const parcel=this.lastParcels.find(item=>item.id===id);if(!parcel)return;
    this.render({parcelles:this.lastParcels,points:[]});
    if(zoom && parcel.geometry){try{const bounds=L.geoJSON(parcel.geometry).getBounds();if(bounds.isValid())this.map.fitBounds(bounds.pad(.18),{maxZoom:17});}catch{}}
    this.onSelect(parcel);
  }
  fitParcels(){
    if(!this.layers.parcels?.getLayers().length){this.onToast('Aucune géométrie de parcelle à cadrer.');return;}
    const bounds=this.layers.parcels.getBounds(); if(bounds.isValid())this.map.fitBounds(bounds.pad(.12));
  }
  locate({tracking=false}={}){
    if(!navigator.geolocation){this.onToast('La géolocalisation n’est pas disponible sur cet appareil.','error');return;}
    const onPosition=position=>{
      const {latitude,longitude,accuracy}=position.coords;this.setPosition(latitude,longitude,accuracy);
      if(!tracking)this.map.setView([latitude,longitude],Math.max(this.map.getZoom(),16));
    };
    const onError=()=>this.onToast('Position indisponible. Vérifiez l’autorisation GPS et la réception.','error');
    if(tracking){if(this.watchId!==null)return;this.watchId=navigator.geolocation.watchPosition(onPosition,onError,{enableHighAccuracy:true,maximumAge:5000,timeout:15000});}
    else navigator.geolocation.getCurrentPosition(onPosition,onError,{enableHighAccuracy:true,maximumAge:30000,timeout:15000});
  }
  setPosition(latitude,longitude,accuracy){
    this.layers.gps.clearLayers();
    L.circle([latitude,longitude],{radius:accuracy,color:'#2563eb',weight:1,fillOpacity:.12}).addTo(this.layers.gps);
    this.gpsMarker=L.marker([latitude,longitude],{icon:L.divIcon({className:'',html:'<div class="gps-marker"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(this.layers.gps).bindPopup(`Position GPS · précision ± ${Math.round(accuracy)} m`);
    const status=accuracy<=10?'GPS précis':accuracy<=30?'GPS correct':'GPS faible';document.dispatchEvent(new CustomEvent('parcelles:gps',{detail:{latitude,longitude,accuracy,status}}));
  }
  toggleTracking(){
    if(this.watchId===null){this.locate({tracking:true});return true;}
    navigator.geolocation.clearWatch(this.watchId);this.watchId=null;this.onToast('Suivi GPS arrêté.');return false;
  }
  dispose(){if(this.watchId!==null)navigator.geolocation.clearWatch(this.watchId);}
}
