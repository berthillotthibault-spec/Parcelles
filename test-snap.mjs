import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSnapIndex,snapPoint,followBoundary,ringPosition,SNAP_TOLERANCE_PX} from './snap.js';

const square=(id,x,y,s=100)=>({id,points:[{x,y},{x:x+s,y},{x:x+s,y:y+s},{x,y:y+s}]});

test('accrochage à un sommet en priorité', () => {
  const idx=buildSnapIndex([square('a',0,0)]);
  const s=snapPoint(idx,{x:96,y:5});
  assert.equal(s.kind,'vertex');assert.equal(s.index,1);assert.deepEqual([s.x,s.y],[100,0]);
});

test('accrochage à un segment, projection orthogonale', () => {
  const idx=buildSnapIndex([square('a',0,0)]);
  const s=snapPoint(idx,{x:50,y:8});
  assert.equal(s.kind,'segment');assert.equal(s.index,0);assert.deepEqual([s.x,s.y],[50,0]);assert.equal(s.t,0.5);
});

test('au-delà de 12 px : pas d’accrochage', () => {
  const idx=buildSnapIndex([square('a',0,0)]);
  assert.equal(SNAP_TOLERANCE_PX,12);
  assert.equal(snapPoint(idx,{x:50,y:13}),null);
  assert.equal(snapPoint(idx,{x:50,y:50}),null);
});

test('plusieurs contours : le plus proche, exclusion possible', () => {
  const idx=buildSnapIndex([square('a',0,0),square('b',110,0)]);
  assert.equal(snapPoint(idx,{x:107,y:50}).ringId,'b');
  assert.equal(snapPoint(idx,{x:103,y:50}).ringId,'a');
  assert.equal(snapPoint(idx,{x:103,y:50},{exclude:id=>id==='a'}).ringId,'b');
});

test('grille : un grand nombre de contours reste rapide', () => {
  const rings=[];for(let i=0;i<60;i++)for(let j=0;j<60;j++)rings.push(square(`${i}-${j}`,i*120,j*120));
  const idx=buildSnapIndex(rings);
  const t0=performance.now();for(let k=0;k<2000;k++)snapPoint(idx,{x:(k*37)%7000,y:(k*53)%7000});
  assert.ok(performance.now()-t0<500);
  assert.equal(snapPoint(idx,{x:1205,y:1203}).ringId,'10-10');
});

test('segment immense à l’écran (fort zoom) pris en compte', () => {
  const idx=buildSnapIndex([{id:'big',points:[{x:-1e6,y:0},{x:1e6,y:0},{x:0,y:1e6}]}]);
  assert.equal(snapPoint(idx,{x:5,y:4}).ringId,'big');
});

test('Suivre la limite : sommets intermédiaires par le plus court chemin', () => {
  const v=(index)=>({ringId:'a',kind:'vertex',index,t:0});
  const s=(index,t)=>({ringId:'a',kind:'segment',index,t});
  assert.deepEqual(followBoundary(4,v(0),v(2)),[1]);
  assert.deepEqual(followBoundary(4,s(0,.5),s(2,.5)),[1,2]);
  assert.deepEqual(followBoundary(4,v(3),v(1)),[0]);
  assert.deepEqual(followBoundary(6,v(1),v(5)),[0]);
  assert.deepEqual(followBoundary(4,v(0),s(0,.5)),[]);
  assert.deepEqual(followBoundary(4,v(0),{...v(2),ringId:'b'}),[]);
  assert.equal(ringPosition(s(2,.25)),2.25);
});
