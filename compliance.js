// n° 55 — « Prêt pour un contrôle ? » : état indicatif des obligations et dossier imprimable.
// Logique pure (testable sous Node). Rien n’est inventé : un point qui ne peut pas être
// évalué avec les données saisies est marqué « Non suivi », jamais « À jour ».
import {campaignFor,escapeHtml,formatNumber,isoDate,localDate,normalize,toNumber} from './utils.js';
import {active,completed} from './farm-memory.js';
import {phytosanitaryRegister} from './advanced-economics.js';
import {parcelFollowupScore} from './harvest-traceability.js';
import {hasInAppPlan,nitrogenComplianceChecks} from './nitrogen.js';
import {pacComplianceChecks} from './pac.js';
import {coverComplianceChecks} from './covers.js';
import {phytoComplianceCheck} from './phyto.js';

export const COMPLIANCE_DISCLAIMER='Établi à partir des données saisies dans Parcelles : ne vaut pas attestation de conformité. Les règles varient selon le département (programme d’actions nitrates, arrêtés locaux) ; vérifiez auprès de votre DDT ou de votre conseiller.';

// Seuils paramétrables (Réglages de la conformité), enregistrés dans exploitation.conformite.
export const COMPLIANCE_DEFAULTS=Object.freeze({
  zoneVulnerable:false,   // exploitation (au moins en partie) en zone vulnérable nitrates
  sprayerControlYears:3,  // périodicité du contrôle obligatoire du pulvérisateur
  rotationMaxSame:3,      // même culture principale au plus N campagnes consécutives (BCAE 7, à adapter)
  warnDays:60,            // alerte avant l’échéance d’un contrôle ou d’un Certiphyto
  certiphytos:[]          // [{nom, expiresAt}]
});

export const STATUS_LABELS=Object.freeze({ko:'À corriger',warn:'À vérifier',unknown:'Non suivi',ok:'À jour',na:'Non concerné'});
const STATUS_ORDER=['ko','warn','unknown','ok','na'];

const CORE_PHYTO_FIELDS=['Parcelle','Date','Produit','Dose'];
const FERTILIZATION=/ferti|azote|azot|engrais|ammonitrate|uree|solution n|lisier|fumier|digestat|epandage|compost|fiente|purin/;
const SPRAYER=/pulve|pulverisateur|atomiseur|sprayer|rampe/;
const HARVEST=/recolte|moisson|battage|ensilage|arrachage/;
const COVER=/couvert|cipan|interculture|derobee|engrais vert|piege a nitrate/;
const NON_ROTATING=/prairie|paturage|pature|herbe|luzerne|jachere|vigne|verger|bois|foret|landes|parcours/;
const PPF=/\bppf\b|plan previsionnel|plan de fumure/;

const clampInt=(value,min,max,fallback)=>{const n=Math.round(Number(value));return Number.isFinite(n)&&n>=min&&n<=max?n:fallback;};
const dayMs=864e5;
const toDay=value=>{const text=isoDate(value||Date.now());return new Date(`${text}T12:00:00`);};
const daysBetween=(a,b)=>Math.round((toDay(b)-toDay(a))/dayMs);

export function complianceSettings(state){
  const raw=state?.exploitation?.conformite||{};
  return{
    zoneVulnerable:raw.zoneVulnerable===true,
    sprayerControlYears:clampInt(raw.sprayerControlYears,1,10,COMPLIANCE_DEFAULTS.sprayerControlYears),
    rotationMaxSame:clampInt(raw.rotationMaxSame,1,10,COMPLIANCE_DEFAULTS.rotationMaxSame),
    warnDays:clampInt(raw.warnDays,0,365,COMPLIANCE_DEFAULTS.warnDays),
    certiphytos:(Array.isArray(raw.certiphytos)?raw.certiphytos:[]).map(c=>({nom:String(c?.nom||'').trim(),expiresAt:String(c?.expiresAt||'').slice(0,10)})).filter(c=>c.nom)
  };
}

