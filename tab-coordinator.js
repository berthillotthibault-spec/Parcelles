// Coordination entre onglets et fenêtres de Parcelles.
// - Web Locks : un seul onglet écrit à la fois ; les autres passent en lecture seule et
//   attendent le verrou (ils le reprennent seuls quand l’onglet écrivain se ferme).
// - « Utiliser ici » vole le verrou : l’ancien écrivain bascule aussitôt en lecture seule.
// - BroadcastChannel : après chaque enregistrement, les autres onglets rechargent l’état.
// Sans Web Locks (anciens navigateurs), chaque onglet reste écrivain : le rechargement par
// BroadcastChannel et le contrôle de révision de Store.persist() évitent alors l’écrasement.
export const WRITER_LOCK='parcelles-writer';
export const STATE_CHANNEL='parcelles-state';

function randomTabId(){
  try{return globalThis.crypto?.randomUUID?.()||`tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;}
  catch{return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;}
}

export function createTabCoordinator({
  locks=globalThis.navigator?.locks,
  BroadcastChannelImpl=globalThis.BroadcastChannel,
  lockName=WRITER_LOCK,
  channelName=STATE_CHANNEL,
  tabId=randomTabId(),
  onRoleChange=()=>{},
  onMessage=()=>{}
}={}){
  let role='pending',grants=0,channel=null,release=null,waitController=null,closed=false,lockSupported=Boolean(locks&&typeof locks.request==='function');

  function setRole(next){if(closed||role===next)return;role=next;try{onRoleChange(next,{lockSupported});}catch(error){console.error('[Parcelles] changement de rôle de l’onglet impossible.',error);}}

  // Demande le verrou ; onGranted/onDenied indiquent l’issue de la demande.
  function request(options,{onGranted=()=>{},onDenied=()=>{}}={}){
    let granted=false,grant=0;
    return locks.request(lockName,options,lock=>{
      if(!lock){onDenied();return null;}
      granted=true;grant=++grants;
      if(closed)return null;
      waitController=null;setRole('writer');onGranted();
      return new Promise(resolve=>{release=resolve;});
    }).catch(error=>{
      if(closed)return;
      // Verrou volé par « Utiliser ici » dans une autre fenêtre : lecture seule et attente.
      // Seule la dernière obtention compte : une ancienne demande volée ne rétrograde pas l’onglet.
      if(granted){if(grant!==grants)return;release=null;setRole('reader');waitForLock();return;}
      if(error?.name==='AbortError')return;
      throw error;
    });
  }

  function waitForLock(){
    if(closed||waitController||!lockSupported)return;
    let controller;
    try{controller=new AbortController();}catch{return;}
    waitController=controller;
    request({signal:controller.signal}).catch(error=>{if(waitController===controller)waitController=null;console.warn('[Parcelles] attente du verrou d’écriture impossible.',error);});
  }

  function openChannel(){
    if(!BroadcastChannelImpl)return;
    try{
      channel=new BroadcastChannelImpl(channelName);
      channel.onmessage=event=>{const data=event?.data;if(!data||typeof data!=='object'||data.tabId===tabId)return;try{onMessage(data);}catch(error){console.error('[Parcelles] message d’un autre onglet ignoré.',error);}};
    }catch(error){channel=null;console.warn('[Parcelles] BroadcastChannel indisponible.',error);}
  }

  async function start(){
    openChannel();
    if(!lockSupported){setRole('writer');return role;}
    try{
      await new Promise((resolve,reject)=>{
        request({ifAvailable:true},{onGranted:resolve,onDenied:()=>{setRole('reader');waitForLock();resolve();}}).catch(reject);
      });
    }catch(error){
      // Verrous inutilisables (contexte restreint) : repli sans verrou plutôt qu’une lecture seule sans issue.
      console.warn('[Parcelles] verrou d’écriture indisponible, repli sans verrou.',error);
      lockSupported=false;setRole('writer');
    }
    return role;
  }

  // « Utiliser ici » : reprend le verrou à l’autre fenêtre.
  async function takeOver(){
    if(closed||role==='writer')return role;
    if(!lockSupported){setRole('writer');return role;}
    waitController?.abort();waitController=null;
    await new Promise((resolve,reject)=>{request({steal:true},{onGranted:resolve}).catch(reject);});
    post({type:'takeover'});
    return role;
  }

  function post(message){
    if(!channel||closed)return false;
    try{channel.postMessage({...message,tabId,at:Date.now()});return true;}
    catch(error){console.warn('[Parcelles] diffusion aux autres onglets impossible.',error);return false;}
  }

  function close(){
    closed=true;
    waitController?.abort();waitController=null;
    release?.();release=null;
    try{channel?.close();}catch{}
    channel=null;
  }

  return {
    start,takeOver,post,close,
    get role(){return role;},
    get tabId(){return tabId;},
    get lockSupported(){return lockSupported;},
    get channelSupported(){return Boolean(channel);}
  };
}
