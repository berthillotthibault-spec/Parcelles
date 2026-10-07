// Interface du coût de revient (n° 81) et de l’assistant « Compléter les coûts » (n° 84).
// Boutons repérés par data-cost : un seul écouteur délégué, installé une fois.
import {escapeHtml as e,campaignFor,formatEuro} from './utils.js';
import {costPriceByCulture,costCompletion,acceptEstimates,saveManualCost,dismissCost,restoreDismissed,undoEstimates,gaugeScale,costTypeKey} from './costs.js';

const NB=' ';
const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}),n1=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}),n2=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2});
const eur=v=>`${n0.format(v)}${NB}€`,eur2=v=>formatEuro(v),perT=v=>`${n0.format(v)}${NB}€/t`;
const signed=v=>`${v>=0?'+':'−'}${n0.format(Math.abs(v))}${NB}€/t`;
const plural=(count,one,many)=>`${count===0?'0':n0.format(count)} ${count>1?many:one}`;
const colon=`${NB}:`;
const dateFr=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:'Date inconnue';};

export function gaugeSvg(row){
  const marks=[['cost',row.costPrice,'Coût de revient'],['even',row.breakEven,'Prix d’équilibre'],['sales',row.salesPrice,'Prix moyen vendu'],['market',row.marketPrice,'Prix saisi']].filter(([,v])=>v!==null&&v!==undefined);
  const scale=gaugeScale(marks.map(([,v])=>v));if(!scale||row.breakEven===null)return'';
  const W=300,x=v=>12+scale.at(v)*(W-24),even=x(row.breakEven),label=marks.map(([,v,l])=>`${l} ${perT(v)}`).join(', ');
  const shape=(kind,v)=>{const cx=x(v).toFixed(1);if(kind==='even')return`<line class="g-even" x1="${cx}" x2="${cx}" y1="8" y2="34"/>`;if(kind==='cost')return`<line class="g-cost" x1="${cx}" x2="${cx}" y1="12" y2="30"/>`;if(kind==='market')return`<circle class="g-market" cx="${cx}" cy="21" r="6"/>`;return`<rect class="g-sales" x="${(x(v)-5).toFixed(1)}" y="16" width="10" height="10" transform="rotate(45 ${cx} 21)"/>`;};
  return`<figure class="cost-gauge"><svg viewBox="0 0 ${W} 48" role="img" aria-label="${e(label)}" preserveAspectRatio="none"><rect class="g-loss" x="12" y="16" width="${Math.max(0,even-12).toFixed(1)}" height="10" rx="5"/><rect class="g-gain" x="${even.toFixed(1)}" y="16" width="${Math.max(0,W-12-even).toFixed(1)}" height="10" rx="5"/>${marks.map(([k,v])=>shape(k,v)).join('')}<text class="g-axis" x="12" y="46">${e(perT(scale.min))}</text><text class="g-axis" x="${W-12}" y="46" text-anchor="end">${e(perT(scale.max))}</text></svg><figcaption><ul class="cost-legend">${marks.map(([k,v,l])=>`<li><span class="cost-swatch is-${k}" aria-hidden="true"></span>${e(l)}${colon} <strong>${e(perT(v))}</strong></li>`).join('')}</ul></figcaption></figure>`;
}

