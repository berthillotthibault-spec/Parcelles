// n° 105 : carte « Votre journée » (module différé, chargé par l'accueil seulement après 17 h).
// Les boutons réutilisent les actions existantes d'app.js (finish-work, postpone-work,
// suggest-work-from-track, open-integration-track) ; la sortie de stock implicite passe par
// applyWorkEffects (work-effects.js) après une confirmation explicite. Rien n'est écrit sans un clic.
import {composeDayReview} from './day-review.js';
import {applyWorkEffects} from './work-effects.js';
import {escapeHtml,formatNumber} from './utils.js';

export function createDayReviewUI({store,state,modal,closeModal,toast,now=()=>new Date(),canWrite=()=>true}){
  let pending=null;
  const parcelName=(data,id)=>(data.parcelles||[]).find(p=>p.id===id&&!p.deletedAt)?.nom||'';
  const workLabel=(data,w)=>[w.type||'Travail',parcelName(data,w.parcelId)].filter(Boolean).join(' · ');
  const plural=(n,one,many)=>`${n} ${n>1?many:one}`;

  // Lecteur (rôle viewer) : résumé et « Voir » seulement, aucune action d'écriture.
  function html(review,data){
    const write=canWrite();
    const remaining=review.remaining.map(w=>{const label=workLabel(data,w);return `<li><span>${escapeHtml(label)}</span>${write?`<span class="dr-actions"><button type="button" class="text-button" data-action="finish-work" data-id="${escapeHtml(w.id)}" aria-label="${escapeHtml(`Marquer fait : ${label}`)}">Fait</button><button type="button" class="text-button" data-action="postpone-work" data-id="${escapeHtml(w.id)}" aria-label="${escapeHtml(`Reporter à demain : ${label}`)}">Reporter à demain</button></span>`:''}</li>`;}).join('');
    const tracks=review.tracks.map(t=>{const prepare=`Préparer ${t.parcelCount>1?'les travaux':'le travail'}`;return `<li><span>Trace « ${escapeHtml(t.name)} » non rattachée</span><span class="dr-actions">${write&&t.parcelCount?`<button type="button" class="text-button" data-action="suggest-work-from-track" data-id="${escapeHtml(t.id)}" aria-label="${escapeHtml(`${prepare} de la trace ${t.name}`)}">${escapeHtml(prepare)}</button>`:''}<button type="button" class="text-button" data-action="open-integration-track" data-id="${escapeHtml(t.id)}" aria-label="${escapeHtml(`Voir la trace ${t.name}`)}">Voir</button></span></li>`;}).join('');
    const stock=review.stockExits.map(x=>`<li><span>Sortie de stock ? ${escapeHtml(formatNumber(x.quantity))} ${escapeHtml(x.unit)} de ${escapeHtml(x.stockName)}${x.alreadyOut>0?` (${escapeHtml(formatNumber(x.alreadyOut))} ${escapeHtml(x.unit)} déjà sortis aujourd’hui)`:''}</span>${write?`<span class="dr-actions"><button type="button" class="text-button" data-dr-stock="${escapeHtml(x.workId)}" aria-label="${escapeHtml(`Vérifier la sortie de stock de ${x.stockName}`)}">Vérifier</button></span>`:''}</li>`).join('');
    const summary=`${plural(review.done.length,'travail fait','travaux faits')} · ${plural(review.remaining.length,'restant','restants')}`;
    return `<h3>Votre journée</h3><p>${escapeHtml(summary)}</p>${remaining||tracks||stock?`<ul class="dr-list">${remaining}${tracks}${stock}</ul>`:''}`;
  }

  // Ajoute (ou remplace) la section dans la carte #day-review que renderDailyBrief vient de redessiner.
  function render(root){
    if(!root)return;
    root.querySelector('.day-review-evening')?.remove();
    const data=state(),review=composeDayReview(data,now());
    if(!review.show||review.empty)return;
    const section=document.createElement('section');
    section.className='day-review-evening';section.setAttribute('aria-label','Votre journée');
    section.innerHTML=html(review,data);
    section.addEventListener('click',event=>{const id=event.target.closest?.('[data-dr-stock]')?.dataset.drStock;if(id)openStockExit(id);});
    root.append(section);
  }

  function openStockExit(workId){
    const data=state(),exit=composeDayReview(data,now()).stockExits.find(x=>x.workId===workId),work=(data.interventions||[]).find(w=>w.id===workId);
    if(!exit||!work){toast('Cette sortie de stock n’est plus à proposer.');return;}
    if(!canWrite()){toast('Lecture seule : sortie de stock impossible.','error');return;}
    pending={workId,version:work.version,stockItemId:exit.stockItemId};
    const balance=exit.balance===null?'inconnu':`${formatNumber(exit.balance)} → ${formatNumber(Math.max(0,exit.balanceAfter))} ${exit.unit}`;
    modal('Sortie de stock',`${workLabel(data,work)}`,
      `<p>${escapeHtml(`${formatNumber(work.dose)} ${work.doseUnit||''} × ${formatNumber(work.surfaceWorked)} ha = ${formatNumber(exit.quantity)} ${exit.unit} de ${exit.stockName}.`)}</p><p>${escapeHtml(`Stock : ${balance}`)}</p>${exit.alreadyOut>0?`<p class="form-error">${escapeHtml(`Une sortie de ${formatNumber(exit.alreadyOut)} ${exit.unit} a déjà été saisie aujourd’hui pour cet article : vérifiez qu’elle ne correspond pas à ce travail.`)}</p>`:''}${exit.insufficient?'<p class="form-error">Stock insuffisant ou inconnu : corrigez d’abord le stock.</p>':'<p class="form-error hidden" id="dr-stock-error"></p>'}`,
      `<button class="button secondary" data-action="close-modal">Annuler</button>${exit.insufficient?'':'<button class="button primary" id="dr-stock-confirm">Confirmer la sortie</button>'}`);
    document.getElementById('dr-stock-confirm')?.addEventListener('click',confirmStockExit,{once:true});
  }

  async function confirmStockExit(){
    const job=pending;pending=null;if(!job)return;
    try{
      await applyWorkEffects(store,job.workId,{stockItemId:job.stockItemId},{expectedVersion:job.version});
      closeModal();toast('Sortie de stock enregistrée.','success');
    }catch(error){
      const box=document.getElementById('dr-stock-error');
      if(box){box.textContent=error.message||'Sortie impossible.';box.classList.remove('hidden');}else toast(error.message||'Sortie impossible.','error');
    }
  }

  return {render};
}
