/*
 * Synchronisation par entité. Aucune donnée ne part sans configuration et connexion authentifiée.
 * Pour l’activer, l’hébergeur injecte window.PARCELLES_FIREBASE_CONFIG puis fournit Firebase Auth
 * et Firestore. Chaque opération vise users/{uid}/{entity}/{entityId}, jamais un snapshot global.
 */
export class SyncService {
  constructor(store){this.store=store;this.status={configured:false,connected:false,message:'Synchronisation non configurée : les données restent uniquement sur cet appareil.'};}
  async init(){
    const config=window.PARCELLES_FIREBASE_CONFIG;
    if(!config?.apiKey){return this.status;}
    // L’intégration Firebase est volontairement conditionnelle : une clé publique seule ne constitue pas une authentification.
    if(!window.firebase?.auth || !window.firebase?.firestore){this.status={configured:true,connected:false,message:'Configuration détectée, mais les bibliothèques sécurisées Firebase sont absentes.'};return this.status;}
    this.status={configured:true,connected:false,message:'Connectez-vous à un compte Firebase pour activer la synchronisation.'};
    return this.status;
  }
  async sync(){
    if(!this.status.connected) throw new Error('Synchronisation indisponible : authentification requise.');
    /* La mise en œuvre hôte doit exécuter les opérations de store.queue une par une et comparer
       version/updatedAt avant écriture. En cas de divergence, elle crée un conflit visible au lieu d’écraser la donnée. */
  }
}
