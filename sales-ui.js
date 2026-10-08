// Interface de la commercialisation (n° 82) : section du Pilotage, formulaire de contrat,
// liaison des ventes des lots et objectif de marge. Boutons repérés par data-sales :
// un seul écouteur délégué, installé une fois.
import {escapeHtml as e,campaignFor,formatEuro} from './utils.js';
import {active} from './farm-memory.js';
import {CONTRACT_TYPES,commercialisation,contracts,contractProgress,contractTypeLabel,linkableSales,saveContract,deleteContract,linkSale,setMarginTarget} from './sales.js';
import {costPriceByCulture} from './costs.js';

const NB=' ',colon=`${NB}:`;
const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}),n1=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}),n2=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2});
const eur=v=>`${n0.format(v)}${NB}€`,perT=v=>`${n0.format(v)}${NB}€/t`,tonnes=v=>`${n1.format(v)}${NB}t`;
const pct=v=>`${n0.format(Math.round(v*100))}${NB}%`;
const plural=(count,one,many)=>`${count===0?'0':n0.format(count)} ${count>1?many:one}`;
const dateFr=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:'';};
const prevCampaign=c=>{const y=Number(String(c).slice(0,4));return`${y-1}/${String(y%100).padStart(2,'0')}`;};
const nextCampaign=c=>{const y=Number(String(c).slice(0,4))+1;return`${y}/${String((y+1)%100).padStart(2,'0')}`;};
const PRICE_LABEL={ferme:'Prix ferme (€/t) *',moyen:'Prix moyen estimé ou acompte (€/t)','a-fixer':'Prix indicatif (€/t)'};
const PRICE_HELP={ferme:'Prix net convenu par tonne, hors prime.',moyen:'Facultatif. Sans prix ferme, ce prix reste indicatif jusqu’au prix définitif de la coopérative.','a-fixer':'Facultatif. Le tonnage est engagé mais le prix sera fixé plus tard : il reste indicatif.'};

export function salesBar(row){
  if(!(row.volume>0))return'';const sold=Math.min(1,row.sold/row.volume),contracted=Math.min(1-sold,row.contracted/row.volume);
  const label=`${pct(row.sold/row.volume)} vendu, ${pct(row.contracted/row.volume)} sous contrat, ${tonnes(row.remaining)} restant à vendre sur ${tonnes(row.volume)}`;
  return`<div class="sales-bar" role="img" aria-label="${e(label)}"><span class="is-sold" style="width:${(sold*100).toFixed(1)}%"></span><span class="is-contract" style="width:${(contracted*100).toFixed(1)}%"></span></div>`;
}

function headline(row){
  if(!(row.volume>0))return`<p class="sales-headline">Volume inconnu${colon} renseignez le rendement prévu des parcelles ou un lot de récolte.</p>`;
  const share=row.share??0,price=row.averagePrice!==null?` à <strong>${e(perT(row.averagePrice))}</strong> moyen`:row.indicativeAverage!==null?` à <strong>${e(perT(row.indicativeAverage))}</strong> moyen (indicatif)`:row.engaged>0?' · prix encore à fixer':'';
  return`<p class="sales-headline"><strong>${e(pct(share))}</strong> commercialisé${price}</p>`;
}

function contractLine(p,canWrite){
  const c=p.contract,price=p.price!==null?`${perT(p.price)}${p.firm?'':' indicatif'}`:'prix à fixer',meta=[`${tonnes(Number(c.tonnes)||0)} · ${price}`,`livré ${tonnes(p.delivered)} (${pct(p.share)})`,c.deliveryDate?`livraison ${dateFr(c.deliveryDate)}`:'',c.paymentDate?`paiement ${dateFr(c.paymentDate)}`:''].filter(Boolean).join(' · ');
  const inner=`<span class="sales-contract-head"><strong>${e(c.buyer||'Acheteur')}</strong><span class="sales-type">${e(contractTypeLabel(c.type))}</span></span><small>${e(meta)}${p.over>0?` · <span class="sales-warn">${e(tonnes(p.over))} livrées au-delà du contrat</span>`:''}</small><span class="sales-mini" aria-hidden="true"><span style="width:${(p.share*100).toFixed(1)}%"></span></span>`;
  return canWrite?`<button type="button" class="sales-contract" data-sales="edit" data-id="${e(c.id)}" aria-label="${e(`Modifier le contrat ${c.buyer||''} (${contractTypeLabel(c.type)})`)}">${inner}</button>`:`<div class="sales-contract">${inner}</div>`;
}

