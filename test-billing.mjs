// Moteur de facturation (vague 13) : devis, acomptes, solde, avoirs, paiements, numérotation par série,
// mentions, catalogue, récurrences, tableau de bord, saisie rapide, Factur-X, journal FEC, QR SEPA, messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Store,emptyState} from './state.js';
import {canMutate} from './permissions.js';
import {INVOICE_KIND,QUOTE_KIND,addMonths,allocateNumber,compileNumbering,complianceReport,createCreditNote,createDraft,deleteDraft,documentTotals,emitDocument,emissionProblems,expectedReceipts,fingerprintOk,ibanValid,invoiceBalance,invoiceHtml,invoiceStatus,invoiceTotals,invoices,isoDay,fingerprint,invoiceView,legalMentions,luhnValid,nextNumber,numberingIssues,addPayment,removePayment,markPaid,patchEmitted,quotes,receivable,saveDraft,saveSettings,validateDraft,validateSettings} from './invoices.js';
import {CATALOG_KIND,SCHEDULE_KIND,acceptQuote,catalogItems,catalogLine,convertQuote,createDepositInvoice,dueSchedules,duplicateDocument,generateAndIssue,generateFromSchedule,logSent,quoteProgress,recordReminder,refuseQuote,saveCatalogItem,saveSchedule,schedules,transferOverpayment} from './billing.js';
import {agedBalance,billingDashboard,clientRisk,dso,forecastByWeek,parseQuickEntry,paymentDelays,probableDuplicates,quoteStats,quotesToFollow,remindersDue,revenueByClient,revenueByMonth,suggestPrice,unbilledAlerts} from './billing-insights.js';
import {billingFecText,billingJournal,billingLinesCsv,epcPayload,epcQrSvg,facturXProblems,facturXml,invoiceHtmlWithQr,parseXml,splitAddress,validateFacturX} from './billing-export.js';
import {documentMessage,fillTemplate} from './billing-messages.js';
import {treasuryFlows} from './treasury.js';
import {composeMorningBrief} from './home-story.js';

class MemoryStorage{constructor(){this.value=null;}async init(){}async get(){return this.value;}async set(_k,v){this.value=structuredClone(v);}async backupPut(){}async pruneBackups(){}async blobDelete(){}}
const SETTINGS={legalName:'EARL du Sougey',legalForm:'EARL au capital de 7 500 €',address:'1 route du Sougey\n01340 Montrevel',siret:'12345678900012',vatNumber:'FR12345678901',iban:'FR76 3000 6000 0112 3456 7890 189',bic:'AGRIFRPP',paymentDays:30,vatRate:20,prefix:'F'};
const CLIENTS=[
  {id:'c1',name:'GAEC du Bois',address:'Le Bois\n01000 Bourg-en-Bresse',contact:'Paul Martin',email:'gaec@exemple.fr',phone:'06 12 34 56 78',hourlyRate:60,kind:'pro',siren:'732829320'},
  {id:'c2',name:'Mme Durand',address:'3 rue Haute\n01340 Foissiat',kind:'particulier'},
  {id:'c3',name:'SCEA Ancienne',address:'Loin',archived:true}
];
async function makeStore({settings=true,clients=CLIENTS,extra={}}={}){
  const store=new Store(new MemoryStorage());await store.init();await store.setPreferences({autoBackup:false,fuelPrice:null});
  await store.upsertMany('clients',clients);
  for(const [t,list] of Object.entries(extra))await store.upsertMany(t,list);
  if(settings)await saveSettings(store,SETTINGS);
  return store;
}
const L=(label,quantity,unitPrice,vatRate=20,more={})=>({label,quantity,unit:'h',unitPrice,vatRate,...more});
const doc=(store,id)=>store.get('integrationImports',id);
async function issued(store,{clientId='c1',lines,docType='facture',today='2026-10-01',extra={}}){
  const d=await createDraft(store,{clientId,lines,docType,today,extra});return emitDocument(store,d.id,{today});
}

test('montants : remise ligne, remise globale répartie par taux, frais, TVA mixte, quantités décimales',()=>{
  const lines=[L('Pelle',3.5,65,20,{discountPct:10}),L('Cailloux',12.25,18,10),L('Conseil',1,99.99,5.5),{kind:'section',label:'Divers'},{kind:'comment',label:'Note',description:'texte'},L('Transport',2,40,20)];
  const plain=documentTotals({lines});
  assert.equal(plain.ht,round(204.75+220.5+99.99+80));
  assert.deepEqual(plain.byRate,invoiceTotals(lines).byRate,'sans remise ni frais : même ventilation que l’ancien calcul');
  const t=documentTotals({lines,discount:{type:'pct',value:10},shipping:{label:'Déplacement',amount:30,vatRate:20}});
  assert.equal(t.linesHt,605.24);assert.equal(t.discount,60.53);assert.equal(t.shipping,30);
  assert.equal(t.ht,round(605.24-60.53+30));
  assert.equal(t.tva,round(t.parTaux.reduce((s,p)=>s+p.tax,0)));assert.equal(t.ttc,round(t.ht+t.tva));
  for(const p of t.parTaux)assert.equal(p.tax,round(p.base*p.rate/100),'TVA arrondie par taux');
  const amount=documentTotals({lines,discount:{type:'amount',value:100}});
  assert.equal(amount.discount,100,'remise en montant répartie sans perte de centime');
  // Un avoir (quantités opposées) est exactement l’opposé de la facture, remise comprise.
  const neg=documentTotals({lines:lines.map(l=>l.quantity!==undefined?{...l,quantity:-l.quantity}:l),discount:{type:'pct',value:10},shipping:{amount:-30,vatRate:20}});
  assert.deepEqual([neg.ht,neg.tva,neg.ttc],[-t.ht,-t.tva,-t.ttc]);
});
const round=v=>Math.round((v+Number.EPSILON)*100)/100;

test('validations : remise, frais, échéancier, dates, SIREN, IBAN et clé de Luhn',()=>{
  const base={clientName:'X',issueDate:'2026-10-01',dueDate:'2026-10-31',lines:[L('A',1,100)]};
  assert.match(validateDraft({...base,discount:{type:'pct',value:120}}).error,/100 %/);
  assert.match(validateDraft({...base,discount:{type:'amount',value:500}}).error,/dépasse/);
  assert.match(validateDraft({...base,shipping:{amount:-5}}).error,/négatifs/);
  assert.match(validateDraft({...base,installments:[{date:'2026-10-15',amount:50},{date:'2026-11-15',amount:50}]}).error,/diffère du total/);
  assert.deepEqual(validateDraft({...base,installments:[{date:'2026-11-15',amount:60},{date:'2026-10-15',amount:60}]}).value.installments.map(i=>i.date),['2026-10-15','2026-11-15']);
  assert.match(validateDraft({...base,dueDate:'2026-09-01'}).error,/suivre/);
  assert.match(validateDraft({...base,issueDate:'2026-02-30'}).error,/invalide/);
  assert.match(validateDraft({...base,clientSiren:'12'}).error,/SIREN/);
  assert.ok(ibanValid('FR76 3000 6000 0112 3456 7890 189'));assert.ok(!ibanValid('FR76 3000 6000 0112 3456 7890 188'));
  assert.match(validateSettings({...SETTINGS,iban:'FR7630006000011234567890188'}).error,/clé/);
  assert.ok(luhnValid('732829320'));assert.ok(!luhnValid('732829321'));
  assert.match(validateSettings({...SETTINGS,numbering:{facture:{format:'{PREFIXE}-{NUM}',reset:'annuel'}}}).error,/annuelle exige l’année/);
  assert.match(validateSettings({...SETTINGS,numbering:{facture:{format:'{PREFIXE}{AAAA}'}}}).error,/\{NUM\}/);
});

