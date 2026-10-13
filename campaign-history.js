// n° 92 — Comparaison de campagnes sur 3 à 5 ans, par culture et par parcelle.
// Logique pure : chaque campagne passe par marginModel (moteur unique) ; la culture d'une parcelle
// est celle de l'assolement de la campagne (rotations), pas la culture actuelle.
import {campaignFor,normalize} from './utils.js';
import {marginModel,sumRows} from './pilotage.js';

const r2=v=>Math.round(v*100)/100;
export const METRICS=Object.freeze({marginHa:{label:'Marge/ha',mode:'margin'},costHa:{label:'Charges/ha',mode:'cost'}});
export const shiftCampaign=(id,n)=>{const m=String(id||'').match(/^(\d{4})/);if(!m)return'';const y=Number(m[1])+n;return`${y}/${String(y+1).slice(-2)}`;};
export const campaignRange=(last,years)=>Array.from({length:years},(_,i)=>shiftCampaign(last,i-years+1));

/** Moyenne olympique : sans la meilleure ni la pire année dès 3 valeurs ; simple en deçà. */
export function olympicMean(values){
  const v=values.filter(x=>x!==null&&x!==undefined&&Number.isFinite(x)).sort((a,b)=>a-b);
  if(!v.length)return{value:null,kind:null,count:0};
  const kept=v.length>=3?v.slice(1,-1):v;
  return{value:r2(kept.reduce((s,x)=>s+x,0)/kept.length),kind:v.length>=3?'olympique':'simple',count:v.length};
}

const cultureCell=(c,metric)=>({value:metric==='costHa'?c.costHa:c.marginHa,area:c.area,reliability:c.reliability,partial:(c.unknownRealized+c.unknownPlanned)>0||c.withoutProduct>0});
const parcelCell=(r,metric)=>({value:r.area>0?metric==='costHa'?r.charges/r.area:r.margin!==null?r.margin/r.area:null:null,area:r.area,reliability:r.reliability,culture:r.culture,partial:(r.unknownRealized+r.unknownPlanned)>0||r.product===null});

// Variantes d'un même libellé (casse, accents) agrégées sur les parcelles, pas écrasées ; libellé de la plus grande surface.
const cultureGroups=m=>{const g=new Map();for(const c of m.byCulture){const k=normalize(c.culture);if(!g.has(k))g.set(k,[k,c.culture,[]]);g.get(k)[2].push(...m.rows.filter(r=>r.culture===c.culture));}return[...g.values()];};

export function campaignHistory(state,{campaign=campaignFor(),years=5,by='culture',metric='marginHa'}={}){
  years=Math.min(5,Math.max(3,Number(years)||5));if(!METRICS[metric])metric='marginHa';
  const campaigns=campaignRange(campaign,years),models=campaigns.map(c=>marginModel(state,{campaign:c}));
  const farm=models.map(m=>metric==='costHa'?m.total.costHa:m.total.marginHa);
  const rows=new Map();
  models.forEach((m,i)=>{
    const list=by==='parcel'?m.rows.map(r=>({key:r.parcelId,label:r.parcel?.nom||'Parcelle',cell:parcelCell(r,metric)})):cultureGroups(m).map(([key,label,list])=>({key,label,cell:cultureCell(sumRows(list),metric)}));
    for(const x of list){const row=rows.get(x.key)||{key:x.key,label:x.label,cells:campaigns.map(()=>null)};row.cells[i]={...x.cell,value:x.cell.value===null||x.cell.value===undefined?null:r2(x.cell.value)};rows.set(x.key,row);}
  });
  const out=[...rows.values()].map(r=>{
    const values=r.cells.map(c=>c?.value??null),mean=olympicMean(values);
    // Années comparables : valeur connue de la parcelle et moyenne de l'exploitation connue.
    const comparable=values.map((v,i)=>v!==null&&farm[i]!==null&&farm[i]!==undefined?i:-1).filter(i=>i>=0);
    const worse=comparable.filter(i=>metric==='costHa'?values[i]>farm[i]:values[i]<farm[i]).length;
    return{...r,values,mean,known:values.filter(v=>v!==null).length,comparable:comparable.length,below:worse};
  }).sort((a,b)=>by==='parcel'?a.label.localeCompare(b.label,'fr'):(b.cells.at(-1)?.area||0)-(a.cells.at(-1)?.area||0)||a.label.localeCompare(b.label,'fr'));
  return{campaigns,by,metric,years,rows:out,farm:farm.map(v=>v===null||v===undefined?null:r2(v)),farmMean:olympicMean(farm)};
}

/** Classement : « Les Brosses : 3 années sur 4 sous la moyenne de l'exploitation ». */
export function underperformers(history,{minYears=2}={}){
  const word=history.metric==='costHa'?'au-dessus de la moyenne des charges':'sous la moyenne';
  return history.rows.filter(r=>r.comparable>=minYears&&r.below/r.comparable>0.5)
    .sort((a,b)=>b.below/b.comparable-a.below/a.comparable||b.below-a.below||a.label.localeCompare(b.label,'fr'))
    .map(r=>({key:r.key,label:r.label,below:r.below,comparable:r.comparable,text:`${r.label} : ${r.below} année${r.below>1?'s':''} sur ${r.comparable} ${word} de l’exploitation`}));
}

/** Points d'une mini-courbe (valeurs nulles sautées), coordonnées dans une boîte w × h. */
export function sparkPoints(values,{width=64,height=20,pad=2}={}){
  const pts=values.map((v,i)=>[i,v]).filter(p=>p[1]!==null);if(pts.length<2)return[];
  const ys=pts.map(p=>p[1]),min=Math.min(...ys),max=Math.max(...ys),span=max-min||1,n=Math.max(1,values.length-1);
  return pts.map(([i,v])=>[r2(pad+i*(width-2*pad)/n),r2(height-pad-(max===min?.5:(v-min)/span)*(height-2*pad))]);
}
