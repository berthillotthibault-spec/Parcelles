// n° 113 — Premier lancement « carte d’abord » : sélection multiple sur la carte PAC.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Store} from './state.js';
import {rollbackImportSession} from './import-export.js';
import {
  rpgCultureLabel,onboardingRpgYears,geocodeUrl,parseGeocode,countLabel,selectionSummary,
  rpgBatchParcels,farmSummary,farmSummaryLabel,addRpgParcelsBatch,BATCH_LIMIT
} from './rpg-onboarding.js';

class MemoryStorage{
  constructor(){this.value=null;this.backups=new Map();}
  async init(){}
  async get(){return this.value;}
  async set(_k,v){this.value=structuredClone(v);}
  async backupPut(entry){this.backups.set(entry.id,structuredClone(entry));}
  async backupGet(id){return structuredClone(this.backups.get(id)||null);}
  async backupDelete(id){this.backups.delete(id);}
  async pruneBackups(){}
  async blobDelete(){}
}

const square=(x,y,d=.002)=>({type:'Polygon',coordinates:[[[x,y],[x+d,y],[x+d,y+d],[x,y+d],[x,y]]]});
const feature=(id,{ilot='',code='BTH',surf=4.2,x=5.1,y=46.3}={})=>({type:'Feature',id:`f${id}`,geometry:square(x,y),properties:{id_parcel:String(id),surf_parc:surf,code_cultu:code,code_group:'1',...(ilot?{num_ilot:ilot}:{})}});

async function newStore(){const store=new Store(new MemoryStorage());await store.init();await store.setPreferences({autoBackup:false,syncEnabled:true});return store;}

test('culture lisible depuis le code PAC, code inconnu conservé', ()=>{
  assert.equal(rpgCultureLabel('bth'),'Blé tendre d’hiver');
  assert.equal(rpgCultureLabel('PPH'),'Prairie permanente');
  assert.equal(rpgCultureLabel('ZZZ'),'ZZZ');
  assert.equal(rpgCultureLabel('ZZZ','Libellé source'),'Libellé source');
});

test('millésime N-1 d’abord, puis 2024 en secours', ()=>{
  assert.deepEqual(onboardingRpgYears(new Date('2026-10-07T08:00:00')),[2025,2024]);
  assert.deepEqual(onboardingRpgYears(new Date('2025-03-01T08:00:00')),[2024]);
});

test('géocodage de la commune : URL bornée et réponse filtrée', ()=>{
  assert.equal(geocodeUrl(' '),null);
  const url=new URL(geocodeUrl('Montrevel-en-Bresse'));
  assert.equal(url.hostname,'data.geopf.fr');
  assert.equal(url.searchParams.get('type'),'municipality');
  assert.equal(url.searchParams.get('q'),'Montrevel-en-Bresse');
  const places=parseGeocode({type:'FeatureCollection',features:[
    {geometry:{coordinates:[5.13,46.34]},properties:{city:'Montrevel-en-Bresse',postcode:'01340'}},
    {geometry:{coordinates:[500,46]},properties:{city:'Hors limites'}},
    {geometry:null,properties:{city:'Sans point'}}
  ]});
  assert.deepEqual(places,[{name:'Montrevel-en-Bresse',postcode:'01340',latitude:46.34,longitude:5.13}]);
  assert.deepEqual(parseGeocode(null),[]);
});

test('compteur : 0 et 1 au singulier, pluriel au-delà', ()=>{
  assert.equal(countLabel(0,0),'0 parcelle · 0 ha');
  assert.equal(countLabel(1,4.24),'1 parcelle · 4,2 ha');
  assert.equal(countLabel(12,84.3),'12 parcelles · 84,3 ha');
  assert.deepEqual(selectionSummary([feature(1),feature(2,{surf:3})],2024),{count:2,surfaceHa:7.2});
  assert.equal(farmSummaryLabel(farmSummary([{surfaceHa:2},{surfaceHa:3.04},{surfaceHa:9,deletedAt:1}])),'2 parcelles, 5 ha');
});

test('lot : noms provisoires par îlot, doublons et contours invalides écartés', ()=>{
  const existing=[{nom:'Îlot 3 - P1',sourceId:'rpg:2024:parcel:99'},{nom:'Parcelle PAC 2',sourceId:'x'}];
  const bad={type:'Feature',id:'bad',geometry:{type:'Polygon',coordinates:[]},properties:{id_parcel:'7'}};
  const {parcels,skipped}=rpgBatchParcels([feature(1,{ilot:'3'}),feature(2,{ilot:'3',code:'MIS'}),feature(3),feature(99,{ilot:'3'}),feature(1,{ilot:'3'}),bad],{year:2024,existing});
  assert.deepEqual(parcels.map(p=>p.nom),['Îlot 3 - P2','Îlot 3 - P3','Parcelle PAC 3']);
  assert.deepEqual(parcels.map(p=>p.culture),['Blé tendre d’hiver','Maïs','Blé tendre d’hiver']);
  assert.ok(parcels.every(p=>p.ownershipType==='own'&&p.source==='rpg'&&p.rpgYear===2024));
  assert.deepEqual(skipped.map(s=>s.reason).sort(),['duplicate','duplicate','invalid']);
});

test('ajout groupé : une seule écriture, session d’import annulable', async()=>{
  const store=await newStore();
  const before=store.state.metadata.revision;
  const result=await addRpgParcelsBatch(store,[feature(1),feature(2,{surf:3.5}),feature(3,{surf:1})],{year:2024});
  assert.equal(result.created,3);assert.equal(result.surfaceHa,8.7);
  assert.equal(store.state.metadata.revision,before+1,'une seule mutation pour tout le lot');
  assert.equal(store.list('parcelles').length,3);
  assert.equal(store.state.queue.filter(op=>op.entity==='parcelles'&&op.action==='create').length,3,'chaque parcelle part en synchronisation');
  const session=store.get('importSessions',result.sessionId);
  assert.equal(session.strategy,'rpg-onboarding');assert.equal(session.created,3);
  const again=await addRpgParcelsBatch(store,[feature(1)],{year:2024});
  assert.equal(again.created,0);assert.equal(again.skipped,1);
  await rollbackImportSession(store,result.sessionId);
  assert.equal(store.list('parcelles').length,0,'l’annulation restaure l’état antérieur');
});

test('ajout groupé : refus sans sélection, au-delà de la limite ou sans droit d’écriture', async()=>{
  const store=await newStore();
  await assert.rejects(addRpgParcelsBatch(store,[],{year:2024}),/au moins une parcelle/);
  await assert.rejects(addRpgParcelsBatch(store,Array.from({length:BATCH_LIMIT+1},(_,i)=>feature(i+1)),{year:2024}),/au plus/);
  store.setWriteGuard(()=>false);
  await assert.rejects(addRpgParcelsBatch(store,[feature(1)],{year:2024}),/rôle/);
  assert.equal(store.list('parcelles').length,0);
});

test('accroches : accueil, liste vide, cache hors connexion', ()=>{
  const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
  assert.match(app,/import \{createRpgOnboardingUI\} from '\.\/rpg-onboarding-ui\.js'/);
  assert.match(app,/id="onboarding-rpg"/);
  assert.match(app,/action==='rpg-onboarding'/);
  assert.doesNotMatch(app,/export Geofolia/);
  const sw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
  for(const file of ['./rpg-onboarding.js','./rpg-onboarding-ui.js'])assert.ok(sw.includes(`'${file}'`),file);
});
