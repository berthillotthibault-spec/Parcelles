const cap=()=>globalThis.Capacitor||null;
const plugin=name=>cap()?.Plugins?.[name]||null;
const firstPlugin=(...names)=>names.map(plugin).find(Boolean)||null;

export function isNativeApp(){
  try{return Boolean(cap()?.isNativePlatform?.());}catch{return false;}
}

export function nativePlatform(){
  try{return cap()?.getPlatform?.()||'web';}catch{return 'web';}
}

export function nativeCapabilities(){
  return {
    native:isNativeApp(),platform:nativePlatform(),
    app:Boolean(plugin('App')),notifications:Boolean(plugin('LocalNotifications')),
    haptics:Boolean(plugin('Haptics')),share:Boolean(plugin('Share')),
    splash:Boolean(plugin('SplashScreen')),camera:Boolean(plugin('Camera')),
    filesystem:Boolean(plugin('Filesystem')),keyboard:Boolean(plugin('Keyboard')),
    network:Boolean(plugin('Network')),statusBar:Boolean(plugin('StatusBar')),
    device:Boolean(plugin('Device')),geolocation:Boolean(plugin('Geolocation')),
    biometric:Boolean(firstPlugin('BiometricAuth','NativeBiometric','Biometric'))
  };
}

async function callFirst(target,names,args={}){
  if(!target)return null;
  for(const name of names){if(typeof target[name]==='function')return target[name](args);}
  return null;
}

