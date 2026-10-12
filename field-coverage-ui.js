// n° 42 - Enregistrement GPS du chantier en direct : interface et capteur.
// La logique (échantillonnage, simplification, couverture) est dans field-coverage.js.
import {TRACK_LIMITS,trackPoint,shouldRecord,appendTrack,trackCoverage,pickResolution,coverageLabel,trackToGpx,trackSwathFeatures} from './field-coverage.js';
import {escapeHtml as e,formatNumber,geometryBbox,download} from './utils.js';

export function createFieldCoverageUI({store,state,active,parcelById,toast,requestWakeLock=()=>{},showOnMap=null,onPosition=null}){
  let watchId=null,sessionId=null,buffer=[],last=null,lastRaw=null,lastFlush=0,flushing=null,live=null,liveAt=0,position=null,warned=false;
  const session=()=>sessionId?store.get('fieldSessions',sessionId):null;
  const width=s=>Number(s?.trackWidthM)||0;
  const fullTrack=s=>[...(s?.track||[]),...buffer];

  function formFields({equipmentId=''}={}){
    const machine=equipmentId?store.get('materiels',equipmentId):null;
    return `<fieldset class="span-2 field-track-fields"><legend>Trace GPS et couverture</legend><label class="check-row"><input type="checkbox" name="trackGps" value="1"> Enregistrer la trace et la couverture en direct</label><label>Largeur de travail (m)<input name="trackWidthM" type="number" min="0.5" max="60" step="0.1" inputmode="decimal" value="${e(machine?.workingWidthM??'')}" placeholder="Ex. 6"></label><p class="form-note">Estimation par le GPS du téléphone (quelques mètres), pas du guidage RTK. Gardez l’écran allumé pendant le chantier.</p></fieldset>`;
  }
  // La largeur suit l'engin choisi, sauf saisie manuelle.
  function bindForm(form){
    const select=form?.querySelector('[name="equipmentId"]'),input=form?.querySelector('[name="trackWidthM"]');if(!select||!input)return;
    let manual=false;input.addEventListener('input',()=>{manual=true;});
    select.addEventListener('change',()=>{if(manual)return;const m=select.value?store.get('materiels',select.value):null;input.value=m?.workingWidthM??'';});
  }
  function sessionPatch(values){
    if(!values?.trackGps)return{};
    const w=Number(String(values.trackWidthM||'').replace(',','.'));
    if(!(w>0&&w<=60))throw new Error('Indiquez la largeur de travail de l’outil (en mètres) pour mesurer la couverture.');
    return{trackEnabled:true,trackWidthM:Math.round(w*10)/10,track:[]};
  }

  async function flush(force=false){
    const s=session();if(!s||!buffer.length)return;
    if(!force&&buffer.length<TRACK_LIMITS.batchSize&&Date.now()-lastFlush<TRACK_LIMITS.batchMs)return;
    if(flushing)return flushing;
    const batch=buffer;buffer=[];lastFlush=Date.now();
    flushing=store.upsert('fieldSessions',{...s,track:appendTrack(s.track,batch)},{label:'Trace GPS du chantier enregistrée.'})
      .catch(error=>{buffer=[...batch,...buffer];if(!warned){warned=true;toast(`Trace non enregistrée : ${error.message}`,'error');}})
      .finally(()=>{flushing=null;});
    return flushing;
  }
  function onPos(pos){
    const s=session();if(!s)return;
    const c=pos?.coords||pos;position=c;onPosition?.(c);
    const p=trackPoint(c,Number(pos?.timestamp)||Date.now(),lastRaw||(s.track||[]).at(-1));
    if(!shouldRecord(last||(s.track||[]).at(-1),p))return renderLive();
    buffer.push(p);last=p;lastRaw=p;flush();renderLive();
  }
  function start(id){
    if(watchId!==null&&sessionId===id)return;
    stopWatch();sessionId=id;buffer=[];last=null;lastRaw=null;lastFlush=Date.now();warned=false;
    if(!navigator.geolocation){toast('GPS indisponible sur cet appareil : la trace ne sera pas enregistrée.','error');return;}
    requestWakeLock();
    try{watchId=navigator.geolocation.watchPosition(onPos,err=>{if(err?.code===1)toast('Position refusée : autorisez la localisation pour enregistrer la trace.','error');},{enableHighAccuracy:true,maximumAge:1000,timeout:30000});}
    catch{watchId=null;}
  }
  function stopWatch(){if(watchId!==null){try{navigator.geolocation.clearWatch(watchId);}catch{}}watchId=null;}
  // Arrêt : dernier paquet, couverture finale ; renvoie les champs à enregistrer sur la session.
  async function stop(id){
    if(sessionId!==id){const s=store.get('fieldSessions',id);return s?.trackEnabled?finalPatch(s,s.track||[]):{};}
    stopWatch();await flushing;await flush(true);const s=session();sessionId=null;live=null;
    return s?.trackEnabled?finalPatch(s,s.track||[]):{};
  }
  function finalPatch(s,track){
    const parcel=parcelById(s.parcelId);let cov=null;try{cov=trackCoverage(parcel,track,width(s));}catch{cov=null;}
    if(!cov||!track.length)return{};
    return{coveredHa:Math.round(cov.coveredHa*100)/100,coveragePercent:cov.percent,overlapHa:Math.round(cov.overlapHa*100)/100};
  }

  function liveCoverage(s,parcel){
    if(Date.now()-liveAt<4000&&live?.id===s.id&&live.n===fullTrack(s).length)return live.cov;
    let cov=null;try{const res=Math.max(5,pickResolution(parcel?.geometry)||5);cov=trackCoverage(parcel,fullTrack(s),width(s),{resolution:[5,10,20].find(r=>r>=res)||20});}catch{cov=null;}
    live={id:s.id,n:fullTrack(s).length,cov};liveAt=Date.now();return cov;
  }
  function svg(parcel,cov,s){
    const b=geometryBbox(parcel?.geometry);if(!b)return '';
    const k=Math.cos((b[1]+b[3])/2*Math.PI/180),W=(b[2]-b[0])*k||1e-9,H=(b[3]-b[1])||1e-9,size=240,sc=size/Math.max(W,H),w=Math.max(40,W*sc),h=Math.max(40,H*sc);
    const P=([lon,lat])=>`${((lon-b[0])*k*sc).toFixed(1)},${((b[3]-lat)*sc).toFixed(1)}`;
    const path=g=>(g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[]).map(poly=>poly.map(r=>'M'+r.map(P).join('L')+'Z').join('')).join('');
    const cells=(cov?.cells||[]).filter(c=>c.properties.classe!=='Couvert').map(c=>`<path d="${path(c.geometry)}" fill="${c.properties.color}" fill-opacity=".55"/>`).join('');
    const swaths=(cov?.swaths||trackSwathFeatures(fullTrack(s),width(s))).map(f=>`<path d="${path(f.geometry)}" class="track-swath"/>`).join('');
    const dot=position?`<circle cx="${P([position.longitude,position.latitude]).split(',')[0]}" cy="${P([position.longitude,position.latitude]).split(',')[1]}" r="5" class="track-dot"/>`:'';
    return `<svg class="field-track-map" viewBox="-4 -4 ${(w+8).toFixed(0)} ${(h+8).toFixed(0)}" role="img" aria-label="Carte de couverture : bande travaillée, manques en orange, recouvrements en rouge"><path d="${path(parcel.geometry)}" class="track-parcel"/>${cells}${swaths}${dot}</svg>`;
  }
  function renderLive(){const host=document.querySelector('#field-coverage-live');if(host)host.replaceWith(liveNode());}
  function liveNode(){
    const s=session(),parcel=parcelById(s?.parcelId),node=document.createElement('div');node.id='field-coverage-live';node.className='field-track-live';
    if(!s)return node;const cov=liveCoverage(s,parcel);
    node.innerHTML=`<p class="field-track-percent" aria-live="polite"><strong>${e(coverageLabel(parcel?.nom,cov))}</strong></p>${parcel?.geometry?svg(parcel,cov,s):'<p class="form-note">Contour de parcelle absent : la trace est enregistrée sans calcul de couverture.</p>'}<p class="field-track-legend"><span class="lg-swath">Travaillé (${formatNumber(width(s))} m)</span><span class="lg-miss">Manque</span><span class="lg-over">Recouvrement</span></p><p class="form-note">Gardez l’écran allumé. ${fullTrack(s).length} point${fullTrack(s).length>1?'s':''} · estimation GPS, pas du RTK.${watchId===null?' GPS en attente.':''}</p>`;
    return node;
  }
  // Appelé à chaque rendu de la carte de session du mode terrain.
  function mount(host,s){
    if(!host||!s?.trackEnabled||s.endedAt)return;
    if(sessionId!==s.id||watchId===null)start(s.id);
    host.querySelector('#field-coverage-live')?.remove();
    (host.querySelector('.field-session-card')||host).append(liveNode());
  }
  function summaryHtml(s){
    if(!s?.trackEnabled)return '';
    const n=(s.track||[]).length;if(!n)return '<p class="form-note">Aucune position enregistrée : la couverture n’a pas pu être estimée.</p>';
    return `<div class="field-track-summary"><p><strong>${Number.isFinite(s.coveragePercent)?`${s.coveragePercent} % couvert · ${formatNumber(s.coveredHa)} ha`:'Couverture indisponible'}</strong>${s.overlapHa?` · recouvrements ${formatNumber(s.overlapHa)} ha`:''}</p><p class="form-note">Surface couverte reprise dans le travail. Estimation GPS, pas du RTK.</p><div class="heading-actions"><button type="button" class="button secondary" data-action="field-track-map" data-id="${e(s.id)}">Voir sur la carte</button><button type="button" class="button secondary" data-action="field-track-gpx" data-id="${e(s.id)}">Exporter en GPX</button></div></div>`;
  }
  function action(name,control){
    if(!['field-track-map','field-track-gpx'].includes(name))return false;
    const s=store.get('fieldSessions',control?.dataset.id),parcel=parcelById(s?.parcelId);
    if(!s?.track?.length){toast('Aucune trace enregistrée pour cette session.','error');return true;}
    if(name==='field-track-gpx'){const day=new Date(Number(s.startedAt)||Date.now()).toISOString().slice(0,10);download(`trace-${day}-${(parcel?.nom||'parcelle').replace(/[^\p{L}\p{N}]+/gu,'-').toLowerCase()}.gpx`,trackToGpx(s.track,{name:`${s.type||'Chantier'} · ${parcel?.nom||''} · ${day}`}),'application/gpx+xml');return true;}
    const cov=trackCoverage(parcel,s.track,width(s));
    if(!cov){toast('Contour ou largeur manquant : couverture indisponible.','error');return true;}
    showOnMap?.([...cov.cells.filter(c=>c.properties.classe!=='Couvert'),...cov.swaths.map(f=>({...f,properties:{...f.properties,color:'#2f82b0'}}))],`${coverageLabel(parcel?.nom,cov)} · manques en orange, recouvrements en rouge`);
    return true;
  }
  return{formFields,bindForm,sessionPatch,start,stop,mount,summaryHtml,action,isRecording:()=>watchId!==null};
}
