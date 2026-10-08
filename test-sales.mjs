import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,emptyState,migrateData} from './state.js';
import {CONTRACT_KIND,commercialisation,contractProgress,contractsForLot,validateContract,saveContract,deleteContract,linkSale,linkableSales,setMarginTarget,toTonnes,pricePerTonne,contractPrice} from './sales.js';
import {salesBar} from './sales-ui.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
class MemoryStorage{constructor(){this.value=null;}async init(){}async get(){return this.value;}async set(_k,v){this.value=structuredClone(v);}async backupPut(){}async pruneBackups(){}async blobDelete(){}}
const C='2025/26';

function farm(){
  const s=emptyState();
  s.parcelles=[{id:'p1',nom:'Les Noues',culture:'Blé tendre',surfaceHa:10,economicsByCampaign:{[C]:{yield:8,salePrice:180}}},{id:'p2',nom:'La Côte',culture:'Colza',surfaceHa:4}];
  s.interventions=[{id:'w1',parcelId:'p1',type:'Semis',date:'2025-10-10',status:'Terminé',cost:3000,version:1}];
  s.integrationImports=[
    {id:'lot1',farmKind:'harvest',code:'BT-1',parcelId:'p1',date:'2026-07-10',quantity:40,unit:'t',sales:[{id:'s1',date:'2026-07-15',buyer:'Négoce Martin',quantity:20,price:210},{id:'s2',date:'2026-07-20',buyer:'Coop',quantity:10,price:null,contractId:'k1'}],version:1},
    {id:'lot2',farmKind:'harvest',code:'CZ-1',parcelId:'p2',date:'2026-07-01',quantity:8000,unit:'kg',sales:[{id:'s3',date:'2026-07-02',buyer:'Coop',quantity:2000,price:0.45}],version:1},
    {id:'k1',farmKind:CONTRACT_KIND,culture:'Blé tendre',campaign:C,buyer:'Coop',type:'ferme',tonnes:40,price:205,premium:5,version:1},
    {id:'k2',farmKind:CONTRACT_KIND,culture:'blé tendre',campaign:C,buyer:'Négoce',type:'a-fixer',tonnes:10,price:null,version:1},
    {id:'k3',farmKind:CONTRACT_KIND,culture:'Blé tendre',campaign:'2024/25',buyer:'Ancien',type:'ferme',tonnes:99,price:150,version:1},
  ];
  return s;
}

test('conversions d’unités : quantité et prix ramenés à la tonne',()=>{
  assert.equal(toTonnes(2000,'kg'),2);assert.equal(toTonnes(50,'q'),5);assert.equal(toTonnes(3,'t'),3);assert.equal(toTonnes(0,'t'),null);assert.equal(toTonnes(3,'L'),null);
  assert.equal(pricePerTonne(0.45,'kg'),450);assert.equal(pricePerTonne(21,'q'),210);assert.equal(pricePerTonne('',''),null);
  assert.equal(contractPrice({price:205,premium:5}),210);assert.equal(contractPrice({price:null,premium:5}),null);
});

test('commercialisation : part vendue, prix moyen sécurisé, reste à vendre et produit brut par priorité',()=>{
  const r=commercialisation(farm(),{campaign:C,targetHa:null}),ble=r.rows.find(x=>x.key==='ble tendre');
  assert.ok(ble,'la culture du blé est présente');
  assert.equal(ble.volume,80);assert.equal(ble.volumeSource,'estimate');assert.equal(ble.harvested,40);
  assert.equal(ble.sold,30,'20 t vendues + 10 t livrées au contrat');
  assert.equal(ble.soldAmount,20*210+10*210,'une vente sans prix reliée à un contrat ferme prend le prix du contrat (prime comprise)');
  assert.equal(ble.firmTonnes,30);assert.equal(ble.unpricedTonnes,10);assert.equal(ble.contracted,40);
  assert.equal(ble.engaged,70);assert.equal(ble.share,70/80);assert.equal(ble.remaining,10);
  assert.equal(ble.averagePrice,210);
  assert.equal(ble.grossProduct,6300+6300+20*180,'ventes, puis contrats, puis prix estimé sur le reste et le tonnage à fixer');
  assert.deepEqual(ble.sources.map(s=>s.id),['sales','contracts','estimate']);
  assert.equal(ble.requiredPrice<0,true);assert.equal(ble.targetReached,true);
  assert.equal(ble.contracts.length,2,'le contrat d’une autre campagne est exclu');
  const colza=r.rows.find(x=>x.key==='colza');assert.equal(colza.sold,2);assert.equal(colza.averagePrice,450);assert.equal(colza.volume,8,'sans rendement prévu, le volume vient des lots');assert.equal(colza.volumeSource,'lots');
});

