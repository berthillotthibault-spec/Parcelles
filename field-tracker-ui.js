// Interface du suivi GPS continu dans le mode terrain (« Suivre ma position »).
// Les positions restent sur l'appareil ; seules les présences confirmées deviennent des travaux.
import {escapeHtml, formatNumber} from './utils.js';
import {buildInterventionFromSession, chantierProgress} from './field-ops.js';
import {localDay} from './home-priorities.js';
import {FieldTracker, TRACKING_LIMITS, chantierForParcel, clockTime, defaultsForType, finishPlannedFromProposal, FINISH_KEYS, formatPresence, gpsQuality, suggestWorkTypes, visitToProposal, workFromProposal} from './field-tracker.js';

const MAX_PROPOSALS=12,FORWARD_MS=15000;

export function createFieldTrackerUI(host){
  const {store,state,active,parcelById,toast,modal,closeModal,openWorkForm}=host;
  const tracker=new FieldTracker();
  let root=null,watchId=null,scope=null,proposals=[],hints=[],lastPos=null,lastError='',currentId=null,enteredAt=null,lastForward=0,forwardedParcel=undefined,wakeLock=null,battery=null,busy=false,tickId=null;

  const storageKey=()=>`parcelles:field-tracking:${store.workspaceContext().key}`;
  const persist=()=>{try{localStorage.setItem(storageKey(),JSON.stringify({proposals:proposals.slice(0,MAX_PROPOSALS)}));}catch{}};
  const load=()=>{try{const saved=JSON.parse(localStorage.getItem(storageKey())||'null');proposals=Array.isArray(saved?.proposals)?saved.proposals.filter(p=>p&&p.parcelId&&Number.isFinite(p.start)&&Number.isFinite(p.end)).slice(0,MAX_PROPOSALS):[];}catch{proposals=[];}};
  let loadedScope=null;
  const ensureLoaded=()=>{const key=store.workspaceContext().key;if(loadedScope!==key){loadedScope=key;load();hints=[];}};
  const prefs=()=>state().preferences||{};
  const parcelName=id=>parcelById(id)?.nom||'Parcelle supprimée';

  function mount(element){root=element;ensureLoaded();render();}
  function isActive(){return watchId!==null;}

  async function requestConsent(){
    if(prefs().gpsConsent)return true;
    return new Promise(resolve=>{
      modal('Suivre votre position ?','Le suivi ne démarre que sur votre demande et s’arrête quand vous le décidez.',`<div class="notice info">Parcelles relève votre position toutes les quelques secondes pour savoir dans quelle parcelle vous êtes et mesurer le temps passé. Les positions restent sur cet appareil : seuls les travaux que vous confirmez sont enregistrés. Le suivi s’arrête seul après 30 min sans mouvement.</div>`,`<button class="button secondary" data-action="close-modal" id="ft-consent-cancel">Pas maintenant</button><button class="button primary" id="ft-consent-ok">Activer le suivi</button>`,'small');
      const ok=document.getElementById('ft-consent-ok'),cancel=document.getElementById('ft-consent-cancel');
      if(cancel)cancel.addEventListener('click',()=>resolve(false),{once:true});
      if(ok)ok.onclick=async()=>{try{await store.setPreferences({gpsConsent:true});}catch{}closeModal();resolve(true);};
      else resolve(false);
    });
  }

  async function start(){
    if(isActive())return;
    if(!('geolocation'in navigator)){toast('La géolocalisation n’est pas disponible sur cet appareil.','error');return;}
    if(!await requestConsent())return;
    ensureLoaded();scope=store.workspaceContext().key;tracker.reset();lastPos=null;lastError='';currentId=null;enteredAt=null;forwardedParcel=undefined;lastForward=0;
    try{watchId=navigator.geolocation.watchPosition(onPosition,onError,{enableHighAccuracy:true,maximumAge:5000,timeout:30000});}catch(error){watchId=null;toast(`Suivi GPS impossible : ${error.message}`,'error');return;}
    requestWakeLock();readBattery();
    tickId=setInterval(()=>{if(isActive())renderStatus();},30000);
    document.addEventListener('visibilitychange',onVisibility);
    render();toast('Suivi de position activé. Les parcelles traversées sont détectées automatiquement.');
  }

  function stop({reason='',silent=false}={}){
    if(!isActive())return;
    try{navigator.geolocation.clearWatch(watchId);}catch{}
    watchId=null;clearInterval(tickId);tickId=null;document.removeEventListener('visibilitychange',onVisibility);releaseWakeLock();
    const closed=tracker.finish();if(closed&&!silent)handleEvents([closed],Date.now());
    currentId=null;enteredAt=null;
    render();if(!silent)toast(reason||'Suivi de position arrêté.',reason?'error':'success',null,{persist:Boolean(reason)});
  }
  function toggle(){return isActive()?stop():start();}

  function onVisibility(){if(document.visibilityState==='visible'&&isActive())requestWakeLock();}
  async function requestWakeLock(){if(wakeLock||!('wakeLock'in navigator)||document.visibilityState!=='visible')return;try{wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener?.('release',()=>{wakeLock=null;});}catch{wakeLock=null;}}
  async function releaseWakeLock(){try{await wakeLock?.release?.();}catch{}wakeLock=null;}
  async function readBattery(){try{if(!navigator.getBattery)return;const b=await navigator.getBattery();battery=b;b.addEventListener?.('levelchange',()=>isActive()&&renderStatus());}catch{battery=null;}}

  function onError(error){
    if(error?.code===1){stop({reason:'Suivi arrêté : autorisez la localisation pour Parcelles dans les réglages de l’appareil.'});return;}
    lastError=error?.code===3?'Signal GPS lent, nouvelle tentative…':'Position indisponible pour le moment, nouvelle tentative…';renderStatus();
  }

  function onPosition(position){
    if(!isActive())return;
    if(scope!==store.workspaceContext().key){stop({silent:true});return;}
    // Horloge de l'appareil : les horodatages GPS peuvent dater d'une position mise en cache.
    const coords=position.coords||position,now=Date.now();
    lastPos={latitude:Number(coords.latitude),longitude:Number(coords.longitude),accuracy:Number(coords.accuracy),at:now};lastError='';
    const {events}=tracker.sample(lastPos,active('parcelles'),now);
    if(events.length)handleEvents(events,now);
    const parcelId=tracker.current?.parcelId||null;
    if(parcelId!==currentId){currentId=parcelId;enteredAt=tracker.current?.start||null;}
    if(host.onPosition&&(parcelId!==forwardedParcel||now-lastForward>=FORWARD_MS)){forwardedParcel=parcelId;lastForward=now;try{host.onPosition(lastPos);}catch{}}
    if(events.length)render();else renderStatus();
  }

  function handleEvents(events,now){
    for(const event of events){
      if(event.type==='idle'){setTimeout(()=>stop({reason:'Suivi GPS arrêté : aucun mouvement depuis 30 min, pour préserver la batterie.'}),0);continue;}
      if(event.type==='exit'){
        const session=host.activeFieldSession?.();
        hints=hints.filter(h=>h.parcelId!==event.visit.parcelId);
        if(session&&session.parcelId===event.visit.parcelId){if(event.eligible||event.visit.durationMs>=60000)hints.unshift({kind:'session-exit',parcelId:event.visit.parcelId,sessionId:session.id,at:now});continue;}
        if(event.eligible&&parcelById(event.visit.parcelId)){proposals=[visitToProposal(event.visit),...proposals.filter(p=>p.id!==`gps_${event.visit.parcelId}_${event.visit.start}`)].slice(0,MAX_PROPOSALS);persist();host.haptic?.();}
      }
      if(event.type==='enter')onEnter(event.parcelId);
    }
  }

  function onEnter(parcelId){
    hints=hints.filter(h=>h.kind!=='chantier');
    const data=state(),site=chantierForParcel(data,parcelId);if(!site)return;
    const session=host.activeFieldSession?.(data);
    if(session&&session.parcelId===parcelId)return;
    if(session&&session.chantierId!==site.chantier.id)return;
    const hint={kind:'chantier',parcelId,chantierId:site.chantier.id,fromSessionId:session?.id||null};
    // L'enchaînement remplace le rappel « Vous avez quitté… » de la même session.
    if(session)hints=hints.filter(h=>!(h.kind==='session-exit'&&h.sessionId===session.id));
    if(prefs().fieldTrackAutoChain&&session){chain(hint,{auto:true});return;}
    hints.unshift(hint);
  }

  // Termine la session en cours (travail créé) puis démarre la session de la parcelle suivante du chantier.
  async function chain(hint,{auto=false}={}){
    if(busy)return;busy=true;
    try{
      const data=state(),chantier=store.get('chantiers',hint.chantierId),parcel=parcelById(hint.parcelId,data);
      if(!chantier||!parcel)throw new Error('Chantier ou parcelle introuvable.');
      const previous=hint.fromSessionId?store.get('fieldSessions',hint.fromSessionId):null;
      let finishedName='';
      if(previous&&previous.status==='En cours'&&!previous.endedAt){
        const endedAt=Math.max(Number(previous.startedAt)||0,Date.now());
        const ended={...previous,endedAt,status:'Terminé',endGps:lastPos?{latitude:lastPos.latitude,longitude:lastPos.longitude,accuracy:lastPos.accuracy}:null};
        await store.upsert('fieldSessions',ended,{label:'Session terrain terminée (enchaînement de chantier).'});
        const prevParcel=parcelById(previous.parcelId,data);finishedName=prevParcel?.nom||'';
        if(prevParcel){const day=localDay(new Date(Number(previous.startedAt)||Date.now()));const work=await store.upsert('interventions',buildInterventionFromSession(ended,prevParcel,{date:day,campaignId:undefined}),{label:`Travail créé depuis session : ${ended.type||chantier.type}`});await store.upsert('fieldSessions',{...ended,interventionId:work.id},{label:'Session reliée au travail.'});}
      }
      const progress=chantierProgress(chantier,active('interventions'));
      if(progress.remaining===0){await store.upsert('chantiers',{...chantier,status:'Terminé',completedAt:Date.now()},{label:`Chantier terminé : ${chantier.type}`});}
      else{
        await store.upsert('fieldSessions',{parcelId:parcel.id,chantierId:chantier.id,type:previous?.type||chantier.type||'Travail terrain',operator:previous?.operator||chantier.operator||prefs().defaultOperator||'',equipmentId:previous?.equipmentId||chantier.equipmentId||'',note:'',surfaceWorked:parcel.surfaceHa??null,startedAt:Date.now(),endedAt:null,status:'En cours',startGps:lastPos?{latitude:lastPos.latitude,longitude:lastPos.longitude,accuracy:lastPos.accuracy}:null},{label:`Session terrain démarrée : ${parcel.nom}`});
        if(chantier.status!=='En cours')await store.upsert('chantiers',{...chantier,status:'En cours',startedAt:chantier.startedAt||Date.now()},{label:`Chantier démarré : ${chantier.type}`});
      }
      hints=hints.filter(h=>h!==hint);
      host.renderFieldSessionCard?.();render();
      toast(finishedName?`${auto?'Enchaînement automatique : ':''}${finishedName} terminée, chronomètre lancé sur ${parcel.nom}.`:`Chronomètre lancé sur ${parcel.nom}.`,'success');
    }catch(error){toast(error.message,'error');}
    finally{busy=false;}
  }

  async function save(id,type,workId=''){
    if(busy)return;const proposal=proposals.find(p=>p.id===id);if(!proposal)return;
    const data=state(),parcel=parcelById(proposal.parcelId,data);
    if(!parcel){toast('Parcelle introuvable : présence ignorée.','error');ignore(id);return;}
    busy=true;
    try{
      const planned=workId?store.get('interventions',workId):null;
      let undo;
      if(planned&&!planned.deletedAt){
        const before=Object.fromEntries(FINISH_KEYS.map(k=>[k,planned[k]??null]));
        await store.upsert('interventions',finishPlannedFromProposal(planned,proposal,parcel),{label:`Travail terminé (suivi GPS) : ${planned.type} · ${parcel.nom}`});
        undo=()=>store.upsert('interventions',{id:planned.id,...before},{label:`Clôture annulée : ${planned.type}`});
      }else{
        const work=await store.upsert('interventions',workFromProposal(proposal,parcel,type,defaultsForType(data,type)),{label:`Travail enregistré (suivi GPS) : ${type} · ${parcel.nom}`});
        undo=()=>store.remove('interventions',work.id);
      }
      proposals=proposals.filter(p=>p.id!==id);persist();render();
      host.haptic?.();
      toast(`Enregistré : ${type} · ${parcel.nom} · ${formatPresence(proposal.durationMs)}.`,'success',{label:'Annuler',run:async()=>{try{await undo();proposals=[proposal,...proposals.filter(p=>p.id!==proposal.id)].slice(0,MAX_PROPOSALS);persist();render();toast('Enregistrement annulé.');}catch(error){toast(error.message,'error');}}});
    }catch(error){toast(error.message,'error');}
    finally{busy=false;}
  }

  function ignore(id){proposals=proposals.filter(p=>p.id!==id);persist();render();}

  function details(id){
    const proposal=proposals.find(p=>p.id===id),parcel=proposal&&parcelById(proposal.parcelId);if(!proposal||!parcel)return;
    const type=suggestWorkTypes(state(),parcel.id,{nowMs:proposal.start})[0]?.type||'';
    host.closeFieldMode?.();
    openWorkForm({...workFromProposal(proposal,parcel,type||'Travail à préciser',defaultsForType(state(),type)),type});
  }

  function onClick(event){
    const control=event.target.closest('[data-ft]');if(!control||!root?.contains(control))return;
    const action=control.dataset.ft,id=control.dataset.id;
    if(action==='toggle')toggle();
    else if(action==='save')save(id,control.dataset.type,control.dataset.work||'');
    else if(action==='ignore')ignore(id);
    else if(action==='details')details(id);
    else if(action==='chain'){const hint=hints[Number(control.dataset.index)];if(hint)chain(hint);}
    else if(action==='finish-session'){const hint=hints[Number(control.dataset.index)];hints=hints.filter(h=>h!==hint);render();if(hint)host.finishFieldSession?.(hint.sessionId);}
    else if(action==='dismiss-hint'){hints.splice(Number(control.dataset.index),1);render();}
  }
  async function onChange(event){
    const input=event.target.closest('[data-ft="auto-chain"]');if(!input)return;
    try{await store.setPreferences({fieldTrackAutoChain:input.checked});toast(input.checked?'Les parcelles du chantier s’enchaîneront automatiquement.':'Enchaînement des parcelles sur confirmation.');}catch(error){toast(error.message,'error');}
  }

  function statusHtml(){
    if(!isActive())return '';
    const quality=gpsQuality(lastPos?.accuracy),parcel=currentId?parcelById(currentId):null,since=enteredAt?formatPresence(Date.now()-enteredAt):'';
    const where=!lastPos?`<p class="ft-where"><small>Recherche du signal GPS…</small><strong>Position en attente</strong></p>`
      :parcel?`<p class="ft-where"><small>Vous êtes dans</small><strong>${escapeHtml(parcel.nom)}</strong><span>${formatNumber(parcel.surfaceHa)} ha${enteredAt?(Date.now()-enteredAt<60000?' · à l’instant':` · depuis ${since}`):''}</span></p>`
      :`<p class="ft-where"><small>Position suivie</small><strong>Hors parcelle</strong><span>${quality.level==='poor'&&quality.accuracy>TRACKING_LIMITS.maxAccuracy?'Précision insuffisante pour détecter la parcelle':'Aucune parcelle connue ici'}</span></p>`;
    const level=battery&&Number.isFinite(battery.level)?Math.round(battery.level*100):null;
    return `${where}<div class="ft-meta"><span class="ft-gps is-${quality.level}"><i aria-hidden="true"></i>${escapeHtml(quality.label)}${quality.accuracy!==null?` · ± ${quality.accuracy} m`:''}</span>${level!==null?`<span class="ft-battery${level<=20&&!battery.charging?' is-low':''}">Batterie ${level} %${battery.charging?' · en charge':''}</span>`:''}</div>${lastError?`<p class="form-note ft-error">${escapeHtml(lastError)}</p>`:''}`;
  }

  function proposalHtml(p){
    const parcel=parcelById(p.parcelId);if(!parcel)return '';
    const suggestions=suggestWorkTypes(state(),p.parcelId,{nowMs:p.start}),first=suggestions[0];
    const time=`${clockTime(p.start)}–${clockTime(p.end)}`,day=localDay(new Date(p.start))===localDay()?'':` · ${new Date(p.start).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}`;
    const head=`<p class="ft-proposal-title"><strong>${formatPresence(p.durationMs)} sur ${escapeHtml(parcel.nom)}</strong><span>${time}${day}</span></p>`;
    if(!first)return `<article class="ft-proposal" data-proposal="${escapeHtml(p.id)}">${head}<p class="ft-question">Quel travail avez-vous fait ?</p><button class="button primary ft-save" data-ft="details" data-id="${escapeHtml(p.id)}">Préciser le travail</button><div class="ft-actions"><button class="button secondary" data-ft="ignore" data-id="${escapeHtml(p.id)}">Ignorer</button></div></article>`;
    const others=suggestions.slice(1);
    return `<article class="ft-proposal" data-proposal="${escapeHtml(p.id)}">${head}<p class="ft-question">Enregistrer comme <strong>${escapeHtml(first.type)}</strong> ?</p><p class="ft-reason">${escapeHtml(first.reason)}${first.workId?' : le travail prévu sera marqué terminé.':'.'}</p><button class="button primary ft-save" data-ft="save" data-id="${escapeHtml(p.id)}" data-type="${escapeHtml(first.type)}" data-work="${escapeHtml(first.workId||'')}">Enregistrer comme ${escapeHtml(first.type)}</button>${others.length?`<div class="ft-chips" role="group" aria-label="Autre type de travail"><span>Autre :</span>${others.map(s=>`<button class="ft-chip" data-ft="save" data-id="${escapeHtml(p.id)}" data-type="${escapeHtml(s.type)}" data-work="${escapeHtml(s.workId||'')}">${escapeHtml(s.type)}</button>`).join('')}</div>`:''}<div class="ft-actions"><button class="button secondary" data-ft="details" data-id="${escapeHtml(p.id)}">Compléter…</button><button class="button secondary" data-ft="ignore" data-id="${escapeHtml(p.id)}">Ignorer</button></div></article>`;
  }

  function hintHtml(hint,index){
    const name=escapeHtml(parcelName(hint.parcelId));
    if(hint.kind==='session-exit')return `<article class="ft-hint"><p><strong>Vous avez quitté ${name}.</strong> Le chronomètre de la session tourne toujours.</p><div class="ft-actions"><button class="button primary" data-ft="finish-session" data-index="${index}">Terminer la session</button><button class="button secondary" data-ft="dismiss-hint" data-index="${index}">Continuer</button></div></article>`;
    const chantier=store.get('chantiers',hint.chantierId);if(!chantier)return '';
    const progress=chantierProgress(chantier,active('interventions')),from=hint.fromSessionId?store.get('fieldSessions',hint.fromSessionId):null,fromName=from?escapeHtml(parcelName(from.parcelId)):'';
    return `<article class="ft-hint"><p class="eyebrow">Chantier · ${escapeHtml(chantier.type||'Travail')} · ${progress.done} sur ${progress.total} faite${progress.done>1?'s':''}</p><p><strong>Vous entrez dans ${name}.</strong> ${from?`Terminer ${fromName} et lancer le chronomètre ici ?`:'Lancer le chronomètre de cette parcelle ?'}</p><div class="ft-actions"><button class="button primary" data-ft="chain" data-index="${index}">${from?'Enchaîner':'Démarrer ici'}</button><button class="button secondary" data-ft="dismiss-hint" data-index="${index}">Plus tard</button></div></article>`;
  }

  function hasOpenChantier(){return active('chantiers').some(c=>c.kind!=='tp'&&!['Terminé','Annulé'].includes(c.status));}

  function render(){
    renderPill();
    if(!root||!root.isConnected)return;
    ensureLoaded();
    const on=isActive(),list=proposals.map(proposalHtml).filter(Boolean),hintList=hints.map(hintHtml);
    root.innerHTML=`<article class="panel ft-panel${on?' is-on':''}"><div class="ft-head"><div><p class="eyebrow">Suivi continu</p><h2 id="ft-title">Suivre ma position</h2></div><button type="button" class="ft-switch${on?' is-on':''}" role="switch" aria-checked="${on}" aria-labelledby="ft-title" data-ft="toggle"><i></i></button></div>${on?`<div class="ft-status" id="ft-status" aria-live="polite">${statusHtml()}</div>`:`<p class="form-note">Détecte la parcelle où vous êtes et propose d’enregistrer le temps passé à la sortie. Positions gardées sur cet appareil ; arrêt automatique après 30 min sans mouvement.</p>`}${on&&hasOpenChantier()?`<label class="ft-option"><input type="checkbox" data-ft="auto-chain" ${prefs().fieldTrackAutoChain?'checked':''}> <span>Enchaîner automatiquement les parcelles d’un chantier en cours</span></label>`:''}${hintList.join('')}${list.length?`<div class="ft-proposals"><h3>${list.length} présence${list.length>1?'s':''} à confirmer</h3>${list.join('')}</div>`:''}</article>`;
    if(!root.dataset.ftBound){root.dataset.ftBound='1';root.addEventListener('click',onClick);root.addEventListener('change',onChange);}
  }
  function renderStatus(){renderPill();const el=root?.isConnected?root.querySelector('#ft-status'):null;if(el)el.innerHTML=statusHtml();}

  function renderPill(){
    const show=isActive()&&!host.isFieldModeOpen?.();let pill=document.getElementById('ft-pill');
    if(!show){pill?.remove();return;}
    if(!pill){pill=document.createElement('button');pill.type='button';pill.id='ft-pill';pill.className='ft-pill';pill.onclick=()=>host.openFieldMode?.();document.body.append(pill);}
    const parcel=currentId?parcelById(currentId):null,count=proposals.length;
    pill.setAttribute('aria-label',`Suivi GPS actif${parcel?`, dans ${parcel.nom}`:''}. Ouvrir le mode terrain.`);
    pill.innerHTML=`<i aria-hidden="true"></i><span>Suivi GPS${parcel?` · ${escapeHtml(parcel.nom)}`:''}</span>${count?`<b>${count}</b>`:''}`;
  }

  return{mount,start,stop,toggle,isActive,refresh:render,get proposals(){return proposals.slice();}};
}
