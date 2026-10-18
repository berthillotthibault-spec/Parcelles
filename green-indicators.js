// n° 71 — « Mon exploitation en chiffres verts » : indicateurs environnementaux et auto-diagnostic HVE.
// Logique pure (testable sous Node), sans nouvelle saisie : tout est recalculé depuis les données
// existantes (assolement et prairies de l'assistant PAC n° 58, haies et IAE n° 70, IFT n° 64,
// azote n° 56, carburant GNR n° 95, coûts et produits du pilotage). Rien n'est stocké hormis deux
// références IFT facultatives (preferences.greenIndicators).
// C'est un AUTO-DIAGNOSTIC : la grille simplifiée s'inspire du référentiel HVE niveau 3 sans le
// reproduire ; seul l'audit d'un organisme certificateur agréé fait foi.
import {campaignFor,isoDate,normalize,escapeHtml,localDate} from './utils.js';
import {active,completed} from './farm-memory.js';
import {declarationRows} from './pac.js';
import {infraSummary} from './hedges.js';
import {farmIft} from './ift.js';
import {nitrogenOverview,isOrganic,isFertilization} from './nitrogen.js';
import {fuelEntries} from './fuel.js';
import {isTreatment} from './phyto.js';
import {isSowingWork} from './seeds.js';
import {marginModel} from './pilotage.js';
import {printCss,printDocument} from './dossier.js';

// Version de la grille affichée sur l'écran et sur la fiche : à changer à chaque évolution des barèmes.
export const GREEN_REFERENTIAL=Object.freeze({
  version:'2026.1',
  date:'2026-10-01',
  label:'Grille Parcelles 2026.1 inspirée du référentiel HVE niveau 3 (voie A, révision de 2022)',
  threshold:10,
  note:'Barèmes simplifiés et indicatifs : le référentiel officiel compte d’autres items, ses seuils évoluent et certains se calculent sur la moyenne de référence du territoire. À vérifier auprès d’un organisme certificateur.'
});
export const GREEN_DISCLAIMER='Auto-diagnostic calculé à partir de vos saisies : ce n’est ni une certification HVE ni un bilan carbone officiel (Label bas-carbone, CAP’2ER). Seul l’audit d’un organisme certificateur agréé fait foi.';

// Facteurs d'émission fixes, sourcés et datés (ordres de grandeur ; aucune valeur saisie par l'utilisateur).
export const CO2_FACTORS=Object.freeze({
  date:'2026-10-01',
  gnr:Object.freeze({value:3.17,unit:'kg CO2e/L',label:'Gazole non routier brûlé (amont + combustion)',source:'ADEME, Base Empreinte : gazole non routier, ordre de grandeur 2023'}),
  mineralN:Object.freeze({value:3.5,unit:'kg CO2e/kg N',label:'Fabrication des engrais azotés minéraux',source:'Ordre de grandeur des engrais azotés européens (ammonitrate), Base Empreinte ADEME et Agribalyse'}),
  n2o:Object.freeze({value:4.29,unit:'kg CO2e/kg N',label:'Protoxyde d’azote direct au champ (1 % de l’azote apporté)',source:'GIEC 2019, facteur EF1 par défaut de 1 % × 44/28 × PRG à 100 ans de 273 (GIEC AR6)'}),
  scope:'Ne sont pas comptés : méthane entérique et effluents d’élevage (voir CAP’2ER), électricité, achats d’aliments, stockage de carbone des sols et des haies.'
});
export const INPUTS_REFERENCE=Object.freeze({maxPct:30,note:'Repère historique de l’ancienne voie B de la HVE (intrants ≤ 30 % du chiffre d’affaires), supprimée lors de la révision de 2022 : affiché à titre indicatif, sans point.'});

const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const r1=v=>Math.round(v*10)/10,r2=v=>Math.round(v*100)/100;
const workCampaign=w=>w?.campaignId||campaignFor(w?.date||w?.plannedDate);
const ownParcels=state=>active(state,'parcelles').filter(p=>(p.ownershipType||'own')==='own'&&!p.archived);
/** Points d'un barème à seuils croissants [[seuil, points]] (plus c'est haut, mieux c'est). */
export const pointsAtLeast=(grid,value)=>{let p=0;if(value===null||value===undefined)return 0;for(const [min,pts] of grid)if(value+1e-9>=min)p=pts;return p;};
/** Points d'un barème à seuils décroissants [[seuil, points]] (plus c'est bas, mieux c'est). */
export const pointsAtMost=(grid,value)=>{if(value===null||value===undefined)return 0;for(const [max,pts] of grid)if(value<=max+1e-9)return pts;return 0;};

