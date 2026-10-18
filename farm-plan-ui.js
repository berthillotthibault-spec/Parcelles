// Écran « Imprimer un plan » (n° 54), chargé à la demande : emprise, fond, couleurs, puis document A4
// paysage prêt à imprimer (onglet sur ordinateur, visionneuse avec vrai PDF sur téléphone et PWA iOS).
// Boutons repérés par data-plan : un seul écouteur délégué, installé une fois. Lecture seule : aucun
// enregistrement dans les données, donc ouvert à tous les rôles (lecteur compris).
import {escapeHtml as e,campaignFor,formatNumber} from './utils.js';
import {cultureColor} from './map.js';
import {assetBase,openPrintable} from './dossier-ui.js';
import {PLAN_BACKGROUNDS,PLAN_COLORS,PLAN_SCOPES,farmPlanHtml,farmPlanModel,farmPlanPdf,hasMapGeometry,normalizePlanOptions,planLayout,planParcels,planTitle} from './farm-plan.js';

const PREF_KEY='parcelles:plan-options';
const readPrefs=()=>{try{return JSON.parse(globalThis.localStorage?.getItem(PREF_KEY)||'{}')||{};}catch{return{};}};
const writePrefs=v=>{try{globalThis.localStorage?.setItem(PREF_KEY,JSON.stringify(v));}catch{}};
const online=()=>globalThis.navigator?.onLine!==false;

