import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,emptyState,migrateData} from './state.js';
import {hasCost,isEstimatedCost,proposeCost,costCompletion,acceptEstimates,undoEstimates,saveManualCost,dismissCost,restoreDismissed,costPriceByCulture,salesByCulture,gaugeScale,COST_SOURCE_ESTIMATED} from './costs.js';
import {gaugeSvg} from './costs-ui.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
class MemoryStorage{constructor(){this.value=null;}async init(){}async get(){return this.value;}async set(_k,v){this.value=structuredClone(v);}async backupPut(){}async pruneBackups(){}async blobDelete(){}}
const C='2025/26',D='2025-11-10';

function farm(){
  const s=emptyState();
  s.parcelles=[{id:'p1',nom:'Les Noues',culture:'Blé tendre',surfaceHa:10,economicsByCampaign:{[C]:{yield:8,salePrice:200}}},{id:'p2',nom:'Grand Champ',culture:'Blé tendre',surfaceHa:5,economicsByCampaign:{[C]:{yield:70,yieldUnit:'q/ha',salePrice:21}}},{id:'p3',nom:'La Côte',culture:'Colza',surfaceHa:4}];
  s.materiels=[{id:'m1',nom:'Tracteur',hourlyCost:40,insurance:1000,amortization:2000}];
  s.stockItems=[{id:'s1',name:'Ammonitrate',unit:'kg',quantity:500,unitPrice:.5}];
  s.interventions=[
    {id:'w1',parcelId:'p1',type:'Semis',date:D,status:'Terminé',cost:800,surfaceWorked:10,version:1},
    {id:'w2',parcelId:'p2',type:'Semis',date:D,status:'Terminé',surfaceWorked:5,version:1},
    {id:'w3',parcelId:'p1',type:'Labour',date:D,status:'Terminé',equipmentId:'m1',duration:3,cost:0,version:1},
    {id:'w4',parcelId:'p3',type:'Broyage',date:D,status:'Terminé',version:1},
    {id:'w5',parcelId:'p1',type:'Fertilisation',date:D,status:'Terminé',product:'Ammonitrate',dose:100,doseUnit:'kg/ha',surfaceWorked:10,version:1},
    {id:'w6',parcelId:'p1',type:'Semis',date:'2024-10-10',status:'Terminé',surfaceWorked:10,version:1},
    {id:'w7',parcelId:'p2',type:'Désherbage',date:D,status:'À faire',version:1},
  ];
  return s;
}

test('un coût nul ou absent est « sans coût » ; l’estimation reste visible tant qu’elle n’est pas modifiée',()=>{
  assert.equal(hasCost({cost:0}),false);assert.equal(hasCost({}),false);assert.equal(hasCost({cost:'12'}),false);assert.equal(hasCost({cost:12}),true);
  const w={cost:50,costSource:COST_SOURCE_ESTIMATED,costEstimate:{value:50}};assert.equal(isEstimatedCost(w),true);
  assert.equal(isEstimatedCost({...w,cost:60}),false,'un coût corrigé à la main redevient réel');
});

test('propositions : stock et matériel, puis moyenne €/ha de l’exploitation, puis barème',()=>{
  const s=farm(),w=id=>s.interventions.find(x=>x.id===id);
  const labour=proposeCost(s,w('w3'));assert.equal(labour.method,'effects');assert.equal(labour.value,120);
  const ferti=proposeCost(s,w('w5'));assert.equal(ferti.method,'effects');assert.equal(ferti.value,500,'100 kg/ha × 10 ha × 0,5 €');
  const semis=proposeCost(s,w('w2'));assert.equal(semis.method,'average');assert.equal(semis.value,400,'80 €/ha × 5 ha');assert.match(semis.detail,/1 travail « Semis » chiffré : 80 €\/ha/);
  assert.equal(proposeCost(s,w('w4')),null,'aucune référence ni barème : pas de valeur inventée');
  s.preferences.costRates={broyage:30};const broyage=proposeCost(s,w('w4'));assert.equal(broyage.method,'rate');assert.equal(broyage.value,120,'barème 30 €/ha × 4 ha (surface de la parcelle)');
  // Une estimation n’alimente jamais la moyenne.
  w('w1').costSource=COST_SOURCE_ESTIMATED;w('w1').costEstimate={value:800};assert.equal(proposeCost(s,w('w2')),null);
});