function cultureCard(row){
  const head=`<header><strong>${e(row.culture)}</strong><small>${e(n2.format(row.area))}${NB}ha · ${plural(row.parcels,'parcelle','parcelles')}</small></header>`;
  const flags=[];
  if(row.unknown)flags.push(plural(row.unknown,'travail réalisé sans coût','travaux réalisés sans coût'));if(row.unknownPlanned)flags.push(plural(row.unknownPlanned,'travail prévu non chiffré','travaux prévus non chiffrés'));
  if(row.parcelsWithoutYield&&row.costPrice!==null)flags.push(`${plural(row.parcelsWithoutYield,'parcelle sans rendement','parcelles sans rendement')}`);
  if(row.estimatedCount)flags.push(`dont ${eur(row.estimated)} de coûts estimés`);
  const flagHtml=flags.length?`<p class="cost-flags">${row.partial?'Calcul partiel · ':''}${e(flags.join(' · '))}</p>`:'';
  if(row.costPrice===null)return`<article class="cost-card">${head}<p class="cost-missing"><strong>Rendement à saisir</strong>${colon} renseignez le rendement prévu dans l’économie des parcelles pour obtenir un coût à la tonne. Charges connues${colon} ${e(eur(row.area?row.charges/row.area:0))}/ha.</p>${flagHtml}</article>`;
  const delta=row.delta,priceLabel=row.priceSource==='market'?'prix saisi':row.priceSource==='sales'?'ventes des lots':'';
  const yieldNote=row.breakEvenYield!==null?`Rendement d’équilibre au prix actuel${colon} <strong>${e(row.yieldUnit==='q/ha'?`${n1.format(row.breakEvenYield*10)}${NB}q/ha`:`${n2.format(row.breakEvenYield)}${NB}t/ha`)}</strong>${row.yield!==null?` · prévu${colon} ${e(row.yieldUnit==='q/ha'?`${n1.format(row.yield*10)}${NB}q/ha`:`${n2.format(row.yield)}${NB}t/ha`)}`:''}.`:'Saisissez un prix de vente pour calculer le rendement d’équilibre.';
  return`<article class="cost-card">${head}<dl class="cost-figures"><div><dt>Coût de revient</dt><dd>${e(perT(row.costPrice))}</dd><small>charges de campagne</small></div><div><dt>Prix d’équilibre</dt><dd>${e(perT(row.breakEven))}</dd><small>avec charges de structure</small></div><div><dt>Prix actuel</dt><dd>${row.currentPrice!==null?e(perT(row.currentPrice)):'À saisir'}</dd><small>${e(priceLabel||'aucun prix connu')}</small></div><div><dt>Écart</dt><dd class="${delta===null?'':delta<0?'is-loss':'is-gain'}">${delta===null?'—':e(signed(delta))}</dd><small>${delta===null?'prix à saisir':delta<0?'sous l’équilibre':'au-dessus de l’équilibre'}</small></div></dl>${gaugeSvg(row)}<p class="cost-note">${yieldNote}</p>${flagHtml}</article>`;
}

