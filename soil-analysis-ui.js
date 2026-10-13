// n° 68 — Interface des analyses de sol : fiches d'analyse (avec PDF du laboratoire), alertes
// d'ancienneté, besoin de chaulage et tâche associée, grille d'échantillonnage et guidage GPS.
import {escapeHtml as e,localDate,uid} from './utils.js';
import {saveFarmRecord} from './farm-records.js';
import {active} from './farm-memory.js';
import {SOIL_KIND,GRID_KIND,SOIL_REFERENCES,SOIL_FIELDS,textureOf,validateAnalysis,analyses,latestAnalysis,ageYears,limingNeed,phClass,analysisAlerts,samplingGrid,grids,guidance,nextPoint} from './soil-analysis.js';

const n1=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}),n2=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2});
const todayIso=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const METHODS=['Olsen','Joret-Hébert','Dyer','Autre'];

export function createSoilAnalysisUI({store,modal,toast,getPosition=null}){
  const $=s=>document.querySelector(s);
  const data=()=>store.snapshot();
  const parcels=()=>active(data(),'parcelles').filter(p=>!p.archived).sort((a,b)=>String(a.nom).localeCompare(String(b.nom),'fr'));
  const parcelName=id=>active(data(),'parcelles').find(p=>p.id===id)?.nom||'Parcelle';
  const err=(id,msg)=>{const el=$(id);if(el){el.textContent=msg;el.hidden=false;}};
  let watchId=null;
  const stopWatch=()=>{if(watchId!==null&&globalThis.navigator?.geolocation)navigator.geolocation.clearWatch(watchId);watchId=null;};

  const dot=ph=>{const c=phClass(ph);return c?`<span class="soil-dot" style="background:${c.color}" title="${e(c.label)}"></span>`:'';};
  const values=a=>SOIL_FIELDS.filter(([k])=>a[k]!==null&&a[k]!==undefined).map(([k,label])=>`${e(label.replace(/ \(.*\)/,''))} ${n2.format(a[k])}`).join(' · ');
  function needText(n){
    if(n.status==='no-ph')return'Pas de pH mesuré.';
    if(n.status==='no-texture')return'Indiquez la texture du sol pour estimer le chaulage.';
    if(n.status==='calcareous')return'Sol calcaire : pas de chaulage.';
    if(n.status==='ok')return`pH ${n1.format(n.ph)} ≥ cible ${n1.format(n.target)} : pas de chaulage de redressement.`;
    return`Redresser de ${n1.format(n.ph)} à ${n1.format(n.target)} : ≈ ${n1.format(n.cao)} t CaO/ha${n.years>1?`, en ${n.years} apports de ${n1.format(n.perYear)} t`:''}.`;
  }

  function parcelHtml(p){
    const a=latestAnalysis(data(),p.id),grid=grids(data(),p.id).at(-1);
    if(!a&&!grid)return`<section class="panel soil-panel"><div class="panel-heading"><h2>Analyse de sol</h2></div><p class="form-note">Aucune analyse enregistrée. Une analyse de moins de 6 ans est souvent demandée (zone vulnérable, MAEC).</p><button class="small-button" data-soil="new" data-parcel="${e(p.id)}">Saisir une analyse</button> <button class="small-button" data-soil="grid" data-parcel="${e(p.id)}">Grille d’échantillonnage</button></section>`;
    const age=a?ageYears(a.date,todayIso()):null,n=a?limingNeed(a):null;
    return`<section class="panel soil-panel"><div class="panel-heading"><h2>Analyse de sol</h2>${a?`<span class="pheno-flag">${e(localDate(a.date))}</span>`:''}</div>
${a?`<p>${dot(a.ph)}<strong>${values(a)||'—'}</strong></p>${age>SOIL_REFERENCES.maxAgeYears?`<div class="notice warning">Analyse de plus de ${SOIL_REFERENCES.maxAgeYears} ans (${n1.format(age)} ans) : à refaire.</div>`:''}<p class="form-note">${e(needText(n))}</p>`:''}
${grid?`<p class="form-note">Grille : ${grid.points.filter(x=>x.sampledAt).length}/${grid.points.length} points prélevés.</p>`:''}
<div class="chip-row">${a?`<button class="small-button" data-soil="liming" data-id="${e(a.id)}">Chaulage</button>`:''}<button class="small-button" data-soil="new" data-parcel="${e(p.id)}">Nouvelle analyse</button><button class="small-button" data-soil="grid" data-parcel="${e(p.id)}">Grille</button></div></section>`;
  }

  function open(){
    const d=data(),today=todayIso(),alerts=analysisAlerts(d,{today}),rows=parcels().map(p=>({p,a:latestAnalysis(d,p.id)})).filter(x=>x.a);
    modal('Analyses de sol',`pH, P, K, MgO, matière organique et CEC par parcelle · alerte au-delà de ${SOIL_REFERENCES.maxAgeYears} ans`,`
${alerts.length?`<h3>À analyser (${alerts.length})</h3><ul class="stock-alerts">${alerts.slice(0,30).map(x=>`<li class="is-warning">${e(x.parcel.nom||'Parcelle')} : ${x.analysis?`analyse de ${n1.format(x.age)} ans (${e(localDate(x.analysis.date))})`:'aucune analyse'} <button class="small-button" data-soil="grid" data-parcel="${e(x.parcel.id)}">Grille</button></li>`).join('')}</ul>`:'<div class="notice info">Toutes les parcelles ont une analyse de moins de 5 ans.</div>'}
<h3>Dernières analyses</h3><div class="stack-list">${rows.length?rows.map(({p,a})=>`<div class="list-row"><div><strong>${dot(a.ph)}${e(p.nom)}</strong><small>${e(localDate(a.date))}${a.lab?` · ${e(a.lab)}`:''} · ${values(a)||'—'}</small><small>${e(needText(limingNeed(a)))}</small></div><button class="small-button" data-soil="liming" data-id="${e(a.id)}">Chaulage</button><button class="small-button" data-soil="edit" data-id="${e(a.id)}">Modifier</button></div>`).join(''):'<div class="empty-state">Aucune analyse de sol enregistrée.</div>'}</div>
<p class="form-note">Sur la carte, « Colorer par › pH du sol » montre la dernière analyse de chaque parcelle. ${e(SOIL_REFERENCES.source)} (repères au ${e(localDate(SOIL_REFERENCES.date))}).</p>`,
    `<button class="button primary" data-soil="new">Nouvelle analyse</button>`,'large');
  }

  function openForm(record=null,parcelId=''){
    const pid=parcelId||parcels()[0]?.id||'',r=record||{parcelId:pid,date:todayIso(),texture:pid?latestAnalysis(data(),pid)?.texture||'':''};
    modal(record?'Modifier l’analyse de sol':'Analyse de sol','Résultats du laboratoire ; seuls les champs connus sont nécessaires.',`<form id="soil-form" class="form-grid" data-id="${e(record?.id||'')}">
<label>Parcelle<select name="parcelId" required>${parcels().map(p=>`<option value="${e(p.id)}" ${r.parcelId===p.id?'selected':''}>${e(p.nom)}</option>`).join('')}</select></label>
<label>Date de prélèvement<input type="date" name="date" value="${e(r.date)}"></label>
<label>Laboratoire<input name="lab" maxlength="120" value="${e(r.lab||'')}"></label>
<label>Zone ou point<input name="zone" maxlength="80" value="${e(r.zone||'')}" placeholder="Parcelle entière, zone nord…"></label>
<label>Texture<select name="texture"><option value="">—</option>${SOIL_REFERENCES.textures.map(t=>`<option value="${t.key}" ${r.texture===t.key?'selected':''}>${e(t.label)}</option>`).join('')}</select></label>
<label>Méthode P₂O₅<select name="method"><option value="">—</option>${METHODS.map(m=>`<option ${r.method===m?'selected':''}>${m}</option>`).join('')}</select></label>
${SOIL_FIELDS.map(([k,label,min,max])=>`<label>${label}<input name="${k}" type="number" min="${min}" max="${max}" step="any" inputmode="decimal" value="${e(r[k]??'')}"></label>`).join('')}
<label>pH cible (facultatif)<input name="targetPh" type="number" min="5" max="7.5" step="0.1" inputmode="decimal" value="${e(r.targetPh??'')}" placeholder="selon la texture"></label>
<label>Latitude<input name="latitude" type="number" step="any" inputmode="decimal" value="${e(r.latitude??'')}"></label>
<label>Longitude<input name="longitude" type="number" step="any" inputmode="decimal" value="${e(r.longitude??'')}"></label>
<p class="span-2"><button type="button" class="small-button" data-soil="here">Utiliser ma position</button></p>
<label class="span-2">Bulletin du laboratoire (PDF ou photo)<input type="file" name="labFile" accept="application/pdf,image/*"></label>
<label class="span-2">Note<input name="note" maxlength="300" value="${e(r.note||'')}"></label>
<p class="form-error span-2" id="soil-error" role="alert" hidden></p></form>`,
    `<button class="button secondary" data-soil="back">Annuler</button>${record?`<button class="button danger" data-soil="delete" data-id="${e(record.id)}">Supprimer</button>`:''}<button class="button primary" data-soil="save">Enregistrer</button>`,'large');
  }

  async function attachLabFile(file,parcelId,date){
    const id=uid('doc');await store.storage.blobPut(id,file);
    try{await store.upsert('documents',{id,parcelId,name:file.name||'analyse-de-sol',mimeType:file.type||'application/octet-stream',size:file.size,originalSize:file.size,note:'Analyse de sol',category:'Analyse',documentDate:date,tags:['analyse','sol'],kind:'document',capturedAt:Date.now(),source:'local'},{label:`Analyse de sol : ${file.name}`,queue:false});}
    catch(error){await store.storage.blobDelete(id).catch(()=>{});throw error;}
    return id;
  }

  async function save(){
    const form=$('#soil-form');if(!form)return;const existing=form.dataset.id?analyses(data()).find(r=>r.id===form.dataset.id):null;
    const res=validateAnalysis(Object.fromEntries(new FormData(form)));if(res.error)return err('#soil-error',res.error);
    const file=form.elements.labFile?.files?.[0],documentId=file?await attachLabFile(file,res.value.parcelId,res.value.date):existing?.documentId||null;
    const saved=await saveFarmRecord(store,SOIL_KIND,{...res.value,documentId,name:`Analyse de sol ${parcelName(res.value.parcelId)} ${res.value.date}`},existing);
    toast('Analyse enregistrée.','success');openLiming(saved?.id);
  }

  function openLiming(id,product='carbonate'){
    const a=analyses(data()).find(r=>r.id===id);if(!a)return open();const n=limingNeed(a,{product}),docs=new Set(active(data(),'documents').map(d=>d.id));
    modal('Plan de chaulage',`${parcelName(a.parcelId)} · analyse du ${localDate(a.date)}`,`<p>${dot(a.ph)}<strong>${values(a)||'—'}</strong>${a.texture?` · ${e(textureOf(a.texture)?.label||'')}`:''}</p>
<div class="notice ${n.status==='need'?'warning':'info'}">${e(needText(n))}</div>
${n.status==='need'?`<div class="preview-summary"><div class="preview-stat"><strong>${n1.format(n.cao)} t CaO/ha</strong><small>besoin total</small></div><div class="preview-stat"><strong>${n1.format(n.productTonnes)} t/ha</strong><small>${e(n.product.label.toLowerCase())}</small></div><div class="preview-stat"><strong>${n.years}</strong><small>apport${n.years>1?'s':''} (≤ ${SOIL_REFERENCES.maxPerYear} t CaO/ha/an)</small></div></div>
<div class="chip-row">${SOIL_REFERENCES.products.map(p=>`<button type="button" class="small-button ${p.key===n.product.key?'is-active':''}" data-soil="liming-product" data-id="${e(a.id)}" data-product="${p.key}">${e(p.label)} (VN ${p.vn})</button>`).join('')}</div>`:''}
<p class="form-note">Calcul indicatif : (pH cible − pH mesuré) × ${SOIL_REFERENCES.textures.filter(t=>t.tPerUnit).map(t=>`${n1.format(t.tPerUnit)} t CaO par unité de pH en sol ${t.key}`).join(', ')}. Les seuils agronomiques sont sous la responsabilité de votre conseiller ; la valeur neutralisante réelle figure sur l’étiquette de l’amendement.</p>`,
    `<button class="button secondary" data-soil="back">Retour</button>${a.documentId&&docs.has(a.documentId)?`<button class="button secondary" data-action="view-attachment" data-type="documents" data-id="${e(a.documentId)}">Bulletin</button>`:''}<button class="button secondary" data-soil="edit" data-id="${e(a.id)}">Modifier</button>${n.status==='need'?`<button class="button primary" data-soil="liming-task" data-id="${e(a.id)}" data-product="${e(n.product.key)}">Créer la tâche</button>`:''}`,'large');
  }

  async function createLimingTask(id,product){
    const a=analyses(data()).find(r=>r.id===id);if(!a)return;const n=limingNeed(a,{product});if(n.status!=='need')return;
    const due=new Date();due.setMonth(due.getMonth()+1);
    await store.upsert('tasks',{title:`Chaulage ${parcelName(a.parcelId)} : ${n1.format(n.perYear)} t CaO/ha`,parcelId:a.parcelId,dueDate:due.toISOString().slice(0,10),status:'À faire',
      note:`${n1.format(n.productPerYear)} t/ha de ${n.product.label.toLowerCase()} (VN ${n.product.vn})${n.years>1?`, apport 1 sur ${n.years}`:''}. pH ${n1.format(n.ph)} → ${n1.format(n.target)} (analyse du ${localDate(a.date)}). Calcul indicatif.`},{label:'Tâche de chaulage créée'});
    toast('Tâche de chaulage créée.','success');
  }

  function openGrid(parcelId){
    const p=active(data(),'parcelles').find(x=>x.id===parcelId);if(!p)return;const grid=grids(data(),parcelId).at(-1);
    const done=grid?grid.points.filter(x=>x.sampledAt).length:0;
    modal('Grille d’échantillonnage',`${p.nom} · ${n2.format(Number(p.surfaceHa)||0)} ha`,`${grid?`<p><strong>${grid.points.length} points</strong> · ${done} prélevé${done>1?'s':''} · créée le ${e(localDate(grid.date))}</p><div class="stack-list">${grid.points.map(x=>`<div class="list-row"><div><strong>Point ${x.n}</strong><small>${x.latitude.toFixed(5)}, ${x.longitude.toFixed(5)}${x.sampledAt?` · prélevé le ${e(localDate(new Date(x.sampledAt).toISOString()))}`:''}</small></div>${x.sampledAt?'<span class="is-info">fait</span>':''}</div>`).join('')}</div>`:'<p class="form-note">Aucune grille : choisissez la densité puis générez les points.</p>'}
${p.geometry?`<form id="soil-grid-form" class="form-grid"><label>Un point tous les (ha)<input name="haPerPoint" type="number" min="0.25" max="20" step="0.25" value="${e(grid?.haPerPoint||1)}"></label></form>`:'<div class="notice warning">La parcelle n’a pas de contour : dessinez-la ou importez-la pour générer la grille.</div>'}
<p class="form-note">Les points sont au centre de mailles régulières dans le contour, numérotés en zigzag (rangées alternées) pour limiter la marche. Composez chaque échantillon de plusieurs prélèvements autour du point.</p>`,
    `<button class="button secondary" data-soil="back">Retour</button>${p.geometry?`<button class="button secondary" data-soil="grid-make" data-parcel="${e(p.id)}">${grid?'Régénérer':'Générer'}</button>`:''}${grid&&nextPoint(grid)?`<button class="button primary" data-soil="guide" data-id="${e(grid.id)}">Guider (GPS)</button>`:''}`,'large');
  }

  async function makeGrid(parcelId){
    const p=active(data(),'parcelles').find(x=>x.id===parcelId);const ha=Number(String($('#soil-grid-form [name=haPerPoint]')?.value||1).replace(',','.'));
    if(!(ha>=0.25&&ha<=20))return toast('Densité entre 0,25 et 20 ha par point.','error');
    const points=samplingGrid(p.geometry,{haPerPoint:ha});if(!points.length)return toast('Contour inutilisable pour une grille.','error');
    const existing=grids(data(),parcelId).at(-1)||null;
    await saveFarmRecord(store,GRID_KIND,{parcelId,date:todayIso(),haPerPoint:ha,points,name:`Grille d’échantillonnage ${p.nom}`},existing);
    toast(`${points.length} points générés.`,'success');openGrid(parcelId);
  }

  function renderGuide(grid,pos){
    const box=$('#soil-guide');if(!box)return stopWatch();const next=nextPoint(grid);
    if(!next){box.innerHTML='<div class="notice info">Tous les points sont prélevés.</div>';return;}
    const g=pos?guidance(pos,next):null;
    box.innerHTML=`<p class="soil-guide-point">Point ${next.n} / ${grid.points.length}</p>${g?`<div class="soil-guide-arrow" style="transform:rotate(${g.bearing-(pos.heading||0)}deg)" aria-hidden="true">↑</div><p class="soil-guide-dist"><strong>${g.distance} m</strong> vers le ${g.cardinal} (${g.bearing}°)</p>${pos.accuracy?`<p class="form-note">Précision GPS ± ${Math.round(pos.accuracy)} m${g.distance<=Math.max(10,pos.accuracy)?' · vous êtes sur le point':''}</p>`:''}`:'<p class="form-note">Recherche de la position GPS…</p>'}`;
  }
  function openGuide(id){
    const grid=grids(data()).find(r=>r.id===id);if(!grid)return;let pos=null;stopWatch();
    modal('Guidage échantillonnage',parcelName(grid.parcelId),`<div id="soil-guide" class="soil-guide"></div><p class="form-note">L’orientation de la flèche suppose le téléphone tenu dans le sens de la marche. Le guidage s’arrête en fermant cette fenêtre.</p>`,
      `<button class="button secondary" data-soil="guide-stop" data-parcel="${e(grid.parcelId)}">Terminer</button><button class="button primary" data-soil="sampled" data-id="${e(grid.id)}">Point prélevé</button>`,'small');
    renderGuide(grid,null);
    if(globalThis.navigator?.geolocation)watchId=navigator.geolocation.watchPosition(p=>{pos={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,heading:Number.isFinite(p.coords.heading)?p.coords.heading:0};const g=grids(data()).find(r=>r.id===id);if(g)renderGuide(g,pos);else stopWatch();},()=>{const box=$('#soil-guide');if(box)box.insertAdjacentHTML('beforeend','<p class="form-note">Position indisponible : autorisez la localisation.</p>');},{enableHighAccuracy:true,maximumAge:2000,timeout:20000});
    else if(getPosition)getPosition().then(p=>{pos=p;renderGuide(grid,pos);}).catch(()=>{});
  }
  async function markSampled(id){
    const grid=grids(data()).find(r=>r.id===id);const next=nextPoint(grid);if(!next)return;
    await saveFarmRecord(store,GRID_KIND,{...grid,points:grid.points.map(x=>x.n===next.n?{...x,sampledAt:Date.now()}:x)},grid);
    const g=grids(data()).find(r=>r.id===id);renderGuide(g,null);toast(`Point ${next.n} prélevé.`,'success');
  }

  async function action(name,control){
    const id=control.dataset.id;
    if(name==='back'){stopWatch();return open();}
    if(name==='new')return openForm(null,control.dataset.parcel||'');
    if(name==='edit'){const r=analyses(data()).find(x=>x.id===id);if(r)openForm(r);return;}
    if(name==='delete'){const r=analyses(data()).find(x=>x.id===id);if(!r)return;await store.remove('integrationImports',r.id);toast('Analyse supprimée.','success');return open();}
    if(name==='save')return save();
    if(name==='here'){const f=$('#soil-form');if(!f||!globalThis.navigator?.geolocation)return toast('GPS indisponible.','error');navigator.geolocation.getCurrentPosition(p=>{f.elements.latitude.value=p.coords.latitude.toFixed(6);f.elements.longitude.value=p.coords.longitude.toFixed(6);},()=>toast('Position indisponible.','error'),{enableHighAccuracy:true,timeout:15000});return;}
    if(name==='liming')return openLiming(id);
    if(name==='liming-product')return openLiming(id,control.dataset.product);
    if(name==='liming-task')return createLimingTask(id,control.dataset.product);
    if(name==='grid'){stopWatch();return openGrid(control.dataset.parcel);}
    if(name==='grid-make')return makeGrid(control.dataset.parcel);
    if(name==='guide')return openGuide(id);
    if(name==='guide-stop'){stopWatch();return openGrid(control.dataset.parcel);}
    if(name==='sampled')return markSampled(id);
  }
  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-soil]');if(!c||c.disabled)return;c.disabled=true;action(c.dataset.soil,c).catch(error=>toast(error.message,'error')).finally(()=>{c.disabled=false;});});
  return{open,parcelHtml,openForm};
}
