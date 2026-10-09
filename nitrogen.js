// n° 63 — Plan prévisionnel de fumure (PPF) et cahier d’enregistrement azote (zone vulnérable).
// Logique pure (testable sous Node). Méthode du bilan simplifiée (COMIFER) :
//   X = besoin (b × objectif de rendement) − reliquat sortie hiver − fournitures du sol − effet du précédent − effet du couvert.
// Toutes les références sont dans une table versionnée, modifiable dans l’application et marquée « à vérifier ».
import {campaignFor,formatNumber,isoDate,localDate,normalize,toNumber} from './utils.js';
import {active,completed} from './farm-memory.js';
import {farmRecords} from './farm-records.js';

export const NITROGEN_DISCLAIMER='Calcul indicatif établi à partir des données saisies et d’une table de références à vérifier : il ne remplace ni l’arrêté GREN ni le programme d’actions applicables à votre exploitation, ni le conseil de votre technicien.';

// Table de références versionnée. Les valeurs sont plausibles mais à vérifier.
export const NITROGEN_REFERENCES=Object.freeze({
  version:'AURA-2026.1',
  date:'2026-09-01',
  source:'Arrêté GREN Auvergne-Rhône-Alpes (référentiel régional de l’équilibre de la fertilisation azotée) et programme d’actions régional nitrates Auvergne-Rhône-Alpes, complétant le programme d’actions national (arrêté du 19 décembre 2011 modifié).',
  verify:'Valeurs plausibles saisies pour la simulation : à vérifier dans l’arrêté en vigueur avant tout usage réglementaire.',
  organicCap:170,          // kg N organique / ha SAU / an
  mh:40,                   // fournitures du sol par défaut (minéralisation de l’humus), kg N/ha
  // b : besoin unitaire (kg N par unité de rendement) ; unit : unité de l’objectif de rendement.
  cultures:Object.freeze([
    {key:'ble-dur',label:'Blé dur',match:'\\bble dur\\b',b:3.5,unit:'q/ha',yield:60,season:'automne'},
    {key:'ble',label:'Blé tendre',match:'\\bble\\b|froment',b:3.0,unit:'q/ha',yield:70,season:'automne'},
    {key:'orge-printemps',label:'Orge de printemps',match:'orge.*printemps|escourgeon printemps',b:2.2,unit:'q/ha',yield:55,season:'printemps'},
    {key:'orge',label:'Orge d’hiver',match:'\\borge\\b|escourgeon',b:2.5,unit:'q/ha',yield:65,season:'automne'},
    {key:'triticale',label:'Triticale',match:'triticale',b:2.6,unit:'q/ha',yield:60,season:'automne'},
    {key:'seigle',label:'Seigle',match:'seigle',b:2.3,unit:'q/ha',yield:50,season:'automne'},
    {key:'avoine',label:'Avoine',match:'avoine',b:2.2,unit:'q/ha',yield:50,season:'automne'},
    {key:'colza',label:'Colza',match:'colza',b:6.5,unit:'q/ha',yield:32,season:'automne'},
    {key:'mais-ensilage',label:'Maïs ensilage',match:'mais.*ensil|ensilage.*mais',b:13,unit:'t MS/ha',yield:14,season:'printemps'},
    {key:'mais',label:'Maïs grain',match:'\\bmais\\b',b:2.2,unit:'q/ha',yield:90,season:'printemps'},
    {key:'tournesol',label:'Tournesol',match:'tournesol',b:4.5,unit:'q/ha',yield:25,season:'printemps'},
    {key:'sorgho',label:'Sorgho',match:'sorgho',b:2.5,unit:'q/ha',yield:60,season:'printemps'},
    {key:'legumineuse',label:'Légumineuse (soja, pois, féverole, lentille)',match:'soja|\\bpois\\b|feverole|lentille|lupin|haricot',b:0,unit:'q/ha',yield:30,season:'printemps',legume:true},
    {key:'luzerne',label:'Luzerne, trèfle',match:'luzerne|trefle|sainfoin',b:0,unit:'t MS/ha',yield:10,season:'prairie',legume:true},
    {key:'prairie-temporaire',label:'Prairie temporaire',match:'prairie temporaire|\\bpt\\b|ray grass|dactyle|fetuque',b:25,unit:'t MS/ha',yield:7,season:'prairie'},
    {key:'prairie',label:'Prairie permanente',match:'prairie|herbe|paturage|pature',b:20,unit:'t MS/ha',yield:5,season:'prairie'}
  ]),
  // Effet du précédent (kg N/ha à déduire du besoin).
  precedents:Object.freeze([
    {key:'luzerne',label:'Luzerne, trèfle',match:'luzerne|trefle|sainfoin',effect:40},
    {key:'prairie',label:'Prairie retournée',match:'prairie|herbe|paturage|pature',effect:40},
    {key:'legumineuse',label:'Protéagineux, soja',match:'soja|\\bpois\\b|feverole|lentille|lupin',effect:30},
    {key:'colza',label:'Colza',match:'colza',effect:20},
    {key:'pomme-de-terre',label:'Pomme de terre, betterave',match:'pomme de terre|betterave',effect:15}
  ]),
  // Effet d’un couvert d’interculture détruit avant la culture (kg N/ha à déduire).
  covers:Object.freeze({legume:20,other:10}),
  // Périodes d’interdiction d’épandage (MM-JJ, bornes incluses) par type de fertilisant et occupation du sol.
  banPeriods:Object.freeze([
    {type:'I',season:'automne',from:'11-15',to:'01-15'},
    {type:'II',season:'automne',from:'10-01',to:'01-31'},
    {type:'III',season:'automne',from:'09-01',to:'01-31'},
    {type:'I',season:'printemps',from:'07-01',to:'08-31'},
    {type:'I',season:'printemps',from:'11-15',to:'01-15'},
    {type:'II',season:'printemps',from:'07-01',to:'01-31'},
    {type:'III',season:'printemps',from:'07-01',to:'02-15'},
    {type:'I',season:'prairie',from:'12-15',to:'01-15'},
    {type:'II',season:'prairie',from:'10-01',to:'01-31'},
    {type:'III',season:'prairie',from:'10-01',to:'01-31'}
  ])
});

