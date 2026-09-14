import {APP_VERSION, campaignFor, checksum, clone, download, escapeHtml, geometryAreaHa, localDateTime, normalize, toNumber, uid, validateIntervention, validateParcel} from './utils.js';
import {migrateData} from './state.js';

const FIELD_ALIASES = {
  // Champs génériques + noms DBF Geofolia.
  // Les exports SHP/DBF Geofolia utilisent notamment NOM_PARCEL, GUID_PARC,
  // CP_CULTU, LIB_COMMUN et NUM_ILOT.
  name:['NOM_PARCEL','NOM_PARCELLE','nom','name','parcelle','parcel','libelle','désignation','designation'],
  sourceId:['GUID_PARC','ID_EXTERNE','COD_PARCEL','CODE_TRACA','id','guid','identifiant','code','numero','numéro','id parcelle','id_parcelle'],
  surfaceHa:['SURFACE','surface','surface ha','surface_ha','ha','superficie','area'],
  culture:['CP_CULTU','CP_CODCULT','culture','cultures','crop','espece','espèce'],
  commune:['LIB_COMMUN','commune','ville','municipalité','municipalite'],
  ilot:['NUM_ILOT','ilot','îlot','bloc'],
  status:['statut','status','a faire','à faire'],
  type:['type','operation','opération','intervention','travail'],
  date:['date','date intervention'],
  product:['produit','product','intrant'],
  dose:['dose','quantite','quantité'],
  cost:['cout','coût','cost','prix']
};

function findField(headers, key){
  // Respecte l'ordre des alias afin de choisir les bons champs Geofolia
  // lorsqu'un DBF contient plusieurs identifiants/codes possibles.
  const normalizedHeaders = new Map(headers.map(header => [normalize(header), header]));
  for (const alias of FIELD_ALIASES[key]) {
    const found = normalizedHeaders.get(normalize(alias));
    if (found) return found;
  }
  return null;
}
function objectFromRow(row, headers){
  const field = key => { const header=findField(headers,key); return header ? row[header] : undefined; };
  return {
    nom:String(field('name') || '').trim(),sourceId:String(field('sourceId') || '').trim() || null,surfaceHa:toNumber(field('surfaceHa')),
    culture:String(field('culture') || '').trim(),commune:String(field('commune') || '').trim(),ilot:String(field('ilot') || '').trim(),status:String(field('status') || '').trim(),
    type:String(field('type') || '').trim(),date:field('date'),product:String(field('product') || '').trim(),dose:field('dose'),cost:toNumber(field('cost')),
    raw:row
  };
}
function csvRows(text){
  if (!window.Papa) throw new Error('Le lecteur CSV n’est pas chargé.');
  const parsed = window.Papa.parse(text,{header:true,skipEmptyLines:'greedy',transformHeader:header => header.trim()});
  if (parsed.errors.some(error => error.type !== 'FieldMismatch')) throw new Error(`CSV invalide : ${parsed.errors[0].message}`);
  return {rows:parsed.data,headers:parsed.meta.fields || []};
}
function spreadsheetRows(buffer){
  if (!window.XLSX) throw new Error('Le lecteur Excel n’est pas chargé.');
  const workbook = window.XLSX.read(buffer,{type:'array'});
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});
  return {rows,headers:Object.keys(rows[0] || {})};
}
function flattenGeoJson(data){
  if (Array.isArray(data)) return data.flatMap(flattenGeoJson);
  if (!data || typeof data !== 'object') return [];
  const features = data.type === 'FeatureCollection' ? (data.features || []) : data.type === 'Feature' ? [data] : [];
  return features.map(feature => ({...(feature.properties || {}),geometry:feature.geometry || null,_feature:feature}));
}

function extensionOf(name=''){
  const match=String(name).toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : '';
}
function baseNameOf(name=''){
  return String(name).normalize('NFC').replace(/\.(shp|shx|dbf|prj|cpg)$/i,'');
}
function groupLooseShapefiles(files){
  const groups=new Map();
  for(const file of files){
    const ext=extensionOf(file.name);
    if(!['.shp','.shx','.dbf','.prj','.cpg'].includes(ext)) continue;
    const base=baseNameOf(file.name);
    const key=normalize(base);
    if(!groups.has(key)) groups.set(key,{base,files:{}});
    groups.get(key).files[ext.slice(1)]=file;
  }
  return [...groups.values()];
}

