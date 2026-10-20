// n° 20 « Fin de journée chantier » : écran chargé à la demande depuis la fiche d'un chantier TP.
// Une ligne par engin, pavé numérique maison (aucun clavier système), relevé de compteur avec écart
// depuis le dernier relevé, quantité en m³ ou en tonnes, carburant, photo du bon, récapitulatif
// obligatoire avant validation, une seule écriture annulable et partage du bon au client.
import {escapeHtml,uid} from './utils.js';
import {TP_DAY_FIELDS,TP_DAY_METER_OPERATION,TP_DAY_UNITS,keypadInput,parseDecimal,planTpDay,saveTpDay,tpDayAllowed,tpDayEquipment,tpDaySaveOperations,tpDayShareText,tpDayUndoOperations,tpDayUndoScope,tpDayWriteCount,undoTpDay} from './public-works-day.js';

const esc=value=>escapeHtml(String(value??''));
const fr=value=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(value??0);
const isoToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const dateLabel=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):'';
const FIELD_LABELS={meter:'Compteur',hours:'Heures',quantity:'Quantité',fuel:'Carburant'};
const KEYS=['7','8','9','back','4','5','6','clear','1','2','3',',','0','next'];
const KEY_LABELS={back:['⌫','Effacer le dernier chiffre'],clear:['Vider','Vider la case'],next:['Suivant','Case suivante'],',':[',','Virgule']};