export function previousCampaign(campaign){
  const year=Number(String(campaign).slice(0,4));
  return Number.isFinite(year)?`${year-1}/${String(year).slice(-2)}`:campaign;
}
const workCampaign=w=>w.campaignId||campaignFor(w.date||w.plannedDate);
const ownParcels=state=>active(state,'parcelles').filter(p=>(p.ownershipType||'own')==='own'&&!p.archived);
const worst=statuses=>STATUS_ORDER.find(s=>statuses.includes(s))||'ok';
const plural=(n,one,many)=>`${formatNumber(n)} ${n>1?many:one}`;

function check(id,label,status,detail,{items=[],action=null,hint=''}={}){return{id,label,status,statusLabel:STATUS_LABELS[status],detail,items,action,hint};}

/** Échéance d’une date (contrôle, certificat) par rapport à aujourd’hui. */
export function dueStatus(expiresAt,today,warnDays){
  if(!expiresAt)return'warn';
  const left=daysBetween(today,expiresAt);
  return left<0?'ko':left<=warnDays?'warn':'ok';
}
export function addYears(date,years){
  const d=toDay(date);d.setFullYear(d.getFullYear()+years);return isoDate(d);
}

function phytoCheck(state,campaign){
  const rows=phytosanitaryRegister(state).filter(r=>completed(r.work)&&workCampaign(r.work)===campaign);
  if(!rows.length)return check('phyto','Registre phytosanitaire','ok',`Aucun traitement enregistré pour la campagne ${campaign}.`);
  const incomplete=rows.filter(r=>r.missing.length);
  const core=incomplete.filter(r=>r.missing.some(m=>CORE_PHYTO_FIELDS.includes(m)));
  const status=core.length?'ko':incomplete.length?'warn':'ok';
  const detail=incomplete.length?`${plural(incomplete.length,'traitement incomplet','traitements incomplets')} sur ${rows.length}${core.length?` (dont ${formatNumber(core.length)} sans produit, dose, date ou parcelle)`:''}.`:`${plural(rows.length,'traitement complet','traitements complets')} pour la campagne ${campaign}.`;
  return check('phyto','Registre phytosanitaire',status,detail,{items:incomplete.map(r=>({label:`${localDate(r.work.date)} · ${r.parcel?.nom||'Parcelle inconnue'} · ${r.work.product||r.work.type||'Traitement'}`,note:`Manque : ${r.missing.join(', ')}`,action:'edit-work',id:r.work.id})),action:incomplete.length?null:{type:'register',label:'Voir la traçabilité'}});
}

function nitrogenCheck(state,campaign,settings,today){
  if(!settings.zoneVulnerable)return check('nitrogen','PPF et cahier d’enregistrement azote','na','Obligatoires en zone vulnérable. Si votre exploitation y est, indiquez-le dans les réglages.',{action:{type:'settings',label:'Réglages'}});
  const works=active(state,'interventions').filter(w=>completed(w)&&workCampaign(w)===campaign&&FERTILIZATION.test(normalize(`${w.type||''} ${w.product||''}`)));
  const incomplete=works.filter(w=>!w.date||!w.product||!(toNumber(w.dose)>0)||!w.parcelId);
  const since=isoDate(new Date(toDay(today).getTime()-365*dayMs));
  const ppf=active(state,'documents').filter(d=>PPF.test(normalize(`${d.name||''} ${d.category||''} ${(d.tags||[]).join(' ')} ${d.note||''}`))&&String(d.documentDate||isoDate(d.createdAt))>=since).sort((a,b)=>String(b.documentDate||'').localeCompare(String(a.documentDate||'')));
  const inApp=hasInAppPlan(state,campaign);
  const parts=[ppf.length?`PPF : ${ppf[0].name||'document'} (${localDate(ppf[0].documentDate||ppf[0].createdAt)}).`:inApp?`PPF calculé dans Parcelles pour la campagne ${campaign}.`:'Aucun plan prévisionnel de fumure (PPF) daté de moins d’un an dans les documents.',
    works.length?`Cahier : ${plural(works.length,'apport enregistré','apports enregistrés')}${incomplete.length?`, ${plural(incomplete.length,'incomplet','incomplets')}`:''}.`:'Cahier : aucun apport enregistré cette campagne.'];
  const status=worst([ppf.length||inApp?'ok':'ko',incomplete.length?'warn':'ok']);
  return check('nitrogen','PPF et cahier d’enregistrement azote',status,parts.join(' '),{
    items:incomplete.map(w=>({label:`${localDate(w.date)} · ${w.product||w.type||'Apport'}`,note:'Produit, dose, date ou parcelle manquant',action:'edit-work',id:w.id})),
    action:ppf.length||inApp?null:{type:'nitrogen',label:'Calculer le PPF'},hint:'Calculez le PPF dans Parcelles (Azote), ou nommez un document « PPF … » pour qu’il soit reconnu.'});
}

