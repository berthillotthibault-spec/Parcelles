// n° 59 — Catalogue E-Phy hors connexion : lecture CSV/JSON, filtre par cultures, recherche, âge.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emptyState} from './state.js';
import {
  parseCsv,parseCatalogFile,catalogFromRows,filterForCultures,farmCultures,catalogLookup,searchCatalog,
  catalogStatus,catalogRecord,ephyDate,EPHY_SOURCE,CATALOG_MAX_AGE_DAYS,
  joinEphyProducts,assertCatalogUpdate,countUsages,ephyVersionDate,ephyVersionFromName,shortFrDate
} from './phyto-catalog.js';
import {checkTreatment,withdrawalLabel,phytoSheet} from './phyto.js';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/ephy-fictif.json',import.meta.url),'utf8'));
const CSV=`numero AMM;nom produit;fonctions;Etat d’autorisation;Date de retrait du produit;identifiant usage lib court;dose retenue;dose retenue unite;nombre max d'application;delai avant recolte jour;ZNT aquatique (en m);date fin utilisation\r
9990001;FONGIX FICTIF;Fongicide;AUTORISE;;"Blé*Trt Part.Aer.*Septoriose(s)";1;L/ha;2;35;5;\r
9990003;ANCIEN RETIRE;Insecticide;RETIRE;2025-03-01;Blé*Trt Part.Aer.*Pucerons;0,2;L/ha;2;28;5;2026-09-01\r
`;

test('CSV : séparateur, guillemets et en-têtes', ()=>{
  const rows=parseCsv('a;b\r\n"x;y";"z ""q"""\r\n');
  assert.deepEqual(rows,[{a:'x;y',b:'z "q"'}]);
  assert.equal(parseCsv('a,b\n1,2')[0].b,'2');
  assert.equal(ephyDate('01/03/2025'),'2025-03-01');assert.equal(ephyDate('2025-03-01T00:00'),'2025-03-01');assert.equal(ephyDate('n/a'),'');
});

test('lignes E-Phy → produits groupés par AMM avec usages', ()=>{
  const entries=catalogFromRows(fixture.rows);
  assert.equal(entries.length,4);
  const f=entries.find(e=>e.amm==='9990001');
  assert.equal(f.name,'FONGIX FICTIF');assert.deepEqual(f.otherNames,['FONGIX BIS']);
  assert.equal(f.category,'fongicide');assert.equal(f.usages.length,2);
  assert.deepEqual(f.usages[0],{culture:'Blé',target:'Septoriose(s)',maxDose:1,doseUnit:'L/ha',maxApplications:2,dar:35,zntWater:5});
  assert.equal(f.dar,42);assert.equal(f.zntWater,20);assert.equal(f.dre,24);assert.deepEqual(f.mentions,['abeille']);
  const h=entries.find(e=>e.amm==='9990002');assert.equal(h.category,'herbicide');assert.equal(h.dre,48);assert.ok(h.mentions.includes('cmr'));
  const r=entries.find(e=>e.amm==='9990003');assert.equal(r.withdrawnAt,'2025-03-01');assert.equal(r.useUntil,'2026-09-01');
  assert.equal(f.withdrawnAt,'');
  assert.throws(()=>catalogFromRows([{foo:'1'}]),/numéro AMM/);
});

test('CSV et JSON produisent le même catalogue', ()=>{
  const csv=parseCatalogFile(CSV,{fileName:'ephy.csv'});
  assert.equal(csv.length,2);
  assert.equal(csv.find(e=>e.amm==='9990003').useUntil,'2026-09-01');
  const json=parseCatalogFile(JSON.stringify(fixture),{fileName:'ephy.json'});
  assert.equal(json.length,4);
  const own=parseCatalogFile(JSON.stringify({entries:[{amm:'123',name:'X',usages:[]}]}));
  assert.equal(own[0].amm,'123');
  assert.throws(()=>parseCatalogFile(''),/vide/);
  assert.throws(()=>parseCatalogFile('{"a":1}'),/liste/);
});

