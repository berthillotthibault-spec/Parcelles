import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store,emptyState,externalBackupStatus,EXTERNAL_BACKUP_REMINDER_DAYS} from './state.js';

const DAY=86400000;
function memoryStorage(initial=null){
  const data=new Map(initial?[['state',structuredClone(initial)]]:[]);
  return {data,async init(){},async get(k){return data.has(k)?structuredClone(data.get(k)):null;},async getStored(k){return this.get(k);},async set(k,v){data.set(k,structuredClone(v));},async setIfCurrent(k,v){data.set(k,structuredClone(v));},async backupPut(){},async pruneBackups(){},async blobDelete(){}};
}
const at=Date.UTC(2026,9,7,12);
function withTask(createdAt){const state=emptyState();state.tasks=[{id:'t1',title:'Semis',createdAt,updatedAt:createdAt}];return state;}

test('rappel : jamais affiché sans donnée ni avant 14 jours',()=>{
  assert.equal(externalBackupStatus(emptyState(),at).due,false,'application vide');
  assert.equal(externalBackupStatus(withTask(at-3*DAY),at).due,false,'première saisie récente');
  const old=withTask(at-30*DAY);
  assert.deepEqual({due:externalBackupStatus(old,at).due,never:externalBackupStatus(old,at).never},{due:true,never:true});
  old.metadata.lastExternalBackupAt=at-EXTERNAL_BACKUP_REMINDER_DAYS*DAY;
  assert.equal(externalBackupStatus(old,at).due,false,'14 jours pile : pas encore');
  old.metadata.lastExternalBackupAt=at-23*DAY;
  const status=externalBackupStatus(old,at);
  assert.equal(status.due,true);assert.equal(status.days,23);assert.equal(status.never,false);
  // Les éléments en corbeille ne comptent pas comme première donnée.
  const trashed=withTask(at-30*DAY);trashed.tasks[0].deletedAt=at;
  assert.equal(externalBackupStatus(trashed,at).due,false);
});

test('export réussi : date enregistrée localement, non synchronisée, même pour un rôle en lecture',async()=>{
  const storage=memoryStorage(withTask(Date.now()-30*DAY)),store=new Store(storage);
  await store.init();
  store.setWriteGuard(()=>false);
  const before=Date.now();
  await store.recordExternalBackup('zip');
  const saved=storage.data.get('state');
  assert.ok(saved.metadata.lastExternalBackupAt>=before);
  assert.equal(saved.metadata.lastExternalBackupKind,'zip');
  assert.equal(saved.queue.length,0,'rien n’est envoyé au cloud');
  assert.equal(externalBackupStatus(saved).due,false);
});

test('« Plus tard » masque le rappel 7 jours, un export le réactive pour la prochaine échéance',async()=>{
  const storage=memoryStorage(withTask(Date.now()-30*DAY)),store=new Store(storage);
  await store.init();
  assert.equal(externalBackupStatus(store.state).hidden,false);
  await store.snoozeExternalBackupReminder();
  const saved=storage.data.get('state');
  assert.equal(externalBackupStatus(saved).hidden,true);
  assert.equal(externalBackupStatus(saved,Date.now()+8*DAY).hidden,false,'réapparaît après 7 jours');
  await store.recordExternalBackup('json');
  assert.equal(storage.data.get('state').metadata.externalBackupReminderHiddenUntil,null);
});

test('anciennes données sans le champ : aucune migration nécessaire',async()=>{
  const legacy=withTask(Date.now()-30*DAY);delete legacy.metadata.lastExternalBackupAt;
  const store=new Store(memoryStorage(legacy));await store.init();
  assert.equal(store.state.metadata.lastExternalBackupAt,undefined);
  assert.equal(externalBackupStatus(store.state).due,true);
});
