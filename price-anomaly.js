// Prix ou quantité anormaux sur une ligne de devis ou de facture, comparés à l’historique des pièces
// émises (même désignation, même unité). Sert d’avertissement non bloquant au contrôle avant émission
// (complianceReport d’invoices.js) : « Labour : 45 €/ha alors que vous facturez habituellement 95 €/ha
// (faute de frappe ?) ». Logique pure ; n’importe que invoices-core.js (pas de cycle avec invoices.js).
import {normalize} from './utils.js';
import {active} from './farm-memory.js';
import {invoices,quotes,docTypeOf,amountLine,lineKind,num,invoiceStatus} from './invoices-core.js';

export const MIN_HISTORY=3;
export const LOW_RATIO=0.5;
export const HIGH_RATIO=2;
export const QTY_RATIO=10;

const fmt=v=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(v).replace(/[  ]/g,' ');
const median=list=>{const p=[...list].sort((a,b)=>a-b),m=Math.floor(p.length/2);return p.length%2?p[m]:(p[m-1]+p[m])/2;};
const unitOf=l=>String(l?.unit||'u');
const per=(price,unit)=>unit==='forfait'?`${fmt(price)} € le forfait`:`${fmt(price)} €/${unit}`;
const labelOf=l=>String(l?.label||'').split(/\s+·\s+/)[0].trim()||'Ligne';

/**
 * Historique des prix et quantités par désignation normalisée + unité, sur les factures et devis émis
 * (brouillons, avoirs et acomptes exclus ; devis refusés ou convertis en facture et factures annulées par avoir
 * exclus aussi, pour ne pas compter deux fois une même vente). `byClient` : prix par client (tarifs négociés).
 * `exceptId` : le document contrôlé n’est pas son propre historique.
 */
export function lineHistory(state,{exceptId=null}={}){
  const map=new Map(),quoteList=quotes(state),isQuote=new Set(quoteList);
  for(const d of [...invoices(state),...quoteList]){
    const t=docTypeOf(d);if(d.id&&d.id===exceptId||d.status==='brouillon'||t==='avoir'||t==='acompte')continue;
    if(isQuote.has(d)?['refuse','converti'].includes(d.status):invoiceStatus(d,state)==='annulee')continue;
    for(const l of d.lines||[]){
      if(!amountLine(l)||lineKind(l)==='deduction')continue;
      const key=`${normalize(labelOf(l))}|${unitOf(l)}`;if(!map.has(key))map.set(key,{prices:[],quantities:[],byClient:new Map()});
      const h=map.get(key),p=num(l.unitPrice),q=num(l.quantity);
      if(p!==null&&p>0){
        h.prices.push(p);
        if(d.clientId)h.byClient.set(d.clientId,[...(h.byClient.get(d.clientId)||[]),p]);
      }
      if(q!==null&&q>0)h.quantities.push(q);
    }
  }
  return map;
}

/** Surface totale (ha) des parcelles rattachées à ce client, ou null si aucune n’est connue. */
export function clientSurface(state,clientId){
  if(!clientId)return null;
  const total=active(state,'parcelles').filter(p=>p.clientId===clientId).reduce((s,p)=>s+(num(Number(p.surfaceHa))||0),0);
  return total>0?Math.round(total*100)/100:null;
}

/**
 * Avertissements sur les lignes du document : prix < 50 % ou > 200 % de la médiane (au moins 3 prix
 * historiques ; ceux du même client s’il en a au moins 3, sinon tous les clients), quantité > 10 fois
 * l’habitude (au moins 3 quantités), surface facturée en ha supérieure
 * à la surface connue des parcelles du client. Retourne [{line, kind, text}], vide si rien d’anormal.
 */
export function priceAnomalies(state,doc,{history=null}={}){
  const t=docTypeOf(doc);if(t==='avoir'||!state)return[];
  const hist=history||lineHistory(state,{exceptId:doc?.id}),surface=clientSurface(state,doc?.clientId),out=[];
  (doc?.lines||[]).forEach((l,i)=>{
    if(!amountLine(l)||lineKind(l)==='deduction')return;
    const name=labelOf(l),unit=unitOf(l),h=hist.get(`${normalize(name)}|${unit}`),p=num(l.unitPrice),q=num(l.quantity);
    const own=h&&doc?.clientId?h.byClient?.get(doc.clientId)||[]:[],prices=own.length>=MIN_HISTORY?own:h?.prices||[];
    if(p!==null&&p>0&&prices.length>=MIN_HISTORY){
      const m=median(prices),text=`${name} : ${per(p,unit)} alors que vous facturez habituellement ${per(m,unit)} (faute de frappe ?)`;
      if(m>0&&(p<m*LOW_RATIO||p>m*HIGH_RATIO))out.push({line:i+1,kind:'price',text});
    }
    if(q!==null&&q>0){
      if(unit==='ha'&&surface!==null&&q>surface+0.01){
        const text=`${name} : ${fmt(q)} ha facturés alors que les parcelles connues de ce client font ${fmt(surface)} ha au total`
          +' (à vérifier, sauf si la ligne regroupe plusieurs passages)';
        out.push({line:i+1,kind:'surface',text});
      }else if(h&&h.quantities.length>=MIN_HISTORY){
        const m=median(h.quantities),text=`${name} : ${fmt(q)} ${unit} alors que vous facturez habituellement ${fmt(m)} ${unit} (faute de frappe ?)`;
        if(m>0&&q>m*QTY_RATIO)out.push({line:i+1,kind:'quantity',text});
      }
    }
  });
  return out;
}
