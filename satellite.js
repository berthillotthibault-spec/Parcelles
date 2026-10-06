// Satellite data is an optional, isolated cache: never part of farm records.
export const SATELLITE_CACHE='satellite-cache-v1';
export const MAX_CACHE=8, MAX_AGE=30*86400000;
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function geometryBounds(g){
  if(!g||!['Polygon','MultiPolygon'].includes(g.type))throw Error('Contour de parcelle nécessaire.');
  const rings=g.type==='Polygon'?g.coordinates:g.coordinates.flat();
  if(!Array.isArray(rings)||!rings.length)throw Error('Contour invalide.');
  const points=rings.flat();if(points.length>12000||points.length<4||points.some(p=>!Array.isArray(p)||!finite(p[0],-180,180)||!finite(p[1],-85,85)))throw Error('Contour invalide ou trop complexe.');
  for(const ring of rings)if(ring.length<4||String(ring[0])!==String(ring.at(-1)))throw Error('Contour non fermé.');
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),b=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  if(b[2]<=b[0]||b[3]<=b[1]||(b[2]-b[0])*(b[3]-b[1])*12364000000*Math.cos(b[1]*Math.PI/180)>50000000)throw Error('Contour trop grand ou invalide (emprise maximale 5 000 ha).');
  return b;
}
export function periodRange(period,now=new Date()){
  const end=new Date(now),start=new Date(now);end.setUTCHours(23,59,59,999);
  if(period==='campaign')start.setUTCFullYear(now.getUTCMonth()<7?now.getUTCFullYear()-1:now.getUTCFullYear(),7,1);
  else start.setUTCDate(start.getUTCDate()-({'7':6,'14':13,'30':29,latest:59}[period]??29));
  start.setUTCHours(0,0,0,0);return{from:start.toISOString(),to:end.toISOString()};
}
export function normalizeSeries(raw){
  if(!Array.isArray(raw)||raw.length>370)throw Error('Réponse satellite invalide.');
  const days=new Map();
  for(const row of raw){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(Date.parse(row.date)))throw Error('Date satellite invalide.');
    const r={date:row.date};for(const [key,min,max] of [['ndvi',-1,1],['ndmi',-1,1],['stdDev',0,1],['cloudCoverage',0,100],['validFraction',0,1]])r[key]=finite(row[key],min,max)?row[key]:null;
    r.usable=r.ndvi!==null&&r.validFraction!==null&&r.validFraction>=.7&&r.cloudCoverage!==null&&r.cloudCoverage<=30;days.set(r.date,r);
  }
  return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export function anomalies(series){
  const usable=series.filter(x=>x.usable),last=usable.at(-1);if(!last)return[];
  const previous=usable.slice(0,-1).filter(x=>Date.parse(last.date)-Date.parse(x.date)<=45*86400000).slice(-5),out=[];
  if(previous.length>=3){const mean=previous.reduce((s,x)=>s+x.ndvi,0)/previous.length,drop=mean-last.ndvi;if(drop>=.12&&drop>=Math.abs(mean)*.2)out.push({id:last.date+'-drop',title:'Baisse du NDVI',detail:`${last.ndvi.toFixed(2)} contre ${mean.toFixed(2)} sur ${previous.length} images récentes. Une récolte peut aussi expliquer cette baisse.`});}
  if(last.stdDev!==null&&last.stdDev>=.15)out.push({id:last.date+'-spread',title:'Parcelle hétérogène',detail:`Dispersion NDVI : ${last.stdDev.toFixed(2)}. Vérifiez sur le terrain et comparez aux interventions.`});
  return out;
}
export function endpointUrl(value){if(!value)return'';const u=new URL(value);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('Le proxy satellite doit utiliser HTTPS.');if(u.username||u.password||u.search||u.hash)throw Error('Adresse proxy invalide.');return u.href.replace(/\/$/,'');}
export function pruneCache(entries,now=Date.now()){
  let bytes=0;return entries.filter(e=>e&&e.savedAt>now-MAX_AGE).sort((a,b)=>b.savedAt-a.savedAt).filter((e,i)=>{bytes+=JSON.stringify(e).length;return i<MAX_CACHE&&bytes<6000000;});
}
export class SatelliteService{
  constructor({storage,scope,endpoint,token,fetcher=(...args)=>globalThis.fetch(...args)}){Object.assign(this,{storage,scope,endpoint,token,fetcher});this.entries=[];this.loaded=false;this.writes=Promise.resolve();}
  async init(){if(!this.loaded){this.entries=pruneCache(await this.storage.get(SATELLITE_CACHE)||[]);this.loaded=true;}}
  identity(parcel){return JSON.stringify([this.scope(),endpointUrl(this.endpoint()),parcel.id,parcel.geometry]);}
  peek(parcel,period){const candidates=this.entries.filter(e=>e.parcelId===parcel.id&&(!period||e.period===period)&&e.savedAt>Date.now()-MAX_AGE);if(!candidates.length)return;const key=this.identity(parcel);return candidates.find(e=>e.key===key);}
  async save(entry){this.entries=pruneCache([entry,...this.entries.filter(e=>!(e.key===entry.key&&e.period===entry.period))]);if(!this.storage.usingFallback){const snapshot=structuredClone(this.entries);this.writes=this.writes.catch(()=>{}).then(()=>this.storage.set(SATELLITE_CACHE,snapshot));try{await this.writes;}catch{entry.cacheWarning='Cache indisponible : ces données ne sont conservées que dans cette session.';}}return entry;}
  async request(body,signal){const endpoint=endpointUrl(this.endpoint());if(!endpoint)throw Error('Configuration nécessaire : renseignez le proxy Satellite dans config.js.');if(globalThis.navigator?.onLine===false)throw Error('Hors connexion : seules les données déjà chargées sont disponibles.');const token=await this.token();if(!token)throw Error('Connectez-vous au compte cloud autorisé pour utiliser le satellite.');const response=await this.fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal});if(!response.ok)throw Error(response.status===401||response.status===403?'Compte non autorisé pour ce service satellite.':`Service satellite indisponible (HTTP ${response.status}).`);if(Number(response.headers.get('content-length'))>2500000)throw Error('Réponse satellite trop volumineuse.');return response;}
  async load(parcel,period,{refresh=false,signal}={}){geometryBounds(parcel.geometry);await this.init();const key=this.identity(parcel),cached=this.peek(parcel,period);if(cached&&(!refresh||globalThis.navigator?.onLine===false))return cached;const range=periodRange(period),response=await this.request({operation:'series',geometry:parcel.geometry,...range},signal),payload=await response.json();const entry={key,parcelId:parcel.id,period,savedAt:Date.now(),range,series:normalizeSeries(payload.series),ignored:cached?.ignored||[],images:{}};if(entry.series.some(r=>r.date<range.from.slice(0,10)||r.date>range.to.slice(0,10)))throw Error('Dates hors de la période demandée.');return this.save(entry);}
  async image(parcel,entry,kind,signal){const date=entry.series.filter(r=>r.usable).at(-1)?.date;if(!date)throw Error('Aucune image exploitable.');if(entry.images?.[kind])return entry.images[kind];const response=await this.request({operation:'image',geometry:parcel.geometry,date,kind},signal);if(!response.headers.get('content-type')?.includes('image/png'))throw Error('Image satellite invalide.');const blob=await response.blob();if(blob.size>1500000)throw Error('Image trop volumineuse.');const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});entry.images={...entry.images,[kind]:url};await this.save(entry);return url;}
  async ignore(entry,id){entry.ignored=[...new Set([...(entry.ignored||[]),id])].slice(-20);await this.save(entry);}
}
// The Process raster is masked by the parcel and clear SCL pixels. Values are
// encoded by the Worker, not inferred from a photograph. Points are real samples.
export async function rasterView(url,kind,bounds){
  const img=new Image();img.src=url;await img.decode();if(img.width>512||img.height>512)throw Error('Dimensions satellite invalides.');
  const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);const frame=ctx.getImageData(0,0,img.width,img.height),pixels=frame.data,cells=Array.from({length:9},()=>[]);let sum=0,count=0;
  for(let i=0;i<pixels.length;i+=4){if(!pixels[i+3])continue;const x=(i/4)%img.width,y=Math.floor(i/4/img.width),ndvi=pixels[i]/255*2-1,value=pixels[i+(kind==='ndmi'?1:0)]/255*2-1;sum+=ndvi;count++;cells[Math.min(2,Math.floor(y/img.height*3))*3+Math.min(2,Math.floor(x/img.width*3))].push({x,y,ndvi});const t=Math.max(0,Math.min(1,(value+.2)/1.1));pixels[i]=Math.round(190*(1-t)+25*t);pixels[i+1]=Math.round(80*(1-t)+155*t);pixels[i+2]=kind==='ndmi'?Math.round(60+160*t):45;}
  ctx.putImageData(frame,0,0);const labels=['Nord-ouest','Nord','Nord-est','Ouest','Centre','Est','Sud-ouest','Sud','Sud-est'],zones=[];
  if(count>=90)cells.forEach((cell,index)=>{if(cell.length<10)return;const mean=cell.reduce((s,p)=>s+p.ndvi,0)/cell.length;if(sum/count-mean<.15)return;const points=cell.filter(p=>p.ndvi<sum/count-.15).filter((_,i)=>i%Math.max(1,Math.ceil(cell.length/100))===0).map(p=>[bounds[0]+(p.x+.5)/img.width*(bounds[2]-bounds[0]),bounds[3]-(p.y+.5)/img.height*(bounds[3]-bounds[1])]);if(points.length)zones.push({id:'zone-'+index,title:labels[index]+' : zone à vérifier',detail:`NDVI moyen de ce secteur : ${mean.toFixed(2)}, contre ${(sum/count).toFixed(2)} sur l’aperçu. Échantillons de résolution limitée.`,geometry:{type:'MultiPoint',coordinates:points}});});
  return{url:canvas.toDataURL('image/png'),zones};
}
