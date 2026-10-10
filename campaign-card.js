// n° 88 — carte « Ma campagne » de l’accueil : logique pure.
// Marge estimée (marginModel), écart avec N−1, part de la récolte vendue, montant à facturer,
// une seule action contextuelle. Aucun chiffre si la fiabilité est inférieure à 50 %.
import {campaignFor} from './utils.js';
import {marginModel} from './pilotage.js';
import {commercialisation} from './sales.js';
import {clientsToBill,billableItems,lineTotal} from './invoices.js';
import {normalizeRole} from './permissions.js';

export const MIN_RELIABILITY=50;
export const previousCampaignId=id=>{const m=String(id||'').match(/^(\d{4})/);if(!m)return'';const y=Number(m[1])-1;return `${y}/${String(y+1).slice(-2)}`;};

export function campaignCardModel(state,{campaign=campaignFor(),role='owner'}={}){
  if(normalizeRole(role)==='viewer')return{hidden:true,reason:'viewer'};
  const m=marginModel(state,{campaign}),t=m.total,prevId=previousCampaignId(campaign),prev=marginModel(state,{campaign:prevId}).total;
  const reliable=t.reliability>=MIN_RELIABILITY&&t.margin!==null;
  const delta=reliable&&prev.margin!==null&&prev.reliability>=MIN_RELIABILITY?t.margin-prev.margin:null;
  let sold=null;
  try{const c=commercialisation(state,{campaign});sold=c.totals.volume>0?Math.min(1,c.totals.engaged/c.totals.volume):null;}catch{sold=null;}
  let toBill=0,toBillCount=0;
  try{for(const {client} of clientsToBill(state))for(const item of billableItems(state,client.id)){const v=lineTotal(item.line);if(v!==null){toBill+=v;toBillCount+=1;}}}catch{toBill=0;}
  const action=t.unknownRealized?{kind:'costs',text:`${t.unknownRealized} ${t.unknownRealized>1?'travaux réalisés':'travail réalisé'} sans coût : compléter`}
    :t.withoutProduct?{kind:'product',text:`${t.withoutProduct} parcelle${t.withoutProduct>1?'s':''} sans rendement ni prix : renseigner`}
    :toBill>0?{kind:'invoice',text:`${toBillCount} prestation${toBillCount>1?'s':''} à facturer`}
    :sold!==null&&sold<0.5?{kind:'sales',text:'Moins de la moitié de la récolte vendue : voir la commercialisation'}
    :null;
  return{hidden:false,campaign,previous:prevId,reliable,reliability:t.reliability,margin:reliable?t.margin:null,delta,sold,toBill:Math.round(toBill*100)/100,toBillCount,action,detail:m.reliability.detail};
}
