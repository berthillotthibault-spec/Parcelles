// Decode source bytes before any lossy UTF-8 conversion can replace accents.
export function normalizeTextEncoding(label=''){
  let value=String(label??'').replace(/[\uFEFF\0]/g,'').trim().replace(/^["']|["']$/g,'').toLowerCase();
  if(!value)return'';
  if(/^(?:utf[-_ ]?8|65001|cp65001)$/.test(value))value='utf-8';
  else if(/^(?:ansi\s*|cp|windows[-_ ]?)?125[0-8]$/.test(value))value=`windows-${value.match(/125[0-8]/)[0]}`;
  else if(value==='28591')value='iso-8859-1';
  else if(value==='1200')value='utf-16le';
  else if(value==='1201')value='utf-16be';
  try{return new TextDecoder(value,{fatal:true}).encoding;}
  catch{throw new Error(`Encodage « ${label} » non pris en charge. Réexportez le fichier en UTF-8.`);}
}

export function decodeTextBytes(input,{encoding=''}={}){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  let selected=normalizeTextEncoding(encoding);
  if(!selected){
    if(bytes[0]===0xff&&bytes[1]===0xfe)selected='utf-16le';
    else if(bytes[0]===0xfe&&bytes[1]===0xff)selected='utf-16be';
    else if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)selected='utf-8';
    else{
      // XML exports can explicitly declare a legacy encoding.
      const prefix=new TextDecoder('windows-1252').decode(bytes.subarray(0,256));
      const declaration=prefix.match(/^\s*<\?xml\b[^?]*\bencoding\s*=\s*["']([^"']+)["']/i);
      if(declaration)selected=normalizeTextEncoding(declaration[1]);
    }
  }
  if(selected){
    try{return new TextDecoder(selected,{fatal:true}).decode(bytes);}
    catch{throw new Error(`Le fichier contient des caractères invalides pour l’encodage ${selected}.`);}
  }
  // File.text() always assumes UTF-8, even for the Windows/Excel CSV exports.
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{return new TextDecoder('windows-1252').decode(bytes);}
}

export async function readImportText(file){
  return typeof file.arrayBuffer==='function'?decodeTextBytes(await file.arrayBuffer()):file.text();
}
