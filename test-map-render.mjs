import test from 'node:test';
import assert from 'node:assert/strict';
import {parcelLayerKey,planParcelLayers,parcelStyle,styleKey,geometryBox,boxPixelSize,labelHasRoom} from './map-render.js';
import {DIMMED_OPACITY} from './map-legend.js';

const sq=(x,y,d=.01)=>({type:'Polygon',coordinates:[[[x,y],[x+d,y],[x+d,y+d],[x,y+d],[x,y]]]});
const parcel=(id,updatedAt='2026-10-01T08:00:00Z',extra={})=>({id,updatedAt,version:1,geometry:sq(5,46),...extra});

test('clé de couche : id + updatedAt + version, identité de géométrie en repli', () => {
  const a=parcel('a');
  assert.equal(parcelLayerKey(a),parcelLayerKey({...a}));
  assert.notEqual(parcelLayerKey(a),parcelLayerKey({...a,updatedAt:'2026-10-02T08:00:00Z'}));
  assert.notEqual(parcelLayerKey(a),parcelLayerKey({...a,version:2}));
  const geometry=sq(5,46),old={id:'o',geometry};
  assert.equal(parcelLayerKey(old),parcelLayerKey({id:'o',geometry}));
  assert.notEqual(parcelLayerKey(old),parcelLayerKey({id:'o',geometry:sq(5,46)}));
  assert.equal(parcelLayerKey(null),'');
});

test('plan partiel : garde les inchangées, recrée les modifiées, retire les absentes', () => {
  const a=parcel('a'),b=parcel('b'),c=parcel('c');
  const previous=new Map([[a.id,parcelLayerKey(a)],[b.id,parcelLayerKey(b)],['gone','gone|x']]);
  const plan=planParcelLayers(previous,[a,{...b,updatedAt:'2026-10-05T08:00:00Z'},c]);
  assert.deepEqual(plan.keep.map(x=>x.id),['a']);
  assert.deepEqual(plan.create.map(x=>x.id),['b','c']);
  assert.deepEqual(plan.remove.sort(),['b','gone']);
});

test('plan : ignore supprimées, sans géométrie et doublons ; tolère une entrée vide', () => {
  const plan=planParcelLayers(null,[parcel('a'),parcel('a'),{id:'x'},parcel('d',undefined,{deletedAt:'2026-01-01'}),null]);
  assert.deepEqual(plan.create.map(x=>x.id),['a']);
  assert.deepEqual(plan.remove,[]);
});

test('500 parcelles inchangées : aucune recréation', () => {
  const list=Array.from({length:500},(_,i)=>parcel(`p${i}`));
  const previous=new Map(list.map(p=>[p.id,parcelLayerKey(p)]));
  const plan=planParcelLayers(previous,list);
  assert.equal(plan.keep.length,500);assert.equal(plan.create.length,0);assert.equal(plan.remove.length,0);
});

test('style : tirets explicites pour qu\'un setStyle efface l\'état précédent', () => {
  const normal=parcelStyle({color:'#287a4a'});
  assert.equal(normal.dashArray,null);assert.equal(normal.fillColor,'#287a4a');assert.equal(normal.fillOpacity,.3);assert.equal(normal.weight,3);
  const late=parcelStyle({color:'#287a4a',late:true});
  assert.equal(late.dashArray,'1 7');assert.equal(late.color,'#c33b36');
  const reentry=parcelStyle({color:'#287a4a',reentry:true});
  assert.equal(reentry.dashArray,'7 5');assert.equal(reentry.color,'#b3261e');
  const selected=parcelStyle({color:'#287a4a',selected:true,reentry:true});
  assert.equal(selected.dashArray,null);assert.equal(selected.color,'#092c1c');assert.equal(selected.weight,5);assert.equal(selected.fillOpacity,.52);
  assert.equal(parcelStyle({overlay:true}).fillOpacity,0);
  assert.equal(parcelStyle({hatch:true,fill:{motif:true}}).fillOpacity,.7);
});

test('style : catégorie isolée, les autres sont atténuées', () => {
  const dim=parcelStyle({color:'#287a4a',focus:'Blé'});
  assert.equal(dim.opacity,DIMMED_OPACITY);assert.ok(Math.abs(dim.fillOpacity-.3*DIMMED_OPACITY)<1e-9);
});

test('signature de style : stable, sensible aux changements, motif accepté', () => {
  const a=parcelStyle({color:'#287a4a'});
  assert.equal(styleKey(a),styleKey(parcelStyle({color:'#287a4a'})));
  assert.notEqual(styleKey(a),styleKey(parcelStyle({color:'#e0873a'})));
  assert.notEqual(styleKey(a),styleKey(parcelStyle({color:'#287a4a',late:true})));
  const pattern={};assert.match(styleKey(parcelStyle({hatch:true,fill:pattern})),/motif/);
  assert.equal(styleKey(null),'');
});

test('emprise et place pour une étiquette selon le zoom', () => {
  const box=geometryBox({type:'MultiPolygon',coordinates:[[[[5,46],[5.004,46],[5.004,46.003],[5,46]]],[[[5.01,46.01],[5.011,46.01],[5.011,46.011],[5.01,46.01]]]]});
  assert.deepEqual(box,[5,46,5.011,46.011]);
  assert.equal(geometryBox(null),null);assert.equal(geometryBox({type:'Point',coordinates:[5,46]})[2],5);
  const small=geometryBox(sq(5,46,.004)); // ≈ 300 m
  const z12=boxPixelSize(small,12),z16=boxPixelSize(small,16);
  assert.ok(Math.abs(z16.w/z12.w-16)<1e-9);assert.ok(z12.w>11&&z12.w<12.5);
  assert.equal(labelHasRoom(small,12),false);assert.equal(labelHasRoom(small,16),true);
  assert.equal(labelHasRoom(null,18),false);
});

test('canvas partagé : padding modéré pour rester sous la limite WebKit (16 777 216 px)', async () => {
  const {readFile}=await import('node:fs/promises');
  const src=await readFile(new URL('./map.js',import.meta.url),'utf8');
  const m=src.match(/L\.canvas\(\{padding:([\d.]+)/);
  assert.ok(m,'renderer canvas introuvable dans map.js');
  const p=Number(m[1]);
  assert.ok(p>=0&&p<=.2,`padding ${p} trop grand`);
  // iPad Pro 12,9 pouces en paysage, retina x2 : (1+2p)^2 * 4 * L * H
  const pixels=Math.pow(1+2*p,2)*4*1366*1024;
  assert.ok(pixels<16777216,`canvas de ${Math.round(pixels)} px`);
});