test('numérotation : format à jetons, séries par type, départ, remise à zéro annuelle, changement d’année',()=>{
  const c=compileNumbering('{PREFIXE}{AA}{MM}-{NUM:3}','FA');
  assert.equal(c.build({date:'2027-01-05',seq:7}),'FA2701-007');assert.deepEqual(c.parse('FA2701-007'),{seq:7,year:2027,month:1});
  assert.match(compileNumbering('{PREFIXE}{AAAA}{AA}{NUM}','F').error,/pas les deux/);
  assert.match(compileNumbering('{X}{NUM}','F').error,/inconnu/);
  const s=emptyState();
  s.exploitation={...s.exploitation,invoicing:{...SETTINGS,numbering:{avoir:{prefix:'AV',format:'{PREFIXE}{AAAA}-{NUM:3}'},devis:{prefix:'D',format:'{PREFIXE}-{NUM:5}',reset:'jamais',startAt:120}}}};
  s.integrationImports=[{id:'a',farmKind:INVOICE_KIND,status:'emise',docType:'facture',number:'F2026-0041',issueDate:'2026-12-31'},{id:'b',farmKind:INVOICE_KIND,status:'emise',docType:'avoir',number:'AV2026-003',issueDate:'2026-12-20'}];
  assert.equal(allocateNumber(s,'facture','2026-12-31').number,'F2026-0042');
  assert.equal(allocateNumber(s,'acompte','2026-12-31').number,'F2026-0042','acompte dans la série des factures');
  assert.equal(allocateNumber(s,'facture','2027-01-01').number,'F2027-0001','remise à zéro au 1er janvier');
  assert.equal(allocateNumber(s,'avoir','2026-12-31').number,'AV2026-004');
  assert.equal(allocateNumber(s,'devis','2027-03-01').number,'D-00120','départ choisi, sans remise à zéro');
  assert.equal(nextNumber(s,{prefix:'F',year:2026}).number,'F2026-0042','ancienne signature conservée');
  assert.equal(addMonths('2026-01-31',1),'2026-02-28');assert.equal(addMonths('2028-01-31',1),'2028-02-29');
  // Date civile locale, jamais décalée par le fuseau (toISOString donnerait la veille à l’est de Greenwich).
  assert.equal(isoDay(new Date(2026,0,1,0,30)),'2026-01-01');
});

test('documents anciens : statut, solde, numérotation continue, impression et trésorerie inchangés',async()=>{
  const legacy=[
    {id:'old1',farmKind:INVOICE_KIND,status:'emise',docType:'facture',number:'F2026-0001',sequence:1,issueDate:'2026-03-01',dueDate:'2026-03-31',clientId:'c1',clientName:'GAEC du Bois',clientAddress:'Le Bois',lines:[{id:'l1',label:'Semis',quantity:4,unit:'h',unitPrice:60,vatRate:20}],totals:{ht:240,tva:48,ttc:288,byRate:[{rate:20,base:240,tax:48}],missing:0},seller:{legalName:'EARL du Sougey',siret:'12345678900012',prefix:'F'},paidAt:'2026-04-02',paymentMethod:'Virement'},
    {id:'old2',farmKind:INVOICE_KIND,status:'emise',number:'F2026-0002',sequence:2,issueDate:'2026-05-01',dueDate:'2026-05-31',clientId:'c1',clientName:'GAEC du Bois',clientAddress:'Le Bois',lines:[{id:'l1',label:'Labour',quantity:5,unit:'h',unitPrice:60,vatRate:20}],totals:{ht:300,tva:60,ttc:360,byRate:[{rate:20,base:300,tax:60}],missing:0},seller:{legalName:'EARL du Sougey',siret:'12345678900012'}},
    {id:'old3',farmKind:INVOICE_KIND,status:'emise',docType:'avoir',creditOf:'old2',creditOfNumber:'F2026-0002',number:'F2026-0003',issueDate:'2026-05-10',clientId:'c1',clientName:'GAEC du Bois',lines:[{id:'l1',label:'Labour',quantity:-1,unit:'h',unitPrice:60,vatRate:20}],totals:{ht:-60,tva:-12,ttc:-72,byRate:[{rate:20,base:-60,tax:-12}],missing:0}}
  ];
  const store=await makeStore({extra:{integrationImports:legacy}}),s=store.state;
  assert.equal(invoiceStatus(doc(store,'old1'),s,'2026-10-01'),'payee','« payée le » sans détail : réglée en entier');
  assert.equal(invoiceStatus(doc(store,'old2'),s,'2026-10-01'),'retard');
  assert.deepEqual([invoiceBalance(s,doc(store,'old2')).due,invoiceBalance(s,doc(store,'old2')).credited],[288,72]);
  assert.equal(fingerprintOk(doc(store,'old1')),null,'pas d’empreinte sur un document ancien');
  assert.deepEqual(numberingIssues(s),{duplicates:[],gaps:[]});
  assert.deepEqual(receivable(s,'2026-10-01'),{due:288,late:288,lateCount:1,draft:0});
  const html=invoiceHtml(s,doc(store,'old1'));assert.ok(html.includes('F2026-0001')&&!/NaN|undefined/.test(html));
  const flows=treasuryFlows(s,{start:'2026-10',today:'2026-10-01'});
  assert.ok(JSON.stringify(flows).includes('F2026-0002'),'trésorerie : reste dû de la facture ancienne');
  // Paiement partiel sur une facture ancienne, puis émission : la numérotation continue.
  await addPayment(store,'old2',{date:'2026-10-02',amount:100,method:'cheque',reference:'CHQ 123'});
  assert.equal(invoiceStatus(doc(store,'old2'),store.state,'2026-10-03'),'retard');
  assert.equal(invoiceBalance(store.state,doc(store,'old2')).due,188);
  const e=await issued(store,{lines:[L('Broyage',2,60)],today:'2026-10-05'});
  assert.equal(e.number,'F2026-0004');assert.equal(fingerprintOk(e),true);
  // Ancien bouton « payée » : solde le reste en un paiement.
  await markPaid(store,'old2',{paidAt:'2026-10-06',method:'Virement'});
  assert.equal(invoiceStatus(doc(store,'old2'),store.state,'2026-10-07'),'payee');
  assert.deepEqual(doc(store,'old2').payments.map(p=>p.amount),[100,188]);
});

test('devis : envoi numéroté, validité, acceptation datée et signée, refus, expiration, duplication',async()=>{
  const store=await makeStore();
  const q=await createDraft(store,{clientId:'c1',docType:'devis',lines:[L('Pelle',10,65),L('Cailloux',20,18,10,{unit:'t'})],today:'2026-10-01'});
  assert.equal(q.farmKind,QUOTE_KIND);assert.equal(q.validUntil,'2026-10-31');assert.equal(q.number,null);
  await assert.rejects(acceptQuote(store,q.id,{signatory:'P. Martin'}),/Envoyez d’abord/);
  const sent=await emitDocument(store,q.id,{today:'2026-10-01'});
  assert.equal(sent.number,'D2026-0001');assert.equal(sent.status,'envoye');assert.equal(invoiceStatus(sent,store.state,'2026-10-02'),'envoye');
  assert.equal(invoiceStatus(sent,store.state,'2026-11-01'),'expire');
  assert.ok(invoiceHtml(store.state,sent).includes('Bon pour accord'));
  await assert.rejects(acceptQuote(store,q.id,{signatory:''}),/signataire/);
  await assert.rejects(acceptQuote(store,q.id,{signatory:'P. Martin',date:'2026-11-03',today:'2026-11-03'}),/expiré/);
  const ok=await acceptQuote(store,q.id,{signatory:'Paul Martin',date:'2026-10-05',today:'2026-10-05'});
  assert.deepEqual([ok.status,ok.acceptance.signatory,ok.acceptance.goodForAgreement],['accepte','Paul Martin',true]);
  assert.ok(invoiceHtml(store.state,ok).includes('Accepté le 05/10/2026 par Paul Martin'));
  await assert.rejects(patchEmitted(store,q.id,{lines:[]}),/figé/);
  // Refus et duplication.
  const q2=await issued(store,{docType:'devis',lines:[L('Haie',3,50)],today:'2026-10-02'});
  const r=await refuseQuote(store,q2.id,{date:'2026-10-10',reason:'Trop cher'});assert.equal(r.status,'refuse');
  const dup=await duplicateDocument(store,q2.id,{today:'2026-10-11'});
  assert.deepEqual([dup.docType,dup.status,dup.number,dup.lines.length],['devis','brouillon',null,1]);
  const asInvoice=await duplicateDocument(store,q2.id,{docType:'facture',today:'2026-10-11'});assert.equal(asInvoice.farmKind,INVOICE_KIND);
  // Pro forma : sans numéro ni valeur comptable.
  const pf=await issued(store,{docType:'proforma',lines:[L('Pelle',1,65)],today:'2026-10-03'});
  assert.equal(pf.number,null);assert.ok(legalMentions(store.state,pf).some(m=>/pro forma/.test(m)));
  assert.equal(quotes(store.state).length,4);
});

