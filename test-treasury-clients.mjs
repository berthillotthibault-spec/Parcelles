// Trésorerie et assistant : encaissements placés à la date probable selon les habitudes de paiement.
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {documentTotals} from './invoices.js';
import {clientPaymentHabits,expectedPaymentDate,expectedCollections,habitSentence} from './payment-habits.js';
import {treasuryFlows,treasuryForecast} from './treasury.js';
import {payHabitsText} from './treasury-ui.js';
import {answerBillingQuestion} from './billing-assistant.js';

const TODAY='2026-11-12';
const line=(label,quantity,unit,unitPrice,vatRate=20)=>({label,quantity,unit,unitPrice,vatRate});
function inv(id,{clientId='c1',clientName='SCEA Martin',issueDate,dueDate,paidAt='',amount=1000,status='emise',docType='facture'}){
  const d={id,farmKind:'invoice',docType,status,clientId,clientName,number:`F-${id}`,issueDate,dueDate,lines:[line('Labour',1,'ha',amount/1.2)],payments:[],...(paidAt?{paidAt}:{})};
  d.totals=documentTotals(d);return d;
}
function base(extra=[]){
  const s=emptyState();
  s.exploitation={...(s.exploitation||{}),nom:'EARL Démo',invoicing:{vatRate:20,prefix:'F'}};
  s.clients=[{id:'c1',name:'SCEA Martin'},{id:'c2',name:'Jean Dupont'}];
  s.integrationImports=[
    // Martin : payé 52 jours après l’émission, 22 jours après l’échéance, deux fois.
    inv('m1',{issueDate:'2026-03-01',dueDate:'2026-03-31',paidAt:'2026-04-22'}),
    inv('m2',{issueDate:'2026-05-01',dueDate:'2026-05-31',paidAt:'2026-06-22'}),
    // Martin : facture ouverte, échéance 30/11.
    inv('m3',{issueDate:'2026-10-31',dueDate:'2026-11-30'}),
    // Dupont : une seule facture payée (en avance) : pas assez d’historique.
    inv('d1',{clientId:'c2',clientName:'Jean Dupont',issueDate:'2026-06-01',dueDate:'2026-07-01',paidAt:'2026-06-10'}),
    inv('d2',{clientId:'c2',clientName:'Jean Dupont',issueDate:'2026-11-01',dueDate:'2026-12-01'}),
    ...extra
  ];
  return s;
}

test('habitudes : délai moyen depuis l’émission et retard moyen après l’échéance',()=>{
  const h=clientPaymentHabits(base());
  const martin=h.find(x=>x.clientId==='c1'),dupont=h.find(x=>x.clientId==='c2');
  assert.equal(martin.count,2);assert.equal(martin.averageDays,52);assert.equal(martin.averageLateDays,22);assert.equal(martin.lateCount,2);assert.equal(martin.reliable,true);
  assert.equal(dupont.count,1);assert.equal(dupont.averageLateDays,-21);assert.equal(dupont.reliable,false);
});

test('habitudes : brouillons, avoirs et factures sans date de paiement ignorés',()=>{
  const h=clientPaymentHabits(base([inv('x1',{issueDate:'2026-01-01',dueDate:'2026-01-31',paidAt:'2026-09-01',status:'brouillon'}),inv('x2',{issueDate:'2026-01-01',dueDate:'2026-01-31',paidAt:'2026-09-01',docType:'avoir',amount:-100})]));
  assert.equal(h.find(x=>x.clientId==='c1').averageDays,52);
});

test('date probable : décalée du retard moyen, jamais avancée, échéance gardée sans historique fiable',()=>{
  assert.equal(expectedPaymentDate('2026-11-30',{reliable:true,averageLateDays:22}),'2026-12-22');
  assert.equal(expectedPaymentDate('2026-11-30',{reliable:true,averageLateDays:-10}),'2026-11-30');
  assert.equal(expectedPaymentDate('2026-11-30',{reliable:false,averageLateDays:30}),'2026-11-30');
  assert.equal(expectedPaymentDate('2026-11-30',null),'2026-11-30');
});

