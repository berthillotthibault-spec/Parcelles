// Facturation (vague 13) : cycle de vie des devis, conversions (acompte, facture, facture de solde),
// duplication, catalogue d’articles et de prestations, facturation récurrente, relances, journal des
// envois et lettrage des trop-perçus. Chargé à la demande, jamais au démarrage.
// Les documents restent ceux d’invoices.js (integrationImports, farmKind « invoice » / « quote ») ; le
// catalogue et les modèles récurrents sont deux nouveaux farmKind (« billingItem », « billingSchedule »),
// réservés comme les factures à la gestion (permissions.js, FINANCE_KINDS). Aucune émission automatique :
// une récurrence prépare un brouillon, l’utilisateur l’émet.
import {normalize,uid} from './utils.js';
import {active} from './farm-memory.js';
import {farmRecords,saveFarmRecord} from './farm-records.js';
import {INVOICE_KIND,QUOTE_KIND,DOC_LABELS,UNITS,MORE_UNITS,VAT_RATES_ALL,VAT_EXEMPTIONS,addDays,addMonths,addPayment,amountLine,cleanLine,createDraft,dateFr,docTypeOf,documentTotals,getDocument,invoiceBalance,invoiceSettings,invoiceStatus,invoices,isoDay,lineKind,patchEmitted,quoteStatus,round2,validDay,emitDocument} from './invoices.js';

export const CATALOG_KIND='billingItem';
export const SCHEDULE_KIND='billingSchedule';
export const FREQUENCIES=[['mensuel',1,'Mensuelle'],['trimestriel',3,'Trimestrielle'],['semestriel',6,'Semestrielle'],['annuel',12,'Annuelle']];
export const SEND_CHANNELS=['email','sms','whatsapp','share','courrier','autre'];
const text=v=>String(v??'').trim();
const loose=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const canWrite=(store,action,farmKind)=>!store.writeGuard||store.writeGuard({entity:'integrationImports',action,farmKind});
const UNIT_SET=new Set([...UNITS,...MORE_UNITS].map(([u])=>u));
const fr=v=>Number(v).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
const clientOf=(state,id)=>id?active(state,'clients').find(c=>c.id===id)||null:null;
// Client d’un document : fiche existante, sinon les coordonnées figées sur le document (client supprimé).
const docClient=(state,doc)=>{const c=clientOf(state,doc.clientId);return c?{clientId:c.id,client:null}:{clientId:null,client:{name:doc.clientName,address:doc.clientAddress,siren:doc.clientSiren,vatNumber:doc.clientVat,kind:doc.clientKind,email:doc.clientEmail,phone:doc.clientPhone}};};
const carry=(doc,keys)=>Object.fromEntries(keys.filter(k=>doc[k]!==undefined&&doc[k]!==null&&doc[k]!=='').map(k=>[k,doc[k]]));

// Envoi d’un devis ou émission d’une facture : numéro attribué à ce moment seulement.
export const issueDocument=emitDocument;

// ---------- Devis : acceptation, refus ----------
export async function acceptQuote(store,id,{date=isoDay(),signatory='',goodForAgreement=true,today=isoDay(),late=false}={}){
  const q=getDocument(store,id,[QUOTE_KIND]);if(docTypeOf(q)!=='devis')throw Error('Seul un devis s’accepte.');
  const s=quoteStatus(q,today);
  if(s==='brouillon')throw Error('Envoyez d’abord le devis (il reçoit alors son numéro).');
  if(s==='accepte'||s==='converti')throw Error('Ce devis est déjà accepté.');
  if(s==='refuse')throw Error('Ce devis a été refusé : dupliquez-le pour en établir un nouveau.');
  if(s==='expire'&&!late)throw Error(`Devis expiré le ${dateFr(q.validUntil)} : confirmez l’acceptation tardive ou établissez un nouveau devis.`);
  if(!validDay(date))throw Error('Date d’acceptation invalide.');if(date<q.issueDate)throw Error('L’acceptation ne peut pas précéder la date du devis.');
  const name=text(signatory);if(!name)throw Error('Champ obligatoire : Nom du signataire');
  return patchEmitted(store,id,{status:'accepte',acceptance:{date,signatory:name.slice(0,120),goodForAgreement:!!goodForAgreement,late:s==='expire',at:Date.now()}},{label:`Devis ${q.number} accepté`});
}
export async function refuseQuote(store,id,{date=isoDay(),reason=''}={}){
  const q=getDocument(store,id,[QUOTE_KIND]);if(docTypeOf(q)!=='devis')throw Error('Seul un devis se refuse.');
  const s=quoteStatus(q,date);if(s==='brouillon')throw Error('Un brouillon se supprime simplement.');if(s==='converti')throw Error('Ce devis est déjà facturé.');
  if(!validDay(date))throw Error('Date invalide.');
  return patchEmitted(store,id,{status:'refuse',refusal:{date,reason:text(reason).slice(0,300),at:Date.now()}},{label:`Devis ${q.number} refusé`});
}

