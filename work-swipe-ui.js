// n° 31 - Lignes de travaux du jour : métadonnées utiles et balayage (droite = Fait, gauche = Demain).
// Les mêmes actions restent disponibles par boutons (case « Marquer terminé », menu « Reporter à demain »).
import {workMeta,postponedWork,createSwipeTracker} from './work-list.js';
import {escapeHtml as e} from './utils.js';

export function createWorkSwipeUI({store,toast,today,haptic=()=>{}}){
  const reduced=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Trois emplacements fixes (surface, matériel, opérateur) : grille alignée sur ordinateur.
  function metaHtml(work){
    const parcel=work?.parcelId?store.get('parcelles',work.parcelId):null,machine=work?.equipmentId?store.get('materiels',work.equipmentId):null;
    const surface=workMeta({surfaceWorked:work?.surfaceWorked},{parcel})[0]||'',name=machine?.nom||'',op=work?.operator||'';
    if(!surface&&!name&&!op)return '';
    return `<span class="row-meta"><span class="m-surface">${e(surface)}</span><span class="m-machine">${e(name)}</span><span class="m-operator">${e(op)}</span></span>`;
  }

  async function postpone(id){
    const w=store.get('interventions',id);if(!w||['Terminé','Annulé'].includes(w.status))return false;
    await store.upsert('interventions',postponedWork(w,today()),{label:`Travail reporté : ${w.type||'Travail'}`});
    toast('Travail reporté à demain.','success',{label:'Annuler',run:()=>store.upsert('interventions',w,{label:'Report annulé'})});
    return true;
  }

  function attach(list){
    if(!list||list.dataset.swipeBound)return;list.dataset.swipeBound='1';
    const tracker=createSwipeTracker({threshold:Math.min(110,Math.max(72,(list.clientWidth||360)*0.28)),lockPx:8});
    let row=null,pointer=null,crossed=null,suppress=false;
    const reset=()=>{if(!row)return;const r=row;r.classList.remove('is-swiping');r.style.removeProperty('--swipe-x');delete r.dataset.swipeDir;if(!reduced()){r.classList.add('is-settling');setTimeout(()=>r.classList.remove('is-settling'),220);}row=null;pointer=null;crossed=null;};
    list.addEventListener('pointerdown',ev=>{
      if(ev.button!==0||ev.pointerType==='mouse'&&!ev.isPrimary)return;
      const r=ev.target.closest('.work-row[data-swipe]');if(!r||ev.target.closest('.row-check,.row-more'))return;
      row=r;pointer=ev.pointerId;crossed=null;tracker.start(ev.clientX,ev.clientY);
    });
    list.addEventListener('pointermove',ev=>{
      if(!row||ev.pointerId!==pointer)return;
      const m=tracker.move(ev.clientX,ev.clientY);
      if(m.axis==='y'){reset();tracker.cancel();return;}
      if(m.axis!=='x')return;
      if(!row.classList.contains('is-swiping')){row.classList.add('is-swiping');try{row.setPointerCapture(pointer);}catch{}}
      row.style.setProperty('--swipe-x',`${m.dx}px`);row.dataset.swipeDir=m.dx>0?'done':'postpone';
      if(m.crossed!==crossed){crossed=m.crossed;row.classList.toggle('is-armed',Boolean(crossed));if(crossed)haptic();}
    });
    const finish=async ev=>{
      if(!row||ev.pointerId!==pointer)return;
      const r=row,result=tracker.end(),moved=r.classList.contains('is-swiping');r.classList.remove('is-armed');reset();
      if(moved){suppress=true;setTimeout(()=>{suppress=false;},400);}
      if(result==='done')r.querySelector('[data-action="finish-work"]')?.click();
      else if(result==='postpone'){try{await postpone(r.dataset.id);}catch(error){toast(error.message,'error');}}
    };
    list.addEventListener('pointerup',finish);
    list.addEventListener('pointercancel',ev=>{if(row&&ev.pointerId===pointer){tracker.cancel();row.classList.remove('is-armed');reset();}});
    // Un balayage ne doit pas ouvrir le travail au relâchement.
    list.addEventListener('click',ev=>{if(suppress&&ev.isTrusted){suppress=false;ev.stopPropagation();ev.preventDefault();}},true);
  }
  return{metaHtml,postpone,attach};
}
