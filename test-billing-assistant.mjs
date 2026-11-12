// Assistant local de facturation : questions en français sur un état de démonstration construit ici.
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {documentTotals} from './invoices.js';
import {answerBillingQuestion,periodFromQuestion} from './billing-assistant.js';
import {answerLocalIntelligence,intelligenceCapabilities} from './intelligence.js';

const TODAY='2026-11-12';
const line=(label,quantity,unit,unitPrice,vatRate=20)=>({label,quantity,unit,unitPrice,vatRate});
function doc(id,{docType='facture',farmKind='invoice',status='emise',clientId,clientName,number,issueDate,dueDate='',lines,payments=[],paidAt='',validUntil='',extra={}}){
  const d={id,farmKind,format:'Parcelles',docType,status,clientId,clientName,number,issueDate,dueDate,lines,payments,...(paidAt?{paidAt}:{}),...(validUntil?{validUntil}:{}),...extra};
  d.totals=documentTotals(d);return d;
}
function demoState({invoicing={}}={}){
  const s=emptyState();
  s.exploitation={...(s.exploitation||{}),nom:'EARL Démo',invoicing:{vatRate:20,prefix:'F',...invoicing}};
  s.clients=[{id:'c1',name:'GAEC du Bois'},{id:'c2',name:'Jean Dupont'},{id:'c3',name:'SCEA Martin'}];
  s.parcelles=[{id:'p1',nom:'Champ du Bois',surfaceHa:5,clientId:'c3'}];
  s.interventions=[{id:'w1',parcelId:'p1',type:'Moisson',date:'2026-09-01',status:'Terminé',surfaceWorked:5}];
  s.integrationImports=[
    // GAEC du Bois : une facture en retard (échéance 01/10), une payée.
    doc('f1',{clientId:'c1',clientName:'GAEC du Bois',number:'F2026-0001',issueDate:'2026-09-01',dueDate:'2026-10-01',lines:[line('Labour',10,'ha',95)]}),
    doc('f2',{clientId:'c1',clientName:'GAEC du Bois',number:'F2026-0002',issueDate:'2026-11-03',dueDate:'2026-12-03',lines:[line('Labour',4,'ha',100),line('Paille',10,'t',80,10)],payments:[{id:'pa1',date:'2026-11-05',amount:200,method:'virement'}]}),
    // Jean Dupont : payée en novembre.
    doc('f3',{clientId:'c2',clientName:'Jean Dupont',number:'F2026-0003',issueDate:'2026-11-02',dueDate:'2026-12-02',lines:[line('Broyage',3,'h',65)],payments:[{id:'pa2',date:'2026-11-10',amount:234,method:'chèque'}]}),
    // Brouillon : jamais compté.
    doc('f4',{status:'brouillon',clientId:'c2',clientName:'Jean Dupont',issueDate:'2026-11-11',lines:[line('Labour',1,'ha',500)]}),
    // Devis envoyé il y a 20 jours, devis accepté.
    doc('q1',{docType:'devis',farmKind:'quote',status:'envoye',clientId:'c3',clientName:'SCEA Martin',number:'D2026-0001',issueDate:'2026-10-23',validUntil:'2026-11-15',lines:[line('Labour',20,'ha',90)]}),
    doc('q2',{docType:'devis',farmKind:'quote',status:'accepte',clientId:'c2',clientName:'Jean Dupont',number:'D2026-0002',issueDate:'2026-10-01',lines:[line('Semis',5,'ha',60)]})
  ];
  return s;
}
const ask=(q,s=demoState())=>answerBillingQuestion(q,s,{today:TODAY});

test('hors facturation : aucune réponse',()=>{
  assert.equal(ask('quelles parcelles sont en blé ?'),null);
  assert.equal(ask('quel temps demain'),null);
  assert.equal(answerBillingQuestion('',demoState()),null);
});

test('combien me doit un client',()=>{
  const r=ask('Combien me doit le GAEC du Bois ?');
  assert.equal(r.recognized,true);assert.equal(r.intent,'billing_client_balance');assert.equal(r.answer,r.text);
  // f1 : 1 140 € TTC en retard ; f2 : 400 + 800 HT -> 480 + 880 = 1 360 TTC, 200 payés -> 1 160 restant.
  assert.equal(r.metrics.due,2300);assert.equal(r.metrics.late,1140);
  assert.match(r.answer,/en retard depuis le 01\/10\/2026/);
  assert.match(ask('Jean Dupont me doit combien ?').answer,/ne vous doit rien/);
});

test('qui me doit de l’argent / impayés',()=>{
  for(const q of ['Qui me doit de l’argent ?','factures impayées','quels clients sont en retard de paiement']){
    const r=ask(q);assert.equal(r.intent,'billing_receivables',q);assert.equal(r.metrics.total,2300,q);assert.equal(r.metrics.late,1140,q);
  }
  assert.match(ask('impayés').answer,/GAEC du Bois/);
});

