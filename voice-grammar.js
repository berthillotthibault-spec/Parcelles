// Grammaire vocale enrichie et adaptée à l'exploitation (idée n° 13) : logique pure, sans DOM ni réseau.
// Complète voice-notes.js (n° 10 et 99) :
// - nombres en lettres (« deux cents kilos », « quatre mille cinq cent vingt heures ») et milliers
//   séparés par une espace (« 4 520 heures ») ;
// - surnoms facultatifs des parcelles et des engins (champ « aliases ») ;
// - engins reconnus malgré une erreur de reconnaissance (distance de Levenshtein ≤ 1 ou 2) ;
// - intentions supplémentaires : entretien et compteur, observation, sortie de stock, heures de chantier TP.
// Rien n'est écrit ici : l'interface présente toujours un brouillon à vérifier.
// voice-notes.js charge ce module à la demande (loadVoiceGrammar) : pas d'import circulaire statique.
import {keyTokens, numberKeyTokens, findSequence, levenshtein, tokenMatch} from './voice-notes.js';

const active=(state,type)=>(state?.[type]||[]).filter(item=>item&&!item.deletedAt);

// ---------- Nombres en lettres ----------
const UNITS={zero:0,un:1,une:1,deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8,neuf:9,dix:10,onze:11,douze:12,treize:13,quatorze:14,quinze:15,seize:16};
const TENS={vingt:20,vingts:20,trente:30,quarante:40,cinquante:50,soixante:60,septante:70,huitante:80,octante:80,nonante:90};
// Mots ambigus seuls (« une vidange », « pneu neuf ») : convertis seulement devant une unité ou un nom compté.
const AMBIGUOUS=new Set(['un','une','neuf']);
const COUNTED=/^(tonnes?|t|kilos?|kg|kilogrammes?|grammes?|litres?|l|hectares?|ha|ares?|heures?|h|minutes?|min|sacs?|big|bigbags?|bags?|m3|metres?|cubes?|euros?|jours?|semaines?|mois|ans?|bottes?|balles?|bidons?|doses?|unites?|pneus?|filtres?|passages?|camions?|bennes?|remorques?|voyages?|rangs?|animaux|betes?|tetes?|genisses?|vaches?|veaux|veau|taurillons?|taureaux?|boeufs?|bovins?|brebis|moutons?|agneaux|agnelles?|beliers?|ovins?|chevres?|chevaux|juments?|poulains?)$/;
const isNumberWord=w=>w in UNITS||w in TENS||w==='cent'||w==='cents'||w==='mille';

function readRun(words,start){
  // Lit une suite de mots-nombres à partir de start ; renvoie {value,end} ou null.
  let total=0,current=0,i=start,last=null,count=0;
  while(i<words.length){
    const w=words[i];
    if(w==='et'&&last&&last in TENS&&(words[i+1]==='un'||words[i+1]==='une'||words[i+1]==='onze')){i++;continue;}
    if(!isNumberWord(w))break;
    if(w in UNITS){
      const v=UNITS[w];
      // « deux trois jours » : deux unités de suite ne s'additionnent pas (sauf « dix-sept », « soixante-dix »).
      if(last&&last in UNITS&&!(last==='dix'&&v<10))break;
      if(last&&last in TENS&&v===0)break;
      current+=v;
    }else if(w in TENS){
      if(last==='quatre'&&(w==='vingt'||w==='vingts'))current+=76;
      else{if(last&&(last in TENS||(last in UNITS&&last!=='cent')))break;current+=TENS[w];}
    }else if(w==='cent'||w==='cents'){current=(current||1)*100;}
    else if(w==='mille'){total+=(current||1)*1000;current=0;}
    last=w;count++;i++;
  }
  if(!count)return null;
  return {value:total+current,end:i,count};
}

// Texte normalisé (voiceNormalize) → mêmes mots, nombres en chiffres.
export function wordsToNumbers(norm){
  let text=String(norm||'');
  // « 4 520 heures », « 12 500 litres » : milliers séparés par une espace.
  text=text.replace(/(^|\s)(\d{1,3})((?: \d{3})+)(?=\s|$)/g,(m,pre,head,rest)=>`${pre}${head}${rest.replace(/ /g,'')}`);
  const words=text.split(' ').filter(Boolean),out=[];
  for(let i=0;i<words.length;){
    const run=isNumberWord(words[i])?readRun(words,i):null;
    if(!run){out.push(words[i]);i++;continue;}
    const next=words[run.end]||'';
    if(run.count===1&&AMBIGUOUS.has(words[i])&&!COUNTED.test(next)&&next!=='virgule'){out.push(words[i]);i++;continue;}
    let value=String(run.value),end=run.end;
    // « deux virgule cinq » → 2.5
    if(next==='virgule'){const frac=readRun(words,run.end+1);if(frac){value=`${run.value}.${frac.value}`;end=frac.end;}}
    out.push(value);i=end;
  }
  // « deux tonnes et demie », « une heure et demie » → 2.5 t, 1.5 h
  return out.join(' ').replace(/\b(\d+)\s+(tonnes?|t|heures?|h|litres?|l|kilos?|kg|hectares?|ha|sacs?|jours?)\s+et\s+demie?\b/g,'$1.5 $2');
}

