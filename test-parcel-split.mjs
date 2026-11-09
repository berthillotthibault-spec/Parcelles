import test from 'node:test';
import assert from 'node:assert/strict';
import {splitPolygonByLine,splitLabels,unionPolygons,simpleRing} from './geometry-ops.js';
import {previewSplit,buildSplit,previewMerge,buildMerge,lineageLabel,openLinks,openLinksCount,relink,declaredSurfaceHa} from './parcel-split.js';
import {geometryAreaHa} from './utils.js';

const rect=(x,y,w,h)=>({type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]});
const near=(a,b,eps)=>Math.abs(a-b)<=eps;

test('découpe : une ligne horizontale coupe un rectangle en Nord / Sud', () => {
  const g=rect(5,46,0.01,0.01),total=geometryAreaHa(g);
  const res=splitPolygonByLine(g,[[4.999,46.004],[5.011,46.004]]);
  assert.ok(res.parts,res.error);
  const [a,b]=res.parts.map(geometryAreaHa);
  assert.ok(near(a+b,total,0.01));
  assert.deepEqual(splitLabels(...res.parts).sort(),['Nord','Sud']);
  const sud=res.parts[splitLabels(...res.parts).indexOf('Sud')];
  assert.ok(near(geometryAreaHa(sud),total*0.4,0.05));
});

test('découpe : ligne brisée, sens inversé, même bord', () => {
  const g=rect(5,46,0.01,0.01),total=geometryAreaHa(g);
  const res=splitPolygonByLine(g,[[5.004,46.011],[5.005,46.005],[5.006,46.011]]); // entre et sort par le bord nord
  assert.ok(res.parts,res.error);
  assert.ok(near(res.parts.map(geometryAreaHa).reduce((s,v)=>s+v,0),total,0.01));
  const ew=splitPolygonByLine(g,[[5.003,46.011],[5.003,45.999]]);
  assert.deepEqual(splitLabels(...ew.parts).sort(),['Est','Ouest']);
});

test('découpe : refus propres', () => {
  const g=rect(5,46,0.01,0.01);
  assert.match(splitPolygonByLine(g,[[5.002,46.002],[5.004,46.004]]).error,/entièrement/);
  assert.match(splitPolygonByLine(g,[[4.999,46.002],[5.011,46.002],[5.011,46.006],[4.999,46.006]]).error,/une seule fois/);
  const holed={type:'Polygon',coordinates:[...rect(5,46,0.01,0.01).coordinates,[[5.002,46.002],[5.003,46.002],[5.003,46.003],[5.002,46.002]]]};
  assert.match(splitPolygonByLine(holed,[[4.999,46.004],[5.011,46.004]]).error,/trou/);
  assert.match(simpleRing({type:'MultiPolygon',coordinates:[rect(5,46,1,1).coordinates,rect(7,46,1,1).coordinates]}).error,/MultiPolygon/);
  assert.equal(simpleRing({type:'MultiPolygon',coordinates:[rect(5,46,1,1).coordinates]}).ring.length,4);
});

test('fusion : deux rectangles côte à côte', () => {
  const a=rect(5,46,0.004,0.003),b=rect(5.004,46,0.004,0.003);
  const res=unionPolygons(a,b);
  assert.ok(res.geometry,res.error);
  assert.equal(res.geometry.coordinates[0].length,5,'rectangle simplifié');
  assert.ok(near(geometryAreaHa(res.geometry),geometryAreaHa(a)+geometryAreaHa(b),0.01));
});

test('fusion : limite commune partielle et écart de 0,3 m', () => {
  const gap=0.3/111320/Math.cos(46*Math.PI/180);
  const a=rect(5,46,0.004,0.004),b=rect(5.004+gap,46.001,0.003,0.002);
  const res=unionPolygons(a,b);
  assert.ok(res.geometry,res.error);
  assert.equal(res.geometry.coordinates[0].length,9);
});

test('fusion : refus si éloignées, chevauchantes ou formant un trou', () => {
  assert.match(unionPolygons(rect(5,46,0.004,0.003),rect(5.005,46,0.004,0.003)).error,/ne se touchent pas/);
  assert.ok(unionPolygons(rect(5,46,0.004,0.003),rect(5.002,46,0.004,0.003)).error);
  // U + bouchon qui ferme une cour intérieure.
  const U={type:'Polygon',coordinates:[[[0,0],[3,0],[3,3],[2,3],[2,1],[1,1],[1,3],[0,3],[0,0]].map(([x,y])=>[5+x*0.001,46+y*0.001])]};
  const cap=rect(5.001,46.001,0.001,0.001);const capTop=rect(5,46.003,0.003,0.001);
  assert.ok(unionPolygons(U,capTop).error,'trou refusé');
  const notch=unionPolygons(U,cap);assert.ok(notch.geometry,notch.error);
  assert.ok(near(geometryAreaHa(notch.geometry),geometryAreaHa(U)+geometryAreaHa(cap),0.01));
});