test('phrase d’habitude : « SCEA Martin paie en moyenne à 52 jours »',()=>{
  const martin=clientPaymentHabits(base()).find(x=>x.clientId==='c1');
  assert.equal(habitSentence(martin),'SCEA Martin paie en moyenne à 52 jours, 22 jours après l’échéance (2 factures payées).');
  assert.match(habitSentence({name:'X',averageDays:20,averageLateDays:0,count:3}),/dans les délais/);
});

test('encaissements attendus : facture de Martin décalée, Dupont à l’échéance',()=>{
  const rows=expectedCollections(base(),{today:TODAY});
  const m3=rows.find(r=>r.invoice.id==='m3'),d2=rows.find(r=>r.invoice.id==='d2');
  assert.equal(m3.expectedDate,'2026-12-22');assert.equal(m3.shiftDays,22);assert.equal(m3.habit.name,'SCEA Martin');assert.equal(m3.late,false);
  assert.equal(d2.expectedDate,'2026-12-01');assert.equal(d2.shiftDays,0);assert.equal(d2.habit,null);
});

test('trésorerie : la facture de Martin passe au mois probable, avec la phrase d’habitude',()=>{
  const f=treasuryFlows(base(),{start:'2026-11',today:TODAY});
  const m3=f.lines.find(l=>l.id.startsWith('facture:m3'));
  assert.equal(m3.month,'2026-12');assert.equal(m3.expectedDate,'2026-12-22');assert.equal(m3.dueDate,'2026-11-30');
  assert.match(m3.note,/SCEA Martin paie en moyenne à 52 jours/);
  assert.equal(f.lines.find(l=>l.id.startsWith('facture:d2')).month,'2026-12');
  assert.ok(f.payHabits.length>=2);
});

test('trésorerie : identifiant de flux stable (échéance théorique) pour le scénario de décalage',()=>{
  const f=treasuryForecast(base(),{start:'2026-11',today:TODAY});
  const id=f.lines.find(l=>l.source==='facture'&&l.label.includes('F-m3')).id;
  assert.equal(id,'facture:m3:2026-11-30');
  const moved=treasuryForecast(base(),{start:'2026-11',today:TODAY,shifts:{[id]:1}});
  assert.equal(moved.lines.find(l=>l.id===id).month,'2027-01');
});

test('trésorerie UI : phrase « paie en moyenne à N jours » pour les clients concernés seulement',()=>{
  const f=treasuryForecast(base(),{start:'2026-11',today:TODAY});
  const t=payHabitsText(f);
  assert.equal(t.length,1);assert.match(t[0],/^SCEA Martin paie en moyenne à 52 jours/);
});

test('retard probable déjà dépassé : placé au premier mois et marqué en retard',()=>{
  const s=base([inv('m4',{issueDate:'2026-09-01',dueDate:'2026-10-01'})]);
  const l=treasuryFlows(s,{start:'2026-11',today:TODAY}).lines.find(x=>x.id.startsWith('facture:m4'));
  assert.equal(l.month,'2026-11');assert.equal(l.late,true);
});

test('assistant : « quand vais-je être payé » donne la date probable et l’habitude',()=>{
  const r=answerBillingQuestion('quand vais-je être payé ?',base(),{today:TODAY});
  assert.equal(r.intent,'billing_collections');
  assert.match(r.answer,/SCEA Martin 1\s000,00\s€ vers le 22\/12\/2026 \(échéance 30\/11\/2026\)/);
  assert.match(r.answer,/paie en moyenne à 52 jours/);assert.equal(r.metrics.count,2);
});

test('assistant : prévision d’encaissements pour un client nommé, et rien à encaisser',()=>{
  const r=answerBillingQuestion('prévision d’encaissements de Dupont',base(),{today:TODAY});
  assert.equal(r.intent,'billing_collections');assert.equal(r.metrics.count,1);assert.match(r.answer,/Jean Dupont/);
  const empty=emptyState();empty.clients=[];
  assert.match(answerBillingQuestion('quand vais-je être payé',empty,{today:TODAY}).answer,/rien à encaisser/);
});

test('assistant : « quand dois-je payer le fermage » n’est pas une prévision d’encaissement',()=>{
  const r=answerBillingQuestion('quand dois-je payer le fermage ?',base(),{today:TODAY});
  assert.notEqual(r?.intent,'billing_collections');
});
