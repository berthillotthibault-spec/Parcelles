// Index par parcelle pour les listes (écran Parcelles) : un seul passage sur les travaux, tâches et pâturages,
// au lieu d'un filtrage complet par parcelle (O(parcelles x travaux), et pire dans le tri « récent »).
// Mémoïsé par objet d'état et par révision : chaque instantané (store.snapshot) est un nouvel objet, et un état
// modifié sur place (store.state) change de metadata.revision, ce qui force le recalcul.
const cache=new WeakMap();

/** Regroupe les éléments non supprimés par parcelId, en gardant l'ordre d'origine. */
export function groupByParcel(items){
  const map=new Map();
  for(const item of Array.isArray(items)?items:[]){
    if(!item||item.deletedAt)continue;
    const id=item.parcelId;if(id===undefined||id===null||id==='')continue;
    let list=map.get(id);if(!list)map.set(id,list=[]);list.push(item);
  }
  return map;
}

/** {works, tasks, grazing} : Map parcelId -> éléments. Les pâturages gardent les sessions supprimées : leur filtre les écarte lui-même. */
export function parcelIndex(data){
  if(!data||typeof data!=='object')return {works:new Map(),tasks:new Map(),grazing:new Map()};
  const revision=data.metadata?.revision;
  const entry=cache.get(data);let index=entry&&entry.revision===revision?entry.index:null;
  if(!index){
    const grazing=new Map();
    for(const s of Array.isArray(data.grazingSessions)?data.grazingSessions:[]){const id=s?.parcelId;if(!id)continue;let list=grazing.get(id);if(!list)grazing.set(id,list=[]);list.push(s);}
    index={works:groupByParcel(data.interventions),tasks:groupByParcel(data.tasks),grazing};
    cache.set(data,{revision,index});
  }
  return index;
}

/** Mémoïse fn(clé) le temps d'un calcul (tri, rendu d'une liste). */
export function memoize(fn){const m=new Map();return key=>{if(!m.has(key))m.set(key,fn(key));return m.get(key);};}
