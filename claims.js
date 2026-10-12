// n° 94 — Dossier sinistre (gibier, grêle, sécheresse) ouvert depuis une observation de dégâts.
// Logique pure. Le dossier est un enregistrement d'exploitation (integrationImports,
// farmKind « claim ») : pas de nouvelle collection. Les photos restent des « photos »
// rattachées par claimId, stockées sans recompression.
import {campaignFor,geometryCentroid,normalize} from './utils.js';
import {active} from './farm-memory.js';
import {farmRecords} from './farm-records.js';
import {cultureForCampaign} from './pilotage.js';

export const CLAIM_KIND='claim';
export const CLAIM_CAUSES=Object.freeze([['gibier','Dégâts de gibier'],['grele','Grêle'],['secheresse','Sécheresse'],['autre','Autre aléa']]);
export const CLAIM_STATUSES=Object.freeze(['ouvert','déclaré','expertisé','indemnisé']);
export const DAMAGE_TYPES=Object.freeze(['Dégâts gibier','Grêle','Sécheresse','Verse','Eau','Ravageur','Maladie','Autre']);
export const WEATHER_SOURCE='Archive météo Open-Meteo (réanalyse ERA5, maille d’environ 10 km) : valeurs indicatives, pas un relevé de station.';
const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const r2=v=>Math.round(v*100)/100,r3=v=>Math.round(v*1000)/1000;

export const causeLabel=k=>CLAIM_CAUSES.find(c=>c[0]===k)?.[1]||'Aléa';
export function causeFromObservation(o){const t=normalize(`${o?.type} ${o?.title}`);return/gibier|sanglier|chevreuil|cerf/.test(t)?'gibier':/grele/.test(t)?'grele':/secheresse|sec /.test(t)?'secheresse':'autre';}
export const claimsFor=(state,observationId)=>farmRecords(state,CLAIM_KIND).filter(c=>!observationId||c.observationId===observationId);

/** Pré-remplissage depuis l'observation : parcelle, culture, variété, rendement et prix attendus. */
export function claimDraft(state,observation){
  const parcel=active(state,'parcelles').find(p=>p.id===observation?.parcelId)||null,date=String(observation?.date||'').slice(0,10),campaign=campaignFor(date||undefined);
  const econ=parcel?.economicsByCampaign?.[campaign]||(campaign===campaignFor()?parcel?.economics:null)||{};
  const sowing=active(state,'interventions').filter(w=>w.parcelId===parcel?.id&&(w.campaignId||campaignFor(w.date))===campaign&&/semis|plantation/.test(normalize(w.type))).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
  const position=typeof observation?.latitude==='number'&&typeof observation?.longitude==='number'?{latitude:observation.latitude,longitude:observation.longitude}:parcel?.geometry?geometryCentroid(parcel.geometry):null;
  return{observationId:observation?.id||null,parcelId:parcel?.id||null,date,cause:causeFromObservation(observation),status:'ouvert',statusHistory:[],
    culture:parcel?cultureForCampaign(state,parcel,campaign):'',variety:sowing?.variety||'',expectedYield:num(econ.yield),yieldUnit:econ.yieldUnit||'t/ha',price:num(econ.salePrice),
    areaMode:'saisie',areaHa:null,zoneId:null,lossPct:null,latitude:position?.latitude??null,longitude:position?.longitude??null,note:observation?.note||'',weather:null,indemnity:null};
}

/** Surface touchée : saisie, zone mesurée (points « Zone ») ou part de la parcelle. */
export function claimArea(state,claim){
  if(claim.areaMode==='zone'){const z=active(state,'points').find(p=>p.id===claim.zoneId);return z?num(z.areaHa):null;}
  if(claim.areaMode==='parcelle'){const p=active(state,'parcelles').find(x=>x.id===claim.parcelId),pct=num(claim.areaPct);return p&&pct!==null?r3((num(p.surfaceHa)||0)*pct/100):null;}
  return num(claim.areaHa);
}

/** Perte estimée : surface × rendement attendu × taux de perte, en tonnes puis en euros. */
export function estimateLoss({areaHa,expectedYield,yieldUnit='t/ha',lossPct,price}){
  const a=num(areaHa),y=num(expectedYield),l=num(lossPct),p=num(price);
  if(a===null||y===null||l===null)return{tonnes:null,euros:null};
  const perHaT=yieldUnit==='q/ha'?y/10:y,tonnes=r3(a*perHaT*l/100);
  const perT=p===null?null:yieldUnit==='q/ha'?p*10:p;
  return{tonnes,euros:perT===null?null:r2(tonnes*perT)};
}