test('prix nécessaire sur le reste pour atteindre l’objectif de marge',()=>{
  const ble=commercialisation(farm(),{campaign:C,targetHa:1000}).rows.find(x=>x.key==='ble tendre');
  // Charges 3 000 € + objectif 1 000 €/ha × 10 ha − 12 600 € déjà connus, sur 20 t sans prix.
  assert.equal(ble.requiredPrice,(3000+10000-12600)/20);assert.equal(ble.targetReached,false);
});

test('sans prix estimé, le tonnage non valorisé est signalé au lieu d’être compté à 0 €',()=>{
  const s=farm();s.parcelles[0].economicsByCampaign[C].salePrice=null;
  const ble=commercialisation(s,{campaign:C}).rows.find(x=>x.key==='ble tendre');
  assert.equal(ble.missingTonnes,20);assert.equal(ble.partial,true);assert.equal(ble.grossProduct,12600);
});

test('engagement supérieur au volume : reste nul et dépassement signalé',()=>{
  const s=farm();s.integrationImports.push({id:'k4',farmKind:CONTRACT_KIND,culture:'Blé tendre',campaign:C,buyer:'Gros',type:'ferme',tonnes:50,price:200,version:1});
  const ble=commercialisation(s,{campaign:C}).rows.find(x=>x.key==='ble tendre');assert.equal(ble.remaining,0);assert.equal(ble.overCommitted,40);
});

test('avancement d’un contrat et ventes reliables',()=>{
  const s=farm(),k1=s.integrationImports.find(x=>x.id==='k1'),p=contractProgress(s,k1);
  assert.equal(p.delivered,10);assert.equal(p.open,30);assert.equal(p.share,.25);assert.equal(p.firm,true);
  assert.deepEqual(linkableSales(s,k1).map(r=>r.sale.id),['s1']);
  assert.deepEqual(contractsForLot(s,s.integrationImports[0]).map(c=>c.id).sort(),['k1','k2']);
  assert.deepEqual(contractsForLot(s,s.integrationImports[1]),[]);
});

test('validation du contrat : champs obligatoires et prix ferme exigé',()=>{
  assert.equal(validateContract({culture:'',buyer:'X',campaign:C,tonnes:5}).error,'Champ obligatoire : Culture');
  assert.equal(validateContract({culture:'Blé',buyer:'',campaign:C,tonnes:5}).error,'Champ obligatoire : Acheteur');
  assert.equal(validateContract({culture:'Blé',buyer:'X',campaign:C,tonnes:'',type:'ferme'}).error,'Champ obligatoire : Tonnage (t)');
  assert.equal(validateContract({culture:'Blé',buyer:'X',campaign:C,tonnes:5,type:'ferme'}).error,'Champ obligatoire : Prix (€/t)');
  assert.match(validateContract({culture:'Blé',buyer:'X',campaign:C,tonnes:-2,type:'a-fixer'}).error,/supérieure à 0/);
  const ok=validateContract({culture:' Blé ',buyer:'Coop',campaign:C,tonnes:'12,5',type:'a-fixer',price:'',premium:'0',deliveryDate:'2026-07-15'});
  assert.deepEqual({...ok.value},{culture:'Blé',campaign:C,buyer:'Coop',type:'a-fixer',tonnes:12.5,price:null,premium:null,deliveryDate:'2026-07-15',paymentDate:null,reference:'',note:''});
  assert.equal(validateContract({culture:'Blé',buyer:'X',campaign:C,tonnes:5,type:'troc'}).error,'Type de contrat invalide.');
});

