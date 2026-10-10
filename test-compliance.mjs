// n° 55 — Conformité « Prêt pour un contrôle ? » : voyants indicatifs et dossier imprimable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emptyState} from './state.js';
import {
  complianceChecks,complianceSummary,complianceSettings,controlDossierHtml,dueStatus,addYears,
  previousCampaign,sameCultureStreak,phytoOperators,parcelsPlanSvg,COMPLIANCE_DISCLAIMER
} from './compliance.js';

const TODAY='2026-10-07';
const sq=(x,y,d=.004)=>({type:'Polygon',coordinates:[[[x,y],[x+d,y],[x+d,y+d],[x,y+d],[x,y]]]});
function farm(extra={}){
  const s=emptyState();
  s.exploitation.nom='GAEC des Noues';
  s.parcelles=[
    {id:'p1',nom:'Les Noues',culture:'Blé tendre',surfaceHa:11.3,geometry:sq(5.13,46.34)},
    {id:'p2',nom:'Grand Champ',culture:'Maïs grain',surfaceHa:8.2,geometry:sq(5.14,46.34)},
    {id:'p3',nom:'Le Pré Bas',culture:'Prairie permanente',surfaceHa:4.6}
  ];
  Object.assign(s,extra);
  return s;
}
const byId=(checks,id)=>checks.find(c=>c.id===id);

test('réglages : valeurs par défaut et bornes', ()=>{
  assert.deepEqual(complianceSettings(emptyState()),{zoneVulnerable:false,sprayerControlYears:3,rotationMaxSame:3,warnDays:60,certiphytos:[]});
  const s=farm();s.exploitation.conformite={zoneVulnerable:true,sprayerControlYears:'5',rotationMaxSame:99,warnDays:-3,certiphytos:[{nom:' Paul ',expiresAt:'2027-01-01'},{nom:''}]};
  assert.deepEqual(complianceSettings(s),{zoneVulnerable:true,sprayerControlYears:5,rotationMaxSame:3,warnDays:60,certiphytos:[{nom:'Paul',expiresAt:'2027-01-01'}]});
});

test('échéances et campagnes', ()=>{
  assert.equal(dueStatus('',TODAY,60),'warn');
  assert.equal(dueStatus('2026-10-06',TODAY,60),'ko');
  assert.equal(dueStatus('2026-11-01',TODAY,60),'warn');
  assert.equal(dueStatus('2027-06-01',TODAY,60),'ok');
  assert.equal(addYears('2023-04-12',3),'2026-04-12');
  assert.equal(previousCampaign('2026/27'),'2025/26');
});

test('exploitation vide : rien n’est déclaré « à jour » sans donnée', ()=>{
  const checks=complianceChecks(emptyState(),{today:TODAY});
  assert.equal(checks.length,13); // + registre phyto (n° 62, v5a), entrées azote (n° 63), BCAE 7 (n° 58) et CIPAN (n° 74) de la v5b, carnet sanitaire (n° 76, v6b)
  assert.equal(byId(checks,'herd-health').status,'na');
  assert.equal(byId(checks,'phyto').status,'ok');
  assert.equal(byId(checks,'sprayer').status,'na');
  assert.equal(byId(checks,'nitrogen').status,'na');
  assert.equal(byId(checks,'rotation').status,'unknown');
  assert.equal(byId(checks,'followup').status,'unknown');
  assert.equal(complianceSummary(checks).status,'ok');
});

test('registre phyto : champs essentiels manquants → à corriger, avec lien vers le travail', ()=>{
  const s=farm({interventions:[
    {id:'w1',parcelId:'p1',type:'Désherbage herbicide',date:'2026-09-20',campaignId:'2026/27',status:'Terminé',product:'Produit A',dose:2,doseUnit:'L/ha',amm:'2000123',operator:'Paul',culture:'Blé tendre'},
    {id:'w2',parcelId:'p2',type:'Fongicide',date:'2026-09-21',campaignId:'2026/27',status:'Terminé',operator:'Paul'},
    {id:'w3',parcelId:'p2',type:'Fongicide',date:'2026-10-30',campaignId:'2026/27',status:'À faire'}
  ]});
  const c=byId(complianceChecks(s,{today:TODAY}),'phyto');
  assert.equal(c.status,'ko');
  assert.match(c.detail,/1 traitement incomplet sur 2/);
  assert.deepEqual(c.items.map(i=>[i.action,i.id]),[['edit-work','w2']]);
  assert.match(c.items[0].note,/Produit/);
  // Opérateurs et Certiphyto
  assert.deepEqual(phytoOperators(s,TODAY),['Paul']);
  let cert=byId(complianceChecks(s,{today:TODAY}),'certiphyto');
  assert.equal(cert.status,'warn');assert.match(cert.items[0].note,/non renseignée/);
  s.exploitation.conformite={certiphytos:[{nom:'paul',expiresAt:'2026-09-01'}]};
  cert=byId(complianceChecks(s,{today:TODAY}),'certiphyto');
  assert.equal(cert.status,'ko','certificat expiré');
  s.exploitation.conformite={certiphytos:[{nom:'Paul',expiresAt:'2029-01-01'}]};
  assert.equal(byId(complianceChecks(s,{today:TODAY}),'certiphyto').status,'ok');
  // Pulvérisateur : traitements mais pas de matériel identifié → non suivi.
  assert.equal(byId(complianceChecks(s,{today:TODAY}),'sprayer').status,'unknown');
});