export function sprayers(state){
  return active(state,'materiels').filter(m=>m.controleDate||SPRAYER.test(normalize(`${m.nom||''} ${m.type||''} ${m.category||''} ${m.model||''}`)));
}

function sprayerCheck(state,settings,today,hasPhyto){
  const list=sprayers(state);
  if(!list.length)return check('sprayer','Contrôle du pulvérisateur',hasPhyto?'unknown':'na',hasPhyto?'Aucun pulvérisateur identifié dans le matériel : ajoutez-le, ou renseignez la date de son dernier contrôle.':'Aucun traitement ni pulvérisateur enregistré.',{action:{type:'sprayer',label:'Renseigner'}});
  const items=list.map(m=>{
    const expiresAt=m.controleDate?addYears(m.controleDate,settings.sprayerControlYears):'';
    const status=dueStatus(expiresAt,today,settings.warnDays);
    return{label:m.nom||'Pulvérisateur',note:m.controleDate?`Contrôlé le ${localDate(m.controleDate)} · valable jusqu’au ${localDate(expiresAt)}`:'Date du dernier contrôle non renseignée',status};
  });
  const status=worst(items.map(i=>i.status));
  const detail=status==='ok'?`${plural(list.length,'pulvérisateur contrôlé','pulvérisateurs contrôlés')} (périodicité retenue : ${plural(settings.sprayerControlYears,'an','ans')}).`:status==='ko'?'Contrôle périodique dépassé.':'Contrôle à renseigner ou proche de l’échéance.';
  return check('sprayer','Contrôle du pulvérisateur',status,detail,{items,action:{type:'sprayer',label:'Renseigner'}});
}

/** Opérateurs ayant appliqué un traitement sur les 12 derniers mois. */
export function phytoOperators(state,today=Date.now()){
  const since=isoDate(new Date(toDay(today).getTime()-365*dayMs)),names=new Map();
  for(const r of phytosanitaryRegister(state)){
    if(!completed(r.work)||String(r.work.date||'')<since)continue;
    const nom=String(r.work.operator||'').trim();if(nom&&!names.has(normalize(nom)))names.set(normalize(nom),nom);
  }
  return[...names.values()].sort((a,b)=>a.localeCompare(b,'fr'));
}

function certiphytoCheck(state,settings,today,hasPhyto){
  const operators=phytoOperators(state,today);
  if(!operators.length)return check('certiphyto','Certiphyto des opérateurs',hasPhyto?'unknown':'na',hasPhyto?'Aucun opérateur saisi sur les traitements : impossible de vérifier les certificats.':'Aucun traitement sur les 12 derniers mois.',{action:hasPhyto?{type:'certiphyto',label:'Renseigner'}:null});
  const known=new Map(settings.certiphytos.map(c=>[normalize(c.nom),c]));
  const items=operators.map(nom=>{const c=known.get(normalize(nom)),status=dueStatus(c?.expiresAt,today,settings.warnDays);return{label:nom,note:c?.expiresAt?`Certiphyto valable jusqu’au ${localDate(c.expiresAt)}`:'Date de validité non renseignée',status};});
  const status=worst(items.map(i=>i.status));
  return check('certiphyto','Certiphyto des opérateurs',status,status==='ok'?`${plural(operators.length,'opérateur','opérateurs')} avec un certificat valide.`:status==='ko'?'Au moins un certificat est expiré.':'Certificat à renseigner ou proche de l’échéance.',{items,action:{type:'certiphyto',label:'Renseigner'}});
}

