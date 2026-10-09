// n° 64 — IFT par parcelle, culture et campagne.
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {referenceDose,treatmentIft,treatmentFamily,parcelIft,farmIft,iftHistory,iftLabel,iftColor,previousCampaigns,IFT_REFERENCE_TABLE} from './ift.js';

function farm(){
  const s=emptyState();
  s.parcelles=[{id:'p1',nom:'Les Noues',culture:'Blé tendre',surfaceHa:10},{id:'p2',nom:'Grand Champ',culture:'Blé tendre',surfaceHa:30},{id:'p3',nom:'Maïs',culture:'Maïs grain',surfaceHa:20}];
  s.stockItems=[
    {id:'f',name:'Fongix',phyto:{amm:'1',category:'fongicide',maxDose:1,doseUnit:'L/ha'}},
    {id:'h',name:'Herbanet',phyto:{amm:'2',category:'herbicide',maxDose:2,refDose:4,doseUnit:'L/ha'}},
    {id:'b',name:'Bioprotect',phyto:{amm:'3',category:'biocontrole',maxDose:1,doseUnit:'kg/ha'}}
  ];
  const w=(id,parcelId,product,dose,o={})=>({id,parcelId,type:'Traitement',isPhytosanitary:true,status:'Terminé',date:'2026-04-01',product,dose,doseUnit:product==='Bioprotect'?'kg/ha':'L/ha',...o});
  s.interventions=[
    w('a','p1','Fongix',0.5),                      // 0,5
    w('b','p1','Herbanet',2,{surfaceWorked:5}),    // 2/4 × 5/10 = 0,25
    w('c','p1','Bioprotect',1),                    // 1 biocontrôle, exclu
    w('d','p1','Fongix',1,{status:'À faire'}),     // non réalisé : ignoré
    w('e','p1','Inconnu',1),                       // référence inconnue
    w('f','p2','Fongix',1),                        // 1
    w('g','p1','Fongix',1,{date:'2025-04-01'}),    // campagne précédente : 1
    w('h','p3','Herbanet',4)                       // 1 herbicide
  ];
  return s;
}

test('formule et provenance de la dose de référence', ()=>{
  const s=farm(),get=id=>s.interventions.find(w=>w.id===id);
  assert.equal(treatmentIft(s,get('a')).value,0.5);
  assert.equal(treatmentIft(s,get('a')).reference.source,'fiche produit (dose homologuée)');
  const b=treatmentIft(s,get('b'));assert.equal(b.value,0.25);assert.equal(b.reference.source,'fiche produit (dose de référence)');assert.equal(b.family,'herbicide');
  assert.equal(treatmentIft(s,get('e')).value,null);assert.match(treatmentIft(s,get('e')).reason,/référence inconnue/);
  s.exploitation.iftReferences=[{culture:'Blé',product:'Fongix',dose:2,unit:'L/ha'}];
  const own=treatmentIft(s,get('a'));assert.equal(own.value,0.25);assert.equal(own.reference.source,'table de l’exploitation');
  assert.equal(treatmentIft(s,{...get('a'),doseUnit:'kg/ha'}).value,null);
  assert.equal(treatmentFamily(s,{type:'Désherbage'}),'herbicide');assert.equal(treatmentFamily(s,get('c')),'biocontrole');
  assert.equal(referenceDose(s,{product:'Inconnu'}),null);
  assert.match(IFT_REFERENCE_TABLE.method,/dose de référence/);assert.equal(IFT_REFERENCE_TABLE.vintage,'2024');
});

test('somme par parcelle avec détail, biocontrôle exclu', ()=>{
  const r=parcelIft(farm(),'p1','2025/26');
  assert.deepEqual(r,{total:0.75,herbicide:0.25,other:0.5,biocontrol:1,treatments:4,missing:1});
  assert.equal(iftLabel(r),'IFT 0,8 · herbicide 0,3 · biocontrôle 1');
  assert.equal(iftLabel({total:2.4,herbicide:1.1,biocontrol:0,treatments:3}),'IFT 2,4 · herbicide 1,1');
  assert.equal(iftLabel(parcelIft(farm(),'p3','2024/25')),'IFT 0');
});

test('agrégation par culture et exploitation, pondérée par la surface', ()=>{
  const f=farmIft(farm(),'2025/26');
  const ble=f.cultures.find(c=>c.culture==='Blé tendre');
  assert.equal(ble.surface,40);assert.equal(ble.total,0.94);          // (0,75×10 + 1×30) / 40 = 0,9375
  assert.equal(f.cultures.find(c=>c.culture==='Maïs grain').herbicide,1);
  assert.equal(f.farm.surface,60);assert.equal(f.farm.total,0.96);    // (7,5 + 30 + 20) / 60
});

test('historique sur 3 campagnes et couleurs', ()=>{
  assert.deepEqual(previousCampaigns('2026/27'),['2026/27','2025/26','2024/25']);
  const h=iftHistory(farm(),'p1','2026/27');
  assert.deepEqual(h.map(x=>[x.campaign,x.total]),[['2026/27',0],['2025/26',0.75],['2024/25',1]]);
  assert.equal(iftColor(0).label,'IFT 0');assert.equal(iftColor(0.5).label,'IFT < 1');assert.equal(iftColor(3.2).label,'IFT ≥ 3');assert.equal(iftColor(null).label,'IFT non calculé');
});