test('acomptes, refus du dépassement, facture de solde qui déduit les acomptes',async()=>{
  const store=await makeStore();
  const q=await issued(store,{docType:'devis',lines:[L('Terrassement',10,65),L('Cailloux',20,18,10,{unit:'t'})],today:'2026-10-01'});
  await assert.rejects(createDepositInvoice(store,q.id,{percent:30}),/acceptation/);
  await acceptQuote(store,q.id,{signatory:'Paul Martin',date:'2026-10-02',today:'2026-10-02'});
  const total=documentTotals(q).ttc;assert.equal(total,round(650*1.2+360*1.1));
  const d1=await createDepositInvoice(store,q.id,{percent:30,today:'2026-10-03'});
  assert.equal(d1.docType,'acompte');assert.equal(d1.quoteId,q.id);assert.equal(d1.lines.length,2,'ventilé par taux');
  assert.ok(Math.abs(d1.totals.ttc-total*0.3)<0.02);
  const e1=await emitDocument(store,d1.id,{today:'2026-10-03'});assert.equal(e1.number,'F2026-0001');assert.equal(e1.quoteNumber,'D2026-0001');
  await assert.rejects(createDepositInvoice(store,q.id,{amount:total}),/dépassent/);
  const d2=await createDepositInvoice(store,q.id,{amount:200,today:'2026-10-04'});assert.equal(d2.totals.ttc,200,'montant TTC exact');
  await assert.rejects(convertQuote(store,q.id,{today:'2026-10-05'}),/encore en brouillon/);
  await emitDocument(store,d2.id,{today:'2026-10-04'});
  assert.equal(quoteProgress(store.state,doc(store,q.id)).remaining,round(total-e1.totals.ttc-200));
  const fin=await convertQuote(store,q.id,{today:'2026-10-20'});
  assert.equal(doc(store,q.id).status,'converti');
  const ded=fin.lines.filter(l=>l.kind==='deduction');assert.equal(ded.length,4);
  assert.equal(fin.totals.ttc,round(total-e1.totals.ttc-200),'solde = devis − acomptes');
  assert.deepEqual(emissionProblems(store.state,fin,'facture',{today:'2026-10-20'}),[]);
  const ef=await emitDocument(store,fin.id,{today:'2026-10-20'});assert.equal(ef.number,'F2026-0003');
  await assert.rejects(convertQuote(store,q.id,{today:'2026-10-21'}),/déjà facturé/);
  const v=validateFacturX(facturXml(store.state,ef));assert.deepEqual(v.errors,[]);
  const depXml=facturXml(store.state,e1);assert.match(depXml,/<ram:TypeCode>386<\/ram:TypeCode>/);assert.deepEqual(validateFacturX(depXml).errors,[]);
});

test('avoirs partiels, avoir supérieur refusé, client archivé, immuabilité et émissions simultanées',async()=>{
  const store=await makeStore();
  const inv=await issued(store,{lines:[L('Pelle',10,65),L('Cailloux',5,18,10,{unit:'t'})],today:'2026-10-01'});
  const part=await createCreditNote(store,inv.id,{lines:[inv.lines[0]].map(l=>({...l,quantity:2})),today:'2026-10-02'});
  assert.equal(part.totals.ttc,-156);
  const pe=await emitDocument(store,part.id,{today:'2026-10-02'});assert.equal(pe.number,'F2026-0002');assert.equal(pe.creditOfNumber,'F2026-0001');
  assert.equal(invoiceBalance(store.state,doc(store,inv.id)).due,round(inv.totals.ttc-156));
  const big=await createCreditNote(store,inv.id,{today:'2026-10-03'});
  await assert.rejects(emitDocument(store,big.id,{today:'2026-10-03'}),/dépasse le montant restant/);
  await deleteDraft(store,big.id);
  // Avoir dont le total n’est pas négatif refusé.
  const zero=await createCreditNote(store,inv.id,{lines:[{...inv.lines[0],quantity:0}],today:'2026-10-03'});
  assert.ok(emissionProblems(store.state,zero,'avoir').some(p=>/total négatif/.test(p)));await deleteDraft(store,zero.id);
  // Client archivé : pas de nouveau document, mais l’avoir reste possible.
  await assert.rejects(createDraft(store,{clientId:'c3',lines:[L('A',1,1)]}),/archivé/);
  // Émissions simultanées (double clic) : deux numéros successifs, jamais le même.
  const a=await createDraft(store,{clientId:'c2',lines:[L('A',1,10)],today:'2026-10-05'}),b=await createDraft(store,{clientId:'c2',lines:[L('B',1,20)],today:'2026-10-05'});
  const [ea,eb]=await Promise.all([emitDocument(store,a.id,{today:'2026-10-05'}),emitDocument(store,b.id,{today:'2026-10-05'})]);
  assert.notEqual(ea.number,eb.number);assert.deepEqual([ea.number,eb.number].sort(),['F2026-0003','F2026-0004']);
  const twice=await Promise.allSettled([emitDocument(store,a.id),emitDocument(store,a.id)]);assert.ok(twice.every(r=>r.status==='rejected'));
  assert.deepEqual(numberingIssues(store.state),{duplicates:[],gaps:[]});
  // Chronologie : pas d’émission antidatée avant la dernière pièce de la série.
  const late=await createDraft(store,{clientId:'c2',lines:[L('C',1,5)],today:'2026-09-01'});
  await assert.rejects(emitDocument(store,late.id,{today:'2026-10-06'}),/chronologique/);
  // Montants négatifs : une facture ne porte pas de prix négatif (sauf acompte déduit).
  await saveDraft(store,late.id,{...late,issueDate:'2026-10-06',dueDate:'2026-11-06',lines:[L('Remise',1,-5)]});
  assert.ok(emissionProblems(store.state,doc(store,late.id),'facture',{today:'2026-10-06'}).some(p=>/négatif/.test(p)));
});

test('paiements partiels, trop-perçu, remboursement, lettrage, échéancier et retards',async()=>{
  const store=await makeStore();
  const inv=await issued(store,{lines:[L('Pelle',10,100)],today:'2026-10-01',extra:{installments:[{date:'2026-10-15',amount:600},{date:'2026-11-15',amount:600}]}});
  assert.equal(inv.totals.ttc,1200);
  assert.equal(invoiceStatus(inv,store.state,'2026-10-10'),'emise');
  assert.equal(invoiceStatus(inv,store.state,'2026-10-20'),'retard','première échéance impayée');
  await addPayment(store,inv.id,{date:'2026-10-14',amount:600,method:'virement'});
  assert.equal(invoiceStatus(doc(store,inv.id),store.state,'2026-10-20'),'partielle');
  assert.deepEqual(expectedReceipts(store.state,'2026-10-20').map(r=>[r.date,r.amount]),[['2026-11-15',600]]);
  await assert.rejects(addPayment(store,inv.id,{amount:-10}),/trop-perçu/);
  await addPayment(store,inv.id,{date:'2026-11-10',amount:650,method:'cheque'});
  const b=invoiceBalance(store.state,doc(store,inv.id));assert.deepEqual([b.due,b.overpaid],[0,50]);
  assert.equal(invoiceStatus(doc(store,inv.id),store.state,'2026-11-20'),'payee');
  // Trop-perçu reporté sur une autre facture du client (compensation).
  const other=await issued(store,{lines:[L('Haie',1,100)],today:'2026-11-12'});
  await transferOverpayment(store,{fromId:inv.id,toId:other.id,date:'2026-11-12'});
  assert.equal(invoiceBalance(store.state,doc(store,inv.id)).overpaid,0);assert.equal(invoiceBalance(store.state,doc(store,other.id)).due,70);
  const pay=doc(store,other.id).payments[0];await removePayment(store,other.id,pay.id);assert.equal(invoiceBalance(store.state,doc(store,other.id)).due,120);
  await assert.rejects(addPayment(store,inv.id,{amount:10,date:'2026-13-01'}),/Date/);
});