export const FERTILIZER_TYPES=Object.freeze({
  I:'Type I : C/N > 8 (fumiers, composts)',
  II:'Type II : C/N ≤ 8 (lisiers, fientes, digestats)',
  III:'Type III : engrais minéraux et uréiques de synthèse'
});
export const SEASON_LABELS=Object.freeze({automne:'Cultures d’automne',printemps:'Cultures de printemps',prairie:'Prairies',autre:'Autres'});

// Bibliothèque intégrée : composition en % de la masse brute, keq = coefficient d’équivalence engrais
// de l’azote (part efficace l’année de l’apport), density en t/m³ (ou kg/L). À vérifier.
export const FERTILIZER_LIBRARY=Object.freeze([
  {id:'ammonitrate',name:'Ammonitrate 33,5',match:'ammonitrate|nitrate d ammonium',N:33.5,P2O5:0,K2O:0,SO3:0,type:'III',keq:1,density:1},
  {id:'uree',name:'Urée 46',match:'\\buree\\b',N:46,P2O5:0,K2O:0,SO3:0,type:'III',keq:0.9,density:1},
  {id:'solution-azotee',name:'Solution azotée 390',match:'solution azotee|solution n\\b|\\bsn ?39|\\bsn ?30|uan',N:30,P2O5:0,K2O:0,SO3:0,type:'III',keq:0.9,density:1.3},
  {id:'fumier-bovin',name:'Fumier bovin',match:'fumier',N:0.55,P2O5:0.3,K2O:0.8,SO3:0.1,type:'I',keq:0.15,density:0.8},
  {id:'lisier-bovin',name:'Lisier bovin',match:'lisier',N:0.35,P2O5:0.15,K2O:0.4,SO3:0.05,type:'II',keq:0.5,density:1}
]);