function coverCheck(state,settings,today){
  if(!settings.zoneVulnerable)return check('covers','Couverts en zone vulnérable','na','Concerne les exploitations en zone vulnérable : à indiquer dans les réglages.',{action:{type:'settings',label:'Réglages'}});
  const year=toDay(today).getFullYear(),from=`${year}-06-15`,end=isoDate(today);
  const works=active(state,'interventions').filter(completed);
  const missing=[];let harvested=0;
  for(const p of ownParcels(state)){
    if(NON_ROTATING.test(normalize(p.culture)))continue;
    const harvest=works.filter(w=>w.parcelId===p.id&&HARVEST.test(normalize(w.type))&&w.date>=from&&w.date<=end).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
    if(!harvest)continue;harvested++;
    const cover=works.some(w=>w.parcelId===p.id&&COVER.test(normalize(`${w.type||''} ${w.product||''}`))&&w.date>=harvest.date);
    if(!cover)missing.push({label:p.nom,note:`Récolté le ${localDate(harvest.date)}, aucun semis de couvert enregistré depuis`,action:'open-parcel',id:p.id});
  }
  if(!harvested)return check('covers','Couverts en zone vulnérable','ok',`Aucune récolte d’été ${year} enregistrée sur des terres arables.`);
  return check('covers','Couverts en zone vulnérable',missing.length?'warn':'ok',missing.length?`${plural(missing.length,'parcelle récoltée','parcelles récoltées')} sans couvert enregistré (date limite selon votre programme d’actions).`:`Couverts enregistrés sur les ${plural(harvested,'parcelle récoltée','parcelles récoltées')}.`,{items:missing});
}

function bdniCheck(state){
  const grazing=active(state,'grazingSessions').length;
  return check('bdni','Notifications des mouvements d’animaux (BDNI)',grazing?'unknown':'na',grazing?'Les entrées, sorties et naissances (à notifier sous 7 jours) ne sont pas suivies dans Parcelles : vérifiez dans votre outil de notification.':'Aucun animal suivi dans Parcelles.');
}

/** Cultures principales par campagne pour une parcelle (rotations saisies + culture actuelle). */
export function cultureHistory(state,parcel,campaign){
  const map=new Map(active(state,'rotations').filter(r=>r.parcelId===parcel.id&&r.culture).map(r=>[r.campaignId,String(r.culture)]));
  if(!map.has(campaign)&&parcel.culture)map.set(campaign,String(parcel.culture));
  return map;
}
export function sameCultureStreak(history,campaign){
  const current=history.get(campaign);if(!current)return{streak:0,known:0,culture:''};
  let streak=0,c=campaign;
  while(history.has(c)&&normalize(history.get(c))===normalize(current)){streak++;c=previousCampaign(c);}
  return{streak,known:history.size,culture:current};
}

function rotationCheck(state,settings,campaign){
  const max=settings.rotationMaxSame,items=[];let evaluated=0;
  for(const p of ownParcels(state)){
    const history=cultureHistory(state,p,campaign),{streak,known,culture}=sameCultureStreak(history,campaign);
    if(!culture||NON_ROTATING.test(normalize(culture))||known<2)continue;
    evaluated++;
    if(streak>=max)items.push({label:p.nom,note:`${culture} : ${plural(streak,'campagne consécutive','campagnes consécutives')}${streak>max?' (au-delà du seuil)':', changer à la prochaine campagne'}`,status:streak>max?'ko':'warn',action:'open-parcel',id:p.id});
  }
  if(!evaluated)return check('rotation','Rotation des cultures (BCAE 7)','unknown','Historique insuffisant : saisissez les cultures des campagnes précédentes dans l’assolement.',{action:{type:'rotations',label:'Assolement'}});
  const status=worst(items.map(i=>i.status));
  return check('rotation','Rotation des cultures (BCAE 7)',status,items.length?`${plural(items.length,'parcelle atteint','parcelles atteignent')} le seuil de ${plural(max,'campagne','campagnes')} de même culture.`:`${plural(evaluated,'parcelle évaluée','parcelles évaluées')}, aucune au seuil de ${plural(max,'campagne','campagnes')} de même culture.`,{items,action:{type:'rotations',label:'Assolement'}});
}

