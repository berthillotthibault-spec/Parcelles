// Dossier de campagne imprimable (n° 83) : gabarit A4 élégant pour la banque, le centre de
// gestion ou la coopérative. Logique pure : aucun accès au DOM, tout est calculé hors ligne à
// partir des données saisies (Pilotage, coût de revient n° 81, commercialisation n° 82, stocks).
// Les montants sont indicatifs : le dossier ne remplace pas la comptabilité.
import {campaignFor,normalize} from './utils.js';
import {active,completed} from './farm-memory.js';
import {buildPilotage} from './pilotage.js';
import {economicSituation} from './advanced-economics.js';
import {costPriceByCulture,cultureFor,hasCost,isEstimatedCost,machineFixedCosts} from './costs.js';
import {commercialisation,contracts,contractProgress,toTonnes} from './sales.js';
import {farmRecords} from './farm-records.js';

const NB='\u202f';
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const loose=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:null;};
const positive=v=>{const n=loose(v);return n!==null&&n>0?n:null;};
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}),n1=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}),n2=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2});
const nbsp=s=>s.replace(/[\u00a0 ]/g,NB);
const minus=s=>s.replace(/^-/,'\u2212');
export const eur=v=>num(v)===null?'—':`${minus(nbsp(n0.format(Math.round(v))))}${NB}€`;
const perT=v=>num(v)===null?'—':`${minus(nbsp(n0.format(v)))}${NB}€/t`;
const perHa=v=>num(v)===null?'—':`${minus(nbsp(n0.format(v)))}${NB}€/ha`;
const ha=v=>`${nbsp(n2.format(v||0))}${NB}ha`;
const tonnes=v=>`${nbsp(n1.format(v||0))}${NB}t`;
const pct=v=>`${n0.format(Math.round((v||0)*100))}${NB}%`;
const plural=(count,one,many)=>`${count===0?'0':nbsp(n0.format(count))} ${count>1?many:one}`;
const dateFr=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:'—';};
const isoDay=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const longDate=d=>d.toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});

export const campaignShift=(campaign,delta)=>{const y=Number(String(campaign).slice(0,4))+delta;return`${y}/${String((y+1)%100).padStart(2,'0')}`;};

export const DOSSIER_SECTIONS=[
  {id:'synthese',label:'Synthèse de la campagne'},
  {id:'assolement',label:'Assolement'},
  {id:'cascade',label:'Du produit à la marge'},
  {id:'historique',label:'Historique sur trois campagnes'},
  {id:'charges',label:'Charges détaillées'},
  {id:'revient',label:'Coût de revient par culture'},
  {id:'commercialisation',label:'Commercialisation et encaissements'},
  {id:'stocks',label:'État des stocks'},
  {id:'rendements',label:'Rendements par parcelle'},
  {id:'lots',label:'Traçabilité des lots de récolte'},
  {id:'annexes',label:'Annexes : parcellaire et méthodes'}
];
export const DOSSIER_PRESETS=[
  {id:'banque',label:'Banque',lead:'Marges, commercialisation, encaissements attendus et historique.',sections:['synthese','assolement','cascade','historique','revient','commercialisation','annexes']},
  {id:'gestion',label:'Centre de gestion',lead:'Charges détaillées, structure, coût de revient et stocks au 31/12.',sections:['synthese','assolement','cascade','charges','revient','stocks','annexes']},
  {id:'cooperative',label:'Coopérative',lead:'Assolement, rendements, traçabilité des lots et contrats.',sections:['synthese','assolement','rendements','lots','commercialisation','annexes']}
];
export const presetById=id=>DOSSIER_PRESETS.find(p=>p.id===id)||DOSSIER_PRESETS[0];
const sectionLabel=id=>DOSSIER_SECTIONS.find(s=>s.id===id)?.label||id;

// Campagnes proposées : la campagne actuelle, les deux précédentes et celles présentes dans les données.
export function dossierCampaigns(state,today=new Date()){
  const current=campaignFor(today),set=new Set([current,campaignShift(current,-1),campaignShift(current,-2)]);
  for(const w of active(state,'interventions')){const c=w.campaignId||(w.date||w.plannedDate?campaignFor(w.date||w.plannedDate):null);if(c&&/^\d{4}\/\d{2}$/.test(c))set.add(c);}
  for(const p of active(state,'parcelles'))for(const c of Object.keys(p.economicsByCampaign||{}))if(/^\d{4}\/\d{2}$/.test(c))set.add(c);
  return[...set].filter(c=>c<=campaignShift(current,1)).sort().reverse();
}

const ownParcels=state=>active(state,'parcelles').filter(p=>(p.ownershipType||'own')==='own'&&!p.archived);
const campaignOf=w=>w.campaignId||(w.date||w.plannedDate?campaignFor(w.date||w.plannedDate):null);

export function assolement(state,campaign){
  const map=new Map();let total=0;
  for(const p of ownParcels(state)){const area=positive(p.surfaceHa)||0;const culture=cultureFor(state,p,campaign);const key=normalize(culture);const r=map.get(key)||{culture,area:0,parcels:0};r.area+=area;r.parcels+=1;map.set(key,r);total+=area;}
  return{total,rows:[...map.values()].map(r=>({...r,share:total>0?r.area/total:0})).sort((a,b)=>b.area-a.area||a.culture.localeCompare(b.culture,'fr'))};
}

