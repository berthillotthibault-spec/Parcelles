// Solde de TVA (vat-balance.js) et réponse « TVA à reverser » de l'assistant de facturation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {documentTotals} from './invoices.js';
import {vatBalance,collectedVat,purchaseVatAmount,supplierInvoices,purchasesVat,defaultVatBasis} from './vat-balance.js';
import {answerBillingQuestion} from './billing-assistant.js';

const TODAY='2026-11-12';
const line=(label,quantity,unit,unitPrice,vatRate=20)=>({label,quantity,unit,unitPrice,vatRate});
function inv(id,{issueDate,lines,payments=[],docType='facture',status='emise',paidAt=''}){
  const d={id,farmKind:'invoice',docType,status,clientId:'c1',clientName:'GAEC du Bois',number:`F-${id}`,issueDate,dueDate:issueDate,lines,payments,...(paidAt?{paidAt}:{})};
  d.totals=documentTotals(d);return d;
}
function base({invoicing={},extra={}}={}){
  const s=emptyState();
  s.exploitation={...(s.exploitation||{}),nom:'EARL Démo',invoicing:{vatRate:20,prefix:'F',...invoicing}};
  s.clients=[{id:'c1',name:'GAEC du Bois'}];
  s.integrationImports=[
    // 1000 HT + 200 TVA, émise en octobre, payée 600 en novembre.
    inv('a',{issueDate:'2026-10-05',lines:[line('Labour',10,'ha',100)],payments:[{id:'p1',date:'2026-11-03',amount:600,method:'virement'}]}),
    // 500 HT + 100 TVA, émise en novembre, non payée.
    inv('b',{issueDate:'2026-11-02',lines:[line('Semis',5,'ha',100)]})
  ];
  s.stockItems=[{id:'s1',name:'Ammonitrate',unit:'t',quantity:0},{id:'s2',name:'Semences blé',unit:'kg',quantity:0}];
  s.stockMovements=[];s.documents=[];s.maintenanceRecords=[];
  Object.assign(s,extra);
  return s;
}
const purchase={kind:'facture',numero:'FA-77',date:'2026-11-04',totalHT:1000,totalTTC:1200,tva:[{taux:20,base:1000,montant:200}],supplier:'Coop Ouest'};

test('montant de TVA d’une facture lue : somme par taux, sinon TTC − HT, sinon inconnu',()=>{
  assert.equal(purchaseVatAmount(purchase),200);
  assert.equal(purchaseVatAmount({totalHT:100,totalTTC:110,tva:[]}),10);
  assert.equal(purchaseVatAmount({totalHT:100,totalTTC:null,tva:[]}),null);
  assert.equal(purchaseVatAmount({tva:[{taux:5.5,montant:5.5},{taux:20,montant:null}]}),5.5);
  assert.equal(purchaseVatAmount(null),null);
});

test('base par défaut : prestations → encaissements, biens ou option → débits, mixte → indéterminée',()=>{
  assert.equal(defaultVatBasis({}),'encaissements');
  assert.equal(defaultVatBasis({vatOnDebits:true}),'debits');
  assert.equal(defaultVatBasis({operationNature:'biens'}),'debits');
  assert.equal(defaultVatBasis({operationNature:'mixte'}),null);
});

test('TVA collectée : débits du mois et part de TVA des encaissements',()=>{
  const c=collectedVat(base(),{from:'2026-11-01',to:'2026-11-30'});
  assert.equal(c.debits,100);
  assert.equal(c.cash,100); // 600 × 200/1200
  assert.deepEqual(c.byRate,[{rate:20,tax:100}]);
});

