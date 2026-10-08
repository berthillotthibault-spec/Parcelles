import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {emptyState} from './state.js';
import {DOSSIER_PRESETS,DOSSIER_SECTIONS,campaignShift,cascade,chargesDetail,dossierCampaigns,dossierHtml,dossierModel,parcelMapSvg,stockAt,stockDate,yieldsByParcel,assolement,expectedReceipts} from './dossier.js';
import {pilotageReportHtml,farmReportHtml} from './reports.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const C='2025/26',TODAY=new Date('2026-10-07T10:00:00');
const sq=(x,y,d=.004)=>({type:'Polygon',coordinates:[[[x,y],[x+d,y],[x+d,y+d*.7],[x,y+d*.7],[x,y]]]});

function farm(){
  const s=emptyState();s.exploitation={...s.exploitation,nom:'EARL du Sougey',commune:'Montrevel'};
  s.parcelles=[
    {id:'p1',nom:'Les Noues',culture:'Blé tendre',surfaceHa:10,geometry:sq(5.13,46.34),economicsByCampaign:{[C]:{yield:8,salePrice:180},'2024/25':{yield:7,salePrice:200}}},
    {id:'p2',nom:'La Côte',culture:'Colza',surfaceHa:5,geometry:{type:'MultiPolygon',coordinates:[sq(5.14,46.34).coordinates]}},
    {id:'p3',nom:'Louée',culture:'Maïs',surfaceHa:7,ownershipType:'client'}
  ];
  s.rotations=[{id:'r1',parcelId:'p2',campaignId:C,culture:'Orge'}];
  s.interventions=[
    {id:'w1',parcelId:'p1',type:'Semis',date:'2025-10-10',status:'Terminé',cost:3000,inputCost:2000,machineCost:800},
    {id:'w2',parcelId:'p1',type:'Désherbage',date:'2026-03-10',status:'Terminé'},
    {id:'w3',parcelId:'p2',type:'Semis',date:'2025-10-12',status:'Terminé',cost:400,costSource:'estimé',costEstimate:{value:400,method:'type'}},
    {id:'w4',parcelId:'p1',type:'Semis',date:'2024-10-10',status:'Terminé',cost:2500},
    {id:'w5',parcelId:'p1',type:'Labour',date:'2025-09-01',status:'Annulé',cost:999}
  ];
  s.materiels=[{id:'m1',nom:'Tracteur',insurance:600,amortization:900}];
  s.stockItems=[{id:'s1',name:'Ammonitrate',unit:'kg',quantity:300,unitPrice:0.5},{id:'s2',name:'Semence',unit:'dose',quantity:4}];
  s.stockMovements=[{id:'mv1',stockItemId:'s1',date:'2026-03-01',delta:-200,balanceAfter:300},{id:'mv2',stockItemId:'s1',date:'2025-11-01',delta:500,balanceAfter:500}];
  s.integrationImports=[
    {id:'lot1',farmKind:'harvest',code:'BT-1',parcelId:'p1',date:'2026-07-10',quantity:70,unit:'t',humidity:14.5,silo:'S2',sales:[{id:'sa1',buyer:'Négoce Martin',quantity:20,price:210}]},
    {id:'k1',farmKind:'salesContract',culture:'Blé tendre',campaign:C,buyer:'Coop Bresse',type:'ferme',tonnes:30,price:200,premium:5,paymentDate:'2026-12-15'}
  ];
  return s;
}

test('campagnes proposées : actuelle, deux précédentes et celles des données',()=>{
  assert.equal(campaignShift('2025/26',-1),'2024/25');assert.equal(campaignShift('2099/00',1),'2100/01');
  const list=dossierCampaigns(farm(),TODAY);assert.equal(list[0],'2026/27');assert.ok(list.includes('2024/25')&&list.includes('2025/26'));
  assert.deepEqual([...list].sort().reverse(),list,'ordre décroissant');
});

test('assolement : rotation de la campagne, parcelles en propre seulement',()=>{
  const a=assolement(farm(),C);assert.equal(a.total,15);assert.deepEqual(a.rows.map(r=>r.culture),['Blé tendre','Orge']);assert.ok(Math.abs(a.rows[0].share-2/3)<1e-9);
});

test('cascade : produit, charges, marge brute, structure, marge après structure',()=>{
  const m=dossierModel(farm(),{campaign:C,today:TODAY}),s=m.cascade;
  assert.equal(m.pilotage.grossProduct,14400);assert.equal(m.pilotage.charges,3400);
  assert.equal(s.steps.length,5);assert.equal(s.steps[2].value,11000);assert.equal(Math.round(s.structure),1500);assert.equal(Math.round(s.net),9500);
  const empty=cascade({grossProduct:0,charges:0,margin:0},{rows:[]});assert.equal(empty.net,0);
});

test('charges détaillées : ventilation, travaux sans coût et coûts estimés distingués',()=>{
  const c=chargesDetail(farm(),C);
  assert.equal(c.unknown,1,'désherbage sans coût');assert.equal(c.estimatedCount,1);assert.equal(c.estimated,400);
  const by=Object.fromEntries(c.lines.map(l=>[l.id,l.value]));assert.equal(by.seed,2000);assert.equal(by.machine,800);assert.equal(by.unsplit,600);
  assert.equal(Math.round(c.total),3400);assert.ok(!c.byType.some(t=>t.label==='Labour'),'travail annulé exclu');
  const semis=c.byType.find(t=>t.label==='Semis');assert.equal(semis.count,2);assert.equal(semis.cost,3400);
});

