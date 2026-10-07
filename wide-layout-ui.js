// n° 22 — Disposition en colonnes d’Aujourd’hui et de Travaux sur grand écran.
// Déplace uniquement des éléments existants du DOM (aucune donnée modifiée) et les remet en place sous 1100 px.
import {columnMode,slotForCard,orderCards,weekAgenda,pendingTasks,miniMapShapes,WIDE_TWO_COLUMNS,WIDE_THREE_COLUMNS} from './wide-layout.js';
import {dailySituation,localDay} from './home-priorities.js';
import {escapeHtml,localDate} from './utils.js';

const TODAY_MAIN_IDS=['next-action','today-summary','today-quick-actions','morning-brief','home-custom-empty'];

export function createWideLayoutUI({doc=globalThis.document,win=globalThis.window}={}){
  if(!doc||!win)return {today(){},work(){},mode:()=>'single'};
  const queries=[WIDE_TWO_COLUMNS,WIDE_THREE_COLUMNS].map(w=>win.matchMedia?.(`(min-width:${w}px)`)).filter(Boolean);
  const mode=()=>columnMode(win.innerWidth||doc.documentElement.clientWidth||0);
  let todayArgs=null,workArgs=null,todaySnapshot=null,originalGrid=null;

  // ---------- Aujourd’hui ----------
  function todayPage(){return doc.querySelector('#view-today .today-page');}
  function snapshot(page){
    if(todaySnapshot)return;
    todaySnapshot=Array.from(page.children);
    originalGrid=todaySnapshot.find(el=>el.classList.contains('today-grid'))||null;
  }
  function cards(){return Array.from(doc.querySelectorAll('#view-today [data-home-card]'));}
  function restoreToday(page,order){
    const wrap=page.querySelector(':scope > .wide-cols');
    if(!wrap)return;
    for(const el of todaySnapshot)page.append(el);
    if(originalGrid)for(const id of orderCards(cards().map(c=>c.dataset.homeCard),order)){const c=doc.querySelector(`#view-today [data-home-card="${id}"]`);if(c)originalGrid.append(c);}
    // Éléments ajoutés par d’autres modules pendant l’affichage en colonnes (ex. signaux satellite) : remis avant le bilan.
    const review=doc.getElementById('day-review');
    for(const el of Array.from(wrap.querySelectorAll(':scope > div > *')))if(!el.classList.contains('wide-minimap')){if(review&&page.contains(review))review.before(el);else page.append(el);}
    wrap.remove();
    page.classList.remove('is-wide','is-wide-three');
  }
  function applyToday(){
    const page=todayPage();if(!page||!todayArgs)return;
    snapshot(page);
    const m=mode(),order=todayArgs.order||[];
    if(m==='single'){restoreToday(page,order);return;}
    let wrap=page.querySelector(':scope > .wide-cols');
    if(!wrap){
      wrap=doc.createElement('div');wrap.className='wide-cols';
      wrap.innerHTML='<div class="wide-main"></div><div class="wide-side today-grid" role="complementary" aria-label="En un coup d’œil"></div><div class="wide-extra today-grid" role="complementary" aria-label="Activité"></div>';
      const welcome=page.querySelector(':scope > .today-welcome');
      if(welcome)welcome.after(wrap);else page.prepend(wrap);
    }
    page.classList.add('is-wide');page.classList.toggle('is-wide-three',m==='three');
    const main=wrap.querySelector('.wide-main'),side=wrap.querySelector('.wide-side'),extra=wrap.querySelector('.wide-extra');
    for(const id of TODAY_MAIN_IDS){const el=doc.getElementById(id);if(el)main.append(el);}
    if(originalGrid)main.append(originalGrid);
    let mini=side.querySelector('.wide-minimap');
    if(!mini){mini=doc.createElement('article');mini.className='panel wide-minimap';}
    side.prepend(mini);
    renderMiniMap(mini,todayArgs.data);
    for(const id of orderCards(cards().map(c=>c.dataset.homeCard),order)){
      const c=doc.querySelector(`#view-today [data-home-card="${id}"]`);if(!c)continue;
      const slot=slotForCard(id,m);
      (slot==='side'?side:slot==='extra'?extra:originalGrid||main).append(c);
    }
    const sat=doc.getElementById('satellite-today');if(sat)side.append(sat);
    const review=doc.getElementById('day-review');if(review)side.append(review);
    extra.hidden=m!=='three';
  }
  function renderMiniMap(root,data){
    const today=localDay(),cockpit=dailySituation(data||{},today);
    const focus=[...new Set([...cockpit.actions,...cockpit.done.map(item=>({item}))].map(e=>e.item?.parcelId).filter(Boolean))];
    const parcels=(data?.parcelles||[]).filter(p=>!p.deletedAt);
    const shapes=miniMapShapes(parcels,focus,{width:300,height:190});
    const names=new Map(parcels.map(p=>[p.id,p.nom||'Parcelle']));
    const list=focus.filter(id=>names.has(id)).slice(0,5);
    const n=list.length;
    root.hidden=!shapes&&!n;
    if(root.hidden){root.innerHTML='';return;}
    root.innerHTML=`<div class="panel-heading"><h2>Parcelles du jour</h2><button class="text-button" data-view="map">Carte</button></div>`+
      (shapes?`<svg class="wide-minimap-svg" viewBox="0 0 ${shapes.width} ${shapes.height}" role="img" aria-label="${n?`${n} parcelle${n>1?'s':''} concernée${n>1?'s':''} aujourd’hui, en surbrillance sur le plan de l’exploitation`:'Plan de l’exploitation'}">${shapes.shapes.map(s=>`<path class="${s.focus?'is-focus':''}" d="${s.d}"${s.focus?` data-action="parcel-on-map" data-id="${escapeHtml(s.id)}"`:''}><title>${escapeHtml(s.nom)}</title></path>`).join('')}</svg>`:'')+
      (n?`<div class="wide-minimap-list">${list.map(id=>`<button class="wide-chip" data-action="parcel-on-map" data-id="${escapeHtml(id)}"><span class="wide-dot" aria-hidden="true"></span>${escapeHtml(names.get(id))}</button>`).join('')}</div>`:'<p class="wide-note">Aucune parcelle concernée aujourd’hui.</p>');
  }

  // ---------- Travaux ----------
  function applyWork(){
    const list=doc.getElementById('work-list');if(!list||!workArgs)return;
    const m=mode();let split=list.closest('.wide-work');
    if(m==='single'){
      if(split){split.before(list);split.remove();}
      return;
    }
    if(!split){
      split=doc.createElement('div');split.className='wide-work';
      list.before(split);split.append(list);
      const aside=doc.createElement('aside');aside.className='wide-work-side';aside.setAttribute('aria-label','Semaine et tâches');split.append(aside);
    }
    renderWorkSide(split.querySelector('.wide-work-side'),workArgs.data);
  }
  function renderWorkSide(root,data){
    const today=localDay(),week=weekAgenda(data||{},today),tasks=pendingTasks(data||{},6);
    const parcels=new Map((data?.parcelles||[]).filter(p=>!p.deletedAt).map(p=>[p.id,p.nom||'Parcelle']));
    const dayName=iso=>{const x=new Date(iso+'T12:00:00');return {wd:x.toLocaleDateString('fr-FR',{weekday:'short'}).replace('.',''),d:x.getDate()};};
    const weekRows=week.days.map(day=>{const {wd,d}=dayName(day.date),shown=day.items.slice(0,3),more=day.items.length-shown.length;
      return `<li class="wide-day${day.isToday?' is-today':''}"><span class="date-block"><small>${escapeHtml(wd)}</small><b>${d}</b></span><div class="wide-day-items">${shown.length?shown.map(it=>`<button class="wide-item" data-action="${it.kind==='work'?'edit-work':'edit-task'}" data-id="${escapeHtml(it.id)}"><strong>${it.startTime?`${escapeHtml(it.startTime)} · `:''}${escapeHtml(it.title)}</strong>${it.parcelId&&parcels.has(it.parcelId)?`<small>${escapeHtml(parcels.get(it.parcelId))}</small>`:it.kind==='task'?'<small>Tâche</small>':''}</button>`).join('')+(more>0?`<button class="wide-more" data-action="open-calendar">+ ${more} autre${more>1?'s':''}</button>`:''):'<span class="wide-empty">Rien de prévu</span>'}</div></li>`;}).join('');
    const late=week.overdue?`<p class="wide-late">${week.overdue} élément${week.overdue>1?'s':''} en retard, à reprendre dans l’onglet « En retard ».</p>`:'';
    const taskRows=tasks.items.length?tasks.items.map(t=>{const due=String(t.dueDate||'').slice(0,10);const when=due?(due<today?'En retard':due===today?'Aujourd’hui':localDate(due)):'Sans échéance';
      return `<li class="wide-task"><button class="row-check" data-action="finish-task" data-id="${escapeHtml(t.id)}" aria-label="Marquer « ${escapeHtml(t.title||'Tâche')} » comme terminée"></button><button class="wide-item" data-action="edit-task" data-id="${escapeHtml(t.id)}"><strong>${escapeHtml(t.title||'Tâche')}</strong><small class="${due&&due<today?'is-late':''}">${t.parcelId&&parcels.has(t.parcelId)?`${escapeHtml(parcels.get(t.parcelId))} · `:''}${escapeHtml(when)}</small></button></li>`;}).join(''):'<li class="wide-empty-row">Aucune tâche à faire.</li>';
    root.innerHTML=`<section class="wide-panel"><div class="panel-heading"><h2>Cette semaine</h2><button class="text-button" data-action="open-calendar">Calendrier</button></div>${late}<ol class="wide-week">${weekRows}</ol></section>`+
      `<section class="wide-panel"><div class="panel-heading"><h2>Tâches à faire${tasks.total?` <span class="wide-count">${tasks.total}</span>`:''}</h2><button class="text-button" data-action="open-tasks">Tout voir</button></div><ul class="wide-tasks">${taskRows}</ul></section>`;
  }

  const onChange=()=>{applyToday();applyWork();};
  for(const q of queries){if(q.addEventListener)q.addEventListener('change',onChange);else q.addListener?.(onChange);}
  return {
    today(data,order){todayArgs={data,order};applyToday();},
    work(data){workArgs={data};applyWork();},
    mode
  };
}