test('écritures : contrat enregistré comme enregistrement d’exploitation, versions, liaison et suppression réversible',async()=>{
  const store=new Store(new MemoryStorage());await store.init();await store.setPreferences({autoBackup:false});
  const s=farm();await store.upsertMany('parcelles',s.parcelles);await store.upsertMany('integrationImports',s.integrationImports.filter(x=>x.farmKind==='harvest'));
  const saved=await saveContract(store,{culture:'Blé tendre',campaign:C,buyer:'Coop',type:'ferme',tonnes:'30',price:'200'});
  const stored=store.get('integrationImports',saved.id);assert.equal(stored.farmKind,CONTRACT_KIND);assert.equal(stored.tonnes,30);assert.equal(store.snapshot().version,emptyState().version,'aucun changement de schéma');
  await saveContract(store,{culture:'Blé tendre',campaign:C,buyer:'Coop',type:'ferme',tonnes:'35',price:'200'},stored);
  await assert.rejects(saveContract(store,{culture:'Blé tendre',campaign:C,buyer:'Coop',type:'ferme',tonnes:'40',price:'200'},stored),/changé entre-temps/);
  assert.equal(store.get('integrationImports',saved.id).tonnes,35);
  await linkSale(store,{lotId:'lot1',saleId:'s1',contractId:saved.id});
  assert.equal(store.get('integrationImports','lot1').sales.find(x=>x.id==='s1').contractId,saved.id);
  assert.equal(store.get('integrationImports','lot1').sales.length,2,'les autres ventes du lot sont conservées');
  await assert.rejects(linkSale(store,{lotId:'lot2',saleId:'s3',contractId:saved.id}),/ne correspond pas/);
  await deleteContract(store,saved.id);assert.ok(store.snapshot().integrationImports.find(x=>x.id===saved.id).deletedAt);
  assert.equal(store.get('integrationImports','lot1').sales.find(x=>x.id==='s1').quantity,20,'la vente reste intacte après suppression du contrat');
  assert.equal(commercialisation(store.snapshot(),{campaign:C}).rows.find(x=>x.key==='ble tendre').contracted,0);
  await store.restore('integrationImports',saved.id);assert.equal(commercialisation(store.snapshot(),{campaign:C}).rows.find(x=>x.key==='ble tendre').contracted,15);
  await linkSale(store,{lotId:'lot1',saleId:'s1',contractId:null});assert.equal(store.get('integrationImports','lot1').sales.find(x=>x.id==='s1').contractId,null);
  await setMarginTarget(store,'250');assert.equal(store.snapshot().preferences.salesMarginTargetHa,250);
  await assert.rejects(setMarginTarget(store,'-5'),/invalide/);
});

test('lecture seule : aucun contrat écrit sans droit',async()=>{
  const store=new Store(new MemoryStorage());await store.init();store.writeGuard=()=>false;
  await assert.rejects(saveContract(store,{culture:'Blé',campaign:C,buyer:'X',type:'ferme',tonnes:1,price:1}),/rôle/);
});

test('anciennes sauvegardes : ventes sans contrat migrées telles quelles et exploitées',()=>{
  const old=farm();old.integrationImports=old.integrationImports.filter(x=>x.farmKind==='harvest');old.integrationImports[0].sales=[{date:'2026-07-15',buyer:'X',quantity:'5',price:'200'}];
  const migrated=migrateData(old),r=commercialisation(migrated,{campaign:C}).rows.find(x=>x.key==='ble tendre');
  assert.equal(r.sold,5);assert.equal(r.averagePrice,200);assert.equal(r.contracted,0);
});

test('barre de commercialisation accessible et publication',()=>{
  const html=salesBar({volume:80,sold:30,contracted:40,remaining:10});assert.match(html,/role="img"/);assert.match(html,/aria-label="38\s%\svendu, 50\s%\ssous contrat, 10\st restant à vendre sur 80\st"/);
  assert.equal(salesBar({volume:0,sold:0,contracted:0,remaining:0}),'');
  const sw=read('sw.js');for(const f of ['./sales.js','./sales-ui.js'])assert.ok(sw.includes(`'${f}'`),`${f} dans CORE`);
  assert.match(read('app.js'),/salesUI\.pilotageSection\(p\.campaign\)/);
  assert.match(read('harvest-ui.js'),/name="contractId"/);
});
