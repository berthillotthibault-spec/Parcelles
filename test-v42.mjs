import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {emptyState,migrateData,Store} from '../js/state.js';
import {buildPilotage,stockSummary} from '../js/pilotage.js';
import {pilotageReportHtml,stockReportHtml} from '../js/reports.js';
import {APP_VERSION,BUILD_ID} from '../js/utils.js';

assert.ok(APP_VERSION>=6);
assert.match(BUILD_ID,/^2026\.09\.14-v(?:4\.2|5\.0)\.0$/);

const state=emptyState();
state.preferences.autoBackup=false;
state.parcelles.push(
  {id:'p1',nom:'Blé Nord',surfaceHa:10,culture:'Blé',ownershipType:'own',economics:{yield:70,yieldUnit:'q/ha',salePrice:22,inputCostHa:100,operatorCostHa:20,otherCostHa:30},deletedAt:null},
  {id:'p2',nom:'Prairie',surfaceHa:5,culture:'Prairie',ownershipType:'own',economics:{productHa:700,inputCostHa:30},deletedAt:null}
);
state.interventions.push(
  {id:'w1',parcelId:'p1',type:'Semis',date:'2026-09-01',campaignId:'2026/27',cost:500,duration:4,machineCost:250,status:'Terminé',deletedAt:null},
  {id:'w2',parcelId:'p2',type:'Fauche',date:'2026-09-02',campaignId:'2026/27',cost:100,duration:2,machineCost:80,status:'Terminé',deletedAt:null}
);
state.materiels.push({id:'m1',nom:'Tracteur',insurance:1200,amortization:4000,deletedAt:null});
state.stockItems.push({id:'s1',name:'Ammonitrate',category:'Engrais',quantity:1000,unit:'kg',unitPrice:.42,alertBelow:200,deletedAt:null});
state.stockMovements.push({id:'sm1',stockItemId:'s1',date:'2026-09-01',type:'Entrée',quantity:1000,delta:1000,balanceAfter:1000,deletedAt:null});

const pilot=buildPilotage(state,{campaign:'2026/27'});
assert.equal(pilot.area,15);
assert.ok(pilot.grossProduct>18000,'produit brut agrégé');
assert.ok(pilot.margin<pilot.grossProduct,'charges déduites');
assert.ok(pilot.byCulture.some(x=>x.culture==='Blé'&&x.marginHa>0));
assert.equal(pilot.stock.value,420);
const stock=stockSummary(state);
assert.equal(stock.rows[0].value,420);
assert.equal(stock.movements.length,1);
assert.match(pilotageReportHtml(state,'2026/27'),/Marge brute estimée/i);
assert.match(stockReportHtml(state),/État des stocks/i);

const migrated=migrateData({version:5,parcelles:[],interventions:[],stockItems:[{id:'s',name:'Test',quantity:1}],preferences:{},metadata:{}});
assert.equal(migrated.version,APP_VERSION);
assert.ok(Array.isArray(migrated.stockMovements));
assert.equal(migrated.stockItems[0].category,'Intrant');
assert.ok(migrated.parcelles.every(p=>p.economicsByCampaign&&typeof p.economicsByCampaign==='object'));

class MemoryStorage{
  constructor(){this.value=null;}
  async init(){}
  async get(){return this.value;}
  async set(_k,v){this.value=structuredClone(v);}
  async backupPut(){}
  async pruneBackups(){}
  async blobDelete(){}
}
const store=new Store(new MemoryStorage());
await store.init();
await store.setPreferences({autoBackup:false});
const item=await store.upsert('stockItems',{name:'Urée',quantity:100,unit:'kg',unitPrice:.5},{queue:false});
await store.recordStockMovement({stockItemId:item.id,type:'Sortie',date:'2026-09-14',quantity:25,note:'Essai'});
assert.equal(store.get('stockItems',item.id).quantity,75);
assert.equal(store.list('stockMovements').length,1);
await store.recordStockMovement({stockItemId:item.id,type:'Entrée',date:'2026-09-14',quantity:25,unitPrice:1,note:'Achat'});
assert.equal(store.get('stockItems',item.id).quantity,100);
assert.ok(Math.abs(store.get('stockItems',item.id).unitPrice-0.625)<1e-9,'prix moyen pondéré après entrée');
await assert.rejects(()=>store.recordStockMovement({stockItemId:item.id,type:'Sortie',date:'2026-09-14',quantity:1000}),/insuffisant/i);
assert.equal(store.get('stockItems',item.id).quantity,100,'rollback atomique si sortie impossible');

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'js/runtime.js'),'utf8');
assert.match(app,/Pilotage/);
assert.match(app,/openCampaignPlanner/);
assert.match(app,/recordStockMovement/);
assert.match(sw,/pilotage\.js/);
assert.match(runtime,/pilotage\.js/);
console.log('✓ Parcelles 4.2 : économie, stocks, mouvements, rapports et planification de campagne validés.');