// ---------- Acomptes, facture et facture de solde ----------
export function depositsOf(state,quoteId,{includeDrafts=true}={}){
  return invoices(state).filter(a=>a.docType==='acompte'&&a.quoteId===quoteId&&(includeDrafts||a.status!=='brouillon')&&invoiceStatus(a,state)!=='annulee');
}
export function quoteProgress(state,quote){
  const total=num(quote.totals?.ttc)??documentTotals(quote).ttc,deps=depositsOf(state,quote.id),emitted=deps.filter(a=>a.status!=='brouillon');
  const sum=list=>round2(list.reduce((s,a)=>s+(num(a.totals?.ttc)??documentTotals(a).ttc),0));
  const finals=invoices(state).filter(i=>i.quoteId===quote.id&&docTypeOf(i)==='facture'&&invoiceStatus(i,state)!=='annulee');
  return{total,deposited:sum(emitted),draftDeposits:sum(deps.filter(a=>a.status==='brouillon')),remaining:round2(total-sum(deps)),finalInvoices:finals};
}
// Lignes d’une facture d’acompte : un pourcentage ou un montant TTC du devis, ventilé par taux de TVA.
export function depositLines(quote,{percent=null,amount=null}={}){
  const t=quote.totals?.parTaux?quote.totals:documentTotals(quote),ttc=t.ttc,p=loose(percent),a=loose(amount);
  if(!(ttc>0))throw Error('Le devis n’a pas de montant à facturer.');
  if(p===null&&a===null)throw Error('Indiquez un pourcentage ou un montant d’acompte.');
  if(p!==null&&(p<=0||p>100))throw Error('Pourcentage d’acompte invalide (entre 0 et 100 %).');
  if(a!==null&&(a<=0||a>ttc+0.005))throw Error('Montant d’acompte invalide : il doit être positif et ne pas dépasser le devis.');
  const share=p!==null?p/100:a/ttc,groups=(t.parTaux||t.byRate).filter(g=>g.base),many=groups.length>1;
  const what=p!==null?`Acompte de ${String(round2(p)).replace('.',',')} %`:'Acompte';
  const lines=groups.map(g=>({label:`${what} sur le devis ${quote.number||''}${many?` (TVA ${String(g.rate).replace('.',',')} %)`:''}`.trim(),quantity:1,unit:'forfait',unitPrice:round2(g.base*share),vatRate:g.rate,...(g.exemption?{vatExemption:g.exemption}:{})}));
  // Montant TTC demandé : l’écart d’arrondi (un centime) est repris sur la plus grosse base.
  if(a!==null&&lines.length){const diff=round2(a-documentTotals({lines}).ttc);if(diff){const big=lines.reduce((m,l)=>Math.abs(l.unitPrice)>Math.abs(m.unitPrice)?l:m);big.unitPrice=round2(big.unitPrice+diff/(1+big.vatRate/100));}
    // Écart restant (un centime HT ne vaut pas un centime TTC) : ±0,01 € HT sur une ou deux lignes, taux le plus bas
    // d’abord ; si le montant exact est inatteignable (un seul taux), la variante la plus proche est gardée.
    const want=round2(a),gap=()=>Math.abs(round2(documentTotals({lines}).ttc-want));
    if(gap()){const order=[...lines].sort((x,y)=>(Number(x.vatRate)||0)-(Number(y.vatRate)||0)),base=lines.map(l=>l.unitPrice);let best={gap:gap(),prices:base};
      const tryIt=moves=>{moves.forEach(([l,d])=>{l.unitPrice=round2(l.unitPrice+d);});const g=gap();if(g<best.gap)best={gap:g,prices:lines.map(l=>l.unitPrice)};lines.forEach((l,i)=>{l.unitPrice=base[i];});return!g;};
      search:for(const[i,l]of order.entries()){for(const d of[0.01,-0.01]){if(tryIt([[l,d]]))break search;for(const m of order.slice(i+1))for(const e of[0.01,-0.01])if(tryIt([[l,d],[m,e]]))break search;}}
      lines.forEach((l,i)=>{l.unitPrice=best.prices[i];});}}
  return lines;
}
const QUOTE_CARRY=['operationNature','deliveryAddress','deliveryDate','vatExemption','reference','subject','clientKind','clientEmail','clientPhone'];
export async function createDepositInvoice(store,quoteId,{percent=null,amount=null,today=isoDay()}={}){
  const state=store.state,q=getDocument(store,quoteId,[QUOTE_KIND]);if(docTypeOf(q)!=='devis')throw Error('Un acompte se facture sur un devis.');
  if(quoteStatus(q,today)!=='accepte')throw Error('Enregistrez d’abord l’acceptation du devis.');
  const lines=depositLines(q,{percent,amount}),ttc=documentTotals({lines}).ttc,prog=quoteProgress(state,q);
  if(prog.total-prog.remaining+ttc>prog.total+0.005)throw Error(`Les acomptes dépassent le montant du devis (reste ${fr(Math.max(0,prog.remaining))} € TTC).`);
  const draft=await createDraft(store,{...docClient(state,q),docType:'acompte',lines,today,allowArchived:true,extra:{quoteId:q.id,quoteNumber:q.number,...carry(q,QUOTE_CARRY)}});
  await patchEmitted(store,q.id,{conversions:[...(getDocument(store,quoteId,[QUOTE_KIND]).conversions||[]),{type:'acompte',id:draft.id,at:Date.now()}]},{label:`Acompte préparé sur le devis ${q.number}`});
  return draft;
}
// Facture de solde : lignes du devis, puis déduction des acomptes émis (par taux de TVA, au prorata
// de ce qui n’a pas été annulé par avoir).
export function finalInvoiceLines(state,quote){
  const deps=depositsOf(state,quote.id);
  if(deps.some(a=>a.status==='brouillon'))throw Error('Un acompte de ce devis est encore en brouillon : émettez-le ou supprimez-le d’abord.');
  const own=(quote.lines||[]).map(({id:_id,source:_s,...l})=>({...l}));
  const deductions=[];
  for(const dep of deps){
    const credited=round2(Math.max(0,(num(dep.totals?.ttc)||0)-invoiceBalance(state,dep).net)),keep=dep.totals?.ttc?1-credited/dep.totals.ttc:1;
    for(const g of (dep.totals?.parTaux||dep.totals?.byRate||[]).filter(x=>x.base)){
      // Chaque déduction reprend exactement la base HT et la TVA de l’acompte (vatAmount) : la TVA du solde
      // vaut, par taux, « TVA du devis − TVA déjà facturée en acompte » (documentTotals), et acomptes + solde
      // retombent sur le HT, la TVA et le TTC du devis sans modifier aucun montant déduit.
      deductions.push({kind:'deduction',label:`Acompte ${dep.number} du ${dateFr(dep.issueDate)} déduit${(dep.totals.byRate||[]).length>1?` (TVA ${String(g.rate).replace('.',',')} %)`:''}`,quantity:1,unit:'forfait',unitPrice:-round2(g.base*keep),vatRate:g.rate,...(num(g.tax)!==null?{vatAmount:-round2(num(g.tax)*keep)}:{}),...(g.exemption?{vatExemption:g.exemption}:{}),source:{type:'deposit',id:dep.id}});
    }
  }
  return[...own,...deductions];
}
// Devis accepté (ou pro forma) → facture en brouillon ; les acomptes déjà facturés sont déduits.
export async function convertQuote(store,quoteId,{today=isoDay()}={}){
  const state=store.state,q=getDocument(store,quoteId,[QUOTE_KIND]),t=docTypeOf(q),s=quoteStatus(q,today);
  if(t==='devis'&&!['accepte','converti'].includes(s))throw Error(s==='brouillon'?'Envoyez puis faites accepter le devis avant de le facturer.':'Enregistrez d’abord l’acceptation du devis.');
  const live=invoices(state).filter(i=>i.quoteId===q.id&&docTypeOf(i)==='facture'&&invoiceStatus(i,state)!=='annulee');
  if(live.length)throw Error(`Ce devis est déjà facturé (${live[0].number||'brouillon en cours'}).`);
  const lines=finalInvoiceLines(state,q);
  const draft=await createDraft(store,{...docClient(state,q),docType:'facture',lines,today,allowArchived:true,extra:{quoteId:q.id,quoteNumber:q.number||null,...carry(q,[...QUOTE_CARRY,'discount','shipping'])}});
  const fresh=getDocument(store,quoteId,[QUOTE_KIND]);// relu : une autre conversion a pu s’ajouter entre-temps
  if(q.status!=='brouillon')await patchEmitted(store,q.id,{...(t==='devis'?{status:'converti'}:{}),conversions:[...(fresh.conversions||[]),{type:'facture',id:draft.id,at:Date.now()}]},{label:`${DOC_LABELS[t]} ${q.number||''} facturé`});
  return draft;
}

