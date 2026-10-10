// n° 88 — interface de la carte « Ma campagne » (repliable, montants masqués « •••• € »).
import {escapeHtml as e} from './utils.js';
import {campaignCardModel,MIN_RELIABILITY} from './campaign-card.js';

const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
const KEY='parcelles:campaign-card';
const readPref=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch{return{};}};
const writePref=v=>{try{localStorage.setItem(KEY,JSON.stringify(v));}catch{}};

export function createCampaignCardUI({role,today=()=>new Date()}={}){
  let revealed=false;
  const money=v=>revealed?`${v<0?'−':''}${n0.format(Math.abs(v))} €`:'•••• €';
  function ensureCard(){
    let card=document.querySelector('[data-home-card="campaign"]');
    if(card)return card;
    const anchor=document.querySelector('[data-home-card="today"]');if(!anchor)return null;
    card=document.createElement('article');card.className='panel campaign-card';card.dataset.homeCard='campaign';
    anchor.parentElement.append(card);return card;
  }
  function render(data){
    const card=ensureCard();if(!card)return;
    const m=campaignCardModel(data,{role:role()});
    if(m.hidden){card.classList.add('hidden');card.innerHTML='';card.dataset.roleHidden='1';return;}
    delete card.dataset.roleHidden;
    const collapsed=readPref().collapsed===true;
    const figures=m.reliable?`<dl class="campaign-figures"><div><dt>Marge estimée</dt><dd><button type="button" class="campaign-reveal" data-campaign-reveal aria-pressed="${revealed}" aria-label="${revealed?'Masquer les montants':'Afficher les montants'}">${e(money(m.margin))}</button></dd><small>fiable à ${m.reliability} %</small></div><div><dt>Écart N−1</dt><dd>${m.delta===null?'—':e((m.delta>=0?'+':'')+money(m.delta))}</dd><small>${e(m.previous)}</small></div><div><dt>Récolte vendue</dt><dd>${m.sold===null?'—':`${n0.format(m.sold*100)} %`}</dd><small>ventes et contrats</small></div><div><dt>À facturer</dt><dd>${m.toBillCount?e(money(m.toBill)):'—'}</dd><small>${m.toBillCount?`${m.toBillCount} prestation${m.toBillCount>1?'s':''}`:'rien en attente'}</small></div></dl>`
      :`<p class="campaign-unreliable">Chiffres masqués : fiabilité de ${m.reliability} % (moins de ${MIN_RELIABILITY} %).${m.detail?` ${e(m.detail)}.`:''}</p>`;
    const action=m.action?(m.action.kind==='costs'?`<button type="button" class="campaign-action" data-cost="complete" data-campaign="${e(m.campaign)}">${e(m.action.text)}</button>`
      :`<button type="button" class="campaign-action" data-action="${m.action.kind==='invoice'?'open-invoices':'open-statistics'}">${e(m.action.text)}</button>`):'';
    card.innerHTML=`<div class="panel-heading"><h2>Ma campagne ${e(m.campaign)}</h2><button type="button" class="text-button campaign-toggle" data-campaign-toggle aria-expanded="${!collapsed}">${collapsed?'Afficher':'Replier'}</button></div><div class="campaign-body" ${collapsed?'hidden':''}>${figures}${action}</div>`;
    card.querySelector('[data-campaign-toggle]').onclick=()=>{writePref({...readPref(),collapsed:!collapsed});render(data);};
    const reveal=card.querySelector('[data-campaign-reveal]');if(reveal)reveal.onclick=()=>{revealed=!revealed;render(data);};
  }
  // Après la mise en page de l’accueil : la carte reste cachée au rôle lecture seule.
  function enforce(){const card=document.querySelector('[data-home-card="campaign"]');if(card?.dataset.roleHidden)card.classList.add('hidden');}
  return{render,enforce};
}