const FERTILIZATION=/ferti|azote|azot|engrais|ammonitrate|uree|solution n|solution azotee|lisier|fumier|digestat|epandage|compost|fiente|purin/;
export const isFertilization=w=>FERTILIZATION.test(normalize(`${w?.type||''} ${w?.product||''}`));
const workCampaign=w=>w.campaignId||campaignFor(w.date||w.plannedDate);
const ownParcels=state=>active(state,'parcelles').filter(p=>(p.ownershipType||'own')==='own'&&!p.archived);
// Nombre strict : vide ou texte non numérique -> null.
export const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).trim().replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const round=(v,d=0)=>{const k=10**d;return Math.round(v*k)/k;};
const regex=pattern=>{try{return new RegExp(pattern);}catch{return /$^/;}};
const MD=/^\d{2}-\d{2}$/;

/** Références effectives : table intégrée + modifications enregistrées dans exploitation.azote.references. */
export function nitrogenReferences(state){
  const o=state?.exploitation?.azote?.references||{};
  const cultures=NITROGEN_REFERENCES.cultures.map(c=>{
    const x=o.cultures?.[c.key]||{},b=num(x.b),y=num(x.yield);
    return{...c,b:b!==null&&b>=0&&b<=100?b:c.b,yield:y!==null&&y>0&&y<=500?y:c.yield};
  });
  const cap=num(o.organicCap),mh=num(o.mh);
  const ban=Array.isArray(o.banPeriods)?o.banPeriods.filter(p=>FERTILIZER_TYPES[p?.type]&&SEASON_LABELS[p?.season]&&MD.test(p.from)&&MD.test(p.to)).map(p=>({type:p.type,season:p.season,from:p.from,to:p.to})):null;
  const modified=Boolean(Object.keys(o.cultures||{}).length||cap!==null||mh!==null||ban);
  return{...NITROGEN_REFERENCES,cultures,organicCap:cap!==null&&cap>0?cap:NITROGEN_REFERENCES.organicCap,mh:mh!==null&&mh>=0?mh:NITROGEN_REFERENCES.mh,banPeriods:ban||NITROGEN_REFERENCES.banPeriods,modified,
    label:`${NITROGEN_REFERENCES.version}${modified?' (modifiée)':''} du ${localDate(NITROGEN_REFERENCES.date)}`};
}

export function cultureReference(culture,refs=NITROGEN_REFERENCES){
  const text=normalize(culture);if(!text)return null;
  return refs.cultures.find(c=>regex(c.match).test(text))||null;
}
export function precedentEffect(culture,refs=NITROGEN_REFERENCES){
  const text=normalize(culture);if(!text)return{effect:0,label:''};
  const hit=refs.precedents.find(p=>regex(p.match).test(text));
  return hit?{effect:hit.effect,label:hit.label}:{effect:0,label:''};
}
export const cultureSeason=(culture,refs=NITROGEN_REFERENCES)=>cultureReference(culture,refs)?.season||'autre';

/** Zone vulnérable : champ optionnel de la parcelle, sinon réglage de l’exploitation. */
export function parcelInZone(state,parcel){
  if(parcel?.zoneVulnerable===true||parcel?.zoneVulnerable===false)return parcel.zoneVulnerable;
  return state?.exploitation?.conformite?.zoneVulnerable===true;
}
export const farmInZone=state=>state?.exploitation?.conformite?.zoneVulnerable===true||active(state,'parcelles').some(p=>p.zoneVulnerable===true);

