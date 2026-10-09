// n° 59 — Interface du catalogue E-Phy hors connexion : mise à jour (service configuré ou
// fichier), état et âge du catalogue, recherche, et fonction de recherche pour la saisie.
import {escapeHtml as e,formatNumber} from './utils.js';
import {
  CATALOG_KEY,EPHY_SOURCE,parseCatalogFile,filterForCultures,farmCultures,catalogLookup,searchCatalog,catalogStatus,catalogRecord
} from './phyto-catalog.js';
import {withdrawalLabel,phytoSheet} from './phyto.js';

export function createPhytoCatalogUI({store,modal,toast,endpoint=()=>globalThis.PARCELLES_EPHY_ENDPOINT||''}){
  const $=selector=>document.querySelector(selector);
  let catalog=null,lookupFn=()=>null,loading=null;

  async function load(){
    if(loading)return loading;
    loading=(async()=>{try{catalog=await store.storage.get(CATALOG_KEY)||null;}catch{catalog=null;}lookupFn=catalogLookup(catalog);return catalog;})();
    return loading;
  }
  async function save(entries,{origin,fileName='',reduce=true}){
    const cultures=farmCultures(store.state);
    const kept=reduce?filterForCultures(entries,cultures):entries;
    if(!kept.length)throw new Error(reduce&&entries.length?'Aucun produit pour les cultures de l’exploitation dans ce fichier.':'Aucun produit trouvé.');
    const record=catalogRecord(kept,{origin,fileName,cultures:reduce?cultures:[]});
    await store.storage.set(CATALOG_KEY,record);
    catalog=record;lookupFn=catalogLookup(record);
    return{kept:kept.length,total:entries.length};
  }
  const lookup=query=>lookupFn(query);

  async function fromEndpoint(){
    const url=String(endpoint()||'').trim();
    if(!url)throw new Error('Aucun service de catalogue configuré : importez un fichier E-Phy (CSV ou JSON).');
    if(!/^https:\/\//.test(url))throw new Error('Le service du catalogue doit être en HTTPS.');
    if(navigator.onLine===false)throw new Error('Hors connexion : le catalogue enregistré reste utilisable.');
    const cultures=farmCultures(store.state);
    const response=await fetch(`${url}${url.includes('?')?'&':'?'}cultures=${encodeURIComponent(cultures.join('|'))}`,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Service du catalogue indisponible (${response.status}).`);
    const text=await response.text();
    return parseCatalogFile(text,{fileName:/json/.test(response.headers.get('content-type')||'')?'service.json':'service.csv'});
  }

  function statusHtml(){
    const st=catalogStatus(catalog);
    return`<div class="phyto-catalog-status ${st.stale?'is-stale':''}" role="status"><strong>${e(st.label)}</strong>${catalog?.origin?`<small>Source : ${catalog.origin==='service'?'service configuré':`fichier ${e(catalog.fileName||'importé')}`}${catalog.cultures?.length?` · réduit à : ${e(catalog.cultures.join(', '))}`:''}</small>`:''}</div>`;
  }
  function entryHtml(x){
    const s=phytoSheet(x),w=withdrawalLabel(s);
    const facts=[s.category,s.dar!==null?`DAR jusqu’à ${formatNumber(s.dar)} j`:'',s.dre?`DRE ${s.dre} h`:'',s.zntWater!==null?`ZNT eau jusqu’à ${formatNumber(s.zntWater)} m`:''].filter(Boolean).join(' · ');
    return`<li class="phyto-catalog-item"><strong>${e(x.name)} <small>AMM ${e(x.amm)}</small></strong>${facts?`<small>${e(facts)}</small>`:''}${w?`<small class="phyto-withdrawn">${e(w)}</small>`:''}<small>${x.usages.slice(0,4).map(u=>e(`${u.culture}${u.target?` × ${u.target}`:''}${u.maxDose!==null?` : ${formatNumber(u.maxDose)} ${u.doseUnit}`:''}`)).join(' ; ')}${x.usages.length>4?` … (${x.usages.length} usages)`:''}</small></li>`;
  }

  async function open(){
    await load();
    modal('Catalogue phyto hors connexion','Numéros AMM, usages, doses, DAR, ZNT et DRE, consultables sans réseau.',
      `<div class="phyto-catalog">${statusHtml()}
        <p class="phyto-disclaimer"><strong>Indicatif.</strong> Données E-Phy (ANSES), ${e(EPHY_SOURCE.license)}. Elles peuvent avoir changé depuis la date du catalogue : vérifiez l’étiquette et <a href="https://ephy.anses.fr" target="_blank" rel="noopener">ephy.anses.fr</a>.</p>
        <div class="phyto-catalog-actions"><button type="button" class="button primary" id="phyto-catalog-update">Mettre à jour le catalogue phyto</button>
        <label class="button secondary phyto-catalog-file">Importer un fichier E-Phy<input type="file" id="phyto-catalog-file" accept=".csv,.json,text/csv,application/json" hidden></label></div>
        <label class="check-row phyto-catalog-reduce"><input type="checkbox" id="phyto-catalog-reduce" checked><span>Ne garder que les cultures de l’exploitation</span></label>
        <p class="phyto-hint">Fichier : export « produits et usages » du jeu E-Phy sur <a href="${e(EPHY_SOURCE.url)}" target="_blank" rel="noopener">data.gouv.fr</a> (CSV ou JSON).</p>
        <p class="form-error hidden" id="phyto-catalog-error" role="alert"></p>
        <label class="field-label">Rechercher (AMM ou nom)<input type="text" enterkeyhint="search" id="phyto-catalog-search" autocomplete="off" placeholder="Ex. 2100123 ou nom commercial"></label>
        <ul class="phyto-catalog-list" id="phyto-catalog-results"></ul></div>`,
      '<button class="button secondary" data-action="close-modal">Fermer</button>','large');
    const err=$('#phyto-catalog-error'),results=$('#phyto-catalog-results'),search=$('#phyto-catalog-search');
    const showError=m=>{err.textContent=m;err.classList.toggle('hidden',!m);};
    const render=()=>{const q=search.value;results.innerHTML=q.trim()?searchCatalog(catalog,q).map(entryHtml).join('')||'<li class="empty-state">Aucun produit trouvé.</li>':'';};
    const refresh=()=>{document.querySelector('.phyto-catalog-status')?.replaceWith(Object.assign(document.createElement('div'),{innerHTML:statusHtml()}).firstElementChild);render();};
    search.oninput=render;
    $('#phyto-catalog-update').onclick=async event=>{
      const b=event.currentTarget;if(b.disabled)return;b.disabled=true;showError('');
      try{const r=await save(await fromEndpoint(),{origin:'service',reduce:$('#phyto-catalog-reduce').checked});refresh();toast(`Catalogue phyto mis à jour : ${r.kept} produit${r.kept>1?'s':''}.`);}
      catch(error){showError(error.message);}finally{b.disabled=false;}
    };
    $('#phyto-catalog-file').onchange=async event=>{
      const file=event.target.files?.[0];if(!file)return;showError('');
      try{const text=await file.text(),r=await save(parseCatalogFile(text,{fileName:file.name}),{origin:'fichier',fileName:file.name,reduce:$('#phyto-catalog-reduce').checked});refresh();toast(`Catalogue importé : ${r.kept} produit${r.kept>1?'s':''} sur ${r.total}.`);}
      catch(error){showError(error.message);}finally{event.target.value='';}
    };
  }

  /** Rappel discret (fiche produit, saisie) quand le catalogue a plus de 30 jours. */
  function staleNotice(){
    const st=catalogStatus(catalog);
    return st.present&&st.stale?`<p class="phyto-catalog-stale">${e(st.label)}. <button type="button" class="text-button" data-action="open-phyto-catalog">Mettre à jour</button></p>`:'';
  }

  load();
  return{load,open,lookup,staleNotice,status:()=>catalogStatus(catalog)};
}