// ---------- Surnoms ----------
// Champ facultatif « aliases » : liste de textes (ou texte séparé par des virgules, points-virgules ou retours).
export function aliasList(entity){
  const value=entity?.aliases,list=Array.isArray(value)?value:typeof value==='string'?value.split(/[,;\n]/):[];
  const seen=new Set(),out=[];
  for(const item of list){const label=String(item??'').replace(/\s+/g,' ').trim().slice(0,60);const key=label.toLocaleLowerCase('fr');if(!label||seen.has(key))continue;seen.add(key);out.push(label);}
  return out.slice(0,12);
}
export const parseAliases=text=>aliasList({aliases:String(text??'')});
export const formatAliases=entity=>aliasList(entity).join(', ');

// ---------- Engins ----------
const MACHINE_WORDS=/\b(tracteurs?|moissonneuses?|batteuses?|ensileuses?|telescopiques?|telesco|manitou|chargeur|pelles?|mini pelle|minipelle|tractopelle|pelleteuse|bulldozer|niveleuse|chargeuse|dumper|camion|benne|remorques?|semoirs?|charrues?|pulverisateurs?|pulve|epandeurs?|faucheuses?|faneuses?|andaineurs?|presses?|enrubanneuse|broyeurs?|herses?|dechaumeurs?|rouleaux?|quad|engins?|machines?|materiels?|automoteur|vehicule|pickup|4x4)\b/;
const COMMON_WORDS=new Set(['casse','cass','case','cases','passe','fait','faite','fini','avec','dans','plus','tout','bien','sous','vers','pour','mais','donc','alors','aussi','encore','haut','bout','fond','fort','faut','dit','tard','tres']);
const GENERIC_MACHINE=new Set(['tracteur','engin','machine','materiel','pelle','mini','benne','remorque','presse','herse','rouleau','camion','quad']);
export function equipmentLabels(machine){
  return [machine.nom,machine.brand,machine.model,machine.brand&&machine.model?`${machine.brand} ${machine.model}`:'',...aliasList(machine)].filter(v=>String(v||'').trim());
}
// Engins cités : noms, marques, modèles et surnoms, tolérants à une erreur de reconnaissance.
export function matchEquipment(text,state){
  const machines=active(state,'materiels'),words=numberKeyTokens(text);
  const hits=[];
  for(const machine of machines){
    let best=0;
    for(const label of equipmentLabels(machine)){
      const need=numberKeyTokens(label).filter(t=>t.length>1);if(!need.length||(need.length===1&&need[0].length<3))continue;
      if(findSequence(words,need).length)best=Math.max(best,need.length);
    }
    if(best)hits.push({machine,score:best});
  }
  if(hits.length){
    const top=Math.max(...hits.map(h=>h.score)),winners=hits.filter(h=>h.score===top).map(h=>h.machine);
    return winners.length===1?{selected:winners,candidates:[],probable:false}:{selected:[],candidates:winners.slice(0,6),probable:false};
  }
  // Un mot distinctif (≥ 4 lettres) d'un nom ou d'un surnom : engin probable, ou choix. Une marque courte
  // mal reconnue (« Fend » pour « Fendt ») est admise si la première lettre et la longueur concordent.
  // Les mots courants (« casse » pour « Case ») ne passent jamais pour une marque mal reconnue.
  const near=(w,t)=>tokenMatch(w,t)||(w.length>=4&&!COMMON_WORDS.has(w)&&w[0]===t[0]&&Math.abs(w.length-t.length)<=1&&levenshtein(w,t)<=1);
  const partial=machines.filter(m=>equipmentLabels(m).some(label=>numberKeyTokens(label).some(t=>t.length>=4&&!/^\d/.test(t)&&!GENERIC_MACHINE.has(t)&&words.some(w=>near(w,t)))));
  if(partial.length===1)return {selected:partial,candidates:[],probable:true};
  if(partial.length>1&&partial.length<=6)return {selected:[],candidates:partial,probable:true};
  // Un mot générique (« le tracteur ») propose les engins qui le portent.
  const loose=machines.filter(m=>equipmentLabels(m).some(label=>numberKeyTokens(label).some(t=>GENERIC_MACHINE.has(t)&&words.includes(t))));
  if(loose.length===1)return {selected:loose,candidates:[],probable:true};
  if(loose.length>1&&loose.length<=6)return {selected:[],candidates:loose,probable:true};
  return {selected:[],candidates:[],probable:false};
}

