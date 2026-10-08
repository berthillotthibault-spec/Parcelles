// Premier lancement « carte d’abord » : je retrouve mes parcelles PAC en 3 touches.
// Commune → carte PAC (RPG IGN) → je touche mes îlots → « Ajouter ces parcelles ».
import {escapeHtml} from './utils.js';
import {fetchRpgFeatures,rpgFeatureId} from './rpg.js';
import {baseLayerDefinition} from './basemaps.js';
import {rollbackImportSession} from './import-export.js';
import {
  ONBOARDING_RPG_RADIUS_KM,BATCH_LIMIT,addRpgParcelsBatch,countLabel,farmSummary,farmSummaryLabel,
  geocodeUrl,onboardingRpgYears,parseGeocode,selectionSummary
} from './rpg-onboarding.js';

const DEFAULT_CENTER=[46.6,2.4];
const STYLE={color:'#805000',weight:2,opacity:.95,fillColor:'#f6ce59',fillOpacity:.22};
const SELECTED={color:'#0f5132',weight:3,opacity:1,fillColor:'#2f9e64',fillOpacity:.55};
const OWNED={color:'#ffffff',weight:2,opacity:.9,fillColor:'#286a4a',fillOpacity:.5,dashArray:'4 3'};

function bboxSquare(lat,lon,radiusKm){
  const dLat=radiusKm/111.32,dLon=radiusKm/(111.32*Math.max(.2,Math.cos(lat*Math.PI/180)));
  return{type:'Polygon',coordinates:[[[lon-dLon,lat-dLat],[lon+dLon,lat-dLat],[lon+dLon,lat+dLat],[lon-dLon,lat+dLat],[lon-dLon,lat-dLat]]]};
}
const offline=()=>typeof navigator!=='undefined'&&navigator.onLine===false;
const isNetworkError=error=>/réseau|Connexion impossible/i.test(String(error?.message||''));

