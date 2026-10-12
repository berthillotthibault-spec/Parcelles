// n° 66 — Interface : entrée en stock d'un lot (action explicite), sortie de stock par vente,
// stock de grains par silo, table des normes et fiche de traçabilité imprimable avec QR code.
import {escapeHtml as e,localDate} from './utils.js';
import {validateForm} from './form-chips-ui.js';
import {farmRecords,saveFarmRecord} from './farm-records.js';
import {printCss,printDocument} from './dossier.js';
import {qrSvg} from './qr.js';
import {appBaseUrl} from './qr-labels.js';
import {toTonnes} from './sales.js';
import {grainStock,grainNorms,validateNorms,lotTonnes,lotSheet,lotLink,siloItemFor,siloLabel,GRAIN_NORMS_SOURCE} from './grain-stock.js';

const n2=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}),t=v=>v===null||v===undefined?'—':`${n2.format(v)} t`;

/** Entrée en stock du lot : crée l'article du silo si besoin puis le mouvement d'entrée. */
export async function stockInLot(store,lotId){
  const state=store.snapshot(),lot=farmRecords(state,'harvest').find(l=>l.id===lotId);
  if(!lot)throw Error('Lot introuvable.');
  if(lot.stockMovementId)throw Error('Ce lot est déjà entré en stock.');
  const found=siloItemFor(state,lot);if(found.error)throw Error(found.error);
  const weight=lotTonnes(state,lot);if(weight.tonnes===null||weight.tonnes<=0)throw Error('Quantité du lot inconnue.');
  const item=found.item||await store.upsert('stockItems',found.draft,{label:`Article ${found.draft.name} créé`});
  const movement=await store.recordStockMovement({stockItemId:item.id,type:'Entrée',date:String(lot.date||'').slice(0,10),quantity:weight.tonnes,note:`Lot ${lot.code||''} aux normes`,harvestLotId:lot.id});
  const fresh=farmRecords(store.snapshot(),'harvest').find(l=>l.id===lotId);
  await saveFarmRecord(store,'harvest',{...fresh,stockItemId:item.id,stockMovementId:movement.id,normalizedTonnes:weight.tonnes},fresh);
  return{item,movement,tonnes:weight.tonnes};
}

/** Sortie de stock d'une vente déclarée (cochée explicitement dans le formulaire). */
export async function stockOutSale(store,lotId,saleId){
  const lot=farmRecords(store.snapshot(),'harvest').find(l=>l.id===lotId),sale=(lot?.sales||[]).find(s=>s.id===saleId);
  if(!lot?.stockItemId||!sale)throw Error('Lot non entré en stock.');
  const tonnes=toTonnes(sale.quantity,lot.unit);if(tonnes===null)throw Error('Quantité vendue invalide.');
  const movement=await store.recordStockMovement({stockItemId:lot.stockItemId,type:'Sortie',date:sale.date,quantity:tonnes,note:`Vente lot ${lot.code||''} · ${sale.buyer||''}`,harvestLotId:lot.id,saleId:sale.id});
  const fresh=farmRecords(store.snapshot(),'harvest').find(l=>l.id===lotId);
  await saveFarmRecord(store,'harvest',{...fresh,sales:(fresh.sales||[]).map(s=>s.id===saleId?{...s,stockMovementId:movement.id}:s)},fresh);
  return movement;
}

/** Bloc HTML ajouté dans la fiche du lot (harvest-ui) : poids aux normes et bouton explicite. */
export function lotStockHtml(state,lot,button){
  const w=lotTonnes(state,lot),silo=siloLabel(lot),wt=w.weight;
  const norms=w.norm?`Norme ${e(w.norm.label)} : ${n2.format(w.norm.humidity)} % d’humidité, ${n2.format(w.norm.impurities)} % d’impuretés.`:'Aucune norme pour cette culture : poids brut retenu.';
  const detail=wt?.applied?` (brut ${t(w.rawTonnes)} − humidité ${n2.format(toTonnes(wt.humidityLoss,lot.unit)||0)} t − impuretés ${n2.format(toTonnes(wt.impurityLoss,lot.unit)||0)} t)`:'';
  const action=lot.stockMovementId?`<p class="badge success">En stock · ${e(silo)}</p>`:silo?button('harvest-stock-in',`Entrer en stock (silo ${e(silo)})`,`data-id="${e(lot.id)}"`):'<p class="form-note">Indiquez un silo sur le lot pour pouvoir l’entrer en stock.</p>';
  return`<div class="grain-lot-stock"><p><strong>Poids aux normes : ${t(w.tonnes)}</strong>${detail}</p><p class="form-note">${norms} Reste à vendre : ${t(w.tonnes===null?null:Math.max(0,w.tonnes-(lot.sales||[]).reduce((s,x)=>s+(toTonnes(x.quantity,lot.unit)||0),0)))}.</p>${action} <button type="button" class="button secondary" data-action="open-lot-sheet" data-id="${e(lot.id)}">Fiche de traçabilité</button></div>`;
}