/** Bornes de la campagne culturale « 2026/27 » : du 1er août 2026 au 31 juillet 2027. */
export function campaignWindow(campaign){
  const y=Number(String(campaign).slice(0,4));
  return Number.isFinite(y)?{from:`${y}-08-01`,to:`${y+1}-07-31`}:{from:'',to:''};
}
export function campaignChoices(today=isoDate(new Date()),n=3){
  const y=Number(campaignFor(today).slice(0,4));
  return Array.from({length:n},(_,i)=>`${y-i}/${String(y-i+1).slice(-2)}`);
}

// ---------- Réglages facultatifs ----------
export function greenSettings(state){
  const g=state?.preferences?.greenIndicators||{},ref=v=>{const n=num(v);return n!==null&&n>0&&n<=20?n:null;};
  return{iftRefHerbicide:ref(g.iftRefHerbicide),iftRefOther:ref(g.iftRefOther)};
}
export function validateGreenSettings(v){
  const out={};
  for(const [key,label] of [['iftRefHerbicide','IFT herbicide de référence'],['iftRefOther','IFT hors herbicide de référence']]){
    const raw=String(v?.[key]??'').trim();if(!raw){out[key]=null;continue;}
    const n=num(raw);if(n===null||n<=0||n>20)return{error:`${label} : valeur entre 0 et 20, ou laissez vide.`};
    out[key]=r2(n);
  }
  return{value:out};
}

// ---------- Indicateurs bruts ----------
/** Assolement : cultures des terres arables, part de la culture principale, prairies permanentes, légumineuses. */
export function cropDiversity(state,campaign,{today=isoDate(new Date())}={}){
  const rows=declarationRows(state,campaign,{today}).filter(r=>r.surface>0),sau=rows.reduce((s,r)=>s+r.surface,0);
  const ta=rows.filter(r=>r.kind==='TA'),taArea=ta.reduce((s,r)=>s+r.surface,0);
  const byCulture=new Map();for(const r of ta){const key=normalize(r.culture);if(!key)continue;const g=byCulture.get(key)||{culture:r.culture,area:0};g.area+=r.surface;byCulture.set(key,g);}
  const cultures=[...byCulture.values()].sort((a,b)=>b.area-a.area||a.culture.localeCompare(b.culture,'fr'));
  const main=cultures[0]||null,unknownArea=ta.filter(r=>!normalize(r.culture)).reduce((s,r)=>s+r.surface,0);
  const ppArea=rows.filter(r=>r.category==='prairie-permanente').reduce((s,r)=>s+r.surface,0);
  const legumeArea=ta.filter(r=>r.category==='legumineuse').reduce((s,r)=>s+r.surface,0);
  return{sau:r2(sau),taArea:r2(taArea),cultures,count:cultures.length,main,mainShare:main&&taArea>0?main.area/taArea:null,unknownArea:r2(unknownArea),
    ppArea:r2(ppArea),ppShare:sau>0?ppArea/sau:null,legumeArea:r2(legumeArea),legumeShare:taArea>0?legumeArea/taArea:null};
}

/** Azote de la campagne : minéral et organique apportés (kg N), écart au prévisionnel pondéré par la surface. */
export function nitrogenBalance(state,campaign,{today=isoDate(new Date())}={}){
  const o=nitrogenOverview(state,{today,campaign});
  let mineral=0,organic=0,unknown=0;
  for(const r of o.register){
    if(r.nTotal===null||!r.area){unknown++;continue;}
    const kg=r.nTotal*r.area;if(isOrganic(r.fert))organic+=kg;else mineral+=kg;
  }
  const planned=o.plans.filter(p=>p.complete&&p.dose!==null),area=planned.reduce((s,p)=>s+(num(p.parcel.surfaceHa)||0),0);
  const gap=area>0?r1(planned.reduce((s,p)=>s+(p.realized-p.dose)*(num(p.parcel.surfaceHa)||0),0)/area):null;
  const withCulture=o.plans.filter(p=>p.culture);
  return{mineralKg:Math.round(mineral),organicKg:Math.round(organic),grazingKg:Math.round(o.organic.grazing||0),unknown,applications:o.register.length,
    sau:o.organic.sau,totalPerHa:o.organic.sau>0?r1((mineral+organic)/o.organic.sau):null,organicPerHa:o.organic.perHa,
    gap,gapArea:r2(area),plansComplete:planned.length,plansTotal:withCulture.length,refsLabel:o.refs.label};
}

