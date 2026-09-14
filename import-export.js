import {APP_VERSION, BUILD_ID, ENTITY_TYPES, campaignFor, checksum, clone, escapeHtml, geometryAreaHa, normalize, parseImportDate, toNullableNumber, uid, validateGeometry, validateIntervention, validateParcel} from './utils.js';
import {migrateData, normalizeEntity} from './state.js';
import {parseShpDbf} from './shapefile-fallback.js';
import {createZip, readZip} from './zip-lite.js';

const IMPORT_ENGINE_BUILD=`import-${BUILD_ID}`;
console.info('[Parcelles] importeur',IMPORT_ENGINE_BUILD);

export const FIELD_ALIASES={
  name:['NOM_PARCEL','NOM_PARCELLE','nom','name','parcelle','parcel','libelle','désignation','designation'],
  sourceId:['GUID_PARC','ID_EXTERNE','COD_PARCEL','CODE_TRACA','id','guid','identifiant','code','numero','numéro','id parcelle','id_parcelle'],
  surfaceHa:['SURFACE','surface','surface ha','surface_ha','ha','superficie','area'],
  culture:['CP_CULTU','CP_CODCULT','culture','cultures','crop','espece','espèce'],
  commune:['LIB_COMMUN','commune','ville','municipalité','municipalite'],
  ilot:['NUM_ILOT','ilot','îlot','bloc'],
  exploitant:['RAIS_SOCIA','exploitant','client','raison sociale','raison_sociale'],
  status:['statut','status','a faire','à faire'],
  type:['type','operation','opération','intervention','travail'],
  date:['date','date intervention','date_intervention'],
  product:['produit','product','intrant'],
  dose:['dose','quantite','quantité'],
  doseUnit:['unite dose','unité dose','dose_unit','doseunit'],
  cost:['cout','coût','cost','prix','montant']
};

function normalizedKey(value=''){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'').trim();}
function findField(headers,key,mapping={}){
  if(mapping[key]&&headers.includes(mapping[key]))return mapping[key];
  const byKey=new Map((headers||[]).map(header=>[normalizedKey(header),header]));
  for(const alias of FIELD_ALIASES[key]||[]){const found=byKey.get(normalizedKey(alias));if(found)return found;}
  return null;
}
function valueFromRow(row,key,headers=[],mapping={}){
  const header=findField(headers,key,mapping);if(header&&Object.prototype.hasOwnProperty.call(row,header))return row[header];
  const byKey=new Map(Object.keys(row||{}).map(k=>[normalizedKey(k),k]));
  for(const alias of FIELD_ALIASES[key]||[]){const actual=byKey.get(normalizedKey(alias));if(actual)return row[actual];}
  return undefined;
}
function objectFromRow(row,headers,mapping={}){
  const field=key=>valueFromRow(row,key,headers,mapping);
  return{
    nom:String(field('name')??'').trim(),sourceId:String(field('sourceId')??'').trim()||null,
    surfaceHa:toNullableNumber(field('surfaceHa')),culture:String(field('culture')??'').trim(),
    commune:String(field('commune')??'').trim(),ilot:String(field('ilot')??'').trim(),exploitant:String(field('exploitant')??'').trim(),
    status:String(field('status')??'').trim(),type:String(field('type')??'').trim(),date:field('date'),
    product:String(field('product')??'').trim(),dose:field('dose'),doseUnit:String(field('doseUnit')??'').trim(),cost:toNullableNumber(field('cost')),
    raw:row
  };
}

