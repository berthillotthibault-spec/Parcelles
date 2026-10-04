import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {HOME_CARDS,HOME_PRESETS,normalizePersonalization,moveHomeCard,filterMapParcels} from './personalization.js';
import {Store,migrateData,emptyState} from './state.js';
import {bootRemaining} from './motion.js';

test('legacy preferences retain visible cards and receive safe new defaults',()=>{
  const old=emptyState();old.preferences={homeCards:['tasks','today'],theme:'dark'};
  const migrated=migrateData(old);
  assert.deepEqual(migrated.preferences.homeCards,['tasks','today']);
  assert.equal(migrated.preferences.startupDuration,3500);
  assert.equal(migrated.preferences.assistantDock,true);
  assert.equal(migrated.preferences.theme,'dark');
});
test('malformed imported preferences cannot add unknown actions or drop card ordering',()=>{
  const p=normalizePersonalization({homeCards:['tasks','bad','tasks'],homeCardOrder:['tasks','bad'],homeShortcuts:['javascript:alert(1)','open-calendar','open-calendar'],startupDuration:Infinity});
  assert.deepEqual(p.homeCards,['tasks']);assert.deepEqual(p.homeShortcuts,['open-calendar']);
  assert.equal(p.homeCardOrder.length,HOME_CARDS.length);assert.equal(p.homeCardOrder[0],'tasks');assert.equal(p.startupDuration,3500);
});

test('the old 2.2 second default migrates once and subsequent explicit choices survive reload',()=>{
  const data=emptyState();data.preferences={startupDuration:2200};
  const upgraded=migrateData(data);assert.equal(upgraded.preferences.startupDuration,3500);assert.equal(upgraded.preferences.startupDurationVersion,2);
  upgraded.preferences.startupDuration=2200;assert.equal(migrateData(upgraded).preferences.startupDuration,2200);
  for(const duration of [0,1200,3500]){data.preferences={startupDuration:duration};assert.equal(migrateData(data).preferences.startupDuration,duration);}
});
test('an intentionally empty home and hidden assistant survive migration',()=>{
  const data=emptyState();Object.assign(data.preferences,{homeCards:[],homeShortcuts:[],homeSummary:false,homeNextAction:false,assistantDock:false,startupDuration:0});
  const p=migrateData(data).preferences;
  assert.deepEqual(p.homeCards,[]);assert.deepEqual(p.homeShortcuts,[]);assert.equal(p.homeSummary,false);assert.equal(p.assistantDock,false);assert.equal(p.startupDuration,0);
});
test('reordering is bounded, immutable and presets remain independent',()=>{
  const start=['weather','today','tasks'];assert.deepEqual(moveHomeCard(start,'weather',-1),start);
  assert.deepEqual(moveHomeCard(start,'today',-1),['today','weather','tasks']);assert.deepEqual(start,['weather','today','tasks']);
  const p=normalizePersonalization(HOME_PRESETS.field);p.homeCards.pop();assert.equal(HOME_PRESETS.field.homeCards.length,3);
});
test('saved personalization survives a fresh Store without changing farming records',async()=>{
  const data=emptyState();data.preferences.autoBackup=false;data.parcelles=[{id:'p1',nom:'Test',culture:'Blé',surfaceHa:4}];
  const records=new Map([['state',data]]);const storage={init:async()=>{},get:async key=>structuredClone(records.get(key)),set:async(key,value)=>records.set(key,structuredClone(value))};
  const first=new Store(storage);await first.init();const before=first.snapshot().parcelles;
  const prefs=normalizePersonalization({...HOME_PRESETS.management,assistantDock:false,startupDuration:3500});
  await first.setPreferences(prefs);const reopened=new Store(storage);await reopened.init();
  assert.deepEqual(normalizePersonalization(reopened.snapshot().preferences),prefs);assert.deepEqual(reopened.snapshot().parcelles,before);assert.equal(reopened.snapshot().queue.length,0);
});
test('map filters include pending tasks and exclude deleted, archived and finished records',()=>{
  const data={parcelles:[{id:'a',favorite:true},{id:'b',clientId:'client'},{id:'c',status:'À faire'},{id:'d',favorite:true,archived:true},{id:'e',deletedAt:1},{id:'f'}],tasks:[{parcelId:'a',status:'À faire'},{parcelId:'f',status:'Terminé'}],interventions:[{parcelId:'b',status:'En cours'},{parcelId:'f',status:'À faire',deletedAt:1}]};
  const snapshot=structuredClone(data);
  assert.deepEqual(filterMapParcels(data).map(p=>p.id),['a','b','c','f']);
  assert.deepEqual(filterMapParcels(data,'favorites').map(p=>p.id),['a']);
  assert.deepEqual(filterMapParcels(data,'clients').map(p=>p.id),['b']);
  assert.deepEqual(filterMapParcels(data,'todo').map(p=>p.id),['a','b','c']);assert.deepEqual(data,snapshot);
});
test('startup waits only the missing presentation time and respects reduced motion',()=>{
  assert.equal(bootRemaining(2200,100,400),1900);
  assert.equal(bootRemaining(2200,100,4000),0);
  assert.equal(bootRemaining(3500,100,400,true),0);
  assert.equal(bootRemaining(0,100,400),0);
  assert.equal(bootRemaining(99999,100,100),3500);
});
test('personalization resources are included in the offline release',()=>{
  const read=file=>fs.readFileSync(new URL(file,import.meta.url),'utf8');
  for(const file of ['runtime.js','sw.js'])for(const asset of ['personalization.js','personalization-ui.js','personalization.css'])assert.ok(read(file).includes(`'./${asset}'`));
  assert.ok(read('index.html').includes('href="./personalization.css"'));
});
