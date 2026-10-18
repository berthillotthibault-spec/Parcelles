// Grammaire vocale enrichie (idée n° 13) : une cinquantaine de phrases dictées sur le terrain.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MAINTENANCE_TYPES, aliasList, formatAliases, maintenanceRecordType, matchEquipment, meterReading, parseAliases, workedHours, wordsToNumbers} from './voice-grammar.js';
import {confirmationSentence, loadVoiceGrammar, parseRelativeDate, parseVoiceEntry, voiceGrammarReady, voiceNormalize} from './voice-notes.js';

const NOW=new Date('2026-10-07T10:00:00'); // mercredi
const state=()=>({
  parcelles:[
    {id:'p1',nom:'Les Grandes Terres',surfaceHa:10,culture:'Maïs grain',aliases:['le grand champ']},
    {id:'p2',nom:'Le Pré du Bas',surfaceHa:4,aliases:'la mare, pré de la mare'},
    {id:'p3',nom:'Pré Haut',surfaceHa:3},
    {id:'p4',nom:'La Garenne',surfaceHa:6,culture:'Colza'},
    {id:'p5',nom:'Champ du Moulin',surfaceHa:8,culture:'Blé tendre',aliases:['chez Bernard']}
  ],
  interventions:[{id:'w1',type:'Semis maïs',parcelId:'p1',updatedAt:3},{id:'w2',type:'Fauche',updatedAt:2}],
  templates:[],
  stockItems:[{id:'s1',name:'Urée 46',unit:'kg',quantity:2000},{id:'s2',name:'Semences maïs',unit:'sac',quantity:40},{id:'s3',name:'GNR',unit:'L',quantity:1500},{id:'s4',name:'Ammonitrate 27',unit:'t',quantity:5}],
  products:[],
  materiels:[
    {id:'m1',nom:'Fendt 724',brand:'Fendt',model:'724 Vario',currentMeter:4400,aliases:['le gros']},
    {id:'m2',nom:'John Deere 6155R',brand:'John Deere',model:'6155R',currentMeter:2100,aliases:['le vert']},
    {id:'m3',nom:'Mini-pelle Kubota',brand:'Kubota',model:'KX027',currentMeter:830,aliases:['la petite pelle']},
    {id:'m4',nom:'Télescopique Manitou',brand:'Manitou',model:'MLT 635'}
  ],
  grazingSessions:[{id:'g1',parcelId:'p2',animalType:'Bovins',note:'Génisses',startDate:'2026-09-01',additionalAnimalsCount:12,animals:[]}],
  clients:[{id:'c1',name:'Mairie de Saint-Aubin'},{id:'c2',name:'Dupont SARL'}],
  chantiers:[
    {id:'tp1',kind:'tp',type:'Fossé route des Écoles',clientId:'c1',status:'En cours',tpLogs:[]},
    {id:'tp2',kind:'tp',type:'Terrassement maison Dupont',clientId:'c2',status:'Planifié',tpLogs:[]},
    {id:'tp3',kind:'tp',type:'Ancien chantier',status:'Terminé',tpLogs:[]}
  ],
  observations:[],documents:[]
});
const parse=text=>parseVoiceEntry(text,state(),{now:NOW});
const ids=list=>(list||[]).map(x=>x.id);
const nums=text=>wordsToNumbers(voiceNormalize(text));
const say=entry=>confirmationSentence(entry,{}).replace(/\s/g,' ');

// voice-grammar.js est chargé à la demande par voice-notes.js : sans lui (échec hors connexion),
// l'analyse de base reste possible mais sans surnoms ni engins ; l'interface attend le chargement.
assert.equal(voiceGrammarReady(),false);
assert.equal(await loadVoiceGrammar(()=>Promise.reject(new Error('hors connexion'))),false);
const basic=parse('J’ai semé le grand champ avec le gros');
assert.deepEqual([basic.intent,basic.type,basic.parcels.length,basic.equipmentId||''],['work','Semis',0,'']);
assert.equal(await loadVoiceGrammar(),true);
assert.equal(voiceGrammarReady(),true);