test('pulvérisateur : contrôle périodique selon la périodicité paramétrée', ()=>{
  const s=farm({materiels:[{id:'m1',nom:'Pulvérisateur traîné 24 m',controleDate:'2023-05-01'},{id:'m2',nom:'Tracteur'}]});
  let c=byId(complianceChecks(s,{today:TODAY}),'sprayer');
  assert.equal(c.status,'ko');assert.equal(c.items.length,1);assert.match(c.items[0].note,/01\/05\/2026|2026/);
  s.exploitation.conformite={sprayerControlYears:5};
  c=byId(complianceChecks(s,{today:TODAY}),'sprayer');
  assert.equal(c.status,'ok');
});

test('zone vulnérable : PPF, cahier azote et couverts', ()=>{
  const s=farm({interventions:[
    {id:'r1',parcelId:'p1',type:'Récolte',date:'2026-07-20',campaignId:'2025/26',status:'Terminé'},
    {id:'r2',parcelId:'p2',type:'Moisson',date:'2026-07-25',campaignId:'2025/26',status:'Terminé'},
    {id:'c2',parcelId:'p2',type:'Semis couvert',product:'Moutarde',date:'2026-08-05',campaignId:'2026/27',status:'Terminé'},
    {id:'f1',parcelId:'p1',type:'Fertilisation',product:'Ammonitrate',dose:150,doseUnit:'kg/ha',date:'2026-09-10',campaignId:'2026/27',status:'Terminé'},
    {id:'f2',parcelId:'p2',type:'Épandage lisier',date:'2026-09-12',campaignId:'2026/27',status:'Terminé'}
  ]});
  assert.equal(byId(complianceChecks(s,{today:TODAY}),'covers').status,'na','hors zone vulnérable : non concerné');
  s.exploitation.conformite={zoneVulnerable:true};
  let checks=complianceChecks(s,{today:TODAY});
  const covers=byId(checks,'covers');
  assert.equal(covers.status,'warn');assert.deepEqual(covers.items.map(i=>i.id),['p1']);
  let n=byId(checks,'nitrogen');
  assert.equal(n.status,'ko','PPF absent');assert.match(n.detail,/Aucun plan prévisionnel/);assert.deepEqual(n.items.map(i=>i.id),['f2']);
  s.documents=[{id:'d1',name:'PPF 2026-2027.pdf',category:'Réglementaire',documentDate:'2026-09-01',tags:[]}];
  n=byId(complianceChecks(s,{today:TODAY}),'nitrogen');
  assert.equal(n.status,'warn','PPF présent, un apport incomplet');
});

test('rotation BCAE 7 : seuil paramétrable de campagnes consécutives', ()=>{
  const s=farm({rotations:[
    {id:'r1',parcelId:'p1',campaignId:'2024/25',culture:'Blé tendre'},
    {id:'r2',parcelId:'p1',campaignId:'2025/26',culture:'Blé tendre'},
    {id:'r3',parcelId:'p2',campaignId:'2025/26',culture:'Colza'},
    {id:'r4',parcelId:'p3',campaignId:'2025/26',culture:'Prairie permanente'}
  ]});
  const history=new Map([['2026/27','Blé'],['2025/26','blé'],['2024/25','Orge']]);
  assert.equal(sameCultureStreak(history,'2026/27').streak,2);
  let c=byId(complianceChecks(s,{today:TODAY}),'rotation');
  assert.equal(c.status,'warn');assert.deepEqual(c.items.map(i=>i.id),['p1']);assert.match(c.items[0].note,/3 campagnes consécutives/);
  s.exploitation.conformite={rotationMaxSame:2};
  assert.equal(byId(complianceChecks(s,{today:TODAY}),'rotation').status,'ko');
  s.exploitation.conformite={rotationMaxSame:4};
  assert.equal(byId(complianceChecks(s,{today:TODAY}),'rotation').status,'ok');
});

test('BDNI : jamais déclaré à jour, faute de données', ()=>{
  const s=farm({grazingSessions:[{id:'g1',parcelId:'p3',startDate:'2026-09-01'}]});
  assert.equal(byId(complianceChecks(s,{today:TODAY}),'bdni').status,'unknown');
});

test('dossier de contrôle : sommaire, mention indicative, données échappées', ()=>{
  const s=farm({interventions:[{id:'w1',parcelId:'p1',type:'Herbicide',date:'2026-09-20',campaignId:'2026/27',status:'Terminé',product:'<script>x</script>',dose:1,doseUnit:'L/ha'}],documents:[{id:'d1',name:'Facture semences',category:'Facture',documentDate:'2026-08-01',tags:['semis']}]});
  const html=controlDossierHtml(s,{today:TODAY});
  assert.match(html,/<h1>Dossier de contrôle<\/h1>/);
  assert.match(html,/Sommaire/);
  for(const id of ['etat','phyto','azote','plans','materiel','pieces'])assert.match(html,new RegExp(`id="${id}"`));
  assert.ok(html.includes('ne vaut pas attestation'));
  assert.ok(html.includes(COMPLIANCE_DISCLAIMER.slice(0,40)));
  assert.ok(!html.includes('<script>x</script>'),'contenu saisi échappé');
  assert.match(html,/Facture semences/);
  assert.match(html,/<svg class="plan"/);
  assert.equal(parcelsPlanSvg([{nom:'Sans contour'}]),'');
});

test('accroches : menu Gestion, action et cache hors connexion', ()=>{
  const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
  assert.match(app,/import \{createComplianceUI\} from '\.\/compliance-ui\.js'/);
  assert.match(app,/\['Conformité','Prêt pour un contrôle \?','open-compliance'/);
  assert.match(app,/action==='open-compliance'/);
  const sw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
  for(const file of ['./compliance.js','./compliance-ui.js'])assert.ok(sw.includes(`'${file}'`),file);
});