export function createFarmPlanUI({state,active,getMap=()=>null,selectedParcelId=()=>null,modal,closeModal,toast,doc=globalThis.document}){
  const parcels=()=>planParcels(active('parcelles'));
  const selection=()=>{const map=getMap();return map?.multiple?[...(map.selectedIds||[])]:[];};
  const infoFor=mode=>{
    const culture=p=>{const label=p.culture||'Sans culture';return{label,color:cultureColor(label)};};
    if(mode!=='map')return culture;
    const map=getMap();return p=>{try{const info=map?.colorInfo?.(p);return info?.label?{label:String(info.label),color:info.color}:culture(p);}catch{return culture(p);}};
  };
  const chips=(group,list,current,{hints=false}={})=>`<div class="chip-choices" role="group" aria-labelledby="plan-${group}-label">${list.map(([id,label,hint])=>`<button type="button" class="choice-chip${id===current?' is-on':''}" data-plan="chip" data-group="${group}" data-value="${e(id)}" aria-pressed="${id===current}"${hints&&hint?` title="${e(hint)}"`:''}>${e(label)}</button>`).join('')}</div>`;

  function readForm(form){
    const val=name=>form.querySelector(`[name="${name}"]`)?.value;
    return{...normalizePlanOptions({scope:val('scope'),background:val('background'),colorMode:val('colorMode'),labels:form.labels.checked,table:form.table.checked}),parcelId:val('parcelId')||null};
  }
  function chosen(o){return planParcels(parcels(),{scope:o.scope,parcelId:o.parcelId,ids:selection()});}

  // Résumé en direct : nombre de parcelles, surface et échelle obtenue.
  function refresh(form){
    const o=readForm(form),list=chosen(o),layout=planLayout(list.filter(hasMapGeometry));
    form.querySelector('[data-plan-parcel]')?.classList.toggle('hidden',o.scope!=='parcel');
    const area=list.reduce((s,p)=>s+(Number(p.surfaceHa)||0),0);
    form.querySelector('[data-plan-summary]').textContent=!list.length?'Aucune parcelle dans cette emprise.':`${list.length} ${list.length>1?'parcelles':'parcelle'}${area?` · ${formatNumber(Math.round(area*100)/100)} ha déclarés`:''}${layout?` · échelle d’environ 1/${new Intl.NumberFormat('fr-FR').format(layout.scale)}`:' · aucun contour à dessiner'}`;
    const note=form.querySelector('[data-plan-offline]');if(note)note.classList.toggle('hidden',online()||o.background==='none');
    form.querySelector('.form-error')?.classList.add('hidden');
  }

  function open({scope=null,parcelId=null}={}){
    const all=parcels(),sel=selection(),prefs=normalizePlanOptions(readPrefs());
    if(!all.length){toast('Ajoutez d’abord une parcelle pour imprimer un plan.','info');return;}
    const firstShape=all.find(hasMapGeometry)||all[0],current=parcelId||selectedParcelId()||getMap()?.selectedId||firstShape.id;
    const s=scope&&PLAN_SCOPES.some(([k])=>k===scope)?scope:'farm',sc=s==='selection'&&!sel.length?'farm':s;
    const bg=!online()&&prefs.background!=='none'?'none':prefs.background;
    const mapMode=getMap()?.colorMode,colors=PLAN_COLORS.filter(([id])=>id!=='map'||(mapMode&&mapMode!=='culture'));
    const color=colors.some(([id])=>id===prefs.colorMode)?prefs.colorMode:'culture';
    const sorted=[...all].sort((a,b)=>String(a.nom||'').localeCompare(String(b.nom||''),'fr',{numeric:true}));
    const scopes=PLAN_SCOPES.filter(([id])=>id!=='selection'||sel.length).map(([id,label])=>[id,id==='selection'?`${label} (${sel.length})`:label]);
    const body=`<form id="plan-form" class="form-grid" novalidate>
<div class="span-2"><span class="field-label" id="plan-scope-label">Emprise *</span><input type="hidden" name="scope" value="${sc}">${chips('scope',scopes,sc)}${sel.length?'':'<p class="cost-detail">Pour un plan de quelques parcelles, sélectionnez-les d’abord sur la carte (sélection multiple), puis « Plan ».</p>'}</div>
<label class="span-2${sc==='parcel'?'':' hidden'}" data-plan-parcel>Parcelle *<select name="parcelId">${sorted.map(p=>`<option value="${e(p.id)}"${p.id===current?' selected':''}>${e(p.nom||'Parcelle')}${hasMapGeometry(p)?'':' (sans contour)'}</option>`).join('')}</select></label>
<div class="span-2"><span class="field-label" id="plan-background-label">Fond</span><input type="hidden" name="background" value="${bg}">${chips('background',PLAN_BACKGROUNDS,bg,{hints:true})}<p class="cost-detail hidden" data-plan-offline>Hors connexion, le fond ne se chargera pas : le plan restera lisible sans lui.</p></div>
<div class="span-2"><span class="field-label" id="plan-colorMode-label">Couleurs</span><input type="hidden" name="colorMode" value="${color}">${chips('colorMode',colors,color)}</div>
<label class="span-2 check-row"><input type="checkbox" name="labels"${prefs.labels?' checked':''}> Noms des parcelles sur la carte (sinon numéros seuls)</label>
<label class="span-2 check-row"><input type="checkbox" name="table"${prefs.table?' checked':''}> Tableau des parcelles (surface, culture, commune)</label>
<p class="span-2 cost-detail" data-plan-summary aria-live="polite"></p>
<p class="span-2 cost-detail">Page A4 paysage avec cartouche, légende en hectares, échelle, nord et date. Sur téléphone, un vrai fichier PDF est proposé pour l’envoyer ou l’imprimer.</p>
<p class="span-2 form-error hidden" role="alert" tabindex="-1"></p></form>`;
    modal('Imprimer un plan','Un plan papier pour un salarié, une entreprise de travaux, l’assurance ou un contrôle',body,`<button type="button" class="button secondary" data-action="close-modal">Annuler</button><button type="button" class="button primary" data-plan="generate">Préparer le plan</button>`,'small');
    const form=doc.getElementById('plan-form');if(form)refresh(form);
  }

  function choose(control){
    const form=control.closest('form'),group=control.dataset.group;if(!form||!group)return;
    form.querySelector(`[name="${group}"]`).value=control.dataset.value;
    form.querySelectorAll(`[data-plan="chip"][data-group="${group}"]`).forEach(c=>{const on=c===control;c.classList.toggle('is-on',on);c.setAttribute('aria-pressed',String(on));});
    refresh(form);
  }

  // Photo IGN dans le PDF : les tuiles JPEG sont téléchargées pendant l’affichage de la visionneuse,
  // le PDF étant généré de façon synchrone au toucher (exigence du partage iOS).
  function prefetch(model,cache){
    if(model.options.background!=='ign-photo'||!online()||typeof fetch!=='function')return;
    for(const t of model.tiles)fetch(t.url,{mode:'cors',credentials:'omit'}).then(r=>r.ok?r.arrayBuffer():null).then(b=>{if(b)cache.set(t.url,new Uint8Array(b));}).catch(()=>{});
  }

  function generate(){
    const form=doc.getElementById('plan-form');if(!form)return;const err=form.querySelector('.form-error');
    const fail=message=>{err.textContent=message;err.classList.remove('hidden');err.focus?.();};
    const o=readForm(form);
    if(o.scope==='parcel'&&!o.parcelId)return fail('Champ obligatoire : Parcelle');
    const list=chosen(o);if(!list.length)return fail(o.scope==='selection'?'La sélection est vide : choisissez des parcelles sur la carte.':'Aucune parcelle dans cette emprise.');
    writePrefs({background:o.background,colorMode:o.colorMode,labels:o.labels,table:o.table});
    const data=state(),selectionLabel=o.scope==='parcel'?`Parcelle ${list[0].nom||''}`.trim():o.scope==='selection'?`Sélection de ${list.length} ${list.length>1?'parcelles':'parcelle'}`:'';
    const model=farmPlanModel({parcels:list,farmName:data.exploitation?.nom||'Mon exploitation',campaign:campaignFor(),options:o,infoFor:infoFor(o.colorMode),selectionLabel});
    const title=planTitle(model),tiles=new Map();
    closeModal();
    const how=openPrintable(farmPlanHtml(model,{assetBase:assetBase()}),title,{pdf:{name:`${title}.pdf`,make:()=>farmPlanPdf(model,{tiles})}});
    if(how==='viewer')prefetch(model,tiles);
    toast(how==='window'?'Plan ouvert dans un nouvel onglet : « Imprimer / PDF » pour l’enregistrer.':'Plan prêt : imprimez-le ou obtenez le PDF.','success');
  }

  doc.addEventListener('click',event=>{
    const control=event.target.closest?.('[data-plan]');if(!control)return;const kind=control.dataset.plan;
    if(kind==='open'){event.preventDefault();open({scope:control.dataset.scope||null,parcelId:control.dataset.id||null});}
    else if(kind==='chip'){event.preventDefault();choose(control);}
    else if(kind==='generate'){event.preventDefault();try{generate();}catch(error){toast(error?.message||'Impossible de préparer le plan.','error');}}
  });
  doc.addEventListener('change',event=>{const form=event.target.closest?.('#plan-form');if(form)refresh(form);});

  return{open};
}