// ---------- Fertilisants ----------
/** Composition saisie sur un article de stock (champ optionnel fertilizer), normalisée. */
export function normalizeComposition(raw){
  if(!raw||typeof raw!=='object')return null;
  const pct=v=>{const n=num(v);return n!==null&&n>=0&&n<=100?n:null;};
  const N=pct(raw.N);if(N===null)return null;
  const keq=num(raw.keq),density=num(raw.density);
  return{N,P2O5:pct(raw.P2O5)??0,K2O:pct(raw.K2O)??0,SO3:pct(raw.SO3)??0,type:FERTILIZER_TYPES[raw.type]?raw.type:'III',keq:keq!==null&&keq>0&&keq<=1?keq:1,density:density!==null&&density>0&&density<=3?density:1};
}
/** Fertilisant d’un nom de produit : article de stock avec composition, sinon bibliothèque intégrée. */
export function fertilizerFor(state,product){
  const text=normalize(product);if(!text)return null;
  const stock=active(state,'stockItems').find(s=>s.fertilizer&&normalize(s.name)===text);
  const own=stock&&normalizeComposition(stock.fertilizer);
  if(own)return{...own,name:stock.name,source:'stock',id:stock.id};
  const lib=FERTILIZER_LIBRARY.find(f=>regex(f.match).test(text));
  return lib?{N:lib.N,P2O5:lib.P2O5,K2O:lib.K2O,SO3:lib.SO3,type:lib.type,keq:lib.keq,density:lib.density,name:lib.name,source:'library',id:lib.id}:null;
}
export const isOrganic=fert=>fert?.type==='I'||fert?.type==='II';

/** Azote apporté par hectare : {nTotal, nEff} en kg N/ha, ou null si la dose ou la composition manquent. */
export function nitrogenPerHa(work,fert){
  const dose=num(work?.dose);if(dose===null||dose<0)return null;
  const unit=normalize(work.doseUnit||'kg/ha');
  if(/^(unite|u n|kg n)/.test(unit)){const keq=fert?.keq??1;return{nTotal:round(dose,1),nEff:round(dose*keq,1)};}
  if(!fert)return null;
  const density=fert.density||1;
  const kg=unit.startsWith('kg')?dose:unit.startsWith('t ')||unit==='t ha'?dose*1000:unit.startsWith('q')?dose*100:unit.startsWith('l')?dose*density:unit.startsWith('m')?dose*1000*density:null;
  if(kg===null)return null;
  const nTotal=kg*fert.N/100;
  return{nTotal:round(nTotal,1),nEff:round(nTotal*fert.keq,1)};
}

// ---------- Objectif de rendement ----------
export function olympicAverage(values){
  const list=values.filter(v=>Number.isFinite(v)&&v>0);
  if(!list.length)return null;
  if(list.length<5)return{value:round(list.reduce((s,v)=>s+v,0)/list.length,1),method:'simple',count:list.length};
  const five=list.slice(0,5).sort((a,b)=>a-b).slice(1,4);
  return{value:round(five.reduce((s,v)=>s+v,0)/3,1),method:'olympique',count:5};
}
export function previousCampaigns(campaign,n=5){
  const year=Number(String(campaign).slice(0,4));if(!Number.isFinite(year))return[];
  return Array.from({length:n},(_,i)=>`${year-1-i}/${String(year-i).slice(-2)}`);
}
const toUnit=(value,unit,target)=>{
  const u=normalize(unit),tq=target==='q/ha';
  if(u.startsWith('t'))return tq?value*10:value;
  if(u.startsWith('kg'))return tq?value/100:value/1000;
  return tq?value:value/10; // q/ha par défaut
};
export function cultureFor(state,parcel,campaign,today=isoDate(new Date())){
  const r=active(state,'rotations').find(x=>x.parcelId===parcel.id&&x.campaignId===campaign);
  if(r?.culture)return String(r.culture);
  return campaign===campaignFor(today)?String(parcel.culture||''):'';
}
/** Rendements réalisés des 5 campagnes précédentes (lots de récolte, sinon économie de la parcelle). */
export function yieldHistory(state,parcel,campaign,ref,today){
  const unit=ref?.unit||'q/ha',key=ref?.key,surface=toNumber(parcel.surfaceHa),lots=farmRecords(state,'harvest').filter(l=>l.parcelId===parcel.id),out=[];
  for(const c of previousCampaigns(campaign)){
    const ofCampaign=lots.filter(l=>l.date&&campaignFor(l.date)===c);
    const culture=cultureFor(state,parcel,c,today)||ofCampaign.find(l=>l.crop)?.crop||'';
    if(culture&&key&&cultureReference(culture)?.key!==key)continue;
    let value=null,source='';
    if(ofCampaign.length&&surface>0){value=ofCampaign.reduce((s,l)=>s+toUnit(toNumber(l.quantity),l.unit||'t',unit),0)/surface;source='lots de récolte';}
    else{const e=parcel.economicsByCampaign?.[c];const y=num(e?.yield);if(y!==null&&y>0){value=toUnit(y,e.yieldUnit||'q/ha',unit);source='économie';}}
    if(value!==null&&value>0)out.push({campaign:c,value:round(value,1),source});
  }
  return out;
}

