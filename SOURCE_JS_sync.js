/*
 * Synchronisation par entité, volontairement désactivée sans authentification.
 * Aucune synchronisation par snapshot global : chaque entité est versionnée et conflictable.
 */
export class SyncService{
  constructor(store){this.store=store;this.status={configured:false,connected:false,message:'Synchronisation non configurée : les données restent sur cet appareil.'};this.user=null;this.db=null;}

  async init(){
    const enabled=this.store.snapshot().preferences.syncEnabled;const config=window.PARCELLES_FIREBASE_CONFIG;
    if(!enabled){this.status={configured:false,connected:false,message:'Synchronisation désactivée.'};return this.status;}
    if(!config?.apiKey){this.status={configured:false,connected:false,message:'Synchronisation demandée, mais aucun fournisseur cloud n’est configuré.'};return this.status;}
    if(!window.firebase?.auth||!window.firebase?.firestore){this.status={configured:true,connected:false,message:'Configuration cloud détectée, bibliothèques Firebase absentes.'};return this.status;}
    try{
      if(!window.firebase.apps?.length)window.firebase.initializeApp(config);
      this.db=window.firebase.firestore();
      const auth=window.firebase.auth();
      await new Promise(resolve=>{const stop=auth.onAuthStateChanged(user=>{stop();this.user=user;resolve();});setTimeout(resolve,4000);});
      this.status=this.user?{configured:true,connected:true,message:`Connecté : ${this.user.email||this.user.uid}`}:{configured:true,connected:false,message:'Connectez-vous pour activer la synchronisation.'};
    }catch(error){this.status={configured:true,connected:false,message:`Synchronisation indisponible : ${error.message}`};}
    return this.status;
  }

  async sync(){
    if(!this.status.connected||!this.user||!this.db)throw new Error('Synchronisation indisponible : authentification requise.');
    const snapshot=this.store.snapshot();const pending=snapshot.queue.filter(item=>item.status==='pending');let sent=0,conflicts=0;
    for(const operation of pending){
      const ref=this.db.collection('users').doc(this.user.uid).collection(operation.entity).doc(operation.entityId);
      const remote=await ref.get();const remoteData=remote.exists?remote.data():null;const localPayload=operation.payload||{};
      if(remoteData&&remoteData.version>Number(localPayload.version||0)&&remoteData.updatedAt>Number(localPayload.updatedAt||0)){
        await this.store.upsert('syncConflicts',{entity:operation.entity,entityId:operation.entityId,local:localPayload,remote:remoteData,status:'open'},{label:'Conflit de synchronisation détecté.',queue:false});conflicts++;continue;
      }
      if(operation.action==='delete')await ref.set({...localPayload,deletedAt:localPayload.deletedAt||Date.now()},{merge:true});else await ref.set(localPayload,{merge:true});sent++;
      await this.store.mutate('Opération synchronisée.',state=>{const item=state.queue.find(q=>q.id===operation.id);if(item)item.status='done';state.metadata.lastSyncAt=Date.now();},{queue:false,log:false});
    }
    return{sent,conflicts};
  }
}
