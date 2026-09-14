import {toNumber, campaignFor, normalize, localDate} from './utils.js';

export function farmInsights(state){
  const active=(t)=>(state[t]||[]).filter(x=>!x.deletedAt);
  const parcels=active('parcelles'), works=active('interventions'), tasks=active('tasks'), machines=active('materiels');
  const own=parcels.filter(p=>(p.ownershipType||'own')==='own');
  const area=own.reduce((s,p)=>s+toNumber(p.surfaceHa),0);
  const byCulture={}; own.forEach(p=>{const c=p.culture||'Non renseignée';byCulture[c]=(byCulture[c]||0)+toNumber(p.surfaceHa)});
  const today=new Date().toISOString().slice(0,10);
  const overdueTasks=tasks.filter(t=>t.status!=='Terminé'&&t.dueDate&&t.dueDate<today);
  const dueMaintenance=machines.filter(m=>Number.isFinite(Number(m.maintenanceDue))&&Number.isFinite(Number(m.currentMeter))&&Number(m.currentMeter)>=Number(m.maintenanceDue)-20);
  const campaign=campaignFor();
  const campaignWorks=works.filter(w=>(w.campaignId||campaignFor(w.date))===campaign);
  const cost=campaignWorks.reduce((s,w)=>s+toNumber(w.cost),0);
  return {area,parcelCount:own.length,byCulture,todayWorks:works.filter(w=>(w.plannedDate||w.date)===today&&w.status!=='Annulé'),overdueTasks,dueMaintenance,campaign,cost};
}

const TYPE_ALIASES=new Map([
  ['parcelle','parcel'],['parcelles','parcel'],['champ','parcel'],['champs','parcel'],
  ['travail','work'],['travaux','work'],['intervention','work'],['interventions','work'],
  ['tache','task'],['taches','task'],['rappel','task'],
  ['materiel','equipment'],['machine','equipment'],['tracteur','equipment'],
  ['client','client'],['clients','client'],['point','point'],['points','point'],
  ['observation','observation'],['observations','observation'],['stock','stock'],['stocks','stock'],
  ['document','document'],['documents','document']
]);

function levenshtein(a,b){
  if(a===b)return 0;if(!a)return b.length;if(!b)return a.length;
  const prev=Array.from({length:b.length+1},(_,i)=>i),cur=new Array(b.length+1);
  for(let i=1;i<=a.length;i++){cur[0]=i;for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));for(let j=0;j<=b.length;j++)prev[j]=cur[j];}
  return prev[b.length];
}

function tokenScore(haystack,token){
  if(!token)return 0;const hay=normalize(haystack),words=hay.split(/[^a-z0-9]+/).filter(Boolean);
  if(hay===token)return 10;if(hay.includes(token))return 7;
  if(words.some(w=>w.startsWith(token)))return 5;
  if(token.length>=4&&words.some(w=>Math.abs(w.length-token.length)<=1&&levenshtein(w,token)<=1))return 3;
  return -Infinity;
}

function parseSearchQuery(query){
  const original=String(query??'');let minSurface=null,maxSurface=null;
  const gt=original.match(/>\s*([\d.,]+)/),lt=original.match(/<\s*([\d.,]+)/);if(gt)minSurface=toNumber(gt[1]);if(lt)maxSurface=toNumber(lt[1]);
  const withoutOperators=original.replace(/[<>]\s*[\d.,]+\s*(ha)?/gi,' '),raw=normalize(withoutOperators);
  let type=null;const tokens=raw.split(/\s+/).filter(Boolean).filter(token=>{const alias=TYPE_ALIASES.get(token);if(alias&&!type){type=alias;return false;}return true;});
  return {tokens,type,minSurface,maxSurface};
}

