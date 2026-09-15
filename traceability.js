import {campaignFor, localDate, normalize, toNumber} from './utils.js';

export const DOCUMENT_CATEGORIES=[
  'Analyse de sol','Facture','Bon / justificatif','Plan / carte','Matériel','Client / prestation','Réglementaire','Photo / constat','Autre'
];

export function normalizeDocumentTags(value){
  const list=Array.isArray(value)?value:String(value||'').split(/[;,]/);
  return [...new Set(list.map(tag=>String(tag||'').trim()).filter(Boolean))].slice(0,20);
}

export function documentContextParts(state,item={}){
  const parts=[];
  const parcel=(state.parcelles||[]).find(x=>x.id===item.parcelId&&!x.deletedAt);
  const work=(state.interventions||[]).find(x=>x.id===item.interventionId&&!x.deletedAt);
  const equipment=(state.materiels||[]).find(x=>x.id===item.equipmentId&&!x.deletedAt);
  const client=(state.clients||[]).find(x=>x.id===item.clientId&&!x.deletedAt);
  const chantier=(state.chantiers||[]).find(x=>x.id===item.chantierId&&!x.deletedAt);
  if(parcel)parts.push({type:'parcel',id:parcel.id,label:parcel.nom||'Parcelle'});
  if(work)parts.push({type:'work',id:work.id,label:`${work.type||'Travail'} · ${localDate(work.date||work.plannedDate)}`});
  if(equipment)parts.push({type:'equipment',id:equipment.id,label:equipment.nom||'Matériel'});
  if(client)parts.push({type:'client',id:client.id,label:client.name||'Client'});
  if(chantier)parts.push({type:'chantier',id:chantier.id,label:chantier.type||'Chantier'});
  return parts;
}

export function documentContextText(state,item={}){
  const parts=documentContextParts(state,item);
  return parts.length?parts.map(x=>x.label).join(' · '):'Non rattaché';
}

export function documentSummary(state){
  const documents=(state.documents||[]).filter(x=>!x.deletedAt);
  const photos=(state.photos||[]).filter(x=>!x.deletedAt);
  const unlinked=documents.filter(x=>!x.parcelId&&!x.interventionId&&!x.equipmentId&&!x.clientId&&!x.chantierId);
  const categories={};
  for(const doc of documents){const category=doc.category||'Autre';categories[category]=(categories[category]||0)+1;}
  const bytes=[...documents,...photos].reduce((sum,x)=>sum+toNumber(x.size),0);
  return{documents:documents.length,photos:photos.length,unlinked:unlinked.length,bytes,categories};
}

export function filterDocuments(state,{query='',category='',linked='all'}={}){
  const q=normalize(query);
  return(state.documents||[]).filter(x=>!x.deletedAt).filter(doc=>{
    if(category&&doc.category!==category)return false;
    const isLinked=Boolean(doc.parcelId||doc.interventionId||doc.equipmentId||doc.clientId||doc.chantierId);
    if(linked==='linked'&&!isLinked)return false;
    if(linked==='unlinked'&&isLinked)return false;
    if(!q)return true;
    const text=normalize([doc.name,doc.note,doc.category,(doc.tags||[]).join(' '),documentContextText(state,doc),doc.mimeType].join(' '));
    return text.includes(q);
  }).sort((a,b)=>String(b.documentDate||b.capturedAt||b.createdAt||'').localeCompare(String(a.documentDate||a.capturedAt||a.createdAt||'')));
}

export function traceabilityRows(state,{campaign=campaignFor()}={}){
  const parcels=new Map((state.parcelles||[]).filter(x=>!x.deletedAt).map(x=>[x.id,x]));
  const equipment=new Map((state.materiels||[]).filter(x=>!x.deletedAt).map(x=>[x.id,x]));
  const docs=(state.documents||[]).filter(x=>!x.deletedAt),photos=(state.photos||[]).filter(x=>!x.deletedAt);
  return(state.interventions||[]).filter(x=>!x.deletedAt&&x.status!=='Annulé'&&(x.campaignId||campaignFor(x.date||x.plannedDate))===campaign).map(work=>{
    const parcel=parcels.get(work.parcelId),machine=equipment.get(work.equipmentId||work.machineId);
    const attachedDocs=docs.filter(d=>d.interventionId===work.id||(!d.interventionId&&d.parcelId===work.parcelId&&d.documentDate===(work.date||work.plannedDate)));
    const attachedPhotos=photos.filter(d=>d.interventionId===work.id);
    const fields={date:work.date||work.plannedDate,parcel:parcel?.nom||'',type:work.type||'',product:work.product||'',dose:work.dose,operator:work.operator||'',equipment:machine?.nom||'',status:work.status||''};
    const required=[fields.date,fields.parcel,fields.type];
    return{...fields,id:work.id,parcelId:work.parcelId,campaign,unit:work.doseUnit||'',note:work.note||'',weatherSnapshot:work.weatherSnapshot||null,documents:attachedDocs.length,photos:attachedPhotos.length,complete:required.every(Boolean)};
  }).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(a.parcel).localeCompare(String(b.parcel),'fr'));
}

export function traceabilitySummary(state,{campaign=campaignFor()}={}){
  const rows=traceabilityRows(state,{campaign});
  const withProduct=rows.filter(r=>r.product).length,withOperator=rows.filter(r=>r.operator).length,withAttachment=rows.filter(r=>r.documents+r.photos>0).length,incomplete=rows.filter(r=>!r.complete).length;
  return{campaign,total:rows.length,withProduct,withOperator,withAttachment,incomplete};
}

function csvCell(value){const text=String(value??'').replaceAll('"','""');return `"${text}"`;}
export function traceabilityCsv(state,{campaign=campaignFor()}={}){
  const rows=traceabilityRows(state,{campaign});
  const header=['Campagne','Date','Parcelle','Travail','Produit','Dose','Unité','Opérateur','Matériel','Statut','Documents','Photos','Note'];
  return '\ufeff'+[header,...rows.map(r=>[campaign,r.date,r.parcel,r.type,r.product,r.dose??'',r.unit,r.operator,r.equipment,r.status,r.documents,r.photos,r.note])].map(row=>row.map(csvCell).join(';')).join('\n');
}

export function documentInventoryCsv(state){
  const docs=filterDocuments(state,{}),header=['Date document','Catégorie','Nom','Contexte','Tags','Type','Taille (octets)','Commentaire'];
  return '\ufeff'+[header,...docs.map(d=>[d.documentDate||'',d.category||'Autre',d.name||'',documentContextText(state,d),(d.tags||[]).join(', '),d.mimeType||'',d.size||0,d.note||''])].map(row=>row.map(csvCell).join(';')).join('\n');
}