// ---------- Plan prévisionnel ----------
export function rotationFor(state,parcelId,campaign){return active(state,'rotations').find(r=>r.parcelId===parcelId&&r.campaignId===campaign)||null;}
const previousCampaign=c=>previousCampaigns(c,1)[0]||'';

/** Effet d’un couvert d’interculture porté par la rotation (n° 74) : rien tant qu’aucun couvert n’est saisi. */
export function coverEffect(rotation,refs=NITROGEN_REFERENCES){
  const ic=rotation?.interculture;if(!String(ic?.especes||'').trim())return{effect:0,label:''};
  return ic.legumineuse?{effect:refs.covers.legume,label:'Couvert avec légumineuses'}:{effect:refs.covers.other,label:'Couvert sans légumineuse'};
}

/** PPF d’une parcelle pour une campagne. */
export function parcelPlan(state,parcel,campaign,{today=isoDate(new Date()),refs=nitrogenReferences(state)}={}){
  const culture=cultureFor(state,parcel,campaign,today),ref=cultureReference(culture,refs),rotation=rotationFor(state,parcel.id,campaign),ppf=rotation?.ppf||{};
  const prevCulture=cultureFor(state,parcel,previousCampaign(campaign),today),prev=precedentEffect(prevCulture,refs),cover=coverEffect(rotation,refs);
  const history=ref?yieldHistory(state,parcel,campaign,ref,today):[],avg=olympicAverage(history.map(h=>h.value));
  const forced=num(ppf.yieldTarget);
  const objective=forced!==null&&forced>0?{value:forced,method:'saisi',count:0}:avg||(ref?{value:ref.yield,method:'référence',count:0}:null);
  const rsh=num(ppf.rsh),mhRaw=num(ppf.mh),mh=mhRaw!==null&&mhRaw>=0?mhRaw:refs.mh;
  const besoin=ref&&objective?round(ref.b*objective.value):null;
  const dose=besoin===null?null:Math.max(0,round(besoin-(rsh??0)-mh-prev.effect-cover.effect));
  return{parcel,culture,ref,rotation,zone:parcelInZone(state,parcel),objective,history,besoin,rsh,mh,precedent:{culture:prevCulture,...prev},cover,dose,
    complete:Boolean(ref&&objective&&rsh!==null),missing:[!culture&&'culture',culture&&!ref&&'référence de culture',rsh===null&&'reliquat sortie hiver'].filter(Boolean)};
}