async function zipContent(file){
  if (!window.JSZip) throw new Error('Le lecteur ZIP n’est pas chargé. Rechargez la page avec une connexion internet.');
  let zip;
  try{ zip = await window.JSZip.loadAsync(file); }
  catch(error){ throw new Error(`ZIP illisible : ${error.message}`); }
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  const geo = entries.find(entry => /\.(geo)?json$/i.test(entry.name));
  const csv = entries.find(entry => /\.csv$/i.test(entry.name));
  if (geo) return {name:geo.name,type:'geojson',value:JSON.parse(await geo.async('text'))};
  if (csv) return {name:csv.name,type:'csv',value:await csv.async('text')};
  const shpEntries=entries.filter(entry=>/\.shp$/i.test(entry.name));
  const dbfEntries=entries.filter(entry=>/\.dbf$/i.test(entry.name));
  if(!shpEntries.length || !dbfEntries.length){
    throw new Error(`ZIP SHP incomplet : ${shpEntries.length} .shp et ${dbfEntries.length} .dbf détecté(s). Le ZIP doit contenir au minimum .shp + .dbf, idéalement .shx + .prj.`);
  }
  await loadShpReader();
  try{
    const buffer=await file.arrayBuffer();
    const result=window.shp.parseZip ? await window.shp.parseZip(buffer) : await window.shp(buffer);
    const rows=flattenGeoJson(result);
    if(!rows.length) throw new Error('Le lecteur SHP a répondu mais aucune géométrie n’a été produite.');
    return {name:file.name,type:'geojson',value:Array.isArray(result)?{type:'FeatureCollection',features:result.flatMap(x=>x?.features||[])}:result};
  }catch(error){
    throw new Error(`Lecture SHP impossible : ${error.message}. Fichiers détectés dans le ZIP : ${entries.map(e=>e.name.split('/').pop()).join(', ')}`);
  }
}

async function looseShapefileContent(group){
  const {shp,dbf,prj,cpg}=group.files;
  if(!shp || !dbf) throw new Error(`Jeu SHP incomplet « ${group.base} » : .shp et .dbf sont obligatoires.`);
  await loadShpReader();
  try{
    const payload={shp:await shp.arrayBuffer(),dbf:await dbf.arrayBuffer()};
    if(prj) payload.prj=await prj.text();
    if(cpg) payload.cpg=await cpg.text();
    const result=await window.shp(payload);
    const rows=flattenGeoJson(result);
    if(!rows.length) throw new Error('Aucune géométrie produite.');
    return {name:`${group.base}.shp`,type:'geojson',value:result};
  }catch(error){
    throw new Error(`Lecture du jeu SHP « ${group.base} » impossible : ${error.message}`);
  }
}

async function loadShpReader(){
  if(window.shp)return;
  const sources=[
    'https://unpkg.com/shpjs@6.2.0/dist/shp.min.js',
    'https://cdn.jsdelivr.net/npm/shpjs@6.2.0/dist/shp.min.js',
    'https://unpkg.com/shpjs@6.2.0/dist/shp.js'
  ];
  const failures=[];
  for(const src of sources){
    try{
      await new Promise((resolve,reject)=>{
        const existing=[...document.scripts].find(script=>script.src===src);
        if(existing && window.shp) return resolve();
        const script=document.createElement('script');
        script.src=src; script.async=true;
        script.onload=()=>window.shp?resolve():reject(new Error('script chargé mais objet shp absent'));
        script.onerror=()=>reject(new Error('chargement réseau refusé'));
        document.head.append(script);
      });
      if(window.shp)return;
    }catch(error){failures.push(`${src}: ${error.message}`);}
  }
  throw new Error(`Lecteur shapefile indisponible. ${failures.join(' | ')}`);
}