test('réduction aux cultures de l’exploitation', ()=>{
  const s=emptyState();s.parcelles=[{id:'p1',culture:'Blé tendre'},{id:'p2',culture:'Maïs grain'},{id:'p3',culture:'Blé tendre',deletedAt:1}];
  const cultures=farmCultures(s);
  assert.deepEqual(cultures,['Blé tendre','Maïs grain']);
  const kept=filterForCultures(catalogFromRows(fixture.rows),cultures);
  assert.deepEqual(kept.map(e=>e.amm).sort(),['9990001','9990002','9990003']);
  assert.equal(kept.find(e=>e.amm==='9990001').usages.length,1);
  assert.equal(kept.find(e=>e.amm==='9990001').dar,35);assert.equal(kept.find(e=>e.amm==='9990001').zntWater,5);
});

test('recherche par AMM, nom ou second nom ; âge et source', ()=>{
  const now=Date.parse('2026-10-08T12:00:00Z');
  const cat=catalogRecord(catalogFromRows(fixture.rows),{now:now-40*864e5,origin:'fichier'});
  const find=catalogLookup(cat);
  assert.equal(find({amm:'9990002'}).name,'HERBANET TEST');
  assert.equal(find({name:'Fongix bis'}).amm,'9990001');
  assert.equal(find({name:'inconnu'}),null);
  assert.equal(searchCatalog(cat,'fongix').length,1);assert.equal(searchCatalog(cat,'99900').length,4);
  const st=catalogStatus(cat,now);
  assert.equal(st.stale,true);assert.equal(st.ageDays,40);assert.match(st.label,/mise à jour conseillée/);
  assert.equal(catalogStatus({...cat,updatedAt:now-2*864e5},now).stale,false);
  assert.equal(catalogStatus(null).present,false);
  assert.equal(CATALOG_MAX_AGE_DAYS,30);
  assert.equal(cat.license,'Licence ouverte Etalab 2.0');assert.equal(cat.source,EPHY_SOURCE.name);
});

test('le catalogue complète la fiche et signale une AMM retirée', ()=>{
  const cat=catalogRecord(catalogFromRows(fixture.rows)),lookup=catalogLookup(cat);
  const s=emptyState();s.parcelles=[{id:'p1',nom:'Les Noues',culture:'Blé tendre',surfaceHa:10}];
  const base={id:'w',parcelId:'p1',type:'Insecticide',isPhytosanitary:true,status:'Terminé',culture:'Blé tendre',target:'Pucerons',startTime:'08:00',endTime:'09:00',doseUnit:'L/ha'};
  const late=checkTreatment(s,{...base,date:'2026-10-01',product:'Ancien retiré',amm:'9990003',dose:0.1},{catalog:lookup});
  assert.deepEqual(late.blocking.map(b=>b.code),['withdrawn']);
  assert.match(late.blocking[0].message,/^AMM retirée le .*2025 : utilisation interdite après le .*2026\.$/);
  const before=checkTreatment(s,{...base,date:'2026-05-01',amm:'9990003',product:'',dose:0.1},{catalog:lookup});
  assert.deepEqual(before.blocking,[]);assert.ok(before.warnings.some(w=>w.code==='withdrawn'));
  const dose=checkTreatment(s,{...base,type:'Fongicide',product:'FONGIX FICTIF',amm:'',target:'Septoriose',dose:1.2,date:'2026-04-01'},{catalog:lookup});
  assert.deepEqual(dose.blocking.map(b=>b.code),['dose']);assert.equal(dose.sheet.source,'catalogue');assert.equal(dose.sheet.dre,24);
  // la fiche saisie par l'exploitant prime sur le catalogue
  s.stockItems=[{id:'s',name:'Fongix fictif',phyto:{amm:'9990001',maxDose:2,doseUnit:'L/ha'}}];
  const own=checkTreatment(s,{...base,type:'Fongicide',product:'Fongix fictif',amm:'9990001',target:'Rouille',dose:1.5,date:'2026-04-01'},{catalog:lookup});
  assert.deepEqual(own.blocking,[]);assert.equal(own.sheet.source,'fiche');assert.equal(own.sheet.dre,24);
  assert.match(withdrawalLabel(phytoSheet(lookup({amm:'9990003'}))),/AMM retirée/);
});