/** GNR de la campagne : achats (cuve, pleins hors cuve), sinon pleins d'engins, sinon litres saisis sur les travaux. */
export function fuelUse(state,campaign){
  const {from,to}=campaignWindow(campaign),inside=r=>String(r.date||'')>=from&&String(r.date||'')<=to;
  const entries=fuelEntries(state).filter(inside),sum=list=>r2(list.reduce((s,r)=>s+(num(r.litres)||0),0));
  const bought=entries.filter(r=>r.entry==='tank'||(r.entry==='machine'&&r.fromTank===false));
  if(bought.length)return{litres:sum(bought),source:'achats de GNR (cuve et pleins hors cuve)',count:bought.length};
  const machine=entries.filter(r=>r.entry==='machine');
  if(machine.length)return{litres:sum(machine),source:'pleins des engins',count:machine.length};
  const works=active(state,'interventions').filter(w=>completed(w)&&w.status!=='Annulé'&&workCampaign(w)===campaign&&num(w.fuel)>0);
  return{litres:r2(works.reduce((s,w)=>s+num(w.fuel),0)),source:works.length?'litres saisis sur les travaux':'',count:works.length};
}

/** Poids des intrants (semences, engrais, phytos) dans le chiffre d'affaires des cultures. */
export function inputsWeight(state,campaign){
  const own=new Set(ownParcels(state).map(p=>p.id));
  const works=active(state,'interventions').filter(w=>own.has(w.parcelId)&&completed(w)&&w.status!=='Annulé'&&workCampaign(w)===campaign&&(isTreatment(w)||isFertilization(w)||isSowingWork(w)));
  let amount=0,missing=0;
  for(const w of works){const c=num(w.inputCost)>0?num(w.inputCost):num(w.cost)>0?num(w.cost):null;if(c===null)missing++;else amount+=c;}
  const model=marginModel(state,{campaign}),turnover=model.total.productArea>0?model.total.product:null;
  return{amount:r2(amount),works:works.length,missing,turnover:turnover===null?null:r2(turnover),pct:turnover>0?r1(amount/turnover*100):null,reference:INPUTS_REFERENCE};
}

/** CO2 estimé : GNR, fabrication des engrais minéraux et N2O direct de l'azote apporté. */
export function carbonEstimate({fuel,nitrogen,sau},factors=CO2_FACTORS){
  const lines=[
    {key:'gnr',label:factors.gnr.label,base:fuel.litres,baseUnit:'L',factor:factors.gnr},
    {key:'mineralN',label:factors.mineralN.label,base:nitrogen.mineralKg,baseUnit:'kg N',factor:factors.mineralN},
    {key:'n2o',label:factors.n2o.label,base:nitrogen.mineralKg+nitrogen.organicKg,baseUnit:'kg N',factor:factors.n2o}
  ].map(l=>({...l,kg:Math.round((l.base||0)*l.factor.value)}));
  const kg=lines.reduce((s,l)=>s+l.kg,0);
  return{lines,tonnes:r2(kg/1000),perHa:sau>0?Math.round(kg/sau):null,date:factors.date,scope:factors.scope};
}

const irrigationWork=w=>/\b(irrig\w*|arros\w*)\b/.test(normalize(`${w?.type||''}`));
export function irrigationUse(state,campaign){
  const works=active(state,'interventions').filter(w=>completed(w)&&w.status!=='Annulé'&&workCampaign(w)===campaign&&irrigationWork(w));
  const recorded=works.filter(w=>num(w.dose)>0),located=works.filter(w=>w.parcelId&&w.date);
  return{works:works.length,recorded:recorded.length,located:located.length};
}