test('stocks à une date : mouvements postérieurs retirés, valorisation au prix actuel',()=>{
  const s=stockAt(farm(),'2025-12-31');const a=s.rows.find(r=>r.id==='s1');assert.equal(a.quantity,500);assert.equal(a.value,250);assert.equal(s.unpriced,1);
  assert.equal(stockAt(farm(),'2026-10-01').rows.find(r=>r.id==='s1').quantity,300);
  const odd=farm();odd.stockMovements.push({id:'mv3',stockItemId:'s1',date:'2026-05-01'});assert.ok(stockAt(odd,'2025-12-31').uncertain);
  assert.equal(stockDate('2025/26',TODAY),'2025-12-31');assert.equal(stockDate('2026/27',TODAY),'2026-10-07','31/12 pas encore passé : aujourd’hui');
});

test('rendements par parcelle et encaissements attendus',()=>{
  const y=yieldsByParcel(farm(),C).find(r=>r.parcel.id==='p1');assert.equal(y.real,7);assert.equal(y.planned,8);assert.equal(y.lots,1);
  const none=yieldsByParcel(farm(),C).find(r=>r.parcel.id==='p2');assert.equal(none.real,null);
  const r=expectedReceipts(farm(),C);assert.equal(r.length,1);assert.equal(r[0].amount,30*205);assert.equal(r[0].date,'2026-12-15');
});

test('carte miniature SVG : polygones et multipolygones, rien sans géométrie',()=>{
  const svg=parcelMapSvg(farm().parcelles.slice(0,2),()=>'#123456');
  assert.match(svg,/^<svg class="dz-map"/);assert.equal((svg.match(/<path /g)||[]).length,2);assert.match(svg,/aria-label="Carte des 2 parcelles"/);
  assert.equal(parcelMapSvg([{id:'x',nom:'Sans'}],()=>'#000'),'');
});

test('dossier HTML : préréglages, gabarit A4, couverture, sommaire et mentions indicatives',()=>{
  for(const p of DOSSIER_PRESETS){
    const html=dossierHtml(farm(),{campaign:C,preset:p.id,today:TODAY});
    assert.match(html,/^<!doctype html><html lang="fr">/);assert.match(html,/@page\{size:A4/);assert.match(html,/counter\(pages\)/);assert.match(html,/break-inside:avoid/);
    assert.match(html,/Instrument Serif/);assert.equal((html.match(/<section class="page/g)||[]).length,p.sections.length+1,`${p.id} : une page par partie plus la couverture`);
    assert.match(html,new RegExp(`Dossier de campagne · ${p.label}`));assert.match(html,/EARL du Sougey/);assert.match(html,/indicati/);
    assert.ok(!/NaN|undefined|Infinity/.test(html),`${p.id} : aucune valeur invalide`);
  }
  const bank=dossierHtml(farm(),{campaign:C,preset:'banque',today:TODAY,signer:'Jean <Dupont>'});
  assert.match(bank,/Du produit à la marge/);assert.match(bank,/Historique sur trois campagnes/);assert.match(bank,/Encaissements attendus/);assert.match(bank,/Jean &lt;Dupont&gt;/);
  assert.match(bank,/Fait à Montrevel/);assert.match(bank,/2 travaux réalisés sans coût|1 travail réalisé sans coût/);
  const coop=dossierHtml(farm(),{campaign:C,preset:'cooperative',today:TODAY});assert.match(coop,/BT-1/);assert.match(coop,/14,5 %/);
  const gestion=dossierHtml(farm(),{campaign:C,preset:'gestion',today:TODAY});assert.match(gestion,/Stocks au 31\/12\/2025/);assert.match(gestion,/Semences/);
  const custom=dossierHtml(farm(),{campaign:C,preset:'banque',sections:['stocks','inconnue'],today:TODAY});assert.equal((custom.match(/<section class="page/g)||[]).length,2);
  assert.match(dossierHtml(farm(),{assetBase:'https://exemple.test/app/',today:TODAY}),/url\('https:\/\/exemple\.test\/app\/instrument-serif-latin\.woff2'\)/);
});

test('dossier sur une exploitation vide : pas d’erreur ni de valeur inventée',()=>{
  const html=dossierHtml(emptyState(),{today:TODAY});assert.match(html,/Mon exploitation/);assert.match(html,/carte miniature n’est pas disponible/);assert.ok(!/NaN|undefined|Infinity/.test(html));
  assert.equal(DOSSIER_SECTIONS.length,11);
});

test('rapports existants : même gabarit A4, sans bouton dupliqué',()=>{
  const html=pilotageReportHtml(farm(),C);assert.match(html,/Marge brute estimée/i);assert.match(html,/@page\{size:A4/);assert.equal((html.match(/id="print"/g)||[]).length,1);
  assert.equal((farmReportHtml(farm()).match(/id="print"/g)||[]).length,1);
});

test('fichiers servis : dossier.js et dossier-ui.js en cache, accroches dans app.js',()=>{
  const sw=read('sw.js');for(const f of ['./dossier.js','./dossier-ui.js'])assert.ok(sw.includes(`'${f}'`),`${f} dans CORE`);
  const app=read('app.js');assert.match(app,/data-action="open-dossier"/);assert.match(app,/action==='open-dossier'/);
  assert.match(read('design-v3.css'),/n° 83/);
});
