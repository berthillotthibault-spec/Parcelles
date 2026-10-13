// n° 70 — Interface haies et IAE : compteur (km de haies, % de SAU en IAE), inventaire, tracé sur la
// carte (ligne, contour) ou position GPS, réglages BCAE 8 et contrôle des travaux de taille.
import {escapeHtml as e,download,localDate} from './utils.js';
import {saveFarmRecord} from './farm-records.js';
import {active} from './farm-memory.js';
import {INFRA_KIND,INFRA_TYPES,infraType,infraRules,validateRules,geometryFromPoints,measure,validateInfra,infraItems,infraSummary,trimCheck,infraCsv,infraGeoJson} from './hedges.js';

const n1=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}),n2=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}),n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
const fr=md=>{const [m,d]=md.split('-');return`${Number(d)}/${m}`;};

export function createHedgesUI({store,modal,toast,draw=null}){
  const $=s=>document.querySelector(s);
  const data=()=>store.snapshot();
  const parcels=()=>active(data(),'parcelles').filter(p=>!p.archived).sort((a,b)=>String(a.nom).localeCompare(String(b.nom),'fr'));
  const err=(id,msg)=>{const el=$(id);if(el){el.textContent=msg;el.hidden=false;}};
  let pending=null; // {draft, geometry} pendant un tracé

  function open(){
    const s=infraSummary(data()),names=new Map(parcels().map(p=>[p.id,p.nom]));
    modal('Haies et IAE',`Inventaire des infrastructures agroécologiques · taille interdite du ${fr(s.rules.banStart)} au ${fr(s.rules.banEnd)}`,`<div class="preview-summary"><div class="preview-stat"><strong>${n2.format(s.hedgeKm)} km</strong><small>de haies et alignements</small></div><div class="preview-stat"><strong>${s.iaePct===null?'—':`${n1.format(s.iaePct)} %`}</strong><small>de SAU en IAE (pondéré)</small></div><div class="preview-stat"><strong>${n2.format(s.weightedHa)} ha</strong><small>surface pondérée · SAU ${n1.format(s.sauHa)} ha</small></div><div class="preview-stat"><strong>${s.sustainable}</strong><small>en gestion durable</small></div></div>
<h3>Par type</h3><div class="stack-list">${s.byType.map(x=>`<div class="list-row"><div><strong><span class="soil-dot" style="background:${x.type.color}"></span>${e(x.type.label)}</strong><small>${x.count} objet${x.count>1?'s':''}${x.length?` · ${n0.format(x.length)} m`:''}${x.area?` · ${n0.format(x.area)} m²`:''} · coefficient ${n1.format(x.type.coef)} ${e(x.type.unit)}</small></div><strong>${n0.format(x.weighted)} m²</strong></div>`).join('')}</div>
<h3>Inventaire</h3><div class="stack-list">${s.items.length?s.items.map(({item:i,m})=>`<div class="list-row"><div><strong>${e(i.label||infraType(i.type)?.label||'Objet')}</strong><small>${e(infraType(i.type)?.label||'')}${i.parcelId?` · ${e(names.get(i.parcelId)||'')}`:''}${m.length?` · ${n0.format(m.length)} m`:''}${m.area?` · ${n0.format(m.area)} m²`:''}${i.sustainable?' · gestion durable':''}${i.lastMaintenance?` · entretien ${e(localDate(i.lastMaintenance))}`:''}</small></div><button class="small-button" data-hedge="edit" data-id="${e(i.id)}">Modifier</button></div>`).join(''):'<div class="empty-state">Aucune infrastructure : ajoutez une haie, une mare, un bosquet…</div>'}</div>
<p class="form-note">Les objets apparaissent sur la carte. ${e(s.rules.source)} ${s.rules.custom?'Règles personnalisées en vigueur.':`Repères au ${e(localDate(s.rules.date))}.`}</p>`,
    `<button class="button secondary" data-hedge="rules">Règles BCAE 8</button><button class="button secondary" data-hedge="csv">CSV</button><button class="button secondary" data-hedge="geojson">GeoJSON</button><button class="button primary" data-hedge="new">Ajouter</button>`,'large');
  }

  function openForm(record=null,geometry=null,draft=null){
    const r=draft||record||{type:'haie',label:'',parcelId:'',widthM:'',areaM2:'',species:'',sustainable:false,lastMaintenance:'',note:''},g=geometry||record?.geometry||null,t=infraType(r.type);
    const m=g?measure({...r,geometry:g},infraRules(data())):null;
    modal(record?'Modifier l’infrastructure':'Nouvelle infrastructure','Haie, alignement, bande tampon, bosquet, mare ou arbre isolé.',`<form id="hedge-form" class="form-grid" data-id="${e(record?.id||'')}">
<label>Type<select name="type">${INFRA_TYPES.map(x=>`<option value="${x.key}" ${r.type===x.key?'selected':''}>${e(x.label)}</option>`).join('')}</select></label>
<label>Nom<input name="label" maxlength="80" value="${e(r.label||'')}" placeholder="Haie du chemin…"></label>
<label>Parcelle<select name="parcelId"><option value="">—</option>${parcels().map(p=>`<option value="${e(p.id)}" ${r.parcelId===p.id?'selected':''}>${e(p.nom)}</option>`).join('')}</select></label>
<label>Largeur (m, bande)<input name="widthM" type="number" min="0" max="100" step="any" inputmode="decimal" value="${e(r.widthM??'')}"></label>
<label>Surface (m², mare ponctuelle)<input name="areaM2" type="number" min="0" step="any" inputmode="decimal" value="${e(r.areaM2??'')}"></label>
<label>Dernier entretien<input name="lastMaintenance" type="date" value="${e(r.lastMaintenance||'')}"></label>
<label class="span-2">Essences<input name="species" maxlength="160" value="${e(r.species||'')}" placeholder="Charme, noisetier, aubépine…"></label>
<label class="span-2"><input type="checkbox" name="sustainable" ${r.sustainable?'checked':''}> Gestion durable (plan de gestion, Label Haie)</label>
<label class="span-2">Note<input name="note" maxlength="300" value="${e(r.note||'')}"></label>
<div class="span-2 notice ${g?'info':'warning'}">${g?`Géométrie : ${g.type==='LineString'?`ligne de ${n0.format(m.length)} m`:g.type==='Polygon'?`contour de ${n0.format(m.area)} m²`:'point'}.`:'Pas encore de géométrie.'} ${t?.shape==='point'?'Placez-vous sur l’objet puis « Ma position ».':''}</div>
<p class="form-error span-2" id="hedge-error" role="alert" hidden></p></form>`,
    `<button class="button secondary" data-hedge="back">Annuler</button>${record?`<button class="button danger" data-hedge="delete" data-id="${e(record.id)}">Supprimer</button>`:''}<button class="button secondary" data-hedge="gps">Ma position</button>${draw?'<button class="button secondary" data-hedge="draw">Tracer sur la carte</button>':''}<button class="button primary" data-hedge="save">Enregistrer</button>`,'large');
    pending={record,geometry:g};
  }

  const readDraft=()=>{const f=$('#hedge-form');const v=Object.fromEntries(new FormData(f));v.sustainable=f.elements.sustainable.checked;return v;};

  async function startDraw(){
    const v=readDraft(),t=infraType(v.type),record=pending?.record||null;
    const kind=t.shape==='line'?'distance':'area';
    try{const d=await draw(kind,`${t.label} : touchez la carte point par point`);openForm(record,geometryFromPoints(d.points,t.shape==='line'?'line':'area'),v);}
    catch(error){toast(error.message||'Tracé annulé.','info');openForm(record,pending?.geometry||null,v);}
  }
  function useGps(){
    const v=readDraft(),record=pending?.record||null;if(!globalThis.navigator?.geolocation)return toast('GPS indisponible.','error');
    navigator.geolocation.getCurrentPosition(p=>openForm(record,geometryFromPoints([{latitude:p.coords.latitude,longitude:p.coords.longitude}],'point'),{...v,type:infraType(v.type).shape==='line'||infraType(v.type).shape==='area'?'arbre':v.type}),()=>toast('Position indisponible : autorisez la localisation.','error'),{enableHighAccuracy:true,timeout:15000});
  }
  async function save(){
    const form=$('#hedge-form');if(!form)return;const existing=form.dataset.id?infraItems(data()).find(r=>r.id===form.dataset.id):null;
    const res=validateInfra({...readDraft(),geometry:pending?.geometry||null});if(res.error)return err('#hedge-error',res.error);
    await saveFarmRecord(store,INFRA_KIND,{...res.value,name:res.value.label||infraType(res.value.type).label},existing);
    pending=null;toast('Infrastructure enregistrée.','success');open();
  }

  function openRules(){
    const r=infraRules(data());
    modal('Règles BCAE 8 et coefficients','Période d’interdiction de taille et pondération des IAE (indicatif, modifiable).',`<form id="hedge-rules-form" class="form-grid">
<label>Début de l’interdiction (MM-JJ)<input name="banStart" value="${e(r.banStart)}" pattern="\\d{2}-\\d{2}"></label><label>Fin (MM-JJ)<input name="banEnd" value="${e(r.banEnd)}" pattern="\\d{2}-\\d{2}"></label>
${r.types.map(t=>`<label>${e(t.label)} (${e(t.unit)})<input name="coef_${t.key}" type="number" min="0" max="100" step="any" value="${e(t.coef)}" placeholder="${t.reference}"></label>`).join('')}
<label class="span-2">Source ou dérogation départementale<input name="note" maxlength="200" value="${e(r.note)}" placeholder="Arrêté préfectoral du…"></label>
<p class="form-note span-2">Référence : taille interdite du 16/03 au 15/08 (BCAE 8). ${e(INFRA_TYPES.map(t=>`${t.label} ${t.coef} ${t.unit}`).join(' · '))}. ${e(r.source)}</p>
<p class="form-error span-2" id="hedge-rules-error" role="alert" hidden></p></form>`,
    `<button class="button secondary" data-hedge="back">Retour</button><button class="button primary" data-hedge="save-rules">Enregistrer</button>`,'large');
  }
  async function saveRules(){
    const res=validateRules(Object.fromEntries(new FormData($('#hedge-rules-form'))));if(res.error)return err('#hedge-rules-error',res.error);
    await store.setPreferences({agroInfraRules:{...res.value,updatedAt:Date.now()}});toast('Règles enregistrées.','success');open();
  }

  /** Ajoute au formulaire de travail un avertissement BCAE 8 et la case de dérogation. */
  function enhanceWorkForm(form,item={}){
    if(!form||form.querySelector('.hedge-ban'))return;
    const grid=form.querySelector('.form-grid');if(!grid)return;
    grid.insertAdjacentHTML('afterend',`<div class="notice warning hedge-ban" hidden><p data-hedge-msg></p><label><input type="checkbox" name="hedgeDerogation" ${item.hedgeDerogation?'checked':''}> Dérogation ou cas autorisé : je confirme</label></div>`);
    const box=form.querySelector('.hedge-ban');
    const refresh=()=>{const v={type:form.elements.type?.value,product:form.elements.product?.value,date:form.elements.date?.value,plannedDate:form.elements.plannedDate?.value,status:form.elements.status?.value,hedgeDerogation:false};const c=trimCheck(v,data());box.hidden=!c.message;if(c.message)box.querySelector('[data-hedge-msg]').textContent=c.message;};
    form.addEventListener('input',refresh);form.addEventListener('change',refresh);refresh();
  }
  /** Contrôle à l'enregistrement : renvoie un message bloquant ou ''. */
  function guardWork(entity,form=null){
    // La case décochée est absente de FormData : on lit l'état réel du formulaire, et on garde false (sinon la fusion de l'upsert remet true).
    const box=form?.elements?.hedgeDerogation;entity.hedgeDerogation=box?Boolean(box.checked):(entity.hedgeDerogation==='on'||entity.hedgeDerogation===true);
    // Date effective (plannedDate||date si non terminé) : save-work aligne plannedDate sur la date saisie quand elle change, un report non modifié reste contrôlé.
    const c=trimCheck(entity,data());return c.blocked?c.message:'';
  }

  async function action(name,control){
    const id=control.dataset.id;
    if(name==='back'){pending=null;return open();}
    if(name==='new')return openForm();
    if(name==='edit'){const r=infraItems(data()).find(x=>x.id===id);if(r)openForm(r);return;}
    if(name==='delete'){const r=infraItems(data()).find(x=>x.id===id);if(!r)return;await store.remove('integrationImports',r.id);toast('Infrastructure supprimée.','success');return open();}
    if(name==='draw')return startDraw();
    if(name==='gps')return useGps();
    if(name==='save')return save();
    if(name==='rules')return openRules();
    if(name==='save-rules')return saveRules();
    if(name==='csv')return download(`haies-iae-${new Date().toISOString().slice(0,10)}.csv`,infraCsv(data()),'text/csv;charset=utf-8');
    if(name==='geojson')return download(`haies-iae-${new Date().toISOString().slice(0,10)}.geojson`,JSON.stringify(infraGeoJson(data())),'application/geo+json');
  }
  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-hedge]');if(!c||c.disabled)return;c.disabled=true;action(c.dataset.hedge,c).catch(error=>toast(error.message,'error')).finally(()=>{c.disabled=false;});});
  return{open,enhanceWorkForm,guardWork};
}