// ---------- Grille par thème ----------
const item=(key,label,points,max,display,hint,{missing=false}={})=>({key,label,points,max,display,hint:points<max?hint:'',missing,status:missing?'missing':points>=max?'ok':points>0?'partial':'low'});
const pct=v=>v===null||v===undefined?'—':`${r1(v*100).toLocaleString('fr-FR')} %`;
const fr=v=>v===null||v===undefined?'—':Number(v).toLocaleString('fr-FR',{maximumFractionDigits:2});
function theme(key,label,items,{na=false,naReason=''}={}){
  const max=items.reduce((s,i)=>s+i.max,0)||10,points=items.reduce((s,i)=>s+i.points,0),threshold=GREEN_REFERENTIAL.threshold;
  return{key,label,items,points,max,threshold,missingPoints:Math.max(0,threshold-points),reached:!na&&points>=threshold,na,naReason,incomplete:items.some(i=>i.missing)};
}

export function biodiversityTheme(d,iae){
  const sauOk=d.sau>0;
  return theme('biodiversite','Biodiversité',[
    item('iae','Infrastructures agroécologiques (% SAU pondérée)',pointsAtLeast([[2,1],[4,2],[7,3],[10,4]],iae.iaePct),4,iae.items.length?`${fr(iae.iaePct)} % · ${fr(iae.hedgeKm)} km de haies`:'aucune IAE inventoriée',
      'Inventoriez vos haies, bosquets et mares (Plus › Haies et IAE) : 4 % de SAU = 2 points, 10 % = 4 points.',{missing:!iae.items.length||!sauOk}),
    item('diversite','Nombre de cultures sur terres arables',pointsAtLeast([[3,1],[5,2],[7,3]],d.count),3,d.taArea>0?`${d.count} culture${d.count>1?'s':''}`:'aucune terre arable renseignée',
      '3 cultures = 1 point, 5 = 2 points, 7 = 3 points (assolement de la campagne).',{missing:!(d.taArea>0)}),
    item('principale','Culture principale ≤ 50 % des terres arables',d.mainShare!==null&&d.mainShare<=0.5+1e-9?1:0,1,d.main?`${d.main.culture} : ${pct(d.mainShare)}`:'—',
      'Aucune culture ne devrait dépasser la moitié des terres arables.',{missing:!d.main}),
    item('prairies','Prairies permanentes (% SAU)',pointsAtLeast([[0.1,1],[0.3,2]],d.ppShare),2,sauOk?pct(d.ppShare):'—',
      '10 % de la SAU en prairies permanentes = 1 point, 30 % = 2 points.',{missing:!sauOk})
  ]);
}

export function phytoTheme(ift,settings,area){
  const f=ift.farm,has=f.treatments>0,refH=settings.iftRefHerbicide,refO=settings.iftRefOther;
  const scoreRef=(value,ref,absolute)=>ref?pointsAtMost([[0.5,3],[0.7,2],[1,1]],value/ref):pointsAtMost(absolute,value);
  // Aucun IFT calculable (aucun traitement saisi ou doses de référence absentes) : pas de point plutôt
  // qu'un faux IFT nul ; de même, la surface « sans traitement » ne compte que si des traitements existent.
  const known=has&&f.treatments>f.missing;
  const herb=known?scoreRef(f.herbicide,refH,[[0.5,3],[1,2],[1.5,1]]):0,other=known?scoreRef(f.other,refO,[[1,3],[2,2],[3,1]]):0;
  const bioShare=f.biocontrol+f.total>0?f.biocontrol/(f.biocontrol+f.total):0;
  const untreated=ift.parcels.filter(r=>r.surface>0&&r.ift.treatments===0).reduce((s,r)=>s+r.surface,0),untreatedShare=area>0?untreated/area:null;
  const vs=(v,ref)=>ref?`${fr(v)} (référence ${fr(ref)})`:fr(v);
  return theme('phyto','Stratégie phytosanitaire',[
    item('ift-herbicide','IFT herbicide',herb,3,vs(f.herbicide,refH),refH?'≤ 50 % de la référence = 3 points, ≤ 70 % = 2, ≤ 100 % = 1.':'Sans référence du territoire : IFT ≤ 0,5 = 3 points, ≤ 1 = 2, ≤ 1,5 = 1. Saisissez la référence pour un calcul plus juste.',{missing:f.missing>0||!has}),
    item('ift-autre','IFT hors herbicide',other,3,vs(f.other,refO),refO?'≤ 50 % de la référence = 3 points, ≤ 70 % = 2, ≤ 100 % = 1.':'Sans référence du territoire : IFT ≤ 1 = 3 points, ≤ 2 = 2, ≤ 3 = 1.',{missing:f.missing>0||!has}),
    item('biocontrole','Recours au biocontrôle',bioShare>=0.25?2:f.biocontrol>0?1:0,2,f.biocontrol>0?`IFT biocontrôle ${fr(f.biocontrol)}`:'aucun',
      'Un produit de biocontrôle = 1 point ; un quart des traitements en biocontrôle = 2 points.'),
    item('non-traite','Surface sans traitement (% SAU)',has?pointsAtLeast([[0.1,1],[0.3,2]],untreatedShare):0,2,pct(untreatedShare),
      '10 % de la surface sans aucun traitement = 1 point, 30 % = 2 points.',{missing:!(area>0)||!has})
  ].map(i=>i.key==='biocontrole'?i:i.key==='non-traite'?(has?i:{...i,display:'aucun traitement enregistré (à confirmer)'}):!has?{...i,display:'aucun traitement enregistré (à confirmer)'}:known?i:{...i,display:`IFT non calculable (${f.missing} traitement${f.missing>1?'s':''} sans dose de référence)`}));
}