export function validateClaim(v){
  if(!CLAIM_CAUSES.some(c=>c[0]===v.cause))return{error:'Choisissez la nature du sinistre.'};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v.date||'')))return{error:'Date du sinistre invalide.'};
  const loss=num(v.lossPct);if(loss!==null&&(loss<0||loss>100))return{error:'Taux de perte entre 0 et 100 %.'};
  for(const k of ['areaHa','expectedYield','price','areaPct','indemnity'])if(num(v[k])!==null&&num(v[k])<0)return{error:'Valeurs négatives impossibles.'};
  if(v.areaMode==='parcelle'&&num(v.areaPct)!==null&&num(v.areaPct)>100)return{error:'Part de la parcelle entre 0 et 100 %.'};
  return{value:{...v,lossPct:loss,areaHa:num(v.areaHa),areaPct:num(v.areaPct),expectedYield:num(v.expectedYield),price:num(v.price),indemnity:num(v.indemnity)}};
}

export function nextStatus(claim,status,date){
  if(!CLAIM_STATUSES.includes(status))throw new Error('Statut inconnu.');
  return{...claim,status,statusHistory:[...(claim.statusHistory||[]),{status,date,at:Date.now()}].slice(-20)};
}

// Archive Open-Meteo de la date du sinistre (mise en cache par l'interface).
export const weatherCacheKey=(lat,lon,date)=>`claim-weather:${Number(lat).toFixed(3)}:${Number(lon).toFixed(3)}:${date}`;
export function weatherUrl(lat,lon,date){
  const q=new URLSearchParams({latitude:Number(lat).toFixed(4),longitude:Number(lon).toFixed(4),start_date:date,end_date:date,daily:'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max',timezone:'Europe/Paris'});
  return`https://archive-api.open-meteo.com/v1/archive?${q}`;
}
export function parseWeather(json,date){
  const d=json?.daily;if(!d||!Array.isArray(d.time))return null;const i=d.time.indexOf(date);if(i<0)return null;
  const at=k=>{const v=d[k]?.[i];return typeof v==='number'&&Number.isFinite(v)?v:null;};
  return{date,tmax:at('temperature_2m_max'),tmin:at('temperature_2m_min'),precipitation:at('precipitation_sum'),gusts:at('wind_gusts_10m_max'),source:WEATHER_SOURCE};
}
export function weatherText(w){
  if(!w)return'Météo non chargée.';const f=v=>v===null?'—':String(v).replace('.',',');
  return`Le ${w.date} : ${f(w.tmin)} à ${f(w.tmax)} °C, pluie ${f(w.precipitation)} mm, rafales ${f(w.gusts)} km/h.`;
}

