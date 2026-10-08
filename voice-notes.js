// Saisie vocale de bout en bout (idées n° 10 et 99) : logique pure, sans DOM.
// - analyse d'un compte rendu dicté ou saisi (types, parcelles, produits, dates relatives,
//   surface partielle, pâturage, réception de stock) ;
// - mémos audio hors ligne, rangés dans « documents » (champ facultatif voiceMemo).
// Rien n'est écrit ici : l'interface présente un brouillon et attend une validation.
import {grazingDate, grazingStatus, grazingTotal, grazingType} from './grazing.js';

export const MEMO_MAX_MS=120000;
export const MEMO_TAG='Mémo vocal';
const AUDIO_TYPES=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus','audio/aac'];

const active=(state,type)=>(state?.[type]||[]).filter(item=>item&&!item.deletedAt);
const STOP=new Set(['le','la','les','l','de','du','des','d','en','au','aux','a','sur','dans','un','une','et','j','ai','on','a','pour','par','avec','ce','cette','mon','ma','mes','son','sa','nos','notre','tout','toute','toutes','tous','y','qu','que','je','nous','avons','il','elle']);
const NUMBER_WORDS={un:1,une:1,deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8,neuf:9,dix:10,onze:11,douze:12,treize:13,quatorze:14,quinze:15,seize:16,vingt:20,trente:30,quarante:40,cinquante:50,soixante:60,cent:100,demi:0.5};
const WEEKDAYS=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
const MONTHS=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];

// Types de base : motif sur le texte normalisé → libellé. L'ordre compte (le plus précis d'abord).
export const BASE_WORK_TYPES=[
  ['Désherbage',/\b(desherb\w*)\b/],
  ['Fertilisation',/\b(fertilis\w*|engrais|azote|am+onitrat\w*|uree)\b/],
  ['Épandage',/\b(epand\w*|fumier|lisier|compost)\b/],
  ['Pulvérisation',/\b(pulveris\w*|traite[rsz]?|traitee?s?|traitement|fongicide|insecticide)\b/],
  ['Semis',/\b(semis|seme[rsz]?|semee?s?|semai[st]?|semons|resem\w*)\b/],
  ['Fanage',/\b(fanage|fane[rsz]?|fanee?s?)\b/],
  ['Andainage',/\b(andain\w*)\b/],
  ['Enrubannage',/\b(enrubann\w*)\b/],
  ['Ensilage',/\b(ensil\w*)\b/],
  ['Pressage',/\b(pressage|presse[rsz]?|pressee?s?|bottel\w*)\b/],
  ['Fauche',/\b(fauche[rsz]?|fauchee?s?|fauchage)\b/],
  ['Récolte',/\b(recolt\w*|moisson\w*|battage|battu)\b/],
  ['Déchaumage',/\b(dechaum\w*)\b/],
  ['Labour',/\b(labour\w*)\b/],
  ['Hersage',/\b(herse[rsz]?|hersee?s?|hersage)\b/],
  ['Broyage',/\b(broy\w*)\b/],
  ['Binage',/\b(binage|bine[rsz]?|binee?s?)\b/],
  ['Chaulage',/\b(chaul\w*)\b/],
  ['Roulage',/\b(roulage|cultipack\w*)\b/]
];

const ANIMALS=[['genisse','Bovins'],['vache','Bovins'],['veau','Bovins'],['taurillon','Bovins'],['taureau','Bovins'],['boeuf','Bovins'],['bovin','Bovins'],['brebi','Ovins'],['mouton','Ovins'],['agneau','Ovins'],['belier','Ovins'],['ovin','Ovins'],['chevre','Caprins'],['bouc','Caprins'],['caprin','Caprins'],['cheval','Chevaux'],['chevau','Chevaux'],['jument','Chevaux'],['poulain','Chevaux'],['animal','' ],['animau',''],['bete',''],['troupeau',''],['lot','']];

