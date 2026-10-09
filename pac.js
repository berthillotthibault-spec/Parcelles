// n° 58 — Assistant PAC : assolement déclaratif, contrôle BCAE 7, rappel BCAE 6 et simulateur
// d’éco-régime (voie des pratiques). Logique pure (testable sous Node). C’est une SIMULATION :
// rien n’est transmis à Telepac, la déclaration reste à faire par l’exploitant.
import {campaignFor,formatNumber,isoDate,normalize,toNumber} from './utils.js';
import {active} from './farm-memory.js';
import {coveredParcelIds} from './covers.js';

export const PAC_DISCLAIMER='Simulation indicative établie à partir des données saisies : elle ne remplace pas la notice de la campagne ni la déclaration dans Telepac, que Parcelles ne remplit pas à votre place.';
export const TELEPAC_URL='https://www.telepac.agriculture.gouv.fr/';

// Règles datées par campagne (campagne culturale « 2026/27 » = déclaration PAC 2027). Valeurs à vérifier.
const ECO_GRID=Object.freeze({
  // Points de diversité selon la part des terres arables (seuils croissants : [part, points]).
  legumineuse:[[0.05,1],[0.10,2],[0.15,3]],
  'prairie-temporaire':[[0.05,1],[0.25,2],[0.50,3]],
  jachere:[[0.02,1],[0.04,2],[0.10,3]],
  'cereale-hiver':[[0.10,1],[0.25,2]],
  'cereale-printemps':[[0.05,1],[0.10,2]],
  oleagineux:[[0.05,1],[0.10,2]],
  'autre-ta':[[0.05,1],[0.10,2]]
});
// n° 74 : couverts d’interculture sur au moins 20 % des terres arables = 1 point (hypothèse de simulation, à vérifier).
const COVER_BONUS=Object.freeze({minShare:0.2,points:1});
export const PAC_RULES=Object.freeze({
  '2025/26':{campaign:'2025/26',declaration:2026,version:'PAC-2026.1',date:'2025-09-01',
    bcae7:{years:3,minChangedShare:0.35},
    eco:{grid:ECO_GRID,coverBonus:COVER_BONUS,standard:{points:4,ppShare:0.8,interrang:0.75,amount:46.7},superieur:{points:5,ppShare:0.9,interrang:0.95,amount:64.5}}},
  '2026/27':{campaign:'2026/27',declaration:2027,version:'PAC-2027.1',date:'2026-09-01',
    bcae7:{years:3,minChangedShare:0.35},
    eco:{grid:ECO_GRID,coverBonus:COVER_BONUS,standard:{points:4,ppShare:0.8,interrang:0.75,amount:46},superieur:{points:5,ppShare:0.9,interrang:0.95,amount:63.5}}}
});
export const PAC_SOURCE='Plan stratégique national PAC 2023-2027 de la France, arrêtés relatifs aux BCAE et notice éco-régime de la campagne (montants unitaires publiés après la campagne).';
export const PAC_VERIFY='Seuils, grille de points et montants plausibles saisis pour la simulation : à vérifier dans la notice de la campagne.';
export const BCAE6_REMINDER='BCAE 6 : couverture minimale des sols. Les terres arables doivent rester couvertes (culture d’hiver, couvert, repousses ou résidus) pendant la période sensible fixée par l’arrêté de la campagne, en règle générale au moins 6 semaines à l’automne. À vérifier.';

export function pacRules(campaign){
  if(PAC_RULES[campaign])return{...PAC_RULES[campaign],requested:campaign,exact:true};
  const keys=Object.keys(PAC_RULES).sort(),year=String(campaign).slice(0,4);
  const key=[...keys].reverse().find(k=>k.slice(0,4)<=year)||keys[0];
  return{...PAC_RULES[key],requested:campaign,exact:false};
}

