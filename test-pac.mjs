// n° 58 — Assistant PAC : déclaration, BCAE 7, BCAE 6 et éco-régime (simulation).
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {
  PAC_RULES,pacRules,pacCodeFor,declarationRows,declarationCsv,bcae7Parcel,bcae7Summary,bcae7ColorInfo,BCAE7_COLORS,
  bcae6Summary,ecoRegime,pointsFor,pacComplianceChecks,TELEPAC_URL,PAC_DISCLAIMER
} from './pac.js';
import {complianceChecks} from './compliance.js';

const TODAY='2026-10-08',C='2026/27';
const rot=(parcelId,campaignId,culture,extra={})=>({id:`r-${parcelId}-${campaignId}`,parcelId,campaignId,culture,...extra});
function farm(){
  const s=emptyState();
  s.parcelles=[
    {id:'p1',nom:'Les Noues',culture:'Blé tendre',surfaceHa:10,ilot:'2'},
    {id:'p2',nom:'Grand Champ',culture:'Maïs grain',surfaceHa:10,ilot:'1'},
    {id:'p3',nom:'Le Pré Bas',culture:'Prairie permanente',surfaceHa:5,ilot:'1'},
    {id:'p4',nom:'La Côte',culture:'Colza',surfaceHa:5,ilot:'10',rpgCodeCulture:'CZH'}
  ];
  s.rotations=[
    rot('p1','2024/25','Blé tendre'),rot('p1','2025/26','Blé tendre'),
    rot('p2','2025/26','Blé tendre'),
    rot('p4','2025/26','Colza')
  ];
  return s;
}

test('règles datées : campagne exacte ou la plus proche antérieure', ()=>{
  assert.equal(pacRules(C).version,'PAC-2027.1');
  assert.equal(pacRules('2030/31').exact,false);
  assert.equal(pacRules('2030/31').campaign,'2026/27');
  assert.equal(pacRules('2010/11').campaign,'2025/26');
  assert.ok(Object.values(PAC_RULES).every(r=>r.bcae7.minChangedShare===0.35));
  assert.match(TELEPAC_URL,/^https:\/\/www\.telepac/);
  assert.match(PAC_DISCLAIMER,/Simulation/);
});

test('correspondance culture → code PAC', ()=>{
  assert.equal(pacCodeFor('Blé tendre').code,'BTH');
  assert.equal(pacCodeFor('Blé dur').code,'BDH');
  assert.equal(pacCodeFor('Maïs ensilage').code,'MIE');
  assert.equal(pacCodeFor('Prairie temporaire').code,'PTR');
  assert.equal(pacCodeFor('Prairie permanente').code,'PPH');
  assert.equal(pacCodeFor('Inconnue'),null);
});

test('déclaration : tri par îlot, codes déduits, saisis ou RPG, CSV', ()=>{
  const s=farm();
  s.parcelles.push({id:'p5',nom:'Sans culture',surfaceHa:1,rpgCodeCulture:'TRN'});
  s.rotations.push(rot('p2',C,'Maïs grain',{pac:{code:'mie'}}));
  const rows=declarationRows(s,C,{today:TODAY});
  assert.deepEqual(rows.map(r=>r.parcel.id),['p2','p3','p1','p4','p5']);
  const by=id=>rows.find(r=>r.parcel.id===id);
  assert.equal(by('p2').code,'MIE');assert.equal(by('p2').codeSource,'saisi');
  assert.equal(by('p3').prairie,'permanente');assert.equal(by('p3').kind,'PP');
  assert.equal(by('p5').code,'TRN');assert.equal(by('p5').codeSource,'RPG');
  const csv=declarationCsv(rows,C);
  assert.ok(csv.startsWith('﻿Campagne;Îlot;Parcelle'));
  assert.match(csv,/2026\/27;1;Grand Champ;Maïs grain;MIE;Maïs ensilage;10;;Autres cultures\r\n/);
});

test('BCAE 7 : même culture 3 campagnes en rouge, part de changement', ()=>{
  const s=farm();
  assert.equal(bcae7Parcel(s,s.parcelles[0],C,{today:TODAY}).status,'ko');
  assert.equal(bcae7Parcel(s,s.parcelles[1],C,{today:TODAY}).status,'changed');
  assert.equal(bcae7Parcel(s,s.parcelles[2],C,{today:TODAY}).status,'na');
  assert.equal(bcae7Parcel(s,s.parcelles[3],C,{today:TODAY}).status,'same');
  const sum=bcae7Summary(s,C,{today:TODAY});
  assert.equal(sum.area,25);assert.equal(sum.changedArea,10);
  assert.equal(Math.round(sum.share*100),40);
  assert.equal(sum.shareOk,true);
  assert.equal(sum.status,'ko');
  assert.deepEqual(bcae7ColorInfo(s,s.parcelles[0],{today:TODAY}),BCAE7_COLORS.ko);
  s.rotations=s.rotations.filter(r=>r.parcelId!=='p1');
  assert.equal(bcae7Parcel(s,s.parcelles[0],C,{today:TODAY}).status,'unknown');
  assert.equal(bcae7Summary(s,C,{today:TODAY}).status,'warn');
});

test('BCAE 6 : terres arables couvertes en période sensible', ()=>{
  const b=bcae6Summary(farm(),C,{today:TODAY});
  assert.equal(b.area,25);assert.equal(b.coveredArea,15);
  assert.deepEqual(b.uncovered.map(r=>r.parcel.id),['p2']);
  assert.match(b.text,/À vérifier/);
});

test('éco-régime : points de diversité, prairies non labourées, niveau et conseil', ()=>{
  assert.equal(pointsFor([[0.05,1],[0.10,2]],0.07),1);
  assert.equal(pointsFor([[0.05,1],[0.10,2]],0.01),0);
  const s=farm();
  let eco=ecoRegime(s,C,{today:TODAY});
  // TA 25 ha : céréales d’hiver 40 % (2), autres 40 % (2), oléagineux 20 % (2) = 6 points.
  assert.equal(eco.points,6);
  assert.equal(eco.components.find(c=>c.key==='prairies').value,1);
  assert.equal(eco.level,2);assert.equal(eco.levelLabel,'Niveau supérieur');
  assert.equal(eco.advice.text,'Niveau supérieur atteint.');
  assert.equal(eco.amountTotal,Math.round(63.5*30));
  // Monoculture de blé : 2 points, il manque 2 points pour le niveau standard.
  s.parcelles=[{id:'a',nom:'A',culture:'Blé tendre',surfaceHa:20}];
  eco=ecoRegime(s,C,{today:TODAY});
  assert.equal(eco.points,2);assert.equal(eco.level,0);
  assert.match(eco.advice.text,/^Niveau standard : il manque 2 points : \+\d+(,\d)? ha de /);
  // Prairie permanente labourée : composante limitante.
  s.parcelles=[{id:'pp',nom:'PP',culture:'Prairie permanente',surfaceHa:10}];
  s.interventions=[{id:'w',parcelId:'pp',type:'Labour',date:'2026-10-01',status:'Terminé'}];
  eco=ecoRegime(s,C,{today:TODAY});
  assert.equal(eco.level,0);
  assert.match(eco.advice.text,/\+8 ha de prairies permanentes non labourées/);
});

test('conformité : entrée BCAE 7 ajoutée', ()=>{
  const s=farm();
  const c=pacComplianceChecks(s,{today:TODAY})[0];
  assert.equal(c.status,'ko');assert.equal(c.items[0].id,'p1');
  assert.ok(complianceChecks(s,{today:TODAY}).some(x=>x.id==='pac-bcae7'));
});
