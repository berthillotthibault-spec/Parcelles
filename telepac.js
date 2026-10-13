// n° 115 : import telepac guidé (ZIP SHP « parcelles graphiques déclarées »). Logique pure, testable sous Node.
// Le fichier est lu par import-export.js (SHP, ZIP, fallback zip-lite + shapefile-fallback) ; ce module
// reconnaît les colonnes telepac, les traduit vers les champs de Parcelles et compare avec l'import précédent.
import {geometryAreaHa, geometryCentroid, pointInGeometry} from './utils.js';
import {rpgCultureLabel} from './rpg-onboarding.js';

export const TELEPAC_STEPS=Object.freeze([
  {title:'Déclaration',detail:'Sur telepac, ouvrez la déclaration PAC de la campagne (menu « Téléprocédures › Dossier PAC »).'},
  {title:'Téléchargements',detail:'Dans le dossier, ouvrez l’onglet « Téléchargements » (ou « Export des données »).'},
  {title:'Parcelles graphiques (SHP)',detail:'Choisissez « Parcelles graphiques » au format SHP : vous obtenez un fichier ZIP à importer tel quel.'}
]);
export const TELEPAC_NOTICE='Aide à l’import : le fichier telepac reste la référence officielle. Le numéro PACAGE n’est jamais enregistré dans Parcelles.';

const key=value=>String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'');
// Champs connus des exports telepac « parcelles graphiques ». Le PACAGE est une donnée personnelle : toujours retiré.
const PRIVATE_FIELDS=new Set(['PACAGE','NUMPACAGE','SIRET']);
const ALIASES={ilot:['NUM_ILOT','NUMILOT'],parcel:['NUM_PARCEL','NUMPARCEL','NUM_PARC'],code:['CODE_CULTU','CODECULTU','CODE_CULT'],surface:['SURF_ADM','SURF_DECL','SURF_GRAPH','SURFADM']};
function header(headers,name){const map=new Map((headers||[]).map(h=>[key(h),h]));for(const alias of ALIASES[name])if(map.has(key(alias)))return map.get(key(alias));return null;}

/** Vrai si les colonnes ressemblent à un export telepac : îlot, n° de parcelle et code culture. */
export function isTelepacHeaders(headers){return Boolean(header(headers,'ilot')&&header(headers,'parcel')&&header(headers,'code'));}

function number(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(String(value).trim().replace(',','.'));return Number.isFinite(n)?n:null;}
const trimNumber=value=>{const s=String(value??'').trim();return /^\d+(\.0+)?$/.test(s)?String(Number(s)):s;};

/** Nom « îlot.parcelle » (ex. « 3.2 ») à partir des numéros telepac. */
export function telepacParcelName(ilot,parcel){const i=trimNumber(ilot),p=trimNumber(parcel);return i&&p?`${i}.${p}`:i||p||'';}

/**
 * Traduit les lignes telepac vers les colonnes reconnues par l'importeur (NOM_PARCEL, ID_EXTERNE,
 * SURFACE, CP_CULTU, NUM_ILOT) et retire le PACAGE (ligne et _feature). Les autres colonnes restent.
 */
export function telepacRows(rows,headers=Object.keys(rows?.[0]||{})){
  const h={ilot:header(headers,'ilot'),parcel:header(headers,'parcel'),code:header(headers,'code'),surface:header(headers,'surface')};
  return(rows||[]).map(row=>{
    const out={};for(const [k,v] of Object.entries(row||{}))if(!PRIVATE_FIELDS.has(key(k))&&k!=='_feature')out[k]=v;
    const ilot=trimNumber(row[h.ilot]),parcel=trimNumber(row[h.parcel]),code=String(row[h.code]??'').trim().toUpperCase();
    const declared=h.surface?number(row[h.surface]):null,computed=row.geometry?Math.round(geometryAreaHa(row.geometry)*10000)/10000:null;
    const name=telepacParcelName(ilot,parcel);
    Object.assign(out,{NOM_PARCEL:name,ID_EXTERNE:name?`telepac:${name}`:'',NUM_ILOT:ilot,CP_CULTU:rpgCultureLabel(code,code),CODE_CULTU:code,SURFACE:declared??computed??'',SURF_ADM:declared??''});
    if(row._feature)out._feature={type:'Feature',geometry:row.geometry||null,properties:Object.fromEntries(Object.entries(out).filter(([k])=>!['geometry','_feature'].includes(k)))};
    return out;
  });
}
/** En-têtes après traduction (PACAGE retiré, colonnes de Parcelles ajoutées). */
export function telepacHeaders(headers){return[...new Set([...(headers||[]).filter(h=>!PRIVATE_FIELDS.has(key(h))),'NOM_PARCEL','ID_EXTERNE','NUM_ILOT','CP_CULTU','CODE_CULTU','SURFACE','SURF_ADM'])];}