// Correspondance culture → code culture PAC (codes Telepac usuels, à vérifier). Ordre important.
export const PAC_CATEGORIES=Object.freeze({
  'cereale-hiver':'Céréales d’hiver','cereale-printemps':'Céréales de printemps',oleagineux:'Oléagineux',legumineuse:'Légumineuses',
  'prairie-temporaire':'Prairies temporaires',jachere:'Jachères','autre-ta':'Autres cultures',
  'prairie-permanente':'Prairies permanentes',perenne:'Cultures pérennes'
});
export const PAC_CODES=Object.freeze([
  {match:'ble dur',code:'BDH',label:'Blé dur d’hiver',category:'cereale-hiver'},
  {match:'ble.*printemps',code:'BTP',label:'Blé tendre de printemps',category:'cereale-printemps'},
  {match:'\\bble\\b|froment',code:'BTH',label:'Blé tendre d’hiver',category:'cereale-hiver'},
  {match:'orge.*printemps',code:'ORP',label:'Orge de printemps',category:'cereale-printemps'},
  {match:'\\borge\\b|escourgeon',code:'ORH',label:'Orge d’hiver',category:'cereale-hiver'},
  {match:'triticale',code:'TTH',label:'Triticale d’hiver',category:'cereale-hiver'},
  {match:'seigle',code:'SGH',label:'Seigle d’hiver',category:'cereale-hiver'},
  {match:'avoine',code:'AVH',label:'Avoine d’hiver',category:'cereale-hiver'},
  {match:'mais.*ensil|ensilage.*mais',code:'MIE',label:'Maïs ensilage',category:'autre-ta'},
  {match:'\\bmais\\b',code:'MIS',label:'Maïs grain',category:'autre-ta'},
  {match:'sorgho',code:'SOG',label:'Sorgho',category:'autre-ta'},
  {match:'colza',code:'CZH',label:'Colza d’hiver',category:'oleagineux'},
  {match:'tournesol',code:'TRN',label:'Tournesol',category:'oleagineux'},
  {match:'soja',code:'SOJ',label:'Soja',category:'legumineuse'},
  {match:'\\bpois\\b',code:'PPR',label:'Pois de printemps',category:'legumineuse'},
  {match:'feverole',code:'FVL',label:'Féverole',category:'legumineuse'},
  {match:'lentille',code:'LEC',label:'Lentille',category:'legumineuse'},
  {match:'luzerne',code:'LUZ',label:'Luzerne',category:'legumineuse'},
  {match:'trefle',code:'TRE',label:'Trèfle',category:'legumineuse'},
  {match:'jachere',code:'J6S',label:'Jachère de 6 ans ou plus',category:'jachere'},
  {match:'prairie temporaire|ray grass|dactyle|fetuque',code:'PTR',label:'Autre prairie temporaire de 5 ans ou moins',category:'prairie-temporaire'},
  {match:'prairie|herbe|paturage|pature|parcours|estive',code:'PPH',label:'Prairie permanente',category:'prairie-permanente'},
  {match:'betterave',code:'BTN',label:'Betterave non fourragère',category:'autre-ta'},
  {match:'pomme de terre',code:'PTC',label:'Pomme de terre de consommation',category:'autre-ta'},
  {match:'vigne',code:'VRC',label:'Vigne',category:'perenne'},
  {match:'verger|pommier|noyer|cerisier|abricotier',code:'VRG',label:'Verger',category:'perenne'}
]);
const CODE_INDEX=new Map(PAC_CODES.map(c=>[c.code,c]));
const regex=p=>{try{return new RegExp(p);}catch{return /$^/;}};
export function pacCodeFor(culture){
  const text=normalize(culture);if(!text)return null;
  return PAC_CODES.find(c=>regex(c.match).test(text))||null;
}
export const categoryOfCode=code=>CODE_INDEX.get(String(code||'').toUpperCase())?.category||null;
const kindOf=category=>category==='prairie-permanente'?'PP':category==='perenne'?'PERENNE':category?'TA':'';

// ---------- Cultures par campagne ----------
export function previousCampaign(c,n=1){const y=Number(String(c).slice(0,4))-n;return Number.isFinite(y)?`${y}/${String(y+1).slice(-2)}`:'';}
const ownParcels=state=>active(state,'parcelles').filter(p=>(p.ownershipType||'own')==='own'&&!p.archived);
export function cultureAt(state,parcel,campaign,today=isoDate(new Date())){
  const r=active(state,'rotations').find(x=>x.parcelId===parcel.id&&x.campaignId===campaign);
  if(r?.culture)return String(r.culture);
  return campaign===campaignFor(today)?String(parcel.culture||''):'';
}