// Extrait réel du jeu public E-Phy (data.gouv, publication du 10/11/2026, Licence ouverte Etalab 2.0).
// Embarqué en chaîne : test-static.mjs refuse tout .csv publié hors fixture autorisée.
const REAL_USAGES=`numero AMM;nom produit;identifiant usage; date decision;stade cultural min (BBCH);tade cultural max (BBCH);etat usage;dose retenue;dose retenue unite;delai avant recolte jour;delai avant recolte bbch;nombre max d'application;date fin distribution;date fin utilisation;condition emploi;ZNT aquatique (en m);ZNT arthropodes non cibles (en m);ZNT plantes non cibles (en m);mentions autorisees;intervalle minimum entre applications (jour);
9400336;TYRAN;Blé*Trt Part.Aer.*Régul. Croiss. Org. Aériens;21/06/2019;25;33;Autorisé;2.0;L/ha;;;1;;;Uniquement sur blé tendre d'hiver.;5.0;;;;;
2150870;GLOBUS;Blé*Désherbage;19/10/2023;11;20;Autorisé;0.08;L/ha;;;1;;;Uniquement sur blé d'hiver pour une application avant repos végétatif. 1 application maximum par an et par culture. Limitation de la période d'application entre les stades BBCH 11 et BBCH 20 pour protéger les eaux souterraines et les organismes aquatiques.;20.0;;5.0;;;
2150870;GLOBUS;Orge*Désherbage;19/10/2023;11;20;Autorisé;0.08;L/ha;;;1;;;Uniquement sur orge d'hiver pour une application avant repos végétatif. 1 application maximum par an et par culture. Limitation de la période d'application entre les stades BBCH 11 et BBCH 20 pour protéger les eaux souterraines et les organismes aquatiques.;20.0;;5.0;;;
8800006;DIMATE BF 400;Artichaut*Trt Part.Aer.*Pucerons;26/09/2012;;;Retrait;0.6;L/ha;;;3;31/03/2013;31/03/2014;;;;;;;
`;
const REAL_PRODUCTS=`type produit;numero AMM;nom produit;seconds noms commerciaux;titulaire;type commercial;gamme usage;mentions autorisees;restrictions usage;restrictions usage libelle;Substances actives;fonctions;formulations;Etat d’autorisation;Date de retrait du produit;Date de première autorisation;Numéro AMM du produit de référence;Nom du produit de référence;
PPP;8800006;DIMATE BF 400;DANADIM PROGRESS | DANADIM SUPER | ROGOR PLUS;CHEMINOVA AGRO FRANCE SAS;Produit de référence;Professionnel;;;;diméthoate (Dimethoate) 400.0 g/L | diméthoate (Dimethoate) 400.0 g/L;Insecticide;Concentré émulsionnable;RETIRE;01/02/2016;01/02/1988;;;
PPP;9400336;TYRAN;REGUS SC;TAMINCO BV;Produit de référence;Professionnel;;;;chlorure de chlorméquat (Chlormequat) 460.0 g/L;Régulateur de croissance;Concentré soluble;AUTORISE;;01/04/1997;;;
PPP;2150870;GLOBUS;RACKAM;GLOBACHEM NV;Produit de référence;Professionnel;;;;florasulame (Florasulam) 50.0 g/L;Herbicide;Suspension concentrée;AUTORISE;;15/12/2015;9800277;PRIMUS;
`;