export async function inspectFiles(files, state){
  const parsed=[]; const warnings=[]; const invalid=[];
  const list=[...files];
  const looseGroups=groupLooseShapefiles(list);
  const consumed=new Set();

  // 1) Jeux SHP sélectionnés séparément : .shp + .dbf (+ .shx/.prj/.cpg)
  for(const group of looseGroups){
    Object.values(group.files).forEach(file=>consumed.add(file));
    try{
      const input=await looseShapefileContent(group);
      const rows=flattenGeoJson(input.value),headers=Object.keys(rows[0]||{}).filter(key=>!['_feature','geometry'].includes(key));
      parsed.push({file:input.name,rows,headers,hasGeometry:rows.some(row=>row.geometry),type:input.type});
      if(!group.files.prj) warnings.push(`${input.name} : aucun .prj fourni ; la projection peut être incorrecte.`);
    }catch(error){ invalid.push({file:`${group.base}.shp`,message:error.message}); }
  }

  // 2) Autres fichiers, dont ZIP SHP
  for(const file of list){
    if(consumed.has(file)) continue;
    try{
      const extension=file.name.split('.').pop().toLowerCase();
      let input;
      if(extension==='csv') input={name:file.name,type:'csv',value:await file.text()};
      else if(['xlsx','xls'].includes(extension)) input={name:file.name,type:'sheet',value:await file.arrayBuffer()};
      else if(['json','geojson'].includes(extension)) input={name:file.name,type:'geojson',value:JSON.parse(await file.text())};
      else if(extension==='zip') input=await zipContent(file);
      else throw new Error(`Format .${extension} non pris en charge seul.`);
      let rows=[],headers=[];
      if(input.type==='csv') ({rows,headers}=csvRows(input.value));
      if(input.type==='sheet') ({rows,headers}=spreadsheetRows(input.value));
      if(input.type==='geojson') { rows=flattenGeoJson(input.value); headers=Object.keys(rows[0]||{}).filter(key=>!['_feature','geometry'].includes(key)); }
      if(!rows.length) throw new Error('Le fichier a été lu mais ne contient aucune ligne exploitable.');
      parsed.push({file:file.name,rows,headers,hasGeometry:rows.some(row=>row.geometry),type:input.type});
    }catch(error){ invalid.push({file:file.name,message:error.message}); }
  }

  const allRows=parsed.flatMap(source=>source.rows.map(row=>({...row,_source:source})));
  const normalized=allRows.map(row=>({...objectFromRow(row,row._source.headers),geometry:row.geometry||null,_source:row._source.file}));
  const classification=classifyRows(normalized,state);
  const validParcels=normalized.filter(row=>row.nom&&!row.type).filter(row=>!validateParcel(row).length);
  const probableInterventions=normalized.filter(row=>row.type&&(row.date||row.product));
  const knownFields=new Set([...Object.values(FIELD_ALIASES).flat(), 'SIRET','PACAGE','CODE_EXPLO','RAIS_SOCIA','CAMPAGNE','CODE_P_ORI','GUID_P_ORI','TYPE_PARC','CODE_INSEE','COMMENTAIR','FD_COMMENT','PD_COMMENT','CODE_GNIS','VARIETE','DESTIN_EDI','DESTINATIO'].map(normalize));
  parsed.forEach(source=>source.headers.filter(header=>!knownFields.has(normalize(header))&&header!=='geometry').slice(0,12).forEach(header=>warnings.push(`${source.file} : colonne non reconnue « ${header} »`)));
  const invalidGeometry=normalized.filter(row=>row.geometry&&validateParcel(row).some(error=>error.includes('Géométrie'))).length;
  if(parsed.length && !validParcels.length) warnings.unshift('Aucune parcelle valide détectée : vérifiez les noms de champs du DBF.');
  return {sources:parsed.map(source=>({file:source.file,rows:source.rows.length,type:source.type,hasGeometry:source.hasGeometry,headers:source.headers})),rows:normalized,summary:{parcels:validParcels.length,interventions:probableInterventions.length,surface:validParcels.reduce((sum,row)=>sum+(row.surfaceHa||0),0),cultures:[...new Set(validParcels.map(row=>row.culture).filter(Boolean))],communes:[...new Set(validParcels.map(row=>row.commune).filter(Boolean))],geometryValid:normalized.filter(row=>row.geometry&&!validateParcel(row).some(error=>error.includes('Géométrie'))).length,geometryInvalid:invalidGeometry,ignored:normalized.filter(row=>!row.nom&&!row.type).length,...classification},warnings,invalid};
}

