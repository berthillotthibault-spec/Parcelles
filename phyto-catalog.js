// n° 59 — Catalogue E-Phy hors connexion (AMM → usages, doses, DAR, ZNT, DRE).
// Logique pure : lecture d'un export CSV/JSON E-Phy (ANSES, open data) ou de la réponse d'un
// service configuré, réduction aux cultures de l'exploitation et recherche par AMM ou nom.
// Le catalogue est stocké localement (IndexedDB, hors état synchronisé) par phyto-catalog-ui.js.
import {normalize,toNullableNumber} from './utils.js';

export const CATALOG_KEY='phyto-catalog';
export const CATALOG_MAX_AGE_DAYS=30;
export const EPHY_SOURCE=Object.freeze({
  name:'E-Phy, catalogue des produits phytopharmaceutiques (ANSES)',
  license:'Licence ouverte Etalab 2.0',
  url:'https://www.data.gouv.fr/fr/datasets/donnees-ouvertes-du-catalogue-e-phy-des-produits-phytopharmaceutiques-matieres-fertilisantes-et-supports-de-culture-adjuvants-produits-mixtes-et-melanges/'
});

/** Lecture CSV tolérante (séparateur ; ou , ou tabulation, guillemets doublés). */
export function parseCsv(text){
  const src=String(text||'').replace(/^﻿/,'');
  const first=src.split(/\r?\n/,1)[0]||'';
  const sep=[';','\t',','].map(s=>[s,first.split(s).length]).sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<src.length;i++){
    const c=src[i];
    if(quoted){if(c==='"'){if(src[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;continue;}
    if(c==='"'&&cell==='')quoted=true;
    else if(c===sep){row.push(cell);cell='';}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&src[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(v=>v!==''))rows.push(row);row=[];}
    else cell+=c;
  }
  row.push(cell);if(row.some(v=>v!==''))rows.push(row);
  if(!rows.length)return[];
  const head=rows[0].map(h=>h.trim());
  return rows.slice(1).map(r=>Object.fromEntries(head.map((h,i)=>[h,(r[i]??'').trim()])));
}

// Colonnes E-Phy reconnues (en-têtes normalisés, sans accents). L'ordre compte : premier trouvé.
const COLUMNS={
  amm:[/^numero amm$/,/^n amm$/,/^amm$/,/numero.*amm/],
  name:[/^nom produit$/,/^nom commercial$/,/^nom$/,/^name$/],
  otherNames:[/seconds? noms? commerciaux/,/autres? noms?/],
  holder:[/^titulaire/],
  functions:[/^fonctions?$/,/^fonction/],
  state:[/^etat d autorisation$/,/^etat autorisation/,/^etat produit/],
  withdrawnAt:[/^date de retrait du produit$/,/^date de retrait/,/^date retrait/],
  usage:[/^identifiant usage lib court$/,/^usage lib/,/^libelle usage/,/^usage$/],
  usageState:[/^etat usage$/],
  dose:[/^dose retenue$/,/^dose max/,/^dose$/],
  doseUnit:[/^dose retenue unite$/,/^unite dose/,/^dose unite/],
  maxApplications:[/^nombre max d application/,/nombre max/,/^nb max/],
  dar:[/^delai avant recolte jour/,/^dar/,/delai avant recolte/],
  zntWater:[/^znt aquatique/,/^znt eau/],
  dre:[/delai de rentree/,/^dre/],
  useUntil:[/^date fin utilisation$/,/date fin d utilisation/,/fin utilisation/],
  mentions:[/^mentions autorisees/,/^mentions/],
  condition:[/^condition emploi/,/conditions? d emploi/],
  risks:[/phrases? de risque/,/classification/,/mention de danger/],
  biocontrol:[/biocontrol/]
};
function columnMap(keys){
  const norm=keys.map(k=>[k,normalize(k)]),map={};
  for(const [field,patterns] of Object.entries(COLUMNS))for(const re of patterns){const hit=norm.find(([,n])=>re.test(n));if(hit){map[field]=hit[0];break;}}
  return map;
}
/** Date E-Phy (AAAA-MM-JJ, JJ/MM/AAAA) → AAAA-MM-JJ, sinon ''. */
export function ephyDate(value){
  const v=String(value||'').trim();let m;
  if((m=v.match(/^(\d{4})-(\d{2})-(\d{2})/)))return`${m[1]}-${m[2]}-${m[3]}`;
  if((m=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)))return`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return'';
}
const unitOf=u=>{const n=normalize(u).replace(/\s+/g,'');return n==='lha'?'L/ha':n==='kgha'?'kg/ha':n==='gha'?'g/ha':n==='mlha'?'mL/ha':String(u||'').trim();};
const maxOf=(a,b)=>a===null?b:b===null?a:Math.max(a,b);
const laterDate=(a,b)=>!a?b:!b?a:a>b?a:b;
function category(fn,bio){
  if(/^(oui|yes|true|1)$/i.test(String(bio||'').trim()))return'biocontrole';
  const f=normalize(fn);return /herbicide/.test(f)?'herbicide':/fongicide/.test(f)?'fongicide':/insecticide|acaricide/.test(f)?'insecticide':f?'autre':'';
}

/** Lignes E-Phy (une par usage) → entrées du catalogue groupées par AMM. */
export function catalogFromRows(rows){
  const list=(Array.isArray(rows)?rows:[]).filter(r=>r&&typeof r==='object');
  if(!list.length)return[];
  const col=columnMap(Object.keys(list[0])),get=(r,k)=>col[k]?String(r[col[k]]??'').trim():'';
  if(!col.amm)throw new Error('Colonne « numéro AMM » introuvable : ce fichier ne ressemble pas à un export E-Phy.');
  const by=new Map();
  for(const r of list){
    const amm=get(r,'amm').replace(/\s+/g,'');if(!amm)continue;
    let e=by.get(amm);
    if(!e){e={amm,name:get(r,'name'),otherNames:get(r,'otherNames').split(/\s*[|;]\s*/).filter(Boolean),holder:get(r,'holder'),category:'',usages:[],dar:null,zntWater:null,dre:null,mentions:[],withdrawnAt:'',useUntil:'',state:''};by.set(amm,e);}
    e.category||=category(get(r,'functions'),get(r,'biocontrol'));
    e.state||=get(r,'state');
    const withdrawn=/retir/i.test(get(r,'state'));
    if(withdrawn)e.withdrawnAt=laterDate(e.withdrawnAt,ephyDate(get(r,'withdrawnAt')));
    e.useUntil=laterDate(e.useUntil,ephyDate(get(r,'useUntil')));
    const text=`${get(r,'mentions')} ${get(r,'condition')} ${get(r,'risks')}`;
    if(/florais|abeille/i.test(get(r,'mentions'))&&!e.mentions.includes('abeille'))e.mentions.push('abeille');
    if(/\bH3[46]0|\bH350|\bcmr\b/i.test(text)&&!e.mentions.includes('cmr'))e.mentions.push('cmr');
    const dreText=get(r,'dre')||(text.match(/d[ée]lai de rentr[ée]e[^0-9]{0,30}(\d{1,2})\s*h/i)?.[1]||'');
    const dre=toNullableNumber(dreText);if(dre!==null)e.dre=maxOf(e.dre,dre);
    const usage=get(r,'usage');if(!usage||(/retir/i.test(get(r,'usageState'))&&!withdrawn))continue;
    const parts=usage.split('*').map(s=>s.trim()).filter(Boolean);
    const u={culture:parts[0]||usage,target:parts.length>1?parts.at(-1):'',maxDose:toNullableNumber(get(r,'dose')),doseUnit:unitOf(get(r,'doseUnit')),maxApplications:toNullableNumber(get(r,'maxApplications')),dar:toNullableNumber(get(r,'dar')),zntWater:toNullableNumber(get(r,'zntWater'))};
    e.usages.push(u);e.dar=maxOf(e.dar,u.dar);e.zntWater=maxOf(e.zntWater,u.zntWater);
  }
  for(const e of by.values()){if(!/retir/i.test(e.state))e.withdrawnAt='';if(!e.withdrawnAt)e.useUntil='';delete e.state;}
  return[...by.values()].sort((a,b)=>a.name.localeCompare(b.name,'fr'));
}

const ownShape=x=>x&&typeof x==='object'&&'amm'in x&&('usages'in x||'name'in x)&&!Object.keys(x).some(k=>/ /.test(k));
/** Fichier CSV ou JSON (export E-Phy, ou entrées déjà au format du catalogue). */
export function parseCatalogFile(text,{fileName=''}={}){
  const raw=String(text||'').replace(/^﻿/,'').trim();
  if(!raw)throw new Error('Fichier vide.');
  if(/\.json$/i.test(fileName)||/^[[{]/.test(raw)){
    let data;try{data=JSON.parse(raw);}catch{throw new Error('JSON illisible.');}
    const list=Array.isArray(data)?data:Array.isArray(data?.entries)?data.entries:Array.isArray(data?.rows)?data.rows:null;
    if(!list)throw new Error('JSON inattendu : une liste de produits est attendue.');
    return list.every(ownShape)?list.map(normalizeEntry).filter(e=>e.amm):catalogFromRows(list);
  }
  return catalogFromRows(parseCsv(raw));
}
export function normalizeEntry(e){
  const n=v=>toNullableNumber(v);
  return{amm:String(e?.amm||'').replace(/\s+/g,''),name:String(e?.name||'').trim(),otherNames:Array.isArray(e?.otherNames)?e.otherNames.map(String):[],holder:String(e?.holder||''),category:String(e?.category||''),
    usages:(Array.isArray(e?.usages)?e.usages:[]).map(u=>({culture:String(u?.culture||''),target:String(u?.target||''),maxDose:n(u?.maxDose),doseUnit:String(u?.doseUnit||''),maxApplications:n(u?.maxApplications),dar:n(u?.dar),zntWater:n(u?.zntWater)})),
    dar:n(e?.dar),zntWater:n(e?.zntWater),zntResidents:n(e?.zntResidents),dre:n(e?.dre),mentions:Array.isArray(e?.mentions)?e.mentions.map(String):[],withdrawnAt:ephyDate(e?.withdrawnAt),useUntil:ephyDate(e?.useUntil)};
}

const cultureKey=c=>normalize(c).split(' ')[0];
/** Ne garde que les usages des cultures de l'exploitation (et les produits qui en ont). */
export function filterForCultures(entries,cultures){
  const keys=[...new Set((cultures||[]).map(cultureKey).filter(Boolean))];
  if(!keys.length)return entries;
  const match=u=>{const k=normalize(u.culture);return keys.some(c=>k.startsWith(c)||k.includes(` ${c}`)||(c.length>=4&&k.includes(c)));};
  const top=(list,k,fallback)=>{const v=list.map(u=>u[k]).filter(x=>x!==null&&x!==undefined);return v.length?Math.max(...v):fallback;};
  return entries.map(e=>{const usages=e.usages.filter(match);return{...e,usages,dar:top(usages,'dar',null),zntWater:top(usages,'zntWater',e.zntWater)};}).filter(e=>e.usages.length);
}
/** Cultures de l'exploitation (parcelles actives et rotations). */
export function farmCultures(state){
  return[...new Set([...(state?.parcelles||[]).filter(p=>!p.deletedAt).map(p=>p.culture),...(state?.rotations||[]).filter(r=>!r.deletedAt).map(r=>r.culture||r.crop)].filter(Boolean))];
}

/** Fonction de recherche ({amm,name}) → entrée, pour phyto.js productFor. */
export function catalogLookup(catalog){
  const entries=catalog?.entries||[];if(!entries.length)return()=>null;
  const byAmm=new Map(entries.map(e=>[e.amm,e])),byName=new Map();
  for(const e of entries)for(const n of [e.name,...(e.otherNames||[])])if(n&&!byName.has(normalize(n)))byName.set(normalize(n),e);
  return({amm='',name=''}={})=>byAmm.get(String(amm||'').replace(/\s+/g,''))||byName.get(normalize(name))||null;
}
export function searchCatalog(catalog,query,limit=20){
  const q=normalize(query);if(!q)return[];
  return(catalog?.entries||[]).filter(e=>e.amm.startsWith(q.replace(/\s+/g,''))||normalize([e.name,...(e.otherNames||[])].join(' ')).includes(q)).slice(0,limit);
}

/** Âge du catalogue en jours (null si absent) et invitation à mettre à jour au-delà de 30 jours. */
export function catalogStatus(catalog,now=Date.now()){
  if(!catalog?.updatedAt)return{present:false,stale:true,ageDays:null,label:'Aucun catalogue phyto hors connexion.'};
  const ageDays=Math.floor((now-catalog.updatedAt)/864e5),date=new Date(catalog.updatedAt).toLocaleDateString('fr-FR');
  const stale=ageDays>CATALOG_MAX_AGE_DAYS;
  return{present:true,stale,ageDays,label:`Catalogue du ${date}${ageDays>0?` (il y a ${ageDays} j)`:''} · ${catalog.entries?.length||0} produit${(catalog.entries?.length||0)>1?'s':''}${stale?' : mise à jour conseillée':''}`};
}

/** Enregistrement à stocker (hors état synchronisé). */
export function catalogRecord(entries,{origin='fichier',fileName='',now=Date.now(),cultures=[]}={}){
  return{updatedAt:now,origin,fileName,cultures,source:EPHY_SOURCE.name,license:EPHY_SOURCE.license,url:EPHY_SOURCE.url,entries};
}
