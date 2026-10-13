// n° 14 - Photos terrain géolocalisées : prise en rafale, étiquettes, couche carte et avant/après.
// La logique (EXIF, position, rattachement) est dans photo-geo.js.
import {PHOTO_TAGS,PHOTO_FRESH_MS,readJpegExif,stripJpegMetadata,hasJpegMetadata,isJpeg,choosePhotoLocation,parcelForPhoto,normalizePhotoTags,sortPhotos,beforeAfter,photoTagCounts,geolocatedPhotos} from './photo-geo.js';
import {escapeHtml as e,uid} from './utils.js';
import {attachmentBlob} from './storage-care.js';

const day=t=>{const d=new Date(Number(t)||Date.now());return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const shortDate=t=>new Date(Number(t)||Date.now()).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'});

export function createPhotoGeoUI({store,state,active,parcelById,toast,modal,closeModal,optimize,getMap=()=>null,viewPhoto=null}){
  let fix=null,pending=null,files=[],layer=null,layerUrls=[],galleryTag=null;

  // Position fraîche (30 s au plus), demandée en parallèle de la prise de vue.
  function requestFix(){
    if(!navigator.geolocation)return Promise.resolve(null);
    if(fix&&Date.now()-fix.timestamp<PHOTO_FRESH_MS)return Promise.resolve(fix);
    if(pending)return pending;
    setStatus('Recherche de la position…');
    pending=new Promise(resolve=>{try{navigator.geolocation.getCurrentPosition(p=>{fix={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,heading:p.coords.heading,timestamp:Number(p.timestamp)||Date.now()};resolve(fix);},()=>resolve(null),{enableHighAccuracy:true,maximumAge:PHOTO_FRESH_MS,timeout:15000});}catch{resolve(null);}})
      .then(r=>{pending=null;setStatus(r?`Position ± ${Math.round(r.accuracy||0)} m${Number.isFinite(r.heading)&&r.heading>=0?` · cap ${Math.round(r.heading)}°`:''}`:'Position indisponible : les photos sans GPS seront enregistrées sans lieu.');return r;});
    return pending;
  }
  function setStatus(text){const el=document.querySelector('#photo-geo-status');if(el)el.textContent=text;}

  function open(parcelId=null,{interventionId=null,observationId=null}={}){
    files=[];const parcels=active('parcelles');
    modal('Photos terrain','Position, précision et cap enregistrés. Aucune autre métadonnée de l’appareil n’est conservée.',`<form id="photo-geo-form" class="photo-geo-form" novalidate>
      <div class="photo-geo-pick"><label class="button primary photo-geo-btn">Prendre une photo<input type="file" name="camera" accept="image/*" capture="environment" class="sr-only"></label><label class="button secondary photo-geo-btn">Choisir des photos<input type="file" name="gallery" accept="image/*" multiple class="sr-only"></label></div>
      <p id="photo-geo-status" class="form-note" role="status" aria-live="polite">Position en attente.</p>
      <div id="photo-geo-list" class="photo-geo-list" aria-live="polite"></div>
      <fieldset class="photo-geo-tags"><legend>Étiquettes</legend>${PHOTO_TAGS.map(t=>`<label class="chip-check"><input type="checkbox" name="tags" value="${e(t)}"><span>${e(t)}</span></label>`).join('')}</fieldset>
      <label class="field-label">Parcelle<select name="parcelId"><option value="">Automatique (selon la position)</option>${parcels.map(p=>`<option value="${e(p.id)}" ${p.id===parcelId?'selected':''}>${e(p.nom)}</option>`).join('')}</select></label>
      <label class="field-label">Commentaire<input name="note" maxlength="240"></label>
      <p class="form-error" id="photo-geo-error" hidden></p></form>`,`<button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" id="photo-geo-save">Enregistrer</button>`,'large');
    const form=document.querySelector('#photo-geo-form');
    requestFix();
    const add=list=>{const now=Date.now();for(const file of list)files.push({file,addedAt:now,fresh:Math.abs(now-(file.lastModified||now))<120000});renderList();};
    form.camera.addEventListener('click',()=>{fix=null;requestFix();});
    form.camera.addEventListener('change',()=>{add([...form.camera.files]);form.camera.value='';});
    form.gallery.addEventListener('change',()=>{add([...form.gallery.files]);form.gallery.value='';});
    document.querySelector('#photo-geo-save').onclick=()=>save(form,{interventionId,observationId});
  }
  function renderList(){
    const host=document.querySelector('#photo-geo-list');if(!host)return;
    host.innerHTML=files.length?`<p class="form-note">${files.length} photo${files.length>1?'s':''} prête${files.length>1?'s':''}</p><div class="photo-geo-previews">${files.map((f,i)=>`<span class="photo-geo-prev"><img alt="Photo ${i+1}" data-i="${i}"><button type="button" class="icon-button" data-remove="${i}" aria-label="Retirer la photo ${i+1}">×</button></span>`).join('')}</div>`:'';
    host.querySelectorAll('img[data-i]').forEach(img=>{const url=URL.createObjectURL(files[Number(img.dataset.i)].file);img.src=url;img.onload=()=>URL.revokeObjectURL(url);});
    host.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{files.splice(Number(b.dataset.remove),1);renderList();});
  }
  // Supprime les métadonnées de l'appareil ; une rotation EXIF impose de redessiner l'image.
  async function clean(file,buffer,exif){
    if(!isJpeg(buffer)||!hasJpegMetadata(buffer))return file;
    if(exif?.orientation&&exif.orientation!==1&&typeof createImageBitmap==='function'){
      try{const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close?.();const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.9));if(blob)return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg',lastModified:file.lastModified});}catch{}
    }
    return new File([stripJpegMetadata(buffer)],file.name,{type:'image/jpeg',lastModified:file.lastModified});
  }
  async function save(form,{interventionId,observationId}){
    const error=form.querySelector('#photo-geo-error');
    if(!files.length){error.textContent='Ajoutez au moins une photo.';error.hidden=false;return;}
    const button=document.querySelector('#photo-geo-save');button.disabled=true;
    try{
      const v=new FormData(form),tags=normalizePhotoTags(v.getAll('tags')),chosen=v.get('parcelId')||'',note=String(v.get('note')||''),parcels=active('parcelles');
      const live=files.some(f=>f.fresh)?await Promise.race([requestFix(),new Promise(r=>setTimeout(()=>r(fix),6000))]):fix;
      const saved=[];
      for(const item of files){
        const buffer=new Uint8Array(await item.file.arrayBuffer()),exif=isJpeg(buffer)?readJpegExif(buffer):null;
        const loc=choosePhotoLocation({exif,fresh:item.fresh?live:null});
        const parcel=chosen?parcelById(chosen):parcelForPhoto(loc,parcels);
        const cleaned=await clean(item.file,buffer,exif),optimized=await optimize(cleaned),id=uid('photo'),capturedAt=exif?.takenAt||item.file.lastModified||Date.now();
        await store.storage.blobPut(id,optimized.blob);
        try{saved.push(await store.upsert('photos',{id,parcelId:parcel?.id||null,interventionId,observationId,name:optimized.name,mimeType:optimized.mimeType,size:optimized.blob.size,originalSize:item.file.size,note,category:'Photo / constat',documentDate:day(capturedAt),tags,kind:'photo',capturedAt,latitude:loc?.latitude??null,longitude:loc?.longitude??null,accuracy:loc?.accuracy??null,heading:loc?.heading??null,locationSource:loc?.locationSource||null,source:'local'},{label:`Photo ajoutée : ${optimized.name}`,queue:false}));}
        catch(err){await store.storage.blobDelete(id).catch(()=>{});throw err;}
      }
      files=[];closeModal();
      const placed=saved.filter(p=>p.parcelId),names=[...new Set(placed.map(p=>parcelById(p.parcelId)?.nom).filter(Boolean))];
      toast(`${saved.length} photo${saved.length>1?'s':''} enregistrée${saved.length>1?'s':''}${names.length?` · ${placed.length} rattachée${placed.length>1?'s':''} à ${names.join(', ')}`:' · sans parcelle'}.`,'success');
      if(layer)refreshLayer();
      return saved;
    }catch(err){error.textContent=err.message;error.hidden=false;}
    finally{if(button.isConnected)button.disabled=false;}
  }

  // Couche carte « Photos » : miniatures cliquables.
  function clearLayer(){layer?.remove();layer=null;layerUrls.forEach(u=>URL.revokeObjectURL(u));layerUrls=[];}
  async function refreshLayer(){
    const map=getMap()?.map;if(!map||typeof L==='undefined'){clearLayer();return;}
    const list=sortPhotos(geolocatedPhotos(active('photos'))).slice(-200),group=L.layerGroup(),urls=[];
    for(const p of list){
      const blob=await attachmentBlob(store,p.id).catch(()=>null),url=blob?URL.createObjectURL(blob):'';if(url)urls.push(url);
      const icon=L.divIcon({className:'photo-map-marker',html:`<span class="photo-map-thumb">${url?`<img src="${url}" alt="">`:''}</span>`,iconSize:[44,44],iconAnchor:[22,22]});
      const marker=L.marker([p.latitude,p.longitude],{icon,title:`${(p.tags||[]).join(', ')||'Photo'} · ${shortDate(p.capturedAt)}`,keyboard:true,alt:'Photo'});
      marker.on('click',()=>viewPhoto?.(p.id));group.addLayer(marker);
    }
    clearLayer();layer=group.addTo(map);layerUrls=urls;
  }
  async function setLayer(on){await store.setPreferences({mapPhotos:Boolean(on)});if(on){await refreshLayer();const n=geolocatedPhotos(active('photos')).length;toast(n?`${n} photo${n>1?'s':''} géolocalisée${n>1?'s':''} sur la carte.`:'Aucune photo géolocalisée pour l’instant.');}else clearLayer();}
  function syncLayer(){if(state().preferences?.mapPhotos)refreshLayer();else if(layer)clearLayer();}

  // Frise des photos de la parcelle, avec avant/après et filtre par étiquette.
  async function renderGallery(root,parcelId,photos){
    if(!root)return;const all=sortPhotos(photos);
    if(!all.length){root.innerHTML='<div class="empty-state">Aucune photo. Le bouton Photo du mode terrain les rattache automatiquement à la parcelle.</div>';return;}
    const tags=photoTagCounts(all);if(galleryTag&&!tags.some(([t])=>t===galleryTag))galleryTag=null;
    const list=galleryTag?all.filter(p=>(p.tags||[]).includes(galleryTag)):all,pair=beforeAfter(list,{tag:null});
    const thumb=(p,cls='photo-thumb')=>`<button type="button" class="${cls}" data-action="view-attachment" data-type="photos" data-id="${e(p.id)}"><img data-blob="${e(p.id)}" alt="${e(p.note||(p.tags||[]).join(', ')||'Photo de parcelle')}"><small>${e(shortDate(p.capturedAt))}${(p.tags||[]).length?` · ${e(p.tags.join(', '))}`:''}${Number.isFinite(p.latitude)?' · géolocalisée':''}</small></button>`;
    root.classList.add('photo-timeline-root');
    root.innerHTML=`${tags.length?`<div class="photo-tag-filter" role="group" aria-label="Filtrer par étiquette"><button type="button" class="filter-chip${galleryTag?'':' is-active'}" data-photo-tag="" aria-pressed="${!galleryTag}">Toutes</button>${tags.map(([t,n])=>`<button type="button" class="filter-chip${galleryTag===t?' is-active':''}" data-photo-tag="${e(t)}" aria-pressed="${galleryTag===t}">${e(t)} (${n})</button>`).join('')}</div>`:''}${pair?`<section class="photo-before-after" aria-label="Avant et après"><h3>Avant / après · ${pair.days} jour${pair.days>1?'s':''}</h3><div>${thumb(pair.before,'photo-ba')}${thumb(pair.after,'photo-ba')}</div></section>`:''}<div class="photo-timeline">${list.map(p=>thumb(p)).join('')}</div>`;
    root.querySelectorAll('[data-photo-tag]').forEach(b=>b.onclick=()=>{galleryTag=b.dataset.photoTag||null;renderGallery(root,parcelId,photos);});
    const urls=[];for(const img of root.querySelectorAll('img[data-blob]')){const blob=await attachmentBlob(store,img.dataset.blob).catch(()=>null);if(blob){const u=URL.createObjectURL(blob);urls.push(u);img.src=u;}else img.closest('button')?.classList.add('is-missing');}
    setTimeout(()=>urls.forEach(u=>URL.revokeObjectURL(u)),60000);
  }
  return{open,requestFix,refreshLayer,setLayer,syncLayer,clearLayer,renderGallery,layerOn:()=>Boolean(state().preferences?.mapPhotos)};
}
