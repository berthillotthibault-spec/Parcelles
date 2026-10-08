import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {CELEBRATION_WINDOW_MS, completeLabel, dayCompletion, leafLayout, pendingIsFresh, shouldBloom} from './celebration.js';
import {haptic, HAPTIC_PATTERNS} from './motion.js';
import {normalizePersonalization} from './personalization.js';

test('progression du bilan bornée et journée bouclée seulement avec au moins un travail',()=>{
  assert.deepEqual(dayCompletion({done:1,total:2}),{done:1,total:2,pct:50,complete:false});
  assert.equal(dayCompletion({done:2,total:2}).complete,true);
  assert.equal(dayCompletion({done:0,total:0}).complete,false);
  assert.equal(dayCompletion({done:0,total:0}).pct,0);
  assert.equal(dayCompletion({done:5,total:2}).pct,100);
  assert.equal(dayCompletion({done:'x',total:undefined}).complete,false);
});

test('libellé « Journée bouclée » accordé et au format français',()=>{
  assert.equal(completeLabel(19.5).replace(/\u202f|\u00a0/g,' '),'Journée bouclée · 19,5 ha travaillés');
  assert.equal(completeLabel(1),'Journée bouclée · 1 ha travaillé');
  assert.equal(completeLabel(0.5),'Journée bouclée · 0,5 ha travaillé');
  assert.equal(completeLabel(0),'Journée bouclée · tout est fait');
  assert.equal(completeLabel(-3),'Journée bouclée · tout est fait');
});

test('l’éclosion ne se joue qu’une fois par jour, après un geste récent sur un travail',()=>{
  const now=1_000_000,today='2026-10-07',pending={kind:'work',at:now-100};
  assert.equal(shouldBloom({complete:true,pending,today,lastCelebrated:'',now}),true);
  assert.equal(shouldBloom({complete:true,pending,today,lastCelebrated:today,now}),false);
  assert.equal(shouldBloom({complete:true,pending,today,lastCelebrated:'2026-10-06',now}),true);
  assert.equal(shouldBloom({complete:false,pending,today,lastCelebrated:'',now}),false);
  assert.equal(shouldBloom({complete:true,pending:null,today,lastCelebrated:'',now}),false);
  assert.equal(shouldBloom({complete:true,pending:{kind:'task',at:now},today,lastCelebrated:'',now}),false);
  assert.equal(shouldBloom({complete:true,pending:{kind:'work',at:now-CELEBRATION_WINDOW_MS-1},today,lastCelebrated:'',now}),false);
  assert.equal(pendingIsFresh({at:now},now),true);assert.equal(pendingIsFresh(null,now),false);
});

test('6 à 8 feuilles, placées de façon déterministe vers le haut',()=>{
  assert.equal(leafLayout().length,7);assert.equal(leafLayout(2).length,6);assert.equal(leafLayout(40).length,8);
  assert.deepEqual(leafLayout(7),leafLayout(7));
  for(const leaf of leafLayout(7))assert.ok(leaf.y<=0,'les feuilles montent');
});

test('haptique : natif d’abord, repli vibrate, coupure par réglage, jamais d’exception',async()=>{
  const calls=[];const nav={vibrate:pattern=>{calls.push(pattern);return true;}};
  assert.equal(await haptic('tick',{nav}),true);assert.deepEqual(calls,[HAPTIC_PATTERNS.tick]);
  assert.equal(await haptic('success',{nav}),true);assert.deepEqual(calls.at(-1),HAPTIC_PATTERNS.success);
  assert.equal(await haptic('tick',{enabled:false,nav}),false);assert.equal(calls.length,2);
  const native={capabilities:{haptics:true},haptic:async style=>{calls.push(`natif:${style}`);return true;}};
  assert.equal(await haptic('success',{native,nav}),true);assert.equal(calls.at(-1),'natif:medium');assert.equal(calls.length,3);
  const brokenNative={capabilities:{haptics:true},haptic:async()=>{throw new Error('plugin');}};
  assert.equal(await haptic('tick',{native:brokenNative,nav}),true);assert.equal(calls.at(-1),12);
  assert.equal(await haptic('tick',{nav:{}}),false);
  assert.equal(await haptic('tick',{nav:{vibrate:()=>{throw new Error('bloqué');}}}),false);
});

test('le réglage de vibration est conservé par la personnalisation et actif par défaut',()=>{
  assert.equal(normalizePersonalization({}).nativeHaptics,true);
  assert.equal(normalizePersonalization({nativeHaptics:false}).nativeHaptics,false);
});

test('les modules de célébration sont servis hors connexion et branchés sur l’accueil',()=>{
  const sw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
  for(const file of ['celebration.js','celebration-ui.js'])assert.match(sw,new RegExp(`'\\./${file.replace('.','\\.')}'`));
  const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
  assert.match(app,/action==='finish-work'\)\{const w=store\.get\('interventions',id\);armCelebration\(/);
  assert.match(app,/action==='finish-task'\)\{const t=store\.get\('tasks',id\);armCelebration\(/);
  assert.match(app,/decorateDayReview\(\$\('#day-review'\)/);
  const css=fs.readFileSync(new URL('./design-v3.css',import.meta.url),'utf8');
  assert.match(css,/prefers-reduced-motion:reduce\)\{\.day-review\{transition:none\}\.review-bloom\{display:none\}/);
});