function followupCheck(state){
  const scores=ownParcels(state).map(p=>({p,s:parcelFollowupScore(state,p)})).filter(x=>x.s);
  if(!scores.length)return check('followup','Complétude du suivi des travaux','unknown','Aucun travail terminé enregistré.');
  const average=Math.round(scores.reduce((sum,x)=>sum+x.s.score,0)/scores.length),low=scores.filter(x=>x.s.score<80).sort((a,b)=>a.s.score-b.s.score);
  return check('followup','Complétude du suivi des travaux',average>=80&&!low.length?'ok':'warn',`Complétude moyenne ${formatNumber(average)} % (dates, coûts, surfaces, opérateurs) : ce n’est pas une note réglementaire.`,{items:low.map(x=>({label:x.p.nom,note:`${formatNumber(x.s.score)} % · ${x.s.criteria.filter(c=>c.known<c.total).map(c=>c.label.toLowerCase()).join(', ')}`,action:'open-parcel',id:x.p.id}))});
}

// n° 62 — contrôles des traitements (dose, applications, DAR, AMM retirée) d’après les fiches produit.
function phytoControlsCheck(state,today){const c=phytoComplianceCheck(state,{today});return{...c,statusLabel:STATUS_LABELS[c.status]};}

/** Liste [{id,label,status,statusLabel,detail,items,action}] ; status ∈ ko, warn, unknown, ok, na. */
export function complianceChecks(state,{today=isoDate(new Date())}={}){
  const settings=complianceSettings(state),campaign=campaignFor(today);
  const hasPhyto=phytosanitaryRegister(state).some(r=>completed(r.work));
  return[
    phytoCheck(state,campaign),
    phytoControlsCheck(state,today),
    nitrogenCheck(state,campaign,settings,today),
    ...nitrogenComplianceChecks(state,{today,campaign}), // v5b n° 63
    sprayerCheck(state,settings,today,hasPhyto),
    certiphytoCheck(state,settings,today,hasPhyto),
    coverCheck(state,settings,today),
    ...coverComplianceChecks(state,{today}), // v5b n° 74
    bdniCheck(state),
    rotationCheck(state,settings,campaign),
    ...pacComplianceChecks(state,{today,campaign}), // v5b n° 58
    followupCheck(state)
  ];
}

export function complianceSummary(checks){
  const counts={ko:0,warn:0,unknown:0,ok:0,na:0};for(const c of checks||[])counts[c.status]=(counts[c.status]||0)+1;
  const headline=counts.ko?`${plural(counts.ko,'point à corriger','points à corriger')}`:counts.warn?`${plural(counts.warn,'point à vérifier','points à vérifier')}`:'Rien à corriger dans les données saisies';
  return{counts,headline,status:counts.ko?'ko':counts.warn?'warn':'ok'};
}