/** Réduit une photo lourde (bon papier) avant de la ranger ; repli : fichier d'origine. */
async function shrinkPhoto(file){
  if(!file?.type?.startsWith('image/')||file.size<1400000||typeof createImageBitmap!=='function')return file;
  try{
    const bitmap=await createImageBitmap(file),scale=Math.min(1,2000/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
    return blob&&blob.size<file.size?new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'}):file;
  }catch{return file;}
}

export function createPublicWorksDayUI({store,state,modal,closeModal,toast,onDone}){
  const $=selector=>document.querySelector(selector);
  const canWrite=chantierId=>!store.writeGuard||store.writeGuard({entity:'chantiers',action:'update',entityId:chantierId});
  // Relevé de compteur : seul le compteur de la fiche de l'engin change, ce que l'opérateur terrain peut écrire (vague 12).
  const canMeter=()=>tpDayAllowed(store.writeGuard,[TP_DAY_METER_OPERATION]);
  const canUndo=(chantierId,dayId)=>tpDayAllowed(store.writeGuard,tpDayUndoScope(state(),chantierId,dayId).operations);
  let draft=null,focus=null;

  function machineName(id){return (state().materiels||[]).find(m=>m.id===id&&!m.deletedAt)?.nom||'Engin';}
  function previousMeter(id){const n=parseDecimal((state().materiels||[]).find(m=>m.id===id)?.currentMeter);return Number.isFinite(n)?n:null;}
  const emptyRow=equipmentId=>({equipmentId,meter:'',hours:'',quantity:'',unit:'volumeM3',fuel:''});

  /** Écran de saisie. `keep` : reprend la saisie en cours (retour depuis le récapitulatif). */
  function open(chantierId,{keep=false}={}){
    const c=store.get('chantiers',chantierId);
    if(!c||c.kind!=='tp'){toast('Chantier TP introuvable.','error');return;}
    if(!canWrite(chantierId)){toast('Votre rôle ne permet pas cette saisie.','error');return;}
    const fields=canMeter()?TP_DAY_FIELDS:TP_DAY_FIELDS.filter(field=>field!=='meter');
    if(!keep||draft?.chantierId!==chantierId){
      draft={chantierId,date:isoToday(),operator:c.operator||state().preferences?.defaultOperator||'',note:'',photo:null,rows:tpDayEquipment(state(),c).map(m=>emptyRow(m.id))};
      focus=draft.rows.length?{row:0,field:fields[0]}:null;
    }
    const others=()=>(state().materiels||[]).filter(m=>!m.deletedAt&&!draft.rows.some(r=>r.equipmentId===m.id));
    const addOptions=()=>`<option value="">Ajouter un engin…</option>${others().map(m=>`<option value="${esc(m.id)}">${esc(m.nom||'Engin')}</option>`).join('')}`;
    // Le pavé se place sous la ligne de l'engin en cours : il ne masque jamais la case remplie.
    const pad=`<div class="tp-day-pad" id="tp-day-pad" role="group" aria-label="Pavé numérique" hidden><p class="tp-day-target" id="tp-day-target" aria-live="polite"></p><div class="tp-day-keys">${KEYS.map(k=>`<button type="button" class="tp-day-key${k==='next'?' primary':k==='clear'||k==='back'?' secondary':''}${k==='0'||k==='next'?' wide':''}" data-key="${k}"${KEY_LABELS[k]?` aria-label="${KEY_LABELS[k][1]}"`:''}>${KEY_LABELS[k]?.[0]??k}</button>`).join('')}</div></div>`;
    modal('Fin de journée chantier',c.type||'Chantier TP',`<section class="tp-day" id="tp-day"><div class="form-grid"><label>Date *<input id="tp-day-date" type="date" required max="${isoToday()}" value="${esc(draft.date)}"></label><label>Opérateur<input id="tp-day-operator" maxlength="200" value="${esc(draft.operator)}"></label></div><p class="form-note">Touchez une case puis tapez la valeur. ${fields.includes('meter')?'Le compteur suffit : les heures sont déduites du dernier relevé.':'Votre rôle ne permet pas de relever les compteurs des engins : saisissez les heures.'}</p><div id="tp-day-rows" class="tp-day-rows"></div><label class="field-label tp-day-add">Engin supplémentaire<select id="tp-day-add">${addOptions()}</select></label>${pad}<label class="field-label">Travaux effectués<textarea id="tp-day-note" maxlength="4000" placeholder="Décapage, déblais, évacuation…">${esc(draft.note)}</textarea></label><label class="field-label">Photo du bon (facultatif)<input id="tp-day-photo" type="file" accept="image/*" capture="environment"></label><p class="form-note" id="tp-day-photo-name"${draft.photo?'':' hidden'}>${draft.photo?`Photo jointe : ${esc(draft.photo.name)}`:''}</p><p class="form-error" id="tp-day-error" role="alert" hidden></p></section>`,`<button class="button secondary" id="tp-day-cancel">Annuler</button><button class="button primary" id="tp-day-review">Vérifier</button>`,'large');

    const rowsRoot=$('#tp-day-rows'),padEl=$('#tp-day-pad');
    const cellText=(row,field)=>{
      const raw=row[field];
      if(raw==='')return '—';
      return `${raw} ${field==='meter'||field==='hours'?'h':field==='fuel'?'L':row.unit==='tonnage'?'t':'m³'}`;
    };
    const hintFor=(row,field)=>{
      const prev=previousMeter(row.equipmentId),meter=parseDecimal(row.meter);
      if(field==='meter'){
        if(prev===null)return 'Aucun relevé connu';
        if(Number.isFinite(meter)&&meter!==null)return meter<prev?`Inférieur au relevé (${fr(prev)} h)`:`+${fr(Math.round((meter-prev)*100)/100)} h depuis ${fr(prev)} h`;
        return `Dernier relevé : ${fr(prev)} h`;
      }
      if(field==='hours'&&row.hours===''&&prev!==null&&Number.isFinite(meter)&&meter!==null&&meter>=prev)return `Déduit : ${fr(Math.round((meter-prev)*100)/100)} h`;
      return '';
    };
    const renderRows=()=>{
      rowsRoot.innerHTML=draft.rows.length?draft.rows.map((row,i)=>`<fieldset class="tp-day-row" data-row="${i}"><legend>${esc(machineName(row.equipmentId))}</legend><div class="tp-day-cells">${fields.map(field=>`<button type="button" class="tp-day-cell" data-row="${i}" data-field="${field}" aria-pressed="false"><span>${FIELD_LABELS[field]}</span><strong data-value></strong><small data-hint></small></button>`).join('')}</div><div class="tp-day-row-foot"><div class="tp-day-units" role="radiogroup" aria-label="Unité de la quantité, ${esc(machineName(row.equipmentId))}">${TP_DAY_UNITS.map(([key,label])=>`<button type="button" role="radio" class="tp-day-unit" data-row="${i}" data-unit="${key}" aria-checked="${row.unit===key}">${label}</button>`).join('')}</div><button type="button" class="button secondary tp-day-remove" data-remove-row="${i}" aria-label="Retirer ${esc(machineName(row.equipmentId))} de la saisie">Retirer</button></div></fieldset>`).join(''):'<div class="empty-state">Aucun engin rattaché à ce chantier. Ajoutez un engin ci-dessous.</div>';
      refresh();
    };
    const refresh=()=>{
      rowsRoot.querySelectorAll('.tp-day-cell').forEach(cell=>{
        const row=draft.rows[cell.dataset.row],field=cell.dataset.field,active=focus&&focus.row===Number(cell.dataset.row)&&focus.field===field;
        const hint=hintFor(row,field);
        cell.querySelector('[data-value]').textContent=cellText(row,field);
        cell.querySelector('[data-hint]').textContent=hint;
        cell.setAttribute('aria-pressed',String(Boolean(active)));
        cell.classList.toggle('is-active',Boolean(active));
        cell.setAttribute('aria-label',`${FIELD_LABELS[field]}, ${machineName(row.equipmentId)} : ${row[field]===''?'vide':cellText(row,field)}${hint?`. ${hint}`:''}`);
      });
      rowsRoot.querySelectorAll('.tp-day-unit').forEach(b=>b.setAttribute('aria-checked',String(draft.rows[b.dataset.row].unit===b.dataset.unit)));
      const host=focus&&rowsRoot.querySelector(`.tp-day-row[data-row="${focus.row}"]`);
      padEl.hidden=!host;
      if(host&&padEl.parentNode!==host)host.append(padEl);
      padEl.querySelector('#tp-day-target').textContent=host?`${machineName(draft.rows[focus.row].equipmentId)} · ${FIELD_LABELS[focus.field]}`:'';
    };
    const select=(row,field,{moveFocus=true}={})=>{
      focus={row,field};refresh();
      if(moveFocus)rowsRoot.querySelector(`.tp-day-cell[data-row="${row}"][data-field="${field}"]`)?.focus({preventScroll:true});
      padEl.scrollIntoView?.({block:'nearest'});
    };
    const next=()=>{
      if(!focus)return;
      const order=fields;let {row,field}=focus,index=order.indexOf(field)+1;
      // Compteur saisi et relevé connu : les heures sont déduites, on passe à la quantité.
      if(order[index]==='hours'&&draft.rows[row].hours===''&&parseDecimal(draft.rows[row].meter)!==null&&previousMeter(draft.rows[row].equipmentId)!==null)index++;
      if(index>=order.length){row++;index=0;}
      if(row>=draft.rows.length){focus=null;refresh();$('#tp-day-note')?.focus();return;}
      select(row,order[index]);
    };
    const press=key=>{
      if(key==='next')return next();
      if(!focus)return;
      const row=draft.rows[focus.row];if(!row)return;
      row[focus.field]=keypadInput(row[focus.field],key,{maxDecimals:focus.field==='meter'?1:2});
      refresh();
    };
    const sync=()=>{draft.date=$('#tp-day-date').value;draft.operator=$('#tp-day-operator').value;draft.note=$('#tp-day-note').value;};

    rowsRoot.addEventListener('click',event=>{
      const cell=event.target.closest('.tp-day-cell');if(cell)return select(Number(cell.dataset.row),cell.dataset.field,{moveFocus:false});
      const unit=event.target.closest('.tp-day-unit');if(unit){draft.rows[unit.dataset.row].unit=unit.dataset.unit;return refresh();}
      const remove=event.target.closest('[data-remove-row]');
      if(remove){draft.rows.splice(Number(remove.dataset.removeRow),1);focus=draft.rows.length?{row:0,field:fields[0]}:null;$('#tp-day-add').innerHTML=addOptions();renderRows();}
    });
    // Clavier physique (ordinateur) : chiffres, virgule, retour arrière, Entrée = suivant ; flèches entre unités.
    $('#tp-day').addEventListener('keydown',event=>{
      if(event.target.closest('.tp-day-unit')&&['ArrowLeft','ArrowRight'].includes(event.key)){
        const b=event.target.closest('.tp-day-unit'),row=draft.rows[b.dataset.row],keys=TP_DAY_UNITS.map(([k])=>k);
        row.unit=keys[(keys.indexOf(row.unit)+1)%keys.length];refresh();
        rowsRoot.querySelector(`.tp-day-unit[data-row="${b.dataset.row}"][data-unit="${row.unit}"]`)?.focus();event.preventDefault();return;
      }
      if(!event.target.closest('.tp-day-cell,.tp-day-key')||event.ctrlKey||event.metaKey||event.altKey)return;
      const key=/^\d$/.test(event.key)?event.key:[',','.'].includes(event.key)?',':event.key==='Backspace'?'back':event.key==='Delete'?'clear':event.key==='Enter'&&event.target.closest('.tp-day-cell')?'next':null;
      if(!key)return;
      event.preventDefault();press(key);
    });
    padEl.querySelector('.tp-day-keys').addEventListener('click',event=>{const b=event.target.closest('[data-key]');if(b)press(b.dataset.key);});
    $('#tp-day-add').addEventListener('change',event=>{
      const id=event.target.value;if(!id)return;
      draft.rows.push(emptyRow(id));event.target.innerHTML=addOptions();renderRows();select(draft.rows.length-1,fields[0]);
    });
    $('#tp-day-photo').addEventListener('change',event=>{
      draft.photo=event.target.files?.[0]||null;
      const label=$('#tp-day-photo-name');label.hidden=!draft.photo;label.textContent=draft.photo?`Photo jointe : ${draft.photo.name}`:'';
    });
    $('#tp-day-cancel').addEventListener('click',()=>{draft=null;onDone?.(chantierId);});
    $('#tp-day-review').addEventListener('click',()=>{
      sync();
      const plan=planTpDay(state(),store.get('chantiers',chantierId),draft,{today:isoToday()});
      // Droits contrôlés dès la vérification (pleins, photo, compteurs) plutôt qu'à la validation.
      if(plan.ready&&!tpDayAllowed(store.writeGuard,tpDaySaveOperations(chantierId,tpDayWriteCount(plan,{photo:Boolean(draft.photo)}))))plan.errors.push('Votre rôle ne permet pas d’enregistrer cette saisie (compteur, carburant ou photo) : retirez la donnée concernée.');
      if(plan.errors.length){const error=$('#tp-day-error');error.textContent=plan.errors.join(' ');error.hidden=false;error.scrollIntoView?.({block:'nearest'});return;}
      review(chantierId,plan);
    });
    renderRows();
  }

  /** Récapitulatif obligatoire (données de facturation) avant l'écriture groupée. */
  function review(chantierId,plan){
    const c=store.get('chantiers',chantierId),count=tpDayWriteCount(plan,{photo:Boolean(draft.photo)}),undoable=tpDayAllowed(store.writeGuard,tpDayUndoOperations(chantierId,count));
    const cell=(value,unit)=>value===null||value===undefined?'—':`${fr(value)} ${unit}`;
    const rows=plan.entries.map(e=>{
      const parts=[e.meterEnd!==null?`Compteur ${e.meterStart!==null?`${fr(e.meterStart)} → `:''}${fr(e.meterEnd)} h`:'',e.hours!==null?`${cell(e.hours,'h')}${e.hoursFromMeter?' (écart de compteur)':''}`:'',e.volumeM3!==null?cell(e.volumeM3,'m³'):'',e.tonnage!==null?cell(e.tonnage,'t'):'',e.fuelLiters!==null?`${cell(e.fuelLiters,'L')} de carburant`:''].filter(Boolean);
      return `<li><strong>${esc(e.name)}</strong><span>${esc(parts.join(' · '))}</span></li>`;
    }).join('');
    const t=plan.totals,writes=[`${count.logs} ligne${count.logs>1?'s':''} de journal`,count.meters?`${count.meters} compteur${count.meters>1?'s':''} mis à jour`:'',count.fuels?`${count.fuels} plein${count.fuels>1?'s':''} de carburant`:'',count.photo?'la photo du bon':''].filter(Boolean);
    modal('Récapitulatif de la journée',`${c?.type||'Chantier TP'} · ${dateLabel(plan.date)}`,`<section class="tp-day-review"><div class="tp-metrics"><div><strong>${fr(t.hours)}</strong><span>heures</span></div><div><strong>${fr(t.volumeM3)}</strong><span>m³</span></div><div><strong>${fr(t.tonnage)}</strong><span>tonnes</span></div></div><ul class="tp-day-recap" aria-label="Détail par engin">${rows}</ul>${t.fuelLiters?`<p class="form-note">Carburant : ${fr(t.fuelLiters)} L${t.fuelAmount!==null?` · environ ${fr(t.fuelAmount)} €`:''} (donnée interne, absente du bon client).</p>`:''}${plan.operator?`<p class="form-note">Opérateur : ${esc(plan.operator)}</p>`:''}${plan.note?`<p class="tp-note">${esc(plan.note)}</p>`:''}${plan.warnings.length?`<div class="notice warning" role="status"><strong>À vérifier</strong><ul>${plan.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`:''}<p class="form-note">La validation enregistre en une fois : ${esc(writes.join(', '))}. ${undoable?'Elle reste annulable.':'Votre rôle ne permettra pas de l’annuler : seul un responsable pourra la retirer.'}</p><p class="form-error" id="tp-day-save-error" role="alert" hidden></p></section>`,`<button class="button secondary" id="tp-day-edit">Corriger</button><button class="button primary" id="tp-day-confirm" data-autofocus>Valider la journée</button>`,'large');
    $('#tp-day-edit').addEventListener('click',()=>open(chantierId,{keep:true}));
    $('#tp-day-confirm').addEventListener('click',async event=>{
      const button=event.currentTarget;if(button.disabled)return;button.disabled=true;
      let bon=null;
      try{
        if(draft.photo){
          const file=await shrinkPhoto(draft.photo),id=uid('doc');
          await store.storage.blobPut(id,file);
          bon={id,name:file.name||'bon-de-chantier.jpg',mimeType:file.type||'image/jpeg',size:file.size,originalSize:draft.photo.size,note:'Bon de fin de journée',tags:['bon de chantier'],capturedAt:Date.now()};
        }
        const result=await saveTpDay(store,chantierId,{date:plan.date,operator:plan.operator,note:plan.note,rows:draft.rows},{expected:plan,document:bon,today:isoToday()});
        const photo=draft.photo;draft=null;
        toast(`Fin de journée enregistrée : ${result.count.logs} engin${result.count.logs>1?'s':''}.`,'success',canUndo(chantierId,result.dayId)?{label:'Annuler',run:()=>undo(chantierId,result.dayId)}:undefined);
        done(chantierId,result,photo&&bon?{file:photo,name:bon.name}:null);
      }catch(error){
        if(bon)await store.storage.blobDelete?.(bon.id).catch(()=>{});
        if(button.isConnected){const target=$('#tp-day-save-error');target.textContent=error.message||'Enregistrement impossible.';target.hidden=false;button.disabled=false;}
        toast(error.message||'Enregistrement impossible.','error');
      }
    });
  }

  function done(chantierId,result,photo){
    const c=store.get('chantiers',chantierId),client=c?.clientId?(state().clients||[]).find(x=>x.id===c.clientId):null;
    const text=tpDayShareText(result.plan,{chantier:c,clientName:client?.name||'',farmName:state().exploitation?.name||''});
    modal('Journée enregistrée',`${c?.type||'Chantier TP'} · ${dateLabel(result.plan.date)}`,`<section class="tp-day-done"><p>Les heures, quantités${result.count.fuels?', pleins':''}${result.count.photo?' et la photo du bon':''} sont enregistrés. Vous pouvez envoyer le bon au client (sans le carburant).</p><pre class="tp-day-share" tabindex="0" aria-label="Aperçu du bon">${esc(text)}</pre></section>`,`${canUndo(chantierId,result.dayId)?'<button class="button secondary" id="tp-day-undo">Annuler la journée</button>':''}<button class="button secondary" id="tp-day-share">Partager le bon</button><button class="button primary" id="tp-day-close" data-autofocus>Terminé</button>`,'large');
    $('#tp-day-close').addEventListener('click',()=>onDone?.(chantierId));
    $('#tp-day-undo')?.addEventListener('click',()=>undo(chantierId,result.dayId));
    $('#tp-day-share').addEventListener('click',()=>share(c?.type||'Bon de chantier',text,photo));
  }

  async function share(title,text,photo){
    const file=photo?.file?new File([photo.file],photo.name||photo.file.name,{type:photo.file.type||'image/jpeg'}):null;
    if(typeof navigator.share==='function'){
      try{const files=file&&navigator.canShare?.({files:[file]})?[file]:undefined;await navigator.share({title,text,files});return;}
      catch(error){if(error?.name==='AbortError')return;}
    }
    try{await navigator.clipboard.writeText(text);toast('Bon copié dans le presse-papiers.');}
    catch{toast('Partage et copie indisponibles sur ce navigateur.','error');}
  }

  async function undo(chantierId,dayId){
    try{
      const r=await undoTpDay(store,chantierId,dayId);
      toast(`Fin de journée annulée : ${r.logs} ligne${r.logs>1?'s':''}${r.fuels?`, ${r.fuels} plein${r.fuels>1?'s':''}`:''}${r.documents?', photo à la corbeille':''}.`);
      // Écran du chantier ou de la journée encore ouvert : on le rafraîchit.
      if(document.querySelector('#tp-day-undo,#tp-confirm-undo-day,#tp-day-open'))onDone?.(chantierId);
    }catch(error){
      toast(error.message||'Annulation impossible.','error');
      const button=$('#tp-confirm-undo-day');if(button)button.disabled=false;
    }
  }

  return {open,undo,canWrite,canUndo};
}