test('fichier officiel actuel : en-tête « identifiant usage » et jointure avec les produits', ()=>{
  const usagesOnly=parseCatalogFile(REAL_USAGES,{fileName:'produits_usages_utf8.csv'});
  assert.ok(countUsages(usagesOnly)>0,'usages non vides');
  const tyran=usagesOnly.find(e=>e.amm==='9400336');
  assert.equal(tyran.usages[0].culture,'Blé');assert.equal(tyran.usages[0].maxDose,2);assert.equal(tyran.usages[0].zntWater,5);
  // usage « Retrait » d'un produit non retiré : ignoré
  assert.equal(usagesOnly.find(e=>e.amm==='8800006')?.usages.length??0,0);
  const kept=filterForCultures(usagesOnly,['Blé tendre']);
  assert.ok(kept.length>=1);assert.deepEqual(kept.map(e=>e.name).sort(),['GLOBUS','TYRAN']);
  assert.equal(kept.find(e=>e.name==='GLOBUS').usages.length,1,'orge écartée');
  const joined=parseCatalogFile(REAL_USAGES,{fileName:'produits_usages_utf8.csv',productsText:REAL_PRODUCTS});
  const dimate=joined.find(e=>e.amm==='8800006');
  assert.equal(dimate.withdrawnAt,'2016-02-01');assert.equal(dimate.category,'insecticide');assert.ok(dimate.usages.length>=1);
  assert.deepEqual(dimate.otherNames,['DANADIM PROGRESS','DANADIM SUPER','ROGOR PLUS']);
  assert.equal(joined.find(e=>e.amm==='2150870').category,'herbicide');
  assert.equal(joined.find(e=>e.amm==='2150870').holder,'GLOBACHEM NV');
  assert.deepEqual(joinEphyProducts([],parseCsv(REAL_PRODUCTS)),[]);
});

test('garde d’enregistrement : catalogue vide ou chute de plus de 50 % refusés', ()=>{
  const prev=catalogRecord(catalogFromRows(fixture.rows));
  const before=countUsages(prev);assert.ok(before>=4);
  assert.throws(()=>assertCatalogUpdate(prev,[]),/aucun usage/);
  assert.throws(()=>assertCatalogUpdate(prev,[{amm:'1',usages:[]}]),/aucun usage/);
  const one=[{amm:'1',usages:[{culture:'Blé'}]}];
  assert.throws(()=>assertCatalogUpdate(prev,one),/baisse de plus de 50 %/);
  assert.equal(assertCatalogUpdate(prev,one,{allowShrink:true}).usages,1);
  assert.equal(assertCatalogUpdate(null,one).usages,1,'premier catalogue');
  assert.equal(assertCatalogUpdate(prev,prev.entries).usages,before);
});

test('version E-Phy : enregistrement, âge depuis la publication', ()=>{
  assert.equal(ephyVersionDate('20261110'),'2026-11-10');assert.equal(ephyVersionDate('20261340'),'');
  assert.equal(ephyVersionFromName('decisionamm-intrant-format-csv-20261110-utf8.zip'),'20261110');assert.equal(ephyVersionFromName('ephy.csv'),'');
  const now=Date.parse('2026-11-12T10:00:00');
  assert.equal(shortFrDate('2026-11-10',now),'10/11');assert.equal(shortFrDate('2025-11-10',now),'10/11/2025');
  const rec=catalogRecord(catalogFromRows(fixture.rows),{now,origin:'auto',sourceVersion:'20261110'});
  assert.equal(rec.sourceVersion,'20261110');assert.equal(rec.sourceDate,'2026-11-10');assert.equal(rec.checkedAt,now);
  const st=catalogStatus(rec,now);
  assert.equal(st.ageDays,2);assert.match(st.label,/^Source E-Phy du 10\/11 \(il y a 2 j\)/);assert.equal(st.stale,false);
  const old=catalogStatus({...rec,updatedAt:now,sourceDate:'2026-09-01'},now);
  assert.equal(old.stale,true,'import récent d’une publication ancienne : mise à jour conseillée');
  assert.equal(catalogRecord([],{sourceVersion:'abc'}).sourceVersion,'');
});

test('catalogue à la dernière publication E-Phy : pas de « mise à jour conseillée » même ancien', ()=>{
  const now=Date.parse('2026-12-31T12:00:00');
  const rec=catalogRecord([{amm:'1',name:'X',usages:[{culture:'Blé'}]}],{sourceVersion:'20261110',now});
  assert.equal(catalogStatus(rec,now).stale,true);
  const st=catalogStatus(rec,now,{latestVersion:'20261110'});
  assert.equal(st.stale,false);assert.doesNotMatch(st.label,/conseillée/);
  assert.equal(catalogStatus(rec,now,{latestVersion:'20261201'}).stale,true);
  assert.equal(catalogStatus({...rec,sourceVersion:''},now,{latestVersion:'20261110'}).stale,true);
});