test('nombres en lettres et milliers séparés par une espace',()=>{
  const cases=[
    ['deux cents kilos','200 kilos'],
    ['quatre mille cinq cent vingt heures','4520 heures'],
    ['4 520 heures','4520 heures'],
    ['soixante-dix litres','70 litres'],
    ['quatre-vingt-dix bottes','90 bottes'],
    ['vingt et un octobre','21 octobre'],
    ['dix-sept génisses','17 genisses'],
    ['deux virgule cinq tonnes','2.5 tonnes'],
    ['deux tonnes et demie','2.5 tonnes'],
    ['mille deux cents litres','1200 litres'],
    ['une heure et demie','1.5 heure'],
    ['trois cent quatre-vingts kilos','380 kilos']
  ];
  for(const [input,expected] of cases)assert.equal(nums(input),expected,input);
  // Les articles et adjectifs restent des mots.
  assert.equal(nums('une vidange du tracteur'),'une vidange du tracteur');
  assert.equal(nums('changé le pneu neuf'),'change le pneu neuf');
  assert.equal(nums('deux trois jours'),'2 3 jours','deux unités de suite ne s’additionnent pas');
});

test('surnoms : liste propre, sans doublon ni vide',()=>{
  assert.deepEqual(aliasList({aliases:['  le grand champ ','Le Grand Champ','',null]}),['le grand champ']);
  assert.deepEqual(parseAliases('la mare ; pré de la mare,\nle bas'),['la mare','pré de la mare','le bas']);
  assert.equal(formatAliases({aliases:['a','b']}),'a, b');
  assert.deepEqual(aliasList({}),[]);
});

test('engins : nom, modèle, surnom et erreur de reconnaissance',()=>{
  const s=state();
  assert.deepEqual(ids(matchEquipment(voiceNormalize('avec le Fendt'),s).selected),['m1']);
  assert.deepEqual(ids(matchEquipment(voiceNormalize('avec le vert'),s).selected),['m2']);
  assert.deepEqual(ids(matchEquipment(voiceNormalize('la petite pelle'),s).selected),['m3']);
  assert.deepEqual(ids(matchEquipment(voiceNormalize('le Manitu'),s).selected),['m4'],'une lettre de travers');
  assert.deepEqual(ids(matchEquipment(voiceNormalize('le Kubotta'),s).selected),['m3']);
  assert.deepEqual(matchEquipment(voiceNormalize('la remorque'),s).selected,[]);
});

test('compteur et durée travaillée',()=>{
  assert.equal(meterReading('vidange 4520 heures'),4520);
  assert.equal(meterReading('compteur a 1250'),1250);
  assert.equal(meterReading('82 h au compteur'),82);
  assert.equal(meterReading('commence a 8 h'),null);
  assert.equal(workedHours('6 heures de pelle'),6);
  assert.equal(workedHours('de 8 h a 12 h 30'),4.5);
  assert.equal(workedHours('7 h 30 de mini pelle'),7.5);
  assert.equal(workedHours('commence a 8 h'),null);
});

test('dates relatives supplémentaires',()=>{
  assert.equal(parseRelativeDate('il y a trois jours',NOW).date,'2026-10-04');
  assert.equal(parseRelativeDate('dans deux semaines',NOW).date,'2026-10-21');
  assert.equal(parseRelativeDate('la semaine dernière',NOW).date,'2026-09-30');
  assert.equal(parseRelativeDate('ce midi',NOW).label,'ce midi');
  assert.equal(parseRelativeDate('le vingt et un septembre',NOW).date,'2026-09-21');
});

