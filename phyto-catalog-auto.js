// Catalogue E-Phy : détection d'une nouvelle publication sur data.gouv (source du registre
// auto-update.js) et mise à jour automatique du catalogue local quand c'est utile.
// Logique pure : fetch, readZip, analyse, filtre et enregistrement sont injectés.
// Les deux URL (API data.gouv et ZIP sur static.data.gouv.fr) répondent avec CORS « * ».
import {ephyVersionDate,ephyVersionFromName} from './phyto-catalog.js';

export const EPHY_DATASET_SLUG='donnees-ouvertes-du-catalogue-e-phy-des-produits-phytopharmaceutiques-matieres-fertilisantes-et-supports-de-culture-adjuvants-produits-mixtes-et-melanges';
export const EPHY_API_URL=`https://www.data.gouv.fr/api/1/datasets/${EPHY_DATASET_SLUG}/`;
export const EPHY_TTL_MS=24*3600*1000;
// Réponse de l'API d'environ 21 Ko ; ZIP d'environ 4 Mo (garde-fous larges).
const API_MAX_BYTES=1024*1024;
export const EPHY_ZIP_MAX_BYTES=40*1024*1024;
const RESOURCE_RE=/decisionamm-intrant-format-csv-(\d{8})-utf8\.zip/i;
// Dans le ZIP : usages (obligatoire) et produits (état d'autorisation, date de retrait, fonction).
const USAGES_RE=/(^|\/)produits_usages_utf8\.csv$/i;
const USAGES_FALLBACK_RE=/(^|\/)usages_des_produits_autorises_utf8\.csv$/i;
const PRODUCTS_RE=/(^|\/)produits_utf8\.csv$/i;
export const ephyZipFilter=name=>USAGES_RE.test(name)||USAGES_FALLBACK_RE.test(name)||PRODUCTS_RE.test(name);

