// Saisie vocale de bout en bout et mémos audio (idées n° 10 et 99).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {audioExtension, confirmationSentence, convertQuantity, formatClock, isVoiceMemo, levenshtein, matchParcels, memoDocument, memoSummaryLabel, parseRelativeDate, parseVoiceEntry, pendingMemos, pickAudioMime, voiceNormalize, workDraftsFromEntry} from './voice-notes.js';

const NOW=new Date('2026-10-07T10:00:00'); // mercredi
const state=()=>({
  parcelles:[{id:'p1',nom:'Les Grandes Terres',surfaceHa:10,culture:'Maïs grain'},{id:'p2',nom:'Le Pré du Bas',surfaceHa:4},{id:'p3',nom:'Pré Haut',surfaceHa:3},{id:'p4',nom:'Grande Terre Nord',surfaceHa:6},{id:'px',nom:'Ancienne',deletedAt:1}],
  interventions:[{id:'w1',type:'Semis maïs',parcelId:'p1',updatedAt:3},{id:'w2',type:'Semis blé',updatedAt:2},{id:'w3',type:'Fauche',updatedAt:1}],
  templates:[{id:'t1',name:'Fanage rapide',type:'Fanage'}],
  stockItems:[{id:'s1',name:'Urée 46',unit:'kg',quantity:100},{id:'s2',name:'Ammonitrate',unit:'kg',quantity:0},{id:'s3',name:'Semences maïs',unit:'sac'}],
  products:[],materiels:[{id:'m1',nom:'Fendt'}],
  grazingSessions:[{id:'g1',parcelId:'p2',animalType:'Bovins',note:'Génisses',startDate:'2026-09-01',additionalAnimalsCount:12,animals:[]},{id:'g2',parcelId:'p3',animalType:'Ovins',note:'Brebis',startDate:'2026-09-10',endDate:'2026-09-20',additionalAnimalsCount:30,animals:[]}],
  documents:[]
});
const parse=text=>parseVoiceEntry(text,state(),{now:NOW});

test('normalisation : accents retirés, décimales conservées',()=>{
  assert.equal(voiceNormalize('J’ai épandu 32,5 kg/ha d’urée.'),'j ai epandu 32.5 kg ha d uree');
  assert.equal(levenshtein('genisse','genise'),1);
});

test('travail complet : type de l’historique, parcelle, dose, matériel',()=>{
  const e=parse('J’ai semé du maïs sur les Grandes Terres à 32 kg/ha avec le Fendt');
  assert.equal(e.intent,'work');assert.equal(e.type,'Semis maïs');assert.equal(e.typeSource,'history');
  assert.deepEqual(e.parcels.map(p=>p.id),['p1']);assert.equal(e.dose,32);assert.equal(e.doseUnit,'kg/ha');
  assert.equal(e.equipmentId,'m1');assert.equal(e.status,'Terminé');
  assert.ok(['type','parcels','dose','equipment'].every(k=>e.recognized.has(k)));
});

test('plusieurs parcelles → un brouillon par parcelle, date relative « hier »',()=>{
  const e=parse('Hier fauche des Grandes Terres et du Pré du Bas');
  assert.equal(e.type,'Fauche');assert.equal(e.date,'2026-10-06');assert.equal(e.dateLabel,'hier');
  assert.deepEqual(e.parcels.map(p=>p.id),['p1','p2']);
  const drafts=workDraftsFromEntry(e);
  assert.equal(drafts.length,2);assert.ok(drafts.every(d=>d.status==='Terminé'&&d.date==='2026-10-06'&&d.plannedDate===''));
  assert.equal(drafts[0].surfaceWorked,undefined,'la surface partielle ne s’applique pas à plusieurs parcelles');
});

test('le nom le plus long l’emporte et un nom générique propose un choix',()=>{
  assert.deepEqual(matchParcels('labour grande terre nord',state()).selected.map(p=>p.id),['p4']);
  const loose=parse('semis sur le pré');
  assert.equal(loose.parcels.length,0);assert.deepEqual(loose.parcelChoices[0].map(p=>p.id).sort(),['p2','p3']);
  assert.deepEqual(loose.typeChoices,['Semis','Semis maïs','Semis blé']);
});

test('produit du stock (correspondance floue), dose et surface partielle',()=>{
  const e=parse('lundi épandage d’amonitrate 150 kilos par hectare sur 3,5 ha des grandes terres');
  assert.equal(e.type,'Fertilisation');assert.equal(e.product.id,'s2');
  assert.equal(e.dose,150);assert.equal(e.surfaceWorked,3.5);assert.equal(e.date,'2026-10-05');
  const [draft]=workDraftsFromEntry(e);assert.equal(draft.surfaceWorked,3.5);assert.equal(draft.product,'Ammonitrate');
});

test('dates relatives : avant-hier, jour de semaine passé ou futur, date explicite',()=>{
  assert.equal(parseRelativeDate('avant-hier',NOW).date,'2026-10-05');
  assert.equal(parseRelativeDate('vendredi j’ai fauché',NOW).date,'2026-10-02');
  assert.equal(parseRelativeDate('il faut traiter vendredi',NOW).date,'2026-10-09');
  assert.equal(parseRelativeDate('ce matin',NOW).date,'2026-10-07');
  assert.equal(parseRelativeDate('le 3 octobre',NOW).date,'2026-10-03');
  assert.equal(parseRelativeDate('rien',NOW).recognized,false);
});

