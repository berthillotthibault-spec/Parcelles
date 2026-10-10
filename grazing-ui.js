import {validateForm} from './form-chips-ui.js';
import {escapeHtml,localDate} from './utils.js';
const formatNumber=(value,digits=2)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:digits}).format(Number(value)||0);
import {fieldGrazingSummary,countGap,grazingCheckObservation,grazingDate,grazingAnimalList,grazingAnimalText,grazingTotal,grazingType,grazingStatus,filterGrazingSessions,summarizeParcelGrazing,parseGrazingAnimals,ugbTable,ugbOf,stockingRate,restLabel,farmGrazingBalance} from './grazing.js';
import {grazingTimeline} from './charts.js';
import {saveGrazingSession,endGrazingSession,grazingReentryAlert,moveGrazingLot,updateGrazingCount} from './grazing-records.js';

const labels={current:'Au pré',planned:'Prévu',ended:'Sorti',invalid:'Dates à vérifier'};
const animalLabel=animal=>[animal.number,animal.name].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · ')||'Animal sans numéro';
function animalHtml(animal){return `<li>${escapeHtml(animalLabel(animal))}${animal.gestation?' <span class="badge success">Gestante</span>':''}</li>`;}
// n° 62 — délai de rentrée : premier clic = alerte sous le formulaire, second clic = confirmation.
function reentryGate(store,form,button,parcelId,startDate){
  const alert=grazingReentryAlert(store.state,parcelId,startDate),key=`${parcelId}|${startDate}`;
  form.querySelector('.phyto-dre-alert')?.remove();
  if(!alert||button.dataset.dreAck===key)return true;
  button.dataset.dreAck=key;
  const note=document.createElement('p');note.className='notice warning phyto-dre-alert span-2';note.setAttribute('role','alert');
  note.textContent=`${alert.message} Touchez à nouveau le bouton pour confirmer.`;form.append(note);note.scrollIntoView?.({block:'nearest'});
  return false;
}
// n° 78 — chargement instantané, cumul de la saison et repos de la parcelle.
const n1=v=>formatNumber(v,1);
export function stockingHtml(state,parcelId,{date=new Date(),compact=false}={}){
  if(!state)return '';
  const rate=stockingRate(state,parcelId,{date});
  if(!rate.grazed&&!rate.seasonUgbDays&&rate.restDays===null)return '';
  const parts=[];
  if(rate.grazed)parts.push(rate.instant!==null?`${n1(rate.instant)} UGB/ha`:`${n1(rate.ugb)} UGB (surface inconnue)`);
  if(rate.seasonPerHa!==null&&rate.seasonUgbDays)parts.push(`${formatNumber(rate.seasonPerHa,0)} j UGB/ha depuis le 1er janvier`);
  const rest=restLabel(rate);
  const warn=rate.unknownCategory?'<small class="grazing-ugb-warn">Catégorie non renseignée : 1 UGB par animal.</small>':'';
  if(compact)return `<small class="grazing-stocking">${escapeHtml([...parts,rest].filter(Boolean).join(' · '))}</small>`;
  return `<div class="grazing-stocking-panel" data-stocking="${escapeHtml(parcelId)}">${rate.grazed?`<div><small>Chargement instantané</small><strong>${escapeHtml(parts[0])}</strong></div>`:''}${rate.seasonPerHa!==null&&rate.seasonUgbDays?`<div><small>Cumul de la saison</small><strong>${escapeHtml(formatNumber(rate.seasonPerHa,0))} j UGB/ha</strong></div>`:''}${rest?`<div class="${rate.rested?'is-rested':'is-resting'}"><small>Repos</small><strong>${escapeHtml(rest)}</strong></div>`:''}${warn}</div>`;
}
export function parcelGrazingHtml(sessions,parcelId,{compact=false,date=new Date(),state=null}={}){
  const summary=summarizeParcelGrazing(sessions,parcelId,{date});
  const title=summary.total?`${formatNumber(summary.total,0)} ${summary.total===1?'animal':'animaux'} au pré`:'Aucun animal au pré';
  if(compact){
    const names=summary.animals.slice(0,4).map(animalLabel);
    if(summary.animals.length>4)names.push(`+ ${summary.animals.length-4} autres identifiés`);
    if(summary.unidentifiedCount)names.push(`${summary.unidentifiedCount} sans numéro`);
    return `<div class="grazing-map-summary"><strong>${escapeHtml(title)}</strong>${names.length?`<small>${escapeHtml(names.join(' · '))}</small>`:''}${stockingHtml(state,parcelId,{date,compact:true})}<button type="button" class="text-button" data-action="open-grazing-parcel" data-id="${escapeHtml(parcelId)}">${summary.total?'Voir les animaux':'Mettre au pré'}</button></div>`;
  }
  return `<section class="panel parcel-grazing" data-parcel-grazing="${escapeHtml(parcelId)}"><div class="panel-heading"><h2>${escapeHtml(title)}</h2><button class="text-button" data-action="open-grazing-parcel" data-id="${escapeHtml(parcelId)}">Gérer le pâturage</button></div>${stockingHtml(state,parcelId,{date})}${summary.groups.map(group=>{const days=group.startDate?Math.max(0,Math.floor((new Date(grazingDate(date)+'T12:00:00')-new Date(String(group.startDate).slice(0,10)+'T12:00:00'))/86400000)):null;return `<article class="grazing-group grazing-lot"><div class="grazing-lot-head"><div><p class="eyebrow">Animaux au pré</p><strong>${escapeHtml(group.type)} · ${formatNumber(group.total,0)} ${group.total===1?'animal':'animaux'}</strong></div>${days!==null?`<span class="grazing-days">${days} j</span>`:''}</div>${group.note?`<p>${escapeHtml(group.note)}</p>`:''}${group.animals.length?`<ul class="grazing-animals">${group.animals.map(animalHtml).join('')}</ul>`:''}${group.animalDescription?`<p>${escapeHtml(group.animalDescription)}</p>`:''}${group.unidentifiedCount?`<p class="form-note">${group.unidentifiedCount} ${(group.unidentifiedCount)>1?'animaux':'animal'} sans numéro enregistré.</p>`:''}<small>Entrés le ${group.startDate?localDate(group.startDate):'(date non renseignée)'}</small><div class="grazing-lot-actions"><button type="button" class="button primary" data-action="move-grazing" data-id="${escapeHtml(group.id)}">Déplacer le lot</button><button type="button" class="button secondary" data-action="end-grazing" data-id="${escapeHtml(group.id)}">Sortir</button></div></article>`;}).join('')||`<div class="empty-state">Pas d’animaux sur cette parcelle.<br><button type="button" class="text-button" data-action="open-grazing-parcel" data-id="${escapeHtml(parcelId)}">Mettre au pré</button></div>`}</section>`;
}