// ---------- Cahier d’enregistrement ----------
export function nitrogenRegister(state,campaign){
  const parcels=new Map(active(state,'parcelles').map(p=>[p.id,p]));
  return active(state,'interventions').filter(w=>completed(w)&&isFertilization(w)&&workCampaign(w)===campaign).map(w=>{
    const parcel=parcels.get(w.parcelId)||null,fert=fertilizerFor(state,w.product),n=nitrogenPerHa(w,fert),area=num(w.surfaceWorked)??toNumber(parcel?.surfaceHa);
    const dose=num(w.dose);
    return{work:w,parcel,fert,date:w.date||'',product:w.product||'',dose,doseUnit:w.doseUnit||'',area,quantity:dose!==null&&area?round(dose*area,2):null,
      nTotal:n?.nTotal??null,nEff:n?.nEff??null,missing:[!w.product&&'produit',dose===null&&'dose',w.product&&!fert&&!/^(unite|u n|kg n)/.test(normalize(w.doseUnit))&&'composition',!parcel&&'parcelle'].filter(Boolean)};
  }).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}

/** Écart réalisé / prévu : ratio, statut (ok, under, over, unknown) et libellé. */
export function gauge(planned,realized){
  if(planned===null||planned===undefined)return{ratio:null,status:'unknown',label:'Dose prévue non calculée'};
  const gap=round(realized-planned);
  if(planned===0)return{ratio:realized>0?2:1,status:realized>0?'over':'ok',gap,label:realized>0?`${formatNumber(realized)} kg N/ha apportés pour 0 prévu`:'Aucun apport prévu'};
  const ratio=realized/planned;
  return{ratio,gap,status:ratio>1.1?'over':ratio<0.9?'under':'ok',label:`${formatNumber(realized)} / ${formatNumber(planned)} kg N efficace/ha (${gap>=0?'+':''}${formatNumber(gap)})`};
}

// ---------- Alertes ----------
const inPeriod=(md,from,to)=>from<=to?md>=from&&md<=to:md>=from||md<=to;
export function banPeriodFor(date,type,season,refs=NITROGEN_REFERENCES){
  const md=String(date||'').slice(5,10);if(!MD.test(md))return null;
  return refs.banPeriods.find(p=>p.type===type&&p.season===season&&inPeriod(md,p.from,p.to))||null;
}
const mdLabel=md=>{const [m,d]=md.split('-');return`${Number(d)}/${m}`;};

export function nitrogenAlerts(state,{today=isoDate(new Date()),campaign=campaignFor(today),refs=nitrogenReferences(state)}={}){
  const alerts=[],parcels=new Map(active(state,'parcelles').map(p=>[p.id,p]));
  for(const w of active(state,'interventions')){
    if(completed(w)||w.status==='Annulé'||!isFertilization(w))continue;
    const date=w.plannedDate||w.date,parcel=parcels.get(w.parcelId);if(!date||!parcel||!parcelInZone(state,parcel))continue;
    const fert=fertilizerFor(state,w.product);if(!fert)continue;
    const season=cultureSeason(cultureFor(state,parcel,workCampaign(w),today)||parcel.culture,refs),ban=banPeriodFor(date,fert.type,season,refs);
    if(ban)alerts.push({kind:'ban',status:'ko',workId:w.id,parcelId:parcel.id,label:`${parcel.nom} · ${w.product||w.type} le ${localDate(date)}`,
      note:`Fertilisant de type ${fert.type} sur ${SEASON_LABELS[season].toLowerCase()} : épandage interdit du ${mdLabel(ban.from)} au ${mdLabel(ban.to)} (table ${refs.version}).`});
  }
  const sau=ownParcels(state).reduce((s,p)=>s+toNumber(p.surfaceHa),0);
  let organic=0;
  for(const w of active(state,'interventions')){
    if(w.status==='Annulé'||!isFertilization(w)||workCampaign(w)!==campaign)continue;
    const fert=fertilizerFor(state,w.product);if(!isOrganic(fert))continue;
    const n=nitrogenPerHa(w,fert),parcel=parcels.get(w.parcelId),area=num(w.surfaceWorked)??toNumber(parcel?.surfaceHa);
    if(n)organic+=n.nTotal*area;
  }
  const perHa=sau>0?round(organic/sau,1):0;
  if(sau>0&&perHa>refs.organicCap)alerts.push({kind:'cap',status:'ko',label:`${formatNumber(perHa)} kg N organique/ha SAU en ${campaign}`,note:`Plafond de ${formatNumber(refs.organicCap)} kg N/ha SAU dépassé (apports prévus et réalisés ; effluents des animaux au pâturage non comptés).`});
  return{alerts,organic:{total:round(organic),perHa,sau:round(sau,2),cap:refs.organicCap}};
}