test('mentions et conformité : client pro, SIREN 2027, franchise, autoliquidation, livraison, débits',async()=>{
  const store=await makeStore();
  const pro={clientName:'SARL TP',clientKind:'pro',clientAddress:'Ici',issueDate:'2026-10-01',dueDate:'2026-10-31',docType:'facture',lines:[L('Pelle',1,65)]};
  assert.ok(complianceReport(store.state,pro).warnings.some(w=>/SIREN du client professionnel/.test(w)));
  assert.ok(complianceReport(store.state,{...pro,issueDate:'2027-09-02'},{today:'2027-09-02'}).errors.some(e=>/SIREN/.test(e)),'obligatoire au 1er septembre 2027');
  assert.ok(complianceReport(store.state,{...pro,lines:[L('Export',1,10,0)]}).errors.some(e=>/exonération/.test(e)));
  const auto=legalMentions(store.state,{...pro,clientSiren:'732829320',lines:[L('Sous-traitance BTP',1,10,0,{vatExemption:'autoliquidation'})],deliveryAddress:'Chantier\n01000 Bourg'});
  assert.ok(auto.some(m=>/Autoliquidation/.test(m)));assert.ok(auto.some(m=>/Adresse de livraison : Chantier, 01000 Bourg/.test(m)));
  assert.ok(auto.some(m=>/40 €/.test(m)));assert.ok(auto.some(m=>/prestations de services/.test(m)));
  await saveSettings(store,{...SETTINGS,vatRegime:'franchise',vatOnDebits:true});
  assert.ok(complianceReport(store.state,pro).errors.some(e=>/Franchise en base/.test(e)));
  assert.ok(legalMentions(store.state,{...pro,lines:[L('Pelle',1,65,0)]}).some(m=>/293 B/.test(m)));
  await saveSettings(store,{...SETTINGS,vatRegime:'normal',vatOnDebits:true});
  assert.ok(legalMentions(store.state,pro).some(m=>/d’après les débits/.test(m)));
  // Paramètres du vendeur figés à l’émission : un changement ultérieur ne touche pas la pièce émise.
  const e=await issued(store,{lines:[L('Pelle',1,65)],today:'2026-10-01'});
  await saveSettings(store,{...SETTINGS,legalName:'EARL Nouvelle'});
  assert.ok(invoiceHtml(store.state,doc(store,e.id)).includes('EARL du Sougey'));
});

test('rôles : catalogue, devis et récurrences réservés à la gestion et à la comptabilité',async()=>{
  for(const farmKind of [CATALOG_KIND,SCHEDULE_KIND,QUOTE_KIND,INVOICE_KIND]){
    assert.equal(canMutate('accountant',{entity:'integrationImports',action:'create',farmKind}),true);
    assert.equal(canMutate('operator',{entity:'integrationImports',action:'create',farmKind}),false);
  }
  const store=await makeStore();store.writeGuard=op=>canMutate('operator',op);
  await assert.rejects(saveCatalogItem(store,{label:'Pelle',unitPrice:65}),/rôle/);
  await assert.rejects(createDraft(store,{clientId:'c1',docType:'devis',lines:[]}),/rôle/);
  await assert.rejects(saveSettings(store,{legalName:'EARL'},{partial:true}),/rôle/);
  // Réglages de facturation : la comptabilité les tient (sans toucher au reste de l’exploitation).
  assert.equal(canMutate('accountant',{entity:'exploitation',action:'update',farmKind:'invoice'}),true);
  assert.equal(canMutate('accountant',{entity:'exploitation',action:'update'}),false);
  assert.equal(canMutate('viewer',{entity:'exploitation',action:'update',farmKind:'invoice'}),false);
  const compta=await makeStore();compta.writeGuard=op=>canMutate('accountant',op);
  await saveSettings(compta,{legalName:'EARL du Sougey'},{partial:true});
  assert.equal(compta.state.exploitation.invoicing.legalName,'EARL du Sougey');
  await assert.rejects(compta.setExploitation({latitude:46}),/rôle/);
});

test('catalogue : prix client, code unique, archivage ; récurrences sans émission automatique',async()=>{
  const store=await makeStore();
  const item=await saveCatalogItem(store,{code:'pel-8t',label:'Pelle 8 t',unit:'h',unitPrice:65,vatRate:20,category:'TP',account:'7061',clientPrices:[{clientId:'c1',unitPrice:60}]});
  assert.equal(item.code,'PEL-8T');assert.equal(item.farmKind,CATALOG_KIND);
  await assert.rejects(saveCatalogItem(store,{code:'PEL-8T',label:'Autre'}),/déjà utilisé/);
  await assert.rejects(saveCatalogItem(store,{label:'X',account:'abc'}),/Compte/);
  assert.deepEqual([catalogLine(item,{clientId:'c1'}).unitPrice,catalogLine(item,{clientId:'c2'}).unitPrice],[60,65]);
  assert.equal(catalogItems(store.state).length,1);
  // Modèle mensuel, le 31 : fin de mois respectée.
  await assert.rejects(saveSchedule(store,{clientId:'c1',lines:[],nextDate:'2026-01-31'}),/ligne/);
  const sc=await saveSchedule(store,{clientId:'c1',frequency:'mensuel',nextDate:'2026-01-31',endDate:'2026-03-31',mode:'emission',lines:[catalogLine(item,{clientId:'c1',quantity:10})]});
  assert.equal(dueSchedules(store.state,'2026-01-30').length,0);assert.equal(dueSchedules(store.state,'2026-01-31').length,1);
  const r=await generateAndIssue(store,sc.id,{today:'2026-01-31'});
  assert.equal(r.issued,null,'jamais d’émission sans confirmation');assert.equal(r.draft.status,'brouillon');assert.equal(r.draft.proposeEmission,true);
  assert.deepEqual([r.draft.periodStart,r.draft.periodEnd],['2026-01-31','2026-02-27']);
  assert.equal(schedules(store.state)[0].nextDate,'2026-02-28');
  await assert.rejects(generateFromSchedule(store,sc.id,{today:'2026-02-01'}),/Aucune facture/);
  const r2=await generateAndIssue(store,sc.id,{today:'2026-02-28',confirmEmission:true});
  assert.equal(r2.issued.status,'emise');assert.equal(r2.issued.lines[0].itemId,item.id);
  await generateFromSchedule(store,sc.id,{today:'2026-03-31'});assert.equal(schedules(store.state)[0].active,false,'fin atteinte');
});