export function fertilizationTheme(n,d){
  return theme('fertilisation','Gestion de la fertilisation',[
    item('solde','Solde azoté (apports efficaces − dose prévue)',n.gap===null?0:pointsAtMost([[0,4],[10,3],[20,2],[40,1]],n.gap),4,n.gap===null?'aucun plan de fumure complet':`${n.gap>0?'+':''}${fr(n.gap)} kg N/ha sur ${fr(n.gapArea)} ha`,
      'Calculez le plan de fumure (reliquat sortie hiver) et restez au plus près de la dose prévue : écart ≤ 0 = 4 points.',{missing:n.gap===null}),
    item('ppf','Parcelles avec plan de fumure calculé',n.plansTotal?(n.plansComplete>=n.plansTotal?2:n.plansComplete/n.plansTotal>=0.5?1:0):0,2,n.plansTotal?`${n.plansComplete}/${n.plansTotal}`:'—',
      'Saisissez le reliquat sortie hiver sur chaque parcelle cultivée (Plus › Azote).',{missing:!n.plansTotal}),
    item('n-total','Azote total apporté (kg N/ha SAU)',n.totalPerHa===null||!n.applications?0:pointsAtMost([[100,2],[150,1]],n.totalPerHa),2,n.totalPerHa===null?'—':!n.applications?'aucun apport enregistré (à confirmer)':`${fr(n.totalPerHa)} kg N/ha`,
      '≤ 100 kg N/ha SAU = 2 points, ≤ 150 = 1 point.',{missing:n.totalPerHa===null||n.unknown>0||!n.applications}),
    item('legumineuses','Légumineuses (% terres arables)',pointsAtLeast([[0.05,1],[0.1,2]],d.legumeShare),2,pct(d.legumeShare),
      '5 % de légumineuses (pois, féverole, luzerne…) = 1 point, 10 % = 2 points.',{missing:d.legumeShare===null})
  ]);
}

export function irrigationTheme(irr){
  if(!irr.works)return theme('irrigation','Gestion de l’irrigation',[],{na:true,naReason:'Aucun travail d’irrigation enregistré sur la campagne : thème non concerné.'});
  return theme('irrigation','Gestion de l’irrigation',[
    item('volumes','Volumes enregistrés à chaque apport',irr.recorded>=irr.works?6:irr.recorded/irr.works>=0.5?3:0,6,`${irr.recorded}/${irr.works} apports avec une dose`,'Notez la dose (mm ou m³/ha) de chaque irrigation.'),
    item('localisation','Apports datés et rattachés à une parcelle',irr.located>=irr.works?4:irr.located/irr.works>=0.5?2:0,4,`${irr.located}/${irr.works}`,'Renseignez la date et la parcelle de chaque irrigation.')
  ]);
}

