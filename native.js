const cap=()=>globalThis.Capacitor||null;
const plugin=name=>cap()?.Plugins?.[name]||null;

export function isNativeApp(){
  try{return Boolean(cap()?.isNativePlatform?.());}catch{return false;}
}

export function nativePlatform(){
  try{return cap()?.getPlatform?.()||'web';}catch{return 'web';}
}

export function nativeCapabilities(){
  const c=cap();
  return {
    native:isNativeApp(),platform:nativePlatform(),
    app:Boolean(plugin('App')),notifications:Boolean(plugin('LocalNotifications')),
    haptics:Boolean(plugin('Haptics')),share:Boolean(plugin('Share')),
    splash:Boolean(plugin('SplashScreen')),
    biometric:Boolean(plugin('BiometricAuth')||plugin('NativeBiometric')||plugin('Biometric'))
  };
}

async function callFirst(target,names,args={}){
  if(!target)return null;
  for(const name of names){if(typeof target[name]==='function')return target[name](args);}
  return null;
}

export class NativeBridge{
  constructor(){this.listeners=[];this.initialized=false;this.lastState=null;}
  get capabilities(){return nativeCapabilities();}
  async init(){
    if(this.initialized)return this.capabilities;this.initialized=true;
    const app=plugin('App');
    if(app?.addListener){
      this.listeners.push(await app.addListener('appUrlOpen',event=>window.dispatchEvent(new CustomEvent('parcelles:deep-link',{detail:event}))));
      this.listeners.push(await app.addListener('appStateChange',event=>{this.lastState=event;window.dispatchEvent(new CustomEvent('parcelles:native-state',{detail:event}));}));
    }
    try{await plugin('SplashScreen')?.hide?.();}catch{}
    document.documentElement.dataset.nativePlatform=nativePlatform();
    return this.capabilities;
  }
  async destroy(){for(const listener of this.listeners){try{await listener.remove?.();}catch{}}this.listeners=[];this.initialized=false;}
  async haptic(style='medium'){
    const h=plugin('Haptics');if(!h)return false;
    try{if(h.impact)await h.impact({style});else if(h.vibrate)await h.vibrate({duration:35});return true;}catch{return false;}
  }
  async share({title='Parcelles',text='',url=''}={}){
    const s=plugin('Share');
    if(s?.share){await s.share({title,text,url,dialogTitle:title});return true;}
    if(navigator.share){await navigator.share({title,text,url:url||undefined});return true;}
    if(navigator.clipboard&&text){await navigator.clipboard.writeText(text);return true;}
    return false;
  }
  async requestNotificationPermission(){
    const p=plugin('LocalNotifications');
    if(p){try{return await p.requestPermissions();}catch{return {display:'denied'};}}
    if(!('Notification'in window))return {display:'unsupported'};
    try{return {display:await Notification.requestPermission()};}catch{return {display:Notification.permission};}
  }
  async scheduleNotification({id,title='Parcelles',body='',at=null,extra={}}={}){
    const p=plugin('LocalNotifications');
    if(p){
      const numericId=Math.max(1,Math.abs(Number(id)||hashCode(String(id||title)))%2147483647);
      await p.schedule({notifications:[{id:numericId,title,body,schedule:at?{at:new Date(at)}:undefined,extra}]});return true;
    }
    if(!at&&'Notification'in window&&Notification.permission==='granted'){new Notification(title,{body,icon:'./icons/icon-192.png'});return true;}
    return false;
  }
  async authenticate(reason='Ouvrir Parcelles'){
    const b=plugin('BiometricAuth')||plugin('NativeBiometric')||plugin('Biometric');
    if(!b)return {available:false,success:false,reason:'plugin-missing'};
    try{
      const available=await callFirst(b,['checkBiometry','isAvailable','getBiometricInfo'],{}).catch?.(()=>null) ?? null;
      if(available&&(available.isAvailable===false||available.available===false))return {available:false,success:false,reason:'unavailable'};
      await callFirst(b,['authenticate','verifyIdentity','verify'],{reason,title:'Parcelles',subtitle:'Accès sécurisé',description:reason});
      return {available:true,success:true};
    }catch(error){return {available:true,success:false,reason:error?.message||String(error)};}
  }
}

function hashCode(value){let h=0;for(let i=0;i<value.length;i++)h=((h<<5)-h)+value.charCodeAt(i)|0;return h;}