// ---------- (a) Déclaration ----------
/** Lignes de l’assolement déclaratif par îlot : code culture (saisi, déduit de la culture ou du RPG), surface, prairie. */
export function declarationRows(state,campaign,{today=isoDate(new Date())}={}){
  const rotations=active(state,'rotations');
  return ownParcels(state).map(p=>{
    const r=rotations.find(x=>x.parcelId===p.id&&x.campaignId===campaign),culture=cultureAt(state,p,campaign,today);
    const mapped=pacCodeFor(culture),rpg=String(p.rpgCodeCulture||'').toUpperCase();
    const code=String(r?.pac?.code||'').toUpperCase()||mapped?.code||rpg||'';
    const codeSource=r?.pac?.code?'saisi':mapped?'culture':rpg?'RPG':'';
    let category=categoryOfCode(code)||mapped?.category||null;
    const prairie=r?.pac?.prairie||(category==='prairie-permanente'?'permanente':category==='prairie-temporaire'?'temporaire':'');
    if(prairie==='permanente')category='prairie-permanente';else if(prairie==='temporaire'&&category==='prairie-permanente')category='prairie-temporaire';
    return{parcel:p,ilot:String(p.ilot||''),culture,code,codeSource,codeLabel:CODE_INDEX.get(code)?.label||'',surface:toNumber(p.surfaceHa),prairie,category,kind:kindOf(category),rotation:r||null};
  }).sort((a,b)=>(!a.ilot-!b.ilot)||a.ilot.localeCompare(b.ilot,'fr',{numeric:true})||String(a.parcel.nom).localeCompare(String(b.parcel.nom),'fr'));
}
const csvCell=v=>{const s=String(v??'');return /[;"\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
export function declarationCsv(rows,campaign){
  const head=['Campagne','Îlot','Parcelle','Culture','Code culture PAC','Libellé code','Surface (ha)','Prairie','Catégorie'];
  const lines=rows.map(r=>[campaign,r.ilot,r.parcel.nom,r.culture,r.code,r.codeLabel,String(Math.round(r.surface*100)/100).replace('.',','),r.prairie,PAC_CATEGORIES[r.category]||'']);
  return'﻿'+[head,...lines].map(l=>l.map(csvCell).join(';')).join('\r\n')+'\r\n';
}

// ---------- (b) BCAE 7 ----------
const EXEMPT=new Set(['prairie-temporaire','jachere']);
/** Statut BCAE 7 d’une parcelle : ko (même culture sur 3 campagnes), same, changed, unknown, na. */
export function bcae7Parcel(state,parcel,campaign,{today=isoDate(new Date()),rules=pacRules(campaign)}={}){
  const culture=cultureAt(state,parcel,campaign,today),mapped=pacCodeFor(culture),kind=kindOf(mapped?.category);
  if(!culture)return{status:'unknown',culture,history:[]};
  if(kind!=='TA'||EXEMPT.has(mapped?.category))return{status:'na',culture,history:[]};
  const history=Array.from({length:rules.bcae7.years},(_,i)=>cultureAt(state,parcel,previousCampaign(campaign,i),today));
  const prev=history[1];
  if(!prev)return{status:'unknown',culture,history};
  const changed=normalize(prev)!==normalize(culture);
  if(!changed&&history.every(h=>h&&normalize(h)===normalize(culture)))return{status:'ko',culture,history};
  return{status:changed?'changed':'same',culture,history};
}
export function bcae7Summary(state,campaign,{today=isoDate(new Date())}={}){
  const rules=pacRules(campaign),rows=ownParcels(state).map(p=>({parcel:p,area:toNumber(p.surfaceHa),...bcae7Parcel(state,p,campaign,{today,rules})}));
  const concerned=rows.filter(r=>r.status!=='na'),area=concerned.reduce((s,r)=>s+r.area,0);
  const changedArea=rows.filter(r=>r.status==='changed').reduce((s,r)=>s+r.area,0),unknownArea=rows.filter(r=>r.status==='unknown').reduce((s,r)=>s+r.area,0);
  const share=area>0?changedArea/area:0,faulty=rows.filter(r=>r.status==='ko');
  const shareOk=area===0||share>=rules.bcae7.minChangedShare;
  const status=!area?'na':faulty.length||(!shareOk&&!unknownArea)?'ko':!shareOk||unknownArea?'warn':'ok';
  return{rules,rows,area,changedArea,unknownArea,share,shareOk,faulty,status};
}
export const BCAE7_COLORS=Object.freeze({
  ko:{label:'BCAE 7 : même culture 3 campagnes',color:'#c0392b'},
  same:{label:'Même culture que la campagne précédente',color:'#d58932'},
  changed:{label:'Culture changée cette campagne',color:'#2f8054'},
  unknown:{label:'Historique insuffisant',color:'#8e9690'},
  na:{label:'Non concernée (prairie, jachère, pérenne)',color:'#5f86a8'}
});
/** Mode couleur « BCAE 7 » de la carte. */
export function bcae7ColorInfo(state,parcel,{today=isoDate(new Date())}={}){
  return BCAE7_COLORS[bcae7Parcel(state||{},parcel,campaignFor(today),{today}).status];
}
export const PAC_MAP_MODES=Object.freeze([['bcae7','BCAE 7']]);

// ---------- BCAE 6 ----------
export function bcae6Summary(state,campaign,{today=isoDate(new Date())}={}){
  const rows=declarationRows(state,campaign,{today}).filter(r=>r.kind==='TA'),area=rows.reduce((s,r)=>s+r.surface,0);
  const withCover=coveredParcelIds(state,campaign);
  const covered=rows.filter(r=>withCover.has(r.parcel.id)||['cereale-hiver','prairie-temporaire','jachere'].includes(r.category)||/colza/.test(normalize(r.culture)));
  const coveredArea=covered.reduce((s,r)=>s+r.surface,0);
  return{area,coveredArea,uncovered:rows.filter(r=>!covered.includes(r)),text:BCAE6_REMINDER};
}

// ---------- (c) Éco-régime, voie des pratiques ----------
export function pointsFor(grid,share){let p=0;for(const [min,pts] of grid||[])if(share+1e-9>=min)p=pts;return p;}
const r1=v=>Math.round(v*10)/10;
export function ecoRegime(state,campaign,{today=isoDate(new Date())}={}){
  const rules=pacRules(campaign),eco=rules.eco,rows=declarationRows(state,campaign,{today});
  const ta=rows.filter(r=>r.kind==='TA'),taArea=ta.reduce((s,r)=>s+r.surface,0);
  const byCat={};for(const r of ta)byCat[r.category]=(byCat[r.category]||0)+r.surface;
  const categories=Object.keys(eco.grid).map(k=>{const area=byCat[k]||0,share=taArea>0?area/taArea:0;return{key:k,label:PAC_CATEGORIES[k],area,share,points:pointsFor(eco.grid[k],share)};});
  const withCover=coveredParcelIds(state,campaign),coverArea=ta.filter(r=>withCover.has(r.parcel.id)).reduce((s,r)=>s+r.surface,0),coverShare=taArea>0?coverArea/taArea:0;
  const cover={area:coverArea,share:coverShare,points:eco.coverBonus&&coverShare+1e-9>=eco.coverBonus.minShare?eco.coverBonus.points:0};
  const points=categories.reduce((s,c)=>s+c.points,0)+cover.points;
  const levelOf=(value,key)=>value>=eco.superieur[key]-1e-9?2:value>=eco.standard[key]-1e-9?1:0;
  const components=[];
  if(taArea>0)components.push({key:'diversite',label:'Diversité des cultures sur terres arables',value:points,unit:'points',level:levelOf(points,'points'),target:{standard:eco.standard.points,superieur:eco.superieur.points}});
  const pp=rows.filter(r=>r.kind==='PP'),ppArea=pp.reduce((s,r)=>s+r.surface,0);
  if(ppArea>0){
    const plowed=new Set(active(state,'interventions').filter(w=>w.status!=='Annulé'&&/labour/.test(normalize(w.type))&&(w.campaignId||campaignFor(w.date||w.plannedDate))===campaign).map(w=>w.parcelId));
    const kept=pp.filter(r=>!plowed.has(r.parcel.id)).reduce((s,r)=>s+r.surface,0),share=kept/ppArea;
    components.push({key:'prairies',label:'Prairies permanentes non labourées',value:share,unit:'part',level:levelOf(share,'ppShare'),area:ppArea,kept,target:{standard:eco.standard.ppShare,superieur:eco.superieur.ppShare}});
  }
  const per=rows.filter(r=>r.kind==='PERENNE'),perArea=per.reduce((s,r)=>s+r.surface,0);
  if(perArea>0){
    const share=per.filter(r=>r.parcel.interrangCouvert===true).reduce((s,r)=>s+r.surface,0)/perArea;
    components.push({key:'interrang',label:'Couverture de l’interrang des cultures pérennes',value:share,unit:'part',level:levelOf(share,'interrang'),area:perArea,target:{standard:eco.standard.interrang,superieur:eco.superieur.interrang}});
  }
  const level=components.length?Math.min(...components.map(c=>c.level)):0;
  const sau=rows.reduce((s,r)=>s+r.surface,0),amount=level===2?eco.superieur.amount:level===1?eco.standard.amount:0;
  const result={rules,campaign,taArea,categories,cover,points,components,level,levelLabel:['Non atteint','Niveau standard','Niveau supérieur'][level],sau,amountHa:amount,amountTotal:Math.round(amount*sau),
    nextAmountHa:level<2?(level===1?eco.superieur.amount:eco.standard.amount):null};
  result.advice=ecoAdvice(result);
  return result;
}
/** Conseil pour atteindre le niveau suivant : composante limitante et surface à ajouter. */
export function ecoAdvice(result){
  if(!result.components.length)return{text:'Aucune surface éligible saisie.',missing:null};
  if(result.level===2)return{text:'Niveau supérieur atteint.',missing:0};
  const targetKey=result.level===1?'superieur':'standard',eco=result.rules.eco,tips=[];
  for(const c of result.components){
    if(c.level>result.level)continue;
    if(c.key==='diversite'){
      const missing=c.target[targetKey]-c.value;let best=null;
      for(const cat of result.categories){
        for(const [min,pts] of eco.grid[cat.key]){
          if(pts-cat.points<missing)continue;
          const ha=Math.max(0,min*result.taArea-cat.area);
          if(ha>0&&(!best||ha<best.ha))best={ha,label:cat.label.toLowerCase()};
          break;
        }
      }
      const cb=eco.coverBonus;
      if(cb&&!result.cover.points&&cb.points>=missing){const need=Math.max(0,cb.minShare*result.taArea-result.cover.area);if(need>0&&(!best||need<best.ha))best={ha:need,label:'couverts d’interculture'};}
      tips.push(best?`il manque ${formatNumber(missing)} point${missing>1?'s':''} : +${formatNumber(Math.ceil(best.ha*10)/10)} ha de ${best.label}`:`il manque ${formatNumber(missing)} point${missing>1?'s':''} de diversité`);
    }else{
      const need=Math.max(0,eco[targetKey][c.key==='prairies'?'ppShare':'interrang']*c.area-(c.key==='prairies'?c.kept:c.value*c.area));
      tips.push(c.key==='prairies'?`+${formatNumber(r1(need))} ha de prairies permanentes non labourées`:`+${formatNumber(r1(need))} ha d’interrang couvert`);
    }
  }
  return{text:`${targetKey==='superieur'?'Niveau supérieur':'Niveau standard'} : ${tips.join(' ; ')}.`,missing:tips.length};
}

/** Entrée pour le tableau de conformité (n° 55). */
export function pacComplianceChecks(state,{today=isoDate(new Date()),campaign=campaignFor(today)}={}){
  const s=bcae7Summary(state,campaign,{today}),labels={ko:'À corriger',warn:'À vérifier',unknown:'Non suivi',ok:'À jour',na:'Non concerné'};
  const detail=!s.area?'Aucune terre arable soumise à la rotation.':`${formatNumber(Math.round(s.share*100))} % des terres arables ont changé de culture (seuil ${formatNumber(s.rules.bcae7.minChangedShare*100)} %)${s.faulty.length?` · ${s.faulty.length} parcelle${s.faulty.length>1?'s':''} sans changement sur ${s.rules.bcae7.years} campagnes`:''}${s.unknownArea?` · historique incomplet sur ${formatNumber(Math.round(s.unknownArea*10)/10)} ha`:''}.`;
  return[{id:'pac-bcae7',label:'BCAE 7 : rotation sur 3 ans et 35 % de changement',status:s.status,statusLabel:labels[s.status],detail,
    items:s.faulty.map(r=>({label:r.parcel.nom,note:`${r.culture} sur ${s.rules.bcae7.years} campagnes`,status:'ko',action:'open-parcel',id:r.parcel.id})),
    action:{type:'pac',label:'Assistant PAC'},hint:`Règles ${s.rules.version} : simulation à vérifier.`}];
}
