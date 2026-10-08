// Brouillons automatiques des formulaires (n° 16). Un appel, l’appareil photo ou iOS qui ferme l’application
// en arrière-plan ne fait plus perdre une saisie : les champs (jamais les fichiers) sont gardés dans
// localStorage, par appareil, et proposés à la réouverture du même formulaire.
import {escapeHtml} from './utils.js';

export const DRAFT_PREFIX='parcelles:draft:';
export const DRAFT_MAX_AGE_MS=7*86400000;
const SAVE_DELAY_MS=400;

export function draftKey(type,id){return `${DRAFT_PREFIX}${type}:${id?String(id):'nouveau'}`;}

function defaultStorage(){try{return globalThis.localStorage||null;}catch{return null;}}
export function readDraft(key,{storage=defaultStorage(),at=Date.now()}={}){
  try{
    const raw=storage?.getItem(key);if(!raw)return null;
    const draft=JSON.parse(raw);
    if(!draft||typeof draft.fields!=='object'||!Number.isFinite(draft.savedAt))return null;
    if(at-draft.savedAt>DRAFT_MAX_AGE_MS){storage.removeItem(key);return null;}
    return draft;
  }catch{return null;}
}
export function writeDraft(key,fields,{storage=defaultStorage(),at=Date.now()}={}){
  try{storage?.setItem(key,JSON.stringify({v:1,savedAt:at,fields}));return true;}catch{return false;}
}
export function removeDraft(key,{storage=defaultStorage()}={}){try{storage?.removeItem(key);}catch{}}
// Brouillons trop anciens retirés (au démarrage) : ils ne s’accumulent pas sur l’appareil.
export function purgeStaleDrafts({storage=defaultStorage(),at=Date.now()}={}){
  try{
    const keys=[];for(let i=0;i<(storage?.length||0);i++){const key=storage.key(i);if(key?.startsWith(DRAFT_PREFIX))keys.push(key);}
    for(const key of keys)readDraft(key,{storage,at});
  }catch{}
}

// Valeurs des champs nommés, sans fichier ni mot de passe. Une case à cocher vaut true/false ; une liste multiple, un tableau.
export function serializeForm(form,{only=null,exclude=[]}={}){
  const fields={};
  for(const el of Array.from(form?.elements||[])){
    const name=el.name;if(!name||el.disabled)continue;
    if(only&&!only.includes(name))continue;
    if(exclude.includes(name))continue;
    const type=String(el.type||'').toLowerCase();
    if(['file','password','submit','button','reset'].includes(type))continue;
    if(type==='checkbox'){fields[name]=Boolean(el.checked);continue;}
    if(type==='radio'){if(el.checked)fields[name]=el.value;else if(!(name in fields))fields[name]=null;continue;}
    if(el.multiple&&el.options){fields[name]=Array.from(el.options).filter(o=>o.selected).map(o=>o.value);continue;}
    fields[name]=String(el.value??'');
  }
  return fields;
}
export function sameFields(a,b){return JSON.stringify(a||{})===JSON.stringify(b||{});}

export function applyFields(form,fields){
  for(const [name,value] of Object.entries(fields||{})){
    const list=Array.from(form.elements||[]).filter(el=>el.name===name);
    for(const el of list){
      const type=String(el.type||'').toLowerCase();
      if(type==='checkbox')el.checked=Boolean(value);
      else if(type==='radio')el.checked=el.value===value;
      else if(el.multiple&&el.options&&Array.isArray(value))for(const o of el.options)o.selected=value.includes(o.value);
      else el.value=value??'';
      el.dispatchEvent?.(new Event('input',{bubbles:true}));el.dispatchEvent?.(new Event('change',{bubbles:true}));
    }
  }
  // Pastilles de choix (bindChipChoices) : l’état visuel suit le champ caché restauré.
  form.querySelectorAll?.('.chip-choices[data-chip-target]').forEach(group=>{
    const input=form.querySelector(`input[name="${group.dataset.chipTarget}"]`);if(!input)return;
    group.querySelectorAll('.choice-chip').forEach(chip=>{const on=chip.dataset.value===input.value;chip.classList.toggle('is-on',on);chip.setAttribute('aria-pressed',String(on));});
  });
}

