// n° 22 — Tableau de bord sur plusieurs colonnes (grand écran).
// Logique pure, en lecture seule : aucun état enregistré, aucun changement de schéma.
import {agendaDate,isPending} from './home-priorities.js';

export const WIDE_TWO_COLUMNS=1100;
export const WIDE_THREE_COLUMNS=1440;

// Disposition selon la largeur de la fenêtre : une, deux ou trois colonnes.
export function columnMode(width){
  const w=Number(width)||0;
  return w>=WIDE_THREE_COLUMNS?'three':w>=WIDE_TWO_COLUMNS?'two':'single';
}

// Colonne d’un bloc de l’accueil. L’ordre choisi dans « Personnaliser » est conservé à l’intérieur de chaque colonne.
const SIDE_CARDS=new Set(['weather','alerts']);
export function slotForCard(id,mode){
  if(mode==='single')return 'main';
  if(id==='recent')return mode==='three'?'extra':'side';
  return SIDE_CARDS.has(id)?'side':'main';
}

// Trie des identifiants de blocs selon l’ordre personnalisé ; les inconnus gardent leur ordre, à la fin.
export function orderCards(ids,order=[]){
  const rank=new Map((order||[]).map((id,i)=>[id,i]));
  return ids.map((id,i)=>({id,i,r:rank.has(id)?rank.get(id):Infinity})).sort((a,b)=>a.r-b.r||a.i-b.i).map(e=>e.id);
}

const isIsoDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));
export function addDays(iso,n){
  if(!isIsoDay(iso))return '';
  const [y,m,d]=iso.split('-').map(Number),x=new Date(Date.UTC(y,m-1,d+Number(n||0)));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth()+1).padStart(2,'0')}-${String(x.getUTCDate()).padStart(2,'0')}`;
}

// Les sept prochains jours : travaux et tâches à faire, rangés à leur échéance (workDate des travaux en attente).
export function weekAgenda(data,today,days=7){
  if(!isIsoDay(today))return {days:[],overdue:0,total:0};
  const list=[];for(let i=0;i<days;i++)list.push({date:addDays(today,i),isToday:i===0,items:[]});
  const byDate=new Map(list.map(d=>[d.date,d]));let overdue=0;
  const push=(item,kind)=>{const date=agendaDate(item,kind);if(!date)return;if(date<today){overdue++;return;}byDate.get(date)?.items.push({kind,id:item.id,title:kind==='work'?item.type||'Travail':item.title||'Tâche',parcelId:item.parcelId||'',startTime:item.startTime||'',status:item.status||''});};
  for(const w of data?.interventions||[])if(isPending(w)&&!['Annulé','Annulée'].includes(w.status))push(w,'work');
  for(const t of data?.tasks||[])if(isPending(t,'task'))push(t,'task');
  for(const d of list)d.items.sort((a,b)=>String(a.startTime||'99:99').localeCompare(String(b.startTime||'99:99'))||String(a.title).localeCompare(String(b.title),'fr'));
  return {days:list,overdue,total:list.reduce((s,d)=>s+d.items.length,0)};
}

// Tâches à faire, échéance la plus proche d’abord, sans échéance à la fin.
export function pendingTasks(data,limit=6){
  const tasks=(data?.tasks||[]).filter(t=>isPending(t,'task')).sort((a,b)=>String(agendaDate(a,'task')||'9999').localeCompare(String(agendaDate(b,'task')||'9999'))||String(a.title||'').localeCompare(String(b.title||''),'fr'));
  return {items:tasks.slice(0,limit),total:tasks.length};
}

// Mini-carte SVG : projection équirectangulaire corrigée de la latitude. Retourne null sans géométrie exploitable.
function rings(geometry){
  if(!geometry)return [];
  if(geometry.type==='Polygon')return [geometry.coordinates?.[0]].filter(Boolean);
  if(geometry.type==='MultiPolygon')return (geometry.coordinates||[]).map(poly=>poly?.[0]).filter(Boolean);
  return [];
}
const validPoint=pt=>Array.isArray(pt)&&Number.isFinite(Number(pt[0]))&&Number.isFinite(Number(pt[1]))&&Math.abs(pt[0])<=180&&Math.abs(pt[1])<=90;
export function miniMapShapes(parcels,focusIds=[],{width=300,height=200,pad=8}={}){
  const focus=new Set(focusIds||[]);
  const items=(parcels||[]).filter(p=>!p?.deletedAt&&!p?.archived).map(p=>({p,rings:rings(p.geometry).map(r=>r.filter(validPoint)).filter(r=>r.length>=3)})).filter(e=>e.rings.length);
  if(!items.length)return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const e of items)for(const r of e.rings)for(const [x,y] of r){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  const k=Math.cos(((minY+maxY)/2)*Math.PI/180)||1,spanX=Math.max((maxX-minX)*k,1e-9),spanY=Math.max(maxY-minY,1e-9);
  const scale=Math.min((width-2*pad)/spanX,(height-2*pad)/spanY),offX=(width-spanX*scale)/2,offY=(height-spanY*scale)/2;
  const px=x=>(offX+(x-minX)*k*scale).toFixed(1),py=y=>(offY+(maxY-y)*scale).toFixed(1);
  const shapes=items.map(({p,rings:rs})=>({id:p.id,nom:p.nom||'Parcelle',focus:focus.has(p.id),d:rs.map(r=>'M'+r.map(([x,y])=>`${px(x)} ${py(y)}`).join('L')+'Z').join('')}));
  // Les parcelles du jour sont dessinées en dernier, au-dessus des autres.
  shapes.sort((a,b)=>Number(a.focus)-Number(b.focus));
  return {width,height,shapes,focusCount:shapes.filter(s=>s.focus).length};
}
