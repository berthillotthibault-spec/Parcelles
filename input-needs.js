// n° I3 (W3) : besoins en intrants des travaux prévus face au stock. Logique pure, sans écriture.
// Chaque article dont le stock ne couvre pas les travaux à faire de l'horizon devient un « manque prévu ».
import {localIso,normalize} from './utils.js';
import {active} from './farm-memory.js';
import {productFor} from './phyto.js';
import {requiredStock} from './work-effects.js';
import {itemLots,ammStatus,pmpAt} from './stock-lots.js';
import {agendaDate,isPending} from './home-priorities.js';

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
// Surface ou dose nulle ou négative = non saisie (un formulaire vide donne 0) : jamais comptée pour 0.
const pos=v=>{const n=num(v);return n!==null&&n>0?n:null;};
const isDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))&&Number.isFinite(Date.parse(`${v}T12:00:00Z`));
const r4=v=>Math.round(v*10000)/10000;
const dayMs=d=>Date.parse(`${d}T12:00:00Z`);
const addDays=(iso,n)=>new Date(dayMs(iso)+n*864e5).toISOString().slice(0,10);
const daysBetween=(a,b)=>Math.round((dayMs(b)-dayMs(a))/864e5);
const ddmm=iso=>/^\d{4}-\d{2}-\d{2}/.test(String(iso||''))?`${iso.slice(8,10)}/${iso.slice(5,7)}`:'';
const frNumber=(v,max=1)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:max}).format(v);
const plural=(n,one,many)=>n>1?many:one;
const MARGIN_DAYS=7,ORDER_LEAD_DAYS=3;

/** Quantité lisible dans l'unité du stock (kg au-delà d'une tonne affichés en t). */
export function formatQuantity(value,unit=''){
  const u=String(unit||'').trim();
  if(value===null||value===undefined||!Number.isFinite(value))return '?';
  if(/^kg$/i.test(u)&&Math.abs(value)>=1000)return `${frNumber(value/1000)} t`;
  return `${frNumber(value,Math.abs(value)>=100?0:1)}${u?` ${u}`:''}`;
}

// Article de stock d'un travail : identifiant explicite, puis fiche produit (AMM puis nom), puis nom exact.
function stockItemFor(state,items,work,catalog){
  if(work.stockItemId){const byId=items.find(i=>i.id===work.stockItemId);if(byId)return byId;}
  let found=null;
  try{found=productFor(state,work,{catalog})?.item||null;}catch{found=null;}
  if(found&&items.some(i=>i.id===found.id))return items.find(i=>i.id===found.id);
  const name=normalize(work.product);
  return name?items.find(i=>normalize(i.name||i.nom)===name)||null:null;
}

/**
 * Besoins des travaux à faire entre today − 7 j et today + horizon, comparés au stock.
 * @returns {Array<object>} manques triés par date du premier manque.
 */