export class NativeBridge{
  constructor(){this.listeners=[];this.initialized=false;this.lastState=null;this.lastNetwork=null;this.lastBackgroundAt=null;}
  get capabilities(){return nativeCapabilities();}
  async init(){
    if(this.initialized)return this.capabilities;
    this.initialized=true;
    document.documentElement.dataset.nativePlatform=nativePlatform();
    const app=plugin('App');
    if(app?.addListener){
      try{this.listeners.push(await app.addListener('appUrlOpen',event=>window.dispatchEvent(new CustomEvent('parcelles:deep-link',{detail:event}))));}catch{}
      try{this.listeners.push(await app.addListener('appStateChange',event=>{
        this.lastState=event;
        if(event?.isActive===false)this.lastBackgroundAt=Date.now();
        window.dispatchEvent(new CustomEvent('parcelles:native-state',{detail:{...event,backgroundAt:this.lastBackgroundAt}}));
      }));}catch{}
    }
    await this.initNotifications();
    await this.initKeyboard();
    await this.initNetwork();
    await this.configureStatusBar();
    try{await plugin('SplashScreen')?.hide?.();}catch{}
    return this.capabilities;
  }
  async initNotifications(){
    const p=plugin('LocalNotifications');if(!p)return;
    try{
      await p.registerActionTypes?.({types:[{id:'PARCELLES_ALERT',actions:[{id:'OPEN',title:'Ouvrir',foreground:true},{id:'DONE',title:'Terminer',foreground:true}]}]});
    }catch{}
    try{
      if(p.addListener)this.listeners.push(await p.addListener('localNotificationActionPerformed',event=>window.dispatchEvent(new CustomEvent('parcelles:native-notification-action',{detail:event}))));
    }catch{}
  }
  async initKeyboard(){
    const k=plugin('Keyboard');if(!k?.addListener)return;
    try{this.listeners.push(await k.addListener('keyboardWillShow',event=>{document.documentElement.dataset.keyboard='open';window.dispatchEvent(new CustomEvent('parcelles:native-keyboard',{detail:{open:true,...event}}));}));}catch{}
    try{this.listeners.push(await k.addListener('keyboardWillHide',event=>{delete document.documentElement.dataset.keyboard;window.dispatchEvent(new CustomEvent('parcelles:native-keyboard',{detail:{open:false,...event}}));}));}catch{}
  }
  async initNetwork(){
    const n=plugin('Network');if(!n)return;
    try{this.lastNetwork=await n.getStatus?.();}catch{}
    try{if(n.addListener)this.listeners.push(await n.addListener('networkStatusChange',status=>{this.lastNetwork=status;window.dispatchEvent(new CustomEvent('parcelles:native-network',{detail:status}));}));}catch{}
  }
  async configureStatusBar(){
    const s=plugin('StatusBar');if(!s)return false;
    // Un réglage non pris en charge ne doit pas empêcher les suivants ni bloquer le démarrage.
    let configured=false;
    try{if(s.setOverlaysWebView){await s.setOverlaysWebView({overlay:false});configured=true;}}catch{}
    try{if(s.setStyle){await s.setStyle({style:'DARK'});configured=true;}}catch{}
    return configured;
  }
  async destroy(){for(const listener of this.listeners){try{await listener.remove?.();}catch{}}this.listeners=[];this.initialized=false;}
  async haptic(style='medium'){
    const h=plugin('Haptics');if(!h)return false;
    try{if(h.impact)await h.impact({style:String(style||'medium').toUpperCase()});else if(h.vibrate)await h.vibrate({duration:35});return true;}catch{return false;}
  }
  async share({title='Parcelles',text='',url='',files=[]}={}){
    const s=plugin('Share');
    if(s?.share){await s.share({title,text,url,files,dialogTitle:title});return true;}
    if(navigator.share){await navigator.share({title,text,url:url||undefined,files:files?.length?files:undefined});return true;}
    if(navigator.clipboard&&text){await navigator.clipboard.writeText(text);return true;}
    return false;
  }
  async requestNotificationPermission(){
    const p=plugin('LocalNotifications');
    if(p){try{return await p.requestPermissions();}catch{return {display:'denied'};}}
    if(!('Notification'in window))return {display:'unsupported'};
    try{return {display:await Notification.requestPermission()};}catch{return {display:Notification.permission};}
  }
  async notificationPermission(){
    const p=plugin('LocalNotifications');
    try{return p?.checkPermissions?await p.checkPermissions():{display:('Notification'in window?Notification.permission:'unsupported')};}catch{return {display:'unknown'};}
  }
  async scheduleNotification({id,title='Parcelles',body='',at=null,extra={},actionTypeId='PARCELLES_ALERT'}={}){
    const p=plugin('LocalNotifications');
    if(p){
      const numericId=Math.max(1,Math.abs(Number(id)||hashCode(String(id||title)))%2147483647);
      await p.schedule({notifications:[{id:numericId,title,body,schedule:at?{at:new Date(at)}:undefined,extra,actionTypeId}]});return true;
    }
    if(!at&&'Notification'in window&&Notification.permission==='granted'){new Notification(title,{body,icon:'./icons/icon-192.png',data:extra});return true;}
    return false;
  }
  async pendingNotifications(){
    const p=plugin('LocalNotifications');if(!p?.getPending)return [];
    try{return (await p.getPending())?.notifications||[];}catch{return [];}
  }
  async cancelNotification(id){
    const p=plugin('LocalNotifications');if(!p?.cancel)return false;
    const numericId=Math.max(1,Math.abs(Number(id)||hashCode(String(id)))%2147483647);
    try{await p.cancel({notifications:[{id:numericId}]});return true;}catch{return false;}
  }
  async biometryInfo(){
    const b=firstPlugin('BiometricAuth','NativeBiometric','Biometric');
    if(!b)return {isAvailable:false,reason:'plugin-missing'};
    try{return await callFirst(b,['checkBiometry','isAvailable','getBiometricInfo'],{})||{isAvailable:true};}catch(error){return {isAvailable:false,reason:error?.message||String(error),code:error?.code||null};}
  }
  async authenticate(reason='Ouvrir Parcelles'){
    const b=firstPlugin('BiometricAuth','NativeBiometric','Biometric');
    if(!b)return {available:false,success:false,reason:'plugin-missing'};
    try{
      const available=await this.biometryInfo();
      if(available&&(available.isAvailable===false||available.available===false))return {available:false,success:false,reason:available.reason||available.code||'unavailable',info:available};
      await callFirst(b,['authenticate','verifyIdentity','verify'],{reason,cancelTitle:'Annuler',allowDeviceCredential:true,allowDeviceCredentials:true,iosFallbackTitle:'Utiliser le code',title:'Parcelles',subtitle:'Accès sécurisé',description:reason});
      return {available:true,success:true,info:available};
    }catch(error){return {available:true,success:false,reason:error?.message||String(error),code:error?.code||null};}
  }
  async capturePhoto(){
    const camera=plugin('Camera');if(!camera?.getPhoto)return {available:false};
    try{const photo=await camera.getPhoto({quality:88,allowEditing:false,resultType:'uri',saveToGallery:false,promptLabelHeader:'Ajouter une photo',promptLabelPhoto:'Photothèque',promptLabelPicture:'Appareil photo'});return {available:true,photo};}catch(error){return {available:true,cancelled:true,reason:error?.message||String(error)};}
  }
  async networkStatus(){
    const n=plugin('Network');
    try{return n?.getStatus?await n.getStatus():{connected:navigator.onLine,connectionType:navigator.onLine?'unknown':'none'};}catch{return {connected:navigator.onLine,connectionType:'unknown'};}
  }
  async deviceInfo(){
    const d=plugin('Device');
    try{return d?.getInfo?await d.getInfo():{platform:nativePlatform(),operatingSystem:navigator.platform||'web'};}catch{return {platform:nativePlatform()};}
  }
  async currentPosition(options={}){
    const g=plugin('Geolocation');
    try{if(g?.getCurrentPosition){const p=await g.getCurrentPosition({enableHighAccuracy:true,timeout:12000,...options});return {latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp};}}catch{}
    if(!navigator.geolocation)throw new Error('Géolocalisation indisponible.');
    return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp}),reject,{enableHighAccuracy:true,timeout:12000,maximumAge:3000,...options}));
  }
  async health(){
    const [notifications,biometry,network,device,pending]=await Promise.all([
      this.notificationPermission(),this.biometryInfo(),this.networkStatus(),this.deviceInfo(),this.pendingNotifications()
    ]);
    return {capabilities:this.capabilities,notifications,biometry,network,device,pendingNotifications:pending.length,lastState:this.lastState,lastBackgroundAt:this.lastBackgroundAt};
  }
}

function hashCode(value){let h=0;for(let i=0;i<value.length;i++)h=((h<<5)-h)+value.charCodeAt(i)|0;return h;}
