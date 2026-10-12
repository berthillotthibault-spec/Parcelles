// n° 61 - Riverains, ruchers et voisins : panneau d'information avant traitement et coordonnées.
import {NEIGHBOR_TYPES,NEIGHBOR_RADIUS_DEFAULT,NEIGHBOR_RADIUS_CHOICES,BEE_REMINDER,NEIGHBOR_SOURCE,neighborsNear,neighborSummary,needsBeeReminder,neighborMessage,contactLinks,contactPatch} from './neighbors.js';
import {isTreatment} from './phyto.js';
import {escapeHtml as e,formatNumber} from './utils.js';

export function createNeighborsUI({store,state,active,parcelById,toast}){
  const radius=()=>Number(state().preferences?.neighborRadiusM)||NEIGHBOR_RADIUS_DEFAULT;

  // Champs de contact d'un point (affichés pour les seuls types riverains).
  function contactFieldsHtml(point={}){
    const on=NEIGHBOR_TYPES.includes(point?.type);
    return `<fieldset class="span-2 neighbor-contact${on?'':' hidden'}"><legend>Contact (facultatif)</legend><label>Nom<input name="contactName" maxlength="120" autocomplete="off" value="${e(point.contactName||'')}"></label><label>Téléphone<input name="phone" type="tel" maxlength="30" autocomplete="off" value="${e(point.phone||'')}"></label><label>E-mail<input name="email" type="email" maxlength="160" autocomplete="off" value="${e(point.email||'')}"></label><label class="check-row"><input type="checkbox" name="contactConsent" value="1" ${point.contactConsent?'checked':''}> La personne est d’accord pour que ses coordonnées soient enregistrées ici.</label><p class="form-note">Données de tiers : enregistrez-les seulement avec leur accord et supprimez-les sur simple demande.</p><p class="form-error hidden" data-neighbor-error></p></fieldset>`;
  }
  function bindPointForm(form){
    const type=form?.querySelector('[name="type"]'),box=form?.querySelector('.neighbor-contact');if(!type||!box)return;
    type.addEventListener('change',()=>box.classList.toggle('hidden',!NEIGHBOR_TYPES.includes(type.value)));
  }
  // Champs de contact validés (vides hors types riverains). Renvoie null et affiche l'erreur si refus.
  function readContact(form){
    const v=Object.fromEntries(new FormData(form)),err=form.querySelector('[data-neighbor-error]');
    const strip=o=>{for(const k of ['contactName','phone','email','contactConsent'])delete o[k];return o;};
    if(!NEIGHBOR_TYPES.includes(v.type))return{values:strip(v),contact:contactPatch({})};
    try{const contact=contactPatch(v);err?.classList.add('hidden');return{values:strip(v),contact};}
    catch(error){if(err){err.textContent=error.message;err.classList.remove('hidden');}form.querySelector('[name="contactConsent"]')?.focus();return null;}
  }

  function workFromForm(form){const v=Object.fromEntries(new FormData(form));return{...v,isPhytosanitary:Boolean(form.elements.isPhytosanitary?.checked),date:v.plannedDate||v.date||''};}
  function panelHtml(work,parcel){
    const r=radius(),rows=neighborsNear(parcel,active('points'),r),bee=needsBeeReminder(parcel,work),summary=neighborSummary(rows);
    if(!rows.length&&!bee)return `<p class="form-note">Aucune habitation, aucun rucher ni établissement sensible enregistré à moins de ${r} m. ${radiusSelect(r)}</p>`;
    const msg=row=>neighborMessage({parcel,work,contactName:row.point.contactName||''});
    return `${summary?`<p class="neighbor-summary"><strong>${e(summary)}</strong> (moins de ${r} m) ${radiusSelect(r)}</p>`:''}${bee?`<p class="neighbor-bee" role="note">${e(BEE_REMINDER)}</p>`:''}${rows.length?`<ul class="neighbor-list">${rows.map(row=>{const links=contactLinks(row.point,msg(row)),has=links.sms||links.mailto;return `<li><span><strong>${e(row.point.nom||row.point.type)}</strong><small>${e(row.point.type)} · ${row.distance<1?'en bordure':`${formatNumber(Math.round(row.distance))} m`}${row.point.contactName?` · ${e(row.point.contactName)}`:''}</small></span>${has?`<button type="button" class="button secondary" data-neighbor-notify="${e(row.point.id)}">Prévenir</button><span class="neighbor-links hidden" data-neighbor-links="${e(row.point.id)}">${links.sms?`<a class="button secondary" href="${e(links.sms)}">SMS</a>`:''}${links.mailto?`<a class="button secondary" href="${e(links.mailto)}">E-mail</a>`:''}</span>`:'<small class="neighbor-nocontact">Pas de contact enregistré</small>'}</li>`;}).join('')}</ul>`:''}<p class="phyto-disclaimer"><strong>Indicatif.</strong> ${e(NEIGHBOR_SOURCE)}</p>`;
  }
  const radiusSelect=r=>`<label class="neighbor-radius">Rayon <select data-neighbor-radius aria-label="Rayon de recherche des riverains">${NEIGHBOR_RADIUS_CHOICES.map(c=>`<option value="${c}" ${c===r?'selected':''}>${c} m</option>`).join('')}</select></label>`;

  function enhanceWorkForm(form){
    if(!form||form.querySelector('.neighbors-panel'))return;
    const grid=form.querySelector('.form-grid')||form;
    grid.insertAdjacentHTML('beforeend','<section class="neighbors-panel span-2 hidden" aria-live="polite" aria-label="Riverains et ruchers"></section>');
    const panel=form.querySelector('.neighbors-panel');
    const refresh=()=>{const work=workFromForm(form),parcel=parcelById(work.parcelId),show=Boolean(parcel?.geometry&&isTreatment(work)&&work.status!=='Annulé');panel.classList.toggle('hidden',!show);panel.innerHTML=show?`<h3>Riverains et ruchers</h3>${panelHtml(work,parcel)}`:'';};
    panel.addEventListener('click',async ev=>{
      const b=ev.target.closest('[data-neighbor-notify]');if(!b)return;
      const point=store.get('points',b.dataset.neighborNotify),work=workFromForm(form),parcel=parcelById(work.parcelId);if(!point)return;
      const text=neighborMessage({parcel,work,contactName:point.contactName||''});
      if(navigator.share){try{await navigator.share({title:'Information avant traitement',text});return;}catch(error){if(error?.name==='AbortError')return;}}
      panel.querySelector(`[data-neighbor-links="${CSS.escape(point.id)}"]`)?.classList.remove('hidden');b.classList.add('hidden');
    });
    panel.addEventListener('change',async ev=>{if(!ev.target.matches('[data-neighbor-radius]'))return;ev.stopPropagation();await store.setPreferences({neighborRadiusM:Number(ev.target.value)});refresh();});
    form.addEventListener('input',ev=>{if(!panel.contains(ev.target))refresh();});
    form.addEventListener('change',ev=>{if(!panel.contains(ev.target))refresh();});
    refresh();
  }
  return{contactFieldsHtml,bindPointForm,readContact,enhanceWorkForm,panelHtml};
}