/** Ressource ZIP CSV UTF-8 la plus récente dans la réponse de l'API dataset data.gouv, sinon null. */
export function pickEphyResource(apiJson){
  const list=Array.isArray(apiJson?.resources)?apiJson.resources:[];
  let best=null;
  for(const r of list){
    const m=String(r?.title||'').match(RESOURCE_RE)||String(r?.url||'').match(RESOURCE_RE);
    const url=String(r?.url||'');
    if(!m||!ephyVersionDate(m[1])||!/^https:\/\//.test(url))continue;
    if(best&&best.version>=m[1])continue;
    const size=Number(r?.filesize);
    best={version:m[1],url,size:Number.isFinite(size)&&size>0?size:null,lastModified:String(r?.last_modified||'')||null};
  }
  return best;
}

/** Source du registre auto-update.js (contrat W0). */
export const ephyRemoteSource=Object.freeze({
  id:'ephy',
  label:'Catalogue E-Phy (ANSES)',
  ttlMs:EPHY_TTL_MS,
  timeoutMs:15000,
  embedded:Object.freeze({value:null,version:null,label:'aucune publication connue'}),
  async check({fetch,signal}){
    const response=await fetch(EPHY_API_URL,{signal,headers:{accept:'application/json'}});
    if(!response?.ok)throw new Error(`data.gouv indisponible (${response?.status??'réseau'}).`);
    const text=await response.text();
    if(text.length>API_MAX_BYTES)throw new Error('Réponse data.gouv trop volumineuse.');
    let json;try{json=JSON.parse(text);}catch{throw new Error('Réponse data.gouv illisible.');}
    const value=pickEphyResource(json);
    if(!value)throw new Error('Aucun fichier CSV UTF-8 E-Phy dans le jeu data.gouv.');
    return{value,version:value.version,sourceDate:ephyVersionDate(value.version)};
  },
  validate:result=>!!(result?.value&&ephyVersionDate(result.value.version)&&/^https:\/\//.test(result.value.url||'')&&result.version===result.value.version)
});

/** Vrai si la publication distante est plus récente que le catalogue enregistré. */
export function isNewerEphy(remote,catalog){
  const v=String(remote?.version||'');
  return!!ephyVersionDate(v)&&v>String(catalog?.sourceVersion||'');
}

const cultureSet=list=>[...new Set((list||[]).map(c=>String(c||'').trim().toLowerCase()).filter(Boolean))].sort().join('|');
export const culturesChanged=(catalog,cultures)=>cultureSet(catalog?.cultures)!==cultureSet(cultures);

/** Entrées d'un ZIP E-Phy (lues par readZip) → textes à analyser. */
export function ephyZipTexts(entries,{fileName=''}={}){
  const list=Array.isArray(entries)?entries:[];
  const usages=list.find(e=>USAGES_RE.test(e.name))||list.find(e=>USAGES_FALLBACK_RE.test(e.name));
  if(!usages)throw new Error('ZIP E-Phy sans fichier des usages (produits_usages_utf8.csv).');
  const products=list.find(e=>PRODUCTS_RE.test(e.name));
  return{usagesText:usages.text(),productsText:products?products.text():'',usagesName:usages.name,sourceVersion:ephyVersionFromName(fileName)||ephyVersionFromName(usages.name)};
}

// Erreurs du navigateur (fetch, abandon, délai) en anglais → message français court.
export function frenchError(error){
  const name=String(error?.name||''),message=String(error?.message||error||'');
  if(name==='AbortError'||name==='TimeoutError'||/timeout|timed out|aborted/i.test(message))return'Téléchargement E-Phy trop long : réessayez plus tard.';
  if(name==='TypeError'&&/fetch|network|load failed|connexion/i.test(message))return'Téléchargement E-Phy impossible : réseau indisponible.';
  return message||'Mise à jour du catalogue E-Phy impossible.';
}

/**
 * Télécharge et applique la publication E-Phy si elle est utile. Ne lève jamais : renvoie
 * {status:'updated'|'up-to-date'|'skipped'|'error', reason?, message?, kept?, version?}.
 * En cas d'échec, save n'est pas appelé (ou refuse) : le catalogue existant est conservé.
 */
// Un catalogue déjà présent n'est retéléchargé automatiquement qu'une fois par mois (fichier de ~4 Mo,
// publications E-Phy plusieurs fois par mois, réseau mobile non détectable sur iPhone).
export const EPHY_AUTO_REFRESH_DAYS=30;
export async function updateCatalogIfNeeded({remote,catalog=null,cultures=[],fetch,readZip,parseCatalogFile,filterForCultures,save,canDownload=()=>true,userRequested=false,signal,now=Date.now()}={}){
  if(!remote?.url||!ephyVersionDate(remote.version))return{status:'skipped',reason:'no-remote',message:'Publication E-Phy inconnue : vérification data.gouv impossible pour l’instant.'};
  // Catalogue complet choisi à la main (import sans réduction) : on garde ce choix.
  const reduce=!(catalog?.entries?.length&&!catalog.cultures?.length);
  const cultureList=(cultures||[]).filter(Boolean);
  if(reduce&&!cultureList.length)return{status:'skipped',reason:'no-cultures',message:'Aucune culture sur vos parcelles : renseignez-les pour réduire le catalogue.'};
  const newer=isNewerEphy(remote,catalog),changed=reduce&&catalog?.entries?.length>0&&culturesChanged(catalog,cultureList);
  if(!newer&&!changed&&catalog?.entries?.length)return{status:'up-to-date',reason:'same-version',version:catalog.sourceVersion||remote.version};
  if(!userRequested&&!changed&&catalog?.entries?.length){
    const local=Number(catalog.updatedAt)||Date.parse(`${catalog.sourceDate||''}T00:00:00`)||0;
    if(local&&now-local<EPHY_AUTO_REFRESH_DAYS*864e5)return{status:'skipped',reason:'recent',message:`Catalogue de moins de ${EPHY_AUTO_REFRESH_DAYS} jours : la nouvelle publication sera prise à la prochaine mise à jour mensuelle (ou touchez « Mettre à jour maintenant »).`};
  }
  if(!userRequested&&!canDownload())return{status:'skipped',reason:'save-data',message:'Économiseur de données actif : téléchargement reporté.'};
  try{
    if(remote.size&&remote.size>EPHY_ZIP_MAX_BYTES)throw new Error('Fichier E-Phy trop volumineux.');
    const response=await fetch(remote.url,{signal});
    if(!response?.ok)throw new Error(`Téléchargement E-Phy impossible (${response?.status??'réseau'}).`);
    const length=Number(response.headers?.get?.('content-length'));
    if(length>EPHY_ZIP_MAX_BYTES)throw new Error('Fichier E-Phy trop volumineux.');
    const buffer=await response.arrayBuffer();
    const texts=ephyZipTexts(await readZip(buffer,{only:ephyZipFilter}),{fileName:remote.url});
    const parsed=parseCatalogFile(texts.usagesText,{fileName:texts.usagesName,productsText:texts.productsText});
    const kept=reduce?filterForCultures(parsed,cultureList):parsed;
    if(!kept?.length)throw new Error('Aucun produit pour les cultures de l’exploitation dans la publication E-Phy.');
    const result=await save(kept,{origin:'auto',fileName:texts.usagesName,reduce:false,cultures:reduce?cultureList:[],sourceVersion:remote.version,sourceDate:ephyVersionDate(remote.version),allowShrink:changed});
    return{status:'updated',version:remote.version,kept:result?.kept??kept.length,total:parsed.length,culturesChanged:changed};
  }catch(error){
    return{status:'error',reason:'failed',message:frenchError(error)};
  }
}