// Cascade : produit brut − charges opérationnelles = marge brute − charges de structure = marge après structure.
export function cascade(pilotage,costs){
  // n° 85 : marginModel exclut de la marge les parcelles sans produit ; la cascade reste additive.
  const structure=costs.rows.reduce((s,r)=>s+(r.structure||0),0),margin=pilotage.grossProduct-pilotage.charges;
  const steps=[
    {id:'product',label:'Produit brut estimé',value:pilotage.grossProduct,kind:'total'},
    {id:'charges',label:'Charges opérationnelles',value:-pilotage.charges,kind:'delta'},
    {id:'margin',label:'Marge brute',value:margin,kind:'total'},
    {id:'structure',label:'Charges de structure',value:-structure,kind:'delta'},
    {id:'net',label:'Marge après structure',value:margin-structure,kind:'total'}
  ];
  return{steps,structure,net:margin-structure};
}

// Ventilation des charges de la campagne (travaux réalisés, prévus et charges €/ha saisies).
export function chargesDetail(state,campaign){
  const parts={seed:0,fertilizer:0,phyto:0,otherInputs:0,machine:0,fuel:0,labour:0,other:0};let actual=0,planned=0,manual=0,unknown=0,estimated=0,estimatedCount=0;
  for(const p of ownParcels(state)){
    const s=economicSituation(state,p,campaign);for(const k of Object.keys(parts))parts[k]+=s.components[k]||0;actual+=s.total;planned+=s.remaining;manual+=s.manualCosts;unknown+=s.unknown;
    for(const w of s.actual)if(isEstimatedCost(w)){estimated+=w.cost;estimatedCount+=1;}
  }
  const broken=Object.values(parts).reduce((s,v)=>s+v,0),unsplit=Math.max(0,actual-broken);
  const labels={seed:'Semences',fertilizer:'Engrais et amendements',phyto:'Produits phytosanitaires',otherInputs:'Autres intrants',machine:'Mécanisation',fuel:'Carburant',labour:'Main-d’œuvre',other:'Autres charges'};
  const lines=Object.entries(parts).filter(([,v])=>v>0).map(([k,v])=>({id:k,label:labels[k],value:v}));
  if(unsplit>0.5)lines.push({id:'unsplit',label:'Coûts de travaux non ventilés',value:unsplit});
  if(manual>0)lines.push({id:'manual',label:'Charges €/ha saisies sur les parcelles',value:manual});
  if(planned>0)lines.push({id:'planned',label:'Travaux prévus (coûts annoncés)',value:planned});
  const byType=new Map();
  for(const w of active(state,'interventions')){
    if(w.status==='Annulé'||campaignOf(w)!==campaign)continue;const label=String(w.type||'Autre').trim()||'Autre',key=normalize(label);const r=byType.get(key)||{label,count:0,cost:0,missing:0,estimated:0};
    r.count+=1;if(hasCost(w))r.cost+=w.cost;else if(completed(w))r.missing+=1;if(isEstimatedCost(w))r.estimated+=1;byType.set(key,r);
  }
  const fixed=machineFixedCosts(state);
  return{lines,total:lines.reduce((s,l)=>s+l.value,0),unknown,estimated,estimatedCount,byType:[...byType.values()].sort((a,b)=>b.cost-a.cost||b.count-a.count),machineFixed:fixed};
}

// Stock à une date : quantité actuelle moins les mouvements postérieurs, valorisée au prix unitaire actuel.
export function stockAt(state,date){
  const day=String(date).slice(0,10),movements=active(state,'stockMovements');
  const rows=active(state,'stockItems').map(item=>{
    let qty=loose(item.quantity)??0,uncertain=false;
    for(const m of movements){if(m.stockItemId!==item.id||!m.date||String(m.date).slice(0,10)<=day)continue;const d=num(m.delta);if(d===null){uncertain=true;continue;}qty-=d;}
    const price=positive(item.unitPrice);return{id:item.id,name:item.name||'Produit',category:item.category||'',unit:item.unit||'',quantity:qty,unitPrice:price,value:price!==null?qty*price:null,uncertain};
  }).sort((a,b)=>(b.value||0)-(a.value||0)||a.name.localeCompare(b.name,'fr'));
  return{date:day,rows,total:rows.reduce((s,r)=>s+(r.value||0),0),unpriced:rows.filter(r=>r.unitPrice===null).length,uncertain:rows.some(r=>r.uncertain)};
}
// Date de référence des stocks : le 31/12 de la campagne, ou aujourd’hui s’il n’est pas encore passé.
export function stockDate(campaign,today=new Date()){const end=`${String(campaign).slice(0,4)}-12-31`,now=isoDay(today);return end<now?end:now;}

export function yieldsByParcel(state,campaign){
  const lots=farmRecords(state,'harvest').filter(l=>l.date&&campaignFor(l.date)===campaign);
  return ownParcels(state).map(p=>{
    const econ=p.economicsByCampaign?.[campaign]||(campaign===campaignFor()?p.economics:null)||{},area=positive(p.surfaceHa),planned=positive(econ.yield),unit=econ.yieldUnit==='q/ha'?'q/ha':'t/ha';
    let harvested=0,count=0,unknownUnit=0;for(const l of lots.filter(l=>l.parcelId===p.id)){const t=toTonnes(l.quantity,l.unit);count+=1;if(t===null)unknownUnit+=1;else harvested+=t;}
    const real=count&&area?harvested/area*(unit==='q/ha'?10:1):null;
    return{parcel:p,culture:cultureFor(state,p,campaign),area,planned,unit,harvested,lots:count,real,unknownUnit};
  }).sort((a,b)=>a.culture.localeCompare(b.culture,'fr')||String(a.parcel.nom).localeCompare(String(b.parcel.nom),'fr'));
}