export function searchEverything(state,query){
  const parsed=parseSearchQuery(query);if(!String(query||'').trim())return[];const out=[];
  const add=(type,id,title,subtitle,text,extra={})=>{
    if(parsed.type&&parsed.type!==type)return;
    if(type==='parcel'){
      const surface=toNumber(extra.surfaceHa);if(parsed.minSurface!==null&&surface<=parsed.minSurface)return;if(parsed.maxSurface!==null&&surface>=parsed.maxSurface)return;
    }else if(parsed.minSurface!==null||parsed.maxSurface!==null)return;
    const scores=parsed.tokens.map(token=>tokenScore(text,token));if(scores.some(s=>!Number.isFinite(s)))return;
    const score=(scores.length?scores.reduce((a,b)=>a+b,0):1)+(normalize(title).includes(parsed.tokens.join(' '))?4:0);
    out.push({type,id,title,subtitle,score});
  };
  (state.parcelles||[]).filter(x=>!x.deletedAt).forEach(p=>add('parcel',p.id,p.nom,`${p.culture||''} · ${p.commune||''} · ${toNumber(p.surfaceHa).toLocaleString('fr-FR',{maximumFractionDigits:2})} ha`,[p.nom,p.culture,p.commune,p.notes,p.exploitant,p.ilot,p.sourceId].join(' '),{surfaceHa:p.surfaceHa}));
  (state.interventions||[]).filter(x=>!x.deletedAt).forEach(w=>{const p=(state.parcelles||[]).find(x=>x.id===w.parcelId);add('work',w.id,w.type,`${p?.nom||'Parcelle'} · ${localDate(w.plannedDate||w.date)}`,[w.type,w.product,w.note,w.operator,p?.nom,w.status].join(' '))});
  (state.tasks||[]).filter(x=>!x.deletedAt).forEach(t=>add('task',t.id,t.title,t.status,[t.title,t.note,t.status].join(' ')));
  (state.materiels||[]).filter(x=>!x.deletedAt).forEach(m=>add('equipment',m.id,m.nom,'Matériel',[m.nom,m.brand,m.model,m.note].join(' ')));
  (state.clients||[]).filter(x=>!x.deletedAt).forEach(c=>add('client',c.id,c.name,'Client',[c.name,c.phone,c.email,c.address,c.contact].join(' ')));
  (state.points||[]).filter(x=>!x.deletedAt).forEach(pt=>add('point',pt.id,pt.nom||pt.type,pt.type,[pt.nom,pt.type,pt.note].join(' ')));
  (state.observations||[]).filter(x=>!x.deletedAt).forEach(o=>{const p=(state.parcelles||[]).find(x=>x.id===o.parcelId);add('observation',o.id,o.title||o.type||'Observation',`${p?.nom||'Sans parcelle'} · ${localDate(o.date)}`,[o.title,o.type,o.note,p?.nom].join(' '))});
  (state.stockItems||[]).filter(x=>!x.deletedAt).forEach(x=>add('stock',x.id,x.name||'Stock',`${x.quantity??0} ${x.unit||''}`,[x.name,x.note,x.unit].join(' ')));
  (state.documents||[]).filter(x=>!x.deletedAt).forEach(x=>add('document',x.id,x.name||'Document',x.mimeType||'Document',[x.name,x.note,x.mimeType].join(' ')));
  return out.sort((a,b)=>b.score-a.score||String(a.title).localeCompare(String(b.title),'fr')).slice(0,80).map(({score,...row})=>row);
}

export function recentWorkSuggestions(state,limit=4){
  const works=(state.interventions||[]).filter(x=>!x.deletedAt&&x.type).sort((a,b)=>(b.updatedAt||new Date(b.date||0).getTime())-(a.updatedAt||new Date(a.date||0).getTime()));
  const seen=new Set(),out=[];
  for(const work of works){const key=normalize(`${work.type}|${work.product||''}|${work.equipmentId||''}`);if(seen.has(key))continue;seen.add(key);out.push(work);if(out.length>=limit)break;}
  return out;
}