// Plan d’ensemble en SVG (projection équirectangulaire locale) pour le dossier imprimable.
export function parcelsPlanSvg(parcels,{width=640,height=420}={}){
  const shapes=[];
  for(const p of parcels){
    const g=p.geometry;if(!g)continue;
    const polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
    for(const poly of polys)if(Array.isArray(poly?.[0]))shapes.push({p,ring:poly[0].filter(pt=>Array.isArray(pt)&&Number.isFinite(pt[0])&&Number.isFinite(pt[1]))});
  }
  const pts=shapes.flatMap(s=>s.ring);if(!pts.length)return'';
  const lats=pts.map(pt=>pt[1]),lons=pts.map(pt=>pt[0]),k=Math.cos((Math.min(...lats)+Math.max(...lats))/2*Math.PI/180);
  const minX=Math.min(...lons)*k,maxX=Math.max(...lons)*k,minY=Math.min(...lats),maxY=Math.max(...lats);
  const scale=Math.min((width-20)/Math.max(maxX-minX,1e-9),(height-20)/Math.max(maxY-minY,1e-9));
  const x=lon=>10+(lon*k-minX)*scale,y=lat=>10+(maxY-lat)*scale;
  const paths=shapes.map(s=>`<path d="${s.ring.map((pt,i)=>`${i?'L':'M'}${x(pt[0]).toFixed(1)} ${y(pt[1]).toFixed(1)}`).join('')}Z"><title>${escapeHtml(s.p.nom)}</title></path>`).join('');
  return`<svg class="plan" viewBox="0 0 ${width} ${height}" role="img" aria-label="Plan d’ensemble des parcelles" xmlns="http://www.w3.org/2000/svg"><g fill="#cfe3d6" stroke="#155c3a" stroke-width="1.2">${paths}</g></svg>`;
}

