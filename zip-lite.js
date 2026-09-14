const SIG_LOCAL=0x04034b50,SIG_CENTRAL=0x02014b50,SIG_EOCD=0x06054b50;
const encoder=new TextEncoder();

function u16(v,o){return v.getUint16(o,true)}
function u32(v,o){return v.getUint32(o,true)}
function write16(view,o,n){view.setUint16(o,n,true)}
function write32(view,o,n){view.setUint32(o,n>>>0,true)}

let crcTable=null;
function getCrcTable(){if(crcTable)return crcTable;crcTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}return crcTable;}
export function crc32(bytes){const table=getCrcTable();let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&0xff]^(crc>>>8);return(crc^0xffffffff)>>>0;}

function findEocd(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const min=Math.max(0,bytes.length-65557);for(let i=bytes.length-22;i>=min;i--)if(view.getUint32(i,true)===SIG_EOCD)return i;throw new Error('ZIP : répertoire central introuvable.');}
async function inflateRaw(bytes){if(typeof DecompressionStream==='undefined')throw new Error('ZIP compressé non pris en charge par ce navigateur.');const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));return new Uint8Array(await new Response(stream).arrayBuffer());}

export async function readZip(input){
  const buffer=input instanceof ArrayBuffer?input:await input.arrayBuffer();const bytes=new Uint8Array(buffer),view=new DataView(buffer);const eocd=findEocd(bytes),count=u16(view,eocd+10),centralOffset=u32(view,eocd+16),decoder=new TextDecoder('utf-8');let offset=centralOffset;const entries=[];
  for(let i=0;i<count;i++){
    if(u32(view,offset)!==SIG_CENTRAL)throw new Error('ZIP : entrée centrale invalide.');const flags=u16(view,offset+8),method=u16(view,offset+10),expectedCrc=u32(view,offset+16),compressedSize=u32(view,offset+20),uncompressedSize=u32(view,offset+24),nameLen=u16(view,offset+28),extraLen=u16(view,offset+30),commentLen=u16(view,offset+32),localOffset=u32(view,offset+42);const nameBytes=bytes.slice(offset+46,offset+46+nameLen);const name=decoder.decode(nameBytes);offset+=46+nameLen+extraLen+commentLen;if(name.endsWith('/'))continue;
    if(u32(view,localOffset)!==SIG_LOCAL)throw new Error(`ZIP : en-tête local invalide pour ${name}.`);const localNameLen=u16(view,localOffset+26),localExtraLen=u16(view,localOffset+28),dataStart=localOffset+30+localNameLen+localExtraLen;const compressed=bytes.slice(dataStart,dataStart+compressedSize);let raw;if(method===0)raw=compressed;else if(method===8)raw=await inflateRaw(compressed);else throw new Error(`ZIP : compression ${method} non prise en charge (${name}).`);if(uncompressedSize&&raw.length!==uncompressedSize)throw new Error(`ZIP : taille inattendue pour ${name}.`);if(expectedCrc!==0&&crc32(raw)!==expectedCrc)throw new Error(`ZIP : contrôle CRC invalide pour ${name}.`);
    entries.push({name,flags,method,size:raw.length,bytes:raw,arrayBuffer:()=>raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),text:(encoding='utf-8')=>new TextDecoder(encoding).decode(raw),blob:(type='application/octet-stream')=>new Blob([raw],{type})});
  }
  return entries;
}

function dosDateTime(date=new Date()){
  const year=Math.max(1980,date.getFullYear());return{date:((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate(),time:(date.getHours()<<11)|(date.getMinutes()<<5)|Math.floor(date.getSeconds()/2)};
}
function concat(parts,total){const out=new Uint8Array(total);let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;}
export async function createZip(entries){
  const locals=[],centrals=[];let localOffset=0,localTotal=0,centralTotal=0;const now=dosDateTime(new Date());
  for(const entry of entries){const nameBytes=encoder.encode(entry.name);let raw;if(entry.data instanceof Uint8Array)raw=entry.data;else if(entry.data instanceof ArrayBuffer)raw=new Uint8Array(entry.data);else if(entry.data instanceof Blob)raw=new Uint8Array(await entry.data.arrayBuffer());else raw=encoder.encode(String(entry.data??''));const crc=crc32(raw);const local=new Uint8Array(30+nameBytes.length+raw.length),lv=new DataView(local.buffer);write32(lv,0,SIG_LOCAL);write16(lv,4,20);write16(lv,6,0x0800);write16(lv,8,0);write16(lv,10,now.time);write16(lv,12,now.date);write32(lv,14,crc);write32(lv,18,raw.length);write32(lv,22,raw.length);write16(lv,26,nameBytes.length);write16(lv,28,0);local.set(nameBytes,30);local.set(raw,30+nameBytes.length);locals.push(local);
    const central=new Uint8Array(46+nameBytes.length),cv=new DataView(central.buffer);write32(cv,0,SIG_CENTRAL);write16(cv,4,20);write16(cv,6,20);write16(cv,8,0x0800);write16(cv,10,0);write16(cv,12,now.time);write16(cv,14,now.date);write32(cv,16,crc);write32(cv,20,raw.length);write32(cv,24,raw.length);write16(cv,28,nameBytes.length);write16(cv,30,0);write16(cv,32,0);write16(cv,34,0);write16(cv,36,0);write32(cv,38,0);write32(cv,42,localOffset);central.set(nameBytes,46);centrals.push(central);localOffset+=local.length;localTotal+=local.length;centralTotal+=central.length;
  }
  const eocd=new Uint8Array(22),ev=new DataView(eocd.buffer);write32(ev,0,SIG_EOCD);write16(ev,4,0);write16(ev,6,0);write16(ev,8,entries.length);write16(ev,10,entries.length);write32(ev,12,centralTotal);write32(ev,16,localTotal);write16(ev,20,0);const bytes=concat([...locals,...centrals,eocd],localTotal+centralTotal+eocd.length);return new Blob([bytes],{type:'application/zip'});
}