// ---------- Duplication ----------
// N’importe quel document (sauf un avoir) devient un nouveau brouillon, éventuellement d’un autre type.
// Les liens vers les travaux et les acomptes ne sont pas recopiés (ils restent facturés une seule fois).
export async function duplicateDocument(store,id,{docType=null,today=isoDay()}={}){
  const state=store.state,src=getDocument(store,id),t=docType||docTypeOf(src);
  if(docTypeOf(src)==='avoir'||t==='avoir')throw Error('Un avoir ne se duplique pas : il se crée depuis la facture à corriger.');
  if(t==='acompte')throw Error('Une facture d’acompte se crée depuis un devis accepté.');
  const c=clientOf(state,src.clientId);if(c?.archived)throw Error('Client archivé : réactivez sa fiche pour lui établir un nouveau document.');
  const lines=(src.lines||[]).filter(l=>lineKind(l)!=='deduction').map(({id:_id,source:_s,...l})=>({...l}));
  return createDraft(store,{...docClient(state,src),docType:t,lines,today,extra:carry(src,['operationNature','deliveryAddress','vatExemption','discount','shipping','subject','terms','goodForAgreement','clientKind'])});
}

// ---------- Catalogue d’articles et de prestations ----------
export const catalogItems=(state,{includeArchived=false}={})=>farmRecords(state,CATALOG_KIND).filter(i=>includeArchived||!i.archived).sort((a,b)=>String(a.category||'').localeCompare(String(b.category||''),'fr')||String(a.label).localeCompare(String(b.label),'fr'));
export function validateCatalogItem(v,{customRates=[]}={}){
  // « 55 € » ou « 55 €HT » se lisent comme 55 ; un prix saisi mais illisible est refusé (jamais enregistré vide).
  const euro=x=>typeof x==='string'?x.replace(/€|\bHT\b/gi,''):x,price=loose(euro(v.unitPrice)),rate=loose(v.vatRate),out={code:text(v.code).toUpperCase().slice(0,20),label:text(v.label).slice(0,200),description:text(v.description).slice(0,2000),unit:UNIT_SET.has(v.unit)?v.unit:'u',unitPrice:price,vatRate:rate!==null&&(VAT_RATES_ALL.includes(rate)||customRates.includes(rate))?rate:20,category:text(v.category).slice(0,60),account:text(v.account),archived:!!v.archived,clientPrices:[]};
  if(!out.label)return{error:'Champ obligatoire : Désignation',field:'Désignation'};
  if(out.code&&!/^[A-Z0-9][A-Z0-9_.-]*$/.test(out.code))return{error:'Code article : lettres, chiffres, tirets, points ou soulignés.',field:'Code'};
  if(price===null&&String(v.unitPrice??'').trim())return{error:'Prix unitaire HT illisible : saisissez un nombre (par exemple 55 ou 55,50).',field:'Prix unitaire HT'};
  if(price!==null&&price<0)return{error:'Prix unitaire négatif.',field:'Prix unitaire HT'};
  if(out.account&&!/^\d{3,10}$/.test(out.account))return{error:'Compte comptable invalide (3 à 10 chiffres).',field:'Compte'};
  if(VAT_EXEMPTIONS[v.vatExemption])out.vatExemption=v.vatExemption;
  for(const [i,p] of (Array.isArray(v.clientPrices)?v.clientPrices:[]).entries()){const cp=loose(euro(p?.unitPrice));if(!text(p?.clientId))continue;if(cp===null||cp<0)return{error:`Prix client invalide (ligne ${i+1}).`,field:'Prix client'};out.clientPrices.push({clientId:text(p.clientId),unitPrice:round2(cp)});}
  return{value:out};
}
export async function saveCatalogItem(store,values,id=null){
  if(!canWrite(store,id?'update':'create',CATALOG_KIND))throw Error('Votre rôle ne permet pas de modifier le catalogue.');
  const state=store.state,checked=validateCatalogItem(values,{customRates:invoiceSettings(state).customVatRates});if(checked.error)throw Error(checked.error);
  const existing=id?farmRecords(state,CATALOG_KIND).find(i=>i.id===id):null;if(id&&!existing)throw Error('Article introuvable.');
  const v=checked.value;if(v.code&&farmRecords(state,CATALOG_KIND).some(i=>i.id!==id&&i.code===v.code))throw Error(`Code déjà utilisé : ${v.code}`);
  return saveFarmRecord(store,CATALOG_KIND,{...v,name:v.label},existing);
}
export async function archiveCatalogItem(store,id,archived=true){
  if(!canWrite(store,'update',CATALOG_KIND))throw Error('Votre rôle ne permet pas de modifier le catalogue.');
  const item=farmRecords(store.state,CATALOG_KIND).find(i=>i.id===id);if(!item)throw Error('Article introuvable.');
  return store.upsert('integrationImports',{...item,archived:!!archived},{label:archived?`Article archivé : ${item.label}`:`Article réactivé : ${item.label}`});
}
// Import groupé (CSV / XLSX, centre Facturation) : une seule écriture pour tout le fichier, chaque ligne
// revalidée ; un code déjà présent met l’article à jour (prix client et archivage conservés). Renvoie de
// quoi annuler : identifiants créés et versions précédentes des articles modifiés (undoCatalogImport).
export async function importCatalogItems(store,rows){
  if(!canWrite(store,'create',CATALOG_KIND)||!canWrite(store,'update',CATALOG_KIND))throw Error('Votre rôle ne permet pas de modifier le catalogue.');
  const state=store.state,customRates=invoiceSettings(state).customVatRates,all=farmRecords(state,CATALOG_KIND),byId=new Map(all.map(i=>[i.id,i])),byCode=new Map(all.filter(i=>i.code).map(i=>[i.code,i]));
  const entities=[],created=[],previous=[],codes=new Set();
  for(const [n,row] of (Array.isArray(rows)?rows:[]).entries()){
    const at=row?.line||n+1,checked=validateCatalogItem(row?.values||{},{customRates});if(checked.error)throw Error(`Ligne ${at} : ${checked.error}`);
    const v=checked.value,existing=(row?.id&&byId.get(row.id))||(v.code&&byCode.get(v.code))||null;
    if(v.code){if(codes.has(v.code))throw Error(`Ligne ${at} : code en double dans le fichier (${v.code}).`);codes.add(v.code);}
    const keep=existing?{clientPrices:v.clientPrices.length?v.clientPrices:existing.clientPrices||[],archived:!!existing.archived}:{};
    const entity={...(existing||{}),id:existing?.id||uid(CATALOG_KIND),farmKind:CATALOG_KIND,format:'Parcelles',recordVersion:1,...v,...keep,name:v.label};
    if(existing)previous.push(JSON.parse(JSON.stringify(existing)));else created.push(entity.id);
    entities.push(entity);
  }
  if(!entities.length)throw Error('Aucun article à importer.');
  await store.upsertMany('integrationImports',entities,{label:`Catalogue importé : ${entities.length} article${entities.length>1?'s':''}`});
  return{created,previous,count:entities.length};
}
export async function undoCatalogImport(store,{created=[],previous=[]}={}){
  if(!canWrite(store,'update',CATALOG_KIND))throw Error('Votre rôle ne permet pas de modifier le catalogue.');
  // Sans droit de suppression (comptabilité), les articles créés par l’import sont archivés au lieu d’être supprimés.
  const canDelete=canWrite(store,'delete',CATALOG_KIND),still=created.map(id=>store.get('integrationImports',id)).filter(Boolean);
  if(canDelete)for(const item of still)await store.remove('integrationImports',item.id);
  const back=[...previous,...(canDelete?[]:still.map(item=>({...item,archived:true})))];
  if(back.length)await store.upsertMany('integrationImports',back,{label:'Import du catalogue annulé'});
  return{removed:canDelete?still.length:0,archived:canDelete?0:still.length,restored:previous.length};
}
export const catalogPrice=(item,clientId=null)=>{const own=(item?.clientPrices||[]).find(p=>p.clientId===clientId);return own?{price:own.unitPrice,basis:'Prix du client'}:{price:num(item?.unitPrice),basis:'Prix du catalogue'};};
export function catalogLine(item,{clientId=null,quantity=1}={}){
  const {price,basis}=catalogPrice(item,clientId);
  return{label:item.label,...(item.description?{description:item.description}:{}),quantity:loose(quantity)??1,unit:item.unit||'u',unitPrice:price,vatRate:item.vatRate??20,...(item.vatExemption?{vatExemption:item.vatExemption}:{}),itemId:item.id,...(item.account?{account:item.account}:{}),basis};
}
export function findCatalogItem(state,query){
  const q=normalize(query);if(!q)return null;const list=catalogItems(state);
  return list.find(i=>normalize(i.code)===q)||list.find(i=>normalize(i.label)===q)||list.find(i=>normalize(i.label).includes(q)||q.includes(normalize(i.label)))||null;
}