test('suivi : CA, balance âgée, délais, devis, relances, prévision, prix suggéré, oublis, doublons, risque',async()=>{
  const store=await makeStore({extra:{parcelles:[{id:'p1',nom:'Champ',surfaceHa:4,clientId:'c1'}],interventions:[{id:'w1',parcelId:'p1',type:'Semis',date:'2026-08-01',status:'Terminé',duration:3}]}});
  const a=await issued(store,{lines:[L('Pelle',10,65)],today:'2026-06-01'});
  await addPayment(store,a.id,{date:'2026-07-15',amount:780});
  const b=await issued(store,{lines:[L('Pelle',5,70)],today:'2026-07-01'});
  const c=await issued(store,{clientId:'c2',lines:[L('Haie',2,50)],today:'2026-09-25'});
  const q=await issued(store,{docType:'devis',lines:[L('Pelle',2,65)],today:'2026-09-25'});
  await recordReminder(store,b.id,{level:1,date:'2026-08-10',channel:'email',recipients:[{name:'GAEC du Bois',email:'gaec@exemple.fr'}]});
  const s=store.state,today='2026-10-10';
  const months=revenueByMonth(s,{from:'2026-01-01',to:today});
  assert.deepEqual(months.map(m=>[m.month,m.invoicedHt,m.collected]),[['2026-06',650,0],['2026-07',350,780],['2026-09',100,0]]);
  assert.equal(revenueByClient(s,{today})[0].name,'GAEC du Bois');
  const aged=agedBalance(s,today);assert.equal(aged.totals.j61_90,420);assert.equal(aged.totals.aEchoir,120);assert.equal(aged.total,540);
  assert.equal(paymentDelays(s).averageDays,44);assert.ok(dso(s,today)>0);
  assert.equal(quoteStats(s,{today}).byStatus.envoye,1);assert.equal(quotesToFollow(s,today).toFollow[0].quote.id,q.id);
  const due=remindersDue(s,today);assert.equal(due.length,1);assert.equal(due[0].level,3,'niveau 3 atteint (71 jours de retard)');
  assert.equal(doc(store,b.id).sentLog[0].purpose,'relance1');
  const fc=forecastByWeek(s,today);assert.equal(fc[0].late,420);assert.equal(fc.reduce((x,w)=>x+w.amount,0),540);
  assert.equal(suggestPrice(s,{clientId:'c1',label:'pelle'}).price,65,'dernier prix du client (devis compris)');assert.equal(suggestPrice(s,{clientId:'c2',label:'Pelle'}).source,'historique');
  assert.equal(unbilledAlerts(s,today,{days:30})[0].client.id,'c1');
  const twin=await createDraft(store,{clientId:'c2',lines:[L('Haie',2,50)],today:'2026-09-27'});
  assert.ok(probableDuplicates(store.state).some(d=>[d.a.id,d.b.id].includes(twin.id)&&[d.a.id,d.b.id].includes(c.id)));
  assert.equal(clientRisk(store.state,'c1',today).overdue,1);
  const dash=billingDashboard(store.state,{today});assert.equal(dash.aged.total,540);assert.ok(Array.isArray(dash.forecast));
});

test('saisie rapide en français : brouillon de lignes, jamais d’écriture',async()=>{
  const state=emptyState();state.clients=[{id:'c1',name:'Dupont TP'},{id:'c2',name:'Martin'}];
  const r=parseQuickEntry('devis Dupont 3 h de pelle à 65 € et 12 t de cailloux à 18 € HT',state);
  assert.equal(r.docType,'devis');assert.equal(r.client.id,'c1');assert.equal(r.draftOnly,true);
  assert.deepEqual(r.lines.map(l=>[l.label,l.quantity,l.unit,l.unitPrice]),[['Pelle',3,'h',65],['Cailloux',12,'t',18]]);
  const t=parseQuickEntry('facture Martin 2,5 ha de broyage à 48 € TTC tva 10 %',state);
  assert.equal(t.lines[0].quantity,2.5);assert.equal(t.lines[0].vatRate,10);assert.equal(t.lines[0].unitPrice,round(48/1.1*100)/100);
  assert.ok(parseQuickEntry('facture Inconnu 1 h de pelle',state).warnings.some(w=>/introuvable/.test(w)));
  // Unités m³ / m3 / m² (caractère non alphabétique) et désignation reprise du catalogue.
  state.integrationImports=[{id:'i1',farmKind:'billingItem',format:'Parcelles',code:'PAILL',label:'Paillage de copeaux',unit:'m³',unitPrice:32,vatRate:10}];
  for(const txt of ['facture Martin 2 m³ de paillage','facture Martin 2 m3 de paillage'])
    assert.deepEqual(parseQuickEntry(txt,state).lines.map(l=>[l.label,l.quantity,l.unit,l.unitPrice,l.vatRate]),[['Paillage de copeaux',2,'m³',32,10]]);
  assert.deepEqual(parseQuickEntry('devis Martin 40 m² de bâche à 2 €',state).lines.map(l=>[l.quantity,l.unit,l.unitPrice]),[[40,'m²',2]]);
  state.integrationImports=[];
  assert.equal(state.integrationImports.length,0);
});

test('Factur-X EN 16931 : facture remisée à TVA mixte, avoir positif en 381, contrôle de structure',async()=>{
  const store=await makeStore();
  const inv=await issued(store,{lines:[L('Pelle',3.5,65,20,{discountPct:10,description:'Pelle 8 t'}),L('Cailloux',12,18,10,{unit:'t'}),{kind:'section',label:'Divers'},L('Export',1,50,0,{vatExemption:'intracom'})],today:'2026-10-01',extra:{clientVat:'DE123456789',clientSiren:'732829320',discount:{type:'pct',value:5},shipping:{label:'Déplacement',amount:30,vatRate:20},deliveryDate:'2026-09-30',reference:'BC-17'}});
  const xml=facturXml(store.state,inv),v=validateFacturX(xml);assert.deepEqual(v.errors,[]);
  for(const t of ['<ram:TypeCode>380</ram:TypeCode>','urn:cen.eu:en16931:2017','<ram:CategoryCode>K</ram:CategoryCode>','VATEX-EU-IC','schemeID="0002">123456789<','schemeID="VA">FR12345678901<','<ram:IBANID>FR7630006000011234567890189</ram:IBANID>','<ram:PostcodeCode>01340</ram:PostcodeCode>','<ram:CityName>Montrevel</ram:CityName>','<ram:ID>S1</ram:ID>','<ram:SubjectCode>PMT</ram:SubjectCode>','<ram:BuyerReference>BC-17</ram:BuyerReference>','unitCode="TNE"'])assert.ok(xml.includes(t),t);
  assert.match(xml,new RegExp(`<ram:GrandTotalAmount>${inv.totals.ttc.toFixed(2)}</ram:GrandTotalAmount>`));
  // Altération : le contrôle la détecte.
  assert.ok(validateFacturX(xml.replace(/<ram:GrandTotalAmount>[^<]+/,'<ram:GrandTotalAmount>1.00')).errors.some(e=>/BR-CO-15/.test(e)));
  assert.ok(validateFacturX(xml.replace('<ram:PaymentReference>','<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode><ram:PaymentReference>')).errors.length);
  assert.throws(()=>parseXml('<a><b></a>'),/inattendue/);
  const cn=await createCreditNote(store,inv.id,{today:'2026-10-02'}),ce=await emitDocument(store,cn.id,{today:'2026-10-02'});
  const cx=facturXml(store.state,ce);assert.deepEqual(validateFacturX(cx).errors,[]);
  assert.match(cx,/<ram:TypeCode>381<\/ram:TypeCode>/);assert.match(cx,new RegExp(`<ram:GrandTotalAmount>${inv.totals.ttc.toFixed(2)}<`));assert.match(cx,/<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>F2026-0001</);
  const draft=await createDraft(store,{clientId:'c1',lines:[L('A',1,1)]});assert.throws(()=>facturXml(store.state,draft),/Émettez/);
  const quote=await issued(store,{docType:'devis',lines:[L('A',1,1)],today:'2026-10-03'});assert.throws(()=>facturXml(store.state,quote),/sans valeur comptable/);
  assert.deepEqual(splitAddress('Le Bois, 01000 Bourg-en-Bresse'),{lines:['Le Bois'],postcode:'01000',city:'Bourg-en-Bresse',country:'FR'});
});

