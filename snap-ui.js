// n° 44 : accrochage aux limites pendant le dessin et la modification d'un contour.
// Les contours des parcelles et du RPG chargé sont projetés en pixels écran ; l'index
// (snap.js) est reconstruit seulement quand la vue ou les données changent.
import {buildSnapIndex,snapPoint,followBoundary,SNAP_TOLERANCE_PX} from './snap.js';
import {geometryBbox} from './utils.js';

function polygonsOf(geometry){
  if(geometry?.type==='Polygon')return[geometry.coordinates];
  if(geometry?.type==='MultiPolygon')return geometry.coordinates;
  return[];
}
function openRingOf(ring){const pts=ring||[];return pts.length>1&&pts[0][0]===pts[pts.length-1][0]&&pts[0][1]===pts[pts.length-1][1]?pts.slice(0,-1):pts;}

export function createSnapUI({getMap,getState,store,toast=null}){
  let cache=null,indicator=null,indicatorTimer=null;
  const enabled=()=>getState()?.preferences?.mapSnap!==false;

  // Anneaux candidats (lon/lat), identifiés par source.
  function sourceRings(){
    const pm=getMap(),state=getState()||{},rings=[];
    for(const p of state.parcelles||[]){if(p.deletedAt||p.archived||!p.geometry)continue;polygonsOf(p.geometry).forEach((poly,i)=>poly.forEach((ring,j)=>rings.push({id:`p:${p.id}:${i}:${j}`,parcelId:p.id,lonlat:openRingOf(ring),bbox:geometryBbox({coordinates:ring})})));}
    if(pm?.rpgVisible&&pm.rpgFeatures?.size)for(const [fid,f] of pm.rpgFeatures){polygonsOf(f.geometry||f).forEach((poly,i)=>poly.forEach((ring,j)=>rings.push({id:`r:${fid}:${i}:${j}`,parcelId:null,lonlat:openRingOf(ring),bbox:geometryBbox({coordinates:ring})})));}
    return rings;
  }

  function index(){
    const pm=getMap(),map=pm?.map;if(!map)return null;
    const state=getState(),b=map.getBounds().pad(0.25),z=map.getZoom(),c=map.getCenter(),size=map.getSize();
    const key=`${z}|${c.lat.toFixed(7)}|${c.lng.toFixed(7)}|${size.x}x${size.y}|${pm.rpgVisible?pm.rpgFeatures?.size:0}`;
    if(cache&&cache.key===key&&cache.state===state)return cache;
    const rings=sourceRings().filter(r=>r.bbox&&!(r.bbox[2]<b.getWest()||r.bbox[0]>b.getEast()||r.bbox[3]<b.getSouth()||r.bbox[1]>b.getNorth()));
    const byId=new Map(rings.map(r=>[r.id,r]));
    const idx=buildSnapIndex(rings.map(r=>({id:r.id,points:r.lonlat.map(([lng,lat])=>map.latLngToContainerPoint([lat,lng]))})));
    cache={key,state,idx,byId};return cache;
  }

  // Point aimanté : {latlng, snapped, ringId, kind, index, t}.
  function snap(latlng,{excludeParcelId=null}={}){
    const ll=window.L?L.latLng(latlng):latlng;
    if(!enabled())return{latlng:ll,snapped:false};
    const c=index(),map=getMap()?.map;if(!c||!map)return{latlng:ll,snapped:false};
    const p=map.latLngToContainerPoint(ll);
    const hit=snapPoint(c.idx,p,{tolerance:SNAP_TOLERANCE_PX,exclude:excludeParcelId?id=>c.byId.get(id)?.parcelId===excludeParcelId:null});
    if(!hit)return{latlng:ll,snapped:false};
    const ring=c.byId.get(hit.ringId);let out;
    if(hit.kind==='vertex'){const [lng,lat]=ring.lonlat[hit.index];out=L.latLng(lat,lng);}
    else{const a=ring.lonlat[hit.index],b=ring.lonlat[(hit.index+1)%ring.lonlat.length];out=L.latLng(a[1]+(b[1]-a[1])*hit.t,a[0]+(b[0]-a[0])*hit.t);}
    return{latlng:out,snapped:true,ringId:hit.ringId,kind:hit.kind,index:hit.index,t:hit.t};
  }

  // Anneau vert bref à l'endroit accroché, avec une vibration si disponible.
  function indicate(latlng){
    const map=getMap()?.map;if(!map||!window.L)return;
    try{navigator.vibrate?.(10);}catch{}
    indicator?.remove();clearTimeout(indicatorTimer);
    indicator=L.circleMarker(latlng,{pane:'editingPane',radius:12,color:'#1f9d55',weight:3,fill:false,interactive:false,className:'snap-indicator'}).addTo(map);
    indicatorTimer=setTimeout(()=>{indicator?.remove();indicator=null;},900);
  }

  // Le dessin vient d'ajouter un point : retour visuel et bouton « Suivre la limite ».
  function onDrawPoint(){
    const draw=getMap()?.polygonDraw;const last=draw?.snaps?.[draw.snaps.length-1];
    if(last)indicate(last.latlng);
    refresh();
  }

  function followCandidate(){
    const draw=getMap()?.polygonDraw;if(!draw?.snaps||draw.snaps.length<2)return null;
    const a=draw.snaps[draw.snaps.length-2],b=draw.snaps[draw.snaps.length-1];
    if(!a||!b||a.ringId!==b.ringId)return null;
    const ring=cache?.byId.get(a.ringId)||sourceRings().find(r=>r.id===a.ringId);if(!ring)return null;
    const between=followBoundary(ring.lonlat.length,a,b);
    return between.length?{ring,between}:null;
  }

  // Recopie les sommets du contour entre les deux derniers points accrochés.
  function follow(){
    const pm=getMap(),draw=pm?.polygonDraw,cand=followCandidate();
    if(!draw||!cand){toast?.('Accrochez deux points successifs sur le même contour.','error');return 0;}
    const pts=[...draw.points],last=pts.pop(),cfg={onUpdate:draw.onUpdate,onComplete:draw.onComplete,onCancel:draw.onCancel};
    const next=[...pts,...cand.between.map(i=>cand.ring.lonlat[i]),last];
    pm.cancelPolygonDrawing(false);pm.startPolygonDrawing(cfg);
    for(const [lng,lat] of next)pm.polygonDraw.click({latlng:{lng,lat}});
    toast?.(`${cand.between.length} sommet${cand.between.length>1?'s':''} recopié${cand.between.length>1?'s':''} depuis la limite.`,'success');
    return cand.between.length;
  }

  function refresh(){
    const on=enabled();
    document.querySelectorAll('[data-action="map-snap-toggle"]').forEach(b=>{b.setAttribute('aria-pressed',String(on));b.classList.toggle('is-active',on);b.textContent=on?'Aimant activé':'Aimant coupé';});
    const can=on&&Boolean(followCandidate());
    document.querySelectorAll('[data-action="draw-follow-boundary"]').forEach(b=>b.classList.toggle('hidden',!can));
  }

  async function toggle(){await store.setPreferences({mapSnap:!enabled()});cache=null;refresh();toast?.(enabled()?'Aimant activé : les points s’accrochent aux limites voisines.':'Aimant coupé.','info');}

  function attach(){const pm=getMap();if(!pm||pm.snapper)return;pm.snapper=latlng=>snap(latlng,{});pm.onDrawPoint=onDrawPoint;}

  return{snap,indicate,toggle,refresh,follow,attach,enabled,toggleHtml:()=>`<button type="button" class="small-button snap-toggle${enabled()?' is-active':''}" data-action="map-snap-toggle" aria-pressed="${enabled()}">${enabled()?'Aimant activé':'Aimant coupé'}</button>`};
}