// ---------- Facturation récurrente ----------
const stepOf=f=>FREQUENCIES.find(([k])=>k===f)?.[1]||1;
export const schedules=state=>farmRecords(state,SCHEDULE_KIND);
export function validateSchedule(v,state){
  const settings=invoiceSettings(state),lines=(v.lines||[]).map((l,i)=>cleanLine(l,i,{customRates:settings.customVatRates})).filter(l=>amountLine(l)?l.label:l.label||l.description);
  const out={clientId:text(v.clientId),label:text(v.label).slice(0,120),lines,frequency:FREQUENCIES.some(([k])=>k===v.frequency)?v.frequency:'mensuel',nextDate:text(v.nextDate),endDate:text(v.endDate)||null,mode:v.mode==='emission'?'emission':'brouillon',active:v.active!==false,note:text(v.note).slice(0,1000)};
  const client=clientOf(state,out.clientId);if(!client)return{error:'Champ obligatoire : Client',field:'Client'};
  if(!out.label)out.label=`Facturation ${FREQUENCIES.find(([k])=>k===out.frequency)[2].toLowerCase()} · ${client.name}`;
  if(!lines.some(amountLine))return{error:'Ajoutez au moins une ligne facturable.',field:'Lignes'};
  const bad=lines.findIndex(l=>amountLine(l)&&(l.quantity===null||l.unitPrice===null));if(bad>=0)return{error:`Quantité et prix obligatoires (ligne ${bad+1}).`,field:'Lignes'};
  if(!validDay(out.nextDate))return{error:'Prochaine date invalide.',field:'Prochaine date'};
  if(out.endDate&&(!validDay(out.endDate)||out.endDate<out.nextDate))return{error:'La date de fin doit suivre la prochaine date.',field:'Fin'};
  out.anchorDay=Number(out.nextDate.slice(8,10));
  return{value:out};
}
export async function saveSchedule(store,values,id=null){
  if(!canWrite(store,id?'update':'create',SCHEDULE_KIND))throw Error('Votre rôle ne permet pas de modifier la facturation récurrente.');
  const checked=validateSchedule(values,store.state);if(checked.error)throw Error(checked.error);
  const existing=id?schedules(store.state).find(s=>s.id===id):null;if(id&&!existing)throw Error('Modèle introuvable.');
  // Prochaine date inchangée : le jour d’ancrage reste celui du modèle (31 → dernier jour du mois, même après février).
  if(existing?.anchorDay&&existing.nextDate===checked.value.nextDate)checked.value.anchorDay=existing.anchorDay;
  return saveFarmRecord(store,SCHEDULE_KIND,{...checked.value,name:checked.value.label},existing);
}
export function scheduleOccurrences(schedule,until){
  const out=[];if(!schedule?.active||!validDay(schedule.nextDate))return out;let d=schedule.nextDate;
  while(d<=until&&(!schedule.endDate||d<=schedule.endDate)&&out.length<36){out.push(d);d=addMonths(d,stepOf(schedule.frequency),schedule.anchorDay);}
  return out;
}
// Modèles dont une occurrence est arrivée (client actif) : à générer en brouillon.
export function dueSchedules(state,today=isoDay()){
  return schedules(state).map(s=>({schedule:s,dates:scheduleOccurrences(s,today),client:clientOf(state,s.clientId)})).filter(x=>x.dates.length&&x.client&&!x.client.archived);
}
// confirmEmission : l’utilisateur a confirmé l’émission dans la fenêtre (modèle en mode « émission ») ;
// sans cette confirmation explicite, la facture reste un brouillon. Si l’émission échoue (mention
// manquante…), le brouillon est conservé et l’erreur est renvoyée dans `emissionError`.
export async function generateAndIssue(store,id,{today=isoDay(),confirmEmission=false}={}){
  const draft=await generateFromSchedule(store,id,{today});
  if(!confirmEmission)return{draft,issued:null,emissionError:null};
  try{return{draft,issued:await emitDocument(store,draft.id,{today}),emissionError:null};}
  catch(error){return{draft,issued:null,emissionError:error.message};}
}
export async function generateFromSchedule(store,id,{today=isoDay()}={}){
  const state=store.state,s=schedules(state).find(x=>x.id===id);if(!s)throw Error('Modèle introuvable.');
  if(!canWrite(store,'update',SCHEDULE_KIND))throw Error('Votre rôle ne permet pas de générer cette facture.');
  const [date]=scheduleOccurrences(s,today);if(!date)throw Error('Aucune facture à générer pour ce modèle aujourd’hui.');
  if(invoices(state).some(i=>i.scheduleId===s.id&&i.periodStart===date&&invoiceStatus(i,state)!=='annulee'))throw Error('La facture de cette période est déjà générée.');
  const step=stepOf(s.frequency),periodEnd=addDays(addMonths(date,step,s.anchorDay),-1);
  const draft=await createDraft(store,{clientId:s.clientId,docType:'facture',lines:s.lines.map(({id:_id,...l})=>({...l})),from:date,to:periodEnd,today,extra:{scheduleId:s.id,proposeEmission:s.mode==='emission',...(s.note?{note:s.note}:{})}});
  const next=addMonths(date,step,s.anchorDay),ended=!!s.endDate&&next>s.endDate;
  await store.upsert('integrationImports',{...s,nextDate:next,active:ended?false:s.active,lastGenerated:{date,invoiceId:draft.id,at:Date.now()}},{label:`Facture récurrente préparée : ${s.label}`});
  return draft;
}

