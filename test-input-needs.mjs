// n° I3 : besoins en intrants des travaux prévus face au stock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {inputNeeds,shortfallMessage,orderTaskDraft,formatQuantity} from './input-needs.js';

const TODAY='2027-03-05';
const parcels=[{id:'p1',nom:'Grand Champ',surfaceHa:12.4},{id:'p2',nom:'Le Pré',surfaceHa:10},{id:'p3',nom:'La Côte',surfaceHa:11.6}];
const work=(id,parcelId,date,extra={})=>({id,parcelId,status:'À faire',plannedDate:date,product:'Ammonitrate 27',dose:150,doseUnit:'kg/ha',...extra});
const base=(extra={})=>({
  parcelles:parcels,
  stockItems:[{id:'s1',name:'Ammonitrate 27',unit:'kg',quantity:3200,unitPrice:0.28}],
  stockMovements:[],
  interventions:[work('w1','p1','2027-03-08'),work('w2','p2','2027-03-12'),work('w3','p3','2027-03-20')],
  ...extra,
});

test('cumul chronologique : 1900 kg manquants dès le 2e apport', () => {
  const [need,...rest]=inputNeeds(base(),{today:TODAY});
  assert.equal(rest.length,0);
  assert.equal(need.id,'stock-shortfall-s1');
  assert.equal(need.need,5100);
  assert.equal(need.available,3200);
  assert.equal(need.shortfall,1900);
  assert.equal(need.firstShortWorkId,'w2');
  assert.equal(need.firstShortDate,'2027-03-12');
  assert.equal(need.level,'urgent');
  assert.equal(need.works.length,3);
  assert.match(need.why[0],/3,2 t en stock, 5,1 t nécessaires pour 3 apports prévus d’ici le 20\/03/);
  assert.equal(need.valueEur,532);
  const msg=shortfallMessage(need,{today:TODAY});
  assert.match(msg,/^Ammonitrate 27 : il manque 1,9 t dès l’apport du 12\/03 sur Le Pré \(10 ha × 150 kg\/ha\)\. Commandez avant le 09\/03 \(≈ 532 €\)\.$/);
});

test('niveau warning si le premier manque est à plus de 7 jours', () => {
  const s=base();s.interventions=[work('w1','p1','2027-03-20'),work('w2','p2','2027-03-25')];
  assert.equal(inputNeeds(s,{today:TODAY})[0].level,'warning');
});

test('conversions L/ha, kg/ha vers t', () => {
  const s=base({stockItems:[{id:'e',name:'Engrais',unit:'t',quantity:1},{id:'h',name:'Herbicide',unit:'L',quantity:20}]});
  s.interventions=[work('a','p2','2027-03-06',{product:'Engrais',dose:150}),work('b','p2','2027-03-06',{product:'Herbicide',dose:2.5,doseUnit:'L/ha'})];
  const needs=inputNeeds(s,{today:TODAY});
  const e=needs.find(n=>n.itemId==='e'),h=needs.find(n=>n.itemId==='h');
  assert.equal(e.need,1.5);assert.equal(e.shortfall,0.5);
  assert.equal(h.need,25);assert.equal(h.shortfall,5);
  assert.equal(formatQuantity(1900,'kg'),'1,9 t');
});

test('dose en L/ha face à un stock en kg : non chiffré, sans fausse alerte', () => {
  const s=base();s.interventions=[work('w1','p1','2027-03-08',{dose:200,doseUnit:'L/ha'})];
  assert.deepEqual(inputNeeds(s,{today:TODAY}),[]);
  s.interventions.push(work('w2','p1','2027-03-09',{dose:300}),work('w3','p2','2027-03-09',{dose:100}));
  const [need]=inputNeeds(s,{today:TODAY});
  assert.equal(need.unconverted.length,1);
  assert.equal(need.unconverted[0].workId,'w1');
  assert.ok(need.why.includes('besoin non chiffré pour 1 travail'));
  assert.equal(need.need,4720);
});

test('travaux terminés, annulés, supprimés ou hors horizon ignorés', () => {
  const s=base();
  s.interventions=[work('w1','p1','2027-03-08',{status:'Terminé'}),work('w2','p2','2027-03-08',{status:'Annulé'}),work('w3','p3','2027-03-08',{deletedAt:1}),
    work('w4','p1','2027-04-30'),work('w5','p2','2027-02-20'),work('w6','p3','2027-03-08',{dose:100})];
  assert.deepEqual(inputNeeds(s,{today:TODAY}),[]);
  s.interventions.push(work('w7','p1','2027-03-01',{dose:200}));
  const [need]=inputNeeds(s,{today:TODAY});
  assert.deepEqual(need.works.map(w=>w.workId),['w7','w6']);
  assert.equal(inputNeeds(s,{today:TODAY,horizonDays:60})[0].works.length,3);
});

test('lot périmé avant la date d’emploi exclu du disponible', () => {
  const s=base({stockItems:[{id:'s1',name:'Fongicide',unit:'L',quantity:30,unitPrice:20}],
    stockMovements:[{id:'m1',stockItemId:'s1',type:'Entrée',quantity:10,date:'2027-01-10',expiryDate:'2027-03-10',lotNumber:'A1'}]});
  s.interventions=[work('w1','p2','2027-03-15',{product:'Fongicide',dose:2.5,doseUnit:'L/ha'})];
  const [need]=inputNeeds(s,{today:TODAY});
  assert.equal(need.available,20);
  assert.equal(need.shortfall,5);
  assert.deepEqual(need.expiredBeforeUse,[{lot:'A1',expiry:'2027-03-10',quantity:10}]);
  assert.equal(need.valueEur,100);
});

