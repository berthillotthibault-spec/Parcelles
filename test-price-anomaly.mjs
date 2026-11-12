// Prix et quantités anormaux au contrôle avant émission (price-anomaly.js, complianceReport).
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {documentTotals,complianceReport} from './invoices.js';
import {priceAnomalies,lineHistory,clientSurface} from './price-anomaly.js';

const TODAY='2026-11-12';
const line=(label,quantity,unit,unitPrice,vatRate=20)=>({label,quantity,unit,unitPrice,vatRate});
let n=0;
function doc(lines,{status='emise',docType='facture',clientId='c1',id=`d${++n}`}={}){
  const d={id,farmKind:docType==='devis'?'quote':'invoice',docType,status,clientId,clientName:'GAEC du Bois',issueDate:'2026-10-01',lines};
  d.totals=documentTotals(d);return d;
}
function state(history){
  const s=emptyState();
  s.exploitation={...(s.exploitation||{}),nom:'EARL Démo',invoicing:{vatRate:20,prefix:'F'}};
  s.clients=[{id:'c1',name:'GAEC du Bois'},{id:'c2',name:'SCEA Martin'}];
  s.parcelles=[{id:'p1',nom:'Grand champ',surfaceHa:12,clientId:'c1'},{id:'p2',nom:'Pré',surfaceHa:8,clientId:'c1'},{id:'p3',nom:'Autre',surfaceHa:30}];
  s.integrationImports=history;return s;
}
const usual=()=>[doc([line('Labour',10,'ha',90)]),doc([line('Labour · Pré',8,'ha',95)]),doc([line('Labour',12,'ha',100)]),doc([line('Broyage',3,'h',60)])];

test('historique : désignation sans le nom de parcelle, même unité, brouillons et avoirs exclus',()=>{
  const s=state([...usual(),doc([line('Labour',5,'ha',10)],{status:'brouillon'}),doc([line('Labour',-5,'ha',90)],{docType:'avoir'})]);
  const h=lineHistory(s);
  assert.deepEqual(h.get('labour|ha').prices,[90,95,100]);
  assert.equal(h.get('broyage|h').prices.length,1);
});

test('prix trop bas : message avec le prix habituel (médiane)',()=>{
  const s=state(usual()),a=priceAnomalies(s,doc([line('Labour',10,'ha',45)],{status:'brouillon'}));
  assert.equal(a.length,1);assert.equal(a[0].kind,'price');
  assert.equal(a[0].text,'Labour : 45 €/ha alors que vous facturez habituellement 95 €/ha (faute de frappe ?)');
});

test('prix trop haut (> 200 %) signalé, prix dans la fourchette ignoré',()=>{
  const s=state(usual());
  assert.equal(priceAnomalies(s,doc([line('Labour',10,'ha',950)],{status:'brouillon'}))[0].kind,'price');
  assert.deepEqual(priceAnomalies(s,doc([line('Labour',10,'ha',120)],{status:'brouillon'})),[]);
  assert.deepEqual(priceAnomalies(s,doc([line('Labour',10,'ha',48)],{status:'brouillon'})),[]);
});

test('moins de 3 prix historiques ou autre unité : pas d’avertissement de prix',()=>{
  const s=state(usual());
  assert.deepEqual(priceAnomalies(s,doc([line('Broyage',3,'h',6)],{status:'brouillon'})),[]);
  assert.deepEqual(priceAnomalies(s,doc([line('Labour',3,'h',10)],{status:'brouillon'})),[]);
});

test('surface des parcelles du client : ha facturés au-delà signalés',()=>{
  const s=state(usual());
  assert.equal(clientSurface(s,'c1'),20);assert.equal(clientSurface(s,'c2'),null);
  const a=priceAnomalies(s,doc([line('Labour',200,'ha',95)],{status:'brouillon'}));
  assert.equal(a.length,1);assert.equal(a[0].kind,'surface');assert.match(a[0].text,/200 ha facturés.*20 ha au total/);
});

test('quantité > 10 fois l’habitude (client sans parcelles connues)',()=>{
  const s=state(usual()),a=priceAnomalies(s,doc([line('Labour',150,'ha',95)],{status:'brouillon',clientId:'c2'}));
  assert.equal(a.length,1);assert.equal(a[0].kind,'quantity');assert.match(a[0].text,/150 ha alors que vous facturez habituellement 10 ha/);
});

test('avoir et lignes de remise ignorés ; le document contrôlé n’est pas son propre historique',()=>{
  const s=state(usual());
  assert.deepEqual(priceAnomalies(s,doc([line('Labour',-10,'ha',45)],{docType:'avoir'})),[]);
  const own=doc([line('Labour',10,'ha',45)],{status:'emise',id:'own'});s.integrationImports.push(own);
  assert.equal(priceAnomalies(s,own).length,1);
});

test('complianceReport : avertissement non bloquant, aucune erreur ajoutée',()=>{
  const s=state(usual()),d=doc([line('Labour',10,'ha',45)],{status:'brouillon'});
  const before=complianceReport(state([]),d,{today:TODAY}),r=complianceReport(s,d,{today:TODAY});
  assert.ok(r.warnings.includes('Labour : 45 €/ha alors que vous facturez habituellement 95 €/ha (faute de frappe ?)'));
  assert.deepEqual(r.errors,before.errors);
});

test('devis : même contrôle, désignation insensible aux accents et à la casse',()=>{
  const s=state([doc([line('Épandage',10,'ha',30)]),doc([line('epandage',10,'ha',30)]),doc([line('EPANDAGE',10,'ha',32)])]);
  const a=priceAnomalies(s,doc([line('Épandage',10,'ha',3)],{status:'brouillon',docType:'devis'}));
  assert.equal(a.length,1);assert.match(a[0].text,/^Épandage : 3 €\/ha alors que vous facturez habituellement 30 €\/ha/);
});

test('prix négocié d’un client (au moins 3 prix) : comparé à son propre historique',()=>{
  const c2=o=>({status:'emise',clientId:'c2',...o});
  const s=state([...usual(),doc([line('Labour',10,'ha',40)],c2()),doc([line('Labour',10,'ha',42)],c2()),doc([line('Labour',10,'ha',41)],c2())]);
  assert.deepEqual(priceAnomalies(s,doc([line('Labour',10,'ha',41)],{status:'brouillon',clientId:'c2'})),[]);
  assert.equal(priceAnomalies(s,doc([line('Labour',10,'ha',41)],{status:'brouillon'}))[0].kind,'price');
});

test('devis refusés ou convertis exclus de l’historique',()=>{
  const q=st=>doc([line('Labour',10,'ha',95)],{status:st,docType:'devis'});
  const h=lineHistory(state([q('refuse'),q('converti'),q('accepte')]));
  assert.deepEqual(h.get('labour|ha').prices,[95]);
});
