import assert from 'node:assert/strict';
import {test} from 'node:test';
import {trackPoint,shouldRecord,simplifyTrack,appendTrack,splitPasses,passPolygon,trackSwathFeatures,pickResolution,trackCoverage,coverageLabel,trackToGpx,trackLengthM} from './field-coverage.js';
import {analyzeCoverage} from './application-coverage.js';
import {buildInterventionFromSession} from './field-ops.js';

const LAT=46.34,LON=5.13,mLat=1/111320,mLon=1/(111320*Math.cos(LAT*Math.PI/180));
const at=(x,y,t)=>({lat:LAT+y*mLat,lon:LON+x*mLon,t});
// Parcelle carrée de 100 m x 100 m.
const parcel={id:'p',nom:'Les Grandes Terres',geometry:{type:'Polygon',coordinates:[[[LON,LAT],[LON+100*mLon,LAT],[LON+100*mLon,LAT+100*mLat],[LON,LAT+100*mLat],[LON,LAT]]]}};
// Allers-retours : passages verticaux tous les `step` m, points tous les 2 m.
function serpentine(count,step,{offset=step/2}={}){const pts=[];let t=0;for(let k=0;k<count;k++){const x=offset+k*step;const ys=[];for(let y=0;y<=100;y+=2)ys.push(y);if(k%2)ys.reverse();for(const y of ys)pts.push(at(x,y,t+=2000));}return pts;}

test('trackPoint ne garde que position, heure et précision', () => {
  const p=trackPoint({latitude:46.123456789,longitude:5.1,accuracy:4.26,altitude:300,speed:2},1000);
  assert.deepEqual(p,{lat:46.1234568,lon:5.1,t:1000,acc:4.3});
  assert.equal(trackPoint({latitude:'x',longitude:5}),null);
});

test('shouldRecord : 2 s ou 3 m, et précision suffisante', () => {
  const a=at(0,0,0);
  assert.equal(shouldRecord(null,a),true);
  assert.equal(shouldRecord(a,at(1,0,500)),false);
  assert.equal(shouldRecord(a,at(4,0,500)),true);
  assert.equal(shouldRecord(a,at(0,0,2000)),true);
  assert.equal(shouldRecord(a,{...at(10,0,5000),acc:80}),false);
});

test('simplifyTrack retire les points alignés et garde les virages', () => {
  const line=[];for(let y=0;y<=100;y+=2)line.push(at(0,y,y*1000));line.push(at(20,100,200000));
  const s=simplifyTrack(line,0.5);
  assert.equal(s.length,3);assert.deepEqual(s[0],line[0]);assert.deepEqual(s.at(-1),line.at(-1));
  assert.ok(Math.abs(trackLengthM(s)-120)<1);
  assert.equal(appendTrack([],line).length,3);
});

test('splitPasses découpe aux demi-tours et aux interruptions', () => {
  const track=simplifyTrack(serpentine(3,10),0.5);
  assert.equal(splitPasses(track).length,5); // 3 passages + 2 courts demi-tours
  const gap=[at(0,0,0),at(0,10,2000),{...at(0,20,200000),brk:1},at(0,30,202000)];
  assert.equal(simplifyTrack(gap,5).length,4);
  assert.equal(trackPoint({latitude:46,longitude:5},200000,{t:0}).brk,1);assert.equal(trackPoint({latitude:46,longitude:5},4000,{t:0}).brk,undefined);
  assert.equal(splitPasses(gap).length,2);
});

test('passPolygon : bande fermée de la largeur de l\'outil', () => {
  const g=passPolygon([at(0,0,0),at(0,50,1)],6);
  const ring=g.coordinates[0];assert.deepEqual(ring[0],ring.at(-1));
  const xs=ring.map(c=>(c[0]-LON)/mLon);assert.ok(Math.abs(Math.max(...xs)-Math.min(...xs)-6)<0.01);
  assert.equal(passPolygon([at(0,0,0)],6),null);assert.equal(passPolygon([at(0,0,0),at(0,1,1)],0),null);
});

test('trackCoverage : couverture complète, manques et recouvrements', () => {
  assert.equal(pickResolution(parcel.geometry),2);
  const full=trackCoverage(parcel,simplifyTrack(serpentine(10,10)),10,{resolution:5});
  assert.ok(full.percent>=95,`couverture ${full.percent}`);
  const half=trackCoverage(parcel,simplifyTrack(serpentine(5,10)),10,{resolution:5});
  assert.ok(half.percent>=45&&half.percent<=55,`moitié ${half.percent}`);
  assert.ok(Math.abs(half.remainingHa-0.5)<0.08);
  assert.ok(half.cells.some(c=>c.properties.classe==='Manque'&&c.properties.color==='#e0892c'));
  const overlap=trackCoverage(parcel,simplifyTrack(serpentine(10,6)),10,{resolution:5});
  assert.ok(overlap.overlapHa>0.2&&overlap.cells.some(c=>c.properties.color==='#c8402f'));
  assert.equal(trackCoverage({id:'x'},[],6),null);
  assert.equal(trackCoverage(parcel,[],0),null);
  assert.equal(trackCoverage(parcel,[],6).percent,0);
  assert.equal(coverageLabel('Les Grandes Terres',{percent:72,remainingHa:0.91}),'Les Grandes Terres : 72 % · reste ~0,9 ha');
});

test('les bandes sont réutilisables telles quelles par analyzeCoverage', () => {
  const features=trackSwathFeatures(simplifyTrack(serpentine(4,10)),10);
  assert.ok(features.every(f=>typeof f.properties.rate==='number'&&f.geometry.type==='Polygon'));
  const r=analyzeCoverage(parcel,features,{resolution:5});
  assert.ok(r.coveredHa>0.35&&r.coveredHa<0.45);
});

test('trackToGpx produit un GPX 1.1 échappé', () => {
  const gpx=trackToGpx([at(0,0,Date.UTC(2026,9,10,8)),at(0,10,Date.UTC(2026,9,10,8,0,2))],{name:'Semis <Noues> & co'});
  assert.match(gpx,/^<\?xml version="1.0"/);assert.match(gpx,/<gpx version="1.1"/);
  assert.equal((gpx.match(/<trkpt /g)||[]).length,2);assert.match(gpx,/<time>2026-10-10T08:00:00.000Z<\/time>/);
  assert.match(gpx,/Semis &lt;Noues&gt; &amp; co/);
});

test('buildInterventionFromSession reprend la surface réellement couverte', () => {
  const s={id:'s',parcelId:'p',startedAt:Date.now()-3600000,endedAt:Date.now(),surfaceWorked:1,coveredHa:0.72};
  assert.equal(buildInterventionFromSession(s,{id:'p',surfaceHa:1}).surfaceWorked,0.72);
  assert.equal(buildInterventionFromSession({...s,coveredHa:null},{id:'p',surfaceHa:1}).surfaceWorked,1);
});
