/*
 * Lecteur SHP/DBF de secours, sans dépendance réseau.
 * Cible principale : Polygon / MultiPolygon, DBF Windows-1252, Lambert-93 (EPSG:2154).
 * Il est utilisé uniquement si shpjs est absent ou échoue.
 */

import {normalizeTextEncoding} from './text-encoding.js';

export function dbfEncoding(buffer,{cpg=''}={}){
  const explicit=normalizeTextEncoding(cpg);if(explicit)return explicit;
  const bytes=new Uint8Array(buffer),view=new DataView(buffer);
  if(bytes.length<32)throw new Error('DBF trop court.');
  // The language driver is present in DBF exports even when .cpg is absent.
  const languageEncodings={0x03:'windows-1252',0x57:'windows-1252',0x58:'windows-1252',0x59:'windows-1252',0xc8:'windows-1250',0xc9:'windows-1251',0xca:'windows-1254',0xcb:'windows-1253',0xcc:'windows-1257'};
  if(languageEncodings[bytes[29]])return languageEncodings[bytes[29]];
  const count=view.getUint32(4,true),header=view.getUint16(8,true),length=view.getUint16(10,true);
  if(header<33||header>bytes.length||length<2)throw new Error('En-tête DBF invalide.');
  // Inspect character fields only: binary headers/numbers are not text samples.
  const fields=[];let fieldOffset=1;
  for(let offset=32;offset+32<=header&&bytes[offset]!==0x0d;offset+=32){
    const size=bytes[offset+16];if(bytes[offset+11]===0x43)fields.push({offset:fieldOffset,size});fieldOffset+=size;
  }
  const utf8=new TextDecoder('utf-8',{fatal:true});
  try{
    for(let i=0;i<count;i++){
      const start=header+i*length;if(start+length>bytes.length)break;
      if(bytes[start]===0x2a)continue;
      for(const field of fields)utf8.decode(bytes.subarray(start+field.offset,start+field.offset+field.size));
    }
    return'utf-8';
  }catch{return'windows-1252';}
}
const ascii=new TextDecoder('ascii');