test('sans achat avec TVA connue : solde = collectée, achats chiffrés listés à part',()=>{
  const s=base({extra:{stockMovements:[{id:'m1',stockItemId:'s1',type:'Entrée',quantity:2,unitPrice:400,date:'2026-11-06'}]}});
  const v=vatBalance(s,{from:'2026-11-01',to:'2026-11-30'});
  assert.equal(v.basis,'encaissements');assert.equal(v.deductible,0);assert.equal(v.balance,100);
  assert.equal(v.unknown.length,1);assert.equal(v.unknownAmount,800);assert.match(v.unknown[0].label,/Ammonitrate/);
});

test('facture d’achat lue conservée sur l’entrée de stock : TVA déduite une seule fois, entrées liées non listées',()=>{
  const s=base({extra:{
    stockMovements:[
      {id:'m1',stockItemId:'s1',type:'Entrée',quantity:2,unitPrice:400,date:'2026-11-06',purchaseKey:'achat1',invoiceRef:'FA-77',purchaseVat:purchase},
      {id:'m2',stockItemId:'s2',type:'Entrée',quantity:100,unitPrice:2,date:'2026-11-06',purchaseKey:'achat1',invoiceRef:'FA-77'}],
    documents:[{id:'d1',category:'Facture',documentDate:'2026-11-06',purchaseKey:'achat1',supplier:'Coop Ouest',docExtract:{kind:'facture',numero:'FA-77',date:'2026-11-04',totalHT:1000,totalTTC:1200,tva:[{taux:20,base:1000,montant:200}]}}]}});
  assert.equal(supplierInvoices(s).length,1);
  const v=vatBalance(s,{from:'2026-11-01',to:'2026-11-30'});
  assert.equal(v.deductible,200);assert.equal(v.unknown.length,0);
  assert.equal(v.balance,-100);assert.equal(v.credit,100);assert.equal(v.toPay,0);
});

test('document rangé seul (facture lue sans entrée liée) : compté à la date de la facture',()=>{
  const s=base({extra:{documents:[{id:'d1',documentDate:'2026-12-01',supplier:'Coop',docExtract:{kind:'facture',numero:'X1',date:'2026-11-20',totalHT:50,totalTTC:60,tva:[{taux:20,base:50,montant:10}]}},
    {id:'d2',documentDate:'2026-11-20',docExtract:{kind:'bl',numero:'B1',date:'2026-11-20',totalHT:50,totalTTC:60,tva:[{taux:20,montant:10}]}}]}});
  const v=vatBalance(s,{from:'2026-11-01',to:'2026-11-30'});
  assert.equal(v.deductible,10);assert.equal(v.known.length,1);
  assert.equal(vatBalance(s,{from:'2026-12-01',to:'2026-12-31'}).deductible,0);
});

test('TVA saisie sur un achat (vatAmount optionnel) : déduite ; carburant, entretien et animaux sans TVA listés',()=>{
  const s=base({extra:{
    stockMovements:[{id:'m1',stockItemId:'s1',type:'Entrée',quantity:1,unitPrice:500,date:'2026-11-07',vatAmount:100}],
    maintenanceRecords:[{id:'e1',type:'Vidange',date:'2026-11-08',cost:300}],
  }});
  s.integrationImports.push({id:'g1',farmKind:'fuel',entry:'tank',date:'2026-11-09',litres:1000,amount:1100,supplier:'Pétrole SA'},{id:'g2',farmKind:'fuel',entry:'machine',fromTank:true,date:'2026-11-09',litres:50},{id:'an1',farmKind:'animalPurchase',date:'2026-11-10',amount:2000,party:'Négoce'});
  const v=purchasesVat(s,{from:'2026-11-01',to:'2026-11-30'});
  assert.deepEqual(v.known.map(k=>k.vat),[100]);
  assert.deepEqual(v.unknown.map(u=>u.source).sort(),['animaux','carburant','entretien']);
});

test('débits forcés : solde sur les factures émises',()=>{
  const v=vatBalance(base(),{from:'2026-10-01',to:'2026-10-31',basis:'debits'});
  assert.equal(v.collected.main,200);assert.equal(v.balance,200);assert.equal(v.toPay,200);
});

