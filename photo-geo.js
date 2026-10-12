// n° 14 - Photos terrain géolocalisées : logique pure, sans DOM ni stockage.
// Mini-lecteur EXIF (GPS, cap, date de prise de vue) des JPEG, nettoyage des métadonnées,
// choix de la position, rattachement à la parcelle et paires avant/après.
import {locateParcels} from './field-ops.js';

export const PHOTO_TAGS=Object.freeze(['Adventices','Maladie','Clôture','Eau','Dégât gibier']);
export const PHOTO_FRESH_MS=30000;

const u8=data=>data instanceof Uint8Array?data:data instanceof ArrayBuffer?new Uint8Array(data):ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(0);
export const isJpeg=data=>{const b=u8(data);return b.length>3&&b[0]===0xFF&&b[1]===0xD8;};

// Segments d'en-tête JPEG jusqu'au début de l'image (SOS).
function segments(b){
  const list=[];let i=2;
  while(i+4<=b.length){
    if(b[i]!==0xFF){break;}
    const marker=b[i+1];
    if(marker===0xFF){i++;continue;}
    if(marker===0xD8||marker===0x01||(marker>=0xD0&&marker<=0xD7)){i+=2;continue;}
    const len=(b[i+2]<<8)|b[i+3];if(len<2||i+2+len>b.length)break;
    list.push({marker,start:i,end:i+2+len,data:i+4});
    if(marker===0xDA)break;
    i+=2+len;
  }
  return list;
}

// Lit GPS, cap et date dans l'EXIF. Ne renvoie aucune autre métadonnée (appareil, auteur...).
export function readJpegExif(data){
  const b=u8(data);if(!isJpeg(b))return null;
  const app1=segments(b).find(s=>s.marker===0xE1&&b[s.data]===0x45&&b[s.data+1]===0x78&&b[s.data+2]===0x69&&b[s.data+3]===0x66&&b[s.data+4]===0&&b[s.data+5]===0);
  if(!app1)return null;
  const base=app1.data+6,end=app1.end;if(base+8>end)return null;
  const le=b[base]===0x49&&b[base+1]===0x49;if(!le&&!(b[base]===0x4D&&b[base+1]===0x4D))return null;
  const u16=o=>{if(base+o+2>end)throw RangeError('EXIF tronqué');return le?b[base+o]|(b[base+o+1]<<8):(b[base+o]<<8)|b[base+o+1];};
  const u32=o=>{if(base+o+4>end)throw RangeError('EXIF tronqué');return le?(b[base+o]|(b[base+o+1]<<8)|(b[base+o+2]<<16))+b[base+o+3]*16777216:b[base+o]*16777216+((b[base+o+1]<<16)|(b[base+o+2]<<8)|b[base+o+3]);};
  const SIZES={1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8};
  function ifd(offset){
    const out=new Map();if(!offset||offset+2>end-base)return out;
    const n=u16(offset);if(n>500)return out;
    for(let k=0;k<n;k++){
      const e=offset+2+k*12,tag=u16(e),type=u16(e+2),count=u32(e+4),size=(SIZES[type]||1)*count;
      const at=size>4?u32(e+8):e+8;if(count>4096||base+at+size>end)continue;
      let value;
      if(type===2){value='';for(let j=0;j<count;j++){const c=b[base+at+j];if(!c)break;value+=String.fromCharCode(c);}}
      else if(type===5||type===10){value=[];for(let j=0;j<count;j++){let num=u32(at+j*8),den=u32(at+j*8+4);if(type===10){if(num>2147483647)num-=4294967296;if(den>2147483647)den-=4294967296;}value.push(den?num/den:NaN);}}
      else if(type===3)value=count===1?u16(at):Array.from({length:count},(_,j)=>u16(at+j*2));
      else if(type===4)value=count===1?u32(at):Array.from({length:count},(_,j)=>u32(at+j*4));
      else value=count===1?b[base+at]:Array.from(b.subarray(base+at,base+at+count));
      out.set(tag,value);
    }
    return out;
  }
  try{
    if(u16(2)!==42)return null;
    const ifd0=ifd(u32(4)),gps=ifd(ifd0.get(0x8825)),exif=ifd(ifd0.get(0x8769));
    const dms=v=>Array.isArray(v)&&v.length>=1&&v.every(Number.isFinite)?(v[0]||0)+(v[1]||0)/60+(v[2]||0)/3600:null;
    let latitude=dms(gps.get(2)),longitude=dms(gps.get(4));
    if(latitude!==null&&String(gps.get(1)).toUpperCase()==='S')latitude=-latitude;
    if(longitude!==null&&String(gps.get(3)).toUpperCase()==='W')longitude=-longitude;
    const valid=latitude!==null&&longitude!==null&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180&&!(latitude===0&&longitude===0);
    const dir=gps.get(0x11),heading=Array.isArray(dir)&&Number.isFinite(dir[0])?((dir[0]%360)+360)%360:null;
    const raw=exif.get(0x9003)||ifd0.get(0x0132)||'',m=/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw);
    const takenAt=m?new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]).getTime():null;
    const orientation=Number(ifd0.get(0x0112))||1;
    return{latitude:valid?Math.round(latitude*1e7)/1e7:null,longitude:valid?Math.round(longitude*1e7)/1e7:null,heading:heading===null?null:Math.round(heading),takenAt:Number.isFinite(takenAt)?takenAt:null,orientation};
  }catch{return null;}
}