function detectCsvDelimiter(line=''){const counts={';':0,',':0,'\t':0};let quoted=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){i++;continue;}quoted=!quoted;continue;}if(!quoted&&Object.prototype.hasOwnProperty.call(counts,ch))counts[ch]++;}return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||';';}
function parseCsvInternal(text){const input=String(text||'').replace(/^\uFEFF/,'');const delimiter=detectCsvDelimiter(input.split(/\r?\n/,1)[0]||'');const matrix=[];let row=[],field='',quoted=false;for(let i=0;i<input.length;i++){const ch=input[i];if(ch==='"'){if(quoted&&input[i+1]==='"'){field+='"';i++;}else quoted=!quoted;continue;}if(!quoted&&ch===delimiter){row.push(field);field='';continue;}if(!quoted&&(ch==='\n'||ch==='\r')){if(ch==='\r'&&input[i+1]==='\n')i++;row.push(field);field='';if(row.some(v=>String(v).trim()!==''))matrix.push(row);row=[];continue;}field+=ch;}row.push(field);if(row.some(v=>String(v).trim()!==''))matrix.push(row);if(!matrix.length)return{rows:[],headers:[]};const headers=matrix.shift().map(h=>String(h).trim());const rows=matrix.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));return{rows,headers};}
function csvRows(text){
  if(window.Papa){const parsed=window.Papa.parse(text,{header:true,skipEmptyLines:'greedy',transformHeader:h=>h.trim()});const serious=parsed.errors.find(error=>error.type!=='FieldMismatch');if(serious)throw new Error(`CSV invalide : ${serious.message}`);return[{sheet:'CSV',rows:parsed.data,headers:parsed.meta.fields||[]}];}
  const parsed=parseCsvInternal(text);if(!parsed.headers.length)throw new Error('CSV vide ou sans en-tête.');return[{sheet:'CSV',rows:parsed.rows,headers:parsed.headers}];
}
function excelColumnIndex(ref='A1'){const letters=String(ref).match(/^[A-Z]+/i)?.[0]?.toUpperCase()||'A';let n=0;for(const ch of letters)n=n*26+(ch.charCodeAt(0)-64);return n-1;}
function xmlDocument(text,label='XML'){const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw new Error(`${label} invalide.`);return doc;}
function bestHeaderRow(matrix){let best=0,bestScore=-1;for(let i=0;i<Math.min(20,matrix.length);i++){const vals=(matrix[i]||[]).map(v=>String(v??'').trim()).filter(Boolean);if(!vals.length)continue;const aliases=new Set(Object.values(FIELD_ALIASES).flat().map(normalizedKey));const score=vals.reduce((n,v)=>n+(aliases.has(normalizedKey(v))?5:0),0)+Math.min(vals.length,10);if(score>bestScore){best=i;bestScore=score;}}return best;}
async function spreadsheetRowsInternal(buffer){
  const entries=await readZip(buffer),byName=new Map(entries.map(e=>[e.name.replace(/^\//,''),e]));const workbookEntry=byName.get('xl/workbook.xml'),relsEntry=byName.get('xl/_rels/workbook.xml.rels');if(!workbookEntry||!relsEntry)throw new Error('Classeur Excel incomplet.');
  const shared=[];const sharedEntry=byName.get('xl/sharedStrings.xml');if(sharedEntry){const doc=xmlDocument(await sharedEntry.text(),'Table des chaînes Excel');for(const si of [...doc.getElementsByTagName('si')])shared.push([...si.getElementsByTagName('t')].map(t=>t.textContent||'').join(''));}
  const wb=xmlDocument(await workbookEntry.text(),'Classeur Excel'),rels=xmlDocument(await relsEntry.text(),'Relations Excel');const relMap=new Map([...rels.getElementsByTagName('Relationship')].map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));const sources=[];
  for(const sheet of [...wb.getElementsByTagName('sheet')]){const name=sheet.getAttribute('name')||'Feuille',rid=sheet.getAttribute('r:id')||sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'),target=relMap.get(rid);if(!target)continue;let path=target.replace(/^\//,'');if(!path.startsWith('xl/'))path=`xl/${path.replace(/^\.\//,'')}`;const entry=byName.get(path);if(!entry)continue;const doc=xmlDocument(await entry.text(),`Feuille ${name}`),matrix=[];
    for(const rowEl of [...doc.getElementsByTagName('row')]){const r=Math.max(0,Number(rowEl.getAttribute('r')||matrix.length+1)-1);const row=matrix[r]||[];for(const cell of [...rowEl.getElementsByTagName('c')]){const ci=excelColumnIndex(cell.getAttribute('r')),type=cell.getAttribute('t')||'',v=cell.getElementsByTagName('v')[0]?.textContent??'',inline=[...cell.getElementsByTagName('t')].map(t=>t.textContent||'').join('');let value;if(type==='s')value=shared[Number(v)]??'';else if(type==='inlineStr'||type==='str')value=inline||v;else if(type==='b')value=v==='1';else value=v===''?'':Number.isFinite(Number(v))?Number(v):v;row[ci]=value;}matrix[r]=row;}
    const nonEmpty=matrix.filter(row=>row?.some(v=>String(v??'').trim()!==''));if(!nonEmpty.length)continue;const headerIndex=bestHeaderRow(nonEmpty),headers=(nonEmpty[headerIndex]||[]).map((v,i)=>String(v??'').trim()||`Colonne ${i+1}`),rows=nonEmpty.slice(headerIndex+1).map(values=>Object.fromEntries(headers.map((h,i)=>[h,values?.[i]??'']))).filter(row=>Object.values(row).some(v=>String(v??'').trim()!==''));if(rows.length)sources.push({sheet:name,rows,headers});
  }
  if(!sources.length)throw new Error('Le classeur ne contient aucune ligne exploitable.');return sources;
}
async function spreadsheetRows(buffer){
  if(window.XLSX){const workbook=window.XLSX.read(buffer,{type:'array',cellDates:true});const sources=[];for(const name of workbook.SheetNames){const rows=window.XLSX.utils.sheet_to_json(workbook.Sheets[name],{defval:'',raw:true});if(rows.length)sources.push({sheet:name,rows,headers:Object.keys(rows[0]||{})});}if(sources.length)return sources;}
  return spreadsheetRowsInternal(buffer);
}
function xmlRows(text){
  const xml=new DOMParser().parseFromString(text,'application/xml');
  const parseError=xml.querySelector('parsererror');if(parseError)throw new Error('XML invalide.');
  const candidates=[...xml.querySelectorAll('row,Row,record,Record,parcelle,Parcelle,intervention,Intervention')];
  const rows=(candidates.length?candidates:[...xml.documentElement.children]).map(node=>{
    const row={};[...node.children].forEach(child=>{row[child.localName||child.nodeName]=child.textContent?.trim()??'';});
    [...node.attributes||[]].forEach(attr=>{row[attr.name]=attr.value;});return row;
  }).filter(row=>Object.keys(row).length);
  if(!rows.length)throw new Error('Aucune ligne reconnue dans le XML.');
  return[{sheet:'XML',rows,headers:Object.keys(rows[0])}];
}
function flattenGeoJson(data){
  if(Array.isArray(data))return data.flatMap(flattenGeoJson);if(!data||typeof data!=='object')return[];
  const features=data.type==='FeatureCollection'?(data.features||[]):data.type==='Feature'?[data]:[];
  return features.map(feature=>({...feature.properties,geometry:feature.geometry||null,_feature:feature}));
}
function extensionOf(name=''){const match=String(name).toLowerCase().match(/\.[^.]+$/);return match?match[0]:'';}
function baseNameOf(name=''){return String(name).normalize('NFC').replace(/\.(shp|shx|dbf|prj|cpg)$/i,'');}
function groupLooseShapefiles(files){
  const groups=new Map();for(const file of files){const ext=extensionOf(file.name);if(!['.shp','.shx','.dbf','.prj','.cpg'].includes(ext))continue;const base=baseNameOf(file.name),key=normalize(base);if(!groups.has(key))groups.set(key,{base,files:{}});groups.get(key).files[ext.slice(1)]=file;}return[...groups.values()];
}

async function tryShpJs(payload){
  if(!window.shp)return null;
  try{return typeof payload==='object'&&!(payload instanceof ArrayBuffer)?await window.shp(payload):(window.shp.parseZip?await window.shp.parseZip(payload):await window.shp(payload));}
  catch(error){console.warn('[Parcelles] shpjs a échoué, bascule vers le lecteur interne.',error);return null;}
}
async function parseShapefileParts({name,shp,dbf,prj='',cpg=''}){
  let result=await tryShpJs({shp,dbf,prj,cpg});let engine='shpjs';let diagnostic=null;
  if(!result){const fallback=parseShpDbf({shp,dbf,prj,cpg});result=fallback.geojson;diagnostic=fallback.diagnostic;engine='interne';}
  const rows=flattenGeoJson(result);if(!rows.length)throw new Error('Aucune géométrie n’a été produite.');
  return{name,type:'geojson',value:result,engine,diagnostic};
}

async function readZipEntries(file){
  try{return await readZip(file);}catch(internalError){
    // Keep JSZip only as a compatibility fallback for unusual ZIP variants.
    if(!window.JSZip)throw new Error(`ZIP illisible : ${internalError.message}`);
    try{
      const zip=await window.JSZip.loadAsync(file);
      return Object.values(zip.files).filter(entry=>!entry.dir).map(entry=>({
        name:entry.name,
        arrayBuffer:()=>entry.async('arraybuffer'),
        text:()=>entry.async('text'),
        blob:(type='application/octet-stream')=>entry.async('blob').then(blob=>blob.type?blob:new Blob([blob],{type}))
      }));
    }catch(error){throw new Error(`ZIP illisible : ${error.message}`);}
  }
}
async function zipContent(file){
  const entries=await readZipEntries(file);
  const geo=entries.find(entry=>/\.(geo)?json$/i.test(entry.name));if(geo)return[{name:geo.name,type:'geojson',value:JSON.parse(await geo.text()),engine:'json'}];
  const csv=entries.find(entry=>/\.csv$/i.test(entry.name));if(csv)return[{name:csv.name,type:'csv',value:await csv.text(),engine:'csv'}];
  const groups=new Map();
  for(const entry of entries){const ext=extensionOf(entry.name);if(!['.shp','.shx','.dbf','.prj','.cpg'].includes(ext))continue;const base=baseNameOf(entry.name.split('/').pop()),key=normalize(base);if(!groups.has(key))groups.set(key,{base,parts:{}});groups.get(key).parts[ext.slice(1)]=entry;}
  if(!groups.size)throw new Error('Aucun jeu SHP, GeoJSON ou CSV reconnu dans le ZIP.');
  const outputs=[];
  for(const group of groups.values()){
    if(!group.parts.shp||!group.parts.dbf)throw new Error(`ZIP SHP incomplet « ${group.base} » : .shp et .dbf sont obligatoires.`);
    const shp=await group.parts.shp.arrayBuffer(),dbf=await group.parts.dbf.arrayBuffer();
    const prj=group.parts.prj?await group.parts.prj.text():'';const cpg=group.parts.cpg?await group.parts.cpg.text():'';
    outputs.push(await parseShapefileParts({name:`${group.base}.shp`,shp,dbf,prj,cpg}));
  }
  return outputs;
}
async function looseShapefileContent(group){
  const {shp,dbf,prj,cpg}=group.files;if(!shp||!dbf)throw new Error(`Jeu SHP incomplet « ${group.base} » : .shp et .dbf sont obligatoires.`);
  return parseShapefileParts({name:`${group.base}.shp`,shp:await shp.arrayBuffer(),dbf:await dbf.arrayBuffer(),prj:prj?await prj.text():'',cpg:cpg?await cpg.text():''});
}

function classifyRows(rows,state){
  const existing=state.parcelles.filter(item=>!item.deletedAt);let duplicates=0,newRows=0,changed=0;const duplicateDetails=[];
  rows.filter(row=>row.nom&&!row.type).forEach(row=>{
    const idMatch=row.sourceId&&existing.find(item=>item.sourceId&&item.sourceId===row.sourceId);
    const labelMatch=existing.find(item=>normalize(item.nom)===normalize(row.nom)&&(!row.commune||normalize(item.commune)===normalize(row.commune)));
    const match=idMatch||labelMatch;
    if(match){duplicates++;const differs=['culture','surfaceHa','commune','ilot','geometry'].some(key=>JSON.stringify(match[key]??null)!==JSON.stringify(row[key]??null));if(differs)changed++;duplicateDetails.push({row,match,reason:idMatch?'Identifiant source':'Nom + commune'});}else newRows++;
  });
  return{duplicates,newRows,changed,duplicateDetails};
}

function normalizeSources(parsed,mapping={}){
  const all=[];
  for(const source of parsed){
    for(const row of source.rows){
      const normalized={...objectFromRow(row,source.headers,mapping),geometry:row.geometry||null,_source:source.file,_sheet:source.sheet||null};
      all.push(normalized);
    }
  }
  return all;
}

export async function inspectFiles(files,state,mapping={}){
  const parsed=[],warnings=[],invalid=[];const list=[...files];const groups=groupLooseShapefiles(list),consumed=new Set();
  for(const group of groups){Object.values(group.files).forEach(file=>consumed.add(file));try{const input=await looseShapefileContent(group);const rows=flattenGeoJson(input.value),headers=Object.keys(rows[0]||{}).filter(k=>!['_feature','geometry'].includes(k));parsed.push({file:input.name,sheet:null,rows,headers,hasGeometry:true,type:'geojson',engine:input.engine,diagnostic:input.diagnostic});if(!group.files.prj)warnings.push(`${input.name} : aucun .prj fourni ; projection détectée automatiquement.`);}catch(error){invalid.push({file:`${group.base}.shp`,message:error.message});}}
  for(const file of list){
    if(consumed.has(file))continue;
    try{
      const ext=extensionOf(file.name);let sources=[];
      if(ext==='.csv'){const sets=csvRows(await file.text());sources=sets.map(s=>({file:file.name,type:'csv',...s,hasGeometry:false,engine:'PapaParse'}));}
      else if(['.xlsx','.xls'].includes(ext)){const sets=await spreadsheetRows(await file.arrayBuffer());sources=sets.map(s=>({file:file.name,type:'sheet',...s,hasGeometry:false,engine:'SheetJS'}));}
      else if(['.json','.geojson'].includes(ext)){const value=JSON.parse(await file.text()),rows=flattenGeoJson(value);sources=[{file:file.name,type:'geojson',sheet:null,rows,headers:Object.keys(rows[0]||{}).filter(k=>!['_feature','geometry'].includes(k)),hasGeometry:rows.some(r=>r.geometry),engine:'JSON'}];}
      else if(ext==='.xml'){const sets=xmlRows(await file.text());sources=sets.map(s=>({file:file.name,type:'xml',...s,hasGeometry:false,engine:'DOMParser'}));}
      else if(ext==='.zip'){const inputs=await zipContent(file);for(const input of inputs){if(input.type==='csv'){const sets=csvRows(input.value);sources.push(...sets.map(s=>({file:`${file.name}/${input.name}`,type:'csv',...s,hasGeometry:false,engine:'PapaParse'})));}else{const rows=flattenGeoJson(input.value);sources.push({file:`${file.name}/${input.name}`,type:'geojson',sheet:null,rows,headers:Object.keys(rows[0]||{}).filter(k=>!['_feature','geometry'].includes(k)),hasGeometry:true,engine:input.engine,diagnostic:input.diagnostic});}}}
      else throw new Error(`Format ${ext||'sans extension'} non pris en charge.`);
      parsed.push(...sources);
    }catch(error){invalid.push({file:file.name,message:error.message});}
  }

  const normalized=normalizeSources(parsed,mapping);const parcelCandidates=normalized.filter(row=>row.nom&&!row.type);
  const validParcels=parcelCandidates.filter(row=>!validateParcel(row).length);const probableInterventions=normalized.filter(row=>row.type&&(row.date||row.product));
  const invalidGeometry=normalized.filter(row=>row.geometry&&validateGeometry(row.geometry).length).length;
  parsed.forEach(source=>{
    if(!source.rows.length)return;const sample=source.rows[0],h=source.headers||Object.keys(sample||{}),missing=[];
    if(valueFromRow(sample,'name',h,mapping)===undefined)missing.push('nom (NOM_PARCEL)');
    if(valueFromRow(sample,'surfaceHa',h,mapping)===undefined)missing.push('surface (SURFACE)');
    if(source.hasGeometry&&valueFromRow(sample,'sourceId',h,mapping)===undefined)missing.push('identifiant (GUID_PARC)');
    if(missing.length)warnings.push(`${source.file}${source.sheet?` / ${source.sheet}`:''} : champs utiles absents : ${missing.join(', ')}.`);
  });
  if(parsed.length&&!parcelCandidates.length){const keys=[...new Set(parsed.flatMap(s=>s.headers))].slice(0,40);warnings.unshift(`Aucune parcelle nommée détectée. Utilisez la correspondance manuelle des colonnes. Champs reçus : ${keys.join(', ')||'aucun'}.`);}
  const classification=classifyRows(normalized,state);
  const surface=validParcels.reduce((sum,row)=>sum+(row.surfaceHa||0),0);
  return{
    engineBuild:IMPORT_ENGINE_BUILD,mapping,sources:parsed.map(s=>({file:s.file,sheet:s.sheet,rows:s.rows.length,type:s.type,hasGeometry:s.hasGeometry,headers:s.headers,engine:s.engine,diagnostic:s.diagnostic})),
    rows:normalized,summary:{parcels:validParcels.length,interventions:probableInterventions.length,surface,cultures:[...new Set(validParcels.map(r=>r.culture).filter(Boolean))],communes:[...new Set(validParcels.map(r=>r.commune).filter(Boolean))],geometryValid:normalized.filter(r=>r.geometry&&!validateGeometry(r.geometry).length).length,geometryInvalid:invalidGeometry,ignored:normalized.filter(r=>!r.nom&&!r.type).length,...classification},warnings,invalid
  };
}

export function previewNeedsMapping(preview){return preview.sources.length>0&&preview.summary.parcels===0&&preview.sources.some(s=>s.headers?.length);}
export function mappingOptions(preview){return[...new Set(preview.sources.flatMap(s=>s.headers||[]))].sort((a,b)=>a.localeCompare(b,'fr'));}

function parcelMatch(row,parcels){
  return(row.sourceId&&parcels.find(item=>!item.deletedAt&&item.sourceId===row.sourceId))||parcels.find(item=>!item.deletedAt&&normalize(item.nom)===normalize(row.nom)&&(!row.commune||normalize(item.commune)===normalize(row.commune)));
}

export async function applyImport(preview,store,strategy='merge'){
  const next=store.snapshot();const timestamp=Date.now();let created=0,updated=0,skipped=0,interventions=0;
  const parcelsRows=preview.rows.filter(row=>row.nom&&!row.type),workRows=preview.rows.filter(row=>row.type&&(row.date||row.product));
  const dynamicParcels=next.parcelles;
  for(const row of parcelsRows){
    const errors=validateParcel(row);if(errors.length){skipped++;continue;}
    let match=parcelMatch(row,dynamicParcels);
    if(match&&strategy==='ignore'){skipped++;continue;}
    const sourceId=match&&strategy==='new'?`${row.sourceId||normalize(row.nom)}_${uid('import').slice(-6)}`:row.sourceId;
    let entity={nom:row.nom,sourceId,surfaceHa:row.surfaceHa,culture:row.culture,commune:row.commune,ilot:row.ilot,exploitant:row.exploitant,status:row.status||match?.status||'À jour',geometry:row.geometry,source:'import',importedAt:timestamp,ownershipType:match?.ownershipType||'own',clientId:match?.clientId||null,notes:match?.notes||'',favorite:match?.favorite||false};
    if(match&&strategy!=='new'){
      if(strategy==='merge'){
        const preserved={...match};for(const [key,value] of Object.entries(entity)){if(value!==null&&value!==undefined&&value!=='')preserved[key]=value;}entity=preserved;
      }
      entity=normalizeEntity('parcelles',{...entity,id:match.id},match);const idx=dynamicParcels.findIndex(p=>p.id===match.id);dynamicParcels[idx]=entity;updated++;
    }else{
      entity=normalizeEntity('parcelles',entity);dynamicParcels.push(entity);created++;
    }
  }
  // Rebuild dynamic indexes AFTER parcels have been staged, so interventions from the same import can resolve them.
  const bySource=new Map(dynamicParcels.filter(p=>!p.deletedAt&&p.sourceId).map(p=>[p.sourceId,p]));
  const byName=new Map(dynamicParcels.filter(p=>!p.deletedAt).map(p=>[normalize(p.nom),p]));
  for(const row of workRows){
    const parcel=(row.sourceId&&bySource.get(row.sourceId))||byName.get(normalize(row.nom));if(!parcel){skipped++;continue;}
    const date=parseImportDate(row.date);if(!date){skipped++;continue;}
    const raw={parcelId:parcel.id,date,type:row.type,product:row.product,dose:row.dose,doseUnit:row.doseUnit,cost:row.cost??0,campaignId:campaignFor(date),source:'import',status:'Terminé'};
    if(validateIntervention(raw).length){skipped++;continue;}
    next.interventions.push(normalizeEntity('interventions',raw));interventions++;
  }
  const session=normalizeEntity('importSessions',{fileNames:preview.sources.map(s=>s.file),created,updated,skipped,interventions,surface:preview.summary.surface,engineBuild:preview.engineBuild,source:'local'});
  next.importSessions.push(session);next.metadata.lastImportAt=timestamp;
  await store.replaceState(next,`Import atomique terminé : ${created} création(s), ${updated} mise(s) à jour, ${interventions} travail(aux).`,{kind:'import'});
  return{created,updated,skipped,interventions,sessionId:session.id};
}

export async function makeBackup(state){
  const data=clone(state);const payload={format:'parcelles-backup-json',formatVersion:APP_VERSION,buildId:BUILD_ID,createdAt:Date.now(),application:'Parcelles',counts:ENTITY_TYPES.reduce((acc,type)=>{acc[type]=data[type]?.filter(x=>!x.deletedAt).length||0;return acc;},{}),data};payload.checksum=await checksum(payload.data);return payload;
}
export async function validateBackup(raw){
  if(!raw||!['parcelles-backup-json','parcelles-backup'].includes(raw.format)||!raw.data)throw new Error('Ce fichier n’est pas une sauvegarde Parcelles valide.');
  const validChecksum=!raw.checksum||raw.checksum===await checksum(raw.data);if(!validChecksum)throw new Error('La somme de contrôle ne correspond pas : le fichier peut être altéré.');
  return{data:migrateData(raw.data),meta:{createdAt:raw.createdAt,counts:raw.counts||{},formatVersion:raw.formatVersion,validChecksum,complete:false}};
}

export async function createCompleteBackup(store){
  const state=store.snapshot(),stateText=JSON.stringify(state,null,2),stateChecksum=await checksum(state);const entries=[];
  const attachments=[];
  for(const type of ['photos','documents']){
    for(const item of state[type]||[]){
      const blob=await store.storage.blobGet(item.id);if(!blob)continue;
      const ext=(item.name||'').match(/\.[a-z0-9]{1,8}$/i)?.[0]||'';const path=`attachments/${item.id}${ext}`;
      entries.push({name:path,data:blob});
      attachments.push({id:item.id,type,path,name:item.name||'',mimeType:item.mimeType||blob.type||'',size:blob.size});
    }
  }
  const manifest={format:'parcelles-backup-complete',formatVersion:APP_VERSION,buildId:BUILD_ID,createdAt:Date.now(),stateChecksum,attachments,counts:{parcelles:state.parcelles.filter(x=>!x.deletedAt).length,interventions:state.interventions.filter(x=>!x.deletedAt).length,photos:state.photos.filter(x=>!x.deletedAt).length,documents:state.documents.filter(x=>!x.deletedAt).length}};
  entries.unshift({name:'manifest.json',data:JSON.stringify(manifest,null,2)},{name:'state.json',data:stateText});
  return{blob:await createZip(entries),manifest};
}

export async function parseCompleteBackup(file){
  const entries=await readZipEntries(file),byName=new Map(entries.map(entry=>[entry.name,entry]));const manifestEntry=byName.get('manifest.json'),stateEntry=byName.get('state.json');
  if(!manifestEntry||!stateEntry)throw new Error('Sauvegarde ZIP incomplète : manifest.json ou state.json absent.');
  const manifest=JSON.parse(await manifestEntry.text());if(manifest.format!=='parcelles-backup-complete')throw new Error('Format de sauvegarde ZIP non reconnu.');
  const rawState=JSON.parse(await stateEntry.text());if(manifest.stateChecksum&&manifest.stateChecksum!==await checksum(rawState))throw new Error('L’état de la sauvegarde a échoué au contrôle d’intégrité.');
  const blobs=[];for(const meta of manifest.attachments||[]){const entry=byName.get(meta.path);if(entry)blobs.push({meta,blob:await entry.blob(meta.mimeType||'application/octet-stream')});}
  return{data:migrateData(rawState),blobs,meta:{...manifest,complete:true}};
}

export async function restoreCompleteBackup(parsed,store){
  await store.replaceState(parsed.data,'Sauvegarde complète restaurée.',{kind:'restore'});
  for(const item of parsed.blobs||[])await store.storage.blobPut(item.meta.id,item.blob);
}

export function exportCsv(state){
  const parcels=new Map(state.parcelles.filter(i=>!i.deletedAt).map(i=>[i.id,i]));
  const rows=state.interventions.filter(i=>!i.deletedAt).map(item=>({date:item.date,statut:item.status||'',campagne:item.campaignId,type:item.type,parcelle:parcels.get(item.parcelId)?.nom||'Parcelle supprimée',culture:item.culture||parcels.get(item.parcelId)?.culture||'',produit:item.product||'',dose:item.dose??'',unite:item.doseUnit||'',surface:item.surfaceWorked??'',cout:item.cost??0,operateur:item.operator||'',materiel:item.equipmentId||'',note:item.note||''}));
  const headers=Object.keys(rows[0]||{date:'',statut:'',campagne:'',type:'',parcelle:'',culture:'',produit:'',dose:'',unite:'',surface:'',cout:'',operateur:'',materiel:'',note:''});const quote=v=>`"${String(v??'').replaceAll('"','""')}"`;return[headers.map(quote).join(';'),...rows.map(row=>headers.map(k=>quote(row[k])).join(';'))].join('\n');
}
export function exportParcelsCsv(state){
  const clients=new Map(state.clients.filter(i=>!i.deletedAt).map(i=>[i.id,i]));const rows=state.parcelles.filter(i=>!i.deletedAt).map(p=>({nom:p.nom,surface_ha:p.surfaceHa??'',culture:p.culture||'',commune:p.commune||'',ilot:p.ilot||'',statut:p.status||'',type:p.ownershipType||'own',client:clients.get(p.clientId)?.name||'',source_id:p.sourceId||''}));const headers=Object.keys(rows[0]||{nom:'',surface_ha:'',culture:'',commune:'',ilot:'',statut:'',type:'',client:'',source_id:''});const q=v=>`"${String(v??'').replaceAll('"','""')}"`;return[headers.map(q).join(';'),...rows.map(r=>headers.map(k=>q(r[k])).join(';'))].join('\n');
}
export function exportGeoJson(state){return JSON.stringify({type:'FeatureCollection',features:state.parcelles.filter(i=>!i.deletedAt&&i.geometry).map(item=>({type:'Feature',geometry:item.geometry,properties:{id:item.id,sourceId:item.sourceId,nom:item.nom,surfaceHa:item.surfaceHa,culture:item.culture,commune:item.commune,ilot:item.ilot,status:item.status,ownershipType:item.ownershipType}}))},null,2);}

export function importPreviewHtml(preview){
  const s=preview.summary,sample=preview.rows.slice(0,10);return`<div class="preview-summary"><div class="preview-stat"><strong>${s.parcels}</strong><small>parcelles</small></div><div class="preview-stat"><strong>${s.surface.toLocaleString('fr-FR',{maximumFractionDigits:2})} ha</strong><small>surface</small></div><div class="preview-stat"><strong>${s.newRows}</strong><small>nouvelles</small></div><div class="preview-stat"><strong>${s.changed}</strong><small>modifiées</small></div><div class="preview-stat"><strong>${s.interventions}</strong><small>travaux</small></div><div class="preview-stat"><strong>${s.geometryValid}</strong><small>géométries valides</small></div></div>${preview.invalid.length?`<div class="notice danger">${preview.invalid.map(i=>`${escapeHtml(i.file)} : ${escapeHtml(i.message)}`).join('<br>')}</div>`:''}${preview.warnings.length?`<details class="notice warning"><summary>${preview.warnings.length} avertissement(s)</summary>${preview.warnings.map(escapeHtml).join('<br>')}</details>`:''}<p class="form-note">Moteur ${escapeHtml(preview.engineBuild)} · ${preview.sources.map(s=>`${escapeHtml(s.file)}${s.sheet?` / ${escapeHtml(s.sheet)}`:''} (${s.rows})${s.engine?` · ${escapeHtml(s.engine)}`:''}`).join('<br>')}</p><div class="table-wrap"><table><thead><tr><th>Nom / travail</th><th>Culture</th><th>Surface</th><th>Commune</th><th>Géométrie</th></tr></thead><tbody>${sample.map(row=>`<tr><td>${escapeHtml(row.nom||row.type||'—')}</td><td>${escapeHtml(row.culture||'—')}</td><td>${row.surfaceHa!==null?`${row.surfaceHa} ha`:'—'}</td><td>${escapeHtml(row.commune||'—')}</td><td>${row.geometry?'Oui':'—'}</td></tr>`).join('')}</tbody></table></div>`;
}