export function harvestLots(state,campaign){
  const parcels=new Map(active(state,'parcelles').map(p=>[p.id,p]));
  return farmRecords(state,'harvest').filter(l=>l.date&&campaignFor(l.date)===campaign).map(l=>{const p=parcels.get(l.parcelId);return{lot:l,parcel:p||null,culture:String(l.crop||'').trim()||(p?cultureFor(state,p,campaign):'—'),sales:l.sales||[]};}).sort((a,b)=>String(a.lot.date).localeCompare(String(b.lot.date)));
}

// Encaissements attendus : tonnage restant des contrats à prix connu, à la date de paiement prévue.
export function expectedReceipts(state,campaign){
  const rows=contracts(state,{campaign}).map(c=>contractProgress(state,c)).filter(p=>p.open>0).map(p=>({contract:p.contract,tonnes:p.open,price:p.price,firm:p.firm,amount:p.price!==null?p.open*p.price:null,date:p.contract.paymentDate||p.contract.deliveryDate||''}));
  return rows.sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999')));
}

export function dossierModel(state,{campaign=campaignFor(),preset='banque',sections=null,today=new Date()}={}){
  const p=presetById(preset),list=(sections||p.sections).filter(id=>DOSSIER_SECTIONS.some(s=>s.id===id));
  const pilotage=buildPilotage(state,{campaign}),costs=costPriceByCulture(state,{campaign}),parcels=ownParcels(state);
  const history=[campaignShift(campaign,-2),campaignShift(campaign,-1),campaign].map(c=>{const b=buildPilotage(state,{campaign:c});const hasData=b.charges>0||b.grossProduct>0;return{campaign:c,grossProduct:b.grossProduct,charges:b.charges,margin:b.grossProduct-b.charges,area:b.area,hasData};});
  const charges=chargesDetail(state,campaign);
  return{
    farm:{name:String(state.exploitation?.nom||'').trim()||'Mon exploitation',commune:String(state.exploitation?.commune||'').trim()},
    campaign,preset:p,sections:list,generatedAt:today,
    parcels,cultureOf:new Map(parcels.map(p=>[p.id,cultureFor(state,p,campaign)])),pilotage,costs,assolement:assolement(state,campaign),cascade:cascade(pilotage,costs),history,charges,
    sales:commercialisation(state,{campaign}),receipts:expectedReceipts(state,campaign),stocks:stockAt(state,stockDate(campaign,today)),
    yields:yieldsByParcel(state,campaign),lots:harvestLots(state,campaign),
    completeness:{unknown:charges.unknown,estimatedCount:charges.estimatedCount,estimated:charges.estimated,withoutYield:costs.rows.reduce((s,r)=>s+r.parcelsWithoutYield,0)}
  };
}

// ---------- Graphiques SVG (sans Leaflet, imprimables) ----------
export const PALETTE=['#2f6b4a','#b5832a','#4f7fa8','#a5523f','#7a6aa6','#5f8f3e','#3f8f8a','#9a6b8f','#8a7a52','#566b78'];
const ringsOf=g=>!g?[]:g.type==='Polygon'?[g.coordinates?.[0]||[]]:g.type==='MultiPolygon'?(g.coordinates||[]).map(p=>p?.[0]||[]):[];
export function parcelMapSvg(parcels,colorFor,{width=520,height=320}={}){
  const shapes=parcels.map(p=>({p,rings:ringsOf(p.geometry).map(r=>r.filter(pt=>Array.isArray(pt)&&Number.isFinite(pt[0])&&Number.isFinite(pt[1]))).filter(r=>r.length>2)})).filter(s=>s.rings.length);
  if(!shapes.length)return'';
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const s of shapes)for(const r of s.rings)for(const[x,y]of r){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  const k=Math.cos((minY+maxY)/2*Math.PI/180),w=Math.max((maxX-minX)*k,1e-9),h=Math.max(maxY-minY,1e-9),pad=12,scale=Math.min((width-2*pad)/w,(height-2*pad)/h),ox=(width-w*scale)/2,oy=(height-h*scale)/2;
  const pt=([x,y])=>`${((x-minX)*k*scale+ox).toFixed(1)},${((maxY-y)*scale+oy).toFixed(1)}`;
  const paths=shapes.map(s=>`<path d="${s.rings.map(r=>'M'+r.map(pt).join('L')+'Z').join('')}" fill="${colorFor(s.p)}" fill-opacity=".78" stroke="#fffdf8" stroke-width="1.2"><title>${esc(s.p.nom||'Parcelle')}</title></path>`).join('');
  return`<svg class="dz-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`Carte des ${plural(shapes.length,'parcelle','parcelles')}`)}">${paths}</svg>`;
}

function barsSvg(rows,{width=520,label}){
  const max=Math.max(...rows.map(r=>r.value),1),rowH=30,h=rows.length*rowH+4,lw=170;
  const bars=rows.map((r,i)=>{const w=Math.max(2,(width-lw-90)*r.value/max),y=i*rowH+4;return`<text x="0" y="${y+17}" class="dz-t">${esc(r.label.length>26?r.label.slice(0,25)+'…':r.label)}</text><rect x="${lw}" y="${y+4}" width="${w.toFixed(1)}" height="18" rx="3" fill="${r.color}"/><text x="${(lw+w+8).toFixed(1)}" y="${y+17}" class="dz-t dz-num">${esc(r.text)}</text>`;}).join('');
  return`<svg class="dz-chart" viewBox="0 0 ${width} ${h}" role="img" aria-label="${esc(label)}">${bars}</svg>`;
}