test('intention future → travail à faire, échéance dans plannedDate',()=>{
  const e=parse('demain labour grande terre nord');
  assert.equal(e.status,'À faire');assert.equal(e.date,'2026-10-08');
  const [draft]=workDraftsFromEntry(e);assert.equal(draft.plannedDate,'2026-10-08');
});

test('réception de stock : conversion t → kg, unité incompatible signalée',()=>{
  const e=parse('j’ai reçu 2 tonnes d’urée');
  assert.equal(e.intent,'stock');assert.equal(e.stockItemId,'s1');assert.equal(e.stockQuantity,2000);assert.ok(e.unitOk);
  assert.equal(confirmationSentence(e),'Entrée de 2 t d’Urée 46, je l’enregistre ?');
  const bad=parse('on a reçu 3 tonnes de semences de maïs');
  assert.equal(bad.intent,'stock');assert.equal(bad.unitOk,false);
  assert.equal(convertQuantity(1.5,'t','kg'),1500);assert.equal(convertQuantity(2,'kg','sac'),null);
});

test('pâturage : sortie d’un lot au pré, mise au pré avec effectif',()=>{
  const exit=parse('j’ai sorti le lot des génisses');
  assert.equal(exit.intent,'grazing-exit');assert.deepEqual(exit.sessions.map(s=>s.id),['g1']);
  assert.equal(confirmationSentence(exit),'Sortie des génisses, je l’enregistre ?');
  const entry=parse('j’ai mis 15 brebis au pré haut');
  assert.equal(entry.intent,'grazing-entry');assert.equal(entry.count,15);assert.equal(entry.animalType,'Ovins');assert.equal(entry.parcels[0].id,'p3');
  assert.equal(entry.sessions.length,0,'le lot de brebis sorti le 20/09 n’est plus au pré');
});

test('phrase de confirmation lisible',()=>{
  const e=parse('j’ai semé du maïs sur les Grandes Terres à 32 kg/ha');
  assert.equal(confirmationSentence(e),'Semis maïs sur Les Grandes Terres, 32 kg/ha, je l’enregistre ?');
  assert.equal(confirmationSentence(parse('il faut traiter le pré haut')),'Pulvérisation sur Pré Haut à faire, je l’enregistre ?');
});

test('mémo audio : document facultatif, sans tableau imbriqué, rangé « à traiter »',()=>{
  const doc=memoDocument({id:'memo_1',mimeType:'audio/webm;codecs=opus',size:2048,durationMs:42400,recordedAt:new Date('2026-10-07T14:32:00').getTime(),parcelId:'p1',position:{latitude:46.123456789,longitude:5.987654321,accuracy:7.6}});
  assert.equal(doc.name,'Mémo vocal 07/10 14h32.webm');assert.equal(doc.category,'Autre');assert.deepEqual(doc.tags,['Mémo vocal']);
  assert.equal(doc.voiceMemo.status,'pending');assert.equal(doc.voiceMemo.latitude,46.12346);assert.equal(doc.voiceMemo.accuracy,8);
  assert.ok(!JSON.stringify(doc).includes('[['));
  const s=state();s.documents=[doc,{id:'d2',name:'Facture'},{...doc,id:'memo_2',voiceMemo:{...doc.voiceMemo,status:'done'}},{...doc,id:'memo_3',deletedAt:1}];
  assert.deepEqual(pendingMemos(s).map(d=>d.id),['memo_1']);assert.ok(isVoiceMemo(doc));assert.ok(!isVoiceMemo(s.documents[1]));
  assert.equal(memoSummaryLabel(0),'Aucun mémo à traiter');assert.equal(memoSummaryLabel(1),'1 mémo à traiter');assert.equal(memoSummaryLabel(3),'3 mémos à traiter');
});

test('format audio : premier type pris en charge, extension et durée',()=>{
  assert.equal(pickAudioMime(type=>type==='audio/mp4'),'audio/mp4');assert.equal(pickAudioMime(()=>false),'');assert.equal(pickAudioMime(null),'');
  assert.equal(audioExtension('audio/mp4'),'m4a');assert.equal(audioExtension('audio/webm;codecs=opus'),'webm');
  assert.equal(formatClock(125000),'2:05');
});

test('branchements : service worker, diagnostic, app.js',()=>{
  const sw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8'),runtime=fs.readFileSync(new URL('./runtime.js',import.meta.url),'utf8'),app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
  for(const file of ['./voice-notes.js','./voice-notes-ui.js']){assert.ok(sw.includes(`'${file}'`));assert.ok(runtime.includes(`'${file}'`));}
  assert.match(app,/voiceNotes\(\)\.mountFab\(\)/);assert.match(app,/voiceNotesUI\?\.renderHome\(\)/);assert.match(app,/startsWith\('audio\/'\)/);
});