// ---------- Synthèse par campagne ----------
export function nitrogenOverview(state,{today=isoDate(new Date()),campaign=campaignFor(today)}={}){
  const refs=nitrogenReferences(state),register=nitrogenRegister(state,campaign);
  const plans=ownParcels(state).map(p=>{
    const plan=parcelPlan(state,p,campaign,{today,refs}),rows=register.filter(r=>r.parcel?.id===p.id);
    const realized=round(rows.reduce((s,r)=>s+(r.nEff??0),0),1);
    return{...plan,realized,gauge:gauge(plan.dose,realized),rows};
  }).filter(x=>x.culture||x.rows.length);
  return{campaign,refs,plans,register,...nitrogenAlerts(state,{today,campaign,refs})};
}

/** Entrées pour le tableau de conformité (n° 55) : statut du PPF calculé et alertes azote. */
export function nitrogenComplianceChecks(state,{today=isoDate(new Date()),campaign=campaignFor(today)}={}){
  const make=(id,label,status,detail,{items=[],action=null,hint=''}={})=>({id,label,status,statusLabel:{ko:'À corriger',warn:'À vérifier',unknown:'Non suivi',ok:'À jour',na:'Non concerné'}[status],detail,items,action,hint});
  if(!farmInZone(state))return[make('nitrogen-plan','Dose d’azote prévue et apports (zone vulnérable)','na','Aucune parcelle en zone vulnérable.',{action:{type:'nitrogen',label:'Azote'}})];
  const o=nitrogenOverview(state,{today,campaign}),zone=o.plans.filter(p=>p.zone);
  const incomplete=zone.filter(p=>!p.complete),over=zone.filter(p=>p.gauge.status==='over');
  const items=[...o.alerts.map(a=>({label:a.label,note:a.note,status:'ko',action:a.workId?'edit-work':null,id:a.workId||null})),
    ...over.map(p=>({label:p.parcel.nom,note:`Apports au-delà du prévisionnel : ${p.gauge.label}`,status:'warn',action:'open-parcel',id:p.parcel.id})),
    ...incomplete.map(p=>({label:p.parcel.nom,note:`PPF incomplet : ${p.missing.join(', ')}`,status:'warn'}))];
  const status=o.alerts.length?'ko':over.length||incomplete.length?'warn':zone.length?'ok':'unknown';
  const detail=!zone.length?'Aucune culture renseignée sur les parcelles en zone vulnérable.':`${zone.length-incomplete.length}/${zone.length} PPF calculés · ${o.alerts.length?`${o.alerts.length} alerte${o.alerts.length>1?'s':''} (période d’interdiction ou plafond de 170 kg N)`:'aucun épandage prévu en période d’interdiction'} · ${formatNumber(o.organic.perHa)} kg N organique/ha SAU.`;
  return[make('nitrogen-plan','Dose d’azote prévue et apports (zone vulnérable)',status,detail,{items,action:{type:'nitrogen',label:'Ouvrir le PPF'},hint:`Table de références ${o.refs.label} : à vérifier.`})];
}
/** Un PPF calculé dans Parcelles (au moins un reliquat saisi) tient lieu de document PPF. */
export const hasInAppPlan=(state,campaign)=>active(state,'rotations').some(r=>r.campaignId===campaign&&num(r.ppf?.rsh)!==null);