export function createGrazingUI({store,state,modal,closeModal,toast,savedToast=null,formDraft=null,confirmDelete,today}){
  let filters={status:'current',parcelId:'',animalType:'',gestation:'all',query:''};
  const $=selector=>document.querySelector(selector);
  const active=key=>(state()[key]||[]).filter(row=>!row.deletedAt);
  function openList({parcelId='',reset=true}={}){
    if(reset)filters={status:'current',parcelId,animalType:'',gestation:'all',query:''};
    const parcels=active('parcelles'),types=[...new Set(active('grazingSessions').map(grazingType))].sort((a,b)=>a.localeCompare(b,'fr'));
    modal('Animaux au pré','Retrouvez les animaux, les lots et leurs parcelles.',`<form id="grazing-filters" class="form-grid"><label>Présence<select name="status">${[['current','Au pré aujourd’hui'],['planned','Entrées prévues'],['ended','Lots sortis'],['all','Tous les lots']].map(([value,label])=>`<option value="${value}" ${filters.status===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Parcelle<select name="parcelId"><option value="">Toutes les parcelles</option>${parcels.map(p=>`<option value="${escapeHtml(p.id)}" ${filters.parcelId===p.id?'selected':''}>${escapeHtml(p.nom)}</option>`).join('')}</select></label><label>Type d’animaux<select name="animalType"><option value="">Tous les types</option>${types.map(type=>`<option value="${escapeHtml(type)}" ${filters.animalType===type?'selected':''}>${escapeHtml(type)}</option>`).join('')}</select></label><label>Composition du lot<select name="gestation"><option value="all">Tous les animaux</option><option value="yes" ${filters.gestation==='yes'?'selected':''}>Avec animaux gestants</option><option value="no" ${filters.gestation==='no'?'selected':''}>Avec animaux identifiés non gestants</option></select></label><label class="span-2">Rechercher un numéro, un nom ou un lot<input name="query" type="search" value="${escapeHtml(filters.query)}" placeholder="FR…, génisses, lot…"></label></form><p id="grazing-counter" aria-live="polite"></p><div id="grazing-results" class="stack-list"></div>`,`<button class="button secondary" data-action="close-modal">Fermer</button><button class="button secondary" id="grazing-balance">Bilan de pâturage</button><button class="button primary" id="grazing-add">Mettre au pré</button>`,'large');
    const form=$('#grazing-filters');
    const update=()=>{filters={...filters,...Object.fromEntries(new FormData(form))};renderList();};
    form.onchange=update;form.querySelector('[name="query"]').oninput=update;form.onsubmit=event=>event.preventDefault();
    $('#grazing-add').onclick=()=>openForm(null,{parcelId:filters.parcelId});$('#grazing-balance').onclick=()=>openBalance();renderList();
  }
  function renderList(){
    const data=state(),parcels=new Map(active('parcelles').map(p=>[p.id,p]));
    const rows=filterGrazingSessions(data.grazingSessions||[],{...filters,parcels:active('parcelles'),date:today()});
    const total=rows.reduce((sum,row)=>sum+grazingTotal(row),0);
    $('#grazing-counter').textContent=`${formatNumber(total,0)} ${total>1?'animaux':'animal'} dans ${rows.length} lot${rows.length>1?'s':''} affiché${rows.length>1?'s':''}`;
    $('#grazing-results').innerHTML=rows.length?rows.map(row=>{
      const animals=grazingAnimalList(row),unknown=Math.max(0,grazingTotal(row)-animals.length),status=grazingStatus(row,{date:today()});
      return `<article class="grazing-group" data-grazing-id="${escapeHtml(row.id)}"><div class="grazing-heading"><div><strong>${escapeHtml(parcels.get(row.parcelId)?.nom||'Parcelle indisponible')}</strong><p>${grazingTotal(row)} ${grazingTotal(row)>1?'animaux':'animal'} · ${escapeHtml(grazingType(row))} · ${(u=>`${formatNumber(u.ugb,1)} UGB${u.known?'':' (catégorie à préciser)'}`)(ugbOf(row,ugbTable(data)))}</p></div><span class="badge ${status==='current'?'success':'info'}">${labels[status]||'À vérifier'}</span></div>${row.note?`<p>${escapeHtml(row.note)}</p>`:''}${animals.length?`<ul class="grazing-animals">${animals.map(animalHtml).join('')}</ul>`:typeof row.animals==='string'&&row.animals?`<p>${escapeHtml(row.animals)}</p>`:''}${unknown?`<p class="form-note">${unknown} ${unknown>1?'animaux':'animal'} sans numéro ${unknown>1?'enregistrés':'enregistré'}.</p>`:''}<p class="form-note">Entrée : ${row.startDate?localDate(row.startDate):'non renseignée'}${row.endDate?` · Sortie : ${localDate(row.endDate)}`:''}</p><div class="grazing-actions"><button type="button" class="small-button" data-grazing-edit="${escapeHtml(row.id)}">Modifier</button>${status==='current'?`<button type="button" class="small-button" data-grazing-exit="${escapeHtml(row.id)}">Sortir du pré</button>`:''}</div></article>`;
    }).join(''):'<div class="empty-state">Aucun lot ne correspond aux filtres.</div>';
    $('#grazing-results').querySelectorAll('[data-grazing-edit]').forEach(button=>button.onclick=()=>openForm(store.get('grazingSessions',button.dataset.grazingEdit)));
    $('#grazing-results').querySelectorAll('[data-grazing-exit]').forEach(button=>button.onclick=async()=>{
      if(button.disabled)return;button.disabled=true;
      try{await endGrazingSession(store,button.dataset.grazingExit,{date:today()});if(button.isConnected)renderList();toast('Sortie du pré enregistrée.');}
      catch(error){button.disabled=false;toast(error.message,'error');}
    });
  }
  function openForm(session=null,{parcelId=''}={}){
    session=session?structuredClone(session):null;
    const parcels=active('parcelles');if(!parcels.length)return toast('Ajoutez d’abord une parcelle.','error');
    const row=session||{parcelId:parcelId||parcels[0].id,startDate:today(),animals:[],additionalAnimalsCount:0,animalType:'Bovins',note:''};
    const text=grazingAnimalText(row),unknown=Math.max(0,grazingTotal(row)-grazingAnimalList(row).length);
    modal(session?'Modifier le pâturage':'Mettre au pré','Une ligne par numéro ou nom. Ajoutez « | gestante » si nécessaire.',`<form id="grazing-form" class="form-grid"><label>Parcelle<select name="parcelId" required>${parcels.map(p=>`<option value="${escapeHtml(p.id)}" ${row.parcelId===p.id?'selected':''}>${escapeHtml(p.nom)}</option>`).join('')}</select></label><label>Type d’animaux<input name="animalType" list="grazing-animal-types" value="${escapeHtml(grazingType(row))}" placeholder="Bovins, ovins, chevaux…"><datalist id="grazing-animal-types"><option>Bovins</option><option>Ovins</option><option>Caprins</option><option>Chevaux</option></datalist></label><label>Catégorie (chargement UGB)<select name="animalCategory"><option value="">Non précisée (1 UGB par animal)</option>${ugbTable(state()).categories.map(c=>`<option value="${escapeHtml(c.key)}" ${row.animalCategory===c.key?'selected':''}>${escapeHtml(c.label)} · ${formatNumber(c.ugb,2)} UGB</option>`).join('')}</select></label><label>Date d’entrée<input name="startDate" required type="date" value="${escapeHtml(row.startDate||today())}"></label><label>Date de sortie (facultative)<input name="endDate" type="date" value="${escapeHtml(row.endDate||'')}"></label><label class="span-2">Numéros ou noms des animaux<textarea name="animals" rows="6" placeholder="FR1234567890&#10;FR1234567891 | gestante">${escapeHtml(text)}</textarea></label><label>Animaux sans numéro<input name="additionalAnimalsCount" type="number" required min="0" step="1" value="${unknown}"></label><label>Lot / commentaire<input name="note" value="${escapeHtml(row.note||'')}"></label></form>`,`<button class="button secondary" id="grazing-back">Retour</button>${session?'<button class="button danger" id="delete-grazing">Supprimer</button>':''}<button class="button primary" id="save-grazing">Enregistrer</button>`,'large');
    $('#grazing-back').onclick=()=>openList({reset:false});
    $('#delete-grazing')?.addEventListener('click',()=>confirmDelete('grazingSessions',row.id,'cette session de pâturage'));
    const form=$('#grazing-form'),button=$('#save-grazing');
    const draft=formDraft?.(form,session?row.id:null);
    if(!parcels.some(parcel=>parcel.id===row.parcelId)){
      const option=document.createElement('option');option.value='';option.textContent='Parcelle indisponible — choisir une parcelle';option.selected=true;
      form.querySelector('[name="parcelId"]').prepend(option);
    }
    button.onclick=async()=>{
      if(button.disabled||!validateForm(form))return;
      const values=Object.fromEntries(new FormData(form));
      try{
        if(values.endDate&&values.endDate<values.startDate)throw new Error('La sortie doit être postérieure ou égale à l’entrée.');
        if(!active('parcelles').some(p=>p.id===values.parcelId))throw new Error('La parcelle n’est plus disponible.');
        if((!session||values.parcelId!==row.parcelId||values.startDate!==String(row.startDate||'').slice(0,10))&&!reentryGate(store,form,button,values.parcelId,values.startDate))return;
        const additionalAnimalsCount=Number(values.additionalAnimalsCount);
        if(!Number.isSafeInteger(additionalAnimalsCount)||additionalAnimalsCount<0)throw new Error('Indiquez un nombre entier d’animaux sans numéro.');
        const unchanged=values.animals===text;
        const animals=unchanged&&session&&row.animals!=null?row.animals:parseGrazingAnimals(values.animals).map(animal=>{
          const previous=grazingAnimalList(row).find(old=>String(old.number||old.name).trim()===animal.number);
          return previous?{...previous,gestation:animal.gestation}:animal;
        });
        const count=Array.isArray(animals)?grazingAnimalList({animals}).length:0;
        if(count+additionalAnimalsCount===0)throw new Error('Ajoutez au moins un animal ou un effectif sans numéro.');
        button.disabled=true;
        if(session&&!store.get('grazingSessions',row.id))throw new Error('Ce lot n’est plus disponible.');
        await saveGrazingSession(store,{parcelId:values.parcelId,animalType:values.animalType.trim()||'Non précisé',animalCategory:values.animalCategory||null,startDate:values.startDate,endDate:values.endDate||null,animals,additionalAnimalsCount,note:values.note},{id:session?row.id:null,expected:session});
        draft?.clear();
        if(form.isConnected)openList({reset:false});(savedToast||toast)('Pâturage enregistré.');
      }catch(error){button.disabled=false;toast(error.message,'error');}
    };
  }
  function openMove(session){
    const parcels=active('parcelles').filter(p=>p.id!==session.parcelId);
    if(!parcels.length)return toast('Ajoutez une autre parcelle pour déplacer ce lot.','error');
    const from=active('parcelles').find(p=>p.id===session.parcelId),total=grazingTotal(session);
    modal('Déplacer le lot',`${formatNumber(total,0)} ${total>1?'animaux':'animal'} · ${escapeHtml(grazingType(session))}${from?` · depuis ${escapeHtml(from.nom)}`:''}. Le passage actuel est clos et un nouveau passage commence.`,`<form id="grazing-move-form" class="form-grid"><label>Vers la parcelle *<select name="parcelId" required>${parcels.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.nom)}</option>`).join('')}</select></label><label>Date du déplacement *<input name="date" type="date" required value="${today()}" min="${escapeHtml(String(session.startDate||'').slice(0,10))}" max="${today()}"></label></form><p class="form-error" id="grazing-move-error" role="alert" hidden></p>`,`<button type="button" class="button secondary" data-action="close-modal">Annuler</button><button type="button" class="button primary" id="save-grazing-move">Déplacer</button>`);
    const form=$('#grazing-move-form'),button=$('#save-grazing-move'),error=$('#grazing-move-error');
    button.onclick=async()=>{
      if(button.disabled)return;
      const values=Object.fromEntries(new FormData(form));
      if(!values.parcelId||!values.date){error.textContent=`Champ obligatoire : ${!values.parcelId?'Vers la parcelle':'Date du déplacement'}.`;error.hidden=false;return;}
      if(!reentryGate(store,form,button,values.parcelId,values.date))return;
      button.disabled=true;
      try{
        await moveGrazingLot(store,session,values.parcelId,{date:values.date});
        closeModal();(savedToast||toast)(`Lot déplacé vers ${active('parcelles').find(p=>p.id===values.parcelId)?.nom||'la parcelle'}.`);
      }catch(failure){button.disabled=false;error.textContent=failure.message;error.hidden=false;}
    };
  }
  // n° 78 — bilan de l’exploitation : chargement moyen sur la SFP, présence par lot, azote, Gantt.
  function openBalance({year=null}={}){
    const data=state(),b=farmGrazingBalance(data,{date:today(),year}),table=b.table,width=Math.max(300,Math.min(860,(document.querySelector('#modal-root .modal-body')?.clientWidth||360)-40));
    const lots=b.lots.map(lot=>`<div class="list-row"><div><strong>${escapeHtml(lot.label)}</strong><small>${lot.passages} passage${lot.passages>1?'s':''} · ${lot.parcels} parcelle${lot.parcels>1?'s':''} · ${formatNumber(lot.ugbDays,0)} j UGB</small></div><strong>${lot.days} j</strong></div>`).join('');
    const gantt=b.lots.length?grazingTimeline(b.lots.map(lot=>({label:lot.label,sessions:lot.sessions})),{from:b.from,to:`${b.year}-12-31`,today:b.to,width,labelWidth:Math.min(130,Math.round(width*.3))}):'';
    const coef=table.categories.map(c=>`<label>${escapeHtml(c.label)}<input name="${escapeHtml(c.key)}" type="number" inputmode="decimal" min="0.05" max="3" step="0.05" value="${c.ugb}"><small>Référence ${formatNumber(c.reference,2)} UGB · ${c.nPerYear} kg N/an</small></label>`).join('');
    modal('Bilan de pâturage',`Année ${b.year}, arrêtée au ${localDate(b.to)}.`,`<div class="preview-summary grazing-balance-kpis"><div class="preview-stat"><strong>${b.meanStocking===null?'—':`${formatNumber(b.meanStocking,2)}`}</strong><small>UGB/ha SFP en moyenne annuelle</small></div><div class="preview-stat"><strong>${formatNumber(b.sfp,1)} ha</strong><small>SFP (${b.sfpParcels} parcelle${b.sfpParcels>1?'s':''})</small></div><div class="preview-stat"><strong>${formatNumber(b.ugbDays,0)}</strong><small>jours UGB</small></div><div class="preview-stat"><strong>${formatNumber(b.nitrogen,0)} kg N</strong><small>azote organique déposé au pâturage</small></div></div>${b.unknownCategory?`<p class="notice warning">${b.unknownCategory} passage${b.unknownCategory>1?'s':''} sans catégorie d’animaux : comptés à 1 UGB par animal. Précisez la catégorie dans le lot.</p>`:''}<h3>Passages sur la saison</h3>${gantt?`<div class="chart-panel grazing-gantt">${gantt}</div>`:'<div class="empty-state">Aucun passage cette année.</div>'}<h3>Temps de présence au pré par lot</h3><div class="stack-list">${lots||'<div class="empty-state">Aucun lot au pré cette année.</div>'}</div><details class="grazing-ugb-table"><summary>Coefficients UGB (à vérifier)</summary><form id="ugb-form" class="form-grid">${coef}</form><p class="form-note">Table ${escapeHtml(table.version)} du ${localDate(table.date)}. Source : ${escapeHtml(table.source)} ${escapeHtml(table.verify)}</p><button type="button" class="button secondary" id="save-ugb">Enregistrer les coefficients</button></details><p class="form-note">Calcul indicatif. La SFP regroupe les prairies, cultures fourragères et parcelles pâturées. L’azote déposé au pâturage est ajouté au plafond de 170 kg N/ha SAU dans l’écran Azote.</p>`,`<button type="button" class="button secondary" data-action="close-modal">Fermer</button><button type="button" class="button primary" id="grazing-balance-back">Liste des lots</button>`,'large');
    $('#grazing-balance-back').onclick=()=>openList({reset:false});
    $('#save-ugb').onclick=async()=>{
      const form=$('#ugb-form');if(!validateForm(form))return;
      const values=Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,Number(String(v).replace(',','.'))]).filter(([,v])=>Number.isFinite(v)&&v>0&&v<=3));
      try{await store.setPreferences({ugbCoefficients:values});toast('Coefficients UGB enregistrés.');openBalance({year});}catch(error){toast(error.message,'error');}
    };
  }
  // n° 77 — carte « pâturage en un geste » du mode terrain (GPS dans une prairie).
  function fieldCard(root,parcelId,{gps=null,onChange=null}={}){
    if(!root)return false;
    const info=fieldGrazingSummary(state(),parcelId,{date:today()});
    if(!info.pasture){root.innerHTML='';root.hidden=true;return false;}
    root.hidden=false;
    let counter=info.known,mode='';
    const lots=(list,attr)=>list.map(l=>`<button type="button" class="chip field-grazing-lot" ${attr}="${escapeHtml(l.id)}">${escapeHtml(l.label)}<small>${escapeHtml(attr==='data-fg-bring'?`${l.parcelName} · ${l.total}`:`${l.total} · ${l.days??'?'} j`)}</small></button>`).join('');
    const render=()=>{
      const gap=countGap(info.known,counter);
      root.innerHTML=`<article class="panel field-grazing-card" aria-live="polite"><p class="eyebrow">Pâturage</p><h2>${escapeHtml(info.headline)}</h2><div class="field-grazing-actions"><button type="button" class="field-grazing-big ${mode==='bring'?'is-active':''}" data-fg-mode="bring" aria-expanded="${mode==='bring'}">Amener un lot ici</button><button type="button" class="field-grazing-big ${mode==='exit'?'is-active':''}" data-fg-mode="exit" aria-expanded="${mode==='exit'}" ${info.here.length?'':'disabled'}>Sortir le lot</button><button type="button" class="field-grazing-big ${mode==='count'?'is-active':''}" data-fg-mode="count" aria-expanded="${mode==='count'}" ${info.here.length?'':'disabled'}>Compter</button></div>
${mode==='bring'?`<div class="field-grazing-panel"><p class="form-note">Lot à amener sur ${escapeHtml(info.parcel.nom)} aujourd’hui :</p><div class="chip-row">${lots(info.elsewhere,'data-fg-bring')||'<span class="form-note">Aucun lot au pré ailleurs. Utilisez « Mettre au pré » depuis la fiche.</span>'}</div><p class="form-error field-grazing-alert" role="alert" hidden></p></div>`:''}
${mode==='exit'?`<div class="field-grazing-panel"><p class="form-note">Lot à sortir aujourd’hui :</p><div class="chip-row">${lots(info.here,'data-fg-exit')}</div></div>`:''}
${mode==='count'?`<div class="field-grazing-panel field-grazing-counter"><button type="button" class="field-grazing-step" data-fg-step="-1" aria-label="Un animal de moins">−</button><output aria-live="polite"><strong>${counter}</strong><small>${escapeHtml(gap.label)}</small></output><button type="button" class="field-grazing-step" data-fg-step="1" aria-label="Un animal de plus">+</button>${gap.gap&&info.here.length===1?`<button type="button" class="button secondary span-all" data-fg-count-save>Mettre à jour l’effectif (${info.known} → ${counter})</button>`:''}${gap.gap&&info.here.length>1?'<p class="form-note span-all">Plusieurs lots sur ce pré : corrigez l’effectif dans la fiche du lot concerné.</p>':''}</div>`:''}
<div class="field-grazing-checks" role="group" aria-label="Contrôle rapide"><span>Abreuvoir</span><button type="button" class="chip" data-fg-check="water" data-ok="1">OK</button><button type="button" class="chip" data-fg-check="water">À voir</button><span>Clôture</span><button type="button" class="chip" data-fg-check="fence" data-ok="1">OK</button><button type="button" class="chip" data-fg-check="fence">Cassée</button></div></article>`;
    };
    const refresh=()=>{onChange?.();fieldCard(root,parcelId,{gps,onChange});};
    root.onclick=async event=>{
      const target=event.target.closest('button');if(!target||target.disabled)return;
      if(target.dataset.fgMode){mode=mode===target.dataset.fgMode?'':target.dataset.fgMode;if(mode==='count')counter=info.known;render();return;}
      if(target.dataset.fgStep){counter=Math.max(0,counter+Number(target.dataset.fgStep));render();return;}
      try{
        if(target.dataset.fgBring){
          const session=store.get('grazingSessions',target.dataset.fgBring),alert=grazingReentryAlert(store.state,parcelId,today()),key=`${parcelId}|${today()}`;
          if(alert&&target.dataset.dreAck!==key){target.dataset.dreAck=key;const note=root.querySelector('.field-grazing-alert');note.textContent=`${alert.message} Touchez à nouveau le lot pour confirmer.`;note.hidden=false;return;}
          target.disabled=true;await moveGrazingLot(store,session,parcelId,{date:today()});(savedToast||toast)(`Lot amené sur ${info.parcel.nom}.`);refresh();
        }else if(target.dataset.fgExit){
          target.disabled=true;await endGrazingSession(store,target.dataset.fgExit,{date:today()});(savedToast||toast)('Sortie du pré enregistrée.');refresh();
        }else if(target.hasAttribute('data-fg-count-save')){
          if(target.dataset.confirm!=='1'){target.dataset.confirm='1';target.textContent=`Confirmer : effectif ${counter}`;target.classList.replace('secondary','primary');return;}
          target.disabled=true;await updateGrazingCount(store,info.here[0].id,counter);(savedToast||toast)(`Effectif mis à jour : ${counter}.`);refresh();
        }else if(target.dataset.fgCheck){
          const what=target.dataset.fgCheck==='water'?'Abreuvoir':'Clôture';
          if(target.dataset.ok){toast(`${what} OK noté.`);target.setAttribute('aria-pressed','true');return;}
          const observation=grazingCheckObservation(target.dataset.fgCheck,{parcel:info.parcel,gps,date:new Date(),lot:info.here.map(l=>l.label).join(', ')});
          target.disabled=true;await store.upsert('observations',observation,{label:`Observation : ${observation.title}`});toast(`${observation.title} : observation créée.`);target.disabled=false;target.setAttribute('aria-pressed','true');
        }
      }catch(error){target.disabled=false;toast(error.message,'error');}
    };
    render();return true;
  }
  return{openList,openForm,openMove,openBalance,fieldCard};
}