test('journal façon FEC équilibré et lettré, CSV détaillé, QR de virement SEPA',async()=>{
  const store=await makeStore();
  const q=await issued(store,{docType:'devis',lines:[L('Terrassement',10,100)],today:'2026-10-01'});
  await acceptQuote(store,q.id,{signatory:'P. Martin',date:'2026-10-01',today:'2026-10-01'});
  const dep=await emitDocument(store,(await createDepositInvoice(store,q.id,{percent:50,today:'2026-10-02'})).id,{today:'2026-10-02'});
  await addPayment(store,dep.id,{date:'2026-10-05',amount:600,method:'virement'});
  const fin=await emitDocument(store,(await convertQuote(store,q.id,{today:'2026-10-20'})).id,{today:'2026-10-20'});
  assert.equal(fin.totals.ttc,600);
  const j=billingJournal(store.state);assert.deepEqual(j.warnings,[]);
  for(const e of j.entries){const d=e.rows.reduce((s,r)=>s+r.debit,0),c=e.rows.reduce((s,r)=>s+r.credit,0);assert.ok(Math.abs(d-c)<0.005,`${e.piece} équilibrée`);}
  const depEntry=j.entries.find(e=>e.piece===dep.number&&e.journal==='VT');assert.ok(depEntry.rows.some(r=>r.account==='4191'&&r.credit===500));
  const finEntry=j.entries.find(e=>e.piece===fin.number&&e.journal==='VT');assert.ok(finEntry.rows.some(r=>r.account==='4191'&&r.debit===500));assert.ok(finEntry.rows.some(r=>r.account==='7060'&&r.credit===1000));
  const letter=depEntry.rows.find(r=>r.account==='411').letter;assert.equal(letter,'AA');
  assert.equal(j.entries.find(e=>e.journal==='BQ').rows.find(r=>r.account==='411').letter,'AA');
  const fec=billingFecText(store.state);assert.ok(fec.startsWith('JournalCode|JournalLib|EcritureNum'));assert.match(fec,/\|20261002\|/);
  const csv=billingLinesCsv(store.state);assert.match(csv,/Acompte F2026-0001 du 02\/10\/2026 déduit;4191;1;forfait;-500/);assert.ok(csv.startsWith('﻿Date;Numéro'));
  const p=epcPayload(store.state,fin);assert.deepEqual(p.split('\n'),['BCD','002','1','SCT','AGRIFRPP','EARL du Sougey','FR7630006000011234567890189','EUR600.00','','','Facture F2026-0002']);
  assert.equal(epcPayload(store.state,doc(store,dep.id)),null,'acompte soldé : pas de QR');
  assert.match(epcQrSvg(store.state,fin),/^<svg/);
  await saveSettings(store,{...SETTINGS,template:{showQr:true}});
  assert.ok(invoiceHtmlWithQr(store.state,doc(store,fin.id)).includes('inv-qr'));
  assert.ok(!invoiceHtml(store.state,doc(store,fin.id)).includes('class="inv-qr"'));
});

test('documentMessage : envoi, relances, remerciement, devis, variables inconnues visibles',async()=>{
  const store=await makeStore();
  const inv=await issued(store,{lines:[L('Pelle',10,65)],today:'2026-10-01'});
  const m=documentMessage(store.state,inv,{purpose:'envoi'});
  assert.match(m.subject,/Facture F2026-0001 · EARL du Sougey/);assert.match(m.body,/Bonjour Paul,/);assert.match(m.body,/780,00 € TTC/);assert.match(m.body,/Échéance : 31\/10\/2026/);
  assert.deepEqual(m.recipients,[{id:'c1',kind:'client',name:'GAEC du Bois',phone:'06 12 34 56 78',email:'gaec@exemple.fr',role:'Client',contact:'Paul Martin'}]);
  assert.deepEqual(m.context,{entity:'integrationImports',id:inv.id,kind:INVOICE_KIND});
  const r3=documentMessage(store.state,inv,{purpose:'relance3',today:'2026-12-15'});assert.match(r3.body,/45 jours de retard/);assert.match(r3.body,/frais de relance : 40,00/);
  await saveSettings(store,{...SETTINGS,reminders:[{days:5,subject:'Petit rappel {numero} {inconnu}',body:'Reste {reste}'},{days:20},{days:45}]});
  const r1=documentMessage(store.state,inv,{purpose:'relance1'});assert.equal(r1.subject,'Petit rappel F2026-0001 {inconnu}');
  assert.match(documentMessage(store.state,inv,{purpose:'remerciement'}).subject,/Merci/);
  const q=await issued(store,{clientId:'c2',docType:'devis',lines:[L('Haie',1,50)],today:'2026-10-02'});
  const qm=documentMessage(store.state,q);assert.match(qm.body,/Bon pour accord/);assert.match(qm.body,/Bonjour Madame, Monsieur/);
  assert.throws(()=>documentMessage(store.state,q,{purpose:'relance1'}),/Seule une facture/);
  assert.equal(fillTemplate('{a} {b}',{a:1}),'1 {b}');
  await logSent(store,inv.id,{channel:'sms',recipients:[{name:'Paul',phone:'0612345678'}],purpose:'envoi',recordId:'msg1'});
  assert.deepEqual(doc(store,inv.id).sentLog.map(s=>[s.channel,s.purpose,s.recordId]),[['sms','envoi','msg1']]);
});