test('entités : découpe, fusion et filiation', () => {
  const p={id:'p1',nom:'Les Noues',culture:'Blé',commune:'X',surfaceHa:11,geometry:rect(5,46,0.01,0.01),favorite:true,version:3,createdAt:1};
  const prev=previewSplit(p,[[4.999,46.004],[5.011,46.004]]);
  assert.match(prev.summary,/^(Nord|Sud) \d+,?\d* ha · (Nord|Sud) \d/);
  const {children,original}=buildSplit(p,prev.parts,['A','B'],['c1','c2']);
  assert.deepEqual(children.map(c=>[c.id,c.nom,c.parentId,c.culture,c.favorite,c.version]),[['c1','A','p1','Blé',undefined,undefined],['c2','B','p1','Blé',undefined,undefined]]);
  assert.equal(original.archived,true);assert.deepEqual(original.splitInto,['c1','c2']);
  const m=previewMerge(children[0],children[1]);assert.ok(m.geometry,m.error);
  const {merged,originals}=buildMerge(children[0],children[1],m.geometry,'Tout','m1');
  assert.deepEqual(merged.parentIds,['c1','c2']);assert.ok(originals.every(o=>o.archived&&o.mergedInto==='m1'));
  const find=id=>({p1:p,c1:children[0],c2:children[1]})[id];
  assert.equal(lineageLabel(children[0],find),'issue de Les Noues');
  assert.equal(lineageLabel(merged,find),'issue de A et B');
  assert.equal(lineageLabel(p,find),'');
  assert.match(previewSplit({...p,geometry:{type:'Point',coordinates:[5,46]}},[[0,0],[1,1]]).error,/polygonal/);
});

test('découpe : la surface déclarée est répartie, le résumé suit le même arrondi', () => {
  const g=rect(5,46,0.01,0.01),area=geometryAreaHa(g);
  const parcel={id:'p1',nom:'Grand Champ',geometry:g,surfaceHa:8.2};
  assert.equal(declaredSurfaceHa(parcel),8.2);
  const prev=previewSplit(parcel,[[4.999,46.004],[5.011,46.004]]);
  const {children}=buildSplit(parcel,prev.parts,[],['a','b']);
  assert.ok(near(children[0].surfaceHa+children[1].surfaceHa,8.2,1e-9));
  assert.ok(children[0].surfaceHa<children[1].surfaceHa);
  assert.ok(prev.parts.every(p=>prev.summary.includes(`${String(p.surfaceHa.toLocaleString('fr-FR',{maximumFractionDigits:2}))} ha`)));
  // Surface égale au contour : on suit le contour.
  const plain=buildSplit({...parcel,surfaceHa:area},prev.parts,[],['a','b']).children;
  assert.ok(near(plain[0].surfaceHa,geometryAreaHa(prev.parts[0].geometry),1e-3));
  // Fusion : somme des surfaces déclarées.
  const left={id:'a',nom:'A',geometry:rect(5,46,0.01,0.01),surfaceHa:3},right={id:'b',nom:'B',geometry:rect(5.01,46,0.01,0.01)};
  const m=previewMerge(left,right);
  const {merged}=buildMerge(left,right,m.geometry,'AB','m');
  assert.ok(near(merged.surfaceHa,3+geometryAreaHa(right.geometry),1e-3));
  assert.equal(m.surfaceHa,merged.surfaceHa);
});

test('découpe et fusion : lots au pré, travaux et tâches ouverts à rattacher', () => {
  const data={
    grazingSessions:[{id:'g1',parcelId:'p3'},{id:'g2',parcelId:'p3',endDate:'2026-10-01'},{id:'g3',parcelId:'p9'}],
    interventions:[{id:'w1',parcelId:'p3',status:'À faire'},{id:'w2',parcelId:'p3',status:'Terminé'},{id:'w3',parcelId:'p3',status:'Annulé'},{id:'w4',parcelId:'p2',status:'Planifié'}],
    tasks:[{id:'t1',parcelId:'p3',status:'À faire'},{id:'t2',parcelId:'p3',status:'Terminé'},{id:'t3',parcelId:'p3',deletedAt:'x'}]
  };
  const links=openLinks(data,['p3']);
  assert.deepEqual(links.grazingSessions.map(x=>x.id),['g1']);
  assert.deepEqual(links.interventions.map(x=>x.id),['w1']);
  assert.deepEqual(links.tasks.map(x=>x.id),['t1']);
  assert.equal(openLinksCount(links),3);
  assert.deepEqual(openLinks(data,['p2','p3']).interventions.map(x=>x.id),['w1','w4']);
  assert.equal(openLinksCount(openLinks(data,['zz'])),0);
  assert.deepEqual(relink(links.tasks,'n1'),[{id:'t1',parcelId:'n1',status:'À faire'}]);
  assert.equal(data.tasks[0].parcelId,'p3','relink ne modifie pas l’original');
});