/** Dossier de contrôle imprimable (Imprimer / PDF depuis le navigateur). */
export function controlDossierHtml(state,{today=isoDate(new Date())}={}){
  const e=escapeHtml,campaign=campaignFor(today),checks=complianceChecks(state,{today}),summary=complianceSummary(checks),settings=complianceSettings(state);
  const farm=state?.exploitation||{},parcels=ownParcels(state),area=parcels.reduce((s,p)=>s+toNumber(p.surfaceHa),0);
  const phyto=phytosanitaryRegister(state).filter(r=>completed(r.work)&&workCampaign(r.work)===campaign).sort((a,b)=>String(a.work.date).localeCompare(String(b.work.date)));
  const ferti=active(state,'interventions').filter(w=>completed(w)&&workCampaign(w)===campaign&&FERTILIZATION.test(normalize(`${w.type||''} ${w.product||''}`))).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const parcelName=id=>active(state,'parcelles').find(p=>p.id===id)?.nom||'—';
  const docs=active(state,'documents').slice().sort((a,b)=>String(b.documentDate||'').localeCompare(String(a.documentDate||'')));
  const machines=sprayers(state);
  const section=(id,n,title,body)=>`<section id="${id}"><h2>${n}. ${e(title)}</h2>${body}</section>`;
  const table=(head,rows,empty)=>rows.length?`<table><thead><tr>${head.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`:`<p class="muted">${e(empty)}</p>`;
  const toc=[['etat','État des obligations'],['phyto','Registre phytosanitaire'],['azote','Fertilisation azotée'],['plans','Parcellaire et plans'],['materiel','Pulvérisateurs et Certiphyto'],['pieces','Pièces jointes']];
  const body=`<header><h1>Dossier de contrôle</h1><p class="muted">${e(farm.nom||'Mon exploitation')}${farm.commune?` · ${e(farm.commune)}`:''} · campagne ${e(campaign)} · établi le ${e(localDate(today))}</p><p class="warning"><strong>Document indicatif.</strong> ${e(COMPLIANCE_DISCLAIMER)}</p></header>
<nav><h2>Sommaire</h2><ol>${toc.map(([id,t])=>`<li><a href="#${id}">${e(t)}</a></li>`).join('')}</ol></nav>
${section('etat',1,'État des obligations',`<p><strong>${e(summary.headline)}.</strong> Hypothèses : ${settings.zoneVulnerable?'exploitation en zone vulnérable':'hors zone vulnérable'} ; contrôle pulvérisateur tous les ${e(plural(settings.sprayerControlYears,'an','ans'))} ; même culture au plus ${e(plural(settings.rotationMaxSame,'campagne consécutive','campagnes consécutives'))}.</p>`+table(['Obligation','État','Détail'],checks.map(c=>[e(c.label),`<span class="st st-${c.status}">${e(c.statusLabel)}</span>`,e(c.detail)]),''))}
${section('phyto',2,'Registre phytosanitaire',table(['Date','Parcelle','Culture','Produit','AMM','Dose','Opérateur','Manquants'],phyto.map(r=>[e(localDate(r.work.date)),e(r.parcel?.nom||'—'),e(r.work.culture||r.parcel?.culture||'—'),e(r.work.product||'—'),e(r.work.amm||'—'),r.work.dose!==null&&r.work.dose!==undefined&&r.work.dose!==''?`${e(formatNumber(r.work.dose))} ${e(r.work.doseUnit||'')}`:'—',e(r.work.operator||'—'),e(r.missing.join(', ')||'—')]),`Aucun traitement enregistré pour la campagne ${campaign}.`))}
${section('azote',3,'Fertilisation azotée',table(['Date','Parcelle','Apport','Produit','Dose'],ferti.map(w=>[e(localDate(w.date)),e(parcelName(w.parcelId)),e(w.type||'—'),e(w.product||'—'),w.dose!==null&&w.dose!==undefined&&w.dose!==''?`${e(formatNumber(w.dose))} ${e(w.doseUnit||'')}`:'—']),`Aucun apport enregistré pour la campagne ${campaign}.`))}
${section('plans',4,'Parcellaire et plans',`<p>${e(plural(parcels.length,'parcelle','parcelles'))} · ${e(formatNumber(Math.round(area*100)/100))} ha déclarés dans Parcelles.</p>${parcelsPlanSvg(parcels)}`+table(['Parcelle','Culture','Surface','Commune','Îlot','Contour'],parcels.map(p=>[e(p.nom),e(p.culture||'—'),`${e(formatNumber(p.surfaceHa))} ha`,e(p.commune||'—'),e(p.ilot||'—'),p.geometry?'oui':'non']),'Aucune parcelle.'))}
${section('materiel',5,'Pulvérisateurs et Certiphyto',table(['Pulvérisateur','Dernier contrôle','Valable jusqu’au'],machines.map(m=>[e(m.nom||'—'),m.controleDate?e(localDate(m.controleDate)):'non renseigné',m.controleDate?e(localDate(addYears(m.controleDate,settings.sprayerControlYears))):'—']),'Aucun pulvérisateur identifié.')+table(['Opérateur','Certiphyto valable jusqu’au'],settings.certiphytos.map(c=>[e(c.nom),c.expiresAt?e(localDate(c.expiresAt)):'non renseigné']),'Aucun Certiphyto renseigné.'))}
${section('pieces',6,'Pièces jointes',`<p class="muted">Liste des documents classés dans Parcelles (les fichiers eux-mêmes restent dans l’application ou la sauvegarde complète).</p>`+table(['Date','Catégorie','Document','Tags'],docs.map(d=>[e(localDate(d.documentDate||d.createdAt)),e(d.category||'Autre'),e(d.name||'Document'),e((d.tags||[]).join(', ')||'—')]),'Aucun document enregistré.'))}
<button id="print">Imprimer / PDF</button>`;
  return`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(`Dossier de contrôle ${farm.nom||''}`.trim())}</title><style>body{font-family:system-ui,-apple-system,sans-serif;margin:32px;color:#13251c;line-height:1.45}h1,h2{color:#155c3a}h2{margin-top:28px;break-after:avoid}section{break-inside:auto}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}.muted{color:#55605a}.warning{padding:10px 12px;border-radius:10px;background:#f8eedb;color:#3d2a06}.st{font-weight:700}.st-ko{color:#a83c26}.st-warn{color:#7a4f0e}.st-unknown{color:#4c544f}.st-ok{color:#1d5a3c}.st-na{color:#55605a}.plan{width:100%;max-width:640px;height:auto;border:1px solid #ddd;border-radius:10px;background:#f7f5f0}@media print{button{display:none}body{margin:12mm}a{color:inherit;text-decoration:none}}</style></head><body>${body}<script>window.addEventListener('load',()=>document.getElementById('print')?.addEventListener('click',()=>print()))<\/script></body></html>`;
}