// Phrases réelles : [phrase, attendu]. Chaque clé d'attendu est vérifiée sur le brouillon.
const PHRASES=[
  // Travaux (surnoms de parcelles, engins par surnom, nombres en lettres)
  ['J’ai semé le grand champ avec le gros',{intent:'work',type:'Semis',parcels:['p1'],equipmentId:'m1'}],
  ['Fauche chez Bernard hier',{intent:'work',type:'Fauche',parcels:['p5'],date:'2026-10-06'}],
  ['Épandu deux cents kilos d’urée par hectare sur la Garenne',{intent:'work',type:'Fertilisation',parcels:['p4'],dose:200,doseUnit:'kg/ha'}],
  ['Labouré la mare avec le vert ce matin',{intent:'work',type:'Labour',parcels:['p2'],equipmentId:'m2',dateLabel:'ce matin'}],
  ['Traitement fongicide sur le Champ du Moulin, un virgule deux litres par hectare',{intent:'work',type:'Pulvérisation',parcels:['p5'],dose:1.2,doseUnit:'L/ha'}],
  ['Il faudra herser les Grandes Terres demain',{intent:'work',type:'Hersage',parcels:['p1'],status:'À faire',date:'2026-10-08'}],
  // Engin approché (« Fend ») : jamais retenu d'office dans un travail, il reste un choix.
  ['Déchaumage de la Garenne il y a deux jours avec le Fend',{intent:'work',type:'Déchaumage',parcels:['p4'],equipmentId:'',date:'2026-10-05'}],
  ['Semis de blé chez Bernard à cent quatre-vingts kilos hectare',{intent:'work',parcels:['p5'],dose:180}],
  ['Roulage du Pré Haut de huit heures à dix heures',{intent:'work',type:'Roulage',parcels:['p3'],startTime:'08:00',endTime:'10:00'}],
  ['Broyage des Grandes Terres lundi',{intent:'work',type:'Broyage',parcels:['p1'],date:'2026-10-05'}],
  ['Pressé le pré de la mare, quatre-vingt-dix bottes',{intent:'work',type:'Pressage',parcels:['p2']}],
  ['Désherbage de la Garenne avec le John Deere',{intent:'work',type:'Désherbage',parcels:['p4'],equipmentId:'m2'}],
  // Pâturage
  ['J’ai sorti les génisses du Pré du Bas',{intent:'grazing-exit',sessions:['g1']}],
  ['Sorti les génisses de la mare hier soir',{intent:'grazing-exit',sessions:['g1'],date:'2026-10-06'}],
  ['Mis douze génisses au Pré Haut',{intent:'grazing-entry',parcels:['p3'],count:12}],
  ['J’ai passé les génisses au Pré Haut',{intent:'grazing-move',sessions:['g1'],parcels:['p3']}],
  ['Lâché vingt brebis sur le grand champ',{intent:'grazing-entry',parcels:['p1'],count:20}],
  // Entretien et compteur
  ['Vidange tracteur quatre mille cinq cent vingt heures',{intent:'maintenance',opType:'Vidange',meter:4520}],
  ['Vidange du Fendt à 4 520 heures',{intent:'maintenance',opType:'Vidange',equipment:'m1',meter:4520}],
  ['Graissage du vert ce matin',{intent:'maintenance',opType:'Graissage',equipment:'m2'}],
  ['J’ai changé les pneus du Manitou',{intent:'maintenance',opType:'Pneus',equipment:'m4'}],
  ['Plein de GNR du gros, deux cents litres',{intent:'maintenance',opType:'Plein',equipment:'m1',liters:200}],
  ['Fait le plein de la petite pelle, quarante litres',{intent:'maintenance',opType:'Plein',equipment:'m3',liters:40}],
  ['Le John Deere est en panne, compteur à 2 150',{intent:'maintenance',opType:'Panne',equipment:'m2',meter:2150}],
  ['Contrôle technique du Fendt hier, trois cents euros',{intent:'maintenance',opType:'Contrôle technique',equipment:'m1',cost:300,date:'2026-10-06'}],
  ['Changé les filtres du Kubota à huit cent cinquante heures',{intent:'maintenance',equipment:'m3',meter:850}],
  ['Réparé la remorque, soudé la ridelle',{intent:'maintenance',opType:'Réparation'}],
  ['Révision du télescopique',{intent:'maintenance',opType:'Entretien',equipment:'m4'}],
  // Observations
  ['Chardons sur le Champ du Moulin',{intent:'observation',obsType:'Adventices',title:'Chardons',parcels:['p5']}],
  ['J’ai vu des limaces dans la Garenne',{intent:'observation',obsType:'Ravageur',title:'Limaces',parcels:['p4'],severity:'warning'}],
  ['Dégâts de sangliers sur le grand champ, c’est urgent',{intent:'observation',obsType:'Dégâts gibier',parcels:['p1'],severity:'urgent'}],
  ['Il y a de la rouille sur le blé chez Bernard',{intent:'observation',obsType:'Maladie',parcels:['p5']}],
  ['Le maïs est versé aux Grandes Terres',{intent:'observation',obsType:'Verse',parcels:['p1']}],
  ['Clôture cassée au Pré Haut',{intent:'observation',obsType:'Clôture',parcels:['p3']}],
  ['Beaucoup de pucerons sur le colza de la Garenne',{intent:'observation',obsType:'Ravageur',severity:'warning',parcels:['p4']}],
  ['Repéré du rumex sur la mare',{intent:'observation',obsType:'Adventices',title:'Rumex',parcels:['p2']}],
  ['Le drain est bouché au Pré Haut',{intent:'observation',obsType:'Drainage',parcels:['p3']}],
  ['Grêle cette nuit sur le Champ du Moulin',{intent:'observation',obsType:'Grêle',parcels:['p5']}],
  ['Désherbé les chardons de la Garenne',{intent:'work',type:'Désherbage',parcels:['p4']}],
  // Stock
  ['J’ai reçu deux tonnes d’urée',{intent:'stock',stockItemId:'s1',stockQuantity:2000}],
  ['J’ai pris trois sacs de semences maïs',{intent:'stock-out',stockItemId:'s2',stockQuantity:3}],
  ['Sorti deux cents kilos d’urée du hangar',{intent:'stock-out',stockItemId:'s1',stockQuantity:200}],
  ['Utilisé une tonne d’ammonitrate',{intent:'stock-out',stockItemId:'s4',stockQuantity:1}],
  ['Chargé 500 kg d’ammonitrate dans l’épandeur',{intent:'stock-out',stockItemId:'s4',stockQuantity:0.5}],
  // Heures de chantier TP
  ['Six heures de pelle sur le chantier Dupont',{intent:'pw-hours',project:'tp2',hours:6}],
  ['Chantier de la mairie, sept heures trente avec la petite pelle',{intent:'pw-hours',project:'tp1',hours:7.5,equipmentId:'m3'}],
  ['Fossé route des Écoles, douze mètres cubes',{intent:'pw-hours',project:'tp1',volumeM3:12}],
  ['Chantier Dupont de 8 h à 12 h, 15 m³ de terre',{intent:'pw-hours',project:'tp2',hours:4,volumeM3:15}],
  ['Sur le chantier, cinq heures de télescopique',{intent:'pw-hours',project:null,hours:5,equipmentId:'m4'}],
  ['Chantier Dupont, évacué huit tonnes de gravats',{intent:'pw-hours',project:'tp2',tonnage:8}]
];