test('activité mixte : solde indéterminé mais les deux repères sont donnés',()=>{
  const v=vatBalance(base({invoicing:{operationNature:'mixte'}}),{from:'2026-11-01',to:'2026-11-30'});
  assert.equal(v.balance,null);assert.equal(v.balances.debits,100);assert.equal(v.balances.encaissements,100);
});

test('assistant : TVA à reverser ce trimestre avec TVA déductible connue',()=>{
  const s=base({extra:{stockMovements:[{id:'m1',stockItemId:'s1',type:'Entrée',quantity:2,unitPrice:400,date:'2026-11-06',purchaseKey:'k',purchaseVat:{...purchase,tva:[{taux:20,base:250,montant:50}]}}]}});
  const r=answerBillingQuestion('combien de TVA à reverser ce trimestre ?',s,{today:TODAY});
  assert.equal(r.intent,'billing_vat');
  assert.equal(r.metrics.deductible,50);assert.equal(r.metrics.balance,r.metrics.main-50);
  assert.match(r.answer,/TVA déductible connue/);assert.doesNotMatch(r.answer,/n’est pas connue de l’appli/);
  assert.match(r.answer,/simplifié agricole/);assert.match(r.answer,/comptable/);
});

test('assistant : sans achat chiffré en TVA, la phrase prudente d’origine est gardée',()=>{
  const r=answerBillingQuestion('TVA à payer ce mois',base(),{today:TODAY});
  assert.match(r.answer,/n’est pas connue de l’appli/);assert.equal(r.metrics.balance,null);
});

test('assistant : crédit de TVA annoncé comme tel et achats sans TVA signalés',()=>{
  const s=base({extra:{stockMovements:[
    {id:'m1',stockItemId:'s1',type:'Entrée',quantity:1,unitPrice:1000,date:'2026-11-06',purchaseKey:'k',purchaseVat:purchase},
    {id:'m2',stockItemId:'s2',type:'Entrée',quantity:10,unitPrice:3,date:'2026-11-06'}]}});
  const r=answerBillingQuestion('quel solde de TVA ce mois ?',s,{today:TODAY});
  assert.match(r.answer,/en crédit/);assert.match(r.answer,/sans TVA connue/);
});

test('même facture lue deux fois (deux purchaseKey) : TVA déduite une seule fois, entrées des deux lectures couvertes',()=>{
  const s=base({extra:{stockMovements:[
    {id:'m1',stockItemId:'s1',type:'Entrée',quantity:2,unitPrice:400,date:'2026-11-06',purchaseKey:'achat1',purchaseVat:purchase},
    {id:'m2',stockItemId:'s1',type:'Entrée',quantity:2,unitPrice:400,date:'2026-11-07',purchaseKey:'achat2',purchaseVat:purchase},
    {id:'m3',stockItemId:'s2',type:'Entrée',quantity:100,unitPrice:2,date:'2026-11-07',purchaseKey:'achat2'}]}});
  assert.equal(supplierInvoices(s).length,1);assert.deepEqual(supplierInvoices(s)[0].keys,['achat1','achat2']);
  const v=vatBalance(s,{from:'2026-11-01',to:'2026-11-30'});
  assert.equal(v.deductible,200);assert.equal(v.unknown.length,0);
});

test('franchise ou remboursement forfaitaire : aucune TVA déductible, solde non applicable',()=>{
  for(const vatRegime of ['franchise','remboursement-forfaitaire']){
    const s=base({invoicing:{vatRegime},extra:{stockMovements:[{id:'m1',stockItemId:'s1',type:'Entrée',quantity:1,unitPrice:500,date:'2026-11-07',vatAmount:100}]}});
    const v=vatBalance(s,{from:'2026-11-01',to:'2026-11-30'});
    assert.equal(v.applicable,false);assert.equal(v.deductible,0);assert.equal(v.balance,null);assert.equal(v.credit,0);
  }
});
