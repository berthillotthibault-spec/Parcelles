// n° 75 — Interface du bilan fourrager : jauge « couvert jusqu'au… », stocks en t MS par type, frise
// de consommation, récoltes (balles, silo, tonnes), inventaires, lots à nourrir et calendrier de coupe.
import {escapeHtml as e,localDate} from './utils.js';
import {saveFarmRecord} from './farm-records.js';
import {active} from './farm-memory.js';
import {UGB_REFERENCES} from './grazing.js';
import {FORAGE_KIND,FORAGE_REFERENCES,CUT_TYPES,forageType,forageRecords,forageBalance,winterSettings,needPerDay,lotsFromGrazing,validateForage,tonnesMs,cutCalendar} from './forage.js';

const n1=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}),n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
const todayIso=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const CATEGORIES=[...UGB_REFERENCES.categories.map(c=>[c.key,c.label]),['other','Autres animaux']];
const MODES=[['bales','Balles'],['silo','Silo (L × l × h)'],['tonnes','Tonnes brutes'],['tms','Tonnes de MS']];
const STATUS={ready:['is-warning','Repère atteint'],soon:['is-info','Bientôt'],growing:['','En pousse'],unknown:['','Sans météo']};

export function createForageUI({store,modal,toast,agroWeather=()=>null}){
  const $=s=>document.querySelector(s);
  const data=()=>store.snapshot();
  const parcels=()=>active(data(),'parcelles').filter(p=>!p.archived).sort((a,b)=>String(a.nom).localeCompare(String(b.nom),'fr'));
  const err=(id,msg)=>{const el=$(id);if(el){el.textContent=msg;el.hidden=false;}};
  const weatherDays=()=>{const w=agroWeather();return w?.get?.()?.days||[];};
  let cutType='ensilage-herbe';

  function gaugeHtml(b){
    if(!b.daily)return'<div class="notice info">Indiquez les lots à nourrir et la période d’hivernage pour calculer le bilan (bouton « Besoins »).</div>';
    const head=b.coversAll?`Stock suffisant pour tout l’hiver, ${n1.format(b.surplus)} t MS d’avance`:`Couvert jusqu’au ${e(localDate(b.coveredUntil))}, il manque ${n1.format(b.missing)} t MS`;
    return`<div class="forage-gauge ${b.coversAll?'is-ok':'is-short'}" role="img" aria-label="${e(head)}"><div class="forage-gauge-bar"><span style="width:${b.pct}%"></span></div><strong>${head}</strong></div>`;
  }
  function timelineHtml(b){
    if(!b.daily)return'';const pts=b.timeline,max=Math.max(1,...pts.map(p=>Math.abs(p.stock||0)));
    return`<h3>Frise de consommation</h3><div class="forage-timeline">${pts.map(p=>`<div class="${p.past?'is-past':p.stock<0?'is-short':''}"><span style="height:${p.stock===null?0:Math.round(Math.max(0,p.stock)/max*100)}%"></span><small>${e(localDate(p.date).slice(0,5))}</small><b>${p.stock===null?'passé':`${n0.format(p.stock)} t`}</b></div>`).join('')}</div>`;
  }
  function calendarHtml(){
    const days=weatherDays(),rows=cutCalendar(data(),{today:todayIso(),days,type:cutType});
    if(!rows.length)return'<div class="empty-state">Aucune prairie : la culture de la parcelle doit évoquer l’herbe (prairie, ray-grass, luzerne…) ou avoir été pâturée.</div>';
    return`<div class="chip-row">${CUT_TYPES.map(k=>`<button type="button" class="small-button ${k===cutType?'is-active':''}" data-forage="cut-type" data-type="${k}">${e(forageType(k).label)}</button>`).join('')}</div>
${days.length?'':'<div class="notice info">Sommes de températures indisponibles (météo agronomique non chargée ou hors connexion) : seules les coupes enregistrées sont affichées.</div>'}
<div class="stack-list">${rows.map(r=>{const [cls,label]=STATUS[r.status];return`<div class="list-row"><div><strong>${e(r.parcel.nom||'Parcelle')} · ${r.next}<sup>e</sup> coupe</strong><small>${r.done.length?`${r.done.length} coupe${r.done.length>1?'s':''} (dernière le ${e(localDate(r.last.date))})`:'Pas encore de coupe cette année'}${r.sum!==null?` · ${n0.format(r.sum)} / ${n0.format(r.target)} °C·j depuis le ${e(localDate(r.ref))}`:''}${r.eta?` · repère vers le ${e(localDate(r.eta))}`:''}${r.incomplete&&r.sum!==null?' · météo incomplète':''}</small></div><span class="${cls}">${label}</span><button class="small-button" data-forage="new-harvest" data-parcel="${e(r.parcel.id)}" data-cut="${r.next}">Coupe</button></div>`;}).join('')}</div>
<p class="form-note">Repères indicatifs en base 0 °C depuis le 1<sup>er</sup> février : ${CUT_TYPES.map(k=>`${forageType(k).label.toLowerCase()} ${FORAGE_REFERENCES.firstCut[k]} °C·j`).join(', ')}, puis ${FORAGE_REFERENCES.regrowth} °C·j de repousse. Le stade réel de la prairie et la météo de fauche priment.</p>`;
  }

  function open(){
    const d=data(),today=todayIso(),b=forageBalance(d,{today}),w=b.settings,names=new Map(parcels().map(p=>[p.id,p.nom]));
    const known=weatherDays().length;agroWeather()?.ensure?.({since:`${today.slice(0,4)}-01-31`}).then(c=>{if((c?.days?.length||0)!==known&&$('#forage-calendar'))$('#forage-calendar').innerHTML=calendarHtml();}).catch(()=>{});
    const recent=forageRecords(d).filter(r=>r.date>=`${w.start.slice(0,4)}-01-01`).slice(-12).reverse();
    modal('Bilan fourrager',`Hivernage du ${localDate(w.start)} au ${localDate(w.end)} · stocks en tonnes de matière sèche (t MS)`,`${gaugeHtml(b)}
<div class="preview-summary"><div class="preview-stat"><strong>${n1.format(b.available)} t MS</strong><small>stock estimé${b.inventory?` (inventaire du ${e(localDate(b.inventory.date))})`:''}</small></div><div class="preview-stat"><strong>${n1.format(b.daily)} t MS/j</strong><small>besoin du troupeau</small></div><div class="preview-stat"><strong>${n1.format(b.remainingNeed)} t MS</strong><small>besoin restant · ${b.remainingDays} j</small></div><div class="preview-stat"><strong>${n1.format(b.consumed)} t MS</strong><small>consommé estimé</small></div></div>
<h3>Stocks par type</h3><div class="stack-list">${FORAGE_REFERENCES.types.map(t=>`<div class="list-row"><div><strong>${e(t.label)}</strong><small>récoltes nettes de ${n0.format(w.lossPct)} % de pertes${w.includeStockItems?' + articles de stock':''}</small></div><strong>${n1.format(b.byType[t.key]||0)} t MS</strong></div>`).join('')}</div>
${timelineHtml(b)}
<h3>Calendrier de coupe de l’herbe</h3><div id="forage-calendar">${calendarHtml()}</div>
<h3>Récoltes et inventaires</h3><div class="stack-list">${recent.length?recent.map(r=>`<div class="list-row"><div><strong>${r.entry==='inventory'?'Inventaire':e(forageType(r.type)?.label||'Fourrage')}${r.cut?` · ${r.cut}<sup>e</sup> coupe`:''}</strong><small>${e(localDate(r.date))}${r.parcelId?` · ${e(names.get(r.parcelId)||'Parcelle')}`:''} · ${n1.format(r.tms)} t MS${r.mode==='bales'&&r.bales?` · ${n0.format(r.bales)} balles`:''}</small></div><button class="small-button" data-forage="edit" data-id="${e(r.id)}">Modifier</button></div>`).join(''):'<div class="empty-state">Aucune récolte de fourrage cette saison.</div>'}</div>
<p class="form-note">Bilan indicatif : la consommation est estimée à partir des besoins saisis, pas des distributions réelles. Un inventaire (comptage des balles, mesure du silo) remet le stock à jour. Valeurs de référence au ${e(localDate(FORAGE_REFERENCES.date))} : ${e(FORAGE_REFERENCES.source)}</p>`,
    `<button class="button secondary" data-forage="settings">Besoins</button><button class="button secondary" data-forage="new-inventory">Inventaire</button><button class="button primary" data-forage="new-harvest">Récolte</button>`,'large');
  }

  function openRecord(entry,record=null,{parcelId='',cut=''}={}){
    const r=record||{date:todayIso(),type:entry==='harvest'?'foin':'',mode:entry==='harvest'?'bales':'tms',parcelId,cut,msPct:''};
    const t=forageType(r.type),field=(name,label,ph='')=>`<label data-mode-field="${name}">${label}<input name="${name}" type="number" min="0" step="any" inputmode="decimal" value="${e(r[name]??'')}" placeholder="${e(ph)}"></label>`;
    modal(entry==='inventory'?'Inventaire de fourrage':'Récolte de fourrage',entry==='inventory'?'Stock total compté à une date : il remplace les récoltes précédentes dans le bilan.':'Coupe d’herbe ou ensilage de maïs, converti en tonnes de matière sèche.',`<form id="forage-form" class="form-grid" data-entry="${entry}" data-id="${e(record?.id||'')}">
${entry==='harvest'?`<label>Type<select name="type">${FORAGE_REFERENCES.types.map(x=>`<option value="${x.key}" ${r.type===x.key?'selected':''}>${e(x.label)}</option>`).join('')}</select></label>
<label>Parcelle<select name="parcelId"><option value="">—</option>${parcels().map(p=>`<option value="${e(p.id)}" ${r.parcelId===p.id?'selected':''}>${e(p.nom)}</option>`).join('')}</select></label>
<label>Coupe n°<select name="cut"><option value="">—</option>${[1,2,3,4,5,6].map(c=>`<option ${String(r.cut)===String(c)?'selected':''}>${c}</option>`).join('')}</select></label>`:''}
<label>Date<input type="date" name="date" value="${e(r.date)}"></label>
<label>Saisie<select name="mode">${MODES.map(([k,l])=>`<option value="${k}" ${r.mode===k?'selected':''}>${l}</option>`).join('')}</select></label>
${field('bales','Nombre de balles')}${field('baleKg','Poids d’une balle (kg brut)',t?.baleKg?`${t.baleKg} par défaut`:'')}
${field('length','Longueur du silo (m)')}${field('width','Largeur (m)')}${field('height','Hauteur moyenne (m)')}${field('density','Densité (kg brut/m³)',t?.density?`${t.density} par défaut`:'')}
${field('tonnes','Tonnes brutes')}${field('tms','Tonnes de matière sèche')}
${entry==='harvest'?field('msPct','Matière sèche (%)',t?`${t.msPct} % par défaut`:''):''}
<label class="span-2">Note<input name="note" maxlength="200" value="${e(r.note||'')}"></label>
<p class="form-note span-2" id="forage-preview"></p><p class="form-error span-2" id="forage-error" role="alert" hidden></p></form>`,
    `<button class="button secondary" data-forage="back">Annuler</button>${record?`<button class="button danger" data-forage="delete" data-id="${e(record.id)}">Supprimer</button>`:''}<button class="button primary" data-forage="save">Enregistrer</button>`,'large');
    const form=$('#forage-form');const sync=()=>{const v=Object.fromEntries(new FormData(form));if(entry==='inventory')v.mode='tms';
      const show={bales:['bales','baleKg','msPct'],silo:['length','width','height','density','msPct'],tonnes:['tonnes','msPct'],tms:['tms']}[v.mode]||['tms'];
      form.querySelectorAll('[data-mode-field]').forEach(l=>{l.hidden=!show.includes(l.dataset.modeField);});
      const tms=tonnesMs(v);$('#forage-preview').textContent=tms?`≈ ${n1.format(tms)} t MS`:'';};
    if(entry==='inventory')form.elements.mode.closest('label').hidden=true;
    form.addEventListener('input',sync);form.addEventListener('change',sync);sync();
  }

  async function save(){
    const form=$('#forage-form');if(!form)return;const entry=form.dataset.entry,existing=form.dataset.id?forageRecords(data()).find(r=>r.id===form.dataset.id):null;
    const v={...Object.fromEntries(new FormData(form)),entry};if(entry==='inventory')v.mode='tms';
    const res=validateForage(v);if(res.error)return err('#forage-error',res.error);
    const label=entry==='inventory'?'Inventaire fourrage':`${forageType(res.value.type).label}${res.value.cut?` ${res.value.cut}e coupe`:''}`;
    await saveFarmRecord(store,FORAGE_KIND,{...res.value,name:`${label} ${res.value.date}`},existing);
    toast('Fourrage enregistré.','success');open();
  }

  function lotRow(l={},i=0){
    return`<div class="forage-lot" data-lot="${i}"><label>Lot<input name="label" maxlength="60" value="${e(l.label||'')}"></label><label>Catégorie<select name="category">${CATEGORIES.map(([k,lab])=>`<option value="${k}" ${l.category===k?'selected':''}>${e(lab)}</option>`).join('')}</select></label><label>Effectif<input name="heads" type="number" min="0" step="1" value="${e(l.heads??'')}"></label><label>kg MS/j/animal<input name="kgMsDay" type="number" min="0" step="any" inputmode="decimal" value="${e(l.kgMsDay??'')}" placeholder="${FORAGE_REFERENCES.needs[l.category||CATEGORIES[0][0]]}"></label></div>`;
  }
  function openSettings(lots=null){
    const w=winterSettings(data(),{today:todayIso()}),list=lots||(w.lots.length?w.lots:[{}]);
    modal('Besoins d’hivernage','Lots à nourrir, période et pertes de conservation.',`<form id="forage-settings-form" class="form-grid">
<label>Début de l’hivernage<input type="date" name="start" value="${e(w.start)}"></label><label>Fin (mise à l’herbe)<input type="date" name="end" value="${e(w.end)}"></label>
<label>Pertes de conservation (%)<input name="lossPct" type="number" min="0" max="50" step="any" value="${e(w.lossPct)}"></label>
<label><input type="checkbox" name="includeStockItems" ${w.includeStockItems?'checked':''}> Compter aussi les articles de stock en tonnes (foin, enrubannage, ensilage)</label>
<div class="span-2" id="forage-lots">${list.map(lotRow).join('')}</div>
<p class="form-note span-2">Ingestion indicative en kg de matière sèche par animal et par jour : ${CATEGORIES.map(([k,l])=>`${e(l.toLowerCase())} ${n1.format(FORAGE_REFERENCES.needs[k])}`).join(', ')}. Adaptez à la ration réelle (part de concentrés, lactation).</p>
<p class="form-error span-2" id="forage-settings-error" role="alert" hidden></p></form>`,
    `<button class="button secondary" data-forage="back">Annuler</button><button class="button secondary" data-forage="from-grazing">Depuis le pâturage</button><button class="button secondary" data-forage="add-lot">Ajouter un lot</button><button class="button primary" data-forage="save-settings">Enregistrer</button>`,'large');
  }
  function readLots(){return[...document.querySelectorAll('#forage-lots .forage-lot')].map(row=>{const g=n=>row.querySelector(`[name="${n}"]`)?.value??'';return{label:g('label').trim(),category:g('category'),heads:g('heads')===''?'':Number(g('heads')),kgMsDay:g('kgMsDay')===''?'':Number(String(g('kgMsDay')).replace(',','.'))};});}
  async function saveSettings(){
    const form=$('#forage-settings-form'),v=Object.fromEntries(new FormData(form));
    if(!v.start||!v.end||v.end<=v.start)return err('#forage-settings-error','La fin doit être après le début.');
    const loss=Number(v.lossPct);if(!Number.isFinite(loss)||loss<0||loss>50)return err('#forage-settings-error','Pertes entre 0 et 50 %.');
    const lots=readLots().filter(l=>Number(l.heads)>0);if(lots.some(l=>l.kgMsDay!==''&&(!Number.isFinite(l.kgMsDay)||l.kgMsDay<0||l.kgMsDay>40)))return err('#forage-settings-error','Ingestion entre 0 et 40 kg MS par jour.');
    await store.setPreferences({forageWinter:{start:v.start,end:v.end,lossPct:loss,includeStockItems:form.elements.includeStockItems.checked,lots}});
    toast(`Besoins enregistrés : ${n1.format(lots.reduce((s,l)=>s+needPerDay(l),0))} t MS/j.`,'success');open();
  }

  async function action(name,control){
    const id=control.dataset.id;
    if(name==='back')return open();
    if(name==='new-harvest')return openRecord('harvest',null,{parcelId:control.dataset.parcel||'',cut:control.dataset.cut||''});
    if(name==='new-inventory')return openRecord('inventory');
    if(name==='edit'){const r=forageRecords(data()).find(x=>x.id===id);if(r)openRecord(r.entry,r);return;}
    if(name==='delete'){const r=forageRecords(data()).find(x=>x.id===id);if(!r)return;await store.remove('integrationImports',r.id);toast('Saisie supprimée.','success');return open();}
    if(name==='save')return save();
    if(name==='cut-type'){cutType=control.dataset.type;const c=$('#forage-calendar');if(c)c.innerHTML=calendarHtml();return;}
    if(name==='settings')return openSettings();
    if(name==='add-lot'){const root=$('#forage-lots');if(root)root.insertAdjacentHTML('beforeend',lotRow({},root.children.length));return;}
    if(name==='from-grazing'){const lots=lotsFromGrazing(data(),{date:todayIso()});if(!lots.length)return toast('Aucun lot au pré actuellement.','info');return openSettings(lots);}
    if(name==='save-settings')return saveSettings();
  }
  document.addEventListener('click',ev=>{const c=ev.target.closest('[data-forage]');if(!c||c.disabled)return;c.disabled=true;action(c.dataset.forage,c).catch(error=>toast(error.message,'error')).finally(()=>{c.disabled=false;});});
  return{open};
}
