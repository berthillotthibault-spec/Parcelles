import {normalizeApiEndpoint} from './platform.js';
import {parseYieldCsv,numeric} from './yield.js';
export class MachineProvider{
 constructor({endpoint,token,canWrite=()=>false}){this.endpoint=normalizeApiEndpoint(endpoint);if(this.endpoint){const u=new URL(this.endpoint);if(u.username||u.password||u.search||u.hash)throw Error('URL sans identifiants ni paramètres.');}this.token=token;this.canWrite=canWrite;}
 async request(path,{method='GET',body}={}){if(!this.endpoint)throw Error('Backend machines/capteurs non configuré.');if(navigator.onLine===false)throw Error('Connexion Internet nécessaire.');if(method!=='GET'&&!this.canWrite())throw Error('Votre rôle ne permet pas cette action.');const token=await this.token();if(!token)throw Error('Compte cloud requis.');const response=await fetch(this.endpoint+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error(`Connexion refusée ou indisponible (HTTP ${response.status}).`);return response.json();}
 connect(){return this.request('/machines/connect',{method:'POST'});}
 disconnect(){return this.request('/machines/disconnect',{method:'POST'});}
 getMachines(){return this.request('/machines');}
 getPosition(id){return this.request(`/machines/${encodeURIComponent(id)}/position`);}
 getTelemetry(id){return this.request(`/machines/${encodeURIComponent(id)}/telemetry`);}
 getTasks(id){return this.request(`/machines/${encodeURIComponent(id)}/tasks`);}
 sendTask(id,task){return this.request(`/machines/${encodeURIComponent(id)}/tasks`,{method:'POST',body:{task}});}
 getSensors(){return this.request('/sensors');}
 getSensorHistory(id,{from,to}){return this.request(`/sensors/${encodeURIComponent(id)}/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);}
}
export function validateTelemetry(raw){if(!Array.isArray(raw)||raw.length>200)throw Error('Liste machines invalide.');return raw.map(x=>{if(!x.id||!x.name||!Number.isFinite(Date.parse(x.at))||Date.parse(x.at)>Date.now()+60000)throw Error('Horodatage ou identité machine invalide.');const n=k=>typeof x[k]==='number'&&Number.isFinite(x[k])?x[k]:null;return{id:String(x.id),name:String(x.name),at:x.at,status:String(x.status||'Inconnu'),driver:String(x.driver||''),parcelId:x.parcelId||null,workId:x.workId||null,hours:n('hours'),fuel:n('fuel'),areaHa:n('areaHa'),latitude:n('latitude'),longitude:n('longitude')};});}
export function parseSensorCsv(text){const s=parseYieldCsv(text);for(const key of ['name','type','unit','time','value'])if(!s.headers.includes(key))throw Error(`Colonne capteur obligatoire : ${key}`);if(s.rows.length>20000)throw Error('20 000 mesures maximum.');const groups=new Map();for(const{properties:p}of s.rows){const value=numeric(p.value),time=Date.parse(p.time);if(value===null||!Number.isFinite(time)||time>Date.now()+60000||!p.name||!p.unit)throw Error('Mesure capteur invalide.');const id=p.name+'|'+p.type+'|'+p.unit,g=groups.get(id)||{name:p.name,type:p.type,unit:p.unit,latitude:numeric(p.latitude),longitude:numeric(p.longitude),readings:[]};g.readings.push({time:new Date(time).toISOString(),value});groups.set(id,g);}if(groups.size>100)throw Error('100 capteurs maximum.');return[...groups.values()].map(g=>({...g,readings:g.readings.sort((a,b)=>a.time.localeCompare(b.time))}));}
export function sensorHistory(sensor,days,now=Date.now()){return sensor.readings.filter(r=>Date.parse(r.time)>=now-days*86400000&&Date.parse(r.time)<=now).slice(-2000);}
