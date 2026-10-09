// n° 62 — Registre phytosanitaire : contrôles avant validation, DRE, pâturage et exports.
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {
  checkTreatment,isTreatment,phytoSheet,hasPhytoData,usageFor,limitsFor,previousApplications,reentryUntil,reentryLabel,
  activeReentries,grazingReentryConflict,registerRows,registerCsv,registerHtml,registerCampaigns,phytoComplianceCheck,
  limitsSnapshot,withdrawalLabel,at,DRE_DEFAULT_HOURS,PHYTO_DISCLAIMER
} from './phyto.js';
import {complianceChecks} from './compliance.js';

const PRODUCT={id:'s1',name:'Fongix Fictif',category:'Produit',unit:'L',quantity:20,phyto:{amm:'9990001',maxDose:1,doseUnit:'L/ha',maxApplications:2,dar:35,dre:24,zntWater:5,zntResidents:10,mentions:['abeille'],
  usages:[{culture:'Blé',target:'Septoriose',maxDose:0.8,doseUnit:'L/ha',maxApplications:1,dar:42}]}};
function farm(extra={}){
  const s=emptyState();
  s.exploitation.nom='Ferme fictive';
  s.parcelles=[{id:'p1',nom:'Les Noues',culture:'Blé tendre',surfaceHa:10},{id:'p2',nom:'Le Pré',culture:'Prairie permanente',surfaceHa:4}];
  s.stockItems=[structuredClone(PRODUCT)];
  return Object.assign(s,extra);
}
const work=(o={})=>({id:'w-new',parcelId:'p1',type:'Fongicide',isPhytosanitary:true,date:'2026-04-10',status:'Terminé',product:'Fongix Fictif',amm:'9990001',dose:0.5,doseUnit:'L/ha',culture:'Blé tendre',target:'Rouille',startTime:'08:00',endTime:'10:00',operator:'Paul',surfaceWorked:10,...o});
const codes=list=>list.map(x=>x.code).sort();

test('identification des traitements et fiche normalisée', ()=>{
  assert.equal(isTreatment({type:'Désherbage'}),true);
  assert.equal(isTreatment({type:'Semis',isPhytosanitary:true}),true);
  assert.equal(isTreatment({type:'Semis'}),false);
  const s=phytoSheet(PRODUCT);
  assert.equal(s.amm,'9990001');assert.equal(s.dre,24);assert.equal(s.usages.length,1);
  assert.equal(hasPhytoData({name:'Ammonitrate'}),false);
  assert.equal(hasPhytoData(PRODUCT),true);
});

test('usage culture × cible, sinon limites du produit', ()=>{
  const s=phytoSheet(PRODUCT);
  assert.equal(usageFor(s,'Blé tendre','Septoriose')?.maxDose,0.8);
  assert.equal(limitsFor(s,{culture:'Blé tendre',target:'Septoriose'}).maxDose,0.8);
  assert.equal(limitsFor(s,{culture:'Orge',target:'Rouille'}).maxDose,1);
});

test('aucun blocage dans les limites, rappel de l’étiquette sans fiche', ()=>{
  const r=checkTreatment(farm(),work());
  assert.equal(r.applies,true);assert.deepEqual(r.blocking,[]);
  const none=checkTreatment(farm(),work({product:'Inconnu',amm:''}));
  assert.ok(none.warnings.some(w=>w.code==='no-sheet'&&/Vérifiez l’étiquette/.test(w.message)));
  assert.equal(checkTreatment(farm(),{type:'Semis',parcelId:'p1'}).applies,false);
});

test('dose supérieure au maximum homologué : bloquant', ()=>{
  const r=checkTreatment(farm(),work({dose:1.5}));
  assert.deepEqual(codes(r.blocking),['dose']);
  assert.match(r.blocking[0].message,/1,5 L\/ha supérieure .* \(1 L\/ha\)/);
  // usage Blé × Septoriose plus strict
  assert.deepEqual(codes(checkTreatment(farm(),work({target:'Septoriose',dose:0.9})).blocking),['dose']);
  // unités différentes : avertissement, pas de comparaison hasardeuse
  const u=checkTreatment(farm(),work({dose:2,doseUnit:'kg/ha'}));
  assert.deepEqual(u.blocking,[]);assert.ok(u.warnings.some(w=>w.code==='dose-unit'));
});

test('nombre maximal d’applications par campagne', ()=>{
  const s=farm({interventions:[work({id:'a1',date:'2026-03-01'}),work({id:'a2',date:'2026-03-20'}),work({id:'old',date:'2025-05-01'}),work({id:'other',parcelId:'p2',date:'2026-03-02'})]});
  assert.equal(previousApplications(s,work()).length,2);
  const r=checkTreatment(s,work());
  assert.deepEqual(codes(r.blocking),['applications']);
  assert.match(r.blocking[0].message,/3ᵉ application .* maximum 2/);
});

test('récolte prévue ou lot de récolte dans le DAR', ()=>{
  const s=farm({interventions:[{id:'h1',parcelId:'p1',type:'Moisson',plannedDate:'2026-05-01',date:'2026-05-01',status:'À faire'}]});
  const r=checkTreatment(s,work());
  assert.deepEqual(codes(r.blocking),['dar']);
  assert.match(r.blocking[0].message,/Récolte prévue .* 35 jours/);
  const lot=farm({integrationImports:[{id:'l1',farmKind:'harvest',parcelId:'p1',code:'L-01',date:'2026-04-20'}]});
  assert.match(checkTreatment(lot,work()).blocking[0].message,/Lot de récolte .*L-01/);
  const late=farm({interventions:[{id:'h2',parcelId:'p1',type:'Moisson',plannedDate:'2026-07-20',status:'À faire'}]});
  assert.deepEqual(checkTreatment(late,work()).blocking,[]);
});

