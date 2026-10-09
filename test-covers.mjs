// n° 74 — Couverts et intercultures en zone vulnérable (CIPAN).
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {
  COVER_DEFAULTS,coverSettings,normalizeInterculture,intercultureError,hasCover,minDestructionDate,coverRows,coverAlerts,
  coveredParcelIds,coverComplianceChecks
} from './covers.js';
import {parcelPlan} from './nitrogen.js';
import {bcae6Summary,ecoRegime} from './pac.js';
import {complianceChecks} from './compliance.js';

const TODAY='2026-10-08',C='2026/27';
const rot=(parcelId,campaignId,culture,extra={})=>({id:`r-${parcelId}-${campaignId}`,parcelId,campaignId,culture,...extra});
function farm(){
  const s=emptyState();
  s.exploitation.conformite={zoneVulnerable:true};
  s.parcelles=[
    {id:'p1',nom:'Grand Champ',culture:'Maïs grain',surfaceHa:10},
    {id:'p2',nom:'Les Noues',culture:'Blé tendre',surfaceHa:10},
    {id:'p3',nom:'Hors zone',culture:'Tournesol',surfaceHa:5,zoneVulnerable:false}
  ];
  return s;
}

test('réglages : dates par défaut, paramétrables et bornées', ()=>{
  assert.deepEqual(coverSettings(emptyState()),COVER_DEFAULTS);
  const s=emptyState();s.exploitation.couverts={minDestruction:'11-15',minDays:'45'};
  assert.deepEqual(coverSettings(s),{minDestruction:'11-15',minDays:45});
  s.exploitation.couverts={minDestruction:'13-40',minDays:900};
  assert.deepEqual(coverSettings(s),COVER_DEFAULTS);
  assert.equal(minDestructionDate(C),'2026-11-01');
  assert.equal(minDestructionDate(C,{minDestruction:'01-15'}),'2027-01-15');
});

test('interculture : champs facultatifs normalisés et erreurs de saisie', ()=>{
  assert.equal(normalizeInterculture({}),null);
  assert.equal(normalizeInterculture({legumineuse:'true'}),null);
  assert.deepEqual(normalizeInterculture({especes:' Moutarde ',semisDate:'2026-08-20',destructionMode:'Broyage',destructionDate:'bad',legumineuse:'false'}),
    {especes:'Moutarde',semisDate:'2026-08-20',destructionMode:'Broyage',destructionDate:'',legumineuse:false});
  assert.match(intercultureError(normalizeInterculture({semisDate:'2026-08-20'})),/espèces/);
  assert.match(intercultureError({especes:'Vesce',semisDate:'2026-09-01',destructionDate:'2026-08-01'}),/précéder/);
  assert.equal(intercultureError(null),'');
  assert.equal(hasCover({interculture:{especes:'Phacélie'}}),true);
  assert.equal(hasCover({interculture:{semisDate:'2026-08-01'}}),false);
});

test('alertes : culture de printemps en zone vulnérable sans couvert, destruction précoce', ()=>{
  const s=farm();
  let alerts=coverAlerts(s,{today:TODAY});
  assert.deepEqual(alerts.map(a=>[a.kind,a.parcel.id,a.campaign]),[['missing','p1',C]]); // p2 culture d’hiver, p3 hors zone
  s.rotations=[rot('p1',C,'Maïs grain',{interculture:{especes:'Moutarde',semisDate:'2026-08-25',destructionDate:'2026-10-15',destructionMode:'Broyage'}}),
    rot('p2','2027/28','Tournesol')];
  alerts=coverAlerts(s,{today:TODAY});
  assert.deepEqual(alerts.map(a=>[a.kind,a.parcel.id,a.campaign]),[['early','p1',C],['missing','p2','2027/28']]);
  s.rotations[0].interculture.destructionDate='2026-11-05';
  s.exploitation.couverts={minDays:90};
  assert.match(coverAlerts(s,{today:TODAY})[0].text,/72 jours/);
  const rows=coverRows(s,C,{today:TODAY});
  assert.equal(rows.find(r=>r.parcel.id==='p1').interculture.especes,'Moutarde');
});

test('conformité : entrée CIPAN ajoutée', ()=>{
  const s=farm();
  assert.equal(coverComplianceChecks(s,{today:TODAY})[0].status,'warn');
  assert.ok(complianceChecks(s,{today:TODAY}).some(c=>c.id==='cipan'));
  s.exploitation.conformite.zoneVulnerable=false;
  assert.equal(coverComplianceChecks(s,{today:TODAY})[0].status,'na');
});

test('le couvert compte dans le PPF, la BCAE 6 et l’éco-régime', ()=>{
  const s=farm();
  const before=parcelPlan(s,s.parcelles[0],C,{today:TODAY}).besoin;
  s.rotations=[rot('p1',C,'Maïs grain',{ppf:{rsh:20},interculture:{especes:'Vesce, avoine',legumineuse:true,semisDate:'2026-08-25'}})];
  const plan=parcelPlan(s,s.parcelles[0],C,{today:TODAY});
  assert.equal(plan.cover.effect,20);
  assert.equal(plan.dose,before-20-40-20);
  assert.deepEqual([...coveredParcelIds(s,C)],['p1']);
  const b6=bcae6Summary(s,C,{today:TODAY});
  assert.equal(b6.coveredArea,20);  // blé d’hiver + maïs avec couvert
  assert.deepEqual(b6.uncovered.map(r=>r.parcel.id),['p3']);
  const eco=ecoRegime(s,C,{today:TODAY});
  assert.equal(eco.cover.points,1);
  assert.equal(eco.cover.area,10);
});
