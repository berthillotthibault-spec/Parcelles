import {haversineMeters, isoDate, normalize, pointInGeometry, toNullableNumber, uid} from './utils.js';

export const INTEGRATION_VERSION='7.0';
export const SUPPORTED_INTEGRATION_EXTENSIONS=['.gpx','.kml','.csv','.txt','.xml'];

function decodeXml(value=''){
  return String(value).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
}
function tagValue(block,tag){
  const m=String(block||'').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,'i'));
  return m?decodeXml(m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')):'';
}
function number(value){const n=toNullableNumber(value);return Number.isFinite(n)?n:null;}
function point(lat,lon,time=null,extra={}){
  const latitude=number(lat),longitude=number(lon);
  if(latitude===null||longitude===null||latitude<-90||latitude>90||longitude<-180||longitude>180)return null;
  return {latitude,longitude,time:time||null,...extra};
}
function parsePointTags(xml,tag){
  const rows=[];const re=new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`,'gi');let match;
  while((match=re.exec(xml))){
    const attrs=match[1],body=match[2];
    const lat=attrs.match(/\blat=["']([^"']+)["']/i)?.[1];
    const lon=attrs.match(/\blon=["']([^"']+)["']/i)?.[1];
    const p=point(lat,lon,tagValue(body,'time'),{elevation:number(tagValue(body,'ele')),name:tagValue(body,'name')||''});
    if(p)rows.push(p);
  }
  return rows;
}
function bounds(points){
  if(!points.length)return null;
  return {minLat:Math.min(...points.map(p=>p.latitude)),minLon:Math.min(...points.map(p=>p.longitude)),maxLat:Math.max(...points.map(p=>p.latitude)),maxLon:Math.max(...points.map(p=>p.longitude))};
}
export function traceDistanceMeters(points=[]){
  let total=0;for(let i=1;i<points.length;i++)total+=haversineMeters(points[i-1],points[i]);return Number.isFinite(total)?total:0;
}
export function traceDurationMs(points=[]){
  const times=points.map(p=>p.time?new Date(p.time).getTime():NaN).filter(Number.isFinite);
  return times.length>1?Math.max(0,Math.max(...times)-Math.min(...times)):0;
}
function traceSummary(points=[]){
  const distanceMeters=traceDistanceMeters(points),durationMs=traceDurationMs(points);
  return {pointCount:points.length,distanceMeters,durationMs,averageSpeedKmh:durationMs>0?(distanceMeters/(durationMs/3600000))/1000:0,bounds:bounds(points),startedAt:points.find(p=>p.time)?.time||null,endedAt:[...points].reverse().find(p=>p.time)?.time||null};
}

export function parseGpx(text,{name='Trace GPX'}={}){
  const xml=String(text||'');if(!/<gpx\b/i.test(xml))throw new Error('Fichier GPX invalide.');
  const traces=[];let index=0;const trkRe=/<trk\b[^>]*>([\s\S]*?)<\/trk>/gi;let trk;
  while((trk=trkRe.exec(xml))){
    const body=trk[1],points=parsePointTags(body,'trkpt');if(!points.length)continue;
    traces.push({id:uid('trace'),name:tagValue(body,'name')||`${name} ${++index}`,kind:'track',points,...traceSummary(points)});
  }
  const rteRe=/<rte\b[^>]*>([\s\S]*?)<\/rte>/gi;let rte;
  while((rte=rteRe.exec(xml))){const body=rte[1],points=parsePointTags(body,'rtept');if(points.length)traces.push({id:uid('trace'),name:tagValue(body,'name')||`${name} route`,kind:'route',points,...traceSummary(points)});}
  const waypoints=parsePointTags(xml,'wpt');
  return {format:'GPX',traces,waypoints,summary:{traces:traces.length,waypoints:waypoints.length,points:traces.reduce((s,t)=>s+t.points.length,0)}};
}

function parseKmlCoordinates(raw){
  return decodeXml(raw).trim().split(/\s+/).map(chunk=>chunk.split(',')).map(parts=>point(parts[1],parts[0],null,{elevation:number(parts[2])})).filter(Boolean);
}
export function parseKml(text,{name='Trace KML'}={}){
  const xml=String(text||'');if(!/<kml\b/i.test(xml))throw new Error('Fichier KML invalide.');
  const traces=[];let index=0;const placemarkRe=/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;let pm;
  const waypoints=[];
  while((pm=placemarkRe.exec(xml))){
    const body=pm[1],label=tagValue(body,'name')||`${name} ${++index}`;
    const line=body.match(/<LineString\b[^>]*>[\s\S]*?<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/i);
    if(line){const points=parseKmlCoordinates(line[1]);if(points.length)traces.push({id:uid('trace'),name:label,kind:'track',points,...traceSummary(points)});}
    const p=body.match(/<Point\b[^>]*>[\s\S]*?<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Point>/i);
    if(p){const pts=parseKmlCoordinates(p[1]);if(pts[0])waypoints.push({...pts[0],name:label});}
  }
  return {format:'KML',traces,waypoints,summary:{traces:traces.length,waypoints:waypoints.length,points:traces.reduce((s,t)=>s+t.points.length,0)}};
}

function splitDelimitedLine(line,delimiter){
  const result=[];let current='',quoted=false;
  for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){current+='"';i++;}else quoted=!quoted;}else if(ch===delimiter&&!quoted){result.push(current);current='';}else current+=ch;}result.push(current);return result.map(x=>x.trim());
}
function detectDelimiter(header){const counts={';':(header.match(/;/g)||[]).length,',':(header.match(/,/g)||[]).length,'\t':(header.match(/\t/g)||[]).length};return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||';';}
function headerIndex(headers,candidates){const normalized=headers.map(normalize);for(const candidate of candidates){const i=normalized.findIndex(h=>h===normalize(candidate)||h.includes(normalize(candidate)));if(i>=0)return i;}return -1;}
export function parseDelimitedIntegration(text,{name='Import CSV'}={}){
  const lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim());if(lines.length<2)throw new Error('Le fichier délimité ne contient pas assez de lignes.');
  const delimiter=detectDelimiter(lines[0]),headers=splitDelimitedLine(lines[0],delimiter),rows=lines.slice(1).map(line=>splitDelimitedLine(line,delimiter));
  const latI=headerIndex(headers,['latitude','lat']),lonI=headerIndex(headers,['longitude','lon','lng']),timeI=headerIndex(headers,['timestamp','datetime','date heure','time','date']),speedI=headerIndex(headers,['speed','vitesse']);
  const tempI=headerIndex(headers,['temperature','temp']),rainI=headerIndex(headers,['rain','pluie','precipitation']),windI=headerIndex(headers,['wind','vent','windspeed']),humidityI=headerIndex(headers,['humidity','humidite']);
  const opI=headerIndex(headers,['operation','travail','type']),machineI=headerIndex(headers,['machine','materiel','equipment']),parcelI=headerIndex(headers,['parcelle','parcel','field']);
  const points=latI>=0&&lonI>=0?rows.map(row=>point(row[latI],row[lonI],timeI>=0?row[timeI]:null,{speedKmh:speedI>=0?number(row[speedI]):null})).filter(Boolean):[];
  const stationReadings=(tempI>=0||rainI>=0||windI>=0||humidityI>=0)?rows.map(row=>({time:timeI>=0?row[timeI]||null:null,temperature:tempI>=0?number(row[tempI]):null,rainMm:rainI>=0?number(row[rainI]):null,windKmh:windI>=0?number(row[windI]):null,humidity:humidityI>=0?number(row[humidityI]):null})).filter(r=>Object.values(r).some(v=>v!==null&&v!=='')):[];
  const machineRows=(opI>=0||machineI>=0||parcelI>=0)?rows.map(row=>({operation:opI>=0?row[opI]||'':'',machine:machineI>=0?row[machineI]||'':'',parcel:parcelI>=0?row[parcelI]||'':'',time:timeI>=0?row[timeI]||null:null})).filter(r=>r.operation||r.machine||r.parcel):[];
  return {format:'CSV',headers,delimiter,traces:points.length?[{id:uid('trace'),name,kind:'machine',points,...traceSummary(points)}]:[],waypoints:[],stationReadings,machineRows,summary:{traces:points.length?1:0,waypoints:0,points:points.length,stationReadings:stationReadings.length,machineRows:machineRows.length}};
}

export function inspectAgriculturalText(name,text){
  const ext=(String(name||'').toLowerCase().match(/\.[a-z0-9]+$/)?.[0]||'');
  if(ext==='.gpx')return parseGpx(text,{name:String(name).replace(/\.gpx$/i,'')});
  if(ext==='.kml')return parseKml(text,{name:String(name).replace(/\.kml$/i,'')});
  if(ext==='.csv'||ext==='.txt')return parseDelimitedIntegration(text,{name:String(name).replace(/\.[^.]+$/,'')});
  if(ext==='.xml'){
    if(/<gpx\b/i.test(text))return parseGpx(text,{name:String(name).replace(/\.xml$/i,'')});
    if(/<ISO11783_TaskData\b|<TaskData\b|<TSK\b/i.test(text))return {format:'ISOXML',traces:[],waypoints:[],stationReadings:[],machineRows:[],summary:{traces:0,waypoints:0,points:0,stationReadings:0,machineRows:0},warning:'ISOXML détecté. Parcelles 7.0 conserve le fichier comme import machine mais ne transforme pas encore les tâches ISOXML en interventions.'};
    throw new Error('XML non reconnu. Les formats XML pris en charge sont GPX et la détection ISOXML.');
  }
  throw new Error(`Format ${ext||'inconnu'} non pris en charge. Utilisez GPX, KML, CSV/TXT ou XML.`);
}

export function matchTraceToParcels(trace,parcels=[]){
  const points=trace?.points||[];if(!points.length)return [];
  const counts=new Map();
  for(const p of points){for(const parcel of parcels){if(parcel.deletedAt||!parcel.geometry)continue;if(pointInGeometry(p.longitude,p.latitude,parcel.geometry)){counts.set(parcel.id,(counts.get(parcel.id)||0)+1);break;}}}
  return [...counts.entries()].map(([parcelId,pointCount])=>({parcelId,pointCount,share:pointCount/points.length})).sort((a,b)=>b.pointCount-a.pointCount);
}

export function buildTraceWorkSuggestions(trace,matches=[],{type='Travail GPS',trackId=null}={}){
  const durationHours=(trace?.durationMs||0)/3600000;const date=isoDate(trace?.startedAt||Date.now());
  return matches.filter(m=>m.share>=0.05).map(match=>({parcelId:match.parcelId,date,type,status:'Brouillon',duration:durationHours?Number((durationHours*match.share).toFixed(2)):null,source:'gps-integration',gpsTrackId:trackId||trace?.id||null,notes:`Suggestion issue d’une trace GPS : ${Math.round(match.share*100)} % des points dans la parcelle.`,integrationConfidence:Number(match.share.toFixed(4))}));
}

export function stationSummary(readings=[]){
  const valid=readings||[];const temperatures=valid.map(r=>r.temperature).filter(Number.isFinite),rain=valid.map(r=>r.rainMm).filter(Number.isFinite),wind=valid.map(r=>r.windKmh).filter(Number.isFinite),humidity=valid.map(r=>r.humidity).filter(Number.isFinite);
  const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
  return {count:valid.length,temperatureAvg:avg(temperatures),temperatureMin:temperatures.length?Math.min(...temperatures):null,temperatureMax:temperatures.length?Math.max(...temperatures):null,rainTotalMm:rain.length?rain.reduce((s,v)=>s+v,0):null,windAvgKmh:avg(wind),humidityAvg:avg(humidity),firstAt:valid.find(r=>r.time)?.time||null,lastAt:[...valid].reverse().find(r=>r.time)?.time||null};
}

export function integrationCapabilities(){
  return {gpx:true,kml:true,machineCsv:true,weatherStationCsv:true,isoxmlDetection:true,isoxmlConversion:false,satellite:false,geofoliaApi:false};
}
