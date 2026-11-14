// Modèles d'interventions : liste triée par usage, préremplissage d'un travail, choix pour la saisie rapide.
// Logique pure (testée sous Node). Les modèles se créent depuis le formulaire de travail (« Enregistrer comme modèle »).
import {normalize} from './utils.js';

const live=list=>(Array.isArray(list)?list:[]).filter(x=>x&&!x.deletedAt);
const same=(a,b)=>normalize(a)===normalize(b);

/** Nombre de travaux qui reprennent le type et le produit du modèle. */
export function templateUses(state,template){
  return live(state?.interventions).filter(w=>same(w.type,template.type)&&(!template.product||same(w.product,template.product))).length;
}

/** Modèles actifs, les plus utilisés d'abord, puis par nom. */
export function templateList(state){
  return live(state?.templates).map(t=>({template:t,uses:templateUses(state,t)}))
    .sort((a,b)=>b.uses-a.uses||String(a.template.name||'').localeCompare(String(b.template.name||''),'fr'));
}

/** Libellé court : produit, dose et unité. */
export function templateSummary(t){
  const dose=t.dose!==null&&t.dose!==undefined&&t.dose!==''?`${String(t.dose).replace('.',',')}${t.doseUnit?` ${t.doseUnit}`:''}`:'';
  return [t.type,t.product,dose,t.culture].filter(Boolean).join(' · ');
}

/** Travail prérempli « À faire » à partir d'un modèle. */
export function templateToWork(t,today){
  return {type:t.type,culture:t.culture,product:t.product,dose:t.dose,doseUnit:t.doseUnit,equipmentId:t.equipmentId,operator:t.operator,status:'À faire',date:today};
}

/** Modèles du même type de travail, pour les pastilles de la saisie rapide (3 au plus). */
export function templatesForType(state,type,limit=3){
  if(!type)return [];
  return templateList(state).filter(x=>same(x.template.type,type)).slice(0,limit).map(x=>x.template);
}

/** Nom nettoyé : 1 à 80 caractères, sinon null. */
export function cleanTemplateName(value){
  const name=String(value??'').replace(/\s+/g,' ').trim().slice(0,80);
  return name||null;
}
