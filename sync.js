import {BUILD_ID, ENTITY_TYPES, clone, uid} from './utils.js';
import {assignableRoles, canMutate, roleCan, roleLabel} from './permissions.js';
import {queueStats, safeMergeEntity, sanitizeCloudError, syncRetryDelay} from './security.js';

const FIREBASE_VERSION='10.14.1';
const CLOUD_ENTITY_TYPES=ENTITY_TYPES.filter(type=>!['syncConflicts','devices','members','assistantMessages','automationRuns','platformJobs','platformEvents'].includes(type));
const clean=value=>JSON.parse(JSON.stringify(value??null));
const emailKey=value=>String(value||'').trim().toLocaleLowerCase('fr');

async function loadScript(src){
  if([...document.scripts].some(s=>s.src===src))return;
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.async=true;script.onload=resolve;script.onerror=()=>reject(new Error(`Impossible de charger ${src}`));document.head.append(script);});
}
async function ensureFirebase(){
  if(window.firebase?.auth&&window.firebase?.firestore&&window.firebase?.storage)return window.firebase;
  const base=`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  await loadScript(`${base}/firebase-app-compat.js`);await loadScript(`${base}/firebase-auth-compat.js`);await loadScript(`${base}/firebase-firestore-compat.js`);await loadScript(`${base}/firebase-storage-compat.js`);
  return window.firebase;
}
function safeLocalGet(key,fallback=''){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}
function safeLocalSet(key,value){try{localStorage.setItem(key,value);return true;}catch{return false;}}
function localDeviceId(){const key='parcelles:device-id';let id=safeLocalGet(key);if(!id){id=uid('device');safeLocalSet(key,id);}return id;}
function defaultDeviceName(){const mobile=/iPhone|iPad|Android/i.test(navigator.userAgent||'');const platform=navigator.userAgentData?.platform||navigator.platform||'';return `${mobile?'Mobile':'Ordinateur'}${platform?` · ${platform}`:''}`;}
function connectionKind(){const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;return String(c?.type||c?.effectiveType||'unknown').toLowerCase();}

export class SyncService{
  constructor(store){
    this.store=store;this.status={configured:false,connected:false,message:'Synchronisation non configurée : les données restent sur cet appareil.'};
    this.user=null;this.db=null;this.auth=null;this.storage=null;this.member=null;this.workspace=null;this.deviceId=null;this.lastResult=null;this.syncPromise=null;
  }
  get workspaceId(){return this.store.snapshot().preferences.workspaceId||'';}
  get role(){const p=this.store.snapshot().preferences;if(this.status.connected&&this.workspaceId)return this.member?.role||'viewer';if(p.syncEnabled&&p.workspaceId&&p.cloudRole)return p.cloudRole;return 'owner';}
  get roleName(){return roleLabel(this.role);}
  get syncCursor(){return Number(this.store.snapshot().metadata?.syncCursors?.[this.workspaceId]||0);}
  can(capability){return roleCan(this.role,capability);}
  canWriteEntity(entity,action){if(['preferences','assistantMessages','syncConflicts'].includes(entity))return true;return canMutate(this.role,{entity,action});}
  queueSummary(){return queueStats(this.store.snapshot().queue);}
  networkAllows({attachments=false}={}){const p=this.store.snapshot().preferences,kind=connectionKind();if(!navigator.onLine)return false;if((p.syncWifiOnly||attachments&&p.syncAttachmentsWifiOnly)&&['cellular','2g','3g','4g','5g'].includes(kind))return false;return true;}

  async init(){
    const prefs=this.store.snapshot().preferences;
    if(!prefs.syncEnabled){this.reset('Synchronisation désactivée.');return this.status;}
    const config=window.PARCELLES_FIREBASE_CONFIG;
    if(!config?.apiKey||!config?.projectId){this.reset('Synchronisation demandée, mais Firebase n’est pas configuré.',true);return this.status;}
    try{
      const firebase=await ensureFirebase();if(!firebase.apps?.length)firebase.initializeApp(config);
      this.auth=firebase.auth();this.db=firebase.firestore();this.storage=firebase.storage();try{this.db.settings({ignoreUndefinedProperties:true});}catch{}
      this.user=this.auth.currentUser||await new Promise(resolve=>{let done=false;const stop=this.auth.onAuthStateChanged(user=>{if(done)return;done=true;stop();resolve(user);});setTimeout(()=>{if(!done){done=true;stop();resolve(this.auth.currentUser);}},2500);});
      if(!this.user){this.status={configured:true,connected:false,message:'Firebase configuré. Connectez-vous pour synchroniser.'};return this.status;}
      this.deviceId=localDeviceId();await this.refreshMembership();await this.heartbeat().catch(()=>{});
      this.status={configured:true,connected:Boolean(this.workspaceId&&this.member),message:this.workspaceId&&this.member?`Connecté · ${this.user.email||this.user.uid} · ${this.roleName}`:'Connecté au compte. Choisissez ou créez une exploitation cloud.'};return this.status;
    }catch(error){this.status={configured:true,connected:false,message:`Cloud indisponible : ${sanitizeCloudError(error)}`};return this.status;}
  }
  reset(message,configured=false){this.user=null;this.db=null;this.auth=null;this.storage=null;this.member=null;this.workspace=null;this.status={configured,connected:false,message};}

  async signIn(email,password){if(!this.auth)await this.init();if(!this.auth)throw new Error('Firebase non configuré.');const result=await this.auth.signInWithEmailAndPassword(String(email).trim(),String(password));this.user=result.user;this.deviceId=localDeviceId();await this.refreshMembership();await this.heartbeat().catch(()=>{});await this.audit('sign-in','security',this.deviceId);return this.init();}
  async signUp(email,password){if(!this.auth)await this.init();if(!this.auth)throw new Error('Firebase non configuré.');if(String(password||'').length<8)throw new Error('Utilisez un mot de passe d’au moins 8 caractères.');const result=await this.auth.createUserWithEmailAndPassword(String(email).trim(),String(password));this.user=result.user;this.deviceId=localDeviceId();return this.init();}
  async signOut(){if(this.auth&&this.user)await this.audit('sign-out','security',this.deviceId||'');if(this.auth)await this.auth.signOut();this.user=null;this.member=null;this.workspace=null;await this.store.switchWorkspace?.('local');await this.store.setPreferences({workspaceId:'',cloudRole:null});this.status={configured:true,connected:false,message:'Déconnecté · espace local actif.'};return this.status;}

  async listWorkspaces(){if(!this.user||!this.db)return[];const snap=await this.db.collection('users').doc(this.user.uid).collection('workspaces').get();return snap.docs.map(doc=>({id:doc.id,...doc.data()})).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'fr'));}
  async createWorkspace(name){if(!this.user||!this.db)throw new Error('Connectez-vous d’abord.');const seed=this.store.snapshot(),ref=this.db.collection('workspaces').doc(),workspace={name:String(name||'Mon exploitation').trim()||'Mon exploitation',ownerUid:this.user.uid,createdAt:Date.now(),updatedAt:Date.now()};const batch=this.db.batch();batch.set(ref,workspace);batch.set(ref.collection('members').doc(this.user.uid),{uid:this.user.uid,email:emailKey(this.user.email),role:'owner',joinedAt:Date.now(),displayName:this.user.displayName||''});batch.set(this.db.collection('users').doc(this.user.uid).collection('workspaces').doc(ref.id),{workspaceId:ref.id,name:workspace.name,role:'owner',updatedAt:Date.now()});await batch.commit();await this.store.switchWorkspace?.(ref.id,{seed,name:workspace.name});await this.store.setPreferences({workspaceId:ref.id,syncEnabled:true});await this.refreshMembership();await this.heartbeat().catch(()=>{});await this.audit('workspace-create','workspace',ref.id,{localIsolation:true});return ref.id;}
  async selectWorkspace(id){const target=String(id||'').trim();if(!target)throw new Error('Exploitation cloud invalide.');const list=await this.listWorkspaces();const ws=list.find(item=>item.id===target);await this.store.switchWorkspace?.(target,{name:ws?.name||''});await this.store.setPreferences({workspaceId:target,syncEnabled:true});await this.refreshMembership();await this.heartbeat().catch(()=>{});return this.workspace;}

  async refreshMembership(){this.member=null;this.workspace=null;const id=this.workspaceId;if(!this.user||!this.db)return;if(!id){this.status={configured:true,connected:false,message:'Compte connecté. Choisissez ou créez une exploitation cloud.'};return;}const [workspace,member]=await Promise.all([this.db.collection('workspaces').doc(id).get(),this.db.collection('workspaces').doc(id).collection('members').doc(this.user.uid).get()]);if(!workspace.exists||!member.exists){await this.store.setPreferences({workspaceId:'',cloudRole:null});this.status={configured:true,connected:false,message:'Accès à cette exploitation cloud introuvable.'};return;}this.workspace={id,...workspace.data()};this.member={id:this.user.uid,...member.data()};await this.store.setPreferences({cloudRole:this.member.role||'viewer'});this.status={configured:true,connected:true,message:`Connecté · ${this.user.email||this.user.uid} · ${roleLabel(this.member.role||'viewer')}`};}

  async listMembers(){if(!this.db||!this.workspaceId)return[];const snap=await this.db.collection('workspaces').doc(this.workspaceId).collection('members').get();return snap.docs.map(d=>({id:d.id,...d.data()}));}
  async listDevices(){if(!this.db||!this.workspaceId)return[];const snap=await this.db.collection('workspaces').doc(this.workspaceId).collection('devices').orderBy('lastSeen','desc').limit(50).get();return snap.docs.map(d=>({id:d.id,...d.data()}));}
  async listActivity(limit=50){if(!this.db||!this.workspaceId)return[];const snap=await this.db.collection('workspaces').doc(this.workspaceId).collection('audit').orderBy('createdAt','desc').limit(limit).get();return snap.docs.map(d=>({id:d.id,...d.data()}));}

  async heartbeat(){if(!this.user||!this.db||!this.workspaceId)return;this.deviceId=this.deviceId||localDeviceId();await this.db.collection('workspaces').doc(this.workspaceId).collection('devices').doc(this.deviceId).set({deviceId:this.deviceId,name:safeLocalGet('parcelles:device-name')||defaultDeviceName(),userId:this.user.uid,email:emailKey(this.user.email),lastSeen:Date.now(),build:BUILD_ID,userAgent:String(navigator.userAgent||'').slice(0,300)},{merge:true});}
  async renameDevice(name){const value=String(name||'').trim();if(!value)throw new Error('Nom requis.');if(!safeLocalSet('parcelles:device-name',value))throw new Error('Impossible d’enregistrer le nom de l’appareil localement.');await this.heartbeat();await this.audit('device-rename','device',this.deviceId,{name:value});}
  async removeDeviceRecord(deviceId){if(!this.db||!this.workspaceId)throw new Error('Cloud indisponible.');const devices=await this.listDevices(),device=devices.find(x=>x.id===deviceId);if(!device)throw new Error('Appareil introuvable.');if(device.userId!==this.user?.uid&&!this.can('manage-members'))throw new Error('Droit insuffisant.');await this.db.collection('workspaces').doc(this.workspaceId).collection('devices').doc(deviceId).delete();await this.audit('device-remove','device',deviceId,{note:'Suppression de la fiche appareil uniquement ; ne révoque pas la session Firebase distante.'});}

  async createInvite(email,role='editor'){if(!this.can('manage-members'))throw new Error('Seul le propriétaire peut inviter des membres.');const target=emailKey(email);if(!target||!target.includes('@'))throw new Error('Adresse email invalide.');if(!assignableRoles().includes(role))throw new Error('Rôle invalide.');const token=[...crypto.getRandomValues(new Uint32Array(4))].map(n=>n.toString(36)).join('').slice(0,28),invite={workspaceId:this.workspaceId,workspaceName:this.workspace?.name||'Parcelles',email:target,role,createdBy:this.user.uid,createdAt:Date.now(),expiresAt:Date.now()+7*86400000};await this.db.collection('invites').doc(token).set(invite);await this.audit('invite-create','member',target,{role});return{token,...invite};}
  async acceptInvite(token){if(!this.user||!this.db)throw new Error('Connectez-vous avant d’accepter une invitation.');const ref=this.db.collection('invites').doc(String(token||'').trim()),snap=await ref.get();if(!snap.exists)throw new Error('Invitation introuvable ou expirée.');const invite=snap.data();if(invite.expiresAt<Date.now())throw new Error('Cette invitation a expiré.');if(emailKey(invite.email)!==emailKey(this.user.email))throw new Error('Cette invitation est destinée à une autre adresse email.');const ws=this.db.collection('workspaces').doc(invite.workspaceId),member=ws.collection('members').doc(this.user.uid),userWs=this.db.collection('users').doc(this.user.uid).collection('workspaces').doc(invite.workspaceId);const batch=this.db.batch();batch.set(member,{uid:this.user.uid,email:emailKey(this.user.email),role:invite.role,joinedAt:Date.now(),inviteToken:ref.id});batch.set(userWs,{workspaceId:invite.workspaceId,name:invite.workspaceName||'Parcelles',role:invite.role,updatedAt:Date.now()});batch.delete(ref);await batch.commit();await this.store.switchWorkspace?.(invite.workspaceId,{name:invite.workspaceName||'Parcelles'});await this.store.setPreferences({workspaceId:invite.workspaceId,syncEnabled:true});await this.refreshMembership();await this.heartbeat();await this.audit('invite-accept','member',this.user.uid);return this.workspace;}
  async updateMemberRole(uidValue,role){if(!this.can('manage-members'))throw new Error('Droit insuffisant.');if(uidValue===this.user.uid)throw new Error('Le propriétaire ne peut pas modifier son propre rôle ici.');if(!assignableRoles().includes(role))throw new Error('Rôle invalide.');const ref=this.db.collection('workspaces').doc(this.workspaceId).collection('members').doc(uidValue);await ref.set({role,updatedAt:Date.now()},{merge:true});await this.audit('member-role','member',uidValue,{role});}
  async removeMember(uidValue){if(!this.can('manage-members'))throw new Error('Droit insuffisant.');if(uidValue===this.user.uid)throw new Error('Impossible de retirer le propriétaire connecté.');await this.db.collection('workspaces').doc(this.workspaceId).collection('members').doc(uidValue).delete();await this.audit('member-remove','member',uidValue);}

  async audit(action,entity='',entityId='',details=null){if(!this.db||!this.workspaceId||!this.user||this.store.snapshot().preferences.securityAuditEnabled===false)return;try{await this.db.collection('workspaces').doc(this.workspaceId).collection('audit').add({action,entity,entityId,userId:this.user.uid,email:emailKey(this.user.email),deviceId:this.deviceId||'',build:BUILD_ID,details:details?clean(details):null,createdAt:Date.now()});}catch{}}
  remoteRef(entity,entityId){return this.db.collection('workspaces').doc(this.workspaceId).collection('data').doc(`${entity}__${entityId}`);}
  async writeRemoteEntity(entity,entityId,payload,action='update'){const safe=clean(payload);await this.remoteRef(entity,entityId).set({entityType:entity,entityId,payload:safe,version:Number(safe?.version||0),updatedAt:Number(safe?.updatedAt||safe?.deletedAt||Date.now()),deletedAt:safe?.deletedAt||null,modifiedBy:this.user.uid,modifiedEmail:emailKey(this.user.email),deviceId:this.deviceId||'',build:BUILD_ID,action},{merge:false});}

  async bootstrapWorkspace(){if(!this.db||!this.workspaceId||this.syncCursor>0)return{seeded:0,remoteEmpty:false};const ref=this.db.collection('workspaces').doc(this.workspaceId).collection('data'),probe=await ref.limit(1).get();if(!probe.empty)return{seeded:0,remoteEmpty:false};if(!this.can('write'))return{seeded:0,remoteEmpty:true};let seeded=0;const snapshot=this.store.snapshot();for(const type of CLOUD_ENTITY_TYPES){if(!this.canWriteEntity(type,'create'))continue;for(const entity of(snapshot[type]||[])){if(!entity?.id)continue;await this.writeRemoteEntity(type,entity.id,entity,'bootstrap');seeded++;}}if(seeded)await this.audit('bootstrap','workspace',this.workspaceId,{seeded});return{seeded,remoteEmpty:true};}

  async markQueueDone(id){await this.store.mutate('Opération synchronisée.',state=>{const item=state.queue.find(q=>q.id===id);if(item){item.status='done';item.lastError=null;item.nextRetryAt=0;}},{queue:false,log:false,bypassPermissions:true});}
  async markQueueConflict(id){await this.store.mutate('Opération en conflit.',state=>{const item=state.queue.find(q=>q.id===id);if(item){item.status='conflict';item.lastError=null;item.nextRetryAt=0;}},{queue:false,log:false,bypassPermissions:true});}
  async markQueueFailure(id,error){const p=this.store.snapshot().preferences,max=Math.max(1,Number(p.syncRetryMax||5)),base=Math.max(5,Number(p.syncRetryBaseSeconds||15)),message=sanitizeCloudError(error);await this.store.mutate('Échec temporaire de synchronisation.',state=>{const item=state.queue.find(q=>q.id===id);if(!item)return;item.attempts=Number(item.attempts||0)+1;item.lastError=message;item.lastAttemptAt=Date.now();item.nextRetryAt=Date.now()+syncRetryDelay(item.attempts,base);item.status=item.attempts>=max?'error':'pending';},{queue:false,log:false,bypassPermissions:true});return message;}
  async retryFailed(){await this.store.mutate('Nouvelle tentative de synchronisation.',state=>{for(const item of state.queue){if(item.status==='error'){item.status='pending';item.attempts=0;item.lastError=null;item.nextRetryAt=0;}}},{queue:false,log:false,bypassPermissions:true});}
  async createConflict(entity,entityId,local,remote){const exists=this.store.list('syncConflicts').find(c=>c.status==='open'&&c.entity===entity&&c.entityId===entityId);if(exists)return exists;const suggestion=safeMergeEntity(local,remote);return this.store.upsert('syncConflicts',{entity,entityId,local:clone(local),remote:clone(remote),suggestedMerge:suggestion.canMerge?suggestion.merged:null,conflictFields:suggestion.conflicts,status:'open',detectedAt:Date.now()},{label:'Conflit de synchronisation détecté.',queue:false});}

  async pushPending(){
    const snapshot=this.store.snapshot(),now=Date.now(),pending=snapshot.queue.filter(item=>item.status==='pending'&&Number(item.nextRetryAt||0)<=now);let sent=0,conflicts=0,merged=0,errors=0,waiting=snapshot.queue.filter(item=>item.status==='pending'&&Number(item.nextRetryAt||0)>now).length;
    if(!this.can('sync'))return{sent,conflicts,merged,errors,waiting};
    for(const operation of pending){
      try{
        if(!CLOUD_ENTITY_TYPES.includes(operation.entity)){await this.markQueueDone(operation.id);continue;}if(!this.canWriteEntity(operation.entity,operation.action)){await this.markQueueDone(operation.id);continue;}
        const localEntity=this.store.get(operation.entity,operation.entityId,{includeDeleted:true});const localPayload=localEntity||operation.payload||{id:operation.entityId,deletedAt:Date.now()};const remote=await this.remoteRef(operation.entity,operation.entityId).get(),remoteData=remote.exists?remote.data():null;
        if(remoteData?.payload&&Number(remoteData.updatedAt||0)>Number(snapshot.metadata.lastSyncAt||0)&&JSON.stringify(remoteData.payload)!==JSON.stringify(clean(localPayload))){const suggestion=safeMergeEntity(localPayload,remoteData.payload);if(snapshot.preferences.syncAutoMerge!==false&&suggestion.canMerge){await this.writeRemoteEntity(operation.entity,operation.entityId,suggestion.merged,'auto-merge');await this.store.applyRemote(operation.entity,suggestion.merged);await this.markQueueDone(operation.id);await this.audit('auto-merge',operation.entity,operation.entityId);sent++;merged++;continue;}await this.createConflict(operation.entity,operation.entityId,localPayload,remoteData.payload);await this.markQueueConflict(operation.id);conflicts++;continue;}
        await this.writeRemoteEntity(operation.entity,operation.entityId,localPayload,operation.action);await this.markQueueDone(operation.id);await this.audit(operation.action,operation.entity,operation.entityId);sent++;
      }catch(error){await this.markQueueFailure(operation.id,error);errors++;}
    }
    return{sent,conflicts,merged,errors,waiting};
  }

  async pullRemote(){
    const last=this.syncCursor,since=Math.max(0,last-5000),query=this.db.collection('workspaces').doc(this.workspaceId).collection('data').where('updatedAt','>',since).orderBy('updatedAt','asc').limit(500),snap=await query.get();let pulled=0,conflicts=0,merged=0;const pending=this.store.snapshot().queue.filter(q=>q.status==='pending');
    for(const doc of snap.docs){const remote=doc.data();if(!CLOUD_ENTITY_TYPES.includes(remote.entityType)||!remote.payload?.id)continue;const p=pending.find(q=>q.entity===remote.entityType&&q.entityId===remote.entityId),local=this.store.get(remote.entityType,remote.entityId,{includeDeleted:true}),differs=JSON.stringify(clean(local||p?.payload))!==JSON.stringify(clean(remote.payload));if((p&&differs)||(last===0&&local&&differs)){const suggestion=safeMergeEntity(local||p?.payload,remote.payload);if(this.store.snapshot().preferences.syncAutoMerge!==false&&suggestion.canMerge){await this.store.applyRemote(remote.entityType,suggestion.merged);if(this.can('write'))await this.writeRemoteEntity(remote.entityType,remote.entityId,suggestion.merged,'auto-merge');merged++;pulled++;continue;}await this.createConflict(remote.entityType,remote.entityId,local||p?.payload,remote.payload);conflicts++;continue;}if(!local||Number(remote.updatedAt||0)>=Number(local.updatedAt||0)){await this.store.applyRemote(remote.entityType,remote.payload);pulled++;}}
    return{pulled,conflicts,merged};
  }

  async syncAttachmentBlobs(){
    const prefs=this.store.snapshot().preferences;if(!this.storage||!prefs.syncAttachments)return{uploaded:0,downloaded:0,attachmentErrors:0,attachmentsDeferred:false};if(!this.networkAllows({attachments:true}))return{uploaded:0,downloaded:0,attachmentErrors:0,attachmentsDeferred:true};
    let uploaded=0,downloaded=0,attachmentErrors=0;for(const type of ['photos','documents'])for(const entity of this.store.list(type)){try{const localBlob=await this.store.storage.blobGet(entity.id);if(localBlob&&!entity.cloudPath&&this.canWriteEntity(type,'update')){const path=`workspaces/${this.workspaceId}/attachments/${type}/${entity.id}`,ref=this.storage.ref(path);await ref.put(localBlob,{contentType:localBlob.type||entity.mime||'application/octet-stream',customMetadata:{entityId:entity.id,entityType:type}});const updated={...entity,cloudPath:path,cloudSyncedAt:Date.now(),updatedAt:Date.now(),version:Number(entity.version||0)+1};await this.store.applyRemote(type,updated);await this.writeRemoteEntity(type,entity.id,updated,'attachment');uploaded++;}else if(!localBlob&&entity.cloudPath){const url=await this.storage.ref(entity.cloudPath).getDownloadURL(),response=await fetch(url);if(response.ok){await this.store.storage.blobPut(entity.id,await response.blob());downloaded++;}}}catch{attachmentErrors++;}}
    return{uploaded,downloaded,attachmentErrors,attachmentsDeferred:false};
  }

  async _sync({force=false}={}){
    if(!force&&Number(this.store.snapshot().metadata.syncBackoffUntil||0)>Date.now())throw new Error('Synchronisation automatique temporairement différée après un échec réseau.');
    if(!this.status.connected||!this.user||!this.db||!this.workspaceId)throw new Error('Synchronisation indisponible : compte et exploitation cloud requis.');if(!this.networkAllows())throw new Error('Synchronisation différée par le réglage réseau.');
    await this.refreshMembership();if(!this.member)throw new Error('Vous n’êtes plus membre de cette exploitation.');await this.heartbeat();
    try{
      const bootstrap=await this.bootstrapWorkspace(),pushed=await this.pushPending(),pulled=await this.pullRemote(),attachments=await this.syncAttachmentBlobs(),completedAt=Date.now();
      await this.store.mutate('Synchronisation terminée.',state=>{state.metadata.lastSyncAt=completedAt;state.metadata.lastSyncError=null;state.metadata.syncFailureCount=0;state.metadata.syncBackoffUntil=null;state.metadata.syncCursors=state.metadata.syncCursors||{};state.metadata.syncCursors[this.workspaceId]=completedAt;state.queue=state.queue.filter(item=>item.status!=='done').slice(-1000);},{queue:false,log:false,bypassPermissions:true});
      this.lastResult={...bootstrap,...pushed,...pulled,...attachments,at:completedAt,queue:this.queueSummary()};return this.lastResult;
    }catch(error){const message=sanitizeCloudError(error);await this.store.mutate('Synchronisation interrompue.',state=>{state.metadata.lastSyncError=message;state.metadata.syncFailureCount=Number(state.metadata.syncFailureCount||0)+1;state.metadata.syncBackoffUntil=Date.now()+syncRetryDelay(Math.min(8,state.metadata.syncFailureCount),15);},{queue:false,log:false,bypassPermissions:true});await this.audit('sync-error','sync',this.workspaceId,{message});throw new Error(message);}
  }
  async sync(options={}){if(this.syncPromise)return this.syncPromise;this.syncPromise=this._sync(options).finally(()=>{this.syncPromise=null;});return this.syncPromise;}
}
