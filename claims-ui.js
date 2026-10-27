// n° 94 — Interface du dossier sinistre : ouverture depuis une observation de dégâts, surface,
// photos d'origine (sans recompression), météo du jour, perte estimée, suivi par statut et PDF.
import {escapeHtml as e,localDate,uid} from './utils.js';
import {flowPdf,pdfFile,sharePdf,jpegInfo} from './pdf-lite.js';
import {saveFarmRecord} from './farm-records.js';
import {attachmentBlob} from './storage-care.js';
import {active} from './farm-memory.js';
import {CLAIM_KIND,CLAIM_CAUSES,CLAIM_STATUSES,causeLabel,claimsFor,claimDraft,claimArea,estimateLoss,validateClaim,nextStatus,weatherUrl,parseWeather,weatherText,WEATHER_SOURCE,claimPdfBlocks,exifDate,claimsTreasury,CLAIM_PAYMENT_DELAY_MONTHS} from './claims.js';

const n2=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2});
const eur=v=>v===null||v===undefined?'—':`${n2.format(v)} €`;
const todayIso=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

export function createClaimsUI({store,modal,closeModal,toast}){
  const $=s=>document.querySelector(s);
  const data=()=>store.snapshot();
  const byId=id=>claimsFor(data()).find(c=>c.id===id)||null;
  const photosOf=c=>active(data(),'photos').filter(p=>p.claimId===c.id||(c.observationId&&p.observationId===c.observationId));
  const save=(payload,existing)=>saveFarmRecord(store,CLAIM_KIND,{...payload,name:`Sinistre ${causeLabel(payload.cause)} ${payload.date}`},existing);

  function openFromObservation(observation){
    const existing=claimsFor(data(),observation?.id)[0];
    return existing?openClaim(existing.id):openForm(claimDraft(data(),observation));
  }

  function openForm(c,existing=null){
    const d=data(),parcel=active(d,'parcelles').find(p=>p.id===c.parcelId),zones=active(d,'points').filter(p=>p.type==='Zone'&&Number(p.areaHa)>0).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    modal(existing?'Modifier le dossier sinistre':'Ouvrir un dossier sinistre',`${parcel?e(parcel.nom):'Sans parcelle'}${parcel?.surfaceHa?` · ${n2.format(parcel.surfaceHa)} ha`:''}`,`<form id="claim-form" class="form-grid">
<label>Nature<select name="cause">${CLAIM_CAUSES.map(([k,v])=>`<option value="${k}" ${c.cause===k?'selected':''}>${e(v)}</option>`).join('')}</select></label>
<label>Date du sinistre<input type="date" name="date" value="${e(c.date||todayIso())}"></label>
<label>Culture<input name="culture" maxlength="80" value="${e(c.culture||'')}"></label>
<label>Variété<input name="variety" maxlength="80" value="${e(c.variety||'')}"></label>
<label>Rendement attendu<input name="expectedYield" type="number" min="0" step="any" inputmode="decimal" value="${e(c.expectedYield??'')}"></label>
<label>Unité<select name="yieldUnit"><option ${c.yieldUnit!=='q/ha'?'selected':''}>t/ha</option><option ${c.yieldUnit==='q/ha'?'selected':''}>q/ha</option></select></label>
<label>Prix (€/t, ou €/q si q/ha)<input name="price" type="number" min="0" step="any" inputmode="decimal" value="${e(c.price??'')}"></label>
<label>Taux de perte estimé (%)<input name="lossPct" type="number" min="0" max="100" step="any" inputmode="decimal" value="${e(c.lossPct??'')}"></label>
<label>Surface touchée<select name="areaMode"><option value="saisie" ${c.areaMode==='saisie'?'selected':''}>Saisie (ha)</option><option value="zone" ${c.areaMode==='zone'?'selected':''} ${zones.length?'':'disabled'}>Zone mesurée</option><option value="parcelle" ${c.areaMode==='parcelle'?'selected':''} ${parcel?'':'disabled'}>Part de la parcelle (%)</option></select></label>
<label>Surface saisie (ha)<input name="areaHa" type="number" min="0" step="any" inputmode="decimal" value="${e(c.areaHa??'')}"></label>
<label>Zone mesurée<select name="zoneId"><option value="">—</option>${zones.map(z=>`<option value="${e(z.id)}" ${c.zoneId===z.id?'selected':''}>${e(z.name||z.title||'Zone')} · ${n2.format(z.areaHa)} ha</option>`).join('')}</select></label>
<label>Part de la parcelle (%)<input name="areaPct" type="number" min="0" max="100" step="any" inputmode="decimal" value="${e(c.areaPct??'')}"></label>
<label>Indemnité reçue ou proposée (€)<input name="indemnity" type="number" min="0" step="any" inputmode="decimal" value="${e(c.indemnity??'')}"></label>
<label>Versement attendu le<input type="date" name="expectedPaymentDate" value="${e(c.expectedPaymentDate||'')}" aria-describedby="claim-payment-note"></label>
<p class="form-note" id="claim-payment-note">Sert au prévisionnel de trésorerie ; sans date, ${CLAIM_PAYMENT_DELAY_MONTHS} mois après le sinistre.</p>
<label class="span-2">Constat<textarea name="note">${e(c.note||'')}</textarea></label>
<p class="form-note span-2">Pour tracer la zone touchée, mesurez-la en marchant (Carte › Mesurer une zone), puis choisissez-la ici.</p>
<p class="form-error span-2" id="claim-error" role="alert" hidden></p></form>`,
    `<button class="button secondary" data-action="close-modal">Annuler</button>${zones.length?'':'<button class="button secondary" data-action="walk-measure">Mesurer une zone</button>'}<button class="button primary" data-claim="save" data-id="${e(existing?.id||'')}">Enregistrer</button>`,'large');
    draftFor=c;
  }
  let draftFor=null;

  async function saveForm(id){
    const form=$('#claim-form');if(!form)return;const existing=id?byId(id):null,base=existing||draftFor||{};
    const r=validateClaim({...base,...Object.fromEntries(new FormData(form))});
    if(r.error){const err=$('#claim-error');err.textContent=r.error;err.hidden=false;return;}
    const saved=await save({...r.value,zoneId:r.value.zoneId||null},existing);
    toast(existing?'Dossier sinistre enregistré.':'Dossier sinistre ouvert.','success');openClaim(saved.id);
  }

  function openClaim(id){
    const d=data(),c=byId(id);if(!c)return open();
    const parcel=active(d,'parcelles').find(p=>p.id===c.parcelId),area=claimArea(d,c),loss=estimateLoss({areaHa:area,expectedYield:c.expectedYield,yieldUnit:c.yieldUnit,lossPct:c.lossPct,price:c.price}),photos=photosOf(c),idx=CLAIM_STATUSES.indexOf(c.status);
    modal(`Sinistre · ${causeLabel(c.cause)}`,`${parcel?e(parcel.nom):'Sans parcelle'} · ${e(localDate(c.date))} · ${e(c.status)}`,`<div class="preview-summary"><div class="preview-stat"><strong>${area===null?'—':`${n2.format(area)} ha`}</strong><small>surface touchée</small></div><div class="preview-stat"><strong>${loss.tonnes===null?'—':`${n2.format(loss.tonnes)} t`}</strong><small>perte estimée</small></div><div class="preview-stat"><strong>${eur(loss.euros)}</strong><small>valeur estimée</small></div><div class="preview-stat"><strong>${photos.length}</strong><small>photo${photos.length>1?'s':''}</small></div></div>
<div class="definition-list"><div><dt>Culture</dt><dd>${e(c.culture||'—')}${c.variety?` · ${e(c.variety)}`:''}</dd></div><div><dt>Rendement attendu</dt><dd>${c.expectedYield===null||c.expectedYield===undefined?'—':`${n2.format(c.expectedYield)} ${e(c.yieldUnit)}`}</dd></div><div><dt>Taux de perte</dt><dd>${c.lossPct===null||c.lossPct===undefined?'à estimer':`${n2.format(c.lossPct)} %`}</dd></div><div><dt>Indemnité</dt><dd>${eur(c.indemnity??null)}</dd></div></div>
<h3>Météo du jour</h3><p>${e(weatherText(c.weather))}</p><p class="form-note">${e(WEATHER_SOURCE)}</p>
<h3>Suivi</h3><div class="chip-row claim-status">${CLAIM_STATUSES.map((s,i)=>`<button type="button" class="small-button ${s===c.status?'is-active':''}" data-claim="status" data-id="${e(c.id)}" data-status="${e(s)}" ${i<idx?'disabled':''}>${e(s)}</button>`).join('')}</div>
${(c.statusHistory||[]).length?`<ul class="stack-list">${c.statusHistory.map(h=>`<li>${e(localDate(h.date))} : ${e(h.status)}</li>`).join('')}</ul>`:''}
<h3>Photos</h3><p class="form-note">Photos d’origine conservées telles quelles (date et données EXIF intactes).</p>${photos.length?`<ul class="stack-list">${photos.map(p=>`<li>${e(p.name||'Photo')}${p.takenAt?` · prise le ${e(localDate(p.takenAt))}`:''}${p.claimId?'':' · photo de l’observation'}</li>`).join('')}</ul>`:''}
<label class="button secondary claim-photo-input">Ajouter des photos<input type="file" id="claim-photos" accept="image/*" multiple hidden data-id="${e(c.id)}"></label>`,
    `<button class="button secondary" data-action="close-modal">Fermer</button><button class="button secondary" data-claim="edit" data-id="${e(c.id)}">Modifier</button><button class="button secondary" data-claim="weather" data-id="${e(c.id)}">Charger la météo</button><button class="button primary" data-claim="pdf" data-id="${e(c.id)}">PDF ${c.cause==='gibier'?'FDC':'assureur'}</button>`,'large');
    $('#claim-photos')?.addEventListener('change',ev=>addPhotos(c.id,ev.target.files).catch(err=>toast(err.message,'error')));
  }

  async function addPhotos(id,files){
    const c=byId(id);if(!c||!files?.length)return;
    for(const file of files){
      const pid=uid('photo'),head=new Uint8Array(await file.slice(0,262144).arrayBuffer()),taken=exifDate(head);
      await store.storage.blobPut(pid,file); // fichier d'origine : aucune recompression
      try{await store.upsert('photos',{id:pid,parcelId:c.parcelId||null,observationId:c.observationId||null,claimId:c.id,name:file.name||'photo.jpg',mimeType:file.type||'image/jpeg',size:file.size,originalSize:file.size,note:'',category:'Photo / constat',documentDate:(taken||c.date||todayIso()).slice(0,10),takenAt:taken,tags:['sinistre'],kind:'photo',capturedAt:Date.now(),source:'local'},{label:`Photo du sinistre : ${file.name}`,queue:false});}
      catch(error){await store.storage.blobDelete(pid).catch(()=>{});throw error;}
    }
    toast(`${files.length} photo${files.length>1?'s':''} ajoutée${files.length>1?'s':''} sans recompression.`,'success');openClaim(id);
  }

  async function loadWeather(id){
    const c=byId(id);if(!c)return;
    if(c.latitude===null||c.latitude===undefined)throw Error('Position inconnue : associez la parcelle ou le GPS à l’observation.');
    if(navigator.onLine===false)throw Error('Connexion nécessaire pour l’archive météo.');
    const res=await fetch(weatherUrl(c.latitude,c.longitude,c.date));if(!res.ok)throw Error('Archive météo indisponible pour cette date.');
    const w=parseWeather(await res.json(),c.date);if(!w)throw Error('Pas de donnée météo pour cette date.');
    await save({...c,weather:w},c);toast('Météo du jour enregistrée (valeurs indicatives).','success');openClaim(id);
  }

  async function pdf(id){
    const d=data(),c=byId(id);if(!c)return;const photos=[];
    for(const p of photosOf(c)){const blob=await attachmentBlob(store,p.id).catch(()=>null);if(!blob)continue;const caption=`${p.name||'Photo'}${p.takenAt?` · prise le ${localDate(p.takenAt)}`:''}`;
      const bytes=/jpe?g/i.test(p.mimeType||blob.type||'')?new Uint8Array(await blob.arrayBuffer()):null;photos.push({bytes:bytes&&jpegInfo(bytes)?bytes:null,caption});}
    const title=`Dossier sinistre ${causeLabel(c.cause)} ${c.date}`,{blocks}=claimPdfBlocks(d,c,{photos,today:todayIso()});
    const file=pdfFile(flowPdf(blocks,{title,footer:`${title} · estimation de l’exploitant`}),title);
    const how=await sharePdf(file,{title});if(how!=='cancelled')toast(how==='shared'?'Dossier partagé.':'Dossier téléchargé.','success');
  }

  function open(){
    const t=claimsTreasury(data());
    modal('Sinistres',`${t.rows.length} dossier${t.rows.length>1?'s':''} · ${t.open} en cours`,`<div class="preview-summary"><div class="preview-stat"><strong>${eur(t.pending)}</strong><small>indemnités attendues</small></div><div class="preview-stat"><strong>${eur(t.received)}</strong><small>indemnités reçues</small></div></div>
<div class="stack-list">${t.rows.length?t.rows.map(r=>`<div class="list-row"><div><strong>${e(causeLabel(r.claim.cause))} · ${e(localDate(r.claim.date))}</strong><small>${e(active(data(),'parcelles').find(p=>p.id===r.claim.parcelId)?.nom||'Sans parcelle')} · ${e(r.claim.status)} · perte ${eur(r.loss.euros)}${r.indemnity!==null?` · indemnité ${eur(r.indemnity)}`:''}</small></div><button class="small-button" data-claim="view" data-id="${e(r.claim.id)}">Ouvrir</button></div>`).join(''):'<div class="empty-state">Aucun dossier. Ouvrez-en un depuis une observation de dégâts (gibier, grêle, sécheresse…).</div>'}</div>
<p class="form-note">Montants estimés par l’exploitant : indemnité saisie, sinon perte estimée, tant que le dossier n’est pas indemnisé.</p>`,`<button class="button secondary" data-action="close-modal">Fermer</button><button class="button primary" data-action="new-observation">＋ Observation de dégâts</button>`,'large');
  }

  async function action(name,control){
    const id=control.dataset.id;
    if(name==='save')return saveForm(id);
    if(name==='view')return openClaim(id);
    if(name==='edit'){const c=byId(id);if(c)openForm(c,c);return;}
    if(name==='status'){const c=byId(id);if(!c||c.status===control.dataset.status)return;await save(nextStatus(c,control.dataset.status,todayIso()),c);toast(`Dossier ${control.dataset.status}.`,'success');return openClaim(id);}
    if(name==='weather')return loadWeather(id);
    if(name==='pdf')return pdf(id);
  }
  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-claim]');if(!c||c.disabled)return;c.disabled=true;action(c.dataset.claim,c).catch(err=>toast(err.message,'error')).finally(()=>{c.disabled=false;});});
  return{open,openFromObservation,openClaim,close:closeModal};
}