/** Blocs du PDF (fédération de chasse ou assureur). Les photos JPEG sont insérées telles quelles. */
export function claimPdfBlocks(state,claim,{photos=[],today}){
  const parcel=active(state,'parcelles').find(p=>p.id===claim.parcelId),farm=state.exploitation||{},area=claimArea(state,claim);
  const loss=estimateLoss({areaHa:area,expectedYield:claim.expectedYield,yieldUnit:claim.yieldUnit,lossPct:claim.lossPct,price:claim.price});
  const f=v=>v===null||v===undefined||v===''?'—':String(v).replace('.',','),fr=d=>d?`${d.slice(8,10)}/${d.slice(5,7)}/${d.slice(0,4)}`:'—';
  const to=claim.cause==='gibier'?'Fédération départementale des chasseurs':'Assureur';
  const blocks=[{type:'h1',text:`Dossier sinistre · ${causeLabel(claim.cause)}`},
    {type:'p',text:`${farm.nom||'Mon exploitation'}${farm.commune?` · ${farm.commune}`:''} · destinataire : ${to} · édité le ${fr(today)}`,muted:true},
    {type:'table',head:['Élément','Valeur'],rows:[['Date du sinistre',fr(claim.date)],['Parcelle',parcel?.nom||'—'],['Surface de la parcelle',parcel?`${f(parcel.surfaceHa)} ha`:'—'],['Culture',claim.culture||'—'],['Variété',claim.variety||'—'],
      ['Surface touchée',area===null?'—':`${f(area)} ha (${claim.areaMode==='zone'?'zone mesurée':claim.areaMode==='parcelle'?`${f(claim.areaPct)} % de la parcelle`:'saisie'})`],['Rendement attendu',claim.expectedYield===null?'—':`${f(claim.expectedYield)} ${claim.yieldUnit}`],['Taux de perte estimé',claim.lossPct===null?'—':`${f(claim.lossPct)} %`],
      ['Perte estimée',loss.tonnes===null?'—':`${f(loss.tonnes)} t${loss.euros!==null?` · ${f(loss.euros)} €`:''}`],['Statut',claim.status],...(num(claim.indemnity)!==null?[['Indemnité',`${f(claim.indemnity)} €`]]:[]),['Position',claim.latitude!==null&&claim.latitude!==undefined?`${Number(claim.latitude).toFixed(5)}, ${Number(claim.longitude).toFixed(5)}`:'—']]},
    {type:'h2',text:'Météo du jour'},{type:'p',text:weatherText(claim.weather)},...(claim.weather?[{type:'p',text:WEATHER_SOURCE,small:true,muted:true}]:[]),
    ...(claim.note?[{type:'h2',text:'Constat'},{type:'p',text:claim.note}]:[]),
    ...((claim.statusHistory||[]).length?[{type:'h2',text:'Suivi'},...claim.statusHistory.map(h=>({type:'li',text:`${fr(h.date)} : ${h.status}`}))]:[]),
    {type:'note',text:'Estimation de l’exploitant, à confronter à l’expertise contradictoire. Photos jointes sans recompression.'}];
  if(photos.length){blocks.push({type:'h2',text:`Photos (${photos.length})`});for(const p of photos)blocks.push(p.bytes?{type:'jpeg',bytes:p.bytes,caption:p.caption}:{type:'li',text:`${p.caption} (format non intégrable, joint séparément)`});}
  return{blocks,loss,area};
}

/** Date de prise de vue EXIF (DateTimeOriginal, sinon DateTime) lue sans décoder l'image. */
export function exifDate(bytes){
  const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);if(b[0]!==0xFF||b[1]!==0xD8)return null;
  let p=2;while(p+4<b.length){if(b[p]!==0xFF)return null;const m=b[p+1],len=(b[p+2]<<8)|b[p+3];
    if(m===0xE1&&String.fromCharCode(...b.subarray(p+4,p+8))==='Exif'){
      const t=p+10,le=b[t]===0x49,u16=o=>le?b[o]|(b[o+1]<<8):(b[o]<<8)|b[o+1],u32=o=>(le?(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24)):((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3]))>>>0;
      const read=(ifd,want)=>{const out={};if(t+ifd+2>b.length)return out;const n=u16(t+ifd);for(let i=0;i<n;i++){const e=t+ifd+2+i*12;if(e+12>b.length)break;const tag=u16(e);if(want.includes(tag))out[tag]=tag===0x8769?u32(e+8):String.fromCharCode(...b.subarray(t+u32(e+8),t+u32(e+8)+19));}return out;};
      const ifd0=read(u32(t+4),[0x0132,0x8769]),sub=ifd0[0x8769]?read(ifd0[0x8769],[0x9003]):{},raw=sub[0x9003]||ifd0[0x0132];
      const m2=/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(raw||'');return m2?`${m2[1]}-${m2[2]}-${m2[3]}T${m2[4]}:${m2[5]}`:null;}
    if(m===0xDA)return null;p+=2+len;}
  return null;
}

/** Suivi en trésorerie : pertes estimées en attente d'indemnisation et indemnités reçues. */
export function claimsTreasury(state){
  const rows=claimsFor(state).map(c=>{const area=claimArea(state,c),loss=estimateLoss({areaHa:area,expectedYield:c.expectedYield,yieldUnit:c.yieldUnit,lossPct:c.lossPct,price:c.price}),indemnity=num(c.indemnity);
    return{claim:c,area,loss,indemnity,expected:c.status==='indemnisé'?null:(indemnity??loss.euros)};}).sort((a,b)=>String(b.claim.date).localeCompare(String(a.claim.date)));
  const sum=f=>r2(rows.reduce((s,r)=>s+(f(r)||0),0));
  return{rows,pending:sum(r=>r.expected),received:sum(r=>r.claim.status==='indemnisé'?r.indemnity:null),open:rows.filter(r=>r.claim.status!=='indemnisé').length};
}
