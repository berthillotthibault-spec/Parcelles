// n° 76 — Interface du carnet sanitaire d’élevage : liste, formulaire « Soin »,
// bandeau d’accueil des délais d’attente et registre PDF annuel.
import {escapeHtml as e,localDate} from './utils.js';
import {validateForm} from './form-chips-ui.js';
import {flowPdf,pdfFile,sharePdf} from './pdf-lite.js';
import {grazingTotal,grazingType,grazingStatus} from './grazing.js';
import {VET_ROUTES,RETENTION_YEARS,HERD_HEALTH_REFERENCES,normalizeTreatment,activeWithdrawals,healthReminders,registerYears,registerRows,registerPdfBlocks} from './herd-health.js';

const KIND_LABELS={treatment:'Soin',prophylaxis:'Prophylaxie',visit:'Visite sanitaire'};

export function createHerdHealthUI({store,modal,closeModal,toast,today}){
  const $=s=>document.querySelector(s);
  const data=()=>store.state;
  const live=key=>(data()[key]||[]).filter(x=>!x.deletedAt);
  const canWrite=()=>!store.writeGuard||store.writeGuard({entity:'vetTreatments',action:'create'});
  let year=null;

  function rowHtml(t){
    const who=[t.lotLabel,t.animal].filter(Boolean).join(' · ');
    const delays=[t.meatUntil?`viande jusqu’au ${localDate(t.meatUntil)}`:'',t.milkUntil?`lait jusqu’au ${localDate(t.milkUntil)}`:''].filter(Boolean).join(' · ');
    const title=(t.kind||'treatment')==='treatment'?`${t.medicine}${who?` · ${who}`:''}`:`${KIND_LABELS[t.kind]}${t.veterinarian?` · ${t.veterinarian}`:''}`;
    return `<button type="button" class="list-row is-button" data-herd-edit="${e(t.id)}"><div><strong>${e(title)}</strong><small>${e([localDate(t.date),t.animalCount?`${t.animalCount} ${t.animalCount>1?'animaux':'animal'}`:'',t.prescriptionNumber?`ordonnance ${t.prescriptionNumber}`:'',delays].filter(Boolean).join(' · '))}</small></div><span class="badge ${(t.kind||'treatment')==='treatment'?'info':'success'}">${e(KIND_LABELS[t.kind||'treatment'])}</span></button>`;
  }

  function open(){
    const d=data(),years=registerYears(d,{today:today()});if(!year||!years.includes(year))year=years[0];
    const rows=registerRows(d,year).reverse(),w=activeWithdrawals(d,{today:today()}),reminders=healthReminders(d,{today:today()});
    modal('Carnet sanitaire',`Soins, délais d’attente et suivi sanitaire · conservation ${RETENTION_YEARS} ans.`,
      `${w.active?`<div class="notice warning herd-withdrawal" role="status">${w.messages.map(m=>`<p>${e(m)}.</p>`).join('')}</div>`:''}
      ${reminders.length?`<ul class="herd-reminders">${reminders.map(r=>`<li class="is-${e(r.status)}">${e(r.text)}</li>`).join('')}</ul><p class="form-note">${e(HERD_HEALTH_REFERENCES.verify)}</p>`:''}
      <div class="herd-years" role="group" aria-label="Année">${years.map(y=>`<button type="button" class="choice-chip ${y===year?'is-on':''}" aria-pressed="${y===year}" data-herd-year="${e(y)}">${e(y)}</button>`).join('')}</div>
      <div class="stack-list">${rows.map(rowHtml).join('')||'<div class="empty-state">Aucun soin enregistré cette année.</div>'}</div>
      <p class="form-note">Les enregistrements sont conservés sans limite de durée : aucune purge automatique. Gardez les ordonnances ${RETENTION_YEARS} ans.</p>`,
      `<button type="button" class="button secondary" data-action="close-modal">Fermer</button><button type="button" class="button secondary" id="herd-pdf">Registre PDF ${e(year)}</button>${canWrite()?`<button type="button" class="button secondary" id="herd-prophylaxis">Prophylaxie / visite</button><button type="button" class="button primary" id="herd-new">Nouveau soin</button>`:''}`,'large');
    document.querySelectorAll('[data-herd-year]').forEach(b=>b.onclick=()=>{year=b.dataset.herdYear;open();});
    document.querySelectorAll('[data-herd-edit]').forEach(b=>b.onclick=()=>{const t=store.get('vetTreatments',b.dataset.herdEdit);if(t)(t.kind||'treatment')==='treatment'?openForm(t):openEventForm(t);});
    $('#herd-new')?.addEventListener('click',()=>openForm());
    $('#herd-prophylaxis')?.addEventListener('click',()=>openEventForm());
    $('#herd-pdf').onclick=()=>pdf(year);
  }

  function lotOptions(selected){
    const sessions=live('grazingSessions').filter(s=>['current','planned'].includes(grazingStatus(s,{date:today()}))||s.id===selected);
    const parcels=new Map(live('parcelles').map(p=>[p.id,p.nom]));
    return sessions.map(s=>`<option value="${e(s.id)}" ${s.id===selected?'selected':''}>${e(s.note||grazingType(s))} · ${grazingTotal(s)} · ${e(parcels.get(s.parcelId)||'Parcelle')}</option>`).join('');
  }
  function attachmentOptions(selected){
    const files=[...live('photos'),...live('documents')].sort((a,b)=>(b.capturedAt||b.createdAt||0)-(a.capturedAt||a.createdAt||0)).slice(0,40);
    return files.map(f=>`<option value="${e(f.id)}" ${f.id===selected?'selected':''}>${e(f.name||f.category||'Pièce')}${f.documentDate?` · ${e(localDate(f.documentDate))}`:''}</option>`).join('');
  }

  function openForm(t=null){
    const x=t||{date:today(),route:'',withdrawalMeatDays:'',withdrawalMilkDays:''};
    modal(t?'Modifier le soin':'Nouveau soin','Traitement vétérinaire et délais d’attente.',`<form id="herd-form" class="form-grid" novalidate>
      <label>Date *<input name="date" type="date" required value="${e(x.date||today())}"></label>
      <label>Lot<select name="sessionId"><option value="">Aucun lot (animal seul)</option>${lotOptions(x.sessionId)}</select></label>
      <label>Animal (n° ou nom, facultatif)<input name="animal" value="${e(x.animal||'')}" placeholder="FR1234567890"></label>
      <label>Nombre d’animaux traités<input name="animalCount" type="number" min="1" step="1" inputmode="numeric" value="${e(x.animalCount??'')}" placeholder="Tout le lot"></label>
      <label class="span-2">Médicament *<input name="medicine" required value="${e(x.medicine||'')}" placeholder="Nom commercial"></label>
      <label>N° d’ordonnance<input name="prescriptionNumber" value="${e(x.prescriptionNumber||'')}"></label>
      <label>Photo ou document de l’ordonnance<select name="attachmentId"><option value="">Aucun</option>${attachmentOptions(x.attachmentId)}</select></label>
      <label>Dose<input name="dose" type="number" min="0" step="any" inputmode="decimal" value="${e(x.dose??'')}"></label>
      <label>Unité<input name="doseUnit" value="${e(x.doseUnit||'ml')}" list="herd-units"><datalist id="herd-units"><option>ml</option><option>ml/100 kg</option><option>g</option><option>comprimé</option><option>injecteur</option></datalist></label>
      <label>Voie<select name="route"><option value="">Non précisée</option>${VET_ROUTES.map(r=>`<option ${x.route===r?'selected':''}>${e(r)}</option>`).join('')}</select></label>
      <label>Vétérinaire<input name="veterinarian" value="${e(x.veterinarian||'')}"></label>
      <label>Délai d’attente viande (jours)<input name="withdrawalMeatDays" type="number" min="0" step="1" inputmode="numeric" value="${e(x.withdrawalMeatDays??'')}"></label>
      <label>Délai d’attente lait (jours)<input name="withdrawalMilkDays" type="number" min="0" step="1" inputmode="numeric" value="${e(x.withdrawalMilkDays??'')}"></label>
      <label class="span-2">Note<input name="note" value="${e(x.note||'')}"></label>
      <p class="form-error span-2" id="herd-error" role="alert" hidden></p></form>
      <p class="form-note">Ajoutez d’abord la photo de l’ordonnance dans Documents pour la relier ici. Les délais d’attente figurent sur l’ordonnance : ils ne sont pas calculés par l’application.</p>`,
      `<button type="button" class="button secondary" id="herd-back">Retour</button>${t&&canWrite()?'<button type="button" class="button danger" id="herd-delete">Supprimer</button>':''}<button type="button" class="button primary" id="herd-save">Enregistrer</button>`,'large');
    bind(t,'#herd-form',values=>normalizeTreatment({...values,kind:'treatment'},{state:data()}));
  }

  function openEventForm(t=null){
    const x=t||{kind:'prophylaxis',date:today()};
    modal(t?'Modifier':'Prophylaxie ou visite sanitaire','Date de réalisation, pour les rappels.',`<form id="herd-event-form" class="form-grid" novalidate>
      <label>Nature *<select name="kind" required><option value="prophylaxis" ${x.kind==='prophylaxis'?'selected':''}>Prophylaxie</option><option value="visit" ${x.kind==='visit'?'selected':''}>Visite sanitaire</option></select></label>
      <label>Date *<input name="date" type="date" required value="${e(x.date||today())}"></label>
      <label>Vétérinaire<input name="veterinarian" value="${e(x.veterinarian||'')}"></label>
      <label>Note<input name="note" value="${e(x.note||'')}"></label>
      <p class="form-error span-2" id="herd-error" role="alert" hidden></p></form>`,
      `<button type="button" class="button secondary" id="herd-back">Retour</button>${t&&canWrite()?'<button type="button" class="button danger" id="herd-delete">Supprimer</button>':''}<button type="button" class="button primary" id="herd-save">Enregistrer</button>`);
    bind(t,'#herd-event-form',values=>normalizeTreatment(values,{state:data()}));
  }

  function bind(t,selector,build){
    const form=$(selector),button=$('#herd-save'),error=$('#herd-error');
    $('#herd-back').onclick=()=>open();
    $('#herd-delete')?.addEventListener('click',async()=>{try{await store.remove('vetTreatments',t.id);open();toast('Soin supprimé.');}catch(err){toast(err.message,'error');}});
    button.onclick=async()=>{
      if(button.disabled||!validateForm(form))return;
      try{
        const record=build(Object.fromEntries(new FormData(form)));
        button.disabled=true;
        await store.upsert('vetTreatments',{...(t||{}),...record},{label:t?`${KIND_LABELS[record.kind]} modifié(e)`:`${KIND_LABELS[record.kind]} enregistré(e)`});
        year=record.date.slice(0,4);open();toast(record.kind==='treatment'?'Soin enregistré.':'Enregistré.');
      }catch(err){button.disabled=false;error.textContent=err.message;error.hidden=false;}
    };
  }

  async function pdf(y){
    try{
      const name=`Registre sanitaire ${y}`;
      const file=pdfFile(flowPdf(registerPdfBlocks(data(),y,{today:today()}),{title:name,footer:`${name} · à conserver ${RETENTION_YEARS} ans`}),name);
      const result=await sharePdf(file,{title:name});
      if(result!=='cancelled')toast(result==='shared'?'PDF partagé.':'PDF téléchargé.','success');
    }catch(err){toast(`PDF impossible : ${err.message}`,'error');}
  }

  // Bandeau d’accueil : animaux sous délai d’attente.
  function renderHome(d){
    const anchor=$('#next-action');if(!anchor)return;
    let root=$('#herd-withdrawal-home');const w=activeWithdrawals(d,{today:today()});
    if(!w.active){root?.remove();return;}
    if(!root){root=document.createElement('section');root.id='herd-withdrawal-home';root.className='herd-home';root.setAttribute('aria-label','Délais d’attente en cours');anchor.before(root);}
    root.innerHTML=`<button type="button" class="herd-home-card" data-action="open-herd-health"><span class="herd-home-icon" aria-hidden="true">!</span><span>${w.messages.map(m=>`<strong>${e(m)}</strong>`).join('')}<small>Carnet sanitaire · délais indiqués sur l’ordonnance.</small></span></button>`;
  }

  return{open,openForm,openEventForm,renderHome,pdf};
}