function cultureCard(row,campaign,canWrite){
  const volumeText=row.volume>0?`${tonnes(row.volume)} ${row.volumeSource==='lots'?'récoltées (lots)':'estimées'}`:'volume inconnu';
  const head=`<header><strong>${e(row.culture)}</strong><small>${row.area>0?`${e(n2.format(row.area))}${NB}ha · `:''}${e(volumeText)}</small></header>`;
  const remaining=row.overCommitted>0?`<div><dt>Reste à vendre</dt><dd class="is-loss">−${e(tonnes(row.overCommitted))}</dd><small>engagé au-delà du volume</small></div>`:`<div><dt>Reste à vendre</dt><dd>${row.volume>0?e(tonnes(row.remaining)):'—'}</dd><small>${row.volume>0?`${e(pct(row.remaining/row.volume))} du volume`:'volume à renseigner'}</small></div>`;
  const goal=row.target?`objectif ${eur(row.target)}/ha`:'couvrir les charges';
  const required=row.requiredPrice===null?`<div><dt>Prix nécessaire</dt><dd>—</dd><small>${row.charges>0||row.target?'aucun tonnage restant':'charges inconnues'}</small></div>`:row.targetReached?`<div><dt>Prix nécessaire</dt><dd class="is-gain">Atteint</dd><small>${e(goal)} avec les prix connus</small></div>`:`<div><dt>Prix nécessaire</dt><dd>${e(perT(row.requiredPrice))}</dd><small>sur le reste pour ${e(goal)}</small></div>`;
  const figures=`<dl class="cost-figures"><div><dt>Déjà vendu</dt><dd>${e(tonnes(row.sold))}</dd><small>${e(plural(row.salesCount,'vente des lots','ventes des lots'))}</small></div><div><dt>Sous contrat</dt><dd>${e(tonnes(row.contracted))}</dd><small>reste à livrer</small></div>${remaining}${required}</dl>`;
  const sources=row.sources.map(s=>`${s.label} ${eur(s.amount)}`).join(' · ');
  const product=`<p class="sales-product">Produit brut estimé${colon} <strong>${e(eur(row.grossProduct))}</strong>${sources?` <small>(${e(sources)})</small>`:''}</p>${row.missingTonnes>0?`<p class="cost-flags">${e(tonnes(row.missingTonnes))} sans prix connu${colon} saisissez un prix de vente dans l’économie des parcelles ou un prix au contrat.</p>`:''}`;
  const list=row.contracts.length?`<div class="sales-contracts">${row.contracts.map(p=>contractLine(p,canWrite)).join('')}</div>`:'';
  const add=canWrite?`<button type="button" class="button secondary sales-add" data-sales="new" data-culture="${e(row.culture)}" data-campaign="${e(campaign)}">Ajouter un contrat</button>`:'';
  return`<article class="cost-card sales-card">${head}${headline(row)}${salesBar(row)}${figures}${product}${list}${add}</article>`;
}

