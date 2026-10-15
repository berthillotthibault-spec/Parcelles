// n° 105 : bilan de fin de journée (logique pure, lecture seule).
// composeDayReview(state, now) prépare la carte « Votre journée » de l'accueil : travaux du jour faits /
// restants, traces GPS du jour non rattachées à un travail, sorties de stock implicites à proposer.
// Rien n'est écrit ici : chaque proposition attend un clic et une confirmation dans day-review-ui.js.
import {dailySituation,localDay} from './home-priorities.js';
import {requiredStock} from './work-effects.js';
import {normalize} from './utils.js';

export const DAY_REVIEW_HOUR=17;
const finite=value=>typeof value==='number'&&Number.isFinite(value);

// Jour local d'une trace : début d'enregistrement, sinon date de création.
export function trackDay(track){
  const raw=track?.startedAt??track?.createdAt;
  if(raw===undefined||raw===null||raw==='')return '';
  if(typeof raw==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
  const date=new Date(raw);
  return Number.isFinite(date.getTime())?localDay(date):'';
}

// Sortie de stock implicite d'un travail terminé : un seul article dont le nom correspond au produit,
// unités homogènes (requiredStock renvoie null sinon) et aucun rapprochement déjà fait (stock ou heures
// machine : confirmer ici sans countMachine annulerait les heures déjà comptées, on renvoie vers l'écran Effets).
// alreadyOut : quantité déjà sortie à la main le même jour pour cet article (Stock › Mouvement), à signaler.
export function implicitStockExit(work,stockItems=[],stockMovements=[]){
  const effects=work?.resourceEffects;
  if(!work||work.deletedAt||work.status!=='Terminé'||effects?.stockItemId||effects?.machineId)return null;
  const product=normalize(work.product);if(!product)return null;
  const matches=stockItems.filter(item=>!item.deletedAt&&normalize(item.name)===product);
  if(matches.length!==1)return null;
  const item=matches[0],quantity=requiredStock(work,item);
  if(!finite(quantity)||quantity<=0)return null;
  const balance=finite(item.quantity)?item.quantity:null;
  const alreadyOut=(stockMovements||[]).filter(m=>m&&!m.deletedAt&&m.type==='Sortie'&&m.stockItemId===item.id&&work.date&&m.date===work.date)
    .reduce((sum,m)=>sum+(finite(Number(m.quantity))?Number(m.quantity):0),0);
  return {workId:work.id,workVersion:work.version??null,stockItemId:item.id,stockName:item.name||'',unit:item.unit||'',
    quantity,balance,balanceAfter:balance===null?null:balance-quantity,insufficient:balance===null||quantity>balance+1e-9,alreadyOut};
}

export function composeDayReview(state={},now=new Date()){
  const today=localDay(now),show=now.getHours()>=DAY_REVIEW_HOUR;
  const situation=dailySituation(state,today);
  const linked=new Set((state.interventions||[]).filter(w=>!w.deletedAt&&w.gpsTrackId).map(w=>w.gpsTrackId));
  const tracks=(state.gpsTracks||[]).filter(t=>!t.deletedAt&&trackDay(t)===today&&!linked.has(t.id))
    .map(t=>({id:t.id,name:t.name||'Trace GPS',parcelCount:(t.matchedParcels||[]).filter(m=>m&&m.share>=0.05).length}));
  const stockItems=state.stockItems||[];
  const stockExits=situation.done.map(w=>implicitStockExit(w,stockItems,state.stockMovements||[])).filter(Boolean);
  const byTime=(a,b)=>String(a.startTime||'99:99').localeCompare(String(b.startTime||'99:99'))||String(a.id).localeCompare(String(b.id));
  const done=[...situation.done].sort(byTime),remaining=[...situation.planned].sort(byTime);
  return {show,today,done,remaining,tracks,stockExits,
    empty:!done.length&&!remaining.length&&!tracks.length&&!stockExits.length};
}
