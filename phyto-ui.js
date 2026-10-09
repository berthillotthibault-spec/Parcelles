// n° 62 — Interface du registre phytosanitaire : fiche produit, contrôles avant validation
// d'un traitement (dérogation motivée), délai de rentrée sur l'accueil et registre exportable.
import {chipify,syncChips} from './form-chips-ui.js';
import {escapeHtml as e,downloadBlob,formatNumber,localDate,toNullableNumber} from './utils.js';
import {
  checkTreatment,isTreatment,phytoSheet,productFor,activeReentries,limitsSnapshot,registerRows,registerCsv,registerHtml,registerCampaigns,
  DRE_CHOICES,PHYTO_MENTIONS,PHYTO_CATEGORIES,PHYTO_DISCLAIMER,LABEL_REMINDER,LEGAL_WIND_KMH,withdrawalLabel
} from './phyto.js';
import {workWindow,windowWarnings,windTowardWater,forecastAge,compass,LEGAL_WIND_TEXT} from './spray-window.js';

const field=(label,name,value,attrs='')=>`<label>${label}<input name="${name}" value="${e(value??'')}" ${attrs}></label>`;
const numField=(label,name,value)=>field(label,name,value,'type="number" min="0" step="any" inputmode="decimal"');
const usagesText=usages=>(usages||[]).map(u=>[u.culture,u.target,u.maxDose??'',u.doseUnit||'',u.maxApplications??'',u.dar??''].join(' ; ')).join('\n');
function parseUsages(text){
  return String(text||'').split(/\r?\n/).map(line=>line.split(';').map(x=>x.trim())).filter(c=>c[0]||c[1]).map(([culture='',target='',maxDose='',doseUnit='',maxApplications='',dar=''])=>({culture,target,maxDose:toNullableNumber(maxDose),doseUnit,maxApplications:toNullableNumber(maxApplications),dar:toNullableNumber(dar)}));
}