export function cascadeSvg(steps,{width=560,height=230}={}){
  const values=[];let run=0;for(const s of steps){if(s.kind==='total'){values.push([0,s.value]);run=s.value;}else{values.push([run,run+s.value]);run+=s.value;}}
  const lo=Math.min(0,...values.flat()),hi=Math.max(1,...values.flat()),top=18,bottom=54,plot=height-top-bottom,y=v=>top+(hi-v)/(hi-lo)*plot,colW=width/steps.length,bw=colW*.56;
  const zero=`<line x1="0" x2="${width}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="#8a8f88" stroke-width="1"/>`;
  const bars=steps.map((s,i)=>{const[a,b]=values[i],x=i*colW+(colW-bw)/2,y1=y(Math.max(a,b)),y2=y(Math.min(a,b)),fill=s.kind==='total'?(s.value<0?'#a5523f':'#2f6b4a'):'#c99a5b';
    return`<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,y2-y1).toFixed(1)}" rx="3" fill="${fill}"/><text x="${(x+bw/2).toFixed(1)}" y="${(y1-5).toFixed(1)}" text-anchor="middle" class="dz-t dz-num">${esc(eur(s.value))}</text><text x="${(x+bw/2).toFixed(1)}" y="${height-34}" text-anchor="middle" class="dz-t dz-small">${esc(s.label.split(' ').slice(0,2).join(' '))}</text><text x="${(x+bw/2).toFixed(1)}" y="${height-20}" text-anchor="middle" class="dz-t dz-small">${esc(s.label.split(' ').slice(2).join(' '))}</text>`;}).join('');
  return`<svg class="dz-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(steps.map(s=>`${s.label} ${eur(s.value)}`).join(', '))}">${zero}${bars}</svg>`;
}

function historySvg(history,{width=560,height=220}={}){
  const series=[['grossProduct','Produit','#2f6b4a'],['charges','Charges','#c99a5b'],['margin','Marge','#4f7fa8']],vals=history.flatMap(h=>h.hasData?series.map(([k])=>h[k]):[0]);
  const lo=Math.min(0,...vals),hi=Math.max(1,...vals),top=18,bottom=34,plot=height-top-bottom,y=v=>top+(hi-v)/(hi-lo)*plot,colW=width/history.length,bw=colW/5;
  const groups=history.map((h,i)=>{const x0=i*colW+colW/2-bw*1.5;return(h.hasData?series.map(([k,,c],j)=>{const v=h[k],y1=y(Math.max(0,v)),y2=y(Math.min(0,v));return`<rect x="${(x0+j*bw).toFixed(1)}" y="${y1.toFixed(1)}" width="${(bw-3).toFixed(1)}" height="${Math.max(1,y2-y1).toFixed(1)}" rx="2" fill="${c}"/>`;}).join(''):`<text x="${(i*colW+colW/2).toFixed(1)}" y="${(y(0)-8).toFixed(1)}" text-anchor="middle" class="dz-t dz-small">Aucune donnée</text>`)+`<text x="${(i*colW+colW/2).toFixed(1)}" y="${height-12}" text-anchor="middle" class="dz-t">${esc(h.campaign)}</text>`;}).join('');
  const legend=series.map(([,l,c],j)=>`<rect x="${j*110}" y="0" width="10" height="10" rx="2" fill="${c}"/><text x="${j*110+15}" y="9" class="dz-t dz-small">${l}</text>`).join('');
  return`<svg class="dz-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(history.map(h=>h.hasData?`${h.campaign} : produit ${eur(h.grossProduct)}, charges ${eur(h.charges)}, marge ${eur(h.margin)}`:`${h.campaign} : aucune donnée`).join(' ; '))}"><g>${legend}</g><line x1="0" x2="${width}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="#8a8f88"/>${groups}</svg>`;
}

