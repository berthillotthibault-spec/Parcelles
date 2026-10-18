// n° 21 - Mode gants : classe body.gloves (jetons de taille dans design-v3.css), barre d'actions
// primaires en bas d'écran (zone pouce) et maintien de 600 ms sur les boutons de suppression.
// Chargé seulement quand la préférence est active : rien n'est ajouté au démarrage sinon.
import {glovesActive,normalizeGlovesMode,thumbActions,createHoldTracker,recordHoldConfirmation,DESTRUCTIVE_SELECTOR,HOLD_CONFIRM_MS} from './gloves.js';
import {icon} from './ui.js';
import {escapeHtml as e} from './utils.js';

export function createGlovesUI({toast=()=>{},haptic=()=>{},doc=document}={}){
  const root=doc.documentElement,body=doc.body;
  let mode='off',bar=null,observers=[],bound=false;
  const fieldOpen=()=>Boolean(doc.getElementById('field-mode'));
  const modalOpen=()=>Boolean(doc.getElementById('modal-root')?.classList.contains('has-modal'));
  const active=()=>body.classList.contains('gloves');

  function renderBar(){
    const items=active()?thumbActions(root.dataset.view||'',{readOnly:root.dataset.role==='viewer',modalOpen:modalOpen(),fieldModeOpen:fieldOpen(),quickWork:Boolean(doc.getElementById('quick-work-fab'))}):[];
    body.classList.toggle('has-thumb-bar',items.length>0);
    if(!items.length){if(bar)bar.hidden=true;return;}
    if(!bar){bar=doc.createElement('nav');bar.id='gloves-thumb-bar';bar.className='gloves-thumb-bar';bar.setAttribute('aria-label','Actions principales');body.append(bar);}
    const key=items.map(item=>item.action).join(',');
    if(bar.dataset.key!==key){
      bar.innerHTML=items.map((item,index)=>`<button type="button" class="button ${index===items.length-1?'primary':'secondary'}" data-action="${e(item.action)}">${icon(item.icon,{size:22})}<span>${e(item.label)}</span></button>`).join('');
      bar.dataset.key=key;
    }
    bar.hidden=false;
  }

  function sync(){body.classList.toggle('gloves',glovesActive(mode,{fieldModeOpen:fieldOpen()}));renderBar();describe();}

  function observe(){
    if(observers.length||typeof MutationObserver!=='function')return;
    const watch=(target,options)=>{if(!target)return;const o=new MutationObserver(sync);o.observe(target,options);observers.push(o);};
    watch(root,{attributes:true,attributeFilter:['data-view','data-role']});
    watch(doc.getElementById('modal-root'),{attributes:true,attributeFilter:['class']});
    // Le mode terrain est une section #field-mode ajoutée directement dans body.
    watch(body,{childList:true});
  }

  // Consigne lue par les lecteurs d'écran (le texte « Maintenir appuyé » du CSS leur est masqué).
  const HINT_ID='gloves-hold-hint';
  function describe(){
    if(!active())return;
    if(!doc.getElementById(HINT_ID)){const hint=doc.createElement('span');hint.id=HINT_ID;hint.className='sr-only';hint.textContent='Maintenir appuyé pour supprimer sans confirmation, ou activer pour ouvrir la confirmation.';body.append(hint);}
    for(const button of doc.querySelectorAll?.(DESTRUCTIVE_SELECTOR)||[])if(!button.hasAttribute('aria-describedby'))button.setAttribute('aria-describedby',HINT_ID);
  }

  // Maintien de confirmation : un maintien de 600 ms déclenche le bouton et inscrit un jeton que
  // confirmDelete consomme (suppression directe, avec Annuler). Un appui court, le clavier et les
  // lecteurs d'écran (dont le double-tap produit aussi des événements pointeur) ouvrent toujours la
  // fenêtre de confirmation : seul le clic de relâchement d'un maintien abouti est bloqué.
  // La jauge n'utilise que la classe .is-holding (aria-busy afficherait le petit disque de motion.css).
  function bindHold(){
    if(bound)return;bound=true;
    const tracker=createHoldTracker(),now=()=>globalThis.performance?.now?.()??Date.now();
    let target=null,pointer=null,timer=0,shortTap=null,suppress=null,replaying=false,hinted=false;
    const clear=()=>{clearTimeout(timer);if(target)target.classList.remove('is-holding');target=null;pointer=null;tracker.cancel();};
    const complete=()=>{
      const button=target;clear();if(!button?.isConnected||button.disabled)return;
      recordHoldConfirmation();haptic();suppress={button,until:now()+1200};
      replaying=true;try{button.click();}finally{replaying=false;}
    };
    doc.addEventListener('pointerdown',event=>{
      if(!active()||event.button!==0)return;
      const button=event.target.closest?.(DESTRUCTIVE_SELECTOR);if(!button||button.disabled)return;
      clear();target=button;pointer=event.pointerId;tracker.start(event.clientX,event.clientY,now());
      button.classList.add('is-holding');timer=setTimeout(complete,HOLD_CONFIRM_MS);
    },true);
    doc.addEventListener('pointermove',event=>{if(target&&event.pointerId===pointer&&!tracker.move(event.clientX,event.clientY))clear();},true);
    const release=event=>{if(!target||event.pointerId!==pointer)return;if(event.type==='pointerup')shortTap={button:target,at:now()};clear();};
    doc.addEventListener('pointerup',release,true);
    doc.addEventListener('pointercancel',release,true);
    doc.addEventListener('contextmenu',event=>{if(active()&&event.target.closest?.(DESTRUCTIVE_SELECTOR))event.preventDefault();},true);
    doc.addEventListener('focusin',event=>{if(event.target?.closest?.(DESTRUCTIVE_SELECTOR))describe();},true);
    doc.addEventListener('click',event=>{
      if(replaying)return;
      const button=event.target.closest?.(DESTRUCTIVE_SELECTOR);if(!button)return;
      const stop=()=>{event.preventDefault();event.stopImmediatePropagation();};
      // Le relâchement qui suit un maintien abouti ne doit pas rouvrir la confirmation.
      if(suppress?.button===button&&now()<suppress.until){suppress=null;stop();return;}
      if(!active()||shortTap?.button!==button||now()-shortTap.at>1000)return;
      // Appui court : la fenêtre s'ouvre quand même ; l'astuce du maintien n'est montrée qu'une fois.
      shortTap=null;if(!hinted){hinted=true;toast('Astuce : maintenez le bouton appuyé pour supprimer sans confirmation.');}
    },true);
  }

  function apply(next){
    mode=normalizeGlovesMode(next);
    if(mode==='off'){
      for(const o of observers)o.disconnect();observers=[];
      body.classList.remove('gloves','has-thumb-bar');bar?.remove();bar=null;doc.getElementById('gloves-hold-hint')?.remove();return;
    }
    observe();bindHold();sync();
  }

  return {apply,sync,get mode(){return mode;}};
}
