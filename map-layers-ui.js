// Plus › Couches de la carte : panneau chargé à l’ouverture (allègement d’app.js, palier 1), hors du démarrage.
import {escapeHtml, formatNumber} from './utils.js';
import {BASE_LAYERS, normalizeBaseLayer, normalizeCadastreOpacity} from './basemaps.js';
import {mapEconomics} from './pilotage.js';
import {isTreatment} from './phyto.js';
import {PAC_MAP_MODES} from './pac.js';
import {withProgress} from './motion.js';

// Carte et satellite sont créés après l’enregistrement du module : lus par accesseurs à l’ouverture.
export function createMapLayersUI({state, store, active, modal, toast, getMap = () => null, getSatellite = () => null, regulatory, photoGeo, renderMapSheet = () => {}, doc = globalThis.document} = {}) {
  const $ = selector => doc.querySelector(selector), document = doc;
  const setText = (selector, text) => { const el = $(selector); if (el) el.textContent = text; };
  function open(){
  const parcelMap=getMap(),satelliteUI=getSatellite();
  const prefs=state().preferences;
  const economicRows=[...mapEconomics(state()).values()];
  const colorModes=[['culture','Culture'],['status','État'],...(active('interventions').length?[['work','Travaux'],['last','Dernière intervention']]:[]),...(active('grazingSessions').length?[['animals','Animaux']]:[]),...(active('clients').length?[['client','Client']]:[]),...(economicRows.some(r=>r.costHa!==null)?[['cost','Coût/ha']]:[]),...(economicRows.some(r=>r.marginHa!==null)?[['margin','Marge/ha']]:[]),...(active('interventions').some(isTreatment)?[['ift','IFT']]:[])];
  if(active('parcelles').length)colorModes.push(...PAC_MAP_MODES); // v5b n° 58
  if(active('parcelles').some(p=>p.lease?.ownerName||p.lease?.leaseType))colorModes.push(['owner','Propriétaires']); // v7b n° 93
  if(active('integrationImports').some(r=>r.farmKind==='soilAnalysis'))colorModes.push(['soilph','pH du sol']); // v8b n° 68
  if(active('parcelles').some(p=>p.geometry))colorModes.push(['ndvi','Vigueur (NDVI)'],['ndvitrend','Tendance 15 j']); // v9 n° 43
  const mode=prefs.mapColorMode||'culture',base=normalizeBaseLayer(prefs.mapLayer),cadastreOn=Boolean(prefs.mapCadastre),cadastreOpacity=Math.round(normalizeCadastreOpacity(prefs.mapCadastreOpacity)*100),radius=prefs.rpgRadiusKm===10?10:5,labelsOn=!prefs.mapHideLabels;
  const chip=(group,value,label,on)=>`<button type="button" class="ly-chip${on?' is-on':''}" data-ly="${group}" data-value="${value}">${escapeHtml(label)}</button>`;
  const sw=(name,on,label='')=>`<button type="button" class="ly-switch${on?' is-on':''}" data-ly="${name}" role="switch" aria-checked="${on}"${label?` aria-label="${escapeHtml(label)}"`:''}><i></i></button>`;
  const body=`<div id="map-layer-form" class="ly-sheet">
    <p class="ly-label">Colorer par</p><div class="ly-chips">${colorModes.map(([k,l])=>chip('color',k,l,mode===k)).join('')}</div>
    <div id="ly-ndvi-wrap"${['ndvi','ndvitrend'].includes(mode)?'':' hidden'}>${satelliteUI.ndviControls()}</div>
    <div class="ly-rpg"><div class="ly-rpg-head"><span class="ly-rpg-icon"></span><span class="ly-rpg-text"><strong>Parcelles PAC/RPG 2024</strong><small>Registre parcellaire IGN autour du centre de la carte</small></span>${sw('rpg',!!parcelMap.rpgVisible,'Parcelles PAC/RPG 2024')}</div>
      <div class="ly-rpg-radius"><span>Rayon</span><span class="ly-chips">${chip('radius','5','5 km',radius===5)}${chip('radius','10','10 km',radius===10)}</span></div>
      <p id="rpg-load-progress" class="ly-progress" role="status" aria-live="polite"></p></div>
    <p class="ly-label">Fond de carte</p><div class="ly-bases" role="radiogroup" aria-label="Fond de carte">${BASE_LAYERS.map(layer=>`<button type="button" class="ly-base${base===layer.id?' is-on':''}" data-ly="base" data-value="${layer.id}" role="radio" aria-checked="${base===layer.id}"><i class="ly-thumb is-${layer.id}"></i><strong>${escapeHtml(layer.label)}</strong><small>${escapeHtml(layer.hint)}</small></button>`).join('')}</div>
    <div class="ly-cadastre"><div class="ly-row"><span><strong>Cadastre</strong><small>Limites, sections et numéros (IGN). Touchez la carte pour la référence.</small></span>${sw('cadastre',cadastreOn,'Afficher le cadastre')}</div>
      <label class="ly-opacity${cadastreOn?'':' hidden'}" id="cadastre-opacity-field"><span>Opacité du cadastre <output id="cadastre-opacity-value">${cadastreOpacity} %</output></span><input type="range" id="cadastre-opacity" min="20" max="100" step="10" value="${cadastreOpacity}" aria-label="Opacité du cadastre"></label>
      <p class="ly-note">Le cadastre n’a pas de valeur juridique de bornage.${navigator.onLine?'':' Hors connexion : les fonds de carte et le cadastre ne se chargent pas, vos parcelles restent affichées.'}</p></div>
    ${regulatory().layersHtml()}
    <div class="ly-row"><span><strong>Photos</strong><small>Miniatures des photos géolocalisées</small></span>${sw('photos',photoGeo().layerOn(),'Afficher les photos sur la carte')}</div>
    <div class="ly-row"><span><strong>Noms des parcelles</strong><small>Étiquettes sur la carte</small></span>${sw('labels',labelsOn,'Noms des parcelles')}</div>
    <div class="ly-row"><span><strong>Imprimer un plan</strong><small>A4 paysage : légende en hectares, échelle, nord</small></span><button type="button" class="button secondary" data-plan="open"${parcelMap.multiple&&parcelMap.selectedIds?.size?' data-scope="selection"':''}>Préparer</button></div>
    <details class="ly-more"><summary>Satellite agricole et rendement</summary>${satelliteUI.mapControls()}<section class="form-section"><h3>Rendement</h3>${parcelMap.selectedId?`<button type="button" class="button secondary" data-action="parcel-tab" data-id="${escapeHtml(parcelMap.selectedId)}" data-tab="yield">Ouvrir les cartes de rendement</button>`:'<p>Sélectionnez une parcelle.</p>'}<button type="button" class="button secondary" data-my="profit-zones">Rentabilité intra-parcellaire</button></section></details>
  </div>`;
  modal('Couches','',body,'','small');regulatory().bindLayers($('#map-layer-form'));
  $('#modal-root')?.classList.add('is-layers');
  const root=$('#map-layer-form'),progress=$('#rpg-load-progress');
  const setOn=(group,value)=>root.querySelectorAll(`[data-ly="${group}"]`).forEach(b=>b.classList.toggle('is-on',b.dataset.value===value));
  const loadRpg=async(r)=>{
    const center=parcelMap.map?.getCenter();
    if(!center||!Number.isFinite(center.lat)||!Number.isFinite(center.lng))throw new Error('Ouvrez la carte avant de charger les parcelles RPG.');
    progress.textContent='Chargement des parcelles RPG…';
    const count=await withProgress('Chargement des parcelles RPG…',activity=>parcelMap.loadRpgNearby({latitude:center.lat,longitude:center.lng,radiusKm:r,year:2024,onProgress:detail=>{
      if(root.isConnected){const label=detail.loaded?`${formatNumber(detail.loaded)}${detail.total!=null?` / ${formatNumber(detail.total)}`:''} parcelles chargées`:'Recherche des parcelles RPG…';progress.textContent=label;activity.update({label,completed:detail.loaded,total:detail.total});}
    }}));
    if(root.isConnected)progress.textContent='';
    toast(`${formatNumber(count)} parcelle${count>1?'s':''} RPG chargée${count>1?'s':''}. Touchez un contour pour l’ajouter.`);
  };
  const opacity=root.querySelector('#cadastre-opacity');
  opacity?.addEventListener('input',()=>{const value=normalizeCadastreOpacity(Number(opacity.value)/100);parcelMap.setCadastreOpacity(value);setText('#cadastre-opacity-value',`${Math.round(value*100)} %`);});
  opacity?.addEventListener('change',()=>store.setPreferences({mapCadastreOpacity:normalizeCadastreOpacity(Number(opacity.value)/100)}).catch(error=>toast(error.message,'error')));
  root.addEventListener('click',async ev=>{
    const b=ev.target.closest('[data-ly]');if(!b)return;const g=b.dataset.ly,v=b.dataset.value;
    try{
      if(g==='color'){setOn('color',v);const ndviWrap=root.querySelector('#ly-ndvi-wrap');if(ndviWrap)ndviWrap.hidden=!['ndvi','ndvitrend'].includes(v);parcelMap.setColorMode(v);renderMapSheet();await store.setPreferences({mapColorMode:v});}
      else if(g==='base'){setOn('base',v);root.querySelectorAll('[data-ly="base"]').forEach(x=>x.setAttribute('aria-checked',String(x.dataset.value===v)));parcelMap.setBaseLayer(v);await store.setPreferences({mapLayer:normalizeBaseLayer(v)});}
      else if(g==='cadastre'){const on=!b.classList.contains('is-on');b.classList.toggle('is-on',on);b.setAttribute('aria-checked',String(on));root.querySelector('#cadastre-opacity-field')?.classList.toggle('hidden',!on);parcelMap.setCadastreOverlay(on,state().preferences.mapCadastreOpacity);await store.setPreferences({mapCadastre:on});if(on)toast(navigator.onLine?'Cadastre affiché. Touchez la carte pour connaître une parcelle cadastrale.':'Cadastre activé : il s’affichera au retour du réseau.');}
      else if(g==='radius'){setOn('radius',v);await store.setPreferences({rpgRadiusKm:Number(v)});if(parcelMap.rpgVisible)await loadRpg(Number(v));}
      else if(g==='labels'){const on=!b.classList.contains('is-on');b.classList.toggle('is-on',on);b.setAttribute('aria-checked',String(on));document.documentElement.classList.toggle('hide-parcel-labels',!on);parcelMap?.updateLabels?.();await store.setPreferences({mapHideLabels:!on});}
      else if(g==='photos'){const on=!b.classList.contains('is-on');b.classList.toggle('is-on',on);b.setAttribute('aria-checked',String(on));await photoGeo().setLayer(on);}
      else if(g==='rpg'){const on=!b.classList.contains('is-on');b.classList.toggle('is-on',on);b.setAttribute('aria-checked',String(on));if(on){const r=Number(root.querySelector('[data-ly="radius"].is-on')?.dataset.value||5);await loadRpg(r);}else parcelMap.setRpgVisible(false);}
    }catch(error){if(error.name!=='AbortError'){if(root.isConnected)progress.textContent=error.message;toast(error.message,'error');if(g==='rpg'){b.classList.remove('is-on');b.setAttribute('aria-checked','false');}}}
  });
  }
  return {open};
}
