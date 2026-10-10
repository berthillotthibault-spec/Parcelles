import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptFix,walkStats,accuracyLevel,formatMeters,walkSummary,walkGeometry,nearestParcels,measurePerimeterM} from './walk-measure.js';

const M=1/111320; // ~1 m en latitude
const pt=(dy,dx,accuracy=4)=>({latitude:46+dy*M,longitude:5+dx*M/Math.cos(46*Math.PI/180),accuracy});

test('un point tous les 3 m si la précision vaut 8 m ou moins', () => {
  assert.deepEqual(acceptFix([],pt(0,0)),{accept:true,reason:null});
  assert.equal(acceptFix([pt(0,0)],pt(2,0)).reason,'step');
  assert.equal(acceptFix([pt(0,0)],pt(3.2,0)).accept,true);
  assert.equal(acceptFix([],pt(0,0,9)).reason,'accuracy');
  assert.equal(acceptFix([],pt(0,0,8)).accept,true);
  assert.equal(acceptFix([],{latitude:'x'}).reason,'invalid');
});

test('statistiques : carré de 100 m', () => {
  const pts=[pt(0,0),pt(0,100),pt(100,100),pt(100,0)];
  const s=walkStats(pts);
  assert.ok(Math.abs(s.perimeterM-400)<2,String(s.perimeterM));
  assert.ok(Math.abs(s.areaHa-1)<0.02,String(s.areaHa));
  assert.equal(s.meanAccuracy,4);
  assert.ok(Math.abs(s.marginHa-0.16)<0.01);
  assert.equal(walkSummary(s),'4 points · périmètre 400 m · 1,00 ha ± 0,16 ha');
  assert.equal(walkSummary(walkStats([pt(0,0)])),'1 point · marchez le long de la limite');
  assert.equal(walkStats(pts.slice(0,2)).areaHa,0);
});

test('alerte de précision', () => {
  assert.equal(accuracyLevel(5).level,'ok');
  assert.equal(accuracyLevel(12).level,'warn');
  assert.match(accuracyLevel(12).label,/pause/);
  assert.equal(accuracyLevel(40).level,'bad');
  assert.equal(accuracyLevel(undefined).level,'none');
});

test('formatage des distances', () => {
  assert.equal(formatMeters(245.4),'245 m');
  assert.equal(formatMeters(1530),'1,53 km');
});

test('géométrie finale : fermeture et refus d’un tracé croisé', () => {
  const ok=walkGeometry([pt(0,0),pt(0,100),pt(100,100),pt(100,0)]);
  assert.equal(ok.geometry.type,'Polygon');assert.deepEqual(ok.geometry.coordinates[0][0],ok.geometry.coordinates[0][4]);
  assert.match(walkGeometry([pt(0,0),pt(100,100),pt(0,100),pt(100,0)]).error,/croise/);
  assert.match(walkGeometry([pt(0,0)]).error,/trois points/);
});

test('parcelles les plus proches et périmètre de mesure', () => {
  const g=walkGeometry([pt(0,0),pt(0,100),pt(100,100),pt(100,0)]).geometry;
  const far={id:'far',geometry:{type:'Polygon',coordinates:[[[6,47],[6.01,47],[6.01,47.01],[6,47]]]}};
  const near={id:'near',geometry:g};
  assert.deepEqual(nearestParcels(g,[far,near,{id:'x'}]).map(r=>r.parcel.id),['near','far']);
  assert.ok(Math.abs(measurePerimeterM([pt(0,0),pt(0,100),pt(100,100)])-341.4)<2);
});