export function createSalesUI(host){
  const {store,modal,toast,openStatistics}=host;
  const data=()=>store.snapshot();
  const writable=()=>!store.writeGuard||store.writeGuard({entity:'integrationImports',action:'create',farmKind:'salesContract'});
  let current=campaignFor();
  const back=(campaign=current)=>{openStatistics(campaign);requestAnimationFrame(()=>document.querySelector('#sales-title')?.scrollIntoView({block:'start'}));};

  function pilotageSection(campaign=campaignFor()){
    current=campaign;const state=data(),result=commercialisation(state,{campaign}),canWrite=writable();
    const shown=result.rows.filter(r=>r.volume>0||r.lots||r.salesCount||r.contracts.length),idle=result.rows.filter(r=>!shown.includes(r)),cards=shown.map(r=>cultureCard(r,campaign,canWrite)).join('');
    const idleText=idle.length?`<p class="cost-detail sales-idle">Sans volume connu${colon} ${e(idle.map(r=>r.culture).join(', '))}. Renseignez le rendement prévu dans l’économie des parcelles, un lot de récolte ou un contrat.</p>`:'';
    const target=result.target?`${eur(result.target)}/ha`:'aucun';
    const actions=`<div class="sales-head-actions"><button type="button" class="button secondary" data-sales="target" data-campaign="${e(campaign)}">Objectif de marge</button>${canWrite?`<button type="button" class="button primary" data-sales="new" data-campaign="${e(campaign)}">Nouveau contrat</button>`:''}</div>`;
    const summary=result.totals.volume>0?`<p class="sales-summary">${e(pct(result.totals.engaged/result.totals.volume))} du volume total vendu ou sous contrat · produit brut estimé ${e(eur(result.totals.grossProduct))}.</p>`:'';
    return`<section class="cost-price sales-section" aria-labelledby="sales-title"><div class="cost-price-head"><h3 id="sales-title">Commercialisation</h3>${actions}</div>${summary}<div class="cost-cards">${cards||`<div class="empty-state">Aucune culture à commercialiser pour ${e(campaign)}. Renseignez le rendement prévu des parcelles, un lot de récolte ou un contrat.</div>`}</div>${cards?idleText:''}<p class="cost-footnote">Indicatif. Volume = récolte estimée (rendement prévu × surface), ou lots de récolte s’ils sont plus élevés. Vendu = ventes déclarées dans les lots ; sous contrat = tonnage des contrats restant à livrer. Prix moyen = ventes au prix connu et contrats à prix ferme, primes comprises ; les prix moyens coopé et à fixer restent indicatifs. Produit brut par priorité${colon} ventes réelles, puis contrats, puis prix de vente estimé des parcelles. Prix nécessaire = (charges de campagne + charges de structure + objectif de marge × surface − montants déjà connus) ÷ tonnage sans prix. Objectif de marge${colon} ${e(target)}.</p></section>`;
  }

  function knownCultures(state,campaign){
    const set=new Map();for(const r of costPriceByCulture(state,{campaign}).rows)if(r.culture&&r.culture!=='Non renseignée')set.set(r.culture.toLowerCase(),r.culture);
    for(const p of active(state,'parcelles'))if(p.culture)set.set(p.culture.toLowerCase(),p.culture);
    for(const c of contracts(state))if(c.culture)set.set(c.culture.toLowerCase(),c.culture);
    return[...set.values()].sort((a,b)=>a.localeCompare(b,'fr'));
  }

  function deliveries(state,contract){
    const p=contractProgress(state,contract),free=linkableSales(state,contract);
    const sale=(r,linked)=>`<li class="sales-delivery"><span><strong>${e(tonnes(r.tonnes))}</strong> · ${e(dateFr(r.sale.date)||'date inconnue')} · lot ${e(r.lot.code||r.lot.name||'')}${r.price!==null?` · ${e(perT(r.price))}${r.priceSource==='contract'?' (prix du contrat)':''}`:' · sans prix'}${r.sale.buyer?` · ${e(r.sale.buyer)}`:''}</span><button type="button" class="button secondary" data-sales="${linked?'unlink':'link'}" data-lot="${e(r.lot.id)}" data-sale="${e(r.sale.id)}" data-id="${e(contract.id)}">${linked?'Détacher':'Relier'}</button></li>`;
    return`<div class="span-2 sales-deliveries"><h4>Livraisons reliées · ${e(tonnes(p.delivered))} sur ${e(tonnes(Number(contract.tonnes)||0))}</h4>${p.sales.length?`<ul>${p.sales.map(r=>sale(r,true)).join('')}</ul>`:'<p class="cost-detail">Aucune vente de lot reliée pour l’instant.</p>'}${free.length?`<h4>Ventes des lots à relier</h4><ul>${free.map(r=>sale(r,false)).join('')}</ul>`:''}</div>`;
  }

  function openContract(campaign=current,{id=null,culture=''}={}){
    current=campaign;const state=data(),existing=id?contracts(state).find(c=>c.id===id):null;if(id&&!existing){toast('Contrat introuvable.','error');return back(campaign);}
    const c=existing||{campaign,culture,type:'ferme'},camp=c.campaign||campaign,campaigns=[...new Set([prevCampaign(campaignFor()),campaignFor(),nextCampaign(campaignFor()),camp])].sort(),type=c.type||'ferme';
    const buyers=[...new Set([...contracts(state).map(x=>x.buyer),...active(state,'clients').map(x=>x.nom)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
    const chips=(name,list,value)=>`<input type="hidden" name="${name}" value="${e(value)}"><div class="chip-choices" data-chip-target="${name}" role="group">${list.map(([v,l])=>`<button type="button" class="choice-chip${v===value?' is-on':''}" data-value="${e(v)}" data-sales="chip" aria-pressed="${v===value}">${e(l)}</button>`).join('')}</div>`;
    const val=v=>v===null||v===undefined?'':e(String(v));
    const body=`<form id="sales-contract-form" class="form-grid" novalidate>${existing?`<input type="hidden" name="version" value="${e(String(existing.version??''))}">`:''}
<label class="span-2">Culture *<input name="culture" list="sales-cultures" value="${val(c.culture)}" autocomplete="off"${existing?'':' data-autofocus'}><datalist id="sales-cultures">${knownCultures(state,camp).map(x=>`<option value="${e(x)}"></option>`).join('')}</datalist></label>
<div class="field-label span-2"><span>Campagne *</span>${chips('campaign',campaigns.map(x=>[x,x]),camp)}</div>
<div class="field-label span-2"><span>Type de contrat *</span>${chips('type',CONTRACT_TYPES.map(t=>[t.id,t.label]),type)}</div>
<label class="span-2">Acheteur *<input name="buyer" list="sales-buyers" value="${val(c.buyer)}" autocomplete="off" placeholder="Ex. coopérative, négoce"><datalist id="sales-buyers">${buyers.map(x=>`<option value="${e(x)}"></option>`).join('')}</datalist></label>
<label>Tonnage (t) *<input name="tonnes" type="number" min="0" step="0.01" inputmode="decimal" value="${val(c.tonnes)}"></label>
<label><span data-sales-price-label>${e(PRICE_LABEL[type])}</span><input name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${val(c.price)}"></label>
<p class="span-2 cost-detail" data-sales-price-help>${e(PRICE_HELP[type])}</p>
<label>Prime (€/t)<input name="premium" type="number" step="0.01" inputmode="decimal" value="${val(c.premium)}" placeholder="Ex. qualité, protéines"></label>
<label>Référence<input name="reference" value="${val(c.reference)}" autocomplete="off"></label>
<label>Date de livraison<input name="deliveryDate" type="date" value="${val(c.deliveryDate)}"></label>
<label>Date de paiement<input name="paymentDate" type="date" value="${val(c.paymentDate)}"></label>
<label class="span-2">Note<input name="note" value="${val(c.note)}" autocomplete="off"></label>
<p class="span-2 form-error hidden" role="alert"></p>${existing?deliveries(state,existing):'<p class="span-2 cost-detail">Les ventes saisies dans les lots de récolte pourront ensuite être reliées à ce contrat.</p>'}</form>`;
    modal(existing?'Modifier le contrat':'Nouveau contrat',existing?`${existing.buyer} · ${existing.culture} ${existing.campaign}`:'Culture, acheteur, tonnage et prix',body,`<button type="button" class="button secondary" data-sales="back" data-campaign="${e(campaign)}">Annuler</button>${existing?`<button type="button" class="button danger" data-sales="delete" data-id="${e(existing.id)}">Supprimer</button>`:''}<button type="button" class="button primary sales-save" data-sales="save"${existing?` data-id="${e(existing.id)}"`:''}>Enregistrer le contrat</button>`,'small');
  }

  function openTarget(campaign=current){
    current=campaign;const value=data().preferences?.salesMarginTargetHa;
    modal('Objectif de marge','Utilisé pour le prix nécessaire sur le reste à vendre',`<form id="sales-target-form" class="form-grid" novalidate><label class="span-2">Marge visée (€/ha)<input name="target" type="number" min="0" step="1" inputmode="decimal" value="${value??''}" placeholder="Ex. 300" data-autofocus></label><p class="span-2 cost-detail">Marge après charges de campagne et de structure, identique pour toutes les cultures. Laissez vide pour viser seulement la couverture des charges. Valeur enregistrée sur cet appareil, pour cette exploitation.</p><p class="span-2 form-error hidden" role="alert"></p></form>`,`<button type="button" class="button secondary" data-sales="back" data-campaign="${e(campaign)}">Annuler</button><button type="button" class="button primary sales-save" data-sales="target-save">Enregistrer</button>`,'small');
  }

  const showError=(form,message)=>{const el=form?.querySelector('.form-error');if(!el)return toast(message,'error');el.textContent=message;el.classList.remove('hidden');};

  function chip(control){
    const group=control.closest('.chip-choices'),form=control.closest('form'),input=form?.querySelector(`input[name="${group?.dataset.chipTarget}"]`);if(!group||!input)return;
    input.value=control.dataset.value;group.querySelectorAll('.choice-chip').forEach(c=>{const on=c===control;c.classList.toggle('is-on',on);c.setAttribute('aria-pressed',String(on));});form.querySelector('.form-error')?.classList.add('hidden');
    if(input.name==='type'){const label=form.querySelector('[data-sales-price-label]'),help=form.querySelector('[data-sales-price-help]');if(label)label.textContent=PRICE_LABEL[input.value]||PRICE_LABEL.ferme;if(help)help.textContent=PRICE_HELP[input.value]||'';}
  }

  async function action(name,control){
    const id=control.dataset.id;
    if(name==='chip')return chip(control);
    if(name==='new')return openContract(control.dataset.campaign||current,{culture:control.dataset.culture||''});
    if(name==='edit')return openContract(current,{id});
    if(name==='back')return back(control.dataset.campaign||current);
    if(name==='target')return openTarget(control.dataset.campaign||current);
    if(name==='target-save'){const form=document.querySelector('#sales-target-form'),raw=String(form.elements.target.value||'').trim(),value=raw===''?null:Number(raw.replace(',','.'));if(raw!==''&&(!Number.isFinite(value)||value<0))return showError(form,'Montant invalide : saisissez un nombre positif ou laissez vide.');await setMarginTarget(store,value);toast(value===null?'Objectif de marge retiré.':'Objectif de marge enregistré.');return back();}
    if(name==='save'){
      const form=document.querySelector('#sales-contract-form'),values=Object.fromEntries(new FormData(form)),existing=id?store.get('integrationImports',id):null;
      if(id&&!existing)return showError(form,'Contrat introuvable : il a peut-être été supprimé.');
      try{await saveContract(store,values,existing?{...existing,version:values.version===''?existing.version:Number(values.version)}:null);}catch(error){return showError(form,error.message);}
      toast(existing?'Contrat modifié.':`Contrat enregistré : ${values.buyer.trim()} · ${values.culture.trim()}.`);return back(values.campaign||current);
    }
    if(name==='delete'){const removed=await deleteContract(store,id);toast('Contrat supprimé. Les ventes reliées sont conservées.','success',{label:'Annuler',run:async()=>{await store.restore('integrationImports',id);back(removed.campaign);}});return back(removed.campaign);}
    if(name==='link'||name==='unlink'){await linkSale(store,{lotId:control.dataset.lot,saleId:control.dataset.sale,contractId:name==='link'?id:null});openContract(current,{id});toast(name==='link'?'Vente reliée au contrat.':'Vente détachée du contrat.');document.querySelector('.sales-deliveries')?.scrollIntoView({block:'nearest'});}
  }

  document.addEventListener('click',event=>{const control=event.target.closest('[data-sales]');if(!control||control.disabled)return;event.preventDefault();if(control.dataset.sales==='chip')return chip(control);control.disabled=true;action(control.dataset.sales,control).catch(error=>toast(error.message,'error')).finally(()=>{if(control.isConnected)control.disabled=false;});});
  document.addEventListener('keydown',event=>{if(event.key!=='Enter')return;const form=event.target.closest?.('#sales-contract-form,#sales-target-form');if(!form||event.target.tagName!=='INPUT')return;event.preventDefault();form.closest('.modal')?.querySelector('.sales-save')?.click();});
  return{pilotageSection,openContract,openTarget};
}

