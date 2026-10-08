// Interface de la facturation (n° 56) : liste, préparation depuis un client (travaux et chantiers TP
// non facturés), brouillon modifiable, émission numérotée, paiement, avoir, export CSV et paramètres.
// Boutons repérés par data-invoice : un seul écouteur délégué, installé une fois.
import {escapeHtml as e,download} from './utils.js';
import {active} from './farm-memory.js';
import {INVOICE_KIND,PAYMENT_TERMS,STATUS_LABELS,UNITS,VAT_RATES,addDays,billableItems,clientsToBill,createCreditNote,createDraft,creditNotesOf,dateFr,deleteDraft,emissionProblems,emitInvoice,invoiceHtml,invoiceSettings,invoiceStatus,invoiceTotals,invoices,invoicesCsv,isoDay,lineTotal,markPaid,nextNumber,numberingIssues,receivable,saveDraft,saveSettings,settingsReady,sortInvoices,validateDraft} from './invoices.js';
import {openPrintable,assetBase} from './dossier-ui.js';

const NB=' ',colon=`${NB}:`;
const money=v=>v===null||v===undefined||!Number.isFinite(v)?'—':`${new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v).replace(/[  ]/g,NB).replace(/^-/,'−')}${NB}€`;
const qty=v=>v===null||v===undefined?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:3}).format(v).replace(/[  ]/g,NB);
const plural=(n,one,many)=>`${n===0?'0':n} ${n>1?many:one}`;
const FILTERS=[['all','Toutes'],['brouillon','Brouillons'],['due','À encaisser'],['retard','En retard'],['payee','Payées'],['avoir','Avoirs']];
const TERM_LABEL=d=>d===0?'À réception':`${d}${NB}jours`;
const rateLabel=r=>`${String(r).replace('.',',')}${NB}%`;
const chips=(name,list,value,label)=>`<input type="hidden" name="${name}" value="${e(value)}"><div class="chip-choices" role="group" aria-label="${e(label)}">${list.map(([v,l])=>`<button type="button" class="choice-chip${String(v)===String(value)?' is-on':''}" data-invoice="chip" data-name="${name}" data-value="${e(v)}" aria-pressed="${String(v)===String(value)}">${e(l)}</button>`).join('')}</div>`;

export function statusPill(status){return`<span class="inv-pill is-${e(status)}">${e(STATUS_LABELS[status]||status)}</span>`;}