test('AMM retirée signalée même sans manque', () => {
  const s=base({stockItems:[{id:'s1',name:'Ammonitrate 27',unit:'kg',quantity:9000,phyto:{withdrawnAt:'2027-01-01'}}]});
  const [need]=inputNeeds(s,{today:TODAY});
  assert.equal(need.ammWithdrawn,true);
  assert.equal(need.shortfall,0);
  assert.equal(need.valueEur,null);
  assert.match(shortfallMessage(need),/AMM retirée/);
});

test('valeur au PMP des entrées chiffrées, null si prix inconnu', () => {
  const s=base({stockItems:[{id:'s1',name:'Ammonitrate 27',unit:'kg',quantity:3200}],
    stockMovements:[{id:'m1',stockItemId:'s1',type:'Entrée',quantity:3200,unitPrice:0.4,date:'2027-01-05'}]});
  assert.equal(inputNeeds(s,{today:TODAY})[0].valueEur,760);
  const noPrice=base({stockItems:[{id:'s1',name:'Ammonitrate 27',unit:'kg',quantity:3200}]});
  const [need]=inputNeeds(noPrice,{today:TODAY});
  assert.equal(need.valueEur,null);
  assert.doesNotMatch(shortfallMessage(need),/€/);
});

test('rapprochement par AMM et surface travaillée prioritaire', () => {
  const s=base({stockItems:[{id:'s1',name:'Produit X 250',unit:'L',quantity:5,phyto:{amm:'2150123'}}]});
  s.interventions=[work('w1','p1','2027-03-08',{product:'Produit X',amm:'2150123',dose:1,doseUnit:'L/ha',surfaceWorked:8})];
  const [need]=inputNeeds(s,{today:TODAY});
  assert.equal(need.itemId,'s1');
  assert.equal(need.need,8);
  assert.equal(need.works[0].surfaceHa,8);
});

test('état vide ou sans stock : aucune alerte', () => {
  assert.deepEqual(inputNeeds({},{today:TODAY}),[]);
  assert.deepEqual(inputNeeds(null,{today:TODAY}),[]);
  assert.deepEqual(inputNeeds(base({stockItems:[]}),{today:TODAY}),[]);
});

test('sortie déterministe et brouillon de tâche', () => {
  const a=JSON.stringify(inputNeeds(base(),{today:TODAY})),b=JSON.stringify(inputNeeds(base(),{today:TODAY}));
  assert.equal(a,b);
  const [need]=inputNeeds(base(),{today:TODAY});
  const draft=orderTaskDraft(need,{today:TODAY});
  assert.equal(draft.title,'Commander Ammonitrate 27');
  assert.equal(draft.dueDate,'2027-03-09');
  assert.match(draft.notes,/il manque 1,9 t/);
  assert.equal(orderTaskDraft(need,{today:'2027-03-11'}).dueDate,'2027-03-11');
  assert.match(shortfallMessage(need,{today:'2027-03-11'}),/Commandez dès aujourd’hui/);
});

test('préférence d’horizon lue dans l’état', () => {
  const s=base({preferences:{adviceStockHorizonDays:3}});
  const [need]=inputNeeds(s,{today:TODAY});
  assert.equal(need,undefined);
});

test('surface ou dose à 0 : non chiffré, jamais compté pour 0', () => {
  // surfaceWorked à 0 (formulaire vide) : on retombe sur la surface de la parcelle.
  const s=base();s.interventions=[work('w1','p1','2027-03-08',{surfaceWorked:0,dose:300})];
  const [need]=inputNeeds(s,{today:TODAY});
  assert.equal(need.need,3720);
  // Parcelle sans surface et dose à 0 : les deux travaux vont dans unconverted.
  const t=base({parcelles:[...parcels,{id:'p9',nom:'Sans surface',surfaceHa:0}]});
  t.interventions=[work('w1','p9','2027-03-08',{dose:5000}),work('w2','p1','2027-03-08',{dose:0}),work('w3','p1','2027-03-09',{dose:300})];
  const [n2]=inputNeeds(t,{today:TODAY});
  assert.deepEqual(n2.unconverted,[{workId:'w1',reason:'surface inconnue'},{workId:'w2',reason:'dose absente'}]);
  assert.equal(n2.need,3720);
});

test('AMM retirée entre aujourd’hui et la date d’emploi signalée', () => {
  const s=base({stockItems:[{id:'s1',name:'Ammonitrate 27',unit:'kg',quantity:9000,phyto:{withdrawnAt:'2027-03-10'}}]});
  s.interventions=[work('w1','p1','2027-03-15')];
  const [need]=inputNeeds(s,{today:TODAY});
  assert.equal(need.ammWithdrawn,true);
  s.interventions=[work('w1','p1','2027-03-08')];
  assert.deepEqual(inputNeeds(s,{today:TODAY}),[]);
});

test('date du jour ou horizon invalides : pas d’exception', () => {
  assert.doesNotThrow(()=>inputNeeds(base(),{today:'pas une date'}));
  assert.doesNotThrow(()=>inputNeeds(base(),{today:TODAY,horizonDays:'abc'}));
  assert.equal(inputNeeds(base(),{today:TODAY,horizonDays:'abc'})[0].shortfall,1900);
});