export function inputNeeds(state,{today=localIso(),horizonDays=Number(state?.preferences?.adviceStockHorizonDays)||30,catalog=null,lookup=null}={}){
  if(!state)return [];
  if(!isDay(today))today=localIso();
  horizonDays=Number(horizonDays);if(!Number.isFinite(horizonDays))horizonDays=30;
  const items=active(state,'stockItems');if(!items.length)return [];
  const parcels=new Map(active(state,'parcelles').map(p=>[p.id,p]));
  const from=addDays(today,-MARGIN_DAYS),to=addDays(today,Math.max(0,horizonDays));
  const groups=new Map();
  for(const work of active(state,'interventions')){
    if(!isPending(work))continue;
    const date=agendaDate(work);if(!date||date<from||date>to)continue;
    if(!String(work.product||'').trim()&&!work.amm&&!work.stockItemId)continue;
    const item=stockItemFor(state,items,work,catalog);if(!item)continue;
    const parcel=parcels.get(work.parcelId)||null;
    const surfaceHa=pos(work.surfaceWorked)??pos(parcel?.surfaceHa)??pos(parcel?.surface);
    const clone={...work,surfaceWorked:surfaceHa,dose:pos(work.dose)};
    const quantity=requiredStock(clone,item);
    if(!groups.has(item.id))groups.set(item.id,{item,rows:[],unconverted:[],lastPlanned:''});
    const g=groups.get(item.id);if(date>g.lastPlanned)g.lastPlanned=date;
    if(quantity===null){
      const reason=clone.dose===null?'dose absente':surfaceHa===null?'surface inconnue':`unité ${work.doseUnit||'?'} non convertible en ${item.unit||'?'}`;
      g.unconverted.push({workId:work.id,reason});continue;
    }
    g.rows.push({workId:work.id,date,parcelName:parcel?.nom||parcel?.name||'',surfaceHa,dose:clone.dose,doseUnit:work.doseUnit||'',quantity:r4(quantity)});
  }
  const out=[];
  for(const {item,rows,unconverted,lastPlanned} of groups.values()){
    rows.sort((a,b)=>a.date.localeCompare(b.date)||String(a.workId).localeCompare(String(b.workId)));
    const stock=Math.max(0,num(item.quantity)||0);
    const lots=itemLots(state,item,{today}).filter(l=>l.remaining>0&&l.expiryDate);
    const lostBefore=date=>lots.filter(l=>l.expiryDate<date).reduce((s,l)=>s+l.remaining,0);
    let cum=0,shortfall=0,firstShortDate=null,firstShortWorkId=null;
    for(const row of rows){
      cum+=row.quantity;
      const gap=cum-Math.max(0,stock-lostBefore(row.date));
      if(gap>1e-6){shortfall=Math.max(shortfall,gap);if(!firstShortDate){firstShortDate=row.date;firstShortWorkId=row.workId;}}
    }
    const lastUse=rows.length?rows[rows.length-1].date:null;
    const expiredBeforeUse=lastUse?lots.filter(l=>l.expiryDate<lastUse).map(l=>({lot:l.lotNumber||l.id,expiry:l.expiryDate,quantity:r4(l.remaining)})):[];
    let ammWithdrawn=false;
    // AMM évaluée à la date du dernier emploi prévu : un retrait qui tombe avant l'emploi compte aussi.
    try{ammWithdrawn=(rows.length||unconverted.length)&&ammStatus(item,{today:lastPlanned>today?lastPlanned:today,lookup}).status!=='autorisé';}catch{ammWithdrawn=false;}
    ammWithdrawn=Boolean(ammWithdrawn);
    if(!(shortfall>0)&&!ammWithdrawn&&!expiredBeforeUse.length)continue;
    const need=r4(cum),available=r4(Math.max(0,stock-(lastUse?lostBefore(lastUse):0)));
    let price=null;try{price=pmpAt(state,item,today);}catch{price=null;}
    if(price===null)price=num(item.unitPrice);
    const valueEur=shortfall>0&&price!==null?Math.round(shortfall*price):null;
    const unit=item.unit||'';
    const why=[];
    if(rows.length)why.push(`${formatQuantity(available,unit)} en stock, ${formatQuantity(need,unit)} ${plural(need,'nécessaire','nécessaires')} pour ${rows.length} ${plural(rows.length,'apport prévu','apports prévus')} d’ici le ${ddmm(lastUse)}`);
    if(unconverted.length)why.push(`besoin non chiffré pour ${unconverted.length} ${plural(unconverted.length,'travail','travaux')}`);
    for(const e of expiredBeforeUse)why.push(`${formatQuantity(e.quantity,unit)} ${plural(e.quantity,'périmé','périmés')} avant l’emploi (lot ${e.lot==='initial'?'initial':e.lot}, ${ddmm(e.expiry)})`);
    if(ammWithdrawn)why.push('AMM retirée : vérifiez que l’emploi prévu reste autorisé');
    const refDate=firstShortDate||rows[0]?.date||today;
    const level=daysBetween(today,refDate)<=MARGIN_DAYS?'urgent':'warning';
    out.push({id:`stock-shortfall-${item.id}`,itemId:item.id,name:item.name||item.nom||'Produit',unit,need,available,shortfall:r4(shortfall),firstShortDate,firstShortWorkId,valueEur,works:rows,unconverted,expiredBeforeUse,ammWithdrawn,level,why,_ref:refDate});
  }
  return out.sort((a,b)=>a._ref.localeCompare(b._ref)||normalize(a.name).localeCompare(normalize(b.name))).map(({_ref,...need})=>need);
}

/** Phrase courte et chiffrée pour un manque. */
export function shortfallMessage(need,{today=null}={}){
  if(!need)return '';
  if(!(need.shortfall>0))return `${need.name} : ${need.why.join(' ; ')}.`;
  const work=need.works.find(w=>w.workId===need.firstShortWorkId)||need.works[0]||{};
  const detail=work.surfaceHa!==null&&work.surfaceHa!==undefined&&work.dose!==null&&work.dose!==undefined?` (${frNumber(work.surfaceHa,2)} ha × ${frNumber(work.dose,2)} ${work.doseUnit||''})`.replace(/ \)$/,')'):'';
  const where=work.parcelName?` sur ${work.parcelName}`:'';
  const order=addDays(need.firstShortDate,-ORDER_LEAD_DAYS);
  const when=today&&order<=today?'Commandez dès aujourd’hui':`Commandez avant le ${ddmm(order)}`;
  const value=need.valueEur!==null&&need.valueEur!==undefined?` (≈ ${frNumber(need.valueEur,0)} €)`:'';
  return `${need.name} : il manque ${formatQuantity(need.shortfall,need.unit)} dès l’apport du ${ddmm(need.firstShortDate)}${where}${detail}. ${when}${value}.`;
}

/** Brouillon de tâche « Commander … » ; l'écriture se fait par store.upsert côté interface. */
export function orderTaskDraft(need,{today=localIso()}={}){
  const target=need?.firstShortDate?addDays(need.firstShortDate,-ORDER_LEAD_DAYS):today;
  const dueDate=target<today?today:target;
  const lines=[shortfallMessage(need,{today}),...(need?.why||[])];
  if(need?.works?.length)lines.push(...need.works.map(w=>`${ddmm(w.date)}${w.parcelName?` ${w.parcelName}`:''} : ${formatQuantity(w.quantity,need.unit)}`));
  return {title:`Commander ${need?.name||'intrant'}`,dueDate,notes:lines.filter(Boolean).join('\n')};
}