/**
 * Comparatif avec le parcellaire déjà importé depuis telepac (sourceId « telepac:… ») :
 * nouvelles parcelles, parcelles disparues, cultures changées, découpes (une ancienne parcelle
 * contient le centre de plusieurs nouvelles) et regroupements (l'inverse). Calcul approché.
 */
export function telepacComparison(existing,rows){
  const previous=(existing||[]).filter(p=>!p.deletedAt&&String(p.sourceId||'').startsWith('telepac:'));
  if(!previous.length)return null;
  const incoming=(rows||[]).filter(r=>r.nom);
  const prevById=new Map(previous.map(p=>[p.sourceId,p])),nextIds=new Set(incoming.map(r=>r.sourceId));
  const centerIn=(a,b)=>{const c=a.geometry&&geometryCentroid(a.geometry);return Boolean(c&&b.geometry&&pointInGeometry(c.longitude,c.latitude,b.geometry));};
  const splits=[],merges=[];
  for(const p of previous){const parts=incoming.filter(r=>centerIn(r,p));if(parts.length>=2)splits.push({from:p.nom,to:parts.map(r=>r.nom)});}
  for(const r of incoming){const parts=previous.filter(p=>centerIn(p,r));if(parts.length>=2)merges.push({from:parts.map(p=>p.nom),to:r.nom});}
  const split=new Set(splits.flatMap(s=>s.to)),merged=new Set(merges.flatMap(m=>m.from));
  const added=incoming.filter(r=>!prevById.has(r.sourceId)&&!split.has(r.nom)).map(r=>r.nom);
  const removed=previous.filter(p=>!nextIds.has(p.sourceId)&&!splits.some(s=>s.from===p.nom)&&!merged.has(p.nom)).map(p=>p.nom);
  const cultureChanged=incoming.map(r=>({row:r,prev:prevById.get(r.sourceId)})).filter(x=>x.prev&&String(x.prev.culture||'')!==String(x.row.culture||'')).map(x=>({nom:x.row.nom,before:x.prev.culture||'—',after:x.row.culture||'—'}));
  return{previous:previous.length,incoming:incoming.length,added,removed,cultureChanged,splits,merges};
}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=(items,max=6)=>items.length>max?`${items.slice(0,max).map(esc).join(', ')} et ${items.length-max} autre${items.length-max>1?'s':''}`:items.map(esc).join(', ');
/** Bandeau de l'aperçu d'import : « Fichier telepac reconnu ✓ » et comparatif avec l'import précédent. */
export function telepacPreviewHtml(telepac){
  if(!telepac)return'';
  const c=telepac.comparison;let body='';
  if(c){
    const lines=[];
    if(c.added.length)lines.push(`<li><strong>${c.added.length} nouvelle${c.added.length>1?'s':''}</strong> : ${list(c.added)}</li>`);
    if(c.splits.length)lines.push(`<li><strong>${c.splits.length} découpe${c.splits.length>1?'s':''}</strong> : ${c.splits.slice(0,6).map(s=>`${esc(s.from)} → ${list(s.to,4)}`).join(' ; ')}</li>`);
    if(c.merges.length)lines.push(`<li><strong>${c.merges.length} regroupement${c.merges.length>1?'s':''}</strong> : ${c.merges.slice(0,6).map(m=>`${list(m.from,4)} → ${esc(m.to)}`).join(' ; ')}</li>`);
    if(c.cultureChanged.length)lines.push(`<li><strong>${c.cultureChanged.length} culture${c.cultureChanged.length>1?'s':''} changée${c.cultureChanged.length>1?'s':''}</strong> : ${c.cultureChanged.slice(0,6).map(x=>`${esc(x.nom)} (${esc(x.before)} → ${esc(x.after)})`).join(', ')}</li>`);
    if(c.removed.length)lines.push(`<li><strong>${c.removed.length} absente${c.removed.length>1?'s':''} du nouveau fichier</strong> : ${list(c.removed)} (conservées dans Parcelles)</li>`);
    body=`<p style="margin:8px 0 4px">Comparé à l’import telepac précédent (${c.previous} parcelle${c.previous>1?'s':''}) :</p>${lines.length?`<ul class="telepac-diff">${lines.join('')}</ul>`:'<p>Aucun changement de parcellaire ni de culture.</p>'}`;
  }
  return`<div class="notice success telepac-recognized" role="status"><strong>Fichier telepac reconnu ✓</strong><br><small>Nom « îlot.parcelle », code culture traduit, surface admissible (SURF_ADM). ${esc(TELEPAC_NOTICE)}</small>${body}</div>`;
}
