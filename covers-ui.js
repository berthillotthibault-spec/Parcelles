// n° 74 — Couverts et intercultures (CIPAN) : champs facultatifs du formulaire de rotation,
// écran de suivi par campagne avec alertes et réglages des dates.
import {campaignFor,escapeHtml,isoDate,localDate} from './utils.js';
import {validateForm} from './form-chips-ui.js';
import {COVER_DEFAULTS,COVER_SOURCE,COVER_VERIFY,DESTRUCTION_MODES,coverRows,coverSettings,intercultureError,minDestructionDate,normalizeInterculture} from './covers.js';
import {rotationFor} from './nitrogen.js';

const e=escapeHtml;
const shift=(c,d)=>{const y=Number(String(c).slice(0,4))+d;return`${y}/${String(y+1).slice(-2)}`;};

export function createCoversUI({store,modal,toast,bindChipChoices}){
  const $=selector=>document.querySelector(selector);
  const today=()=>isoDate(new Date());
  let campaign=campaignFor();

  // Champs du formulaire de rotation (préfixe ic_), repliés tant qu’aucun couvert n’est saisi.
  function fieldsHtml(rotation={}){
    const ic=normalizeInterculture(rotation?.interculture)||{},leg=ic.especes?String(Boolean(ic.legumineuse)):'false';
    const chip=(v,l)=>`<button type="button" class="choice-chip${leg===v?' is-on':''}" data-value="${v}" aria-pressed="${leg===v}">${l}</button>`;
    return`<details class="span-2 cv-fields"${ic.especes?' open':''}><summary>Interculture avant cette culture (facultatif)</summary><div class="form-grid">
      <label class="span-2">Espèces du couvert<input name="ic_especes" maxlength="120" placeholder="Moutarde, phacélie, vesce…" value="${e(ic.especes||'')}"></label>
      <label>Date de semis<input name="ic_semisDate" type="date" value="${e(ic.semisDate||'')}"></label>
      <div class="field-label"><span>Avec légumineuses</span><input type="hidden" name="ic_legumineuse" value="${leg}"><div class="chip-choices" data-chip-target="ic_legumineuse">${chip('true','Oui')}${chip('false','Non')}</div></div>
      <label>Mode de destruction<select name="ic_destructionMode"><option value="">—</option>${DESTRUCTION_MODES.map(m=>`<option${ic.destructionMode===m?' selected':''}>${e(m)}</option>`).join('')}</select></label>
      <label>Date de destruction<input name="ic_destructionDate" type="date" value="${e(ic.destructionDate||'')}"></label>
    </div></details>`;
  }
  /** Lit et retire les champs ic_ ; renvoie un message d’erreur ou ''. */
  function read(values){
    const raw={};for(const k of Object.keys(values))if(k.startsWith('ic_')){raw[k.slice(3)]=values[k];delete values[k];}
    const ic=normalizeInterculture(raw),error=intercultureError(ic);
    if(!error)values.interculture=ic;
    return error;
  }

  function row(r){
    const ic=r.interculture,status=r.issues.some(i=>i.kind==='early')?'ko':r.issues.length?'warn':ic?'ok':'none';
    return`<li class="cv-row is-${status}">
      <div class="cv-main"><strong>${e(r.parcel.nom)}</strong>${r.zone?'<span class="nz-tag">Zone vulnérable</span>':''}<small>${e(r.culture||'Culture non renseignée')}${ic?` · couvert : ${e(ic.especes)}${ic.legumineuse?' (avec légumineuses)':''}${ic.semisDate?` · semé le ${e(localDate(ic.semisDate))}`:''}${ic.destructionDate?` · détruit le ${e(localDate(ic.destructionDate))}${ic.destructionMode?` (${e(ic.destructionMode.toLowerCase())})`:''}`:''}`:''}</small>
      ${r.issues.map(i=>`<p class="cv-issue">${e(i.text)}</p>`).join('')}</div>
      <button class="small-button cv-edit" type="button" data-cv="edit" data-id="${e(r.parcel.id)}" aria-label="${ic?'Modifier':'Prévoir'} le couvert de ${e(r.parcel.nom)}">${ic?'Modifier':'Prévoir'}</button>
    </li>`;
  }

  function open(options={}){
    if(options.campaign)campaign=options.campaign;
    const rows=coverRows(store.state,campaign,{today:today()}),s=coverSettings(store.state),issues=rows.reduce((n,r)=>n+r.issues.length,0);
    const chips=[campaignFor(),shift(campaignFor(),1)].map(c=>`<button type="button" class="choice-chip${c===campaign?' is-on':''}" data-cv="campaign" data-value="${e(c)}" aria-pressed="${c===campaign}">${e(c)}</button>`).join('');
    modal('Couverts et intercultures',`Couverts implantés avant les cultures de la campagne ${campaign}.`,
      `<div class="covers">
        <div class="chip-choices cv-campaigns" role="group" aria-label="Campagne">${chips}</div>
        <div class="pac-status is-${issues?'warn':'ok'}" role="status"><strong>${issues?`${issues} point${issues>1?'s':''} à vérifier`:'Aucune alerte sur les couverts'}</strong><p>Destruction pas avant le ${e(localDate(minDestructionDate(campaign,s)))}, couvert maintenu au moins ${s.minDays} jours. Le couvert compte dans le PPF, la BCAE 6 et l’éco-régime (simulation).</p></div>
        ${rows.length?`<ul class="cv-list" role="list">${rows.map(row).join('')}</ul>`:'<div class="empty-state">Aucune terre arable avec une culture pour cette campagne.</div>'}
        <p class="nz-source">Source : ${e(COVER_SOURCE)} <strong>${e(COVER_VERIFY)}</strong></p>
      </div>`,
      `<button class="button secondary" type="button" data-cv="settings">Réglages des dates</button><button class="button primary" type="button" data-action="close-modal">Fermer</button>`,'large covers-modal');
    bind();
  }
  function bind(){
    for(const b of document.querySelectorAll('[data-cv]'))b.onclick=()=>{
      const k=b.dataset.cv;
      if(k==='campaign')open({campaign:b.dataset.value});
      else if(k==='edit')openEdit(b.dataset.id);
      else if(k==='settings')openSettings();
      else if(k==='back')open();
    };
  }
  const back='<button class="button secondary" type="button" data-cv="back">Retour</button>';
  const showError=(form,text)=>{const n=form.querySelector('.form-error');n.textContent=text;n.classList.remove('hidden');};

  function openEdit(parcelId){
    const parcel=store.get('parcelles',parcelId);if(!parcel)return open();
    const rotation=rotationFor(store.state,parcelId,campaign),r=coverRows(store.state,campaign,{today:today()}).find(x=>x.parcel.id===parcelId);
    modal(`Couvert · ${parcel.nom}`,`Avant ${r?.culture||'la culture'} · campagne ${campaign}`,
      `<form id="cv-form" class="form-grid" novalidate>${fieldsHtml(rotation).replace('<details class="span-2 cv-fields"','<details open class="span-2 cv-fields"')}<p class="form-error span-2 hidden" role="alert"></p></form>`,
      `${back}<button class="button primary" id="cv-save">Enregistrer</button>`,'small covers-form-modal');
    const form=$('#cv-form');bindChipChoices?.(form);bind();
    $('#cv-save').onclick=async()=>{
      if(!validateForm(form))return;
      const v=Object.fromEntries(new FormData(form)),error=read(v);
      if(error)return showError(form,error);
      try{
        await store.upsert('rotations',{...(rotation||{parcelId,campaignId:campaign,culture:r?.culture||parcel.culture||''}),interculture:v.interculture},{label:`Couvert ${campaign} : ${parcel.nom}`});
        toast('Couvert enregistré.','success');open();
      }catch(err){showError(form,err.message);}
    };
  }

  function openSettings(){
    const s=coverSettings(store.state),[m,d]=s.minDestruction.split('-');
    modal('Réglages des couverts','Dates retenues pour les alertes. Reportez celles de votre programme d’actions.',
      `<form id="cv-settings" class="form-grid" novalidate>
        <label>Destruction pas avant le (JJ/MM) *<input name="minDestruction" required pattern="(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])" inputmode="numeric" maxlength="5" value="${e(`${d}/${m}`)}"></label>
        <label>Durée minimale du couvert (jours) *<input name="minDays" type="number" inputmode="numeric" required min="0" max="365" step="1" value="${s.minDays}"></label>
        <p class="form-note span-2">Valeurs par défaut : ${e(COVER_DEFAULTS.minDestruction.split('-').reverse().join('/'))} et ${COVER_DEFAULTS.minDays} jours. ${e(COVER_VERIFY)}</p>
        <p class="form-error span-2 hidden" role="alert"></p>
      </form>`,
      `${back}<button class="button primary" id="cv-settings-save">Enregistrer</button>`,'small covers-form-modal');
    bind();
    const form=$('#cv-settings');
    $('#cv-settings-save').onclick=async()=>{
      if(!validateForm(form))return;
      const v=Object.fromEntries(new FormData(form)),[dd,mm]=String(v.minDestruction).split('/');
      try{await store.setExploitation({couverts:{...(store.state.exploitation?.couverts||{}),minDestruction:`${mm}-${dd}`,minDays:Number(v.minDays)}});toast('Réglages des couverts enregistrés.','success');open();}
      catch(err){showError(form,err.message);}
    };
  }

  return{open,openEdit,openSettings,fieldsHtml,read};
}