// Retire les métadonnées (EXIF/XMP APP1, IPTC APP13, commentaires) : l'image reste intacte.
export function stripJpegMetadata(data){
  const b=u8(data);if(!isJpeg(b))return b;
  const segs=segments(b),drop=segs.filter(s=>s.marker===0xE1||s.marker===0xED||s.marker===0xFE);
  if(!drop.length)return b;
  const parts=[];let pos=0;for(const s of drop){parts.push(b.subarray(pos,s.start));pos=s.end;}parts.push(b.subarray(pos));
  const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length;}
  return out;
}
export const hasJpegMetadata=data=>{const b=u8(data);return isJpeg(b)&&segments(b).some(s=>s.marker===0xE1||s.marker===0xED||s.marker===0xFE);};

const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
// Position retenue : EXIF de la photo, sinon position fraîche (moins de 30 s), sinon rien.
export function choosePhotoLocation({exif=null,fresh=null,now=Date.now(),maxAgeMs=PHOTO_FRESH_MS}={}){
  if(exif&&finite(exif.latitude)&&finite(exif.longitude))return{latitude:Number(exif.latitude),longitude:Number(exif.longitude),accuracy:null,heading:finite(exif.heading)?Number(exif.heading):null,locationSource:'exif'};
  if(fresh&&finite(fresh.latitude)&&finite(fresh.longitude)&&(!finite(fresh.timestamp)||now-Number(fresh.timestamp)<=maxAgeMs)){
    const heading=finite(fresh.heading)&&Number(fresh.heading)>=0?Math.round(Number(fresh.heading)):null;
    return{latitude:Number(fresh.latitude),longitude:Number(fresh.longitude),accuracy:finite(fresh.accuracy)?Math.round(Number(fresh.accuracy)):null,heading,locationSource:'gps'};
  }
  return null;
}

// Parcelle de la photo : contour qui contient le point, sinon la plus proche à portée de la précision.
export function parcelForPhoto(location,parcels=[],{marginM=25}={}){
  if(!location)return null;
  const rows=locateParcels(location,parcels);if(!rows.length)return null;
  const inside=rows.find(r=>r.inside);if(inside)return inside.parcel;
  const reach=marginM+(finite(location.accuracy)?Number(location.accuracy):0);
  return rows[0].distance<=reach?rows[0].parcel:null;
}

export const normalizePhotoTags=tags=>[...new Set((Array.isArray(tags)?tags:[tags]).map(t=>String(t||'').trim()).filter(Boolean))].slice(0,20);
const photoTime=p=>Number(p?.capturedAt)||Date.parse(p?.documentDate||'')||Number(p?.createdAt)||0;
export function sortPhotos(photos=[]){return[...(photos||[])].sort((a,b)=>photoTime(a)-photoTime(b));}

// Avant/après : la plus ancienne et la plus récente (au moins un jour d'écart), par étiquette si demandée.
export function beforeAfter(photos=[],{tag=null,minGapMs=864e5}={}){
  const list=sortPhotos((photos||[]).filter(p=>!tag||(p.tags||[]).includes(tag)));
  if(list.length<2)return null;
  const before=list[0],after=list.at(-1);
  return photoTime(after)-photoTime(before)>=minGapMs?{before,after,tag,days:Math.round((photoTime(after)-photoTime(before))/864e5)}:null;
}
// Étiquettes présentes, triées par fréquence.
export function photoTagCounts(photos=[]){const m=new Map();for(const p of photos||[])for(const t of p.tags||[])m.set(t,(m.get(t)||0)+1);return[...m].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'fr'));}
export const geolocatedPhotos=(photos=[])=>(photos||[]).filter(p=>finite(p.latitude)&&finite(p.longitude));
