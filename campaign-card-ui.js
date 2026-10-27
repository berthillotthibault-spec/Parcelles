// n° 88 — interface de la carte « Ma campagne » (repliable, montants masqués « •••• € »).
import {escapeHtml as e} from './utils.js';
import {campaignCardModel,billingHomeModel,campaignTreasuryModel,MIN_RELIABILITY} from './campaign-card.js';

const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
const KEY='parcelles:campaign-card';
const readPref=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch{return{};}};
const writePref=v=>{try{localStorage.setItem(KEY,JSON.stringify(v));}catch{}};

export function createCampaignCardUI({role,today=()=>new Date(),onHideBilling=null,treasuryLow=null}={}){
  let revealed=false,lowFor=null,low=null;
  // n° 88 : point bas calculé à la demande (treasury.js n'est pas dans le graphe de démarrage), une fois par état.
  function refreshLow(data){
    if(!treasuryLow||data===lowFor)return;lowFor=data;low=null;
    Promise.resolve().then(()=>treasuryLow(data)).then(v=>{if(lowFor===data){low=v||null;render(data);}},()=>{});
  }
  function treasuryHtml(){
    const t=campaignTreasuryModel(low,{role:role()});if(!t)return'';
    return`<p class="campaign-treasury"><span>Point bas de trésorerie</span> <button type="button" class="campaign-reveal" data-campaign-reveal aria-pressed="${revealed}" aria-label="${revealed?'Masquer les montants':'Afficher les montants'}">${e(money(t.balance))}</button> <small>fin ${e(t.label)}${t.negative?' · négatif':''}</small> <button type="button" class="text-button" data-action="open-treasury">Voir</button></p>`;
  }
  const money=v=>revealed?`${v<0?'−':''}${n0.format(Math.abs(v))} €`:'•••• €';
  function ensureCard(){
    let card=document.querySelector('[data-home-card="campaign"]');
    if(card)return card;
    const anchor=document.querySelector('[data-home-card="today"]');if(!anchor)return null;
    card=document.createElement('article');card.className='panel campaign-card';card.dataset.homeCard='campaign';
    anchor.parentElement.append(card);return card;
  }
  // Facturation (vague 13) : carte compacte des factures en retard, juste après « À faire maintenant ».
  function renderBilling(data){
    let card=document.getElementById('home-billing-card');
    const m=billingHomeModel(data,{role:role(),enabled:data?.preferences?.billingHomeCard!==false});
    if(m.hidden){if(card){card.hidden=true;card.innerHTML='';}return;}
    if(!card){card=document.createElement('article');card.id='home-billing-card';card.className='panel bh-home-card';card.setAttribute('aria-label','Facturation');}
    card.hidden=false;
    card.innerHTML=`<button type="button" class="bh-home-main" data-action="open-invoices" data-tab="afaire"><span class="bh-home-text"><strong>${e(m.text)} · ${e(`${n0.format(Math.round(m.amount)).replace(/\u202f/g,'\u00a0')}\u00a0€`)}</strong>${m.detail?`<small>${e(m.detail)}</small>`:''}</span><span class="bh-home-cta">Relancer</span></button><button type="button" class="text-button bh-home-hide" data-billing-home-hide aria-label="Masquer la carte des factures en retard">Masquer</button>`;
    // « Masquer » : la carte disparaît ; le focus passe à la carte suivante de l’accueil (jamais sur <body>).
    card.querySelector('[data-billing-home-hide]').onclick=async()=>{
      const next=card.nextElementSibling;await onHideBilling?.();
      requestAnimationFrame(()=>{const a=document.activeElement;if(a&&a!==document.body&&!card.contains(a))return;
        let target=next;while(target&&(target.hidden||target.classList.contains('hidden')))target=target.nextElementSibling;
        if(!target)return;const inner=target.querySelector('button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])');
        if(inner){inner.focus({preventScroll:true});return;}if(!target.hasAttribute('tabindex'))target.setAttribute('tabindex','-1');target.focus({preventScroll:true});});
    };
    placeBilling(card);
  }
  function placeBilling(card=document.getElementById('home-billing-card')){const anchor=document.querySelector('[data-home-card="today"]');if(card&&anchor&&anchor.nextElementSibling!==card)anchor.after(card);}
  function render(data){
    renderBilling(data);
    const card=ensureCard();if(!card)return;
    const m=campaignCardModel(data,{role:role()});
    if(m.hidden){card.classList.add('hidden');card.innerHTML='';card.dataset.roleHidden='1';return;}
    delete card.dataset.roleHidden;
    refreshLow(data);
    const collapsed=readPref().collapsed===true;
    const figures=m.reliable?`<dl class="campaign-figures"><div><dt>Marge estimée</dt><dd><button type="button" class="campaign-reveal" data-campaign-reveal aria-pressed="${revealed}" aria-label="${revealed?'Masquer les montants':'Afficher les montants'}">${e(money(m.margin))}</button></dd><small>fiable à ${m.reliability} %</small></div><div><dt>Écart N−1</dt><dd>${m.delta===null?'—':e((m.delta>=0?'+':'')+money(m.delta))}</dd><small>${e(m.previous)}</small></div><div><dt>Récolte vendue</dt><dd>${m.sold===null?'—':`${n0.format(m.sold*100)} %`}</dd><small>ventes et contrats</small></div><div><dt>À facturer</dt><dd>${m.toBillCount?e(money(m.toBill)):'—'}</dd><small>${m.toBillCount?`${m.toBillCount} prestation${m.toBillCount>1?'s':''}`:'rien en attente'}</small></div></dl>`
      :`<p class="campaign-unreliable">Chiffres masqués : fiabilité de ${m.reliability} % (moins de ${MIN_RELIABILITY} %).${m.detail?` ${e(m.detail)}.`:''}</p>`;
    const action=m.action?(m.action.kind==='costs'?`<button type="button" class="campaign-action" data-cost="complete" data-campaign="${e(m.campaign)}">${e(m.action.text)}</button>`
      :`<button type="button" class="campaign-action" data-action="${m.action.kind==='invoice'?'open-invoices':'open-statistics'}">${e(m.action.text)}</button>`):'';
    card.innerHTML=`<div class="panel-heading"><h2>Ma campagne ${e(m.campaign)}</h2><button type="button" class="text-button campaign-toggle" data-campaign-toggle aria-expanded="${!collapsed}">${collapsed?'Afficher':'Replier'}</button></div><div class="campaign-body" ${collapsed?'hidden':''}>${figures}${treasuryHtml()}${action}</div>`;
    card.querySelector('[data-campaign-toggle]').onclick=()=>{writePref({...readPref(),collapsed:!collapsed});render(data);};
    for(const reveal of card.querySelectorAll('[data-campaign-reveal]'))reveal.onclick=()=>{revealed=!revealed;render(data);};
  }
  // Après la mise en page de l’accueil : la carte reste cachée au rôle lecture seule.
  function enforce(){const card=document.querySelector('[data-home-card="campaign"]');if(card?.dataset.roleHidden)card.classList.add('hidden');placeBilling();}
  return{render,enforce};
}