// ---------- Relances et journal des envois ----------
const cleanRecipients=list=>(Array.isArray(list)?list:[]).slice(0,30).map(r=>typeof r==='string'?{name:text(r).slice(0,120)}:{...(r?.id?{id:text(r.id)}:{}),name:text(r?.name).slice(0,120),...(r?.phone?{phone:text(r.phone).slice(0,30)}:{}),...(r?.email?{email:text(r.email).slice(0,160)}:{})});
const sentEntry=({date,channel,recipients,purpose,recordId})=>({date:validDay(date)?date:isoDay(),channel:SEND_CHANNELS.includes(channel)?channel:'autre',recipients:cleanRecipients(recipients),purpose:text(purpose).slice(0,20)||'envoi',...(recordId?{recordId:text(recordId)}:{}),at:Date.now()});
export async function logSent(store,id,{date=isoDay(),channel='email',recipients=[],purpose='envoi',recordId=null}={}){
  const doc=getDocument(store,id);if(doc.status==='brouillon')throw Error('Émettez (ou envoyez) le document avant de consigner son envoi.');
  return patchEmitted(store,id,{sentLog:[...(doc.sentLog||[]),sentEntry({date,channel,recipients,purpose,recordId})].slice(-100)},{label:`Envoi consigné : ${doc.number||DOC_LABELS[docTypeOf(doc)]}`});
}
export async function recordReminder(store,id,{level,date=isoDay(),channel='email',recipients=[],fee=0,recordId=null}={}){
  const inv=getDocument(store,id,[INVOICE_KIND]);if(inv.status==='brouillon'||inv.docType==='avoir')throw Error('Seule une facture émise se relance.');
  const lv=Math.floor(Number(level));if(!(lv>=1&&lv<=3))throw Error('Niveau de relance invalide (1 à 3).');
  const f=round2(Math.max(0,loose(fee)??0)),entry={level:lv,date:validDay(date)?date:isoDay(),channel:SEND_CHANNELS.includes(channel)?channel:'autre',fee:f,due:invoiceBalance(store.state,inv).due,at:Date.now()};
  return patchEmitted(store,id,{reminders:[...(inv.reminders||[]),entry].slice(-30),sentLog:[...(inv.sentLog||[]),sentEntry({date,channel,recipients,purpose:`relance${lv}`,recordId})].slice(-100)},{label:`Relance ${lv} : ${inv.number}`});
}