// ---------- Documents (PDF) ----------
const n0=v=>v===null||v===undefined?'—':formatNumber(v);
export function planPdfBlocks(state,{today=isoDate(new Date()),campaign=campaignFor(today)}={}){
  const o=nitrogenOverview(state,{today,campaign}),farm=state?.exploitation||{};
  const rows=o.plans.map(p=>[p.parcel.nom,p.zone?'oui':'non',p.culture||'—',p.objective?`${formatNumber(p.objective.value)} ${p.ref?.unit||''} (${p.objective.method})`:'—',n0(p.besoin),n0(p.rsh),n0(p.mh),n0(p.precedent.effect),n0(p.cover.effect),n0(p.dose)]);
  return[{type:'h1',text:`Plan prévisionnel de fumure azotée ${campaign}`},
    {type:'p',text:`${farm.nom||'Mon exploitation'}${farm.commune?` · ${farm.commune}`:''} · établi le ${localDate(today)}`,muted:true},
    {type:'note',text:`Document indicatif. ${NITROGEN_DISCLAIMER}`},
    {type:'p',text:'Méthode du bilan simplifiée : X = besoin (b × objectif) − reliquat sortie hiver − fournitures du sol − effet du précédent − effet du couvert. Valeurs en kg N/ha.'},
    {type:'table',head:['Parcelle','ZV','Culture','Objectif','Besoin','RSH','Sol','Préc.','Couvert','Dose X'],rows,align:['','','','','right','right','right','right','right','right']},
    {type:'h3',text:'Références'},
    {type:'p',text:`Table ${o.refs.label}. Source : ${o.refs.source}`,small:true},
    {type:'p',text:o.refs.verify,small:true,muted:true}];
}
export function registerPdfBlocks(state,{today=isoDate(new Date()),campaign=campaignFor(today)}={}){
  const o=nitrogenOverview(state,{today,campaign}),farm=state?.exploitation||{};
  const rows=o.register.map(r=>[localDate(r.date),r.parcel?.nom||'—',r.product||'—',r.fert?.type||'—',r.dose!==null?`${formatNumber(r.dose)} ${r.doseUnit}`:'—',r.quantity!==null?formatNumber(r.quantity):'—',n0(r.nTotal),n0(r.nEff),r.missing.join(', ')||'—']);
  const gauges=o.plans.filter(p=>p.dose!==null||p.realized).map(p=>[p.parcel.nom,p.culture||'—',n0(p.dose),n0(p.realized),p.gauge.status==='over'?'au-delà':p.gauge.status==='under'?'en deçà':p.gauge.status==='ok'?'conforme':'—']);
  return[{type:'h1',text:`Cahier d’enregistrement azote ${campaign}`},
    {type:'p',text:`${farm.nom||'Mon exploitation'}${farm.commune?` · ${farm.commune}`:''} · établi le ${localDate(today)}`,muted:true},
    {type:'note',text:`Document indicatif, tiré des travaux de fertilisation terminés. ${NITROGEN_DISCLAIMER}`},
    {type:'table',head:['Date','Parcelle','Produit','Type','Dose','Quantité','N total/ha','N eff./ha','Manquant'],rows:rows.length?rows:[['Aucun apport terminé','','','','','','','','']],align:['','','','','right','right','right','right','']},
    {type:'h2',text:'Écart au prévisionnel'},
    {type:'table',head:['Parcelle','Culture','Prévu (kg N/ha)','Réalisé (N eff.)','Écart'],rows:gauges.length?gauges:[['—','','','','']],align:['','','right','right','']},
    {type:'p',text:`Azote organique : ${formatNumber(o.organic.perHa)} kg N/ha SAU (plafond ${formatNumber(o.organic.cap)}). Table ${o.refs.label}.`,small:true}];
}