// Texte → minuscules sans accents, décimales conservées (« 32,5 » → « 32.5 »).
export function voiceNormalize(value){
  return String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLocaleLowerCase('fr')
    .replace(/[’']/g,' ').replace(/(\d)[,.](\d)/g,'$1.$2').replace(/[^a-z0-9.]+/g,' ').replace(/(^|\s)\.|\.(?=\s|$)/g,' ').replace(/\s+/g,' ').trim();
}
const singular=token=>token.length>3&&/[sx]$/.test(token)&&!/^\d/.test(token)?token.slice(0,-1):token;
function numberWords(text){return text.replace(/\b(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante|cent)\b(?=\s+(?:tonnes?|t|kilos?|kg|litres?|l|hectares?|ha|sacs?|big|genisses?|vaches?|veaux|brebis|moutons?|agneaux|chevaux|juments?|betes?|animaux|chevres?|taurillons?|bovins?|ovins?)\b)/g,word=>String(NUMBER_WORDS[word]));}
export function tokens(value){return voiceNormalize(value).split(' ').filter(Boolean);}
const keyTokens=value=>tokens(value).filter(t=>!STOP.has(t)).map(singular);

export function levenshtein(a,b){
  a=String(a||'');b=String(b||'');if(a===b)return 0;if(!a)return b.length;if(!b)return a.length;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const cur=[i];for(let j=1;j<=b.length;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur;}
  return prev[b.length];
}
// Égalité tolérante aux erreurs de reconnaissance : une lettre dès 5 caractères, deux dès 9.
export function tokenMatch(a,b){
  if(a===b)return true;if(/\d/.test(a)||/\d/.test(b))return false;
  const len=Math.min(a.length,b.length);if(len<5)return false;
  return levenshtein(a,b)<=(len>=9?2:1);
}
function findSequence(haystack,needle){
  const hits=[];if(!needle.length)return hits;
  for(let i=0;i+needle.length<=haystack.length;i++)if(needle.every((t,k)=>tokenMatch(haystack[i+k],t)))hits.push([i,i+needle.length]);
  return hits;
}

// ---------- Parcelles ----------
export function matchParcels(text,state){
  const parcels=active(state,'parcelles'),words=keyTokens(text),found=[];
  for(const parcel of parcels){const name=keyTokens(parcel.nom);if(!name.length)continue;for(const span of findSequence(words,name))found.push({parcel,span});}
  // Une correspondance contenue dans une plus longue est écartée (« Grande Terre » dans « Grande Terre Nord »).
  const kept=found.filter(a=>!found.some(b=>b!==a&&b.span[0]<=a.span[0]&&b.span[1]>=a.span[1]&&(b.span[1]-b.span[0])>(a.span[1]-a.span[0])));
  const groups=[];
  for(const hit of kept){const same=groups.find(g=>g.span[0]===hit.span[0]&&g.span[1]===hit.span[1]);if(same){if(!same.parcels.includes(hit.parcel))same.parcels.push(hit.parcel);}else groups.push({span:hit.span,parcels:[hit.parcel]});}
  groups.sort((a,b)=>a.span[0]-b.span[0]);
  if(groups.length){
    const selected=[],ambiguous=[];
    for(const g of groups){if(g.parcels.length===1){if(!selected.includes(g.parcels[0]))selected.push(g.parcels[0]);}else ambiguous.push(g.parcels);}
    return {selected,ambiguous,probable:false};
  }
  // Aucun nom complet : un mot distinctif commun (≥ 4 lettres) donne une parcelle probable ou un choix.
  const generic=new Set(['parcelle','champ','terre','pre','prairie','grand','grande','petit','petite','haut','bas','nord','sud','est','ouest','pres']);
  const partial=parcels.filter(p=>keyTokens(p.nom).some(t=>t.length>=4&&!generic.has(t)&&words.some(w=>tokenMatch(w,t))));
  if(partial.length===1)return {selected:partial,ambiguous:[],probable:true};
  if(partial.length>1&&partial.length<=6)return {selected:[],ambiguous:[partial],probable:true};
  // Un mot générique (« le pré ») ne choisit jamais seul : il propose les parcelles concernées.
  const loose=parcels.filter(p=>keyTokens(p.nom).some(t=>t.length>=3&&words.includes(t)));
  if(loose.length>1&&loose.length<=6)return {selected:[],ambiguous:[loose],probable:true};
  return {selected:[],ambiguous:[],probable:false};
}

// ---------- Types de travaux ----------
function baseType(norm){return BASE_WORK_TYPES.find(([,pattern])=>pattern.test(norm))?.[0]||'';}
function canonicalTokens(norm){
  // Les verbes deviennent le nom du type : « semé » → « semis », pour comparer avec l'historique.
  return norm.split(' ').filter(Boolean).map(word=>{const hit=BASE_WORK_TYPES.find(([,p])=>p.test(word));return hit?voiceNormalize(hit[0]):word;}).filter(t=>!STOP.has(t)).map(singular);
}
export function knownWorkTypes(state){
  const rows=[...active(state,'interventions')].sort((a,b)=>(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0)).map(w=>w.type);
  const tpl=active(state,'templates').flatMap(t=>[t.type,t.name]);
  const seen=new Set(),out=[];
  for(const value of [...rows,...tpl]){const label=String(value||'').trim();const key=voiceNormalize(label);if(!label||seen.has(key))continue;seen.add(key);out.push(label);}
  return out;
}
export function matchWorkType(text,state){
  const norm=voiceNormalize(text),words=canonicalTokens(norm),base=baseType(norm),known=knownWorkTypes(state);
  let best=[],bestScore=0;
  for(const label of known){
    const need=canonicalTokens(voiceNormalize(label));if(!need.length)continue;
    if(!need.every(t=>words.some(w=>tokenMatch(w,t))))continue;
    if(need.length>bestScore){bestScore=need.length;best=[label];}else if(need.length===bestScore)best.push(label);
  }
  if(best.length===1)return {type:best[0],source:'history',candidates:[]};
  if(best.length>1)return {type:'',source:'history',candidates:best.slice(0,6)};
  if(base){
    const key=voiceNormalize(base),related=known.filter(label=>voiceNormalize(label)!==key&&canonicalTokens(voiceNormalize(label))[0]===singular(key));
    return {type:base,source:'base',candidates:related.length?[base,...related].slice(0,6):[]};
  }
  return {type:'',source:'',candidates:known.slice(0,6)};
}

// ---------- Produits du stock ----------
export function matchProducts(text,state){
  const words=keyTokens(text),rows=[];
  const items=[...active(state,'stockItems').map(item=>({id:item.id,name:item.name,unit:item.unit,kind:'stock'})),...active(state,'products').map(p=>({id:p.id,name:p.name||p.nom,unit:p.unit,kind:'product'}))];
  for(const item of items){
    const name=keyTokens(item.name).filter(t=>/[a-z]/.test(t));if(!name.length)continue;
    if(!words.some(w=>tokenMatch(w,name[0])))continue;
    const score=name.filter(t=>words.some(w=>tokenMatch(w,t))).length+(item.kind==='stock'?0.5:0);
    rows.push({...item,score});
  }
  rows.sort((a,b)=>b.score-a.score);
  if(!rows.length)return {product:null,candidates:[]};
  const top=rows.filter(r=>r.score===rows[0].score);
  return top.length===1?{product:top[0],candidates:[]}:{product:null,candidates:top.slice(0,6)};
}

// ---------- Dates ----------
const pad=n=>String(n).padStart(2,'0');
const dayIso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const shift=(base,days)=>{const d=new Date(base);d.setHours(12,0,0,0);d.setDate(d.getDate()+days);return d;};
const FUTURE=/\b(demain|apres demain|prochaine?|planifie\w*|prevoir|prevu\w*|il faut|faudra|a faire|je vais|on va|va falloir|penser a)\b/;
const PAST=/\b(j ai|on a|nous avons|fini|finie|termine\w*|hier|avant hier|ce matin|fait|faite)\b/;
export function parseRelativeDate(text,now=new Date()){
  const norm=voiceNormalize(text),future=FUTURE.test(norm),base=new Date(now);base.setHours(12,0,0,0);
  if(/\bavant hier\b/.test(norm))return {date:dayIso(shift(base,-2)),label:'avant-hier',recognized:true};
  if(/\bapres demain\b/.test(norm))return {date:dayIso(shift(base,2)),label:'après-demain',recognized:true};
  if(/\bhier\b/.test(norm))return {date:dayIso(shift(base,-1)),label:'hier',recognized:true};
  if(/\bdemain\b/.test(norm))return {date:dayIso(shift(base,1)),label:'demain',recognized:true};
  const explicit=norm.match(/\b(?:le\s+)?(\d{1,2}|1er|premier)\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/);
  if(explicit){
    const day=/^\d/.test(explicit[1])?parseInt(explicit[1],10):1,month=MONTHS.indexOf(explicit[2]);
    let d=new Date(base.getFullYear(),month,day,12);if(d.getMonth()!==month)return {date:dayIso(base),label:'aujourd’hui',recognized:false};
    // Sans année : la date passée la plus proche, sauf intention future.
    if(!future&&d>base&&(d-base)>864e5*31)d=new Date(base.getFullYear()-1,month,day,12);
    if(future&&d<base&&(base-d)>864e5*31)d=new Date(base.getFullYear()+1,month,day,12);
    return {date:dayIso(d),label:`le ${day===1?'1er':day} ${explicit[2]==='aout'?'août':explicit[2]==='fevrier'?'février':explicit[2]==='decembre'?'décembre':explicit[2]}`,recognized:true};
  }
  const weekday=WEEKDAYS.findIndex(name=>new RegExp(`\\b${name}\\b`).test(norm));
  if(weekday>=0){
    const today=base.getDay();let diff=weekday-today;
    if(future||new RegExp(`\\b${WEEKDAYS[weekday]}\\s+prochain\\b`).test(norm)){if(diff<=0)diff+=7;}
    else if(diff>0)diff-=7;
    return {date:dayIso(shift(base,diff)),label:diff===0?'aujourd’hui':`${diff<0?'':''}${WEEKDAYS[weekday]}${diff>0?' prochain':diff<0?' dernier':''}`,recognized:true};
  }
  if(/\bce matin\b/.test(norm))return {date:dayIso(base),label:'ce matin',recognized:true};
  if(/\bcet apres midi\b/.test(norm))return {date:dayIso(base),label:'cet après-midi',recognized:true};
  if(/\bce soir\b/.test(norm))return {date:dayIso(base),label:'ce soir',recognized:true};
  if(/\baujourd hui\b/.test(norm))return {date:dayIso(base),label:'aujourd’hui',recognized:true};
  return {date:dayIso(base),label:'aujourd’hui',recognized:false};
}

// ---------- Quantités ----------
const UNIT_OF=word=>/^(kilo|kg)/.test(word)?'kg':/^(litre|l$)/.test(word)?'L':/^(tonne|t$)/.test(word)?'t':/^sac/.test(word)?'sac':/^big/.test(word)?'big bag':/^unit/.test(word)?'unité':'';
function doseMatch(norm){
  const m=norm.match(/(\d+(?:\.\d+)?)\s*(kilos?|kilogrammes?|kg|litres?|l|tonnes?|t|unites?|graines?)\s*(?:par|a l|l|de l)?\s*(?:hectares?|ha)\b/);
  if(!m)return null;const unit=UNIT_OF(m[2])||(/^graine/.test(m[2])?'graines':'');
  return {value:Number(m[1]),unit:unit==='kg'?'kg/ha':unit==='L'?'L/ha':unit==='t'?'t/ha':unit==='graines'?'graines/ha':'unité/ha',index:m.index,length:m[0].length};
}
function surfaceMatch(norm,dose){
  const text=dose?norm.slice(0,dose.index)+' '.repeat(dose.length)+norm.slice(dose.index+dose.length):norm;
  const m=text.match(/(\d+(?:\.\d+)?)\s*(hectares?|ha)\b/);return m?Number(m[1]):null;
}
function quantityMatch(norm){
  const m=norm.match(/(\d+(?:\.\d+)?)\s*(tonnes?|t|kilos?|kilogrammes?|kg|litres?|l|sacs?|big ?bags?|unites?)\b(?!\s*(?:par|a l)?\s*(?:hectares?|ha)\b)/);
  return m?{quantity:Number(m[1]),unit:UNIT_OF(m[2].replace(' ',''))}:null;
}
export function convertQuantity(quantity,from,to){
  const f=String(from||'').toLowerCase(),t=String(to||'').trim().toLowerCase();if(!Number.isFinite(quantity))return null;
  if(!t||f===t||(f==='l'&&/^l(itres?)?$/.test(t)))return quantity;
  const table={'t>kg':1000,'kg>t':0.001,'t>tonne':1,'t>tonnes':1,'kg>kilo':1,'kg>kilos':1};
  return table[`${f}>${t}`]!==undefined?Math.round(quantity*table[`${f}>${t}`]*1000)/1000:null;
}

// ---------- Pâturage ----------
const GENERIC_ANIMALS=new Set(['animal','animau','bete','troupeau','lot']);
function animalWord(words){
  const find=generic=>{for(const [i,w] of words.entries()){const s=singular(w);const hit=ANIMALS.find(([key])=>GENERIC_ANIMALS.has(key)===generic&&(s===key||s.startsWith(key)));if(hit)return {index:i,word:w,stem:hit[0],kind:hit[1]};}return null;};
  return find(false)||find(true);
}
function grazingIntent(norm,words,state,parcels,date){
  const animal=animalWord(words);if(!animal)return null;
  const exit=/\b(sorti\w*|rentre\w*|retire\w*|enleve\w*)\b/.test(norm),entry=/\b(mis|mise|mises|mettre|mets|lache\w*|entre\w*|monte\w*|conduit\w*|amene\w*|passe\w*|deplace\w*|bouge\w*)\b/.test(norm);
  if(!exit&&!entry)return null;
  const before=words[animal.index-1],count=before&&/^\d+$/.test(before)?parseInt(before,10):null;
  const lotWord=GENERIC_ANIMALS.has(animal.stem)?'':animal.word;
  // Lots au pré à cette date, filtrés par parcelle citée puis par le mot (« génisses ») ou l'espèce.
  const current=active(state,'grazingSessions').filter(s=>grazingStatus(s,{date})==='current');
  const descriptor=[animal.stem,...words.slice(animal.index+1,animal.index+3).filter(w=>!STOP.has(w))].map(singular);
  const scoreOf=s=>{const hay=keyTokens(`${s.note||''} ${grazingType(s)} ${s.name||''}`);let score=0;for(const t of descriptor)if(hay.some(h=>h.startsWith(t)||tokenMatch(h,t)))score+=2;if(animal.kind&&grazingType(s)===animal.kind)score+=1;return score;};
  const ranked=current.map(s=>({session:s,score:scoreOf(s)})).filter(r=>r.score>0||!animal.kind).sort((a,b)=>b.score-a.score);
  const top=ranked.length?ranked.filter(r=>r.score===ranked[0].score).map(r=>r.session):[];
  if(exit){
    const scoped=parcels.length?current.filter(s=>parcels.some(p=>p.id===s.parcelId)):[];
    const candidates=scoped.length?scoped:top;
    return {intent:'grazing-exit',sessions:candidates.slice(0,6),animal:animal.word,count};
  }
  const target=parcels[0]||null,moving=top.filter(s=>!target||s.parcelId!==target.id);
  return {intent:moving.length&&/\b(passe\w*|deplace\w*|bouge\w*|change\w*)\b/.test(norm)?'grazing-move':'grazing-entry',sessions:moving.slice(0,6),animal:animal.word,lot:lotWord,count,animalType:animal.kind,parcelId:target?.id||''};
}

// ---------- Analyse complète ----------
export function parseVoiceEntry(text,state,{now=new Date()}={}){
  const raw=String(text||'').trim(),norm=numberWords(voiceNormalize(raw)),words=norm.split(' ').filter(Boolean);
  const when=parseRelativeDate(raw,now),parcelMatch=matchParcels(norm,state),products=matchProducts(norm,state);
  const futureIntent=FUTURE.test(norm)||when.date>dayIso(now),pastIntent=PAST.test(norm)||when.date<dayIso(now);
  const status=futureIntent?'À faire':pastIntent?'Terminé':'Terminé';
  const recognized=new Set();if(when.recognized)recognized.add('date');
  const base={text:raw,date:when.date,dateLabel:when.label,parcels:parcelMatch.selected,parcelChoices:parcelMatch.ambiguous,parcelProbable:parcelMatch.probable,recognized,status};
  if(parcelMatch.selected.length)recognized.add('parcels');
  // Réception de stock : « j'ai reçu 2 t d'urée ».
  if(/\b(recu\w*|livre\w*|livraison|achete\w*|rentre\w* en stock|commande arrivee)\b/.test(norm)){
    const qty=quantityMatch(norm);
    if(qty&&(products.product||products.candidates.length)){
      const item=products.product&&products.product.kind==='stock'?products.product:null;
      const stockItem=item?active(state,'stockItems').find(s=>s.id===item.id):null;
      const converted=stockItem?convertQuantity(qty.quantity,qty.unit,stockItem.unit):null;
      recognized.add('product');recognized.add('quantity');
      return {...base,intent:'stock',product:products.product,productChoices:products.candidates.filter(c=>c.kind==='stock'),quantity:qty.quantity,unit:qty.unit,stockItemId:stockItem?.id||'',stockQuantity:converted,unitOk:converted!==null};
    }
  }
  const grazing=grazingIntent(norm,words,state,parcelMatch.selected,when.date);
  if(grazing){
    // Le mot tel qu'il a été dit (« génisses » et non « genisses »).
    const original=word=>raw.split(/[\s’',.;:!?]+/).find(w=>voiceNormalize(w)===word)||word;
    grazing.animal=original(grazing.animal);if(grazing.lot)grazing.lot=original(grazing.lot);if(grazing.sessions?.length===1)recognized.add('lot');return {...base,...grazing};}
  const type=matchWorkType(norm,state),dose=doseMatch(norm),surface=surfaceMatch(norm,dose);
  if(type.type)recognized.add('type');if(dose)recognized.add('dose');if(surface!==null)recognized.add('surface');if(products.product)recognized.add('product');
  const equipment=active(state,'materiels').filter(m=>[m.nom,m.brand,m.model].some(v=>voiceNormalize(v).length>2&&new RegExp(`\\b${voiceNormalize(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`).test(norm)));
  if(equipment.length===1)recognized.add('equipment');
  const times=[...norm.matchAll(/\b(\d{1,2})\s*(?:heures?|h)\s*(\d{1,2})?\b/g)].map(m=>({h:Number(m[1]),m:Number(m[2]||0)})).filter(t=>t.h<24&&t.m<60).map(t=>`${pad(t.h)}:${pad(t.m)}`);
  if(times.length)recognized.add('time');
  const cultures=[...new Set([...active(state,'parcelles').map(p=>p.culture),...active(state,'templates').map(t=>t.culture),'Blé','Maïs','Orge','Colza','Tournesol','Soja','Triticale','Luzerne','Prairie'].filter(Boolean))];
  const culture=cultures.find(c=>{const first=keyTokens(c)[0];return first&&new RegExp(`\\b(en|de|du|des|le|la)\\s+${first}s?\\b`).test(norm);})||'';
  if(culture)recognized.add('culture');
  if(/\b(fini|finie|termine\w*)\b/.test(norm))recognized.add('status');
  return {...base,intent:'work',type:type.type,typeSource:type.source,typeChoices:type.candidates,culture,dose:dose?.value??null,doseUnit:dose?.unit||'',surfaceWorked:surface,product:products.product,productChoices:products.candidates,equipmentId:equipment.length===1?equipment[0].id:'',equipmentChoices:equipment.length>1?equipment:[],startTime:times[0]||'',endTime:times[1]||''};
}

// Un brouillon de travail par parcelle (« les Grandes Terres et le Pré du Bas » → deux travaux).
export function workDraftsFromEntry(entry,{parcelIds=null,type=null,status=null,date=null}={}){
  const ids=parcelIds||entry.parcels.map(p=>p.id),finalStatus=status||entry.status,day=date||entry.date;
  return ids.map(parcelId=>({
    parcelId,type:type??entry.type,status:finalStatus,date:day,plannedDate:finalStatus==='Terminé'?'':day,
    culture:entry.culture||'',product:entry.product?.name||'',dose:entry.dose??'',doseUnit:entry.doseUnit||'',
    surfaceWorked:ids.length===1&&entry.surfaceWorked!==null?entry.surfaceWorked:undefined,
    equipmentId:entry.equipmentId||'',startTime:entry.startTime||'',endTime:entry.endTime||'',
    note:`Dicté : « ${entry.text} »`
  }));
}

const joinNames=names=>names.length<=1?(names[0]||''):`${names.slice(0,-1).join(', ')} et ${names[names.length-1]}`;
const fmt=value=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(Number(value)||0);
export function confirmationSentence(entry,{type,parcels,status,lot}={}){
  const when=entry.dateLabel&&entry.dateLabel!=='aujourd’hui'?`, ${entry.dateLabel}`:'';
  const de=name=>/^[aeiouyhéèêàâîôû]/i.test(name)?`d’${name}`:`de ${name}`;
  if(entry.intent==='stock'){const name=entry.product?.name||'ce produit';return `Entrée de ${fmt(entry.quantity)} ${entry.unit} ${de(name)}${when}, je l’enregistre ?`;}
  if(entry.intent==='grazing-exit')return `${lot?`Sortie du lot « ${lot} »`:voiceNormalize(entry.animal)==='lot'?'Sortie du lot':`Sortie des ${entry.animal}`}${when}, je l’enregistre ?`;
  if(entry.intent==='grazing-entry'||entry.intent==='grazing-move')return `${entry.intent==='grazing-move'?'Déplacement':'Mise au pré'} des ${entry.animal}${(parcels||entry.parcels)?.length?` sur ${joinNames((parcels||entry.parcels).map(p=>p.nom))}`:''}${when}, je l’enregistre ?`;
  const label=type??entry.type??'Travail',cultureText=entry.culture&&!voiceNormalize(label).includes(voiceNormalize(entry.culture).split(' ')[0])?` de ${entry.culture.toLocaleLowerCase('fr')}`:'';
  const names=(parcels||entry.parcels).map(p=>p.nom);
  const dose=entry.dose!==null&&entry.dose!==undefined&&entry.dose!==''?`, ${fmt(entry.dose)} ${entry.doseUnit}`:'';
  const product=entry.product?.name?` avec ${entry.product.name}`:'';
  const planned=(status||entry.status)==='À faire'?' à faire':'';
  return `${label||'Travail'}${cultureText}${product}${names.length?` sur ${joinNames(names)}`:''}${dose}${when}${planned}, je l’enregistre ?`;
}

// ---------- Mémos audio ----------
export function pickAudioMime(isSupported){
  if(typeof isSupported!=='function')return '';
  for(const type of AUDIO_TYPES){try{if(isSupported(type))return type;}catch{}}
  return '';
}
export function audioExtension(mime){const m=String(mime||'');return m.includes('mp4')||m.includes('aac')?'m4a':m.includes('ogg')?'ogg':'webm';}
export function formatClock(ms){const s=Math.max(0,Math.round((Number(ms)||0)/1000));return `${Math.floor(s/60)}:${pad(s%60)}`;}
export function isVoiceMemo(doc){return Boolean(doc&&!doc.deletedAt&&doc.voiceMemo&&typeof doc.voiceMemo==='object');}
export function pendingMemos(state){
  return active(state,'documents').filter(d=>isVoiceMemo(d)&&d.voiceMemo.status!=='done').sort((a,b)=>(Number(b.voiceMemo.recordedAt)||0)-(Number(a.voiceMemo.recordedAt)||0));
}
export function memoDocument({id,mimeType,size,durationMs,recordedAt,parcelId=null,position=null,transcript=''}){
  const d=new Date(recordedAt),stamp=`${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}h${pad(d.getMinutes())}`;
  const memo={status:'pending',durationMs:Math.round(Number(durationMs)||0),recordedAt};
  if(transcript)memo.transcript=String(transcript);
  if(position&&Number.isFinite(Number(position.latitude))&&Number.isFinite(Number(position.longitude))){memo.latitude=Math.round(Number(position.latitude)*1e5)/1e5;memo.longitude=Math.round(Number(position.longitude)*1e5)/1e5;if(Number.isFinite(Number(position.accuracy)))memo.accuracy=Math.round(Number(position.accuracy));}
  return {id,name:`Mémo vocal ${stamp}.${audioExtension(mimeType)}`,mimeType:mimeType||'audio/webm',size:Number(size)||0,category:'Autre',tags:[MEMO_TAG],documentDate:dayIso(d),parcelId,note:transcript?String(transcript):'',voiceMemo:memo};
}
export function memoSummaryLabel(count){return count===0?'Aucun mémo à traiter':`${count} mémo${count>1?'s':''} à traiter`;}
export {grazingTotal,grazingType,grazingDate};