// ---------- Entretien et compteur ----------
// Types du formulaire d'entretien de Matériel (app.js) : un brouillon vocal n'enregistre que ceux-là.
export const MAINTENANCE_TYPES=['Vidange','Graissage','Pneus','Contrôle technique','Réparation','Autre'];
// Plein, panne ou entretien général : type « Autre », l'opération dictée est reprise dans la note.
export const maintenanceRecordType=opType=>MAINTENANCE_TYPES.includes(opType)?opType:'Autre';
const MAINTENANCE=[
  ['Contrôle technique',/\b(controle technique|ct)\b/],
  ['Vidange',/\b(vidang\w*)\b/],
  ['Graissage',/\b(graiss\w*)\b/],
  ['Pneus',/\b(pneu\w*|crevaison|creve\w*)\b/],
  ['Plein',/\b((?:fait|faire|fais)\s+le\s+plein|gasoil|gazole|gnr|fioul|carburant|adblue)\b/],
  ['Panne',/\b(en panne|panne|en rade|tombe\w* en panne|fuit|fuite d huile)\b/],
  ['Réparation',/\b(repar\w*|soude\w*|remplace\w*|change\w*)\b/],
  ['Entretien',/\b(entretien|revision|filtres?|courroies?|compteur|niveaux?)\b/]
];
const MACHINE_ONLY=/\b(vidang\w*|graiss\w*|controle technique|compteur|gasoil|gazole|gnr|adblue|fait le plein)\b/;
function maintenanceType(norm){return MAINTENANCE.find(([,p])=>p.test(norm))?.[0]||'';}
// Compteur : « 4520 heures », « compteur à 1250 », « 812 h au compteur ». Une heure du jour (< 24) n'en est pas un.
export function meterReading(norm){
  const after=norm.match(/\bcompteur\w*\s+(?:a|de|est a|indique|affiche|marque)?\s*(\d+(?:\.\d+)?)\b/);if(after)return Number(after[1]);
  // « compteur du Fendt à 850 » : l'engin peut s'intercaler (trois mots au plus).
  const named=norm.match(/\bcompteur\w*(?:\s+\w+){1,3}?\s+(?:a|indique|affiche|marque)\s+(\d+(?:\.\d+)?)\b/);if(named)return Number(named[1]);
  for(const m of norm.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:heures?|h)\b/g)){const n=Number(m[1]);if(n>=100||/\bcompteur/.test(norm.slice(m.index+m[0].length,m.index+m[0].length+20))&&n>=24)return n;}
  return null;
}
const amount=(norm,unit)=>{const m=norm.match(new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(?:${unit})\\b`));return m?Number(m[1]):null;};
export function maintenanceIntent(norm,state,{workTyped=false}={}){
  if(!MAINTENANCE.some(([,p])=>p.test(norm)))return null;
  const equipment=matchEquipment(norm,state),machineWord=MACHINE_WORDS.test(norm),only=MACHINE_ONLY.test(norm);
  // « réparé la clôture du Pré Bas » n'est pas un entretien : il faut un engin ou un mot propre aux machines.
  if(!equipment.selected.length&&!equipment.candidates.length&&!machineWord&&!only)return null;
  const opType=maintenanceType(norm)||'Entretien';
  // « semé avec le Fendt, changé le soc » reste un travail : seul un mot d'entretien précis l'emporte.
  if(workTyped&&!only&&['Réparation','Entretien'].includes(opType))return null;
  const candidates=equipment.selected.length?[]:equipment.candidates.length?equipment.candidates:active(state,'materiels').slice(0,12);
  return {intent:'maintenance',equipment:equipment.selected[0]||null,equipmentProbable:equipment.probable,equipmentChoices:candidates,opType,meter:meterReading(norm),liters:opType==='Plein'?amount(norm,'litres?|l'):null,cost:amount(norm,'euros?')};
}

// ---------- Observations ----------
export const OBSERVATION_TYPES=['Observation','Végétation','Eau','Verse','Adventices','Maladie','Ravageur','Dégâts gibier','Grêle','Sécheresse','Drainage','Clôture','Accès','Sol','Autre'];
const OBSERVATIONS=[
  ['Dégâts gibier',/\b(sangliers?|chevreuils?|cerfs?|biches?|gibiers?|blaireaux?|blaireau|lapins?|lievres?)\b/],
  ['Ravageur',/\b(limaces?|pucerons?|altises?|charancons?|campagnols?|taupes?|mulots?|rats?|corbeaux?|pigeons?|choucas|tipules?|taupins?|pyrales?|meligethes?|doryphores?|chenilles?|ravageurs?|cicadelles?|sitones?)\b/],
  ['Maladie',/\b(rouille|septoriose|mildiou|oidium|fusariose|helminthosporiose|pietin|charbon|maladies?|ergot|rhynchosporiose|sclerotinia|phoma)\b/],
  ['Adventices',/\b(chardons?|rumex|adventices?|mauvaises? herbes?|folle avoine|folles avoines|liserons?|ambroisies?|datura|chiendent|vulpins?|ray grass|orties?|ronces?|gaillets?|coquelicots?|morelles?)\b/],
  ['Verse',/\b(verse|versee?s?|couchee?s?)\b/],
  ['Grêle',/\b(grele\w*)\b/],
  ['Eau',/\b(inonde\w*|inondation|flaques?|eau stagnante|fuite d eau|abreuvoirs?|mouillere)\b/],
  ['Clôture',/\b(clotures?|fils? (?:casse|coupe|a terre)|piquets?|barbele|electrificateur|portail)\b/],
  ['Drainage',/\b(drains?|drainage|fosses? bouchee?s?|buses? bouchee?s?)\b/],
  ['Sécheresse',/\b(secheresse|stress hydrique|grille\w*|brule\w* par le soleil)\b/],
  ['Accès',/\b(chemin|acces|entree de champ|passage)\b(?=.*\b(defonce|bouche|impraticable|abime|ornieres?)\b)/],
  ['Sol',/\b(ornieres?|tassement|tasse|erosion|ravine\w*|battance|coulee de boue)\b/],
  ['Végétation',/\b(jauni\w*|jaunisse\w*|carences?|pieds manquants|manques? a la levee|mauvaise levee|levee irreguliere|trous dans|clairseme\w*)\b/]
];
const OBS_VERB=/\b(vu|vue|vus|vues|repere\w*|remarque\w*|constate\w*|observe\w*|signale\w*|attention|a surveiller|surveiller|y a des|y a du|y a de la|il y a (?:des|du|de la|de l|un|une|plein|pas mal|beaucoup)|plein de|pas mal de|beaucoup de|des traces de|degats?)\b/;
const URGENT=/\b(urgent\w*|grave\w*|catastroph\w*|enorme\w*|partout|en masse|vite|tout de suite|cata)\b/;
const WARNING=/\b(beaucoup|plein de|pas mal|attaque\w*|foyers?|surveiller|attention|degats?|commence\w*)\b/;
export function observationIntent(norm,raw,{workTyped=false}={}){
  const hit=OBSERVATIONS.find(([,p])=>p.test(norm));
  if(!hit)return null;
  if(workTyped&&!OBS_VERB.test(norm))return null;
  const [obsType,pattern]=hit,word=norm.match(pattern)?.[0]||'';
  // Le mot tel qu'il a été dit, sans accents perdus : « Chardons », « Dégâts de sangliers ».
  const original=String(raw||'').split(/[\s’',.;:!?]+/).find(w=>w&&w.normalize('NFD').replace(/[̀-ͯ]/g,'').toLocaleLowerCase('fr')===word.split(' ')[0])||word;
  const head=word.includes(' ')?word:original;
  const title=obsType==='Dégâts gibier'?`Dégâts de ${original.toLocaleLowerCase('fr')}`:head.charAt(0).toLocaleUpperCase('fr')+head.slice(1);
  const severity=URGENT.test(norm)?'urgent':WARNING.test(norm)||['Ravageur','Maladie','Dégâts gibier'].includes(obsType)?'warning':'info';
  return {intent:'observation',obsType,title,severity};
}

// ---------- Sortie de stock ----------
const STOCK_OUT=/\b(sorti\w*|pris|prise|preleve\w*|utilise\w*|consomme\w*|tire\w* du stock|retire\w*|charge\w*|mis dans)\b/;
export const isStockOutVerb=norm=>STOCK_OUT.test(norm);

// ---------- Heures de chantier TP ----------
const TP_OPEN=s=>s?.kind==='tp'&&!['Terminé','Annulé'].includes(s.status);
export function matchPublicWorks(norm,state){
  const projects=active(state,'chantiers').filter(TP_OPEN),words=keyTokens(norm),clients=active(state,'clients');
  const scored=projects.map(p=>{
    const client=clients.find(c=>c.id===p.clientId),labels=[p.type,p.address,client?.name||client?.nom].filter(Boolean);
    let score=0;for(const label of labels){const need=keyTokens(label).filter(t=>t.length>=4&&!/^\d/.test(t)&&!['chantier','terrassement','travaux'].includes(t));score+=need.filter(t=>words.some(w=>tokenMatch(w,t))).length;}
    return {project:p,score};
  }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score);
  if(scored.length&&(scored.length===1||scored[0].score>scored[1].score))return {project:scored[0].project,candidates:[]};
  return {project:null,candidates:(scored.length?scored.filter(r=>r.score===scored[0].score).map(r=>r.project):projects).slice(0,6)};
}
// Durée travaillée : « 6 heures de pelle », « 7 h 30 », « de 8 h à 12 h ».
export function workedHours(norm){
  const span=norm.match(/\bde\s+(\d{1,2})\s*(?:heures?|h)\s*(\d{1,2})?\s+(?:a|jusqu a)\s+(\d{1,2})\s*(?:heures?|h)\s*(\d{1,2}(?!\s*(?:m3|metres?|cubes?|tonnes?|t|kg|kilos?|l|litres?)\b))?\b/);
  if(span){const start=Number(span[1])*60+Number(span[2]||0),end=Number(span[3])*60+Number(span[4]||0);if(end>start&&end<=24*60)return Math.round((end-start)/60*100)/100;}
  for(const m of norm.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:heures?|h)(?:\s+(\d{1,2})(?!\s*(?:heures?|h|m3|tonnes?|t)\b))?\b/g)){
    const before=norm.slice(Math.max(0,m.index-6),m.index);if(/\b(a|vers|des)\s*$/.test(before))continue;
    const value=Number(m[1])+(m[2]?Number(m[2])/60:0);if(value>0&&value<=24)return Math.round(value*100)/100;
  }
  return null;
}
export function publicWorksIntent(norm,state){
  if(!active(state,'chantiers').some(TP_OPEN))return null;
  const volume=amount(norm,'m3|metres? cubes?|metre cube|cubes?'),tonnage=amount(norm,'tonnes?|t'),hours=workedHours(norm);
  const match=matchPublicWorks(norm,state);
  const named=Boolean(match.project)||/\bchantier/.test(norm);
  if(!named||(hours===null&&volume===null&&tonnage===null))return null;
  const equipment=matchEquipment(norm,state);
  return {intent:'pw-hours',project:match.project,projectChoices:match.candidates,hours,volumeM3:volume,tonnage,equipmentId:equipment.selected.length===1?equipment.selected[0].id:'',equipmentChoices:equipment.candidates};
}

// ---------- Phrase de confirmation des nouvelles intentions ----------
const fmt=value=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(Number(value)||0);
export function grammarSentence(entry,{when='',parcels=null}={}){
  const names=(parcels||entry.parcels||[]).map(p=>p.nom);
  const on=names.length?` sur ${names.length>1?`${names.slice(0,-1).join(', ')} et ${names[names.length-1]}`:names[0]}`:'';
  if(entry.intent==='maintenance'){
    const what=entry.opType==='Plein'?`Plein${entry.liters?` de ${fmt(entry.liters)} L`:''}`:entry.opType==='Entretien'?'Entretien':entry.opType;
    const of=name=>/^[aeiouyhéèê]/i.test(name)?` de l’${name}`:` du ${name}`;
    return `${what}${entry.equipment?of(entry.equipment.nom):''}${entry.meter!==null&&entry.meter!==undefined?` à ${fmt(entry.meter)} h`:''}${when}, je l’enregistre ?`;
  }
  if(entry.intent==='observation')return `Observation « ${entry.title} »${on}${when}, je l’enregistre ?`;
  if(entry.intent==='stock-out'){const name=entry.product?.name||'ce produit';return `Sortie de ${fmt(entry.quantity)} ${entry.unit} ${/^[aeiouyhéè]/i.test(name)?`d’${name}`:`de ${name}`}${when}, je l’enregistre ?`;}
  if(entry.intent==='pw-hours'){
    const parts=[entry.hours!==null?`${fmt(entry.hours)} h`:'',entry.volumeM3!==null?`${fmt(entry.volumeM3)} m³`:'',entry.tonnage!==null?`${fmt(entry.tonnage)} t`:''].filter(Boolean);
    return `${parts.join(', ')||'Journal'} sur le chantier${entry.project?` « ${entry.project.type} »`:''}${when}, je l’enregistre ?`;
  }
  return '';
}