test('AMM retirée : utilisation interdite après la date limite', ()=>{
  const s=farm();s.stockItems[0].phyto.withdrawnAt='2025-11-01';s.stockItems[0].phyto.useUntil='2026-03-01';
  const r=checkTreatment(s,work());
  assert.deepEqual(codes(r.blocking),['withdrawn']);
  assert.match(withdrawalLabel(phytoSheet(s.stockItems[0])),/^AMM retirée le .* : utilisation interdite après le /);
});

test('vent au-delà de 19 km/h et champs du registre manquants : avertissements', ()=>{
  const r=checkTreatment(farm(),work({weatherSnapshot:{wind:23},target:'',endTime:''}));
  assert.deepEqual(r.blocking,[]);
  assert.ok(r.warnings.some(w=>w.code==='wind'&&/19 km\/h/.test(w.message)));
  assert.ok(r.warnings.some(w=>w.code==='incomplete'&&/cible, heure de fin/.test(w.message)));
});

test('délai de rentrée : fin du traitement + DRE, 6 h par défaut', ()=>{
  assert.equal(reentryUntil(work(),phytoSheet(PRODUCT)),at('2026-04-10','10:00')+24*3600000);
  assert.equal(reentryUntil(work({endTime:''}),null),at('2026-04-10','08:00')+DRE_DEFAULT_HOURS*3600000);
  const now=at('2026-04-10','12:00');
  assert.equal(reentryLabel(at('2026-04-10','18:00'),now),'Accès interdit jusqu’à 18 h');
  assert.equal(reentryLabel(at('2026-04-11','09:30'),now),'Accès interdit jusqu’à demain 9 h 30');
  assert.equal(reentryLabel(at('2026-04-13','09:00'),now),'Accès interdit jusqu’au 13/04 à 9 h');
});

test('parcelles en délai de rentrée et alerte de pâturage', ()=>{
  const s=farm({interventions:[work({parcelId:'p2',culture:'Prairie',endTime:'10:00'}),work({id:'planned',parcelId:'p1',status:'À faire'})]});
  const now=at('2026-04-10','12:00'),map=activeReentries(s,{now});
  assert.deepEqual([...map.keys()],['p2']);
  assert.equal(map.get('p2').label,'Accès interdit jusqu’à demain 10 h');
  assert.equal(activeReentries(s,{now:at('2026-04-11','11:00')}).size,0);
  const c=grazingReentryConflict(s,'p2','2026-04-10',{now});
  assert.ok(c);assert.match(c.message,/Accès interdit jusqu’à demain 10 h .* Vérifiez l’étiquette/);
  assert.equal(grazingReentryConflict(s,'p2','2026-04-12',{now}),null);
  assert.equal(grazingReentryConflict(s,'p1','2026-04-10',{now}),null);
});

test('registre : colonnes, complet / incomplet, CSV et PDF imprimable', ()=>{
  const s=farm({interventions:[work({weatherSnapshot:{wind:8,temperature:14,humidity:70}}),work({id:'w2',date:'2026-04-12',target:'',operator:''}),work({id:'w3',date:'2025-04-12'})],materiels:[]});
  const rows=registerRows(s,'2025/26');
  assert.equal(rows.length,2);
  assert.equal(rows[0].cells.Complet,'complet');assert.equal(rows[0].cells['Vent (km/h)'],8);assert.equal(rows[0].cells['Hygrométrie (%)'],70);assert.equal(rows[0].cells['DRE (h)'],24);
  assert.equal(rows[1].cells.Complet,'incomplet');assert.equal(rows[1].cells.Manquants,'Cible, Opérateur');
  const csv=registerCsv(rows);
  assert.ok(csv.startsWith('﻿"Date";"Début";"Fin";"Parcelle"'));
  assert.match(csv,/"incomplet";"Cible, Opérateur"/);
  const html=registerHtml(s,'2025/26',{today:at('2026-10-08','12:00')});
  assert.match(html,/<title>Registre phytosanitaire 2025\/26<\/title>/);
  assert.match(html,/1<\/strong> complet .*1<\/strong> incomplet/s);
  assert.ok(html.includes(PHYTO_DISCLAIMER));
  assert.deepEqual(registerCampaigns(s,at('2026-10-08')),['2026/27','2025/26','2024/25']);
});

test('dérogation motivée, instantané des limites et tableau de conformité', ()=>{
  const over=work({dose:3,date:'2026-09-01'});
  const s=farm({interventions:[over]});
  const today=at('2026-10-08','12:00');
  assert.equal(phytoComplianceCheck(s,{today:at('2027-01-10')}).status,'ko');
  over.campaignId='2026/27';
  let c=phytoComplianceCheck(s,{today});assert.equal(c.status,'ko');assert.equal(c.items[0].action,'edit-work');
  over.phytoOverride={reason:'Préconisation écrite du conseiller',codes:['dose']};
  c=phytoComplianceCheck(s,{today});assert.equal(c.status,'warn');assert.match(c.items[0].note,/Dérogation motivée/);
  const checks=complianceChecks(s,{today:'2026-10-08'});
  const entry=checks.find(x=>x.id==='phyto-controls');
  assert.ok(entry);assert.equal(entry.statusLabel,'À vérifier');
  const snap=limitsSnapshot(checkTreatment(s,over),123);
  assert.deepEqual({amm:snap.amm,maxDose:snap.maxDose,dar:snap.dar,dre:snap.dre,source:snap.source,checkedAt:snap.checkedAt},{amm:'9990001',maxDose:1,dar:35,dre:24,source:'fiche',checkedAt:123});
});