test(`${PHRASES.length} phrases réelles : intention et champs reconnus`,()=>{
  assert.ok(PHRASES.length>=50);
  for(const [phrase,expected] of PHRASES){
    const e=parse(phrase);
    for(const [key,value] of Object.entries(expected)){
      let actual=e[key];
      if(key==='parcels'||key==='sessions')actual=ids(e[key]);
      if(key==='equipment')actual=e.equipment?.id||null;
      if(key==='project')actual=e.project?.id||null;
      assert.deepEqual(actual,value,`« ${phrase} » → ${key}`);
    }
  }
});

test('phrases de confirmation des nouvelles intentions',()=>{
  assert.equal(say(parse('Vidange du Fendt à 4 520 heures')),'Vidange du Fendt 724 à 4 520 h, je l’enregistre ?');
  assert.equal(say(parse('Chardons sur le Champ du Moulin hier')),'Observation « Chardons » sur Champ du Moulin, hier, je l’enregistre ?');
  assert.equal(say(parse('J’ai pris trois sacs de semences maïs')),'Sortie de 3 sac de Semences maïs, je l’enregistre ?');
  assert.equal(say(parse('Six heures de pelle sur le chantier Dupont')),'6 h sur le chantier « Terrassement maison Dupont », je l’enregistre ?');
  assert.match(say(parse('Plein du gros, deux cents litres de GNR')),/^Plein de 200 L du Fendt 724/);
});