// ---------- Lettrage : trop-perçu reporté sur une autre facture du même client ----------
// Deux écritures successives (débit du trop-perçu, puis paiement par compensation) : en cas d’échec de
// la seconde, le trop-perçu reste visible et se rembourse ou se reporte de nouveau.
export async function transferOverpayment(store,{fromId,toId,amount=null,date=isoDay()}={}){
  const state=store.state,from=getDocument(store,fromId,[INVOICE_KIND]),to=getDocument(store,toId,[INVOICE_KIND]);
  if(from.id===to.id)throw Error('Choisissez une autre facture.');
  if((from.clientId||from.clientName)!==(to.clientId||to.clientName))throw Error('Le report se fait entre factures du même client.');
  const b1=invoiceBalance(state,from),b2=invoiceBalance(state,to),a=round2(loose(amount)??Math.min(b1.overpaid,b2.due));
  if(!(a>0))throw Error('Aucun montant à reporter.');if(a>b1.overpaid+0.005)throw Error('Le montant dépasse le trop-perçu.');if(a>b2.due+0.005)throw Error('Le montant dépasse le reste dû de la facture choisie.');
  await addPayment(store,from.id,{date,amount:-a,method:'compensation',reference:`Report sur ${to.number}`,fromId:to.id});
  return addPayment(store,to.id,{date,amount:a,method:'compensation',reference:`Trop-perçu de ${from.number}`,fromId:from.id});
}
