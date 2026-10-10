import test from 'node:test';
import assert from 'node:assert/strict';
import {ringSelfIntersects,ringError,segmentsIntersect,ringAreaM2,ringPerimeterM,openRing,closeRing} from './geometry-ops.js';
import {createContourEdit,applyRingChange,undoEdit,currentRing,areaChangeLabel,editAreas,isEditDirty,editableRings,nextRing,nextSurfaceHa,midpoints,editError} from './contour-edit.js';

const sq=(x=5,y=46,d=0.01)=>({type:'Polygon',coordinates:[[[x,y],[x+d,y],[x+d,y+d],[x,y+d],[x,y]]]});

test('segmentsIntersect : croisement, parallèles, contact', () => {
  assert.equal(segmentsIntersect([0,0],[2,2],[0,2],[2,0]),true);
  assert.equal(segmentsIntersect([0,0],[2,0],[0,1],[2,1]),false);
  assert.equal(segmentsIntersect([0,0],[2,0],[2,0],[3,1]),true);
});

test('ringSelfIntersects : carré simple non, nœud papillon oui', () => {
  assert.equal(ringSelfIntersects([[0,0],[1,0],[1,1],[0,1],[0,0]]),false);
  assert.equal(ringSelfIntersects([[0,0],[1,1],[1,0],[0,1],[0,0]]),true);
  // Repli d'un segment sur son voisin.
  assert.equal(ringSelfIntersects([[0,0],[2,0],[1,0],[1,1]]),true);
  // Sommet en double.
  assert.equal(ringSelfIntersects([[0,0],[1,0],[1,0],[1,1]]),true);
});

test('ringError : messages explicites', () => {
  assert.match(ringError([[0,0],[1,0]]),/3 sommets/);
  assert.match(ringError([[5,46],[5.01,46.01],[5.01,46],[5,46.01]]),/croise/);
  assert.equal(ringError(sq().coordinates[0]),null);
});

test('surface et périmètre locaux en mètres', () => {
  const ring=sq(5,46,0.001).coordinates[0];
  const a=Math.abs(ringAreaM2(ring));assert.ok(a>8500&&a<8700,String(a));
  const p=ringPerimeterM(ring);assert.ok(p>350&&p<380,String(p));
  assert.deepEqual(closeRing(openRing(ring)),ring);
});

test('session : déplacer, insérer, supprimer, annuler', () => {
  const edit=createContourEdit(sq());
  assert.equal(currentRing(edit).length,4);
  assert.equal(applyRingChange(edit,'move',2,[5.012,46.012]).ok,true);
  assert.ok(isEditDirty(edit));
  const {before,after}=editAreas(edit);assert.ok(after>before);
  assert.equal(applyRingChange(edit,'insert',0,midpoints(currentRing(edit))[0]).ok,true);
  assert.equal(currentRing(edit).length,5);
  assert.equal(applyRingChange(edit,'remove',1).ok,true);
  assert.equal(currentRing(edit).length,4);
  assert.ok(undoEdit(edit));assert.equal(currentRing(edit).length,5);
  assert.ok(undoEdit(edit));assert.ok(undoEdit(edit));
  assert.equal(isEditDirty(edit),false);
  assert.equal(undoEdit(edit),false);
  // Fermeture conservée.
  const r=edit.geometry.coordinates[0];assert.deepEqual(r[0],r[r.length-1]);
});

test('session : un déplacement qui croise le contour est refusé', () => {
  const edit=createContourEdit(sq());
  const res=applyRingChange(edit,'move',3,[5.02,46.005]);
  assert.equal(res.ok,false);assert.match(res.error,/croise/);
  assert.equal(edit.stack.length,0);
  assert.equal(applyRingChange(edit,'remove',0).ok,true);
  const res2=applyRingChange(edit,'remove',0);assert.equal(res2.ok,false);assert.match(res2.error,/3 sommets/);
  assert.equal(editError(edit),null);
});

test('MultiPolygon : un anneau à la fois', () => {
  const g={type:'MultiPolygon',coordinates:[sq(5).coordinates,sq(5.1).coordinates]};
  assert.equal(editableRings(g).length,2);
  const edit=createContourEdit(g);
  nextRing(edit);
  applyRingChange(edit,'move',0,[5.099,45.999]);
  assert.deepEqual(edit.geometry.coordinates[0],g.coordinates[0]);
  assert.notDeepEqual(edit.geometry.coordinates[1],g.coordinates[1]);
  assert.throws(()=>createContourEdit({type:'Point',coordinates:[5,46]}),/modifiable/);
});

test('libellé de surface et surface déclarée', () => {
  assert.equal(areaChangeLabel(5.42,5.57),'5,42 ha → 5,57 ha, +0,15 ha');
  assert.equal(areaChangeLabel(5.42,5.3),'5,42 ha → 5,30 ha, −0,12 ha');
  assert.equal(areaChangeLabel(2,2),'2,00 ha → 2,00 ha, ±0,00 ha');
  assert.equal(nextSurfaceHa(null,5,6),6);
  assert.equal(nextSurfaceHa(5.01,5,6),6);
  assert.equal(nextSurfaceHa(4.2,5,6),4.2);
});