/** Synthèse complète de la page « Mon exploitation en chiffres verts ». */
export function greenIndicators(state,{campaign=null,today=isoDate(new Date()),catalog=null}={}){
  campaign||=campaignFor(today);
  const settings=greenSettings(state),diversity=cropDiversity(state,campaign,{today}),iae=infraSummary(state);
  const ift=farmIft(state,campaign,{catalog}),nitrogen=nitrogenBalance(state,campaign,{today}),fuel=fuelUse(state,campaign);
  const inputs=inputsWeight(state,campaign),irrigation=irrigationUse(state,campaign),sau=diversity.sau||nitrogen.sau||0;
  const carbon=carbonEstimate({fuel,nitrogen,sau});
  const themes=[biodiversityTheme(diversity,iae),phytoTheme(ift,settings,ift.farm.surface||sau),fertilizationTheme(nitrogen,diversity),irrigationTheme(irrigation)];
  const scored=themes.filter(t=>!t.na);
  return{campaign,today,referential:GREEN_REFERENTIAL,disclaimer:GREEN_DISCLAIMER,settings,sau:r2(sau),diversity,iae,ift,nitrogen,fuel,
    fuelPerHa:sau>0&&fuel.litres>0?r1(fuel.litres/sau):null,inputs,irrigation,carbon,themes,
    reached:scored.filter(t=>t.reached).length,scored:scored.length,empty:!ownParcels(state).length};
}

/** Phrase de jauge : « 7/10 points biodiversité, il manque 3 points ». */
export function themeSentence(t){
  if(t.na)return`${t.label} : non concerné`;
  const base=`${t.points}/${t.max} points ${t.label.toLowerCase()}`;
  return t.reached?`${base}, seuil atteint`:`${base}, il manque ${t.missingPoints} point${t.missingPoints>1?'s':''}`;
}
/** Pistes classées : items sous leur maximum, du plus grand nombre de points à gagner au plus petit. */
export function improvementTips(result,limit=5){
  return result.themes.filter(t=>!t.na&&!t.reached).flatMap(t=>t.items.filter(i=>i.points<i.max&&i.hint).map(i=>({theme:t.label,label:i.label,gain:i.max-i.points,hint:i.hint})))
    .sort((a,b)=>b.gain-a.gain||a.theme.localeCompare(b.theme,'fr')).slice(0,limit);
}

// ---------- Chiffres clés et fiche imprimable ----------
const num0=v=>Number(v||0).toLocaleString('fr-FR',{maximumFractionDigits:0});
/** Chiffres clés de l'écran et de la fiche : {key, label, value, detail}. */
export function keyFigures(r){
  const d=r.diversity,f=r.ift.farm,n=r.nitrogen,i=r.inputs,c=r.carbon,iae=r.iae;
  const k=(key,label,value,detail)=>({key,label,value,detail});
  return[
    k('cultures','Cultures sur terres arables',d.taArea>0?String(d.count):'—',d.main?`principale : ${d.main.culture} (${pct(d.mainShare)})`:'assolement non renseigné'),
    k('prairies','Prairies permanentes',pct(d.ppShare),d.sau>0?`${fr(d.ppArea)} ha sur ${fr(d.sau)} ha de SAU`:'SAU non renseignée'),
    k('iae','Infrastructures agroécologiques',iae.iaePct===null?'—':`${fr(iae.iaePct)} %`,iae.items.length?`${fr(iae.hedgeKm)} km de haies · ${iae.items.length} objet${iae.items.length>1?'s':''}`:'aucune IAE inventoriée'),
    k('ift','IFT total',f.treatments?fr(f.total):'0',f.treatments?`herbicide ${fr(f.herbicide)} · hors herbicide ${fr(f.other)}${f.missing?` · ${f.missing} non calculé${f.missing>1?'s':''}`:''}`:'aucun traitement enregistré'),
    k('azote','Azote apporté',n.totalPerHa===null?'—':`${fr(n.totalPerHa)} kg N/ha`,`${num0(n.mineralKg)} kg minéral · ${num0(n.organicKg)} kg organique${n.gap===null?'':` · écart au prévisionnel ${n.gap>0?'+':''}${fr(n.gap)} kg N/ha`}`),
    k('intrants','Poids des intrants',i.pct===null?'—':`${fr(i.pct)} % du CA`,i.pct===null?(i.amount>0?`${num0(i.amount)} € d’intrants, chiffre d’affaires non renseigné`:'coûts ou produits non renseignés'):`${num0(i.amount)} € sur ${num0(i.turnover)} € (repère ≤ ${i.reference.maxPct} %)`),
    k('gnr','GNR consommé',r.fuelPerHa===null?'—':`${fr(r.fuelPerHa)} L/ha`,r.fuel.litres>0?`${num0(r.fuel.litres)} L · ${r.fuel.source}`:'aucun litre enregistré'),
    k('co2','CO2 estimé',`${fr(c.tonnes)} t CO2e`,c.perHa===null?'GNR, engrais minéraux et N2O direct':`${num0(c.perHa)} kg CO2e/ha · GNR, engrais minéraux, N2O direct`)
  ];
}