export function createInvoicesUI({store,modal,closeModal,toast}){
  const state=()=>store.state||store.snapshot();
  const canWrite=()=>!store.writeGuard||store.writeGuard({entity:'integrationImports',action:'update'});
  let filter='all',prep={clientId:'',from:'',to:isoDay(),fuel:true},draftLines=new Map();

  // ---------- Liste ----------
  function open(nextFilter=filter){
    filter=FILTERS.some(([f])=>f===nextFilter)?nextFilter:'all';
    const data=state(),today=isoDay(),r=receivable(data,today),issues=numberingIssues(data),toBill=clientsToBill(data),write=canWrite();
    const all=sortInvoices(invoices(data)),match=inv=>{const s=invoiceStatus(inv,data,today);return filter==='all'||(filter==='due'?s==='emise'||s==='retard':s===filter);};
    const list=all.filter(match);
    const row=inv=>{const s=invoiceStatus(inv,data,today),t=inv.status==='brouillon'?invoiceTotals(inv.lines||[]):inv.totals||invoiceTotals(inv.lines||[]);
      const meta=[inv.status==='brouillon'?`créé le ${dateFr(inv.issueDate)}`:dateFr(inv.issueDate),inv.docType!=='avoir'&&inv.status!=='brouillon'&&!inv.paidAt?`échéance ${dateFr(inv.dueDate)}`:'',inv.paidAt?`payée le ${dateFr(inv.paidAt)}`:''].filter(Boolean).join(' · ');
      return`<button type="button" class="list-row is-button inv-row" data-invoice="${inv.status==='brouillon'?'edit':'view'}" data-id="${e(inv.id)}"><div><strong>${e(inv.number||(inv.docType==='avoir'?'Avoir en brouillon':'Brouillon'))} · ${e(inv.clientName||'Client')}</strong><small>${e(meta)}</small></div><span class="inv-row-end"><strong>${e(money(t.ttc))}</strong>${statusPill(s)}</span></button>`;};
    const body=`${settingsReady(data)?'':`<div class="notice warning inv-notice"><p>Complétez vos paramètres de facturation (raison sociale, adresse, SIRET) avant d’émettre une facture.</p>${write?'<button type="button" class="button secondary" data-invoice="settings">Paramètres de facturation</button>':''}</div>`}
${issues.duplicates.length?`<div class="notice danger inv-notice"><p>Numéro${issues.duplicates.length>1?'s':''} en double${colon} ${e(issues.duplicates.join(', '))}. Deux appareils ont sans doute émis hors ligne en même temps : vérifiez et annulez le doublon par un avoir. Émettez de préférence depuis un seul appareil, ou donnez un préfixe différent à chacun.</p></div>`:''}
${issues.gaps.length?`<div class="notice warning inv-notice"><p>Numérotation incomplète${colon} ${e(issues.gaps.slice(0,5).join(', '))}${issues.gaps.length>5?'…':''} manquant${issues.gaps.length>1?'s':''} (facture supprimée ou pas encore synchronisée).</p></div>`:''}
<div class="preview-summary"><div class="preview-stat"><strong>${e(money(r.due))}</strong><small>à encaisser (TTC)</small></div><div class="preview-stat"><strong class="${r.lateCount?'negative':''}">${e(money(r.late))}</strong><small>${e(plural(r.lateCount,'facture en retard','factures en retard'))}</small></div><div class="preview-stat"><strong>${r.draft}</strong><small>${r.draft>1?'brouillons':'brouillon'}</small></div></div>
${toBill.length&&write?`<h3 class="inv-h3">À facturer</h3><div class="stack-list">${toBill.map(x=>`<div class="list-row"><div><strong>${e(x.client.name||'Client')}</strong><small>${e(plural(x.count,'prestation non facturée','prestations non facturées'))}</small></div><button type="button" class="button secondary inv-small" data-invoice="prepare" data-id="${e(x.client.id)}" aria-label="${e(`Préparer une facture pour ${x.client.name||'ce client'}`)}">Préparer</button></div>`).join('')}</div>`:''}
<h3 class="inv-h3">Factures et avoirs</h3><div class="chip-choices inv-filters" role="group" aria-label="Filtrer les factures">${FILTERS.map(([f,l])=>`<button type="button" class="choice-chip${f===filter?' is-on':''}" data-invoice="filter" data-value="${f}" aria-pressed="${f===filter}">${e(l)}</button>`).join('')}</div>
<div class="stack-list">${list.length?list.map(row).join(''):`<div class="empty-state">${all.length?'Aucune facture dans ce filtre.':'Aucune facture pour l’instant. Préparez-en une depuis un client : les travaux réalisés et les journaux de chantier TP non facturés sont proposés au tarif du client.'}</div>`}</div>
<p class="cost-detail inv-reform">Facturation électronique : réception obligatoire dès le 1er septembre 2026, émission via une plateforme agréée au 1er septembre 2027 pour les TPE et PME. L’export CSV facilite la reprise par votre comptable ou votre plateforme ; le format Factur-X n’est pas encore produit par Parcelles.</p>`;
    modal('Factures','Prestations et chantiers TP',body,`<button type="button" class="button secondary" data-invoice="settings">Paramètres</button><button type="button" class="button secondary" data-invoice="csv">Export CSV</button>${write?'<button type="button" class="button primary inv-primary" data-invoice="prepare">Nouvelle facture</button>':''}`,'large');
  }

  // ---------- Préparation ----------
  function itemsHtml(){
    if(!prep.clientId)return'<p class="cost-detail">Choisissez un client pour voir ses prestations non facturées.</p>';
    const data=state(),items=billableItems(data,prep.clientId,{from:prep.from,to:prep.to,includeFuel:prep.fuel}),client=active(data,'clients').find(c=>c.id===prep.clientId);
    const noRates=client&&![client.hourlyRate,client.hectareRate,client.m3Rate,client.tonneRate].some(v=>Number(v)>0);
    if(!items.length)return`<div class="empty-state">Aucune prestation réalisée et non facturée sur cette période. Vous pouvez tout de même créer une facture libre.</div>`;
    const total=items.reduce((s,it)=>s+(lineTotal(it.line)||0),0),missing=items.filter(it=>lineTotal(it.line)===null).length;
    return`${noRates?`<div class="notice warning inv-notice"><p>Aucun tarif enregistré pour ce client : les prix seront à saisir dans le brouillon.</p></div>`:''}<fieldset class="inv-items"><legend>${e(plural(items.length,'prestation non facturée','prestations non facturées'))} · ${e(money(total))} HT${missing?` · ${e(plural(missing,'prix à saisir','prix à saisir'))}`:''}</legend>${items.map(it=>{const t=lineTotal(it.line);return`<label class="inv-item"><input type="checkbox" name="item" value="${e(it.key)}" checked><span><strong>${e(it.line.label)}</strong><small>${e(dateFr(it.date))} · ${e(qty(it.line.quantity))}${NB}${e(it.line.unit)} × ${it.line.unitPrice===null?'prix à saisir':e(money(it.line.unitPrice))} · ${e(it.line.basis||'')}</small></span><b>${t===null?'—':e(money(t))}</b></label>`;}).join('')}</fieldset>`;
  }
  function prepare(clientId=''){
    const data=state(),clients=active(data,'clients').sort((a,b)=>String(a.name).localeCompare(String(b.name),'fr'));
    prep={...prep,clientId:clientId||(clients.length===1?clients[0].id:prep.clientId&&clients.some(c=>c.id===prep.clientId)?prep.clientId:'')};
    const body=`<form id="invoice-prepare-form" class="form-grid inv-form" novalidate>
<label class="span-2">Client *<select name="clientId" data-autofocus><option value="">Choisir un client…</option>${clients.map(c=>`<option value="${e(c.id)}"${c.id===prep.clientId?' selected':''}>${e(c.name||'Client')}</option>`).join('')}</select></label>
<label>Du<input type="date" name="from" value="${e(prep.from)}"></label><label>Au<input type="date" name="to" value="${e(prep.to)}"></label>
<label class="span-2 inv-check"><input type="checkbox" name="fuel"${prep.fuel?' checked':''}><span>Refacturer le gazole des travaux (litres saisis)</span></label>
<div class="span-2" data-invoice-items>${itemsHtml()}</div>
${clients.length?'':'<p class="span-2 notice info">Aucun client enregistré : créez-en un dans « Clients & prestations ».</p>'}
<p class="span-2 form-error hidden" role="alert"></p></form>`;
    modal('Préparer une facture','Travaux réalisés et journaux de chantier TP non facturés',body,`<button type="button" class="button secondary" data-invoice="list">Retour</button><button type="button" class="button primary inv-primary" data-invoice="create">Créer le brouillon</button>`,'small');
  }
  function refreshItems(form){prep={clientId:form.clientId.value,from:form.from.value,to:form.to.value,fuel:form.fuel.checked};const box=form.querySelector('[data-invoice-items]');if(box)box.innerHTML=itemsHtml();form.querySelector('.form-error')?.classList.add('hidden');}
  async function create(){
    const form=document.getElementById('invoice-prepare-form');if(!form)return;refreshItems(form);
    if(!prep.clientId)return showError(form,'Champ obligatoire : Client');
    if(prep.from&&prep.to&&prep.from>prep.to)return showError(form,'Période invalide : la date de début suit la date de fin.');
    const keys=new Set([...form.querySelectorAll('[name="item"]:checked')].map(i=>i.value)),items=billableItems(state(),prep.clientId,{from:prep.from,to:prep.to,includeFuel:prep.fuel}).filter(it=>keys.has(it.key));
    const saved=await createDraft(store,{clientId:prep.clientId,items,from:prep.from,to:prep.to});
    toast(`Brouillon créé${items.length?` avec ${plural(items.length,'ligne','lignes')}`:''}.`,'success');edit(saved.id);
  }

  // ---------- Brouillon ----------
  const unitOptions=u=>UNITS.map(([v,l])=>`<option value="${e(v)}"${v===u?' selected':''}>${e(l)}</option>`).join('');
  const vatOptions=r=>VAT_RATES.map(v=>`<option value="${v}"${Number(r)===v?' selected':''}>${e(rateLabel(v))}</option>`).join('');
  function lineCard(l,i){
    return`<div class="inv-line" data-line-id="${e(l.id)}"><div class="inv-line-head"><strong>Ligne ${i+1}</strong>${l.basis?`<small>${e(l.basis)}</small>`:''}<button type="button" class="icon-button inv-remove" data-invoice="remove-line" aria-label="${e(`Supprimer la ligne ${i+1}`)}">✕</button></div>
<label class="inv-wide">Désignation *<input name="label" value="${e(l.label)}" maxlength="200"></label>
<label>Quantité<input name="quantity" inputmode="decimal" value="${l.quantity??''}"></label><label>Unité<select name="unit">${unitOptions(l.unit)}</select></label>
<label>Prix unitaire HT (€)<input name="unitPrice" inputmode="decimal" value="${l.unitPrice??''}" placeholder="À saisir"></label><label>TVA<select name="vatRate">${vatOptions(l.vatRate)}</select></label>
<label>Date<input type="date" name="date" value="${e(l.date||'')}"></label><p class="inv-line-total" aria-live="polite">${e(money(lineTotal(l)))}<small> HT</small></p></div>`;
  }
  function totalsHtml(lines){const t=invoiceTotals(lines);return`<dl class="inv-sum"><div><dt>Total HT</dt><dd>${e(money(t.ht))}</dd></div>${t.byRate.map(r=>`<div><dt>TVA ${e(rateLabel(r.rate))}</dt><dd>${e(money(r.tax))}</dd></div>`).join('')}<div class="is-grand"><dt>Total TTC</dt><dd>${e(money(t.ttc))}</dd></div></dl>${t.missing?`<p class="cost-detail">${e(plural(t.missing,'ligne sans prix','lignes sans prix'))} : à compléter avant l’émission.</p>`:''}`;}
  function edit(id){
    const inv=store.get('integrationImports',id);if(!inv||inv.deletedAt)return open();if(inv.status!=='brouillon')return view(id);
    draftLines=new Map((inv.lines||[]).map(l=>[l.id,l]));
    const avoir=inv.docType==='avoir',items=billableItems(state(),inv.clientId,{exceptId:inv.id}).filter(it=>!(inv.lines||[]).some(l=>l.source&&`${l.source.type}:${l.source.id}`===it.key));
    const body=`<form id="invoice-form" class="form-grid inv-form" novalidate data-id="${e(inv.id)}" data-version="${e(inv.version??'')}">
<div class="span-2 inv-client-box"><small>${avoir?'Avoir pour':'Client'}</small><strong>${e(inv.clientName)}</strong>${avoir&&inv.note?`<small>${e(inv.note)}</small>`:''}</div>
<label class="span-2">Adresse du client *<textarea name="clientAddress" rows="2">${e(inv.clientAddress||'')}</textarea></label>
<label>SIREN du client<input name="clientSiren" inputmode="numeric" value="${e(inv.clientSiren||'')}"></label><label>N° de TVA du client<input name="clientVat" value="${e(inv.clientVat||'')}"></label>
<label>Date d’émission *<input type="date" name="issueDate" value="${e(inv.issueDate||isoDay())}"></label><label>Échéance *<input type="date" name="dueDate" value="${e(inv.dueDate||'')}"></label>
<div class="span-2 inv-lines" data-invoice-lines>${(inv.lines||[]).map(lineCard).join('')||'<p class="empty-state">Aucune ligne : ajoutez une prestation.</p>'}</div>
<div class="span-2 inv-line-actions"><button type="button" class="button secondary" data-invoice="add-line">＋ Ligne libre</button>${!avoir&&items.length?`<button type="button" class="button secondary" data-invoice="add-items">＋ ${e(plural(items.length,'prestation non facturée','prestations non facturées'))}</button>`:''}</div>
<div class="span-2" data-invoice-totals>${totalsHtml(inv.lines||[])}</div>
<label class="span-2">Note sur la facture<textarea name="note" rows="2" maxlength="1000">${avoir?'':e(inv.note||'')}</textarea></label>
<p class="span-2 form-error hidden" role="alert"></p></form>`;
    modal(avoir?'Avoir en brouillon':'Facture en brouillon',`${inv.clientName} · modifiable jusqu’à l’émission`,body,`<button type="button" class="button secondary" data-invoice="list">Retour</button><button type="button" class="button danger" data-invoice="delete" data-id="${e(inv.id)}">Supprimer</button><button type="button" class="button secondary" data-invoice="preview">Aperçu</button><button type="button" class="button secondary" data-invoice="save">Enregistrer</button><button type="button" class="button primary inv-primary" data-invoice="emit">${avoir?'Émettre l’avoir…':'Émettre la facture…'}</button>`,'large');
  }
  function collect(form){
    const lines=[...form.querySelectorAll('.inv-line')].map((card,i)=>{const prev=draftLines.get(card.dataset.lineId)||{},v=n=>card.querySelector(`[name="${n}"]`)?.value??'';return{...prev,id:card.dataset.lineId||`l${i+1}`,label:v('label'),quantity:v('quantity'),unit:v('unit'),unitPrice:v('unitPrice'),vatRate:v('vatRate'),date:v('date')};});
    return{clientAddress:form.clientAddress.value,clientSiren:form.clientSiren.value,clientVat:form.clientVat.value,issueDate:form.issueDate.value,dueDate:form.dueDate.value,note:form.note.value,lines,clientName:store.get('integrationImports',form.dataset.id)?.clientName||''};
  }
  function liveTotals(form){
    const v=collect(form),checked=validateDraft(v),lines=checked.value?.lines||[];
    form.querySelectorAll('.inv-line').forEach((card,i)=>{const l=(v.lines[i]),t=lineTotal({quantity:String(l.quantity).replace(',','.'),unitPrice:String(l.unitPrice).replace(',','.')});const p=card.querySelector('.inv-line-total');if(p)p.innerHTML=`${e(money(t))}<small> HT</small>`;});
    const box=form.querySelector('[data-invoice-totals]');if(box)box.innerHTML=totalsHtml(lines);
  }
  async function save(form,{silent=false}={}){
    const values=collect(form),checked=validateDraft(values);if(checked.error){showError(form,checked.error);return null;}
    const saved=await saveDraft(store,form.dataset.id,values,{version:Number(form.dataset.version)||undefined});form.dataset.version=saved.version??'';draftLines=new Map((saved.lines||[]).map(l=>[l.id,l]));
    if(!silent)toast('Brouillon enregistré.','success');return saved;
  }
  function addLine(form,line=null){
    const box=form.querySelector('[data-invoice-lines]'),id=`l${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`,l=line?{...line,id}:{id,label:'',quantity:1,unit:'forfait',unitPrice:null,vatRate:invoiceSettings(state()).vatRate,date:''};
    draftLines.set(id,l);box.querySelector('.empty-state')?.remove();const count=box.querySelectorAll('.inv-line').length;box.insertAdjacentHTML('beforeend',lineCard(l,count));box.lastElementChild.querySelector('[name="label"]')?.focus();liveTotals(form);
  }
  function renumber(form){form.querySelectorAll('.inv-line').forEach((card,i)=>{card.querySelector('.inv-line-head strong').textContent=`Ligne ${i+1}`;card.querySelector('.inv-remove').setAttribute('aria-label',`Supprimer la ligne ${i+1}`);});}
  async function confirmEmit(form){
    const saved=await save(form,{silent:true});if(!saved)return;const data=state(),avoir=saved.docType==='avoir',problems=emissionProblems(data,saved,saved.docType||'facture'),settings=invoiceSettings(data);
    const year=Number(String(saved.issueDate||isoDay()).slice(0,4)),{number}=nextNumber(data,{prefix:settings.prefix,year}),t=invoiceTotals(saved.lines||[]);
    const body=problems.length?`<div class="notice danger inv-notice" role="alert"><p><strong>À compléter avant l’émission${colon}</strong></p><ul>${problems.map(p=>`<li>${e(p)}</li>`).join('')}</ul></div>`:`<p class="inv-confirm">${avoir?'L’avoir':'La facture'} recevra le numéro <strong>${e(number)}</strong> pour un total de <strong>${e(money(t.ttc))} TTC</strong>.</p><div class="notice warning inv-notice"><p>Une facture émise ne se modifie plus et ne se supprime pas${colon} toute correction passera par un avoir. La numérotation reste continue, sans trou.</p></div>`;
    const settingsButton=problems.some(p=>/Paramètres/.test(p))?'<button type="button" class="button secondary" data-invoice="settings">Paramètres</button>':'';
    modal(avoir?'Émettre l’avoir':'Émettre la facture',`${saved.clientName} · ${money(t.ttc)} TTC`,body,`<button type="button" class="button secondary" data-invoice="edit" data-id="${e(saved.id)}">Retour au brouillon</button>${settingsButton}${problems.length?'':`<button type="button" class="button primary inv-primary" data-invoice="emit-confirm" data-id="${e(saved.id)}" data-version="${e(saved.version??'')}">Émettre définitivement</button>`}`,'small');
  }

  // ---------- Facture émise ----------
  function view(id){
    const data=state(),inv=store.get('integrationImports',id);if(!inv||inv.deletedAt)return open();if(inv.status==='brouillon')return edit(id);
    const s=invoiceStatus(inv,data),avoir=inv.docType==='avoir',t=inv.totals||invoiceTotals(inv.lines||[]),credits=avoir?[]:creditNotesOf(data,inv),write=canWrite();
    const original=avoir?store.get('integrationImports',inv.creditOf):null;
    const pay=!avoir&&write&&s!=='annulee'?(inv.paidAt?`<div class="inv-pay"><p>Payée le ${e(dateFr(inv.paidAt))}${inv.paymentMethod?` · ${e(inv.paymentMethod)}`:''}.</p><button type="button" class="button secondary" data-invoice="unpay" data-id="${e(inv.id)}">Annuler le paiement</button></div>`:`<form id="invoice-pay-form" class="form-grid inv-pay" novalidate><label>Payée le *<input type="date" name="paidAt" value="${e(isoDay())}"></label><label>Moyen de paiement<select name="method"><option value="Virement">Virement</option><option value="Chèque">Chèque</option><option value="Prélèvement">Prélèvement</option><option value="Espèces">Espèces</option><option value="Compensation">Compensation</option></select></label><p class="span-2 form-error hidden" role="alert"></p><button type="button" class="button secondary span-2" data-invoice="pay" data-id="${e(inv.id)}">Marquer payée</button></form>`):'';
    const body=`<div class="inv-view-head">${statusPill(s)}<strong>${e(money(t.ttc))} TTC</strong></div>
<dl class="definition-list"><div><dt>Client</dt><dd>${e(inv.clientName)}</dd></div><div><dt>Date</dt><dd>${e(dateFr(inv.issueDate))}</dd></div>${avoir?`<div><dt>Facture d’origine</dt><dd>${original?`<button type="button" class="text-button" data-invoice="view" data-id="${e(original.id)}">${e(inv.creditOfNumber||original.number)}</button>`:e(inv.creditOfNumber||'—')}</dd></div>`:`<div><dt>Échéance</dt><dd>${e(dateFr(inv.dueDate))}</dd></div>`}<div><dt>Total HT</dt><dd>${e(money(t.ht))}</dd></div><div><dt>TVA</dt><dd>${e(money(t.tva))}</dd></div></dl>
<h3 class="inv-h3">${e(plural((inv.lines||[]).length,'ligne','lignes'))}</h3><div class="stack-list">${(inv.lines||[]).map(l=>`<div class="list-row"><div><strong>${e(l.label)}</strong><small>${e(qty(l.quantity))}${NB}${e(l.unit)} × ${e(money(l.unitPrice))} · TVA ${e(rateLabel(l.vatRate))}</small></div><strong>${e(money(lineTotal(l)))}</strong></div>`).join('')}</div>
${credits.length?`<h3 class="inv-h3">Avoirs</h3><div class="stack-list">${credits.map(a=>`<button type="button" class="list-row is-button" data-invoice="view" data-id="${e(a.id)}"><div><strong>${e(a.number)}</strong><small>${e(dateFr(a.issueDate))}</small></div><strong>${e(money(a.totals?.ttc))}</strong></button>`).join('')}</div>`:''}
${pay}<p class="cost-detail">${avoir?'Avoir émis':'Facture émise'} : non modifiable.${!avoir&&s!=='annulee'?' Pour corriger un montant, établissez un avoir.':''}</p>`;
    modal(`${avoir?'Avoir':'Facture'} ${inv.number}`,inv.clientName,body,`<button type="button" class="button secondary" data-invoice="list">Retour</button>${!avoir&&write&&s!=='annulee'?`<button type="button" class="button secondary" data-invoice="credit" data-id="${e(inv.id)}">Créer un avoir</button>`:''}<button type="button" class="button primary inv-primary" data-invoice="print" data-id="${e(inv.id)}">Imprimer / PDF</button>`,'small');
  }

  // ---------- Paramètres ----------
  function settings(){
    const s=invoiceSettings(state());
    const body=`<form id="invoice-settings-form" class="form-grid inv-form" novalidate>
<label class="span-2">Raison sociale *<input name="legalName" value="${e(s.legalName)}" autocomplete="organization" data-autofocus></label>
<label>Forme juridique<input name="legalForm" value="${e(s.legalForm)}" placeholder="Ex. EARL au capital de 7 500 €"></label><label>SIRET *<input name="siret" inputmode="numeric" value="${e(s.siret)}" placeholder="14 chiffres"></label>
<label class="span-2">Adresse *<textarea name="address" rows="2">${e(s.address)}</textarea></label>
<label>N° de TVA intracommunautaire<input name="vatNumber" value="${e(s.vatNumber)}" placeholder="FR…"></label><label>Préfixe de numérotation<input name="prefix" value="${e(s.prefix)}" maxlength="6"></label>
<label>Téléphone<input name="phone" inputmode="tel" value="${e(s.phone)}"></label><label>E-mail<input name="email" type="email" value="${e(s.email)}"></label>
<label>IBAN<input name="iban" value="${e(s.iban)}" autocomplete="off"></label><label>BIC<input name="bic" value="${e(s.bic)}" autocomplete="off"></label>
<div class="span-2"><span class="field-label">Délai de paiement</span>${chips('paymentDays',PAYMENT_TERMS.map(d=>[d,TERM_LABEL(d)]),s.paymentDays,'Délai de paiement')}</div>
<div class="span-2"><span class="field-label">TVA par défaut</span>${chips('vatRate',VAT_RATES.map(r=>[r,rateLabel(r)]),s.vatRate,'TVA par défaut')}</div>
<label class="span-2 inv-check"><input type="checkbox" name="vatOnDebits"${s.vatOnDebits?' checked':''}><span>Option pour le paiement de la TVA d’après les débits</span></label>
<label class="span-2">Pénalités et conditions<textarea name="penalty" rows="3">${e(s.penalty)}</textarea></label>
<label class="span-2">Mention complémentaire<input name="mention" value="${e(s.mention)}" placeholder="Ex. TVA non applicable, art. 293 B du CGI"></label>
<p class="span-2 cost-detail">Ces informations figurent sur chaque facture émise (elles y sont figées). Le préfixe permet une série par appareil si plusieurs personnes facturent hors ligne.</p>
<p class="span-2 form-error hidden" role="alert"></p></form>`;
    modal('Paramètres de facturation','Mentions obligatoires de vos factures',body,`<button type="button" class="button secondary" data-invoice="list">Retour</button><button type="button" class="button primary inv-primary" data-invoice="settings-save">Enregistrer</button>`,'small');
  }

  // ---------- Actions ----------
  function showError(form,message){const el=form?.querySelector('.form-error');if(!el)return toast(message,'error');el.textContent=message;el.classList.remove('hidden');el.scrollIntoView?.({block:'nearest'});}
  async function action(kind,control){
    const id=control.dataset.id;
    if(kind==='list')return open();
    if(kind==='filter')return open(control.dataset.value);
    if(kind==='prepare')return prepare(id||'');
    if(kind==='create')return create();
    if(kind==='edit')return edit(id);
    if(kind==='view')return view(id);
    if(kind==='settings')return settings();
    if(kind==='csv'){const csv=invoicesCsv(state());download(`factures-${isoDay()}.csv`,csv,'text/csv;charset=utf-8');return toast('Export CSV des factures téléchargé.','success');}
    if(kind==='settings-save'){const form=document.getElementById('invoice-settings-form'),fd=Object.fromEntries(new FormData(form));fd.vatOnDebits=form.vatOnDebits.checked;try{await saveSettings(store,fd);}catch(error){return showError(form,error.message);}toast('Paramètres de facturation enregistrés.','success');return open();}
    const form=document.getElementById('invoice-form');
    if(kind==='add-line')return addLine(form);
    if(kind==='add-items'){const inv=store.get('integrationImports',form.dataset.id),existing=new Set([...draftLines.values()].filter(l=>l.source).map(l=>`${l.source.type}:${l.source.id}`));for(const it of billableItems(state(),inv.clientId,{exceptId:inv.id}))if(!existing.has(it.key))addLine(form,it.line);control.remove();return;}
    if(kind==='remove-line'){const card=control.closest('.inv-line');draftLines.delete(card.dataset.lineId);card.remove();renumber(form);return liveTotals(form);}
    if(kind==='save'){await save(form);return;}
    if(kind==='preview'){const values=collect(form),checked=validateDraft(values);if(checked.error)return showError(form,checked.error);const inv={...store.get('integrationImports',form.dataset.id),...checked.value};openPrintable(invoiceHtml(state(),inv,{assetBase:assetBase()}),'Aperçu du brouillon');return;}
    if(kind==='emit')return confirmEmit(form);
    if(kind==='emit-confirm'){const saved=await emitInvoice(store,id,{version:Number(control.dataset.version)||undefined});toast(`${saved.docType==='avoir'?'Avoir':'Facture'} ${saved.number} émis${saved.docType==='avoir'?'':'e'}.`,'success');return view(saved.id);}
    if(kind==='delete'){const inv=await deleteDraft(store,id);open();toast('Brouillon supprimé.','success',{label:'Annuler',run:async()=>{await store.restore?.('integrationImports',inv.id);open();}});return;}
    if(kind==='print'){const inv=store.get('integrationImports',id);const how=openPrintable(invoiceHtml(state(),inv,{assetBase:assetBase()}),`${inv.docType==='avoir'?'Avoir':'Facture'} ${inv.number}`);if(how==='window')toast(`${inv.docType==='avoir'?'Avoir':'Facture'} ${inv.number} ouvert${inv.docType==='avoir'?'':'e'} dans un nouvel onglet.`,'success');return;}
    if(kind==='pay'){const f=document.getElementById('invoice-pay-form');if(!f.paidAt.value)return showError(f,'Champ obligatoire : Payée le');try{await markPaid(store,id,{paidAt:f.paidAt.value,method:f.method.value});}catch(error){return showError(f,error.message);}const inv=store.get('integrationImports',id);toast(`Facture ${inv.number} marquée payée.`,'success',{label:'Annuler',run:async()=>{await markPaid(store,id,{paidAt:null});view(id);}});return view(id);}
    if(kind==='unpay'){await markPaid(store,id,{paidAt:null});toast('Paiement retiré.','success');return view(id);}
    if(kind==='credit'){const draft=await createCreditNote(store,id);toast('Avoir préparé : vérifiez les montants avant de l’émettre.','success');return edit(draft.id);}
  }
  function chip(control){
    const group=control.closest('.chip-choices'),form=control.closest('form'),input=form?.querySelector(`input[type="hidden"][name="${control.dataset.name}"]`);if(!input)return;
    input.value=control.dataset.value;group.querySelectorAll('.choice-chip').forEach(c=>{const on=c===control;c.classList.toggle('is-on',on);c.setAttribute('aria-pressed',String(on));});form.querySelector('.form-error')?.classList.add('hidden');
  }

  document.addEventListener('click',event=>{
    const control=event.target.closest('[data-invoice]');if(!control||control.disabled)return;event.preventDefault();
    if(control.dataset.invoice==='chip')return chip(control);
    control.disabled=true;action(control.dataset.invoice,control).catch(error=>{const form=control.closest('.modal')?.querySelector('form');if(form?.querySelector('.form-error'))showError(form,error.message);else toast(error.message,'error');}).finally(()=>{if(control.isConnected)control.disabled=false;});
  });
  document.addEventListener('input',event=>{const form=event.target.closest?.('#invoice-form');if(form){form.querySelector('.form-error')?.classList.add('hidden');liveTotals(form);}});
  document.addEventListener('change',event=>{
    const prepForm=event.target.closest?.('#invoice-prepare-form');if(prepForm&&['clientId','from','to','fuel'].includes(event.target.name))refreshItems(prepForm);
    const f=event.target.closest?.('#invoice-form');if(f&&event.target.name==='issueDate'&&event.target.value){const due=f.dueDate;if(due&&(!due.value||due.value<event.target.value))due.value=addDays(event.target.value,invoiceSettings(state()).paymentDays);}
  });
  return{open,prepare,edit,view,settings};
}
export {INVOICE_KIND};