test('liste à compléter : campagne, travaux réalisés seulement, ignorés à part',()=>{
  const s=farm();s.interventions.find(w=>w.id==='w4').costEstimateDismissedAt=1;
  const c=costCompletion(s,{campaign:C});
  assert.deepEqual(c.rows.map(r=>r.work.id).sort(),['w2','w3','w5']);assert.equal(c.missing,4);assert.equal(c.dismissed,1);
  assert.equal(c.total,1020);assert.equal(costCompletion(s).rows.length,4,'sans filtre : toutes campagnes (w6 inclus)');
});

test('accepter n’écrase jamais un coût existant, marque « estimé » et peut être annulé',async()=>{
  const store=new Store(new MemoryStorage());await store.init();await store.setPreferences({autoBackup:false});
  const s=farm();await store.upsertMany('materiels',s.materiels);await store.upsertMany('stockItems',s.stockItems);await store.upsertMany('parcelles',s.parcelles);await store.upsertMany('interventions',s.interventions);
  const listed=costCompletion(store.snapshot(),{campaign:C});
  // Entre l’affichage et l’acceptation, l’utilisateur saisit un coût réel sur w5.
  const w5=store.get('interventions','w5');await store.upsert('interventions',{...w5,cost:333});
  const result=await acceptEstimates(store,listed.proposed.map(r=>({id:r.work.id,version:r.work.version})));
  assert.equal(store.get('interventions','w5').cost,333,'coût saisi conservé');assert.equal(result.saved,2);assert.equal(result.skipped,1);
  const w3=store.get('interventions','w3');assert.equal(w3.cost,120);assert.equal(w3.costSource,'estimé');assert.equal(w3.costEstimate.method,'effects');assert.equal(w3.machineCost,120);assert.ok(isEstimatedCost(w3));
  assert.equal(store.get('interventions','w2').costSource,'estimé');
  assert.equal(await undoEstimates(store,result.undo),2);
  const back=store.get('interventions','w3');assert.equal(back.cost,0);assert.equal(back.costSource,null);assert.equal(back.machineCost,null);
  assert.ok(store.state.journal.length>0);
});

test('saisie manuelle, barème, ignorer puis réafficher ; refus pour un rôle lecteur',async()=>{
  const store=new Store(new MemoryStorage());await store.init();await store.setPreferences({autoBackup:false});
  const s=farm();await store.upsertMany('parcelles',s.parcelles);await store.upsertMany('interventions',s.interventions);
  await assert.rejects(saveManualCost(store,'w1',50),/déjà un coût/);assert.equal(store.get('interventions','w1').cost,800);
  await assert.rejects(saveManualCost(store,'w4',0),/supérieur à 0/);
  await saveManualCost(store,'w4',100,{rateKey:'broyage',area:4});
  const w4=store.get('interventions','w4');assert.equal(w4.cost,100);assert.equal(w4.costSource,'saisi');assert.equal(isEstimatedCost(w4),false);assert.equal(store.snapshot().preferences.costRates.broyage,25);
  await dismissCost(store,'w2');assert.ok(!costCompletion(store.snapshot(),{campaign:C}).rows.some(r=>r.work.id==='w2'));
  assert.equal(await restoreDismissed(store,{campaign:C}),1);assert.ok(costCompletion(store.snapshot(),{campaign:C}).rows.some(r=>r.work.id==='w2'));
  store.setWriteGuard(()=>false);await assert.rejects(acceptEstimates(store,[{id:'w2'}]),/rôle/);await assert.rejects(dismissCost(store,'w2'),/rôle/);
});

