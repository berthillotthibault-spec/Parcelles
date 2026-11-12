// Saisie rapide de facturation en français agricole : quantités, unités, prix sans « € », TTC, remises,
// plusieurs lignes. Le format de retour reste celui attendu par l’éditeur (brouillon, jamais d’écriture).
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {parseQuickEntry} from './billing-insights.js';

const state=emptyState();state.clients=[{id:'c1',name:'Dupont TP'},{id:'c2',name:'GAEC des Prés'}];
const rows=t=>parseQuickEntry(t,state).lines.map(l=>[l.label,l.quantity,l.unit,l.unitPrice]);

test('quantités, unités et virgules décimales',()=>{
  assert.deepEqual(rows('labour 4,5 ha à 95 €'),[['Labour',4.5,'ha',95]]);
  assert.deepEqual(rows('3h pelle à 65€/h'),[['Pelle',3,'h',65]]);
  assert.deepEqual(rows('2 jours de broyage 450 € la journée'),[['Broyage',2,'j',450]]);
  assert.deepEqual(rows('12 t de paille 80 €/t'),[['Paille',12,'t',80]]);
  assert.deepEqual(rows('curage 40 ml à 3 €'),[['Curage',40,'m',3]]);
  assert.deepEqual(rows('terre 10 m3 à 15 €'),[['Terre',10,'m³',15]]);
  assert.deepEqual(rows('déplacement 30 km à 0,6 €'),[['Déplacement',30,'km',0.6]]);
  assert.deepEqual(rows('pressage 120 balles à 3,5 €'),[['Pressage',120,'u',3.5]]);
});

test('prix sans symbole euro après la quantité, avec « x » ou seul',()=>{
  assert.deepEqual(rows('moisson 25ha 130'),[['Moisson',25,'ha',130]]);
  assert.deepEqual(rows('transport 3 voyages x 40'),[['Transport',3,'u',40]]);
  assert.deepEqual(rows('3 x 40 € de transport'),[['Transport',3,'u',40]]);
  assert.match(parseQuickEntry('moisson 25ha 130',state).lines[0].basis,/vérifier/);
  // Sans quantité, un nombre seul n’est pas pris pour un prix.
  assert.equal(parseQuickEntry('semis de blé 10 ha',state).lines[0].unitPrice,null);
});

test('forfait : le mot devient l’unité',()=>{
  assert.deepEqual(rows('déplacement forfait 50 €'),[['Déplacement',1,'forfait',50]]);
  assert.deepEqual(rows('déplacement au forfait 50 €'),[['Déplacement',1,'forfait',50]]);
});

test('TTC converti en HT et signalé',()=>{
  const r=parseQuickEntry('12 t de paille 80 €/t TTC',state);
  assert.equal(r.lines[0].vatRate,10);
  assert.equal(r.lines[0].unitPrice,Math.round(80/1.1*10000)/10000);
  assert.ok(r.warnings.some(w=>/TTC converti en 72,73 € HT.*10 %/.test(w)),r.warnings.join());
  assert.equal(parseQuickEntry('épandage 3 heures à 70 € HT',state).lines[0].unitPrice,70);
});

test('remises : sur la ligne, sur la ligne précédente, sur le total',()=>{
  assert.equal(parseQuickEntry('broyage 10 ha à 45 € -10 %',state).lines[0].discountPct,10);
  assert.equal(parseQuickEntry('moisson 25 ha 130 €/ha remise 5%',state).lines[0].discountPct,5);
  assert.equal(parseQuickEntry('labour 4 ha 95 € + remise 5 %',state).lines.length,1);
  assert.equal(parseQuickEntry('labour 4 ha 95 € + remise 5 %',state).lines[0].discountPct,5);
  const g=parseQuickEntry('labour 4 ha 95 € + semis 4 ha 60 € ; remise 10 % sur le total',state);
  assert.deepEqual(g.lines.map(l=>l.discountPct),[10,10]);
  assert.ok(g.warnings.some(w=>/Remise de 10 %/.test(w)));
  assert.equal(parseQuickEntry('labour 4 ha 95 €',state).lines[0].discountPct,undefined,'pas de champ remise sans remise');
});

test('plusieurs lignes : retour à la ligne et « + », client reconnu',()=>{
  assert.deepEqual(rows('labour 4 ha 95 €\nsemis 4 ha 60 €'),[['Labour',4,'ha',95],['Semis',4,'ha',60]]);
  const r=parseQuickEntry('devis Dupont TP : 3h pelle 65 + 2 t cailloux 18',state);
  assert.equal(r.docType,'devis');assert.equal(r.client.id,'c1');assert.equal(r.draftOnly,true);
  assert.deepEqual(r.lines.map(l=>[l.label,l.quantity,l.unit,l.unitPrice]),[['Pelle',3,'h',65],['Cailloux',2,'t',18]]);
});
test('« neuf » adjectif ne devient pas un nombre',()=>{
  const st=emptyState();
  const r=parseQuickEntry('pneu neuf 120 €',st);
  assert.equal(r.lines.length,1);assert.equal(r.lines[0].unitPrice,120);assert.equal(r.lines[0].quantity,1);
  const b=parseQuickEntry('neuf balles à 3 €',st);
  assert.equal(b.lines[0].quantity,9);assert.equal(b.lines[0].unitPrice,3);
});
