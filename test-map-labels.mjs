import test from 'node:test';
import assert from 'node:assert/strict';
import {polylabel,labelPoint,labelLevel,labelLines,resolveLabelCollisions} from './map-labels.js';
import {pointInGeometry} from './utils.js';

test('polylabel : centre d’un carré', () => {
  const [x,y]=polylabel([[[0,0],[10,0],[10,10],[0,10],[0,0]]],0.01);
  assert.ok(Math.abs(x-5)<0.05&&Math.abs(y-5)<0.05);
});

test('polylabel : parcelle en L, le point reste dans la parcelle (le centroïde en sort)', () => {
  const ring=[[0,0],[10,0],[10,2],[2,2],[2,10],[0,10],[0,0]];
  const geometry={type:'Polygon',coordinates:[ring]};
  const [x,y]=polylabel([ring]);
  assert.ok(pointInGeometry(x,y,geometry),`${x},${y} hors parcelle`);
  // Centroïde surfacique du L : (2.33, 2.33), hors de la parcelle.
  assert.ok(!pointInGeometry(2.33,2.33,geometry));
});

test('polylabel : un trou au milieu est évité', () => {
  const outer=[[0,0],[10,0],[10,10],[0,10],[0,0]],hole=[[3,3],[7,3],[7,7],[3,7],[3,3]];
  const [x,y]=polylabel([outer,hole]);
  assert.ok(!(x>3&&x<7&&y>3&&y<7));
});

test('labelPoint : plus grand polygone d’un MultiPolygon, en lng/lat', () => {
  const small=[[[5,46],[5.001,46],[5.001,46.001],[5,46.001],[5,46]]],big=[[[5.1,46],[5.11,46],[5.11,46.01],[5.1,46.01],[5.1,46]]];
  const [lng,lat]=labelPoint({type:'MultiPolygon',coordinates:[small,big]});
  assert.ok(lng>5.1&&lng<5.11&&lat>46&&lat<46.01);
  assert.equal(labelPoint(null),null);
});

test('niveaux de zoom : 14 grandes parcelles, 15 nom, 16 deux lignes', () => {
  assert.equal(labelLevel(13,2),'none');assert.equal(labelLevel(14,8),'name');
  assert.equal(labelLevel(15,1),'name');assert.equal(labelLevel(16,1),'full');
});

test('texte : « Blé · 5,4 ha » à 16, lot présent en mode Animaux', () => {
  const p={id:'p1',nom:'Les Noues',culture:'Blé',surfaceHa:5.43};
  assert.deepEqual(labelLines(p,{level:'name'}),['Les Noues']);
  assert.deepEqual(labelLines(p,{level:'full'}),['Les Noues','Blé · 5,4 ha']);
  const sessions=[{id:'g',parcelId:'p1',animalType:'Vaches',animalsCount:24,startDate:'2026-01-01'}];
  assert.deepEqual(labelLines(p,{level:'full',colorMode:'animals',grazingSessions:sessions,date:new Date('2026-10-08T12:00:00')}),['Les Noues','Vaches · 24']);
  assert.deepEqual(labelLines(p,{level:'none'}),[]);
});

test('collisions : la plus grande parcelle garde son étiquette, débordement masqué', () => {
  const items=[
    {id:'a',priority:10,rect:{x:0,y:0,w:50,h:14},bounds:{x:-10,y:-10,w:100,h:40}},
    {id:'b',priority:5,rect:{x:30,y:5,w:50,h:14},bounds:{x:0,y:0,w:200,h:100}},
    {id:'c',priority:4,rect:{x:200,y:0,w:50,h:14},bounds:{x:210,y:0,w:20,h:20}},
    {id:'d',priority:1,rect:{x:100,y:50,w:40,h:14}}];
  assert.deepEqual([...resolveLabelCollisions(items)].sort(),['a','d']);
});