test('coût de revient, prix d’équilibre, unités q/ha et rendement absent',()=>{
  const s=farm();s.interventions.find(w=>w.id==='w2').cost=400;
  s.integrationImports=[{id:'h1',farmKind:'harvest',parcelId:'p1',crop:'Blé tendre',date:'2026-07-15',unit:'t',quantity:80,sales:[{quantity:30,price:190},{quantity:10,price:230}]}];
  const r=costPriceByCulture(s,{campaign:'2025/26',structureCostHa:20});
  const ble=r.rows.find(x=>x.culture==='Blé tendre'),colza=r.rows.find(x=>x.culture==='Colza');
  // Blé : 15 ha, production 8×10 + 7×5 = 115 t ; charges 800 + 400 = 1 200 € (w3 et w5 sans coût).
  assert.equal(ble.production,115);assert.ok(Math.abs(ble.costPrice-1200/115)<1e-9);
  // Structure : 3 000 € de matériel × 15/19 ha + 20 €/ha × 15 ha.
  const structure=3000*15/19+300;assert.ok(Math.abs(ble.structure-structure)<1e-9);assert.ok(Math.abs(ble.breakEven-(1200+structure)/115)<1e-9);
  // Prix saisi pondéré : 200 €/t (p1) et 21 €/q = 210 €/t (p2).
  assert.ok(Math.abs(ble.marketPrice-(80*200+35*210)/115)<1e-9);assert.equal(ble.priceSource,'market');
  assert.equal(ble.salesPrice,200,'(30×190 + 10×230) / 40');assert.equal(ble.unknown,2);assert.equal(ble.unknownPlanned,1);assert.equal(ble.partial,true);
  assert.ok(Math.abs(ble.breakEvenYield-(1200+structure)/15/ble.marketPrice)<1e-9);
  assert.equal(colza.costPrice,null,'rendement à saisir, jamais l’infini');assert.equal(colza.breakEven,null);assert.equal(colza.parcelsWithoutYield,1);
  const svg=gaugeSvg(ble);assert.match(svg,/role="img"/);assert.match(svg,/Prix d’équilibre/);assert.equal(gaugeSvg(colza),'');
});

test('la culture suit la rotation de la campagne et les ventes en kg sont converties',()=>{
  const s=farm();s.rotations=[{id:'r1',parcelId:'p2',campaignId:C,culture:'Orge'}];
  s.integrationImports=[{id:'h2',farmKind:'harvest',parcelId:'p2',date:'2026-07-01',unit:'kg',quantity:5000,sales:[{quantity:2000,price:.18}]}];
  assert.ok(costPriceByCulture(s,{campaign:C}).rows.some(x=>x.culture==='Orge'));
  const sales=salesByCulture(s,C).get('orge');assert.equal(sales.tonnes,2);assert.ok(Math.abs(sales.price-180)<1e-9);
  assert.equal(gaugeScale([]),null);const g=gaugeScale([100,200]);assert.ok(g.at(100)>0&&g.at(200)<1);
});

test('champs facultatifs conservés par la migration, modules servis hors connexion',()=>{
  const s=farm();s.preferences.costRates={semis:80};s.preferences.structureCostHa=150;s.interventions[0]={...s.interventions[0],costSource:'estimé',costEstimate:{value:800,method:'average'}};
  const m=migrateData(structuredClone(s));assert.deepEqual(m.preferences.costRates,{semis:80});assert.equal(m.preferences.structureCostHa,150);assert.equal(m.interventions.find(w=>w.id==='w1').costSource,'estimé');
  const sw=read('sw.js');for(const f of ['./costs.js','./costs-ui.js'])assert.ok(sw.includes(`'${f}'`),f);
  assert.match(read('app.js'),/costsUI\.pilotageSection\(p\.campaign\)/);assert.match(read('package.json'),/test-costs\.mjs/);
});