test('fichiers servis, chargement à la demande et règles Firestore alignées',()=>{
  const read=f=>fs.readFileSync(new URL(`./${f}`,import.meta.url),'utf8');
  for(const f of ['sw.js','runtime.js'])for(const m of ['billing.js','billing-insights.js','billing-export.js','billing-messages.js'])assert.ok(read(f).includes(`'./${m}'`),`${m} dans ${f}`);
  // invoices.js n’importe aucun module billing-* ; son noyau (invoices-core.js, chargé au démarrage) n’importe
  // que les modules de base, jamais le moteur complet.
  assert.ok(!/from '\.\/billing/.test(read('invoices.js')));
  assert.deepEqual([...read('invoices-core.js').matchAll(/from '\.\/([^']+)'/g)].map(m=>m[1]),['farm-memory.js','farm-records.js']);
  for(const f of ['sw.js','runtime.js'])assert.ok(read(f).includes("'./invoices-core.js'"),`invoices-core.js dans ${f}`);
  // Graphe des imports statiques du démarrage (app.js, runtime.js, config.js) : le moteur de facturation n’y est pas.
  const seen=new Set(),stack=['app.js','runtime.js','config.js'];
  while(stack.length){const f=stack.pop();if(seen.has(f))continue;seen.add(f);for(const m of read(f).matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[^'"();]*?\sfrom\s*)?['"]\.\/([^'"]+\.js)['"]/g))stack.push(m[1]);}
  assert.ok(seen.has('invoices-core.js'));
  for(const f of seen)assert.ok(f==='invoices-core.js'||!/^(invoices|billing)/.test(f),`${f} importé au démarrage`);
  for(const f of ['app.js','home-story.js','treasury.js','accounting-export.js'])assert.ok(!/from '\.\/billing/.test(read(f)),f);
  const rules=read('firestore.rules');for(const k of ['invoice','quote','billingItem','billingSchedule'])assert.ok(rules.includes(`'${k}'`),k);
  assert.equal(invoices(emptyState()).length,0);
});

// ---------- Correctif : constats de relecture du moteur de facturation ----------
async function acceptedQuote(store,lines,{today='2026-10-01',extra={}}={}){
  const q=await issued(store,{docType:'devis',lines,today,extra});await acceptQuote(store,q.id,{signatory:'Paul Martin',date:today,today});return doc(store,q.id);
}
test('correctif : acompte déduit non annulable par avoir, une seule facture de solde, cadre B4/S4/M4',async()=>{
  const store=await makeStore();
  const q=await acceptedQuote(store,[L('Terrassement',10,100)]);
  const dep=await emitDocument(store,(await createDepositInvoice(store,q.id,{percent:30,today:'2026-10-02'})).id,{today:'2026-10-02'});
  assert.equal(dep.totals.ttc,360);
  // Avoir préparé avant la facture de solde, émis après : refusé à l’émission.
  const early=await createCreditNote(store,dep.id,{today:'2026-10-05'});
  // Deux conversions simultanées : deux brouillons au plus, une seule facture de solde émise.
  const conv=await Promise.allSettled([convertQuote(store,q.id,{today:'2026-10-04'}),convertQuote(store,q.id,{today:'2026-10-04'})]);
  const drafts=conv.filter(r=>r.status==='fulfilled').map(r=>r.value);assert.ok(drafts.length>=1);
  assert.equal(doc(store,q.id).conversions.filter(c=>c.type==='facture').length,drafts.length,'aucune conversion écrasée');
  // Deux brouillons qui déduisent le même acompte se bloquent l’un l’autre : on supprime le second.
  for(const d of drafts.slice(1)){await assert.rejects(emitDocument(store,d.id,{today:'2026-10-04'}),/éjà facturé/);await deleteDraft(store,d.id);}
  const fin=await emitDocument(store,drafts[0].id,{today:'2026-10-04'});assert.equal(fin.totals.ttc,840);
  await assert.rejects(emitDocument(store,early.id,{today:'2026-10-05'}),/déjà déduit sur la facture F2026-0002/);
  await deleteDraft(store,early.id);
  await assert.rejects(createCreditNote(store,dep.id,{today:'2026-10-05'}),/établissez l’avoir sur cette facture/);
  assert.equal(invoiceStatus(doc(store,dep.id),store.state),'emise');
  // BT-23 : facture définitive après acompte.
  const xml=facturXml(store.state,fin);assert.ok(xml.includes('<ram:ID>S4</ram:ID>'));assert.deepEqual(validateFacturX(xml).errors,[]);
  assert.ok(facturXml(store.state,dep).includes('<ram:ID>S1</ram:ID>'));
  // La facture de solde annulée par avoir, l’acompte redevient annulable.
  await emitDocument(store,(await createCreditNote(store,fin.id,{today:'2026-10-06'})).id,{today:'2026-10-06'});
  const ok=await createCreditNote(store,dep.id,{today:'2026-10-07'});await emitDocument(store,ok.id,{today:'2026-10-07'});
  assert.equal(invoiceStatus(doc(store,dep.id),store.state),'annulee');
  // Devis sans acompte : deux conversions simultanées, la seconde facture est refusée à l’émission.
  const q2=await acceptedQuote(store,[L('Fauche',2,80)],{today:'2026-10-07'});
  const two=(await Promise.allSettled([convertQuote(store,q2.id,{today:'2026-10-08'}),convertQuote(store,q2.id,{today:'2026-10-08'})])).filter(r=>r.status==='fulfilled').map(r=>r.value);
  assert.ok(two.length>=1);const first=await emitDocument(store,two[0].id,{today:'2026-10-08'});
  for(const d of two.slice(1))await assert.rejects(emitDocument(store,d.id,{today:'2026-10-08'}),new RegExp(`Ce devis est déjà facturé \\(${first.number}\\)`));
});
test('correctif : acomptes + solde = TTC du devis au centime près (remises, frais, trois taux)',async()=>{
  const variants=[
    {lines:[L('A',3,123.37),L('B',7,41.13,10,{unit:'t'}),L('C',2,77.77,5.5)],extra:{discount:{type:'pct',value:7},shipping:{label:'Port',amount:33.33,vatRate:20}},deps:[{amount:500}]},
    {lines:[L('A',4,111.11,20,{discountPct:7}),L('B',9,37.37,10,{unit:'t'}),L('C',3,58.58,5.5)],extra:{discount:{type:'pct',value:5},shipping:{label:'Port',amount:45,vatRate:20}},deps:[{percent:30},{amount:123.45}]}
  ];
  for(let k=0;k<12;k+=1)variants.push({lines:[L('A',1+k%3,99.99+k*13.07),L('B',2,17.31+k,10,{unit:'t'}),L('C',1,9.99+k*3.3,5.5)],extra:{discount:{type:k%2?'pct':'amount',value:k%2?3+k:11.11},shipping:{label:'Port',amount:12.34+k,vatRate:20}},deps:[{percent:17+k},{amount:50+k*0.37}]});
  for(const [i,v] of variants.entries()){
    const store=await makeStore(),q=await acceptedQuote(store,v.lines,{extra:v.extra});let sum=0;
    for(const d of v.deps){const e=await emitDocument(store,(await createDepositInvoice(store,q.id,{...d,today:'2026-10-02'})).id,{today:'2026-10-02'});sum+=e.totals.ttc;}
    const fin=await convertQuote(store,q.id,{today:'2026-10-03'}),e=await emitDocument(store,fin.id,{today:'2026-10-03'});
    assert.equal(round(sum+e.totals.ttc),q.totals.ttc,`variante ${i}`);
    assert.deepEqual(validateFacturX(facturXml(store.state,e)).errors,[],`variante ${i}`);
  }
});
test('correctif : avoir partiel d’une facture remisée (remise en % ou en montant)',async()=>{
  const store=await makeStore();
  const pct=await issued(store,{lines:[L('A',1,100),L('B',1,100)],extra:{discount:{type:'pct',value:50}}});assert.equal(pct.totals.ttc,120);
  const cn=await createCreditNote(store,pct.id,{lines:[pct.lines[0]],today:'2026-10-02'});assert.equal(cn.totals.ttc,-60);
  await emitDocument(store,cn.id,{today:'2026-10-02'});
  assert.notEqual(invoiceStatus(doc(store,pct.id),store.state,'2026-10-02'),'annulee');assert.equal(invoiceBalance(store.state,doc(store,pct.id)).due,60);
  const amount=await issued(store,{lines:[L('A',1,100),L('B',1,100)],today:'2026-10-03',extra:{discount:{type:'amount',value:50}}});assert.equal(amount.totals.ttc,180);
  const cn2=await createCreditNote(store,amount.id,{lines:[amount.lines[0]],today:'2026-10-03'});assert.equal(cn2.totals.ttc,-90,'remise au prorata des lignes reprises');
  const all=await createCreditNote(store,(await issued(store,{lines:[L('A',1,100)],today:'2026-10-04',extra:{discount:{type:'amount',value:50}}})).id,{today:'2026-10-04'});assert.equal(all.totals.ttc,-60);
});
test('correctif : Factur-X intracommunautaire, franchise en base et remboursement forfaitaire',async()=>{
  const store=await makeStore();
  const draft=await createDraft(store,{clientId:'c1',lines:[L('Céréales',1,1000,0,{vatExemption:'intracom',unit:'t'})],today:'2026-10-01',extra:{clientVat:'DE123456789'}});
  assert.ok(emissionProblems(store.state,draft,'facture',{today:'2026-10-01'}).some(p=>/date de livraison/.test(p)),'BR-IC-11 bloquant avant émission');
  await saveDraft(store,draft.id,{...draft,deliveryDate:'2026-09-30'});
  const k=await emitDocument(store,draft.id,{today:'2026-10-01'}),xml=facturXml(store.state,k);
  assert.match(xml,/<ram:ShipToTradeParty>.*<ram:CountryID>FR<\/ram:CountryID><\/ram:PostalTradeAddress><\/ram:ShipToTradeParty>/);assert.deepEqual(validateFacturX(xml).errors,[]);
  assert.ok(validateFacturX(xml.replace(/<ram:ShipToTradeParty>.*?<\/ram:ShipToTradeParty>/,'')).errors.some(e=>/BR-IC-12/.test(e)));
  assert.ok(validateFacturX(xml.replace(/<ram:ActualDeliverySupplyChainEvent>.*?<\/ram:ActualDeliverySupplyChainEvent>/,'')).errors.some(e=>/BR-IC-11/.test(e)));
  // Franchise en base sans n° de TVA : le SIRET sert d’identifiant fiscal (BR-E-02).
  const fr=await makeStore({settings:false});await saveSettings(fr,{...SETTINGS,vatNumber:'',vatRegime:'franchise'});
  const e=await issued(fr,{lines:[L('Fauche',2,50,0)]}),ex=facturXml(fr.state,e);
  assert.match(ex,/<ram:CategoryCode>E<\/ram:CategoryCode>/);assert.ok(ex.includes('<ram:ID schemeID="FC">12345678900012</ram:ID>'));assert.ok(!ex.includes('schemeID="VA"'));assert.deepEqual(validateFacturX(ex).errors,[]);
  assert.ok(validateFacturX(ex.replace(/<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">[^<]+<\/ram:ID><\/ram:SpecifiedTaxRegistration>/,'')).errors.some(x=>/BR-E-02/.test(x)));
  // Remboursement forfaitaire (catégorie O) : ni n° de TVA du vendeur, ni celui de l’acheteur (BR-O-02).
  const rf=await makeStore({settings:false});await saveSettings(rf,{...SETTINGS,vatRegime:'remboursement-forfaitaire'});
  const o=await issued(rf,{lines:[L('Grain',1,300,0,{unit:'t'})],extra:{clientVat:'FR40732829320'}}),ox=facturXml(rf.state,o);
  assert.match(ox,/<ram:CategoryCode>O<\/ram:CategoryCode>/);assert.ok(!ox.includes('schemeID="VA"'));assert.deepEqual(validateFacturX(ox).errors,[]);
  assert.ok(validateFacturX(ox.replace('</ram:BuyerTradeParty>','<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">FR40732829320</ram:ID></ram:SpecifiedTaxRegistration></ram:BuyerTradeParty>')).errors.some(x=>/BR-O-02/.test(x)));
});
test('correctif : empreinte étendue (version 2) signalée avant export ; anciennes empreintes valides',async()=>{
  const store=await makeStore();
  const inv=await issued(store,{lines:[L('A',1,100,0,{vatExemption:'export'})],extra:{clientVat:'CH123'}});
  assert.equal(inv.fingerprintVersion,2);assert.equal(fingerprintOk(inv),true);assert.deepEqual(facturXProblems(store.state,inv),[]);
  for(const patch of [{vatExemption:'intracom'},{legalMentions:[]},{periodEnd:'2026-12-31'},{quoteNumber:'D2026-0009'}]){
    const altered={...inv,...patch};assert.equal(fingerprintOk(altered),false,Object.keys(patch)[0]);
    assert.match(facturXProblems(store.state,altered).join(' '),/modifié depuis son émission/);assert.throws(()=>facturXml(store.state,altered),/empreinte/);
  }
  // Document émis avant la version 2 : son empreinte (champs de la version 1) reste valide.
  const {fingerprintVersion:_v,...old}=inv;const v1={...old,fingerprint:fingerprint(old)};
  assert.equal(fingerprintOk({...v1,vatExemption:'intracom'}),true,'version 1 : champs d’origine seulement');
  assert.equal(fingerprintOk({...v1,totals:{...v1.totals,ttc:1}}),false);
});
test('correctif : duplicata d’une facture émise par l’ancien code inchangé par les paramètres actuels',async()=>{
  const store=await makeStore(),inv=await issued(store,{lines:[L('A',1,100)]});
  const {legalMentions:_m,seller,fingerprint:_f,fingerprintVersion:_v,...rest}=inv;
  const oldSeller=Object.fromEntries(['legalName','legalForm','address','siret','vatNumber','iban','bic','paymentDays','vatRate','prefix','penalty','mention','vatOnDebits','email','phone','accent'].map(k=>[k,seller[k]]));
  const legacy={...rest,seller:{...oldSeller,vatOnDebits:true,mention:'Membre d’un centre de gestion agréé.'}},before=invoiceView(store.state,legacy);
  assert.deepEqual(before.legal,[seller.penalty,'Opération : prestations de services. Option pour le paiement de la taxe d’après les débits.','Membre d’un centre de gestion agréé.']);
  await saveSettings(store,{...SETTINGS,escompte:'2 % sous 8 jours',operationNature:'biens',capital:'9 000 €',rcs:'Bourg',template:{freeMentions:'Mention libre',terms:'CGV v2',footer:'Pied nouveau'}});
  const after=invoiceView(store.state,legacy);
  for(const k of ['legal','conditions','footer','sellerLines'])assert.deepEqual(after[k],before[k],k);
  assert.equal(after.conditions,'');assert.ok(!after.footer.includes('Pied nouveau'));
  // Un document émis par le nouveau code garde ses propres mentions figées.
  const fresh=await issued(store,{lines:[L('B',1,10)],today:'2026-10-02'});assert.ok(invoiceView(store.state,fresh).legal.includes('Escompte : 2 % sous 8 jours'));
});
test('correctif : accueil sur le reste dû, récurrence sans double émission, jour d’ancrage conservé',async()=>{
  const store=await makeStore();
  const inv=await issued(store,{lines:[L('A',10,100)],today:'2026-10-01'});assert.equal(inv.totals.ttc,1200);
  await addPayment(store,inv.id,{date:'2026-10-05',amount:500});
  const brief=composeMorningBrief(store.state,null,{now:new Date('2026-12-15T08:00:00').getTime(),location:false});
  const s=brief.sentences.find(x=>x.key==='invoice');assert.ok(s);assert.match(s.text,/700[\s  ]€/);assert.ok(!/1[\s  ]?200/.test(s.text));
  const sc=await saveSchedule(store,{clientId:'c1',frequency:'mensuel',nextDate:'2026-10-31',mode:'brouillon',lines:[L('Entretien',1,50)]});
  const both=await Promise.allSettled([generateFromSchedule(store,sc.id,{today:'2026-10-31'}),generateFromSchedule(store,sc.id,{today:'2026-10-31'})]);
  const made=both.filter(r=>r.status==='fulfilled').map(r=>r.value);assert.ok(made.length>=1);
  await emitDocument(store,made[0].id,{today:'2026-10-31'});
  for(const d of made.slice(1))await assert.rejects(emitDocument(store,d.id,{today:'2026-10-31'}),/période est déjà émise/);
  const now=schedules(store.state).find(x=>x.id===sc.id);assert.equal(now.nextDate,'2026-11-30');assert.equal(now.anchorDay,31);
  await saveSchedule(store,{...now,note:'Changement de note'},sc.id);
  const kept=schedules(store.state).find(x=>x.id===sc.id);assert.equal(kept.anchorDay,31,'ancrage conservé');
  assert.equal(addMonths(kept.nextDate,1,kept.anchorDay),'2026-12-31');
  await saveSchedule(store,{...kept,nextDate:'2026-12-15'},sc.id);assert.equal(schedules(store.state).find(x=>x.id===sc.id).anchorDay,15,'nouvelle date : nouvel ancrage');
});

test('acompte de 30 % sur un devis remisé à deux taux : solde = TTC du devis, compte 4191 soldé au centime',async()=>{
  const store=await makeStore(),T='2026-05-12';
  const q=await createDraft(store,{clientId:'c1',docType:'devis',today:T,lines:[L('Pelle',8,70,20),L('Plants',100,3.5,10,{unit:'u'})],extra:{discount:{type:'pct',value:5}}});
  await emitDocument(store,q.id,{today:T});await acceptQuote(store,q.id,{date:T,signatory:'J',today:T});
  const dep=await createDepositInvoice(store,q.id,{percent:30,today:T});await emitDocument(store,dep.id,{today:T});
  const sol=await convertQuote(store,q.id,{today:T});await emitDocument(store,sol.id,{today:T});
  const [qd,dd,sd]=[q.id,dep.id,sol.id].map(id=>doc(store,id));
  assert.equal(round(dd.totals.ttc+sd.totals.ttc),qd.totals.ttc);
  const j=billingJournal(store.state,{}),bal={};
  for(const e of j.entries)for(const r of e.rows)bal[r.account]=round((bal[r.account]||0)+r.credit-r.debit);
  assert.deepEqual(j.warnings,[]);
  assert.equal(bal['4191'],0);
  assert.equal(round(bal['7060']+(bal['709']||0)),round(dd.totals.ht+sd.totals.ht));
});