// ---------- Gabarit d’impression A4 partagé ----------
export function printCss({assetBase='',footer='',cover=true}={}){
  const font=(fam,file)=>assetBase?`@font-face{font-family:'${fam}';font-weight:${fam==='Instrument Sans'?'400 700':'400'};font-display:swap;src:url('${assetBase}${file}') format('woff2')}`:'';
  const foot=String(footer).replace(/["\\\n]/g,' ');
  return`${font('Instrument Sans','instrument-sans-latin.woff2')}${font('Instrument Serif','instrument-serif-latin.woff2')}
:root{--ink:#172019;--muted:#59625b;--rule:#d9d4c7;--soft:#f1ece0;--brand:#2f6b4a;--cream:#f6f1e6;--paper:#fffdf8}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--cream);color:var(--ink);font:400 10.5pt/1.45 'Instrument Sans',system-ui,-apple-system,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums}
h1,h2,h3{font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-weight:400;color:var(--ink);margin:0 0 .4em;line-height:1.1}
h1{font-size:30pt}h2{font-size:20pt;border-bottom:1px solid var(--rule);padding-bottom:6px;margin-bottom:14px}h3{font-size:13.5pt;margin-top:16px}
p{margin:0 0 .6em}.muted{color:var(--muted)}small{font-size:8.5pt}
.dz-toolbar{position:sticky;top:0;z-index:2;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;padding:10px 16px;background:rgba(246,241,230,.94);border-bottom:1px solid var(--rule)}
.dz-toolbar button{min-height:44px;padding:0 20px;border-radius:999px;border:1px solid var(--brand);background:var(--brand);color:#fff;font:600 15px 'Instrument Sans',system-ui,sans-serif;cursor:pointer}
.dz-toolbar button:focus-visible{outline:3px solid #b5832a;outline-offset:2px}
.page{width:210mm;max-width:calc(100% - 24px);min-height:297mm;margin:20px auto;padding:16mm 15mm 14mm;background:var(--paper);box-shadow:0 1px 2px rgba(0,0,0,.06),0 10px 30px rgba(60,50,20,.10);border-radius:4px;display:flex;flex-direction:column}
.page>.dz-body{flex:1}
.dz-foot{display:flex;justify-content:space-between;gap:12px;margin-top:14px;padding-top:8px;border-top:1px solid var(--rule);color:var(--muted);font-size:8.5pt}
table{width:100%;border-collapse:collapse;margin:8px 0 14px;font-size:9.5pt}
th{font-weight:600;text-align:left;color:var(--muted);font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;border-bottom:1.5px solid var(--ink);padding:6px 6px}
td{padding:6px;border-bottom:1px solid var(--rule);vertical-align:top}
td.n,th.n{text-align:right;white-space:nowrap}tfoot td{font-weight:600;border-top:1.5px solid var(--ink);border-bottom:0}
tr,figure,.dz-kpis,.dz-note,.dz-sign{break-inside:avoid}
.dz-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0 16px}
.dz-kpi{padding:10px 12px;border:1px solid var(--rule);border-radius:10px;background:#fff}
.dz-kpi strong{display:block;font:400 17pt/1.1 'Instrument Serif',Georgia,serif}.dz-kpi span{color:var(--muted);font-size:8.5pt}
.dz-neg{color:#9b3b2e}
figure{margin:6px 0 14px}figcaption{color:var(--muted);font-size:8.5pt;margin-top:4px}
.dz-chart,.dz-map{display:block;width:100%;height:auto}.dz-map{max-height:78mm;background:#f4efe3;border-radius:8px}.dz-t{font:9px 'Instrument Sans',system-ui,sans-serif;fill:#172019}.dz-small{font-size:8px;fill:#59625b}.dz-num{font-variant-numeric:tabular-nums}
.dz-note{padding:10px 12px;border-left:3px solid #b5832a;background:var(--soft);border-radius:0 8px 8px 0;font-size:9pt;margin:10px 0}
.dz-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:6px 0 0;padding:0;list-style:none;font-size:8.5pt}.dz-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.dz-cover .dz-body{display:flex;flex-direction:column;gap:14px}
.dz-eyebrow{font-size:9pt;letter-spacing:.14em;text-transform:uppercase;color:var(--brand);font-weight:600}
.dz-cover h1{font-size:40pt;margin-top:6mm}.dz-cover .dz-sub{font:400 17pt/1.2 'Instrument Serif',Georgia,serif;color:var(--muted)}
.dz-toc{counter-reset:toc;list-style:none;padding:0;margin:0;columns:2;column-gap:24px;font-size:10pt}.dz-toc li{counter-increment:toc;padding:3px 0;break-inside:avoid}.dz-toc li::before{content:counter(toc) ". ";color:var(--brand);font-weight:600}
.dz-sign{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}.dz-sign div{border:1px solid var(--rule);border-radius:10px;padding:10px 12px;min-height:34mm}
.dz-tag{display:inline-block;padding:1px 7px;border-radius:999px;background:var(--soft);font-size:8pt;color:var(--muted)}
@media (max-width:640px){.page{padding:18px 14px;min-height:0}.dz-kpis{grid-template-columns:1fr 1fr}.dz-toc{columns:1}.dz-cover h1{font-size:30pt}table{font-size:8.5pt}.dz-wide{display:block;overflow-x:auto}}
@page{size:A4;margin:14mm 13mm 16mm;@bottom-left{content:"${foot}";font:8pt 'Instrument Sans',system-ui,sans-serif;color:#59625b}@bottom-right{content:"page " counter(page) "/" counter(pages);font:8pt 'Instrument Sans',system-ui,sans-serif;color:#59625b}}
${cover?'@page:first{@bottom-left{content:none}@bottom-right{content:none}}':''}
@media print{body{background:#fff;font-size:10pt}.dz-toolbar,.dz-foot{display:none!important}.page{width:auto;max-width:none;min-height:0;margin:0;padding:0;box-shadow:none;border-radius:0;background:#fff;break-after:page}.page:last-child{break-after:auto}.dz-kpi{background:#fff}}`;
}

export function printDocument({title,css,body}){
  return`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body><div class="dz-toolbar"><button type="button" id="print">Imprimer / PDF</button></div>${body}<script>document.getElementById('print').addEventListener('click',function(){print()})<\/script></body></html>`;
}

// ---------- Sections ----------
const table=(head,rows,foot='')=>`<div class="dz-wide"><table><thead><tr>${head.map(h=>`<th${/^n:/.test(h)?' class="n"':''}>${esc(h.replace(/^n:/,''))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>${foot}</table></div>`;
const tr=cells=>`<tr>${cells.map(c=>Array.isArray(c)?`<td class="n">${c[0]}</td>`:`<td>${c}</td>`).join('')}</tr>`;
const kpi=(value,label,neg=false)=>`<div class="dz-kpi"><strong${neg?' class="dz-neg"':''}>${esc(value)}</strong><span>${esc(label)}</span></div>`;

function cultureColors(rows){const m=new Map();rows.forEach((r,i)=>m.set(normalize(r.culture),PALETTE[i%PALETTE.length]));return m;}

const SECTION_RENDER={
  synthese(m){
    const p=m.pilotage,c=m.completeness,area=m.assolement.total;
    const parts=[];if(c.unknown)parts.push(`${plural(c.unknown,'travail réalisé','travaux réalisés')} sans coût`);if(c.estimatedCount)parts.push(`${plural(c.estimatedCount,'coût estimé','coûts estimés')} (${eur(c.estimated)})`);if(c.withoutYield)parts.push(`${plural(c.withoutYield,'parcelle','parcelles')} sans rendement prévu`);
    return`<p>Campagne ${esc(m.campaign)} : ${esc(plural(m.parcels.length,'parcelle','parcelles'))} pour ${esc(ha(area))}, ${esc(plural(m.assolement.rows.length,'culture','cultures'))}.</p><div class="dz-kpis">${kpi(ha(area),'surface exploitée')}${kpi(eur(p.grossProduct),'produit brut estimé')}${kpi(eur(p.charges),'charges opérationnelles')}${kpi(eur(p.margin),'marge brute estimée',p.margin<0)}${kpi(perHa(p.marginHa),'marge brute par hectare',p.marginHa<0)}${kpi(eur(m.cascade.net),'marge après structure (indicative)',m.cascade.net<0)}</div>
${parts.length?`<p class="dz-note"><strong>Données incomplètes.</strong> ${esc(parts.join(' · '))}. Les montants correspondants sont sous-estimés ou estimés.</p>`:'<p class="dz-note">Tous les travaux réalisés de la campagne ont un coût renseigné.</p>'}`;
  },
  assolement(m){
    const colors=cultureColors(m.assolement.rows);
    const rows=m.assolement.rows.map(r=>({label:r.culture,value:r.area,color:colors.get(normalize(r.culture)),text:`${ha(r.area)} · ${pct(r.share)}`}));
    if(!rows.length)return'<p class="muted">Aucune parcelle en propre.</p>';
    return`<figure>${barsSvg(rows,{label:`Assolement : ${rows.map(r=>`${r.label} ${r.text}`).join(', ')}`})}<figcaption>Surface par culture (rotation de la campagne, sinon culture actuelle).</figcaption></figure>${table(['Culture','n:Parcelles','n:Surface','n:Part'],m.assolement.rows.map(r=>tr([esc(r.culture),[r.parcels],[esc(ha(r.area))],[esc(pct(r.share))]])),`<tfoot>${tr(['Total',[m.parcels.length],[esc(ha(m.assolement.total))],['100'+NB+'%']])}</tfoot>`)}`;
  },
  cascade(m){
    const s=m.cascade,c=m.costs;
    return`<figure>${cascadeSvg(s.steps)}<figcaption>Cascade indicative de la campagne ${esc(m.campaign)}.</figcaption></figure>${table(['Poste','n:Montant','n:Par hectare'],s.steps.map(x=>tr([x.kind==='total'?`<strong>${esc(x.label)}</strong>`:esc(x.label),[esc(eur(x.value))],[esc(perHa(m.assolement.total?x.value/m.assolement.total:null))]])))}
<p class="dz-note">Charges de structure : amortissements et assurances du matériel (${esc(eur(c.machineFixed.total))} par an, ${esc(plural(c.machineFixed.count,'matériel','matériels'))})${c.structureCostHa?` et ${esc(perHa(c.structureCostHa))} saisis dans « Charges de structure »`:''}, répartis au prorata des surfaces. Fermages, main-d’œuvre permanente et frais financiers ne sont comptés que s’ils ont été saisis.</p>`;
  },
  historique(m){
    const h=m.history;
    return`<figure>${historySvg(h)}<figcaption>Produit brut, charges et marge brute estimés, campagne par campagne.</figcaption></figure>${table(['Campagne','n:Surface','n:Produit brut','n:Charges','n:Marge brute','n:Marge/ha'],h.map(x=>tr([esc(x.campaign),[esc(ha(x.area))],[x.hasData?esc(eur(x.grossProduct)):'—'],[x.hasData?esc(eur(x.charges)):'—'],[x.hasData?esc(eur(x.margin)):'—'],[x.hasData&&x.area?esc(perHa(x.margin/x.area)):'—']])))}<p class="muted"><small>Une campagne sans travaux chiffrés ni produit saisi apparaît « — » : aucune valeur n’est extrapolée.</small></p>`;
  },
  charges(m){
    const c=m.charges;
    return`<h3>Charges opérationnelles par nature</h3>${c.lines.length?table(['Nature','n:Montant','n:Part'],c.lines.map(l=>tr([esc(l.label),[esc(eur(l.value))],[esc(pct(c.total?l.value/c.total:0))]])),`<tfoot>${tr(['Total',[esc(eur(c.total))],['']])}</tfoot>`):'<p class="muted">Aucune charge chiffrée pour cette campagne.</p>'}
<h3>Par type de travail</h3>${c.byType.length?table(['Travail','n:Nombre','n:Coût saisi','n:Sans coût'],c.byType.map(r=>tr([esc(r.label)+(r.estimated?` <span class="dz-tag">${esc(plural(r.estimated,'estimé','estimés'))}</span>`:''),[r.count],[esc(eur(r.cost))],[r.missing||'—']]))):'<p class="muted">Aucun travail sur cette campagne.</p>'}
<h3>Structure</h3>${m.pilotage.equipment.length?table(['Matériel','n:Heures','n:Coût travaux','n:Entretien','n:Fixes annuels'],m.pilotage.equipment.map(e=>tr([esc(e.name),[esc(nbsp(n1.format(e.workHours))+NB+'h')],[esc(eur(e.workCost))],[esc(eur(e.maintenanceCost))],[esc(eur(e.fixedAnnual))]]))):'<p class="muted">Aucun matériel enregistré.</p>'}
${c.estimatedCount?`<p class="dz-note">${esc(plural(c.estimatedCount,'coût de travail est estimé','coûts de travaux sont estimés'))} par l’assistant « Compléter les coûts » (${esc(eur(c.estimated))}).</p>`:''}`;
  },
  revient(m){
    const rows=m.costs.rows;if(!rows.length)return'<p class="muted">Aucune culture.</p>';
    return table(['Culture','n:Surface','n:Rendement','n:Coût de revient','n:Prix d’équilibre','n:Prix actuel','n:Écart'],rows.map(r=>tr([esc(r.culture)+(r.partial?' <span class="dz-tag">partiel</span>':''),[esc(ha(r.area))],[r.yield!==null?esc(r.yieldUnit==='q/ha'?`${nbsp(n1.format(r.yield*10))}${NB}q/ha`:`${nbsp(n1.format(r.yield))}${NB}t/ha`):'à saisir'],[esc(perT(r.costPrice))],[esc(perT(r.breakEven))],[esc(perT(r.currentPrice))],[r.delta===null?'—':`<span class="${r.delta<0?'dz-neg':''}">${r.delta>0?'+':''}${esc(perT(r.delta))}</span>`]])))+`<p class="dz-note">Coût de revient = charges de campagne ÷ production estimée (rendement prévu × surface). Prix d’équilibre = même calcul avec la quote-part des charges de structure. Prix actuel : prix de vente saisi sur les parcelles, sinon prix moyen des ventes déclarées. Valeurs indicatives.</p>`;
  },
  commercialisation(m){
    const rows=m.sales.rows.filter(r=>r.volume>0||r.contracts.length||r.salesCount);
    const main=rows.length?table(['Culture','n:Volume','n:Commercialisé','n:Prix moyen','n:Reste à vendre','n:Produit estimé'],rows.map(r=>tr([esc(r.culture),[r.volume>0?esc(tonnes(r.volume)):'—'],[r.share!==null?esc(pct(r.share)):'—'],[esc(perT(r.averagePrice))],[esc(tonnes(r.remaining))],[esc(eur(r.grossProduct))]]))):'<p class="muted">Aucun volume, vente ou contrat pour cette campagne.</p>';
    const rec=m.receipts,total=rec.reduce((s,r)=>s+(r.amount||0),0);
    const receipts=rec.length?`<h3>Encaissements attendus des contrats</h3>${table(['Échéance','Acheteur','Culture','n:Tonnage restant','n:Prix','n:Montant'],rec.map(r=>tr([esc(dateFr(r.date)),esc(r.contract.buyer||'—'),esc(r.contract.culture||''),[esc(tonnes(r.tonnes))],[r.price!==null?esc(perT(r.price))+(r.firm?'':' <span class="dz-tag">indicatif</span>'):'à fixer'],[esc(eur(r.amount))]])),`<tfoot>${tr(['Total','','','','',[esc(eur(total))]])}</tfoot>`)}`:'';
    return`${main}${receipts}<p class="dz-note">Produit estimé par priorité : ventes déclarées dans les lots, puis contrats, puis prix de vente estimé des parcelles. Les encaissements suivent la date de paiement du contrat (à défaut, la date de livraison) : ce n’est pas un plan de trésorerie.</p>`;
  },
  stocks(m){
    const s=m.stocks;if(!s.rows.length)return'<p class="muted">Aucun article en stock.</p>';
    return`<p>Stocks au ${esc(dateFr(s.date))} : valeur estimée <strong>${esc(eur(s.total))}</strong>.</p>${table(['Produit','Catégorie','n:Quantité','n:Prix unitaire','n:Valeur'],s.rows.map(r=>tr([esc(r.name)+(r.uncertain?' <span class="dz-tag">à vérifier</span>':''),esc(r.category||'—'),[esc(`${nbsp(n2.format(r.quantity))}${r.unit?NB+r.unit:''}`)],[r.unitPrice!==null?esc(`${nbsp(n2.format(r.unitPrice))}${NB}€`):'—'],[esc(eur(r.value))]])),`<tfoot>${tr(['Total','','','',[esc(eur(s.total))]])}</tfoot>`)}<p class="dz-note">Quantités reconstituées à partir du stock actuel et des mouvements postérieurs à la date, valorisées au prix unitaire actuel (estimation).${s.unpriced?` ${esc(plural(s.unpriced,'article sans prix','articles sans prix'))} : non valorisé${s.unpriced>1?'s':''}.`:''}</p>`;
  },
  rendements(m){
    if(!m.yields.length)return'<p class="muted">Aucune parcelle.</p>';
    const f=(v,u)=>v===null?'—':`${nbsp(n1.format(v))}${NB}${u}`;
    return table(['Parcelle','Culture','n:Surface','n:Rendement prévu','n:Récolté','n:Rendement réel'],m.yields.map(y=>tr([esc(y.parcel.nom||'Parcelle'),esc(y.culture),[y.area?esc(ha(y.area)):'—'],[esc(f(y.planned,y.unit))],[y.lots?esc(tonnes(y.harvested))+` <small class="muted">(${esc(plural(y.lots,'lot','lots'))})</small>`:'—'],[esc(f(y.real,y.unit))]])))+'<p class="muted"><small>Rendement réel = tonnage des lots de récolte de la parcelle ÷ surface.</small></p>';
  },
  lots(m){
    if(!m.lots.length)return'<p class="muted">Aucun lot de récolte enregistré pour cette campagne.</p>';
    return table(['Lot','Date','Parcelle','Culture','n:Quantité','n:Humidité','Silo','Ventes'],m.lots.map(({lot,parcel,culture,sales})=>tr([esc(lot.code||lot.name||'—'),esc(dateFr(lot.date)),esc(parcel?.nom||'—'),esc(culture),[esc(`${nbsp(n2.format(loose(lot.quantity)??0))}${NB}${lot.unit||'t'}`)],[loose(lot.humidity)!==null?esc(`${nbsp(n1.format(loose(lot.humidity)))}${NB}%`):'—'],esc(lot.silo||'—'),sales.length?sales.map(s=>esc(`${s.buyer||'Acheteur'} · ${nbsp(n2.format(loose(s.quantity)??0))}${NB}${lot.unit||'t'}`)).join('<br>'):'—'])));
  },
  annexes(m){
    const colors=cultureColors(m.assolement.rows);
    const parcels=[...m.parcels].sort((a,b)=>String(a.nom).localeCompare(String(b.nom),'fr'));
    return`<h3>Parcellaire</h3>${table(['Parcelle','Culture','Commune','n:Surface'],parcels.map(p=>tr([`<i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:${colors.get(normalize(m.cultureOf.get(p.id)||''))||'#8a8f88'}"></i>${esc(p.nom||'Parcelle')}`,esc(m.cultureOf.get(p.id)||'—'),esc(p.commune||'—'),[esc(ha(positive(p.surfaceHa)||0))]])),`<tfoot>${tr(['Total','','',[esc(ha(m.assolement.total))]])}</tfoot>`)}
<h3>Méthodes et hypothèses</h3><ul><li>Données issues uniquement des saisies de l’application Parcelles au ${esc(dateFr(isoDay(m.generatedAt)))} ; aucune valeur n’est inventée ni extrapolée.</li><li>Produit brut estimé : rendement prévu × prix de vente saisis par parcelle, ou produit €/ha saisi.</li><li>Charges opérationnelles : coûts des travaux de la campagne (réalisés et prévus) et charges €/ha saisies sur les parcelles.</li><li>Les coûts marqués « estimé » proviennent de l’assistant « Compléter les coûts » et restent distincts des coûts réels.</li><li>Ces estimations de pilotage ne remplacent ni la comptabilité ni un bilan certifié.</li></ul>
<div class="dz-sign"><div><small class="muted">Fait à ${esc(m.farm.commune||'…………………')}, le ${esc(longDate(m.generatedAt))}</small><br><br><small class="muted">Nom et qualité du signataire</small><br><strong>${esc(m.signer||'')}</strong></div><div><small class="muted">Signature</small></div></div>`;
  }
};

export function dossierHtml(state,{campaign=campaignFor(),preset='banque',sections=null,today=new Date(),assetBase='',signer=''}={}){
  const m={...dossierModel(state,{campaign,preset,sections,today}),signer:String(signer||'').trim()};
  const footer=`${m.farm.name} · Campagne ${m.campaign} · ${m.preset.label}`,total=m.sections.length+1;
  const colors=cultureColors(m.assolement.rows),map=parcelMapSvg(m.parcels,p=>colors.get(normalize(cultureFor(state,p,campaign)))||'#8a8f88');
  const legend=m.assolement.rows.slice(0,10).map(r=>`<li><i style="background:${colors.get(normalize(r.culture))}"></i>${esc(r.culture)}</li>`).join('');
  const foot=i=>`<footer class="dz-foot"><span>${esc(footer)}</span><span>page ${i}/${total}</span></footer>`;
  const cover=`<section class="page dz-cover" aria-label="Couverture"><div class="dz-body"><p class="dz-eyebrow">Dossier de campagne · ${esc(m.preset.label)}</p><h1>${esc(m.farm.name)}</h1><p class="dz-sub">Campagne ${esc(m.campaign)}${m.farm.commune?` · ${esc(m.farm.commune)}`:''}</p>
${map?`<figure>${map}<ul class="dz-legend">${legend}</ul><figcaption>Parcellaire de l’exploitation, coloré par culture.</figcaption></figure>`:'<p class="dz-note">Aucune parcelle dessinée : la carte miniature n’est pas disponible.</p>'}
<div class="dz-kpis">${kpi(ha(m.assolement.total),plural(m.parcels.length,'parcelle','parcelles'))}${kpi(eur(m.pilotage.grossProduct),'produit brut estimé')}${kpi(eur(m.cascade.net+m.cascade.structure),'marge brute estimée',m.cascade.net+m.cascade.structure<0)}</div>
<h3>Sommaire</h3><ol class="dz-toc">${m.sections.map(id=>`<li>${esc(sectionLabel(id))}</li>`).join('')}</ol>
<p class="muted"><small>Généré le ${esc(longDate(m.generatedAt))} par Parcelles, hors connexion, à partir des données saisies. Montants indicatifs.</small></p></div>${foot(1)}</section>`;
  const pages=m.sections.map((id,i)=>`<section class="page" id="dz-${id}" aria-labelledby="dz-h-${id}"><div class="dz-body"><h2 id="dz-h-${id}">${i+1}. ${esc(sectionLabel(id))}</h2>${SECTION_RENDER[id](m)}</div>${foot(i+2)}</section>`).join('');
  return printDocument({title:`Dossier de campagne ${m.campaign} · ${m.farm.name}`,css:printCss({assetBase,footer}),body:cover+pages});
}