export function draftTimeLabel(savedAt,at=Date.now()){
  const d=new Date(savedAt),today=new Date(at),p=n=>String(n).padStart(2,'0');
  const time=`${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.toDateString()===today.toDateString()?time:`${p(d.getDate())}/${p(d.getMonth()+1)} à ${time}`;
}

// Branche le brouillon sur un formulaire déjà affiché. Retourne { clear(), save(), dispose() }.
// clear() : à appeler après un enregistrement réussi ; le bouton « Annuler » du pied de fenêtre purge aussi.
export function persistFormDraft(form,key,{only=null,exclude=[],cancelSelector='',storage=defaultStorage(),doc=globalThis.document}={}){
  const noop={clear(){},save(){},dispose(){}};
  if(!form||!key||!storage)return noop;
  const initial=serializeForm(form,{only,exclude});
  let timer=null,disposed=false,touched=false;
  const save=()=>{
    clearTimeout(timer);timer=null;
    if(disposed||!touched)return;
    if(!form.isConnected){dispose();return;}
    const fields=serializeForm(form,{only,exclude});
    if(sameFields(fields,initial))removeDraft(key,{storage});else writeDraft(key,fields,{storage});
  };
  const schedule=()=>{touched=true;clearTimeout(timer);timer=setTimeout(save,SAVE_DELAY_MS);};
  const onVisibility=()=>{if(doc.visibilityState==='hidden')save();};
  const onPageHide=()=>save();
  const onCancel=event=>{
    if(!form.isConnected){dispose();return;}
    const selector=['.modal-footer [data-action="close-modal"]',cancelSelector].filter(Boolean).join(',');
    if(event.target?.closest?.(selector))clear();
  };
  function dispose(){if(disposed)return;disposed=true;clearTimeout(timer);doc?.removeEventListener?.('visibilitychange',onVisibility);globalThis.removeEventListener?.('pagehide',onPageHide);doc?.removeEventListener?.('click',onCancel,true);}
  function clear(){dispose();removeDraft(key,{storage});form.querySelector?.('.draft-banner')?.remove();}
  form.addEventListener('input',schedule);form.addEventListener('change',schedule);
  // Les pastilles de choix modifient un champ caché sans événement « input ».
  form.addEventListener('click',event=>{if(event.target?.closest?.('.choice-chip'))schedule();});
  doc?.addEventListener?.('visibilitychange',onVisibility);globalThis.addEventListener?.('pagehide',onPageHide);doc?.addEventListener?.('click',onCancel,true);

  // Brouillon précédent différent de la fiche affichée : proposer de le reprendre.
  const previous=readDraft(key,{storage});
  if(previous&&!sameFields(previous.fields,initial)&&doc?.createElement){
    const banner=doc.createElement('div');banner.className='draft-banner';banner.setAttribute('role','status');
    banner.innerHTML=`<span>Reprendre la saisie de ${escapeHtml(draftTimeLabel(previous.savedAt))} ?</span><span class="draft-banner-actions"><button type="button" class="button primary" data-draft="resume">Reprendre</button><button type="button" class="button secondary" data-draft="discard">Jeter</button></span>`;
    banner.querySelector('[data-draft="resume"]').addEventListener('click',()=>{applyFields(form,previous.fields);banner.remove();touched=true;save();form.querySelector('input:not([type=hidden]),textarea,select')?.focus?.({preventScroll:true});});
    banner.querySelector('[data-draft="discard"]').addEventListener('click',()=>{removeDraft(key,{storage});banner.remove();});
    form.prepend(banner);
  }
  return {clear,save,dispose};
}
