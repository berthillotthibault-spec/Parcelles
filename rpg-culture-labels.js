// Nomenclature des codes cultures PAC à jour (data.gouv.fr, jeu « Codes cultures PAC », un fichier
// ODS par campagne). Source du registre auto-update.js (contrat W0) : vérifiée au plus tous les 30 jours,
// téléchargée seulement quand le fichier de la dernière campagne a changé. Les libellés complètent la
// table embarquée de rpg.js (setRpgCultureLabels) sans la remplacer ; aucune culture déjà enregistrée
// n’est renommée. Lecture seule : aucune donnée de l’exploitation n’est envoyée.
import {RPG_CULTURE_LABELS} from './rpg.js';
import {loadVendor} from './vendor-loader.js';

export const RPG_CULTURES_DATASET_URL='https://www.data.gouv.fr/api/1/datasets/60d19ed9992173e4b9300362/';
export const RPG_CULTURES_MIN_CODES=50;
const DATASET_MAX_BYTES=512*1024;
const ODS_MAX_BYTES=2*1024*1024;
const RESOURCE_PATTERN=/n-cultures-(\d{4})\.ods/i;

/** Ressource ODS de la campagne la plus récente : {year,url,lastModified}, ou null. */
export function pickCultureResource(dataset){
  let best=null;
  for(const resource of Array.isArray(dataset?.resources)?dataset.resources:[]){
    const url=typeof resource?.url==='string'?resource.url:'';
    if(!/^https:\/\//i.test(url))continue;
    const match=RESOURCE_PATTERN.exec(String(resource.title||''))||RESOURCE_PATTERN.exec(url);
    if(!match)continue;
    const year=Number(match[1]);
    if(!best||year>best.year)best={year,url,lastModified:String(resource.last_modified||resource.created_at||'')};
  }
  return best;
}

const normalizeHeader=value=>String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const CODE_HEADERS=['code_culture','code'];
const LABEL_HEADERS=['nom_culture','libelle_culture','libelle'];

/**
 * Lignes d’une feuille (tableaux, comme sheet_to_json {header:1}, ou objets) vers {CODE: libellé}.
 * Colonnes repérées par leur en-tête : code_culture/nom_culture ou code/libelle.
 */
export function parseCultureRows(rows){
  const list=Array.isArray(rows)?rows:[];
  let data=[],codeAt=-1,labelAt=-1;
  if(list.length&&!Array.isArray(list[0])&&typeof list[0]==='object'){
    const keys=Object.keys(list[0]||{}),headers=keys.map(normalizeHeader);
    const code=CODE_HEADERS.map(h=>headers.indexOf(h)).find(i=>i>=0),label=LABEL_HEADERS.map(h=>headers.indexOf(h)).find(i=>i>=0);
    if(code===undefined||label===undefined)return{};
    data=list.map(row=>[row?.[keys[code]],row?.[keys[label]]]);codeAt=0;labelAt=1;
  }else{
    for(let i=0;i<Math.min(list.length,20);i++){
      const headers=(Array.isArray(list[i])?list[i]:[]).map(normalizeHeader);
      const code=CODE_HEADERS.map(h=>headers.indexOf(h)).find(at=>at>=0),label=LABEL_HEADERS.map(h=>headers.indexOf(h)).find(at=>at>=0);
      if(code!==undefined&&label!==undefined){codeAt=code;labelAt=label;data=list.slice(i+1);break;}
    }
    if(codeAt<0)return{};
  }
  const labels={};
  for(const row of data){
    if(!Array.isArray(row))continue;
    const code=String(row[codeAt]??'').trim().toUpperCase(),label=String(row[labelAt]??'').replace(/\s+/g,' ').trim();
    if(/^[A-Z0-9]{2,5}$/.test(code)&&label&&!labels[code])labels[code]=label.slice(0,120);
  }
  return labels;
}

async function limitedBytes(response,maxBytes){
  const declared=Number(response?.headers?.get?.('content-length'));
  const tooLarge=()=>{const error=new Error('Réponse trop volumineuse.');error.code='too-large';return error;};
  if(Number.isFinite(declared)&&declared>maxBytes)throw tooLarge();
  const buffer=await response.arrayBuffer();
  if(buffer.byteLength>maxBytes)throw tooLarge();
  return buffer;
}

// Nomenclature déjà lue (au moins 50 codes) ; la valeur embarquée ({labels:{}}) ne compte pas comme cache.
function cachedResult(cached){
  const labels=cached?.value?.labels;
  if(!labels||typeof labels!=='object'||Object.keys(labels).length<RPG_CULTURES_MIN_CODES)return null;
  return{value:cached.value,version:cached.version??String(cached.value.year??'')};
}

/** Fabrique (loadXlsx injectable pour les tests) ; rpgCultureLabelsSource est l’instance de l’appli. */
export function createRpgCultureLabelsSource({loadXlsx=()=>loadVendor('xlsx')}={}){
  return Object.freeze({
    id:'rpg-cultures',label:'Codes cultures PAC',ttlMs:30*24*3600*1000,timeoutMs:30000,
    embedded:Object.freeze({value:Object.freeze({year:null,lastModified:null,labels:Object.freeze({})}),version:`${Object.keys(RPG_CULTURE_LABELS).length} codes`,label:'table intégrée'}),
    async check({fetch,signal,cached}={}){
      const response=await fetch(RPG_CULTURES_DATASET_URL,{signal,headers:{accept:'application/json'}});
      if(!response?.ok)throw new Error(`data.gouv.fr indisponible${response?.status?` (${response.status})`:''}.`);
      let dataset;
      try{dataset=JSON.parse(new TextDecoder().decode(await limitedBytes(response,DATASET_MAX_BYTES)));}
      catch(error){if(error?.code==='too-large'||error?.name==='AbortError')throw error;throw new Error('Réponse de data.gouv.fr illisible.');}
      const resource=pickCultureResource(dataset);
      if(!resource)throw new Error('Nomenclature des cultures introuvable sur data.gouv.fr.');
      const previous=cachedResult(cached);
      // Même fichier que la dernière fois : rien à télécharger.
      if(previous&&previous.value.year===resource.year&&previous.value.lastModified===resource.lastModified)return previous;
      let XLSX=null;
      try{XLSX=globalThis.XLSX||await loadXlsx();}catch{XLSX=null;}
      if(!XLSX?.read){
        if(previous)return previous;
        throw new Error('Lecteur de tableur indisponible : nomenclature non lue.');
      }
      const file=await fetch(resource.url,{signal});
      if(!file?.ok)throw new Error(`Fichier des cultures indisponible${file?.status?` (${file.status})`:''}.`);
      const bytes=new Uint8Array(await limitedBytes(file,ODS_MAX_BYTES));
      let labels;
      try{
        const workbook=XLSX.read(bytes,{type:'array'});
        const sheet=workbook?.Sheets?.[workbook?.SheetNames?.[0]];
        labels=parseCultureRows(sheet?XLSX.utils.sheet_to_json(sheet,{header:1,defval:''}):[]);
      }catch{throw new Error('Fichier des cultures illisible.');}
      return{value:{year:resource.year,lastModified:resource.lastModified,labels},version:String(resource.year),sourceDate:resource.lastModified||undefined};
    },
    validate(result){
      const labels=result?.value?.labels;
      return Boolean(labels&&typeof labels==='object'&&Object.keys(labels).length>=RPG_CULTURES_MIN_CODES);
    }
  });
}

export const rpgCultureLabelsSource=createRpgCultureLabelsSource();