export function createRpgOnboardingUI({store,modal,closeModal,toast,importFile,onChanged,showMap}){
  let pickMap=null,doneMap=null,controller=null,year=null;
  const selected=new Map();let loaded=new Map(),layer=null;
  const $=selector=>document.querySelector(selector);
  const alive=()=>Boolean(pickMap&&pickMap.getContainer()?.isConnected);

  function dispose(){
    controller?.abort();controller=null;
    try{pickMap?.remove();}catch{}pickMap=null;layer=null;
    try{doneMap?.remove();}catch{}doneMap=null;
  }
  function setStatus(text,kind=''){
    const node=$('#rpg-pick-status');if(!node)return;node.textContent=text;node.className=`rpg-pick-status${kind?` is-${kind}`:''}`;
  }
  function updateCount(){
    const summary=selectionSummary([...selected.values()],year||undefined),count=$('#rpg-pick-count'),add=$('#rpg-pick-add'),clear=$('#rpg-pick-clear');
    if(count)count.textContent=countLabel(summary.count,summary.surfaceHa);
    if(add){add.disabled=!summary.count;add.textContent=summary.count?`Ajouter ces parcelles (${summary.count})`:'Ajouter ces parcelles';}
    if(clear)clear.hidden=!summary.count;
  }
  function ownedIds(){return new Set(store.state.parcelles.filter(parcel=>!parcel.deletedAt).map(parcel=>parcel.sourceId).filter(Boolean));}
  function styleFor(id,owned){return selected.has(id)?SELECTED:owned.has(id)?OWNED:STYLE;}

  function render(){
    if(!pickMap||typeof L==='undefined')return;
    if(layer){pickMap.removeLayer(layer);layer=null;}
    const owned=ownedIds(),features=new Map(loaded);
    for(const [id,feature] of selected)if(!features.has(id))features.set(id,feature);
    layer=L.geoJSON({type:'FeatureCollection',features:[...features.values()]},{
      style:feature=>styleFor(rpgFeatureId(feature,{year}),owned),
      onEachFeature:(feature,path)=>{
        const id=rpgFeatureId(feature,{year});
        path.on('click',()=>{
          if(owned.has(id)){setStatus('Cette parcelle est déjà dans votre exploitation.','info');return;}
          if(selected.has(id))selected.delete(id);
          else{if(selected.size>=BATCH_LIMIT){setStatus(`Au plus ${BATCH_LIMIT} parcelles par ajout : validez celles-ci, puis continuez.`,'warn');return;}selected.set(id,feature);}
          path.setStyle(styleFor(id,owned));updateCount();
        });
      }
    }).addTo(pickMap);
  }

  async function loadAround(latitude,longitude){
    if(offline()){showOffline();return;}
    controller?.abort();const local=new AbortController();controller=local;
    const geometry=bboxSquare(latitude,longitude,ONBOARDING_RPG_RADIUS_KM),years=onboardingRpgYears();
    let lastError=null;
    for(const candidate of years){
      setStatus(`Chargement des parcelles PAC ${candidate}…`,'busy');
      try{
        const data=await fetchRpgFeatures({geometry,year:candidate,signal:local.signal,requestTimeoutMs:20000,onProgress:detail=>{
          if(controller===local&&detail.loaded)setStatus(`Chargement des parcelles PAC ${candidate}… ${detail.loaded}${detail.total!=null?` / ${detail.total}`:''}`,'busy');
        }});
        if(controller!==local||!alive())return;
        if(!data.features.length&&candidate!==years[years.length-1])continue;
        if(year!==null&&year!==candidate&&selected.size){selected.clear();}
        year=candidate;loaded=new Map(data.features.map(feature=>[rpgFeatureId(feature,{year}),feature]));
        render();updateCount();
        const note=$('#rpg-pick-year');if(note)note.textContent=String(year);
        setStatus(loaded.size?`${loaded.size} parcelle${loaded.size>1?'s':''} PAC ${year} autour de ce point. Touchez les vôtres.`:'Aucune parcelle PAC déclarée autour de ce point. Déplacez la carte puis « Charger ici ».',loaded.size?'ok':'warn');
        return;
      }catch(error){
        if(error?.name==='AbortError'||controller!==local)return;
        lastError=error;if(isNetworkError(error))break;
      }
    }
    if(controller===local&&alive())setStatus(`${lastError?.message||'Le service PAC est indisponible.'} Vous pouvez réessayer ou importer un fichier.`,'error');
  }

  async function searchCommune(commune){
    const url=geocodeUrl(commune);
    if(!url){setStatus('Champ obligatoire : commune (ou touchez « Autour de moi »).','error');$('#rpg-pick-commune')?.focus();return;}
    if(offline()){showOffline();return;}
    setStatus('Recherche de la commune…','busy');
    let places=[];
    try{
      const response=await fetch(url,{headers:{accept:'application/json'}});
      if(!response.ok)throw new Error(`Le service de recherche de commune est indisponible (${response.status}).`);
      places=parseGeocode(await response.json());
    }catch(error){
      if(!alive())return;
      setStatus(error?.name==='TypeError'?'Connexion impossible au service de recherche de commune.':error.message,'error');return;
    }
    if(!alive())return;
    if(!places.length){setStatus(`Commune introuvable : « ${commune} ». Vérifiez l’orthographe ou touchez « Autour de moi ».`,'error');return;}
    const place=places[0];
    pickMap.setView([place.latitude,place.longitude],14);
    await loadAround(place.latitude,place.longitude);
  }

  function locate(){
    if(!navigator.geolocation){setStatus('La localisation n’est pas disponible sur cet appareil.','error');return;}
    setStatus('Localisation en cours…','busy');
    navigator.geolocation.getCurrentPosition(position=>{
      if(!alive())return;const {latitude,longitude}=position.coords;pickMap.setView([latitude,longitude],15);loadAround(latitude,longitude);
    },()=>setStatus('Position refusée ou introuvable : saisissez plutôt votre commune.','error'),{enableHighAccuracy:false,timeout:15000,maximumAge:300000});
  }

  function showOffline(){
    const box=$('#rpg-pick-offline');if(!box)return;box.hidden=false;
    setStatus('Pas de connexion : la carte PAC se charge depuis l’IGN.','error');
  }

  function open({commune=''}={}){
    dispose();selected.clear();loaded=new Map();year=null;
    modal('Retrouver mes parcelles PAC','Touchez vos parcelles sur la carte : elles se colorent. Rien n’est enregistré avant de valider.',
      `<div class="rpg-pick">
        <form id="rpg-pick-search" class="rpg-pick-search" novalidate>
          <label class="rpg-pick-field">Commune *<input id="rpg-pick-commune" name="commune" value="${escapeHtml(commune)}" autocomplete="address-level2" placeholder="Ex. : Montrevel-en-Bresse" maxlength="120"></label>
          <div class="rpg-pick-search-actions"><button class="button secondary" type="submit">Chercher</button><button class="button secondary" type="button" id="rpg-pick-locate">Autour de moi</button></div>
        </form>
        <p id="rpg-pick-status" class="rpg-pick-status" role="status" aria-live="polite"></p>
        <div id="rpg-pick-offline" class="rpg-pick-offline" hidden><p><strong>Connexion nécessaire.</strong> La carte PAC et les contours viennent des services de l’IGN. Réessayez avec du réseau, ou importez un fichier (telepac, SHP, Excel…).</p><div class="rpg-pick-offline-actions"><button class="button secondary" type="button" id="rpg-pick-retry">Réessayer</button><button class="button secondary" type="button" data-rpg-import>Importer un fichier</button></div></div>
        <div class="rpg-pick-bar"><strong id="rpg-pick-count" class="rpg-pick-count">0 parcelle · 0 ha</strong><span class="rpg-pick-bar-actions"><button class="text-button" type="button" id="rpg-pick-here">Charger ici</button><button class="text-button" type="button" id="rpg-pick-clear" hidden>Tout désélectionner</button></span></div>
        <div id="rpg-pick-map" class="rpg-pick-map" role="application" aria-label="Carte des parcelles PAC : touchez une parcelle pour la sélectionner"></div>
        <p class="form-note rpg-pick-note">Registre parcellaire graphique <span id="rpg-pick-year">${onboardingRpgYears()[0]}</span> publié par l’IGN, anonyme : vous choisissez vous-même vos îlots. Surfaces et cultures indicatives, à vérifier avec votre déclaration. Noms provisoires modifiables ensuite.</p>
      </div>`,
      `<button class="button primary rpg-pick-add" id="rpg-pick-add" disabled>Ajouter ces parcelles</button><button class="text-button rpg-pick-alt" type="button" data-rpg-import>Importer un fichier à la place</button>`,
      'large rpg-pick-modal');
    const el=$('#rpg-pick-map');
    for(const button of document.querySelectorAll('[data-rpg-import]'))button.onclick=()=>{dispose();closeModal();importFile?.();};
    $('#rpg-pick-search').onsubmit=event=>{event.preventDefault();$('#rpg-pick-offline').hidden=true;searchCommune($('#rpg-pick-commune').value);};
    $('#rpg-pick-locate').onclick=()=>{$('#rpg-pick-offline').hidden=true;locate();};
    $('#rpg-pick-retry').onclick=()=>{$('#rpg-pick-offline').hidden=true;searchCommune($('#rpg-pick-commune').value);};
    $('#rpg-pick-here').onclick=()=>{if(!pickMap)return;const center=pickMap.getCenter();loadAround(center.lat,center.lng);};
    $('#rpg-pick-clear').onclick=()=>{selected.clear();render();updateCount();setStatus('Sélection vidée.','info');};
    $('#rpg-pick-add').onclick=save;
    if(typeof L==='undefined'||!el){setStatus('La carte n’est pas disponible sur cet appareil. Importez plutôt un fichier.','error');return;}
    pickMap=L.map(el,{zoomControl:true,doubleClickZoom:false,attributionControl:true}).setView(DEFAULT_CENTER,6);
    const base=baseLayerDefinition('ign-photo');
    L.tileLayer(base.url,{maxNativeZoom:base.maxNativeZoom,maxZoom:base.maxZoom,attribution:base.attribution}).addTo(pickMap);
    setTimeout(()=>pickMap?.invalidateSize(),60);
    updateCount();
    if(offline())showOffline();
    else if(commune.trim())searchCommune(commune);
    else setStatus('Saisissez votre commune, ou touchez « Autour de moi ».','info');
  }

  async function save(){
    const button=$('#rpg-pick-add');if(!button||button.disabled)return;
    button.disabled=true;button.textContent='Enregistrement…';
    try{
      const result=await addRpgParcelsBatch(store,[...selected.values()],{year:year||undefined});
      dispose();selected.clear();
      if(!result.created){closeModal();toast('Ces parcelles sont déjà dans votre exploitation.','success');onChanged?.();return;}
      onChanged?.();
      showDone(result);
      toast(`${result.created} parcelle${result.created>1?'s':''} PAC ajoutée${result.created>1?'s':''}.`,'success',{label:'Annuler',run:()=>undo(result.sessionId)});
    }catch(error){
      if(button.isConnected){button.disabled=false;updateCount();}
      setStatus(error.message,'error');toast(error.message,'error');
    }
  }

  async function undo(sessionId){
    if(!sessionId)return;
    try{await rollbackImportSession(store,sessionId);dispose();closeModal();onChanged?.();toast('Ajout annulé : l’état précédent a été restauré.');}
    catch(error){toast(error.message,'error');}
  }

  function showDone(result){
    const summary=farmSummary(store.state.parcelles);
    modal('Votre exploitation est sur la carte',`${result.created} parcelle${result.created>1?'s':''} ajoutée${result.created>1?'s':''} depuis le RPG${result.skipped?` · ${result.skipped} déjà présente${result.skipped>1?'s':''}`:''}.`,
      `<div class="rpg-done"><p class="rpg-done-title">Votre exploitation : <strong>${escapeHtml(farmSummaryLabel(summary))}</strong></p><div id="rpg-done-map" class="rpg-done-map" role="img" aria-label="Aperçu de vos parcelles sur la carte"></div><p class="form-note">Noms provisoires (« Îlot 3 - P2 », « Parcelle PAC 1 »…) et cultures déduites du code PAC : ouvrez une fiche pour les renommer ou les corriger.</p></div>`,
      `<button class="button primary rpg-pick-add" id="rpg-done-map-button">Voir sur la carte</button><button class="text-button rpg-pick-alt" type="button" id="rpg-done-undo">Annuler cet ajout</button>`,'small rpg-done-modal');
    $('#rpg-done-map-button').onclick=()=>{dispose();closeModal();showMap?.();};
    $('#rpg-done-undo').onclick=()=>undo(result.sessionId);
    const el=$('#rpg-done-map');if(!el||typeof L==='undefined')return;
    try{
      doneMap=L.map(el,{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,touchZoom:false});
      const base=baseLayerDefinition('ign-photo');L.tileLayer(base.url,{maxNativeZoom:base.maxNativeZoom,maxZoom:base.maxZoom}).addTo(doneMap);
      const shapes=L.geoJSON({type:'FeatureCollection',features:store.state.parcelles.filter(p=>!p.deletedAt&&p.geometry).map(p=>({type:'Feature',properties:{},geometry:p.geometry}))},{style:SELECTED}).addTo(doneMap);
      const bounds=shapes.getBounds();if(bounds.isValid())doneMap.fitBounds(bounds,{padding:[12,12]});else doneMap.setView(DEFAULT_CENTER,6);
      setTimeout(()=>{if(doneMap&&bounds.isValid()){doneMap.invalidateSize();doneMap.fitBounds(bounds,{padding:[12,12]});}},60);
    }catch{}
  }

  return{open,dispose};
}