export function createCostsUI(host){
  const {store,modal,toast,openStatistics}=host;
  const data=()=>store.snapshot();
  const writable=()=>!store.writeGuard||store.writeGuard({entity:'interventions',action:'update'});
  let current=campaignFor(),editing=null;

  function pilotageSection(campaign=campaignFor()){
    const state=data(),result=costPriceByCulture(state,{campaign}),completion=costCompletion(state,{campaign});
    const pending=completion.rows.length,banner=pending?`<div class="notice warning cost-banner"><p><strong>${e(plural(pending,'travail réalisé sans coût','travaux réalisés sans coût'))}</strong>${colon} les coûts de revient et les marges sont partiels.${completion.proposed.length?` ${e(plural(completion.proposed.length,'proposition prête','propositions prêtes'))}.`:''}</p><button type="button" class="button secondary" data-cost="complete" data-campaign="${e(campaign)}">Compléter les coûts (${pending})</button></div>`:'';
    const cards=result.rows.map(cultureCard).join('');
    const fixed=result.machineFixed,structureText=[fixed.total>0?`amortissements et assurances du matériel (${eur(fixed.total)}, ${plural(fixed.count,'matériel','matériels')})`:'',result.structureCostHa>0?`${eur2(result.structureCostHa)}/ha saisis`:''].filter(Boolean).join(' + ')||'aucune pour l’instant';
    return`<section class="cost-price" aria-labelledby="cost-price-title"><div class="cost-price-head"><h3 id="cost-price-title">Coût de revient et prix d’équilibre</h3><button type="button" class="button secondary" data-cost="structure" data-campaign="${e(campaign)}">Charges de structure</button></div>${banner}<div class="cost-cards">${cards||'<div class="empty-state">Aucune parcelle en propre avec une surface pour cette campagne.</div>'}</div><p class="cost-footnote">Indicatif. Coût de revient = charges de la campagne (travaux réalisés et planifiés chiffrés, charges manuelles €/ha) ÷ production estimée (rendement prévu × surface). Prix d’équilibre = même calcul avec la quote-part des charges de structure, répartie à la surface${colon} ${e(structureText)}. Prix actuel = prix de vente saisi, sinon prix moyen des ventes déclarées dans les lots de récolte. Culture de la campagne (rotation), sinon culture actuelle.</p></section>`;
  }

  function rowHtml(row,canWrite){
    const w=row.work,p=row.proposal,title=`${e(w.type||'Travail')} · ${e(row.parcel?.nom||'Parcelle inconnue')}`,meta=`${dateFr(w.date)}${row.area!==null?` · ${n2.format(row.area)}${NB}ha`:' · surface inconnue'}`;
    const proposal=p?`<p class="cost-proposal"><strong>${e(eur2(p.value))}</strong> <span class="cost-source">${e(p.label)}</span></p><p class="cost-detail">${e(p.detail)}</p>`:`<p class="cost-detail">Aucune proposition${colon} ${row.area===null?'surface inconnue':'aucun travail comparable chiffré ni barème'}. Saisissez le montant.</p>`;
    let actions='';
    if(canWrite&&editing===w.id){const key=costTypeKey(w);actions=`<form class="cost-edit" data-id="${e(w.id)}" novalidate><label>Coût du travail (€) *<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" value="${p?e(String(p.value)):''}" data-autofocus></label>${row.area!==null&&key?`<label class="cost-check"><input type="checkbox" name="rate"> Retenir comme barème €/ha pour «${NB}${e(w.type)}${NB}»</label>`:''}<p class="form-error hidden" role="alert"></p><div class="cost-edit-actions"><button type="button" class="button secondary" data-cost="cancel-edit">Annuler</button><button type="button" class="button primary" data-cost="save-edit" data-id="${e(w.id)}">Enregistrer</button></div></form>`;}
    else if(canWrite)actions=`<div class="cost-actions">${p?`<button type="button" class="button primary" data-cost="accept" data-id="${e(w.id)}">Accepter</button>`:''}<button type="button" class="button secondary" data-cost="edit" data-id="${e(w.id)}">${p?'Modifier':'Saisir'}</button><button type="button" class="button secondary" data-cost="dismiss" data-id="${e(w.id)}">Ignorer</button></div>`;
    return`<article class="cost-row" data-row="${e(w.id)}"><div class="cost-row-head"><strong>${title}</strong><small>${e(meta)}</small></div>${proposal}${actions}</article>`;
  }

  function openCompletion(campaign=current){
    current=campaign;const c=costCompletion(data(),{campaign}),canWrite=writable();
    const summary=`<div class="preview-summary"><div class="preview-stat"><strong>${c.missing}</strong><small>${c.missing>1?'travaux sans coût':'travail sans coût'}</small></div><div class="preview-stat"><strong>${c.proposed.length}</strong><small>${c.proposed.length>1?'propositions':'proposition'}</small></div><div class="preview-stat"><strong>${e(eur2(c.total))}</strong><small>total proposé (estimé)</small></div></div>`;
    const intro=`<p class="notice info">Rien n’est enregistré sans votre accord. Un montant accepté est marqué «${NB}estimé${NB}» pour rester distinct du réel. Un coût déjà renseigné n’est jamais remplacé. Ordre des propositions${colon} stock et matériel du travail, puis coût moyen €/ha du même type de travail sur l’exploitation, puis votre barème.</p>`;
    const readOnly=canWrite?'':`<p class="notice warning">Lecture seule${colon} votre rôle ne permet pas de modifier les travaux.</p>`;
    const list=c.rows.length?`<div class="cost-list" id="cost-complete-list">${c.rows.map(r=>rowHtml(r,canWrite)).join('')}</div>`:`<div class="empty-state">${c.missing?'Tous les travaux sans coût restants sont ignorés.':'Tous les travaux réalisés de cette campagne ont un coût.'}</div>`;
    const dismissed=c.dismissed?`<p class="cost-dismissed">${e(plural(c.dismissed,'travail ignoré','travaux ignorés'))}. ${canWrite?`<button type="button" class="button secondary" data-cost="restore">Réafficher</button>`:''}</p>`:'';
    const footer=`<button type="button" class="button secondary" data-action="pilotage-campaign" data-campaign="${e(campaign)}">Retour au pilotage</button>${canWrite&&c.proposed.length?`<button type="button" class="button primary cost-accept-all" data-cost="accept-all">Tout accepter (${c.proposed.length}) · ${e(eur2(c.total))}</button>`:''}`;
    modal('Compléter les coûts',`Campagne ${campaign} · travaux réalisés`,`${readOnly}${summary}${intro}${list}${dismissed}`,footer,'large');
  }

  function openStructure(campaign=current){
    current=campaign;const state=data(),fixed=costPriceByCulture(state,{campaign}).machineFixed,value=state.preferences?.structureCostHa;
    modal('Charges de structure','Quote-part utilisée pour le prix d’équilibre',`<form id="cost-structure-form" class="form-grid" novalidate><p class="span-2">Déjà pris en compte automatiquement${colon} ${fixed.total>0?`${e(eur(fixed.total))} d’amortissements et d’assurances (${e(plural(fixed.count,'matériel','matériels'))})`:'aucun amortissement ni assurance de matériel renseigné'}.</p><label class="span-2">Autres charges de structure (€/ha)<input name="structureCostHa" type="number" min="0" step="0.01" inputmode="decimal" value="${value??''}" placeholder="Ex. fermage, MSA, assurances, frais de gestion" data-autofocus></label><p class="span-2 cost-detail">Montant moyen par hectare, réparti sur toutes les cultures. Laissez vide pour ne rien ajouter. Valeur enregistrée sur cet appareil, pour cette exploitation.</p><p class="span-2 form-error hidden" role="alert"></p></form>`,`<button type="button" class="button secondary" data-action="pilotage-campaign" data-campaign="${e(campaign)}">Annuler</button><button type="button" class="button primary cost-accept-all" data-cost="structure-save">Enregistrer</button>`,'small');
  }

  const showError=(form,message)=>{const err=form?.querySelector('.form-error');if(err){err.textContent=message;err.classList.remove('hidden');form.querySelector('input')?.focus();}else toast(message,'error');};
  const refocus=()=>setTimeout(()=>{const target=document.querySelector('#cost-complete-list [data-cost="accept"],#cost-complete-list [data-cost="edit"],.cost-accept-all');target?.focus({preventScroll:true});},0);

  async function action(name,control){
    const id=control.dataset.id;
    if(name==='complete'){editing=null;openCompletion(control.dataset.campaign||current);}
    else if(name==='structure')openStructure(control.dataset.campaign||current);
    else if(name==='structure-save'){const form=document.querySelector('#cost-structure-form'),raw=String(form.elements.structureCostHa.value||'').trim(),value=raw===''?null:Number(raw.replace(',','.'));if(raw!==''&&(!Number.isFinite(value)||value<0))return showError(form,'Montant invalide : saisissez un nombre positif ou laissez vide.');await store.setPreferences({structureCostHa:value});toast('Charges de structure enregistrées.');openStatistics(current);}
    else if(name==='accept'){const work=store.get('interventions',id),result=await acceptEstimates(store,[{id,version:work?.version}]);if(!result.saved)throw Error('Ce travail a changé ou a déjà un coût : rien n’a été remplacé.');openCompletion();refocus();toast(`Coût estimé enregistré : ${eur2(result.total)}.`,'success',{label:'Annuler',run:async()=>{await undoEstimates(store,result.undo);openCompletion();}});}
    else if(name==='accept-all'){const c=costCompletion(data(),{campaign:current}),result=await acceptEstimates(store,c.proposed.map(r=>({id:r.work.id,version:r.work.version})));openCompletion();refocus();toast(`${plural(result.saved,'coût estimé enregistré','coûts estimés enregistrés')} (${eur2(result.total)})${result.skipped?` · ${plural(result.skipped,'travail laissé','travaux laissés')} tel${result.skipped>1?'s':''} quel${result.skipped>1?'s':''}`:''}.`,'success',{label:'Annuler',run:async()=>{await undoEstimates(store,result.undo);openCompletion();}});}
    else if(name==='edit'){editing=id;openCompletion();}
    else if(name==='cancel-edit'){editing=null;openCompletion();refocus();}
    else if(name==='save-edit'){const form=control.closest('.cost-edit'),raw=String(form.elements.amount.value||'').trim();if(!raw)return showError(form,'Champ obligatoire : coût du travail (€)');const amount=Number(raw.replace(',','.'));if(!Number.isFinite(amount)||amount<=0)return showError(form,'Montant invalide : saisissez un coût supérieur à 0 €.');const work=store.get('interventions',id),c=costCompletion(data(),{campaign:current}),row=c.rows.find(r=>r.work.id===id),rate=form.elements.rate?.checked;await saveManualCost(store,id,amount,{version:work?.version,rateKey:rate?costTypeKey(work):null,area:row?.area});editing=null;openCompletion();refocus();toast(rate?'Coût enregistré et barème mis à jour.':'Coût enregistré.');}
    else if(name==='dismiss'){await dismissCost(store,id,true);openCompletion();refocus();toast('Travail ignoré : il ne sera plus proposé.','success',{label:'Annuler',run:async()=>{await dismissCost(store,id,false);openCompletion();}});}
    else if(name==='restore'){const count=await restoreDismissed(store,{campaign:current});openCompletion();toast(`${plural(count,'travail réaffiché','travaux réaffichés')}.`);}
  }

  document.addEventListener('click',event=>{const control=event.target.closest('[data-cost]');if(!control||control.disabled)return;event.preventDefault();control.disabled=true;action(control.dataset.cost,control).catch(error=>toast(error.message,'error')).finally(()=>{if(control.isConnected)control.disabled=false;});});
  document.addEventListener('keydown',event=>{if(event.key!=='Enter')return;const form=event.target.closest?.('.cost-edit,#cost-structure-form');if(!form||event.target.tagName!=='INPUT'||event.target.type==='checkbox')return;event.preventDefault();form.closest('.modal')?.querySelector(form.id?'[data-cost="structure-save"]':'[data-cost="save-edit"]')?.click();});
  store.subscribe?.((_,ev)=>{if(ev?.kind==='workspace-switch')editing=null;});
  return{pilotageSection,openCompletion,openStructure};
}