export function createPhytoUI({store,modal,closeModal,toast,openPrintableReport,getWeather=()=>null,catalogLookup=()=>null,catalogNotice=()=>'',weatherWindow=null}){
  weatherWindow||=work=>workWindow(getWeather(),work);
  return createPhytoUIInner({store,modal,closeModal,toast,openPrintableReport,getWeather,catalogLookup,catalogNotice,weatherWindow});
}
function createPhytoUIInner({store,modal,closeModal,toast,openPrintableReport,getWeather,catalogLookup,catalogNotice,weatherWindow}){
  const $=selector=>document.querySelector(selector);
  const catalog=()=>catalogLookup;

  // ---- Fiche produit (stock) ------------------------------------------------------------------
  function enhanceStockForm(form,item){
    if(!form||form.querySelector('.phyto-sheet'))return;
    const s=phytoSheet(item||{}),open=Boolean(item?.phyto)||item?.category==='Produit';
    form.insertAdjacentHTML('beforeend',`<details class="form-section phyto-sheet span-2" ${open?'open':''}><summary>Fiche phytosanitaire (facultatif)</summary>
      <p class="phyto-hint">Recopiez les valeurs de l’étiquette ou de E-Phy. Elles servent aux contrôles indicatifs du registre. ${e(LABEL_REMINDER)}</p>
      <div class="form-grid">${field('N° AMM','phyto_amm',s.amm,'inputmode="numeric" autocomplete="off"')}
      <label>Type<select name="phyto_category"><option value="">Non précisé</option>${PHYTO_CATEGORIES.map(([v,l])=>`<option value="${v}" ${s.category===v?'selected':''}>${l}</option>`).join('')}</select></label>
      ${numField('Dose max homologuée','phyto_maxDose',s.maxDose)}
      <label>Unité<select name="phyto_doseUnit"><option value="">—</option>${['L/ha','kg/ha','g/ha','mL/ha'].map(v=>`<option ${s.doseUnit===v?'selected':''}>${v}</option>`).join('')}</select></label>
      ${numField('Applications max / campagne','phyto_maxApplications',s.maxApplications)}
      ${numField('DAR (jours avant récolte)','phyto_dar',s.dar)}
      <label>DRE (délai de rentrée)<select name="phyto_dre"><option value="">Non renseigné</option>${DRE_CHOICES.map(h=>`<option value="${h}" ${s.dre===h?'selected':''}>${h} h</option>`).join('')}</select></label>
      ${numField('ZNT eau (m)','phyto_zntWater',s.zntWater)}${numField('ZNT riverains (m)','phyto_zntResidents',s.zntResidents)}
      ${numField('Dose de référence IFT','phyto_refDose',s.refDose)}
      <fieldset class="span-2 phyto-mentions"><legend>Mentions</legend>${PHYTO_MENTIONS.map(([v,l])=>`<label class="check-row"><input type="checkbox" name="phyto_mention" value="${v}" ${s.mentions.includes(v)?'checked':''}><span>${l}</span></label>`).join('')}</fieldset>
      <label class="span-2">Usages (une ligne : culture ; cible ; dose max ; unité ; applications max ; DAR)<textarea name="phyto_usages" rows="3" placeholder="Blé ; Septoriose ; 0,8 ; L/ha ; 2 ; 35">${e(usagesText(s.usages))}</textarea></label>
      ${s.withdrawnAt||s.useUntil?`<p class="notice warning span-2">${e(withdrawalLabel(s))}</p>`:''}</div></details>`);
    const keep=item?.phyto?{withdrawnAt:item.phyto.withdrawnAt||'',useUntil:item.phyto.useUntil||'',source:item.phyto.source||'',name:item.phyto.name||''}:{};
    form.dataset.phytoKeep=JSON.stringify(keep);
    const el=form.elements;
    chipify(el.phyto_dre,{options:[{value:'',label:'—'},...DRE_CHOICES.map(h=>({value:String(h),label:`${h} h`}))],other:null});
    chipify(el.phyto_category,{options:[{value:'',label:'—'},...PHYTO_CATEGORIES.map(([value,label])=>({value,label}))],other:null});
    if(form.querySelector('.phyto-sheet .form-grid'))form.querySelector('.phyto-sheet .form-grid').insertAdjacentHTML('afterbegin',`<p class="phyto-catalog-fill span-2 hidden" role="status"></p>${catalogNotice()?`<div class="span-2">${catalogNotice()}</div>`:''}`);
    const fill=()=>{
      const entry=catalogLookup({amm:el.phyto_amm.value,name:el.name?.value});if(!entry)return;
      const c=phytoSheet(entry),set=(name,value)=>{const x=el[name];if(x&&value!==null&&value!==undefined&&value!==''&&!String(x.value).trim()){x.value=String(value);x.dispatchEvent(new Event('change',{bubbles:true}));}};
      set('phyto_amm',c.amm);set('phyto_category',c.category);set('phyto_dar',c.dar);set('phyto_dre',c.dre);set('phyto_zntWater',c.zntWater);set('phyto_zntResidents',c.zntResidents);
      const one=c.usages.length===1?c.usages[0]:null;if(one){set('phyto_maxDose',one.maxDose);set('phyto_doseUnit',one.doseUnit);set('phyto_maxApplications',one.maxApplications);}
      if(!String(el.phyto_usages.value).trim()&&c.usages.length)el.phyto_usages.value=usagesText(c.usages);
      for(const box of form.querySelectorAll('[name="phyto_mention"]'))if(c.mentions.includes(box.value))box.checked=true;
      const keep=JSON.parse(form.dataset.phytoKeep||'{}');keep.withdrawnAt=c.withdrawnAt;keep.useUntil=c.useUntil;keep.source='catalogue';keep.name=c.name;form.dataset.phytoKeep=JSON.stringify(keep);
      const note=form.querySelector('.phyto-catalog-fill');note.textContent=`Complété depuis le catalogue E-Phy : ${c.name} (AMM ${c.amm}). ${withdrawalLabel(c)||LABEL_REMINDER}`;note.classList.remove('hidden');note.classList.toggle('is-withdrawn',Boolean(c.withdrawnAt));
      form.querySelector('.phyto-sheet').open=true;syncChips(form);
    };
    el.phyto_amm.addEventListener('change',fill);el.name?.addEventListener('change',fill);
    syncChips(form);
  }
  /** Retire les champs phyto_* des valeurs du formulaire et renvoie la fiche (null si vide). */
  function readStockForm(form,values){
    const fd=new FormData(form),get=k=>String(fd.get(k)??'').trim();
    for(const key of Object.keys(values))if(key.startsWith('phyto_'))delete values[key];
    if(!form.querySelector('.phyto-sheet'))return undefined;
    const sheet={amm:get('phyto_amm'),category:get('phyto_category'),maxDose:toNullableNumber(get('phyto_maxDose')),doseUnit:get('phyto_doseUnit'),maxApplications:toNullableNumber(get('phyto_maxApplications')),
      dar:toNullableNumber(get('phyto_dar')),dre:toNullableNumber(get('phyto_dre')),zntWater:toNullableNumber(get('phyto_zntWater')),zntResidents:toNullableNumber(get('phyto_zntResidents')),
      refDose:toNullableNumber(get('phyto_refDose')),mentions:fd.getAll('phyto_mention').map(String),usages:parseUsages(get('phyto_usages'))};
    const previous=form.dataset.phytoKeep?JSON.parse(form.dataset.phytoKeep):{};
    const merged={...previous,...sheet};
    const empty=!merged.amm&&!merged.usages.length&&!merged.mentions.length&&!merged.category&&['maxDose','maxApplications','dar','dre','zntWater','zntResidents','refDose'].every(k=>merged[k]===null);
    return empty?null:merged;
  }

  // ---- Saisie d'un traitement -----------------------------------------------------------------
  function workFromForm(form,item){
    const v=Object.fromEntries(new FormData(form));
    return{...item,...v,isPhytosanitary:form.elements.isPhytosanitary?.checked,dose:toNullableNumber(v.dose)??v.dose,surfaceWorked:toNullableNumber(v.surfaceWorked),id:item.id};
  }
  function panelHtml(result,work){
    if(!result.applies)return'';
    const l=result.limits||{},s=result.sheet;
    const facts=s?[l.maxDose!==null&&l.maxDose!==undefined?`dose max ${formatNumber(l.maxDose)} ${e(l.doseUnit||'')}`:'',l.maxApplications!==null&&l.maxApplications!==undefined?`${formatNumber(l.maxApplications)} appl. max`:'',l.dar!==null&&l.dar!==undefined?`DAR ${formatNumber(l.dar)} j`:'',s.dre?`DRE ${s.dre} h`:'',l.zntWater?`ZNT eau ${formatNumber(l.zntWater)} m`:'',s.zntResidents?`ZNT riverains ${formatNumber(s.zntResidents)} m`:''].filter(Boolean):[];
    const weather=getWeather(),win=weather?weatherWindow(work):null,parcel=(store.state.parcelles||[]).find(p=>p.id===work.parcelId);
    const direction=win?.direction??weather?.current?.wind_direction_10m,water=parcel&&direction!==undefined&&direction!==null?windTowardWater(parcel,store.state.points,direction):null;
    const notes=[...windowWarnings(win),...(water?[`Vent vers le cours d’eau « ${water.point.nom||water.point.name||water.point.type} » (${water.distance} m, vent de ${compass(direction)}) : respectez la ZNT et limitez la dérive.`]:[])];
    const fmt=v=>String(v).replace('.',',');
    const winLine=win?`Fenêtre ${new Date(win.from).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}–${new Date(win.to).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})} : vent ${win.windMax===null?'—':fmt(win.windMax)} km/h${win.gustMax!==null?` (rafales ${fmt(win.gustMax)})`:''}, ${win.tempMin===null?'—':fmt(win.tempMin)}–${win.tempMax===null?'—':fmt(win.tempMax)} °C, ${win.humidityMin===null?'—':fmt(win.humidityMin)}–${win.humidityMax===null?'—':fmt(win.humidityMax)} %${win.deltaTMax!==null?`, delta T ${fmt(win.deltaTMin)}–${fmt(win.deltaTMax)} °C`:''}. Copié au registre.`:'';
    return`<div class="phyto-panel-head"><strong>Contrôle du traitement</strong>${s?`<small>Fiche ${s.source==='catalogue'?'catalogue E-Phy':'produit'}${facts.length?' : '+facts.join(' · '):''}</small>`:''}</div>
      ${result.blocking.length?`<ul class="phyto-blocking">${result.blocking.map(b=>`<li>${e(b.message)}</li>`).join('')}</ul>`:''}
      ${result.warnings.length?`<ul class="phyto-warnings">${result.warnings.map(w=>`<li>${e(w.message)}</li>`).join('')}</ul>`:''}
      ${!result.blocking.length&&!result.warnings.length?'<p class="phyto-ok">Aucun dépassement détecté d’après la fiche.</p>':''}
      ${notes.length?`<ul class="phyto-warnings phyto-window-warnings">${notes.map(n=>`<li>${e(n)}</li>`).join('')}</ul>`:''}
      ${weather?.loadedAt?`<p class="phyto-weather-age">${e(forecastAge(weather,Date.now(),{online:navigator.onLine!==false}))} (${e(new Date(weather.loadedAt).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}))}).${winLine?` ${e(winLine)}`:''} ${e(LEGAL_WIND_TEXT)}</p>`:`<p class="phyto-weather-age">Pas de prévision météo en cache. ${e(LEGAL_WIND_TEXT)}</p>`}
      ${s?.source==='catalogue'?catalogNotice():''}<p class="phyto-disclaimer"><strong>Indicatif.</strong> ${e(LABEL_REMINDER)} Aucun contrôle ne vaut autorisation.</p>`;
  }
  function enhanceWorkForm(form,item){
    if(!form||form.querySelector('.phyto-panel'))return;
    const el=form.elements,amm=el.amm?.closest('label');if(!amm)return;
    amm.insertAdjacentHTML('afterend',`<label>Cible (si traitement)<input name="target" list="phyto-targets" value="${e(item.target||'')}" placeholder="Septoriose, adventices…"></label><label>Stade<input name="stage" value="${e(item.stage||'')}" placeholder="BBCH 32, 3 feuilles…"></label><datalist id="phyto-targets"></datalist>`);
    const grid=form.querySelector('.form-grid');
    grid.insertAdjacentHTML('beforeend','<div class="phyto-panel span-2 hidden" aria-live="polite"></div>');
    const panel=form.querySelector('.phyto-panel');
    let autoWeather=!item.weatherSnapshot;
    const refresh=()=>{
      const work=workFromForm(form,item),treatment=isTreatment(work);
      if(treatment&&autoWeather&&el.weatherSnapshot&&!el.weatherSnapshot.checked&&getWeather())el.weatherSnapshot.checked=true;
      const result=checkTreatment(store.state,work,{catalog:catalog()});
      panel.classList.toggle('hidden',!result.applies);
      panel.classList.toggle('is-blocking',result.blocking.length>0);
      panel.innerHTML=panelHtml(result,work);
      const list=form.querySelector('#phyto-targets');
      if(list)list.innerHTML=(result.sheet?.usages||[]).map(u=>u.target).filter((v,i,a)=>v&&a.indexOf(v)===i).map(v=>`<option value="${e(v)}"></option>`).join('');
      form.querySelector('.phyto-override')?.classList.toggle('hidden',!result.blocking.length);
    };
    el.weatherSnapshot?.addEventListener('change',()=>{autoWeather=false;});
    el.product?.addEventListener('change',()=>{
      const found=productFor(store.state,{product:el.product.value,amm:''},{catalog:catalog()});
      if(found?.sheet?.amm&&!String(el.amm.value).trim())el.amm.value=found.sheet.amm;
      if(found?.sheet&&el.isPhytosanitary&&!el.isPhytosanitary.checked&&found.sheet.amm){el.isPhytosanitary.checked=true;}
      if(found?.sheet?.doseUnit&&el.doseUnit&&!el.doseUnit.value){el.doseUnit.value=found.sheet.doseUnit;}
      refresh();
    });
    el.amm?.addEventListener('change',()=>{
      const found=productFor(store.state,{product:'',amm:el.amm.value},{catalog:catalog()});
      if(found?.sheet?.name&&el.product&&!String(el.product.value).trim())el.product.value=found.sheet.name;
      refresh();
    });
    form.addEventListener('input',event=>{if(event.target?.name!=='phytoOverrideReason')refresh();});
    form.addEventListener('change',event=>{if(event.target?.name!=='phytoOverrideReason')refresh();});
    refresh();
  }
  /**
   * Avant enregistrement : contrôle, motif de dérogation si bloquant, instantané des limites.
   * Renvoie false si l'enregistrement doit attendre un motif.
   */
  async function guardWork(form,entity){
    const reason=String(entity.phytoOverrideReason||'').trim();delete entity.phytoOverrideReason;
    if(!isTreatment(entity)){delete entity.phytoOverride;return true;}
    if(entity.weatherSnapshot&&entity.date&&entity.startTime){
      const win=weatherWindow(entity);if(win)entity.weatherSnapshot={...entity.weatherSnapshot,window:win};
    }
    const result=checkTreatment(store.state,entity,{catalog:catalog()});
    if(result.blocking.length&&entity.status!=='Annulé'){
      let box=form.querySelector('.phyto-override');
      if(!box){
        form.querySelector('.phyto-panel')?.insertAdjacentHTML('afterend',`<div class="phyto-override span-2" role="alert"><p><strong>Traitement hors limites de la fiche produit.</strong> Corrigez la saisie ou indiquez le motif de la dérogation (il sera inscrit au registre).</p><label>Motif de la dérogation *<textarea name="phytoOverrideReason" rows="2" placeholder="Ex. préconisation écrite du conseiller, erreur de fiche…"></textarea></label><span class="form-error hidden"></span></div>`);
        box=form.querySelector('.phyto-override');
      }
      box.classList.remove('hidden');
      const area=box.querySelector('textarea');
      if(!reason){
        const err=box.querySelector('.form-error');err.textContent='Indiquez le motif pour enregistrer malgré l’alerte.';err.classList.remove('hidden');
        form.closest('details')?.setAttribute('open','');box.scrollIntoView?.({block:'center'});area.focus();return false;
      }
      entity.phytoOverride={reason,codes:result.blocking.map(b=>b.code),at:Date.now()};
    }else delete entity.phytoOverride;
    const snap=limitsSnapshot(result);if(snap)entity.phytoLimits=snap;
    return true;
  }

  // ---- Accueil : délais de rentrée en cours -------------------------------------------------------
  function renderHome(data){
    const anchor=$('#next-action');if(!anchor)return;
    let root=$('#phyto-reentry');
    const rows=[...activeReentries(data,{catalog:catalog()})].map(([parcelId,r])=>({parcel:(data.parcelles||[]).find(p=>p.id===parcelId&&!p.deletedAt),...r})).filter(r=>r.parcel);
    if(!rows.length){root?.remove();return;}
    if(!root){root=document.createElement('section');root.id='phyto-reentry';root.className='phyto-reentry';root.setAttribute('aria-label','Délais de rentrée en cours');anchor.before(root);}
    root.innerHTML=rows.map(r=>`<button type="button" class="phyto-reentry-card" data-action="open-parcel" data-id="${e(r.parcel.id)}"><span class="phyto-reentry-icon" aria-hidden="true">!</span><span><strong>${e(r.parcel.nom)} · ${e(r.label)}</strong><small>Délai de rentrée après « ${e(r.work.product||r.work.type||'traitement')} ». ${e(LABEL_REMINDER)}</small></span></button>`).join('');
  }

  // ---- Registre --------------------------------------------------------------------------------
  function openRegister(campaign=null){
    const data=store.state,campaigns=registerCampaigns(data),current=campaign&&campaigns.includes(campaign)?campaign:campaigns[0];
    const rows=registerRows(data,current,{catalog:catalog()}),done=rows.filter(r=>r.complete).length;
    modal('Registre phytosanitaire',`Campagne ${current} · ${rows.length} traitement${rows.length>1?'s':''} · ${done} complet${done>1?'s':''}`,
      `<div class="phyto-register-view"><div class="chip-choices phyto-campaigns" role="group" aria-label="Campagne">${campaigns.map(c=>`<button type="button" class="choice-chip ${c===current?'is-on':''}" aria-pressed="${c===current}" data-phyto-campaign="${e(c)}">${e(c)}</button>`).join('')}</div>
      <p class="phyto-disclaimer"><strong>Indicatif.</strong> ${e(PHYTO_DISCLAIMER)}</p>
      <ul class="phyto-register-list">${rows.map(r=>`<li><button type="button" class="phyto-register-row" data-action="edit-work" data-id="${e(r.work.id)}"><span><strong>${e(localDate(r.work.date))}${r.cells.Début?` · ${e(r.cells.Début)}`:''} · ${e(r.parcel?.nom||'Parcelle inconnue')}</strong><small>${e(r.work.product||r.work.type||'Traitement')}${r.cells.Dose!==''?` · ${e(r.cells.Dose)} ${e(r.cells.Unité)}`:''}${r.cells.Cible?` · ${e(r.cells.Cible)}`:''}${r.cells.Dérogation?' · dérogation motivée':''}</small>${r.complete?'':`<small class="phyto-missing">Manque : ${e(r.cells.Manquants)}</small>`}</span><span class="badge ${r.complete?'success':'warning'}">${r.complete?'complet':'incomplet'}</span></button></li>`).join('')||'<li class="empty-state">Aucun traitement terminé pour cette campagne.</li>'}</ul></div>`,
      `<button class="button secondary" data-action="close-modal">Fermer</button><button class="button secondary" id="phyto-register-csv">CSV</button><button class="button primary" id="phyto-register-pdf">PDF imprimable</button>`,'large');
    document.querySelectorAll('[data-phyto-campaign]').forEach(b=>b.onclick=()=>openRegister(b.dataset.phytoCampaign));
    $('#phyto-register-csv').onclick=()=>{downloadBlob(`registre-phyto-${current.replace('/','-')}.csv`,new Blob([registerCsv(registerRows(store.state,current,{catalog:catalog()}))],{type:'text/csv;charset=utf-8'}));toast('Registre CSV téléchargé.');};
    $('#phyto-register-pdf').onclick=()=>{
      const base=(()=>{try{return new URL('./',location.href).href;}catch{return'';}})();
      let win=false;try{win=openPrintableReport(registerHtml(store.state,current,{catalog:catalog(),assetBase:base}));}catch{}
      toast(win?'Registre ouvert dans un nouvel onglet : « Imprimer / PDF ».':'Registre prêt : imprimez-le ou enregistrez-le en PDF.');
    };
  }

  return{enhanceStockForm,readStockForm,enhanceWorkForm,guardWork,renderHome,openRegister};
}