/** Fiche « Mon exploitation en chiffres verts » (Imprimer / PDF depuis le navigateur). */
export function greenSheetHtml(r,{farm={},assetBase=''}={}){
  const e=escapeHtml,ref=r.referential,name=farm.nom||'Mon exploitation',title=`Chiffres verts ${r.campaign} · ${name}`;
  const kpis=keyFigures(r).map(x=>`<div class="dz-kpi"><strong>${e(x.value)}</strong><span>${e(x.label)}</span><br><small class="muted">${e(x.detail)}</small></div>`).join('');
  const themes=r.themes.map(t=>`<h3>${e(t.label)} · ${t.na?'non concerné':`${t.points}/${t.max} points${t.reached?', seuil atteint':''}`}</h3>${t.na?`<p class="muted">${e(t.naReason)}</p>`:`<table><thead><tr><th>Critère</th><th>Valeur</th><th class="n">Points</th></tr></thead><tbody>${t.items.map(i=>`<tr><td>${e(i.label)}${i.missing?' <span class="dz-tag">donnée incomplète</span>':''}</td><td>${e(i.display)}</td><td class="n">${i.points}/${i.max}</td></tr>`).join('')}</tbody></table>`}`).join('');
  const tips=improvementTips(r),c=r.carbon;
  const co2=`<table><thead><tr><th>Poste</th><th class="n">Base</th><th class="n">Facteur</th><th class="n">kg CO2e</th></tr></thead><tbody>${c.lines.map(l=>`<tr><td>${e(l.label)}<br><small class="muted">${e(l.factor.source)}</small></td><td class="n">${e(num0(l.base))} ${e(l.baseUnit)}</td><td class="n">${e(fr(l.factor.value))} ${e(l.factor.unit)}</td><td class="n">${e(num0(l.kg))}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">Total</td><td class="n">${e(num0(c.lines.reduce((s,l)=>s+l.kg,0)))}</td></tr></tfoot></table><p class="muted"><small>Facteurs fixes au ${e(localDate(c.date))}. ${e(c.scope)}</small></p>`;
  const body=`<section class="page"><div class="dz-body"><p class="dz-eyebrow">Auto-diagnostic environnemental</p><h1>${e(name)}</h1><p class="muted">Campagne ${e(r.campaign)}${farm.commune?` · ${e(farm.commune)}`:''} · ${e(fr(r.sau))} ha de SAU · établi le ${e(localDate(r.today))}</p>
<p class="dz-note"><strong>Auto-diagnostic, pas une certification.</strong> ${e(r.disclaimer)}</p>
<h2>Chiffres clés</h2><div class="dz-kpis">${kpis}</div>
<h2>Grille HVE simplifiée</h2><p><strong>${r.reached}/${r.scored} thème${r.scored>1?'s':''} au seuil de ${ref.threshold} points.</strong> ${e(ref.label)} · version ${e(ref.version)} du ${e(localDate(ref.date))}.</p>${themes}
${tips.length?`<h2>Pistes de progrès</h2><ol>${tips.map(t=>`<li><strong>${e(t.theme)} · ${e(t.label)}</strong> (jusqu’à +${t.gain} point${t.gain>1?'s':''}) : ${e(t.hint)}</li>`).join('')}</ol>`:''}
<h2>CO2 estimé</h2>${co2}
<p class="dz-note">${e(ref.note)} ${e(r.inputs.reference.note)}</p></div><footer class="dz-foot"><span>${e(title)}</span><span>Référentiel ${e(ref.version)}</span></footer></section>`;
  return printDocument({title,css:printCss({assetBase,footer:`Chiffres verts ${r.campaign} · auto-diagnostic, référentiel ${ref.version}`.replace(/[<>\r\n]/g,''),cover:false}),body});
}