function classifyRows(rows,state){
  const existing = state.parcelles.filter(item=>!item.deletedAt);
  let duplicate=0,newRows=0,changed=0;
  const duplicates=[];
  rows.filter(row=>row.nom && !row.type).forEach(row => {
    const idMatch = row.sourceId && existing.find(item=>item.sourceId && item.sourceId===row.sourceId);
    const labelMatch = existing.find(item=>normalize(item.nom)===normalize(row.nom) && (!row.commune || normalize(item.commune)===normalize(row.commune)));
    const match=idMatch || labelMatch;
    if (match){ duplicate++; const differs = ['culture','surfaceHa','commune','ilot'].some(key => String(match[key]??'')!==String(row[key]??'')); if(differs) changed++; duplicates.push({row,match,reason:idMatch?'Identifiant source':'Nom + commune'}); } else newRows++;
  });
  return {duplicates:duplicate,newRows,changed,duplicateDetails:duplicates};
}

export async function applyImport(preview, store, strategy='merge'){
  const state=store.snapshot(); let created=0,updated=0,skipped=0,interventions=0;
  const sourceRows=preview.rows.filter(row=>row.nom && !row.type);
  const sourceInterventions=preview.rows.filter(row=>row.type && row.date);
  for (const row of sourceRows) {
    const match = (row.sourceId && state.parcelles.find(item=>!item.deletedAt && item.sourceId===row.sourceId)) || state.parcelles.find(item=>!item.deletedAt && normalize(item.nom)===normalize(row.nom) && (!row.commune || normalize(item.commune)===normalize(row.commune)));
    if (match && strategy==='ignore'){ skipped++; continue; }
    if (match && strategy==='new') { row.sourceId = `${row.sourceId || normalize(row.nom)}_${uid('import').slice(-5)}`; }
    const entity = {nom:row.nom,sourceId:row.sourceId,surfaceHa:row.surfaceHa,culture:row.culture,commune:row.commune,ilot:row.ilot,status:row.status,geometry:row.geometry,source:'import',importedAt:Date.now()};
    if (match && strategy !== 'new') { entity.id=match.id; if(strategy==='merge') Object.keys(entity).forEach(key=>{if(entity[key]===null||entity[key]===''||entity[key]===0) entity[key]=match[key];}); await store.upsert('parcelles',entity,{label:`Parcelle importée fusionnée : ${entity.nom}`}); updated++; }
    else { await store.upsert('parcelles',entity,{label:`Parcelle importée : ${entity.nom}`}); created++; }
  }
  for(const row of sourceInterventions){
    const parcel = state.parcelles.find(item=>!item.deletedAt && normalize(item.nom)===normalize(row.nom));
    if(!parcel){skipped++;continue;}
    const entity={parcelId:parcel.id,date:normaliseImportDate(row.date),type:row.type,product:row.product,dose:row.dose,cost:row.cost,campaignId:campaignFor(normaliseImportDate(row.date)),source:'import'};
    if(validateIntervention(entity).length){skipped++;continue;}
    await store.upsert('interventions',entity,{label:`Intervention importée : ${entity.type}`});interventions++;
  }
  await store.mutate(`Import terminé : ${created} création(s), ${updated} mise(s) à jour.`,state=>{state.metadata.lastImportAt=Date.now();},{queue:false,kind:'import'});
  return {created,updated,skipped,interventions};
}
function normaliseImportDate(value){
  const date=new Date(value); return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0,10) : date.toISOString().slice(0,10);
}

