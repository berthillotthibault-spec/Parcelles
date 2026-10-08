// Interface de la saisie vocale (idées n° 10 et 99) : bouton « Appuyer pour parler »,
// mémos audio hors ligne, brouillon vérifiable et carte « mémos à traiter » sur Aujourd'hui.
// Aucune écriture sans validation explicite ; l'audio reste sur l'appareil (sauf synchro des pièces jointes).
import {escapeHtml, formatNumber, toNullableNumber, uid} from './utils.js';
import {icon} from './ui.js';
import {locateParcels} from './field-ops.js';
import {grazingAnimalList} from './grazing.js';
import {endGrazingSession, saveGrazingSession} from './grazing-records.js';
import {MEMO_MAX_MS, confirmationSentence, formatClock, grazingTotal, grazingType, memoDocument, memoSummaryLabel, parseVoiceEntry, pendingMemos, pickAudioMime, workDraftsFromEntry} from './voice-notes.js';

const HOLD_MS=450,MIN_AUDIO_MS=700;
const pad=n=>String(n).padStart(2,'0');
const todayIso=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
const plural=(n,one,many)=>`${formatNumber(n)} ${n>1?many:one}`;

export function createVoiceNotesUI(host){
  const {store,state,active,parcelById,modal,closeModal,toast}=host;
  const $=selector=>document.querySelector(selector);
  const prefs=()=>state().preferences||{};
  const SR=()=>window.SpeechRecognition||window.webkitSpeechRecognition||null;
  const canRecord=()=>Boolean(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder);
  const canRecognize=()=>Boolean(SR()&&prefs().voiceEnabled!==false&&navigator.onLine!==false);
  const haptic=()=>{try{navigator.vibrate?.(18);}catch{}};
  let rec=null,draft=null,player=null,closeWatch=null;

  // ---------- Bouton flottant ----------
  function mountFab(){
    const dock=document.getElementById('assistant-dock');if(!dock||dock.querySelector('.vn-fab'))return;
    const button=document.createElement('button');
    button.type='button';button.className='vn-fab';button.setAttribute('aria-label','Saisie vocale : maintenez pour parler');button.title='Maintenez pour parler, ou touchez pour commencer';
    button.innerHTML=icon('mic',{size:22});
    button.addEventListener('pointerdown',event=>{if(event.button>0)return;event.preventDefault();holdFrom(event,()=>open({autoStart:true}));});
    button.addEventListener('click',event=>{if(event.detail===0)open({autoStart:true});});
    button.addEventListener('contextmenu',event=>event.preventDefault());
    dock.prepend(button);document.documentElement.dataset.voiceFab='on';
  }

  // Maintien : relâcher après HOLD_MS arrête l'enregistrement ; un appui bref laisse enregistrer (appui-appui).
  function holdFrom(event,begin){
    const t0=Date.now();begin();
    const end=()=>{window.removeEventListener('pointerup',end,true);window.removeEventListener('pointercancel',end,true);if(Date.now()-t0>=HOLD_MS&&rec&&!rec.stopped)stopRecording();};
    window.addEventListener('pointerup',end,true);window.addEventListener('pointercancel',end,true);
  }

  // ---------- Fenêtre de saisie ----------
  function privacyNote(){
    if(canRecognize())return 'La transcription passe par le service de reconnaissance de votre navigateur (Google ou Apple). L’audio, lui, reste sur cet appareil.';
    if(canRecord())return 'Sans réseau, votre voix est gardée en mémo audio sur cet appareil : vous le transcrirez ensuite depuis Aujourd’hui.';
    return 'L’enregistrement n’est pas disponible dans ce navigateur : utilisez la touche micro du clavier pour dicter.';
  }
  function open({text='',autoStart=false,analyzeNow=false}={}){
    stopPlayback();
    if(text&&analyzeNow)return analyze(text,{});
    modal('Saisie vocale','Parlez comme à un collègue : Parcelles prépare un brouillon, rien n’est enregistré sans votre accord.',`<div class="vn-sheet" id="vn-sheet" data-state="idle">
      <div class="vn-ptt-wrap"><button type="button" class="vn-ptt" id="vn-ptt" aria-pressed="false" aria-describedby="vn-status">${icon('mic',{size:34})}<span id="vn-ptt-label">Appuyer pour parler</span></button>
      <p class="vn-status" id="vn-status" role="status" aria-live="polite">Maintenez pendant que vous parlez, ou touchez une fois pour commencer et une fois pour finir.</p>
      <p class="vn-live" id="vn-live" hidden></p></div>
      <label class="vn-text">Ou écrivez votre compte rendu<textarea id="vn-text" rows="3" placeholder="J’ai semé les Grandes Terres en maïs, 32 kg/ha…">${escapeHtml(text)}</textarea></label>
      <p class="form-error hidden" id="vn-error" role="alert"></p>
      <p class="form-note vn-privacy">${escapeHtml(privacyNote())}</p></div>`,
    `<button type="button" class="button primary vn-wide" id="vn-prepare">Préparer le brouillon</button>`);
    const ptt=$('#vn-ptt');
    ptt.addEventListener('pointerdown',event=>{if(event.button>0)return;event.preventDefault();if(rec&&!rec.stopped){stopRecording();return;}holdFrom(event,()=>startRecording());});
    ptt.addEventListener('click',event=>{if(event.detail!==0)return;if(rec&&!rec.stopped)stopRecording();else startRecording();});
    ptt.addEventListener('contextmenu',event=>event.preventDefault());
    $('#vn-prepare').onclick=()=>{
      const value=$('#vn-text').value.trim();
      if(!value)return showError('Champ obligatoire : compte rendu (dictez ou écrivez quelques mots).');
      if(rec&&!rec.stopped)return stopRecording();
      analyze(value,{});
    };
    if(autoStart)startRecording();
  }
  function showError(message){const el=$('#vn-error');if(!el)return toast(message,'error');el.textContent=message;el.classList.remove('hidden');}
  function setSheet(stateName,label){
    const sheet=$('#vn-sheet');if(!sheet)return;sheet.dataset.state=stateName;
    const ptt=$('#vn-ptt'),text=$('#vn-ptt-label');
    if(ptt)ptt.setAttribute('aria-pressed',String(stateName==='recording'));
    if(text)text.textContent=stateName==='recording'?'Relâcher ou toucher pour finir':stateName==='processing'?'Analyse…':'Appuyer pour parler';
    if(label)$('#vn-status').textContent=label;
  }

  // ---------- Enregistrement ----------
  async function startRecording(){
    if(rec&&!rec.stopped)return;
    $('#vn-error')?.classList.add('hidden');
    const session={startedAt:Date.now(),chunks:[],transcript:'',interim:'',media:null,stream:null,recognition:null,timer:null,mime:'',stopped:false,position:locate()};
    rec=session;haptic();setSheet('recording','Je vous écoute…');
    if(canRecord()){
      try{session.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});}
      catch(error){session.audioError=error?.name==='NotAllowedError'||error?.name==='SecurityError'?'denied':'unavailable';}
      if(session.stopped){session.stream?.getTracks().forEach(t=>t.stop());return;}
      if(session.stream){
        session.mime=pickAudioMime(type=>window.MediaRecorder.isTypeSupported?.(type));
        try{session.media=new window.MediaRecorder(session.stream,session.mime?{mimeType:session.mime,audioBitsPerSecond:32000}:undefined);session.media.ondataavailable=event=>{if(event.data?.size)session.chunks.push(event.data);};session.media.start(1000);session.mime=session.media.mimeType||session.mime;}
        catch{session.media=null;session.stream.getTracks().forEach(t=>t.stop());session.stream=null;}
      }
    }
    if(canRecognize()){
      try{
        const recognition=new (SR())();recognition.lang='fr-FR';recognition.interimResults=true;recognition.continuous=true;recognition.maxAlternatives=1;
        recognition.onresult=event=>{let final='',interim='';for(let i=0;i<event.results.length;i++){const result=event.results[i];if(result.isFinal)final+=`${result[0].transcript} `;else interim+=result[0].transcript;}session.transcript=final.trim();session.interim=interim;renderLive(session);};
        recognition.onerror=event=>{session.speechError=event?.error||'error';};
        recognition.start();session.recognition=recognition;
      }catch{session.recognition=null;}
    }
    if(!session.media&&!session.recognition){
      rec=null;setSheet('idle');
      showError(session.audioError==='denied'?'Micro refusé : autorisez-le pour Parcelles dans les réglages, ou écrivez ci-dessous.':'Enregistrement indisponible sur cet appareil. Utilisez la dictée du clavier ou écrivez ci-dessous.');
      $('#vn-text')?.focus();return;
    }
    session.timer=setInterval(()=>tick(session),250);tick(session);
  }
  function renderLive(session){const live=$('#vn-live');if(!live)return;const text=`${session.transcript} ${session.interim}`.trim();live.hidden=!text;live.textContent=text;}
  function tick(session){
    if(session.stopped)return;const elapsed=Date.now()-session.startedAt;
    if(!document.getElementById('vn-sheet')){stopRecording({closed:true});return;}
    const status=$('#vn-status');if(status)status.textContent=`Enregistrement ${formatClock(elapsed)} / ${formatClock(MEMO_MAX_MS)}${session.media?'':' · transcription seule'}`;
    if(elapsed>=MEMO_MAX_MS)stopRecording();
  }
  async function stopRecording({closed=false}={}){
    const session=rec;if(!session||session.stopped)return;session.stopped=true;clearInterval(session.timer);haptic();
    if(!closed)setSheet('processing','Analyse de votre compte rendu…');
    const audio=new Promise(resolve=>{const media=session.media;if(!media||media.state==='inactive')return resolve(null);media.onstop=()=>resolve(session.chunks.length?new Blob(session.chunks,{type:session.mime||'audio/webm'}):null);try{media.stop();}catch{resolve(null);}});
    const speech=new Promise(resolve=>{const r=session.recognition;if(!r)return resolve();const timer=setTimeout(resolve,2500);r.onend=()=>{clearTimeout(timer);resolve();};try{r.stop();}catch{clearTimeout(timer);resolve();}});
    const [blob]=await Promise.all([audio,speech]);
    session.stream?.getTracks().forEach(t=>t.stop());
    if(rec===session)rec=null;
    const durationMs=Date.now()-session.startedAt,transcript=`${session.transcript} ${session.interim}`.trim(),sheetOpen=Boolean(document.getElementById('vn-sheet'));
    const audioData=blob&&blob.size>0&&durationMs>=MIN_AUDIO_MS?{blob,durationMs,position:session.position}:null;
    if(transcript&&sheetOpen){const box=$('#vn-text');if(box)box.value=transcript;analyze(transcript,{fromVoice:true,audio:audioData});return;}
    if(audioData){
      const memo=await saveMemo(audioData,{transcript}).catch(error=>{toast(error.message||'Mémo vocal non enregistré.','error');return null;});
      if(!memo){if(sheetOpen)setSheet('idle');return;}
      if(sheetOpen){closeModal();}
      toast(transcript?'Mémo vocal gardé avec sa transcription : à traiter depuis Aujourd’hui.':'Mémo vocal enregistré sur l’appareil : transcrivez-le quand vous aurez le réseau.','success',{label:'Traiter',run:()=>openMemo(memo.id)});
      return;
    }
    if(!sheetOpen)return;
    setSheet('idle','Maintenez pendant que vous parlez, ou touchez une fois pour commencer et une fois pour finir.');
    showError(durationMs<MIN_AUDIO_MS?'Trop court : maintenez le bouton pendant que vous parlez.':session.speechError==='network'?'Reconnaissance indisponible sans réseau. Écrivez votre compte rendu ci-dessous.':'Je n’ai rien entendu. Réessayez, ou écrivez ci-dessous.');
  }

  // Position facultative : dernière position connue ou relevé rapide si le consentement GPS existe déjà.
  function locate(){
    const last=host.lastPosition?.();
    if(last&&Number.isFinite(Number(last.latitude))&&(!last.at||Date.now()-last.at<5*60000))return Promise.resolve(last);
    if(!prefs().gpsConsent||!('geolocation'in navigator))return Promise.resolve(null);
    return new Promise(resolve=>{try{navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}),()=>resolve(null),{enableHighAccuracy:true,timeout:6000,maximumAge:120000});}catch{resolve(null);}setTimeout(()=>resolve(null),7000);});
  }
  function parcelAt(position){if(!position)return null;const hit=locateParcels(position,active('parcelles')).find(row=>row.inside);return hit?.parcel?.id||null;}

  async function saveMemo({blob,durationMs,position},{transcript=''}={}){
    const where=await Promise.resolve(position).catch(()=>null),id=uid('memo');
    const parcelId=parcelAt(where)||host.currentParcelId?.()||null;
    try{await store.storage.blobPut(id,blob);}catch{throw new Error('Impossible de garder l’audio sur cet appareil (stockage indisponible).');}
    try{await store.upsert('documents',memoDocument({id,mimeType:blob.type,size:blob.size,durationMs,recordedAt:Date.now()-durationMs,parcelId,position:where,transcript}),{label:'Mémo vocal enregistré'});}
    catch(error){await store.storage.blobDelete(id).catch(()=>{});throw error;}
    renderHome();return store.get('documents',id);
  }

  // ---------- Brouillon ----------
  function analyze(text,{fromVoice=false,audio=null,memoId=null}={}){
    const entry=parseVoiceEntry(text,state());
    draft={entry,audio,memoId,fromVoice,handled:false};
    renderDraft();
    if(fromVoice&&prefs().assistantVoiceReplies&&'speechSynthesis'in window){try{const u=new SpeechSynthesisUtterance(confirmationSentence(entry,{}));u.lang='fr-FR';window.speechSynthesis.cancel();window.speechSynthesis.speak(u);}catch{}}
  }
  const hit=(entry,key)=>entry.recognized.has(key)?' vn-hit':'';
  const chips=(name,options,selected,{label=''}={})=>`<div class="chip-choices vn-chips" data-chip-target="${name}"${label?` role="group" aria-label="${escapeHtml(label)}"`:''}>${options.map(([value,text])=>`<button type="button" class="choice-chip${value===selected?' is-on':''}" data-value="${escapeHtml(value)}" aria-pressed="${value===selected}">${escapeHtml(text)}</button>`).join('')}</div>`;
  const quote=entry=>`<blockquote class="vn-quote">« ${escapeHtml(entry.text)} »</blockquote>`;
  function parcelPicker(entry){
    const selected=entry.parcels,choices=entry.parcelChoices.flat().filter(p=>!selected.includes(p));
    if(!selected.length&&!choices.length){
      const parcels=active('parcelles');
      return `<label>Parcelle *<select name="parcelPick"><option value="">Choisir…</option>${parcels.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.nom)} · ${formatNumber(p.surfaceHa)} ha</option>`).join('')}</select></label><p class="form-note">Parcelle non reconnue : choisissez-la.</p>`;
    }
    const note=entry.parcelChoices.length?'Plusieurs parcelles correspondent : touchez la bonne.':entry.parcelProbable?'Parcelle probable : vérifiez-la.':selected.length>1?'Un travail sera créé par parcelle.':'';
    return `<div class="field-label"><span>Parcelle${selected.length+choices.length>1?'s':''} *</span><div class="vn-chips vn-multi${selected.length&&!entry.parcelProbable?' vn-hit-group':''}" role="group" aria-label="Parcelles">${[...selected,...choices].map(p=>`<button type="button" class="choice-chip${selected.includes(p)?' is-on':''}" data-parcel="${escapeHtml(p.id)}" aria-pressed="${selected.includes(p)}">${escapeHtml(p.nom)}</button>`).join('')}</div>${note?`<p class="form-note">${note}</p>`:''}</div>`;
  }
  const chosenParcels=root=>{const pick=root.querySelector('[name="parcelPick"]')?.value;if(pick)return [pick];return [...root.querySelectorAll('[data-parcel][aria-pressed="true"]')].map(b=>b.dataset.parcel);};
  function bindMulti(root,{single=false}={}){
    root.querySelectorAll('.vn-multi').forEach(group=>group.addEventListener('click',event=>{
      const chip=event.target.closest('[data-parcel],[data-session]');if(!chip)return;
      const on=chip.getAttribute('aria-pressed')!=='true';
      if(single||group.dataset.single==='1')group.querySelectorAll('.choice-chip').forEach(c=>{c.classList.remove('is-on');c.setAttribute('aria-pressed','false');});
      chip.classList.toggle('is-on',on);chip.setAttribute('aria-pressed',String(on));root.querySelector('.form-error')?.classList.add('hidden');
      refreshSentence();
    }));
  }
  function detailRows(entry){
    const rows=[];
    if(entry.culture)rows.push(['Culture',entry.culture,'culture']);
    if(entry.product)rows.push(['Produit',entry.product.name,'product']);
    if(entry.dose!==null&&entry.dose!==undefined)rows.push(['Dose',`${formatNumber(entry.dose)} ${entry.doseUnit}`,'dose']);
    if(entry.surfaceWorked!==null&&entry.surfaceWorked!==undefined)rows.push(['Surface travaillée',`${formatNumber(entry.surfaceWorked)} ha`,'surface']);
    if(entry.equipmentId)rows.push(['Matériel',active('materiels').find(m=>m.id===entry.equipmentId)?.nom||'','equipment']);
    if(entry.startTime)rows.push(['Horaires',entry.endTime?`${entry.startTime} – ${entry.endTime}`:`dès ${entry.startTime}`,'time']);
    return rows.length?`<dl class="vn-details">${rows.map(([k,v,key])=>`<div class="${hit(entry,key).trim()}"><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`:'';
  }
  function dateField(entry,{max=''}={}){return `<label class="vn-date${hit(entry,'date')}">Date *<input type="date" name="date" required value="${escapeHtml(entry.date)}"${max?` max="${max}"`:''}>${entry.recognized.has('date')?`<small>Compris : ${escapeHtml(entry.dateLabel)}</small>`:''}</label>`;}
  function footer(primaryLabel,{complete=true,keep=true}={}){
    return `${keep&&draft.audio?'<button type="button" class="button secondary" id="vn-keep">Garder en mémo</button>':''}${complete?'<button type="button" class="button secondary" id="vn-complete">Compléter le formulaire</button>':''}<button type="button" class="button primary vn-wide" id="vn-save">${escapeHtml(primaryLabel)}</button>`;
  }
  function draftModal(body,foot){
    modal('Vérifier avant d’enregistrer',confirmationSentence(draft.entry,{}),`<form id="vn-draft" class="vn-draft" novalidate>${body}<p class="form-error hidden" id="vn-draft-error" role="alert"></p></form>`,foot);
    const form=$('#vn-draft');bindMulti(form);host.bindChipChoices?.(form);
    form.addEventListener('click',event=>{if(event.target.closest('.choice-chip'))setTimeout(refreshSentence);});
    form.addEventListener('input',refreshSentence);
    $('#vn-keep')?.addEventListener('click',keepAsMemo);
    watchClose('vn-draft',onDraftDismissed);
    return form;
  }
  function draftError(message){const el=$('#vn-draft-error');if(el){el.textContent=message;el.classList.remove('hidden');el.scrollIntoView?.({block:'nearest'});}}
  function refreshSentence(){
    const form=$('#vn-draft'),entry=draft?.entry;if(!form||!entry)return;
    const ids=chosenParcels(form),parcels=ids.map(id=>parcelById(id)).filter(Boolean);
    const type=form.elements.type?.value,status=form.elements.status?.value;
    const p=document.querySelector('#modal-root .modal-header p');if(p)p.textContent=confirmationSentence({...entry,dateLabel:form.elements.date?.value===entry.date?entry.dateLabel:''},{type,parcels,status});
    const save=$('#vn-save');if(save&&entry.intent==='work')save.textContent=ids.length>1?`Enregistrer ${ids.length} travaux`:'Enregistrer le travail';
    const complete=$('#vn-complete');if(complete&&entry.intent==='work')complete.disabled=ids.length>1;
  }

  function renderDraft(){
    const entry=draft.entry;
    if(entry.intent==='stock')return renderStockDraft(entry);
    if(entry.intent==='grazing-exit')return renderGrazingExit(entry);
    if(entry.intent==='grazing-entry'||entry.intent==='grazing-move')return renderGrazingEntry(entry);
    const types=[...new Set([...(entry.type?[entry.type]:[]),...entry.typeChoices])].slice(0,6);
    const body=`<label class="vn-type${hit(entry,'type')}">Travail *<input name="type" value="${escapeHtml(entry.type||'')}" placeholder="Semis, fauche, traitement…" autocomplete="off"></label>
      ${types.length>1||(!entry.type&&types.length)?chips('type',types.map(t=>[t,t]),entry.type,{label:'Types proposés'}):''}
      ${parcelPicker(entry)}
      <div class="field-label"><span>Statut</span><input type="hidden" name="status" value="${escapeHtml(entry.status)}">${chips('status',[['Terminé','Terminé'],['À faire','À faire']],entry.status,{label:'Statut'})}</div>
      ${dateField(entry)}${detailRows(entry)}${quote(entry)}`;
    const form=draftModal(body,footer(entry.parcels.length>1?`Enregistrer ${entry.parcels.length} travaux`:'Enregistrer le travail'));
    refreshSentence();
    $('#vn-save').onclick=()=>saveWorks(form);
    $('#vn-complete').onclick=()=>{
      const ids=chosenParcels(form);if(ids.length>1)return draftError('« Compléter le formulaire » se fait parcelle par parcelle : ne gardez qu’une parcelle.');
      const [work]=workDraftsFromEntry(entry,{parcelIds:ids.length?ids:[''],type:form.elements.type.value.trim(),status:form.elements.status.value,date:form.elements.date.value||entry.date});
      draft.handled=true;
      const parcelId=ids[0]||active('parcelles')[0]?.id||null;
      host.openWorkForm({...work,parcelId,surfaceWorked:work.surfaceWorked??undefined},parcelId);
      const details=document.querySelector('#work-form details');if(details)details.open=true;
    };
  }

  async function saveWorks(form){
    const button=$('#vn-save');if(button.disabled)return;
    const entry=draft.entry,type=form.elements.type.value.trim(),ids=chosenParcels(form),status=form.elements.status.value||'Terminé',date=form.elements.date.value;
    if(!type)return draftError('Champ obligatoire : travail.');
    if(!ids.length)return draftError('Champ obligatoire : parcelle.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return draftError('Champ obligatoire : date.');
    const works=workDraftsFromEntry(entry,{parcelIds:ids,type,status,date}).map(work=>{
      const parcel=parcelById(work.parcelId);
      return {...work,id:uid('work'),culture:work.culture||parcel?.culture||'',dose:toNullableNumber(work.dose),surfaceWorked:work.surfaceWorked??toNullableNumber(parcel?.surfaceHa)};
    });
    button.disabled=true;
    try{await store.upsertMany('interventions',works,{label:`Saisie vocale : ${works.length} travail${works.length>1?'x':''}`});}
    catch(error){button.disabled=false;return draftError(error.message||'Enregistrement impossible.');}
    draft.handled=true;const memoId=draft.memoId;
    if(memoId)await markMemo(memoId,'done',{interventionIds:works.map(w=>w.id),transcript:entry.text}).catch(()=>{});
    closeModal();haptic();
    toast(works.length>1?`${works.length} travaux enregistrés.`:`Travail enregistré : ${type}.`,'success',{label:'Annuler',run:async()=>{for(const w of works)await store.remove('interventions',w.id).catch(()=>{});if(memoId)await markMemo(memoId,'pending').catch(()=>{});toast('Saisie annulée.');}});
  }

  function renderStockDraft(entry){
    const items=active('stockItems'),choices=entry.productChoices||[];
    const selectedId=entry.stockItemId||'';
    const item=items.find(s=>s.id===selectedId);
    const picker=choices.length>1?`<div class="field-label"><span>Produit *</span><input type="hidden" name="stockItemId" value="">${chips('stockItemId',choices.map(c=>[c.id,c.name]),'',{label:'Produits'})}<p class="form-note">Plusieurs produits correspondent : touchez le bon.</p></div>`
      :item?`<div class="field-label vn-hit"><span>Produit</span><strong>${escapeHtml(item.name)}</strong><input type="hidden" name="stockItemId" value="${escapeHtml(item.id)}"></div>`
      :`<div class="notice warning">« ${escapeHtml(entry.product?.name||'Ce produit')} » n’a pas de fiche de stock. Créez-la depuis Stock, puis dictez à nouveau.</div>`;
    const qty=item&&entry.unitOk?`<p class="vn-stock-line vn-hit">+ ${formatNumber(entry.stockQuantity)} ${escapeHtml(item.unit||'')} <small>(dit : ${formatNumber(entry.quantity)} ${escapeHtml(entry.unit)} · stock actuel ${formatNumber(item.quantity)} ${escapeHtml(item.unit||'')})</small></p>`
      :item?`<div class="notice warning">Unité à vérifier : vous avez dit « ${escapeHtml(entry.unit)} », le stock est suivi en « ${escapeHtml(item.unit||'?')} ». Utilisez « Compléter le formulaire ».</div>`:'';
    const canSave=Boolean((item&&entry.unitOk)||choices.length>1);
    const form=draftModal(`${picker}${qty}${dateField(entry,{max:todayIso()})}${quote(entry)}`,footer(canSave?'Enregistrer l’entrée de stock':'Ouvrir le stock',{complete:Boolean(item||choices.length>1)}));
    $('#vn-complete')?.addEventListener('click',()=>{const id=form.elements.stockItemId?.value;if(!id)return draftError('Champ obligatoire : produit.');draft.handled=true;host.openStockMovement?.(id);});
    $('#vn-save').onclick=async()=>{
      if(!canSave){draft.handled=true;closeModal();host.openStock?.();return;}
      const id=form.elements.stockItemId?.value,stock=items.find(s=>s.id===id),date=form.elements.date.value;
      if(!stock)return draftError('Champ obligatoire : produit.');
      const quantity=id===entry.stockItemId?entry.stockQuantity:convertFor(entry,stock);
      if(quantity===null)return draftError(`Unité à vérifier : le stock « ${stock.name} » est suivi en « ${stock.unit||'?'} ». Utilisez « Compléter le formulaire ».`);
      if(!date)return draftError('Champ obligatoire : date.');
      const button=$('#vn-save');button.disabled=true;
      try{await store.recordStockMovement({stockItemId:id,type:'Entrée',quantity,date,note:`Dicté : « ${entry.text} »`});}
      catch(error){button.disabled=false;return draftError(error.message);}
      draft.handled=true;if(draft.memoId)await markMemo(draft.memoId,'done',{transcript:entry.text}).catch(()=>{});
      closeModal();haptic();toast(`Entrée de stock enregistrée : + ${formatNumber(quantity)} ${stock.unit||''} de ${stock.name}.`);
    };
  }
  function convertFor(entry,stock){
    const f=entry.unit,t=String(stock.unit||'').toLowerCase();if(!t||t===f.toLowerCase())return entry.quantity;
    if(f==='t'&&t==='kg')return entry.quantity*1000;if(f==='kg'&&t==='t')return entry.quantity/1000;return null;
  }

  const lotLabel=s=>{const parcel=parcelById(s.parcelId);return `${s.note||grazingType(s)} · ${plural(grazingTotal(s),'animal','animaux')}${parcel?` · ${parcel.nom}`:''}`;};
  function renderGrazingExit(entry){
    const sessions=entry.sessions||[];
    const picker=sessions.length?`<div class="field-label"><span>Lot *</span><div class="vn-chips vn-multi" data-single="1" role="group" aria-label="Lots au pré">${sessions.map((s,i)=>`<button type="button" class="choice-chip${sessions.length===1&&i===0?' is-on':''}" data-session="${escapeHtml(s.id)}" aria-pressed="${sessions.length===1&&i===0}">${escapeHtml(lotLabel(s))}</button>`).join('')}</div>${sessions.length>1?'<p class="form-note">Plusieurs lots correspondent : touchez le bon.</p>':''}</div>`
      :'<div class="notice warning">Aucun lot au pré ne correspond à cette phrase.</div>';
    const form=draftModal(`${picker}${dateField(entry,{max:todayIso()})}${quote(entry)}`,footer(sessions.length?'Enregistrer la sortie':'Ouvrir le pâturage',{complete:false}));
    $('#vn-save').onclick=async()=>{
      if(!sessions.length){draft.handled=true;closeModal();host.openGrazing?.();return;}
      const id=form.querySelector('[data-session][aria-pressed="true"]')?.dataset.session,date=form.elements.date.value;
      if(!id)return draftError('Champ obligatoire : lot.');if(!date)return draftError('Champ obligatoire : date.');
      const button=$('#vn-save');button.disabled=true;
      try{await endGrazingSession(store,id,{date});}catch(error){button.disabled=false;return draftError(error.message);}
      draft.handled=true;if(draft.memoId)await markMemo(draft.memoId,'done',{transcript:entry.text}).catch(()=>{});
      closeModal();haptic();toast('Sortie du pré enregistrée.');
    };
  }
  function renderGrazingEntry(entry){
    const moving=entry.intent==='grazing-move'&&entry.sessions?.length;
    const lots=moving?`<div class="field-label"><span>Lot à déplacer *</span><div class="vn-chips vn-multi" data-single="1" role="group" aria-label="Lots au pré">${entry.sessions.map((s,i)=>`<button type="button" class="choice-chip${i===0&&entry.sessions.length===1?' is-on':''}" data-session="${escapeHtml(s.id)}" aria-pressed="${i===0&&entry.sessions.length===1}">${escapeHtml(lotLabel(s))}</button>`).join('')}</div></div>`:'';
    const lot=entry.lot?entry.lot.charAt(0).toLocaleUpperCase('fr')+entry.lot.slice(1):'';
    const fields=moving?'':`<label class="${entry.animalType?'vn-hit':''}">Type d’animaux<input name="animalType" value="${escapeHtml(entry.animalType||'')}" placeholder="Bovins, ovins…"></label><label class="${entry.count?'vn-hit':''}">Nombre d’animaux *<input name="count" type="number" min="1" step="1" inputmode="numeric" value="${entry.count??''}"></label><label>Lot / commentaire<input name="note" value="${escapeHtml(lot)}"></label>`;
    const form=draftModal(`${lots}${parcelPicker({...entry,parcelChoices:entry.parcelChoices||[]})}${fields}${dateField(entry,{max:todayIso()})}${quote(entry)}`,footer(moving?'Déplacer le lot':'Mettre au pré'));
    form.querySelectorAll('.vn-multi:not([data-single])').forEach(g=>{g.dataset.single='1';});
    $('#vn-complete').onclick=()=>{draft.handled=true;const ids=chosenParcels(form);host.openGrazingForm?.(null,{parcelId:ids[0]||''});};
    $('#vn-save').onclick=async()=>{
      const ids=chosenParcels(form),date=form.elements.date.value,button=$('#vn-save');
      if(ids.length!==1)return draftError('Champ obligatoire : parcelle (une seule).');if(!date)return draftError('Champ obligatoire : date.');
      if(moving){
        const id=form.querySelector('[data-session][aria-pressed="true"]')?.dataset.session,session=store.get('grazingSessions',id);
        if(!session)return draftError('Champ obligatoire : lot à déplacer.');
        if(session.parcelId===ids[0])return draftError('Le lot est déjà sur cette parcelle.');
        const animals=grazingAnimalList(session),total=grazingTotal(session);button.disabled=true;
        try{
          await endGrazingSession(store,session.id,{date});
          try{await saveGrazingSession(store,{parcelId:ids[0],animalType:grazingType(session),startDate:date,endDate:null,animals,additionalAnimalsCount:Math.max(0,total-animals.length),note:session.note||''});}
          catch(failure){await saveGrazingSession(store,{parcelId:session.parcelId,animalType:session.animalType??grazingType(session),startDate:String(session.startDate).slice(0,10),endDate:null,animals:session.animals??[],additionalAnimalsCount:Number(session.additionalAnimalsCount)||0,note:session.note||''},{id:session.id}).catch(()=>{});throw failure;}
        }catch(error){button.disabled=false;return draftError(error.message);}
        draft.handled=true;if(draft.memoId)await markMemo(draft.memoId,'done',{transcript:entry.text}).catch(()=>{});
        closeModal();haptic();toast(`Lot déplacé vers ${parcelById(ids[0])?.nom||'la parcelle'}.`);return;
      }
      const count=Number(form.elements.count.value);
      if(!Number.isSafeInteger(count)||count<1)return draftError('Champ obligatoire : nombre d’animaux.');
      button.disabled=true;
      try{await saveGrazingSession(store,{parcelId:ids[0],animalType:form.elements.animalType.value.trim()||'Non précisé',startDate:date,endDate:null,animals:[],additionalAnimalsCount:count,note:form.elements.note.value.trim()});}
      catch(error){button.disabled=false;return draftError(error.message);}
      draft.handled=true;if(draft.memoId)await markMemo(draft.memoId,'done',{transcript:entry.text}).catch(()=>{});
      closeModal();haptic();toast(`Mise au pré enregistrée : ${plural(count,'animal','animaux')} sur ${parcelById(ids[0])?.nom||'la parcelle'}.`);
    };
  }

  // Fermer le brouillon d'une dictée ne perd rien : l'audio est gardé en mémo à traiter.
  function watchClose(id,callback){
    closeWatch?.disconnect();const root=document.getElementById('modal-root');if(!root||!window.MutationObserver)return;
    const observer=new MutationObserver(()=>{if(!document.getElementById(id)){observer.disconnect();if(closeWatch===observer)closeWatch=null;callback();}});
    observer.observe(root,{childList:true,subtree:true});closeWatch=observer;
  }
  async function onDraftDismissed(){
    const current=draft;if(!current||current.handled)return;current.handled=true;
    if(current.audio&&!current.memoId){try{const memo=await saveMemo(current.audio,{transcript:current.entry.text});toast('Brouillon non enregistré : la dictée est gardée en mémo à traiter.','success',{label:'Traiter',run:()=>openMemo(memo.id)});}catch(error){toast(error.message,'error');}}
  }
  async function keepAsMemo(){
    const current=draft;if(!current?.audio)return;current.handled=true;
    try{const memo=await saveMemo(current.audio,{transcript:current.entry.text});closeModal();toast('Mémo vocal gardé : à traiter depuis Aujourd’hui.','success',{label:'Traiter',run:()=>openMemo(memo.id)});}
    catch(error){current.handled=false;draftError(error.message);}
  }

  // ---------- Mémos ----------
  async function markMemo(id,status,{interventionIds=null,transcript=null}={}){
    const doc=store.get('documents',id);if(!doc?.voiceMemo)return;
    const memo={...doc.voiceMemo,status};if(status==='done')memo.processedAt=Date.now();else delete memo.processedAt;
    if(interventionIds)memo.interventionIds=interventionIds.slice(0,20);if(transcript!==null)memo.transcript=String(transcript);
    await store.upsert('documents',{...doc,voiceMemo:memo,note:memo.transcript||doc.note||'',interventionId:interventionIds?.[0]||doc.interventionId||null},{label:status==='done'?'Mémo vocal traité':'Mémo vocal à traiter'});
    renderHome();
  }
  function memoMeta(doc){
    const m=doc.voiceMemo,d=new Date(Number(m.recordedAt)||doc.createdAt||Date.now()),today=todayIso(),day=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const when=day===today?`Aujourd’hui ${pad(d.getHours())}h${pad(d.getMinutes())}`:`${d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'})} ${pad(d.getHours())}h${pad(d.getMinutes())}`;
    return {when,parcel:parcelById(doc.parcelId)?.nom||'',duration:formatClock(m.durationMs)};
  }
  function memoRow(doc){
    const meta=memoMeta(doc),text=doc.voiceMemo.transcript;
    return `<article class="vn-memo" data-memo="${escapeHtml(doc.id)}"><button type="button" class="vn-play" data-vn="play" data-id="${escapeHtml(doc.id)}" aria-pressed="false" aria-label="Écouter le mémo de ${escapeHtml(meta.when)}">${playIcon(false)}</button><div class="vn-memo-text"><strong>${escapeHtml(meta.parcel||'Sans parcelle')} · ${meta.duration}</strong><small>${escapeHtml(meta.when)} · ${text?`« ${escapeHtml(text.length>70?`${text.slice(0,70)}…`:text)} »`:'pas encore transcrit'}</small></div><button type="button" class="button secondary vn-process" data-vn="process" data-id="${escapeHtml(doc.id)}">Traiter</button></article>`;
  }
  const playIcon=playing=>playing?'<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>':'<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';

  function renderHome(){
    const brief=document.getElementById('morning-brief');if(!brief)return;
    let section=document.getElementById('voice-memos-home');
    const memos=pendingMemos(state());
    if(!memos.length){section?.remove();return;}
    if(!section){section=document.createElement('section');section.id='voice-memos-home';section.className='panel vn-home';section.setAttribute('aria-labelledby','vn-home-title');section.addEventListener('click',onMemoClick);brief.after(section);}
    section.innerHTML=`<div class="panel-heading"><h2 id="vn-home-title">${memoSummaryLabel(memos.length)}</h2>${memos.length>3?'<button type="button" class="text-button" data-vn="all">Tout voir</button>':''}</div><div class="vn-memo-list">${memos.slice(0,3).map(memoRow).join('')}</div>`;
  }
  function onMemoClick(event){
    const button=event.target.closest('[data-vn]');if(!button)return;
    const action=button.dataset.vn,id=button.dataset.id;
    if(action==='play')togglePlay(id,button);
    else if(action==='process')openMemo(id);
    else if(action==='all')openAll();
  }
  function openAll(){
    stopPlayback();const memos=pendingMemos(state());
    modal(memoSummaryLabel(memos.length),'Réécoutez, transcrivez puis transformez chaque mémo en travail.',`<div class="vn-memo-list" id="vn-all">${memos.map(memoRow).join('')||'<div class="empty-state">Aucun mémo à traiter.</div>'}</div>`,'');
    $('#vn-all')?.addEventListener('click',onMemoClick);
  }
  async function togglePlay(id,button){
    if(player?.id===id){stopPlayback();return;}
    stopPlayback();
    const blob=await store.storage.blobGet(id).catch(()=>null);
    if(!blob)return toast('Audio introuvable sur cet appareil.','error');
    const url=URL.createObjectURL(blob),audio=new Audio(url);
    player={id,audio,url,button};button.setAttribute('aria-pressed','true');button.innerHTML=playIcon(true);button.setAttribute('aria-label','Mettre en pause');
    audio.onended=()=>stopPlayback();audio.onerror=()=>{stopPlayback();toast('Lecture impossible sur ce navigateur.','error');};
    try{await audio.play();}catch{stopPlayback();toast('Lecture impossible : touchez de nouveau le bouton.','error');}
  }
  function stopPlayback(){
    if(!player)return;const {audio,url,button}=player;player=null;
    try{audio.pause();}catch{}URL.revokeObjectURL(url);
    if(button?.isConnected){button.setAttribute('aria-pressed','false');button.innerHTML=playIcon(false);button.setAttribute('aria-label','Écouter le mémo');}
  }
  async function openMemo(id){
    stopPlayback();const doc=store.get('documents',id);if(!doc?.voiceMemo)return toast('Mémo introuvable.','error');
    const blob=await store.storage.blobGet(id).catch(()=>null),meta=memoMeta(doc),url=blob?URL.createObjectURL(blob):'';
    modal('Mémo vocal',`${meta.when}${meta.parcel?` · ${meta.parcel}`:''} · ${meta.duration}`,`<div class="vn-sheet">${url?`<audio class="vn-audio" controls preload="metadata" src="${url}"></audio>`:'<div class="notice warning">Audio introuvable sur cet appareil (il est peut-être sur un autre appareil synchronisé).</div>'}
      <label class="vn-text">Transcription *<textarea id="vn-memo-text" rows="4" placeholder="Réécoutez puis écrivez ou dictez ce que vous avez dit.">${escapeHtml(doc.voiceMemo.transcript||'')}</textarea></label>
      ${canRecognize()?'<button type="button" class="button secondary" id="vn-memo-dictate">'+icon('mic',{size:18})+' Dicter la transcription</button>':'<p class="form-note">Sans réseau, écrivez la transcription ou utilisez la touche micro du clavier.</p>'}
      <p class="form-error hidden" id="vn-memo-error" role="alert"></p></div>`,
    `<button type="button" class="button secondary" id="vn-memo-delete">Supprimer</button><button type="button" class="button secondary" id="vn-memo-done">Marquer comme traité</button><button type="button" class="button primary vn-wide" id="vn-memo-prepare">Préparer le brouillon</button>`);
    if(url)watchClose('vn-memo-text',()=>URL.revokeObjectURL(url));
    const text=()=>$('#vn-memo-text').value.trim(),error=message=>{const el=$('#vn-memo-error');el.textContent=message;el.classList.remove('hidden');};
    $('#vn-memo-dictate')?.addEventListener('click',()=>dictateInto($('#vn-memo-text'),$('#vn-memo-dictate')));
    $('#vn-memo-prepare').onclick=async()=>{const value=text();if(!value)return error('Champ obligatoire : transcription.');await markMemo(id,'pending',{transcript:value}).catch(()=>{});analyze(value,{memoId:id});};
    $('#vn-memo-done').onclick=async()=>{const value=text();await markMemo(id,'done',value?{transcript:value}:{});closeModal();toast('Mémo marqué comme traité.','success',{label:'Annuler',run:()=>markMemo(id,'pending')});};
    $('#vn-memo-delete').onclick=async()=>{try{await store.remove('documents',id);}catch(failure){return error(failure.message);}renderHome();closeModal();toast('Mémo placé dans la corbeille.','success',{label:'Annuler',run:async()=>{await store.restore('documents',id);renderHome();}});};
  }
  function dictateInto(textarea,button){
    const Recognition=SR();if(!Recognition||!textarea)return;
    try{
      const r=new Recognition();r.lang='fr-FR';r.interimResults=true;r.continuous=true;const base=textarea.value.trim();
      r.onresult=event=>{let out='';for(let i=0;i<event.results.length;i++)out+=event.results[i][0].transcript;textarea.value=`${base?`${base} `:''}${out}`.trim();};
      r.onerror=event=>{if(event?.error==='network')toast('Reconnaissance indisponible sans réseau : écrivez la transcription.','error');};
      r.onend=()=>{if(button?.isConnected){button.disabled=false;button.setAttribute('aria-pressed','false');}};
      button.disabled=true;button.setAttribute('aria-pressed','true');r.start();setTimeout(()=>{try{r.stop();}catch{}},60000);
    }catch{toast('Dictée indisponible : écrivez la transcription.','error');}
  }

  return {mountFab,open,renderHome,openMemo,openAll,isRecording:()=>Boolean(rec&&!rec.stopped)};
}
