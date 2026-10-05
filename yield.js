import {pointInGeometry,uid} from './utils.js';
import {readImportText} from './text-encoding.js';
import {createZip,readZip} from './zip-lite.js';
export const YIELD_LIMIT=20000,FILE_LIMIT=8*1024*1024;
export const YIELD_FIELDS={longitude:'Longitude (WGS84)',latitude:'Latitude (WGS84)',yield:'Rendement',humidity:'Humidité (%)',speed:'Vitesse (km/h)',width:'Largeur (m)',date:'Date',time:'Heure',machine:'Machine',crop:'Culture'};
export const DEFAULT_RULES={minYield:.01,maxYield:25,maxSpeed:25,spikes:true};
const key=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function parseYieldCsv(text){
  const input=String(text).replace(/^\uFEFF/,'');if(!input.trim())throw Error('CSV vide.');
  const counts={';':0,',':0,'\t':0};let inQuote=false;for(let i=0;i<input.length;i++){const ch=input[i];if(ch==='\"'){if(inQuote&&input[i+1]==='\"')i++;else inQuote=!inQuote;}else if(!inQuote){if(ch==='\n'||ch==='\r')break;if(ch in counts)counts[ch]++;}}const separator=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
  let field='',row=[],quoted=false,closed=false;const matrix=[];
  const endField=()=>{row.push(field);field='';closed=false;};
  const endRow=()=>{endField();if(row.some(v=>v.trim()))matrix.push(row);row=[];if(matrix.length>YIELD_LIMIT+1)throw Error(`Maximum ${YIELD_LIMIT} points par import.`);};
  for(let i=0;i<input.length;i++){const c=input[i];if(quoted){if(c==='"'){if(input[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
    if(c==='"'){if(field||closed)throw Error('Guillemets CSV invalides.');quoted=true;}else if(c===separator)endField();else if(c==='\n'||c==='\r'){if(c==='\r'&&input[i+1]==='\n')i++;endRow();}else{if(closed&&c.trim())throw Error('CSV mal formé.');if(!closed)field+=c;}}
  if(quoted)throw Error('Guillemets CSV non fermés.');endRow();
  const headers=matrix.shift()?.map(h=>h.trim())||[];if(headers.length<2||headers.some(h=>!h)||new Set(headers).size!==headers.length)throw Error('En-têtes CSV manquants ou dupliqués.');
  if(!matrix.length)throw Error('Aucun point dans le fichier.');
  if(matrix.some(r=>r.length!==headers.length))throw Error('Nombre de colonnes incohérent. Vérifiez le séparateur et les guillemets.');
  return{headers,rows:matrix.map(values=>({properties:Object.fromEntries(headers.map((h,i)=>[h,values[i]]))})),format:'csv'};
}
export async function readYieldFiles(files){
  if(!files.length||files.reduce((s,f)=>s+f.size,0)>FILE_LIMIT)throw Error('Sélectionnez un fichier ou jeu SHP de 8 Mo maximum.');
  if(files.length===1&&/\.csv$/i.test(files[0].name))return parseYieldCsv(await readImportText(files[0]));
  if(!files.every(f=>/\.(shp|shx|dbf|prj|cpg)$/i.test(f.name)))throw Error('Formats acceptés : CSV ou jeu SHP de points.');
  const {readYieldShapefile}=await import('./import-export.js');const rows=await readYieldShapefile(files);
  if(!rows.length||rows.length>YIELD_LIMIT)throw Error(`Le fichier doit contenir 1 à ${YIELD_LIMIT} points.`);
  if(rows.some(r=>r.geometry?.type!=='Point'))throw Error('Seuls les SHP de points sont pris en charge pour les rendements.');
  return{rows,headers:[...new Set(rows.flatMap(r=>Object.keys(r.properties)))],format:'shp'};
}
export function suggestMapping(headers){const aliases={longitude:['longitude','lon','lng','x'],latitude:['latitude','lat','y'],yield:['rendement','yield','yieldtha','rendtha'],humidity:['humidite','humidity','moisture'],speed:['vitesse','speed'],width:['largeur','width'],date:['date'],time:['heure','time'],machine:['machine'],crop:['culture','crop']};return Object.fromEntries(Object.entries(aliases).map(([k,names])=>[k,headers.find(h=>names.includes(key(h)))||'']));}
export function numeric(value){if(value===null||value===undefined||String(value).trim()==='')return null;const s=String(value).trim().replace(/\s/g,'').replace(',','.');if(!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(s))return null;const n=Number(s);return Number.isFinite(n)?n:null;}
export function validateYieldConfig(source,config){const m=config.mapping||{},r=config.rules||{};
  if(!m.yield||!source.headers.includes(m.yield))throw Error('Associez la colonne Rendement.');
  if(source.format==='csv'&&(!source.headers.includes(m.longitude)||!source.headers.includes(m.latitude)||m.longitude===m.latitude))throw Error('Associez deux colonnes distinctes Longitude et Latitude (WGS84).');
  if(!['t/ha','kg/ha','q/ha'].includes(config.unit))throw Error('Choisissez une unité de rendement.');
  if(!Number.isFinite(r.minYield)||!Number.isFinite(r.maxYield)||r.minYield<0||r.maxYield<=r.minYield||!Number.isFinite(r.maxSpeed)||r.maxSpeed<=0)throw Error('Seuils de nettoyage invalides.');
}
export function analyzeYield(source,config,parcel){
  validateYieldConfig(source,config);if(!['Polygon','MultiPolygon'].includes(parcel?.geometry?.type))throw Error('Cette parcelle doit posséder un contour pour vérifier les points.');
  const mapping=config.mapping,rules=config.rules,factor={'t/ha':1,'kg/ha':.001,'q/ha':.1}[config.unit],seen=new Set(),points=[],excluded=[];
  source.rows.forEach((row,index)=>{const value=k=>row.properties[mapping[k]],n=k=>numeric(value(k)),longitude=source.format==='shp'?row.geometry.coordinates[0]:n('longitude'),latitude=source.format==='shp'?row.geometry.coordinates[1]:n('latitude'),raw=n('yield'),y=raw===null?null:raw*factor,speed=n('speed'),humidity=n('humidity'),width=n('width');const reasons=[];
    if(longitude===null||latitude===null||!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90)reasons.push('Coordonnées invalides');
    else if(!pointInGeometry(longitude,latitude,parcel.geometry))reasons.push('Hors parcelle');
    if(y===null)reasons.push('Rendement manquant ou invalide');else if(y<rules.minYield||y>rules.maxYield)reasons.push('Rendement hors seuils');
    if(speed!==null&&(speed<0||speed>rules.maxSpeed))reasons.push('Vitesse hors seuils');
    const duplicate=JSON.stringify([longitude,latitude,row.properties]);
    if(!reasons.length){if(seen.has(duplicate))reasons.push('Doublon');else seen.add(duplicate);}
    const p={index:index+1,longitude,latitude,yield:y,humidity:humidity!==null&&humidity>=0&&humidity<=100?humidity:null,speed,width:width!==null&&width>0?width:null,date:String(value('date')||''),time:String(value('time')||''),machine:String(value('machine')||''),crop:String(value('crop')||'')};
    if(reasons.length)excluded.push({...p,reasons});else points.push(p);
  });
  let used=points;let spikeThreshold=null;
  if(rules.spikes&&points.length>=8){const values=points.map(p=>p.yield).sort((a,b)=>a-b),median=values[Math.floor(values.length/2)],deviations=values.map(v=>Math.abs(v-median)).sort((a,b)=>a-b),mad=deviations[Math.floor(deviations.length/2)];spikeThreshold=median+Math.max(6*mad,median*.5,.5);used=[];for(const p of points)if(p.yield>spikeThreshold)excluded.push({...p,reasons:['Pic extrême (médiane + seuil robuste)']});else used.push(p);}
  const values=used.map(p=>p.yield),mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null,sd=mean===null?null:Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/values.length),humidities=used.map(p=>p.humidity).filter(v=>v!==null);
  return{points:used,excluded:excluded.sort((a,b)=>a.index-b.index),total:source.rows.length,spikeThreshold,stats:{mean,min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,cv:mean>0?sd/mean*100:null,humidity:humidities.length?humidities.reduce((a,b)=>a+b,0)/humidities.length:null,humidityCount:humidities.length,coveredHa:null}};
}
export const YIELD_CLASSES=[['Très faible','#a63628'],['Faible','#d58932'],['Moyen','#d6b840'],['Bon','#76a94e'],['Très bon','#237447']];
export function yieldClass(value,mean){const ratio=mean>0?value/mean:1;return ratio<.7?0:ratio<.9?1:ratio<=1.1?2:ratio<=1.3?3:4;}
// Group observed points into 10 m cells; no interpolation outside measurements.
export function displayYieldCells(points){const cells=new Map(),latScale=111320,lonScale=latScale*Math.cos((points[0]?.latitude||0)*Math.PI/180);for(const p of points){const key=`${Math.floor(p.longitude*lonScale/10)},${Math.floor(p.latitude*latScale/10)}`;const cell=cells.get(key)||{longitude:0,latitude:0,yield:0,count:0};cell.longitude+=p.longitude;cell.latitude+=p.latitude;cell.yield+=p.yield;cell.count++;cells.set(key,cell);}return[...cells.values()].map(c=>({...c,longitude:c.longitude/c.count,latitude:c.latitude/c.count,yield:c.yield/c.count}));}
export class YieldRepository{
  constructor(store){this.store=store;this.cache=new Map();}
  list(parcelId){return this.store.snapshot().documents.filter(d=>d.yieldMap?.version===1&&(!parcelId||d.parcelId===parcelId));}
  async source(doc){const scope=this.store.workspaceContext().key,cacheKey=scope+':'+doc.id;let source=this.cache.get(cacheKey);if(source)return source;const blob=await this.store.storage.blobGet(doc.id);if(!blob)throw Error('Fichier brut absent de cet appareil. Synchronisez les pièces jointes ou restaurez une sauvegarde complète.');const entries=await readZip(blob);source=await readYieldFiles(await Promise.all(entries.map(async e=>new File([await e.arrayBuffer()],e.name))));this.cache.set(cacheKey,source);while(this.cache.size>2)this.cache.delete(this.cache.keys().next().value);return source;}
  async save(files,source,config,parcel,existing=null){const scope=this.store.workspaceContext().key;analyzeYield(source,config,parcel);if(this.store.writeGuard&&!this.store.writeGuard({entity:'documents',action:existing?'update':'create'}))throw Error('Votre rôle ne permet pas cet import.');const id=existing?.id||uid('yield');if(!existing){const blob=await createZip(files.map(f=>({name:f.name,data:f})));await this.store.storage.blobPut(id,blob);if(scope!==this.store.workspaceContext().key){await this.store.storage.blobDelete(id);throw Error('Exploitation changée : import annulé.');}}
    try{return await this.store.upsert('documents',{...existing,id,name:existing?.name||`Rendement-${files[0].name}.zip`,mime:'application/zip',mimeType:'application/zip',category:'Carte de rendement',parcelId:parcel.id,yieldMap:{version:1,...config,format:source.format,pointCount:source.rows.length,importedAt:existing?.yieldMap?.importedAt||Date.now()}},{label:existing?'Nettoyage rendement recalculé.':'Carte de rendement importée.'});}catch(e){if(!existing)await this.store.storage.blobDelete(id);throw e;}
  }
}