export function parseDbf(buffer,{cpg=''}={}){
  const view=new DataView(buffer);const bytes=new Uint8Array(buffer);const encoding=dbfEncoding(buffer,{cpg});const decoder=new TextDecoder(encoding,{fatal:true});
  if(bytes.length<32)throw new Error('DBF trop court.');
  const recordCount=view.getUint32(4,true),headerLength=view.getUint16(8,true),recordLength=view.getUint16(10,true);
  if(headerLength<33||recordLength<2||headerLength>bytes.length)throw new Error('En-tête DBF invalide.');
  const fields=[];
  for(let offset=32;offset+32<=headerLength;offset+=32){
    if(bytes[offset]===0x0d)break;
    const rawName=ascii.decode(bytes.slice(offset,offset+11)).replace(/\0.*$/,'').trim();
    const type=String.fromCharCode(bytes[offset+11]);
    const length=bytes[offset+16],decimals=bytes[offset+17];
    if(rawName)fields.push({name:rawName,type,length,decimals});
  }
  const records=[];
  for(let i=0;i<recordCount;i++){
    const start=headerLength+i*recordLength;if(start+recordLength>bytes.length)break;
    if(bytes[start]===0x2a)continue; // deleted
    let pos=start+1;const row={};
    for(const field of fields){
      const raw=decoder.decode(bytes.slice(pos,pos+field.length)).replace(/\0/g,'').trim();pos+=field.length;
      let value=raw;
      if(['N','F','B','I','Y'].includes(field.type)){
        const n=Number(raw.replace(',','.'));value=raw===''?null:(Number.isFinite(n)?n:raw);
      }else if(field.type==='L'){
        value=/^[YyTt1]/.test(raw)?true:/^[NnFf0]/.test(raw)?false:null;
      }else if(field.type==='D'&&/^\d{8}$/.test(raw)){
        value=`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
      }
      row[field.name]=value;
    }
    records.push(row);
  }
  return{records,fields,recordCount,headerLength,recordLength,encoding};
}

function closeRing(ring){
  if(!ring.length)return ring;
  const a=ring[0],b=ring[ring.length-1];
  if(a[0]!==b[0]||a[1]!==b[1])ring=[...ring,[...a]];
  return ring;
}
function signedArea(ring){
  let sum=0;for(let i=0;i<ring.length-1;i++)sum+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];return sum/2;
}

const L93={n:0.7256077650532670,c:11754255.426096,xs:700000,ys:12655612.049876,lon0:3*Math.PI/180,e:0.0818191910428158};
function latitudeFromIso(latIso,e){
  let phi=2*Math.atan(Math.exp(latIso))-Math.PI/2;
  for(let i=0;i<10;i++){
    const sin=Math.sin(phi);
    const next=2*Math.atan(Math.pow((1+e*sin)/(1-e*sin),e/2)*Math.exp(latIso))-Math.PI/2;
    if(Math.abs(next-phi)<1e-12){phi=next;break;}phi=next;
  }
  return phi;
}
export function lambert93ToWgs84(x,y){
  const r=Math.hypot(x-L93.xs,L93.ys-y);
  const gamma=Math.atan2(x-L93.xs,L93.ys-y);
  const lon=L93.lon0+gamma/L93.n;
  const latIso=-Math.log(Math.abs(r/L93.c))/L93.n;
  const lat=latitudeFromIso(latIso,L93.e);
  return[lon*180/Math.PI,lat*180/Math.PI];
}

function projectionMode(prj,bbox){
  const value=String(prj||'').toUpperCase();
  if(value.includes('2154')||value.includes('LAMBERT_93')||value.includes('LAMBERT-93')||value.includes('RGF_1993_LAMBERT'))return'lambert93';
  if(bbox&&Math.abs(bbox[0])<=180&&Math.abs(bbox[2])<=180&&Math.abs(bbox[1])<=90&&Math.abs(bbox[3])<=90)return'wgs84';
  if(bbox&&bbox[0]>100000&&bbox[0]<1400000&&bbox[1]>6000000&&bbox[1]<7300000)return'lambert93';
  return'unknown';
}

function buildGeometry(rings){
  const valid=rings.map(closeRing).filter(r=>r.length>=4);
  if(!valid.length)return null;
  // SHP convention: outer rings clockwise (negative signed area), holes counter-clockwise.
  const polygons=[];
  for(const ring of valid){
    const area=signedArea(ring);
    if(area<0||!polygons.length)polygons.push([ring]);else polygons[polygons.length-1].push(ring);
  }
  if(polygons.length===1)return{type:'Polygon',coordinates:polygons[0]};
  return{type:'MultiPolygon',coordinates:polygons};
}

export function parseShp(buffer,{prj=''}={}){
  const view=new DataView(buffer);if(buffer.byteLength<100)throw new Error('SHP trop court.');
  if(view.getInt32(0,false)!==9994)throw new Error('Signature SHP invalide.');
  const declaredType=view.getInt32(32,true);
  const bbox=[view.getFloat64(36,true),view.getFloat64(44,true),view.getFloat64(52,true),view.getFloat64(60,true)];
  const mode=projectionMode(prj,bbox);
  if(mode==='unknown')throw new Error('Projection SHP inconnue. Fournissez un fichier .prj ou un GeoJSON WGS84.');
  const transform=(x,y)=>mode==='lambert93'?lambert93ToWgs84(x,y):[x,y];
  const shapes=[];let offset=100;
  while(offset+8<=buffer.byteLength){
    const contentWords=view.getInt32(offset+4,false);const contentBytes=contentWords*2;const start=offset+8;
    if(contentBytes<4||start+contentBytes>buffer.byteLength)break;
    const shapeType=view.getInt32(start,true);
    if(shapeType===0){shapes.push(null);offset=start+contentBytes;continue;}
    if(shapeType===1){
      const x=view.getFloat64(start+4,true),y=view.getFloat64(start+12,true);shapes.push({type:'Point',coordinates:transform(x,y)});
    }else if(shapeType===5||shapeType===15||shapeType===25){
      const numParts=view.getInt32(start+36,true),numPoints=view.getInt32(start+40,true);
      if(numParts<1||numPoints<4)shapes.push(null);
      else{
        const parts=[];for(let i=0;i<numParts;i++)parts.push(view.getInt32(start+44+i*4,true));
        const pointsOffset=start+44+numParts*4;const points=[];
        for(let i=0;i<numPoints;i++){const p=pointsOffset+i*16;points.push(transform(view.getFloat64(p,true),view.getFloat64(p+8,true)));}
        const rings=parts.map((from,i)=>points.slice(from,parts[i+1]??points.length));
        shapes.push(buildGeometry(rings));
      }
    }else{
      throw new Error(`Type SHP ${shapeType} non pris en charge par le lecteur de secours (fichier annoncé ${declaredType}).`);
    }
    offset=start+contentBytes;
  }
  return{shapes,shapeType:declaredType,bbox,projection:mode};
}

export function combineShpDbf(shpResult,dbfResult){
  const count=Math.max(shpResult.shapes.length,dbfResult.records.length);const features=[];
  for(let i=0;i<count;i++){
    const geometry=shpResult.shapes[i]||null,properties=dbfResult.records[i]||{};
    if(!geometry&&Object.keys(properties).length===0)continue;
    features.push({type:'Feature',geometry,properties});
  }
  return{type:'FeatureCollection',features};
}

export function parseShpDbf({shp,dbf,prj='',cpg=''}){
  const shpResult=parseShp(shp,{prj});const dbfResult=parseDbf(dbf,{cpg});
  return{geojson:combineShpDbf(shpResult,dbfResult),diagnostic:{shapeType:shpResult.shapeType,projection:shpResult.projection,shapeCount:shpResult.shapes.length,recordCount:dbfResult.records.length,fields:dbfResult.fields.map(f=>f.name),encoding:dbfResult.encoding}};
}