test('chiffre d’affaires du mois, de l’année, de la campagne',()=>{
  const m=ask('chiffre d’affaires du mois');assert.equal(m.intent,'billing_revenue');
  assert.equal(m.metrics.ht,1395);assert.equal(m.metrics.collected,434);assert.match(m.answer,/novembre 2026/);
  const y=ask('CA de l’année');assert.equal(y.metrics.ht,2345);
  const c=ask('combien j’ai facturé sur la campagne');assert.equal(c.metrics.from,'2026-08-01');assert.equal(c.metrics.ht,2345);
  const o=ask('chiffre d’affaires en octobre');assert.equal(o.metrics.ht,0);assert.match(o.answer,/Aucune facture/);
});

test('travaux non facturés',()=>{
  const r=ask('quels travaux ne sont pas facturés ?');
  assert.equal(r.intent,'billing_unbilled');assert.equal(r.metrics.count,1);assert.match(r.answer,/SCEA Martin/);assert.match(r.answer,/plus de 30 jours/);
});

test('devis en attente et à relancer',()=>{
  const r=ask('devis en attente ?');
  assert.equal(r.intent,'billing_quotes');assert.equal(r.metrics.open,1);assert.equal(r.metrics.toFollow,1);
  assert.match(r.answer,/SCEA Martin.*20 j/);assert.match(r.answer,/expire bientôt/);
  assert.equal(ask('quels devis relancer').intent,'billing_quotes');
});

test('dernière facture d’un client et dernière facture tout court',()=>{
  const r=ask('dernière facture de Dupont');assert.equal(r.intent,'billing_last_invoice');assert.match(r.answer,/F2026-0003.*payée/);
  const all=ask('ma dernière facture');assert.match(all.answer,/F2026-0002/);assert.match(all.answer,/partiellement payée/);
});

test('prix pratiqué pour une prestation',()=>{
  const r=ask('quel prix je pratique pour le labour ?');
  assert.equal(r.intent,'billing_price');assert.match(r.answer,/95,00\s€ HT \/ha en médiane sur 3 lignes/);assert.match(r.answer,/de 90,00\s€ à 100,00\s€/);
  assert.match(ask('quel tarif pour le broyage').answer,/65,00\s€ HT \/h/);
  assert.match(ask('quel prix pour le déneigement').answer,/aucun prix pratiqué/);
  assert.match(ask('quel prix je pratique pour le labour chez GAEC du Bois').answer,/avec GAEC du Bois/);
});

test('TVA à reverser : encaissements par défaut, débits si option',()=>{
  const r=ask('TVA à reverser ce mois');
  assert.equal(r.intent,'billing_vat');
  // Factures de novembre : f2 (80 + 80) + f3 (39) = 199 ; encaissements : 200 × 160/1360 + 234 × 39/234.
  assert.equal(r.metrics.debits,199);assert.equal(r.metrics.cash,Math.round((200*160/1360+39)*100)/100);
  assert.equal(r.metrics.main,r.metrics.cash);assert.match(r.answer,/encaissement/);assert.match(r.answer,/déductible/);assert.match(r.answer,/comptable/);
  const d=ask('combien de TVA je dois payer ce mois',demoState({invoicing:{vatOnDebits:true}}));
  assert.equal(d.metrics.main,199);assert.match(d.answer,/débits/);
  const t=ask('TVA collectée ce trimestre');assert.equal(t.metrics.from,'2026-10-01');
  assert.match(ask('TVA à reverser',demoState({invoicing:{vatRegime:'franchise'}})).answer,/franchise/);
});

test('point sur la facturation',()=>{
  const r=ask('fais le point sur la facturation');assert.equal(r.intent,'billing_summary');assert.match(r.answer,/2\s345,00\s€ HT/);
});

test('période lue dans la question',()=>{
  assert.deepEqual(periodFromQuestion('mois dernier',TODAY),{from:'2026-10-01',to:'2026-10-31',label:'en octobre 2026'});
  assert.equal(periodFromQuestion('trimestre dernier',TODAY).from,'2026-07-01');
  assert.equal(periodFromQuestion('en decembre',TODAY).from,'2025-12-01');
  assert.equal(periodFromQuestion('annee derniere',TODAY).to,'2025-12-31');
});

test('branchée dans l’intelligence locale',()=>{
  const r=answerLocalIntelligence('Combien me doit le GAEC du Bois ?',demoState(),{today:TODAY});
  assert.equal(r.recognized,true);assert.equal(r.intent,'billing_client_balance');
  assert.ok(intelligenceCapabilities().intents.includes('billing_receivables'));
});
test('pas de faux positif sur « ça » ni sur « doit » hors argent',()=>{
  const s=demoState();
  for(const q of ['combien ça fait en blé tendre','combien ça fait d’hectares de blé ?','Qui doit faire le labour demain ?','Le GAEC du Bois doit passer demain'])
    assert.equal(answerBillingQuestion(q,s,{today:TODAY}),null,q);
  assert.equal(answerBillingQuestion('Quel CA ce mois-ci ?',s,{today:TODAY}).intent,'billing_revenue');
  assert.equal(answerBillingQuestion('Combien doit le GAEC du Bois ?',s,{today:TODAY}).intent,'billing_client_balance');
  assert.equal(answerBillingQuestion('Quels clients doivent encore payer ?',s,{today:TODAY}).intent,'billing_receivables');
  assert.notEqual(answerLocalIntelligence('combien ça fait d’hectares de blé ?',s,{today:TODAY}).intent?.startsWith('billing'),true);
});