test('relecture : nombres en lettres dans les noms, futur, durées, engin approché, compteur, types',()=>{
  const s=state();
  s.parcelles.push({id:'p6',nom:'Les Trois Chênes'},{id:'p7',nom:'Les Trois Chênes Nord'},{id:'p8',nom:'Pré Cinq'});
  s.materiels.push({id:'m5',nom:'Case Puma',brand:'Case'});
  const p=text=>parseVoiceEntry(text,s,{now:NOW});
  // Les noms de parcelles contenant un nombre en lettres restent reconnus.
  assert.deepEqual(ids(p('J’ai semé les Trois Chênes en blé').parcels),['p6']);
  assert.deepEqual(ids(p('Fauché le pré cinq').parcels),['p8']);
  assert.deepEqual(ids(p('Fauché les trois chênes nord').parcels),['p7']);
  // Futur : un travail « À faire », jamais un entretien ou une observation réalisés.
  const oil=p('Il faudra faire la vidange du Fendt demain');
  assert.equal(oil.intent,'work');assert.equal(oil.status,'À faire');assert.equal(oil.date,'2026-10-08');
  const grease=p('Penser à graisser le tracteur la semaine prochaine');
  assert.notEqual(grease.intent,'maintenance');assert.equal(grease.status,'À faire');
  assert.notEqual(p('Il faudra surveiller les limaces dans la Garenne demain').intent,'observation');
  // Durées : pas d'heure de début.
  assert.equal(p('J’ai broyé les Grandes Terres pendant trois heures').startTime,'');
  assert.equal(p('J’ai broyé les Grandes Terres pendant deux heures et demie').startTime,'');
  assert.equal(p('Trois heures de broyage sur les Grandes Terres').startTime,'');
  assert.equal(p('Labouré les Grandes Terres à 14 h').startTime,'14:00');
  // Mot courant proche d'une marque : aucun engin.
  const soc=p('Labouré les Grandes Terres, le soc a cassé');
  assert.equal(soc.equipmentId,'');assert.ok(!soc.recognized.has('equipment'));
  assert.deepEqual(ids(p('Déchaumage de la Garenne avec le Fend').equipmentChoices),['m1']);
  // Compteur avec l'engin intercalé.
  assert.equal(meterReading(voiceNormalize('compteur du Fendt à 850')),850);
  const meter=p('Compteur du Fendt à 4 600');assert.equal(meter.intent,'maintenance');assert.equal(meter.meter,4600);
  // Types enregistrés : ceux du formulaire de Matériel.
  assert.deepEqual(MAINTENANCE_TYPES,['Vidange','Graissage','Pneus','Contrôle technique','Réparation','Autre']);
  assert.equal(maintenanceRecordType('Plein'),'Autre');assert.equal(maintenanceRecordType('Panne'),'Autre');
  assert.equal(maintenanceRecordType('Entretien'),'Autre');assert.equal(maintenanceRecordType('Vidange'),'Vidange');
});

test('aucune écriture : le brouillon reste un objet, le stock n’est pas modifié',()=>{
  const s=state(),before=JSON.stringify(s);
  for(const [phrase] of PHRASES)parseVoiceEntry(phrase,s,{now:NOW});
  assert.equal(JSON.stringify(s),before);
});

test('branchements : module différé, service worker, test listé',()=>{
  const read=file=>fs.readFileSync(new URL(file,import.meta.url),'utf8');
  const sw=read('./sw.js'),lazy=read('./lazy-modules.js'),pkg=read('./package.json'),ui=read('./voice-notes-ui.js');
  for(const file of ['voice-grammar.js','voice-intents-ui.js'])assert.ok(sw.includes(`'./${file}'`),`${file} dans CORE`);
  assert.match(lazy,/voiceIntents: \(\) => import\('\.\/voice-intents-ui\.js'\)/);
  assert.match(pkg,/test-voice-grammar\.mjs/);
  assert.ok(!/from '\.\/voice-intents-ui\.js'/.test(ui),'l’écran des nouvelles intentions reste chargé à la demande');
  assert.ok(!/from '\.\/voice-grammar\.js'/.test(read('./voice-notes.js')+ui),'la grammaire enrichie reste chargée à la demande');
  assert.match(ui,/loadVoiceGrammar\(\)\.then/,'l’analyse attend la grammaire');
  assert.match(ui,/if\(pending!==analyzeSeq\|\|\(sheet&&!sheet\.isConnected\)\)return;/,'une analyse différée est ignorée si une autre a suivi ou si la saisie est fermée');
  assert.match(ui,/async function openMemo\(id\)\{\s*stopPlayback\(\);loadVoiceGrammar\(\);/,'le mémo précharge la grammaire');
});
