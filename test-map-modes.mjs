import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapModes, actionLeavesMode, isDrawDirty, MAP_MODE_ACTIONS, MAP_NEUTRAL_ACTIONS, MAP_MODE_LABELS} from './map-modes.js';

const MODES=['multiple','measure','draw','point'];

test('un seul mode actif : entrer dans un mode nettoie le précédent', () => {
  const log=[];const modes=createMapModes({onChange:e=>log.push(`${e.previous||'-'}>${e.current||'-'}`)});
  assert.equal(modes.current,null);
  modes.enter('multiple',{cleanup:()=>log.push('clean multiple')});
  assert.equal(modes.current,'multiple');assert.ok(modes.is('multiple'));
  modes.enter('measure',{cleanup:()=>log.push('clean measure')});
  assert.equal(modes.current,'measure');
  assert.deepEqual(log,['->multiple','clean multiple','multiple>measure']);
  assert.ok(modes.exit());assert.equal(modes.current,null);
  assert.deepEqual(log.slice(-2),['clean measure','measure>-']);
});

test('matrice A → B : chaque transition nettoie A exactement une fois', () => {
  for(const a of MODES)for(const b of MODES){
    const cleaned=[];const modes=createMapModes();
    modes.enter(a,{cleanup:()=>cleaned.push(a)});modes.enter(b,{cleanup:()=>cleaned.push(b+'2')});
    assert.deepEqual(cleaned,[a],`${a} → ${b}`);assert.equal(modes.current,b);
    modes.exit();assert.deepEqual(cleaned,[a,b+'2']);assert.equal(modes.current,null);
  }
});

test('exit({name}) ne quitte que le mode visé ; release oublie sans nettoyer', () => {
  let cleaned=0;const modes=createMapModes();
  modes.enter('draw',{cleanup:()=>cleaned++});
  assert.ok(modes.exit({name:'multiple'}));assert.equal(modes.current,'draw');assert.equal(cleaned,0);
  assert.equal(modes.release('measure'),false);assert.equal(modes.current,'draw');
  assert.equal(modes.release('draw'),true);assert.equal(modes.current,null);assert.equal(cleaned,0);
  assert.ok(modes.exit(),'quitter sans mode actif est sans effet');
});

test('le nettoyage peut rappeler release/exit sans boucle ni double nettoyage', () => {
  let cleaned=0;const modes=createMapModes();
  modes.enter('multiple',{cleanup:()=>{cleaned++;modes.release('multiple');modes.exit({name:'multiple'});}});
  modes.exit();assert.equal(cleaned,1);assert.equal(modes.current,null);
  modes.enter('measure',{cleanup:()=>{cleaned++;modes.release('measure');}});
  modes.enter('point',{cleanup:()=>{}});
  assert.equal(cleaned,2);assert.equal(modes.current,'point','la libération tardive de l’ancien mode n’efface pas le nouveau');
});

test('une erreur de nettoyage ne bloque pas le gestionnaire', () => {
  const errors=[];const modes=createMapModes({onError:e=>errors.push(e.message)});
  modes.enter('draw',{cleanup:()=>{throw new Error('boom');}});
  modes.enter('measure');assert.equal(modes.current,'measure');assert.deepEqual(errors,['boom']);
});

test('tracé non enregistré : leave demande confirmation, rien n’est perdu en silence', () => {
  let points=[1,2,3],cleaned=0,blocked=null,proceeded=0;
  const modes=createMapModes({onBlocked:info=>{blocked=info;}});
  modes.enter('draw',{cleanup:()=>cleaned++,isDirty:()=>isDrawDirty(points)});
  assert.equal(modes.exit(),false,'exit sans force conserve le tracé');
  assert.equal(modes.current,'draw');
  assert.equal(modes.leave(()=>proceeded++),false);
  assert.equal(blocked.mode,'draw');assert.equal(proceeded,0);assert.equal(cleaned,0);
  blocked.cancel();assert.equal(modes.current,'draw');assert.equal(cleaned,0);
  modes.leave(()=>proceeded++);blocked.confirm();blocked.confirm();
  assert.equal(proceeded,1,'confirmer une seule fois');assert.equal(cleaned,1);assert.equal(modes.current,null);
  points=[1,2];modes.enter('draw',{cleanup:()=>cleaned++,isDirty:()=>isDrawDirty(points)});
  assert.equal(modes.leave(()=>proceeded++),true,'deux sommets : sortie directe');
  assert.equal(proceeded,2);assert.equal(cleaned,2);
});

test('exit({force}) quitte même un tracé modifié ; sans onBlocked, leave conserve le tracé', () => {
  let cleaned=0;const modes=createMapModes();
  modes.enter('draw',{cleanup:()=>cleaned++,isDirty:()=>true});
  assert.equal(modes.leave(()=>{throw new Error('ne doit pas continuer');}),false);
  assert.equal(modes.current,'draw');
  assert.ok(modes.exit({force:true}));assert.equal(cleaned,1);assert.equal(modes.current,null);
});

test('isDrawDirty : seuil de trois sommets', () => {
  assert.equal(isDrawDirty(null),false);assert.equal(isDrawDirty([]),false);assert.equal(isDrawDirty([1,2]),false);assert.equal(isDrawDirty([1,2,3]),true);
});

test('actionLeavesMode : les actions du mode et les actions neutres le conservent', () => {
  assert.equal(actionLeavesMode(null,'map-tools'),false);
  assert.equal(actionLeavesMode('multiple',''),false);
  for(const action of ['map-tools','open-map-layers','measure-distance','measure-area','draw-parcel','add-point','open-field-mode','quick-work','voice-journal','voice-assistant','open-assistant','open-parcel','track-position'])
    for(const mode of MODES)assert.equal(actionLeavesMode(mode,action),true,`${action} quitte ${mode}`);
  for(const [mode,actions] of Object.entries(MAP_MODE_ACTIONS))for(const action of actions)assert.equal(actionLeavesMode(mode,action),false,`${action} reste dans ${mode}`);
  for(const action of MAP_NEUTRAL_ACTIONS)assert.equal(actionLeavesMode('multiple',action),false);
  assert.equal(actionLeavesMode('draw','map-multiple'),true,'la sélection multiple remplace le dessin');
  assert.equal(actionLeavesMode('multiple','undo-draw-point'),true);
  assert.equal(actionLeavesMode('multiple','open-parcel',{insideModal:true}),false,'une fenêtre ouverte depuis le mode gère la suite');
});

test('libellés français pour chaque mode', () => {
  for(const mode of MODES)assert.ok(MAP_MODE_LABELS[mode]);
  assert.throws(()=>createMapModes().enter(''),/inconnu/);
});
