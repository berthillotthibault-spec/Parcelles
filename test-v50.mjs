import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {APP_VERSION,BUILD_ID} from '../js/utils.js';
import {emptyState,migrateData,Store} from '../js/state.js';
import {roleCan,roleLabel,canMutate} from '../js/permissions.js';
import {buildAssistantContext} from '../js/remote-ai.js';

assert.equal(APP_VERSION,7);
assert.equal(BUILD_ID,'2026.09.14-v5.0.0');
assert.equal(roleLabel('owner'),'Propriétaire');
assert.equal(roleLabel('editor'),'Collaborateur');
assert.equal(roleLabel('viewer'),'Lecture seule');
assert.equal(roleCan('owner','manage-members'),true);
assert.equal(roleCan('editor','write'),true);
assert.equal(roleCan('editor','manage-members'),false);
assert.equal(roleCan('viewer','write'),false);
assert.equal(canMutate('viewer',{entity:'parcelles',action:'update'}),false);
assert.equal(canMutate('viewer',{entity:'preferences',action:'update'}),true);

const fresh=emptyState();
assert.ok(Array.isArray(fresh.members));
assert.ok(Array.isArray(fresh.assistantMessages));
assert.ok(Array.isArray(fresh.devices));
assert.equal(fresh.preferences.syncAttachments,true);
assert.equal(fresh.preferences.voiceEnabled,true);
assert.equal(fresh.preferences.assistantHistory,true);
assert.deepEqual(fresh.metadata.syncCursors,{});

const migrated=migrateData({version:6,parcelles:[],interventions:[],preferences:{},metadata:{}});
assert.equal(migrated.version,7);
for(const key of ['members','assistantMessages','devices'])assert.ok(Array.isArray(migrated[key]),`${key} doit être migré`);

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
store.setWriteGuard(operation=>operation.entity==='assistantMessages'||canMutate('viewer',operation));
await assert.rejects(()=>store.upsert('parcelles',{nom:'Interdit',surfaceHa:1}),/rôle/i);
await store.setPreferences({theme:'dark'});
assert.equal(store.snapshot().preferences.theme,'dark');
await store.applyRemote('parcelles',{id:'p_cloud',nom:'Cloud',surfaceHa:2,createdAt:1,updatedAt:5,version:9,deletedAt:null,source:'cloud',sourceId:'p_cloud'});
assert.equal(store.get('parcelles','p_cloud').version,9,'applyRemote préserve la version cloud');
assert.equal(store.get('parcelles','p_cloud').updatedAt,5,'applyRemote préserve updatedAt cloud');

const assistantState=emptyState();
assistantState.parcelles.push({id:'p1',nom:'LAURENCIN',surfaceHa:5.7,culture:'Orge',deletedAt:null});
assistantState.assistantMessages.push({id:'m1',role:'user',text:'Surface LAURENCIN ?',deletedAt:null});
const context=buildAssistantContext(assistantState);
assert.equal(context.parcels[0].name,'LAURENCIN');
assert.equal(context.conversation.length,1);

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
const sync=fs.readFileSync(path.join(root,'js/sync.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'js/runtime.js'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const fireRules=fs.readFileSync(path.join(root,'firebase/firestore.rules'),'utf8');
assert.match(app,/Compte & équipe/);
assert.match(app,/Assistant 5\.0/);
assert.match(app,/openAccountTeam/);
assert.match(app,/assistant-remote-action/);
assert.match(sync,/async bootstrapWorkspace\(/);
assert.match(sync,/async pushPending\(/);
assert.match(sync,/async pullRemote\(/);
assert.match(sync,/async syncAttachmentBlobs\(/);
assert.match(sync,/async createInvite\(/);
assert.match(sync,/async acceptInvite\(/);
assert.match(runtime,/permissions\.js/);
assert.match(runtime,/config\.js/);
assert.match(sw,/permissions\.js/);
assert.match(sw,/www\.gstatic\.com/);
assert.match(index,/\.\/config\.js/);
assert.match(index,/data-action="open-account"/);
assert.match(fireRules,/owner/);
assert.match(fireRules,/editor/);
assert.match(fireRules,/allow read: if isMember/);
console.log('✓ Parcelles 5.0 : rôles, migration v7, assistant enrichi et synchronisation multi-appareils validés.');