export async function makeBackup(state){
  const payload={format:'parcelles-backup',formatVersion:APP_VERSION,createdAt:Date.now(),application:'Parcelles 2.0',counts:{parcelles:state.parcelles.filter(x=>!x.deletedAt).length,interventions:state.interventions.filter(x=>!x.deletedAt).length,photos:state.photos.filter(x=>!x.deletedAt).length,documents:state.documents.filter(x=>!x.deletedAt).length},data:clone(state)};
  payload.checksum=await checksum(payload.data);
  return payload;
}
export async function validateBackup(raw){
  if (!raw || raw.format!=='parcelles-backup' || !raw.data) throw new Error('Ce fichier n’est pas une sauvegarde Parcelles valide.');
  const data=migrateData(raw.data); const validChecksum=!raw.checksum || raw.checksum===await checksum(raw.data);
  if(!validChecksum) throw new Error('La somme de contrôle ne correspond pas : le fichier peut être altéré.');
  return {data,meta:{createdAt:raw.createdAt,counts:raw.counts || {},formatVersion:raw.formatVersion,validChecksum}};
}
export function exportCsv(state){
  const parcels=new Map(state.parcelles.filter(item=>!item.deletedAt).map(item=>[item.id,item]));
  const rows=state.interventions.filter(item=>!item.deletedAt).map(item=>({date:item.date,campagne:item.campaignId,type:item.type,parcelle:parcels.get(item.parcelId)?.nom || 'Parcelle supprimée',culture:item.culture || parcels.get(item.parcelId)?.culture || '',produit:item.product || '',dose:item.dose || '',surface:item.surfaceWorked || '',cout:item.cost || 0,operateur:item.operator || '',materiel:item.equipmentId || '',note:item.note || ''}));
  const headers=Object.keys(rows[0] || {date:'',campagne:'',type:'',parcelle:'',culture:'',produit:'',dose:'',surface:'',cout:'',operateur:'',materiel:'',note:''});
  const quote=value=>`"${String(value ?? '').replaceAll('"','""')}"`;
  return [headers.map(quote).join(';'),...rows.map(row=>headers.map(key=>quote(row[key])).join(';'))].join('\n');
}
export function exportGeoJson(state){
  return JSON.stringify({type:'FeatureCollection',features:state.parcelles.filter(item=>!item.deletedAt && item.geometry).map(item=>({type:'Feature',geometry:item.geometry,properties:{id:item.id,nom:item.nom,surfaceHa:item.surfaceHa,culture:item.culture,commune:item.commune,ilot:item.ilot}}))},null,2);
}
export function importPreviewHtml(preview){
  const s=preview.summary;
  const sample=preview.rows.slice(0,8);
  return `<div class="preview-summary"><div class="preview-stat"><strong>${s.parcels}</strong><small>parcelles détectées</small></div><div class="preview-stat"><strong>${s.surface.toFixed(2)} ha</strong><small>surface annoncée</small></div><div class="preview-stat"><strong>${s.duplicates}</strong><small>doublons possibles</small></div><div class="preview-stat"><strong>${s.interventions}</strong><small>interventions</small></div><div class="preview-stat"><strong>${s.geometryValid}</strong><small>géométries valides</small></div><div class="preview-stat"><strong>${s.geometryInvalid}</strong><small>géométries invalides</small></div></div>${preview.invalid.length?`<div class="notice danger">${preview.invalid.map(item=>`${escapeHtml(item.file)} : ${escapeHtml(item.message)}`).join('<br>')}</div>`:''}${preview.warnings.length?`<div class="notice warning">${preview.warnings.slice(0,4).map(escapeHtml).join('<br>')}</div>`:''}<p class="form-note">Sources : ${preview.sources.map(source=>`${escapeHtml(source.file)} (${source.rows} ligne(s))`).join(', ')}. Les données ne seront modifiées qu’après confirmation.</p><div class="table-wrap"><table><thead><tr><th>Nom / intervention</th><th>Culture</th><th>Surface</th><th>Commune</th><th>Géométrie</th></tr></thead><tbody>${sample.map(row=>`<tr><td>${escapeHtml(row.nom || row.type || '—')}</td><td>${escapeHtml(row.culture||'—')}</td><td>${row.surfaceHa ? `${row.surfaceHa} ha`:'—'}</td><td>${escapeHtml(row.commune||'—')}</td><td>${row.geometry?'Oui':'—'}</td></tr>`).join('')}</tbody></table></div>`;
}