/** Fiche de traçabilité imprimable (HTML autonome) avec QR code vers la fiche dans l'application. */
export function lotSheetHtml(state,lot,{base=''}={}){
  const s=lotSheet(state,lot),farm=state.exploitation||{},link=base?lotLink(base,lot.id):'';
  const table=(head,rows)=>rows.length?`<table><thead><tr>${head.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<p class="muted">Aucun enregistrement.</p>';
  const dose=x=>x.dose!==undefined&&x.dose!==null&&x.dose!==''?`${e(x.dose)} ${e(x.doseUnit)}`:'—';
  const body=`<h1>Fiche de traçabilité · lot ${e(lot.code||'')}</h1><p class="muted">${e(farm.nom||'Mon exploitation')} · édité le ${e(localDate(Date.now()))}</p>
<div class="kpis"><div class="kpi"><strong>${e(s.crop||'—')}</strong><br>culture</div><div class="kpi"><strong>${e(s.parcel?.nom||'—')}</strong><br>parcelle</div><div class="kpi"><strong>${e(localDate(lot.date))}</strong><br>récolte</div><div class="kpi"><strong>${e(t(s.tonnes))}</strong><br>aux normes</div><div class="kpi"><strong>${e(lot.silo||'—')}</strong><br>silo</div></div>
${link?`<div class="qr" style="float:right;width:110px;margin:0 0 8px 12px">${qrSvg(link,{label:`Fiche du lot ${lot.code||''}`})}<p class="muted" style="font-size:8pt">Scanner pour ouvrir la fiche</p></div>`:''}
<h2>Produits phytosanitaires</h2>${table(['Date','Produit','AMM','Dose','DAR (j)','Délai avant récolte','DAR'],s.treatments.map(x=>[e(localDate(x.work.date)),e(x.product),e(x.amm||'—'),dose(x),x.dar===null?'—':e(x.dar),x.gap===null?'—':`${e(x.gap)} j`,`<strong>${e(x.darStatus)}</strong>`]))}
${s.darIssues?`<p><strong>${s.darIssues} traitement(s) appliqué(s) avant l’expiration du DAR.</strong></p>`:''}
<h2>Engrais et amendements</h2>${table(['Date','Travail','Produit','Dose'],s.fertilizers.map(x=>[e(localDate(x.work.date)),e(x.work.type),e(x.product),dose(x)]))}
<h2>Semences</h2>${table(['Date','Produit','Variété','Dose'],s.seeds.map(x=>[e(localDate(x.work.date)),e(x.product),e(x.variety||'—'),dose(x)]))}
<h2>Ventes et mouvements de stock</h2>${table(['Date','Acheteur','Quantité'],s.sales.map(x=>[e(localDate(x.date)),e(x.buyer||'—'),`${e(n2.format(x.quantity))} ${e(lot.unit||'t')}`]))}
<p class="muted">Liens déduits de la parcelle et de la campagne ${e(s.campaign||'')} : ils ne prouvent pas l’appartenance de chaque intrant au lot. ${e(s.disclaimer)} DAR issu des fiches produit saisies (indicatif).</p>`;
  const css=printCss({assetBase:base,footer:`Lot ${lot.code||''}`,cover:false})+'.kpis{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 16px}.kpi{padding:10px 14px;border:1px solid var(--rule);border-radius:10px;background:#fff;break-inside:avoid}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--rule);font-size:9pt}';
  return printDocument({title:`Traçabilité lot ${lot.code||''}`,css,body:`<main class="page"><div class="dz-body">${body}</div></main>`});
}

export function createGrainStockUI({store,modal,toast,openPrintableReport}){
  const $=s=>document.querySelector(s);
  const base=()=>{try{return appBaseUrl(location.href);}catch{return'';}};

  function sheetModal(lotId){
    const state=store.snapshot(),lot=farmRecords(state,'harvest').find(l=>l.id===lotId);
    if(!lot){toast('Lot introuvable sur cet appareil.','error');return;}
    const s=lotSheet(state,lot),link=lotLink(base(),lot.id);
    modal(`Traçabilité · lot ${lot.code||''}`,`${s.parcel?.nom||'Parcelle'} · ${s.crop||'culture inconnue'} · récolte du ${localDate(lot.date)}`,
      `<div class="grain-sheet"><div class="grain-qr">${qrSvg(link,{label:`QR code de la fiche du lot ${lot.code||''}`})}</div><div class="stack-list">
${s.treatments.map(x=>`<div class="list-row"><div><strong>${e(x.product)}</strong><small>${e(localDate(x.work.date))} · DAR ${x.dar===null?'inconnu':`${e(x.dar)} j`}${x.gap!==null?` · ${e(x.gap)} j avant récolte`:''}</small></div><span class="badge ${x.darStatus==='respecté'?'success':x.darStatus==='non respecté'?'danger':'info'}">DAR ${e(x.darStatus)}</span></div>`).join('')||'<div class="empty-state">Aucun traitement phytosanitaire sur la campagne.</div>'}
</div><p class="form-note">${s.fertilizers.length} apport(s) d’engrais · ${s.seeds.length} semis · ${s.sales.length} vente(s) · ${e(t(s.tonnes))} aux normes. ${e(s.disclaimer)}</p></div>`,
      `<button type="button" class="button secondary" data-action="close-modal">Fermer</button><button type="button" class="button primary" id="grain-sheet-print">Imprimer la fiche</button>`,'large');
    $('#grain-sheet-print').onclick=()=>openPrintableReport(lotSheetHtml(store.snapshot(),lot,{base:base()}));
  }

  function stockSectionHtml(state){
    const g=grainStock(state);if(!g.silos.length&&!g.lots.length)return'';
    return`<h3>Grains par silo</h3><div class="stack-list">${g.silos.map(s=>`<div class="list-row"><div><strong>Silo ${e(s.silo)}</strong><small>${s.items.map(i=>`${e(i.crop||i.name)} ${e(t(Number(i.quantity)||0))}`).join(' · ')}</small></div><strong>${e(t(s.tonnes))}</strong></div>`).join('')||'<div class="empty-state">Aucun lot entré en stock.</div>'}</div>
<p class="form-note">Reste à vendre (lots aux normes − ventes déclarées) : <strong>${e(t(g.remaining))}</strong>${g.lots.filter(l=>!l.inStock).length?` · ${g.lots.filter(l=>!l.inStock).length} lot(s) pas encore entré(s) en stock`:''}.</p><button type="button" class="small-button" id="grain-norms-open">Normes de poids</button>`;
  }
  function bindStockSection(){$('#grain-norms-open')?.addEventListener('click',openNorms);}

  function openNorms(){
    const rows=grainNorms(store.snapshot());
    modal('Normes de poids','Réfaction d’humidité et d’impuretés appliquée à l’entrée en stock.',`<form id="grain-norms-form" class="grain-norms">${rows.map(r=>`<fieldset><legend>${e(r.label)}</legend><label>Humidité de référence (%)<input name="${e(r.key)}.humidity" type="number" min="1" max="39" step="0.1" required value="${e(r.humidity)}"></label><label>Impuretés de référence (%)<input name="${e(r.key)}.impurities" type="number" min="0" max="19" step="0.1" required value="${e(r.impurities)}"></label></fieldset>`).join('')}<p class="form-error" id="grain-norms-error" role="alert" hidden></p></form><p class="form-note">${e(GRAIN_NORMS_SOURCE)} Poids aux normes = poids × (100 − humidité) / (100 − norme), puis réfaction des impuretés au-delà de la norme.</p>`,
      `<button type="button" class="button secondary" data-action="open-stock">Retour</button><button type="button" class="button primary" id="grain-norms-save">Enregistrer</button>`,'small');
    $('#grain-norms-save').onclick=async()=>{
      const form=$('#grain-norms-form');if(!validateForm(form))return;const v=Object.fromEntries(new FormData(form));
      const r=validateNorms(rows.map(x=>({key:x.key,label:x.label,humidity:v[`${x.key}.humidity`],impurities:v[`${x.key}.impurities`]})));
      if(r.error){const err=$('#grain-norms-error');err.textContent=r.error;err.hidden=false;return;}
      await store.setPreferences({grainNorms:r.value});toast('Normes enregistrées.','success');openNorms();
    };
  }
  return{sheetModal,stockSectionHtml,bindStockSection,openNorms};
}
