import assert from 'node:assert/strict';
import {test} from 'node:test';
import {silhouettePath,cachedSilhouette,silhouetteCacheSize,rotationFrieze,shiftCampaign} from './parcel-silhouette.js';

const rect={type:'Polygon',coordinates:[[[5,46],[5.02,46],[5.02,46.005],[5,46.005],[5,46]]]};
test('silhouette normalisée dans 44 x 44, proportions et nord respectés', () => {
  const d=silhouettePath(rect,44,3);assert.match(d,/^M.*Z$/);
  const nums=d.match(/-?\d+(\.\d+)?/g).map(Number),xs=nums.filter((_,i)=>i%2===0),ys=nums.filter((_,i)=>i%2===1);
  assert.equal(Math.min(...xs),3);assert.equal(Math.max(...xs),41);
  const h=Math.max(...ys)-Math.min(...ys);assert.ok(h>10&&h<16,`hauteur ${h}`); // 0,02° x cos(46) ~ 1,39 km ; 0,005° ~ 0,56 km
  assert.ok(Math.abs((Math.min(...ys)+Math.max(...ys))/2-22)<0.2,'centrée');
  const multi={type:'MultiPolygon',coordinates:[rect.coordinates,[[[5.03,46],[5.04,46],[5.04,46.01],[5.03,46]]]]};
  assert.equal((silhouettePath(multi).match(/M/g)||[]).length,2);
  assert.equal(silhouettePath(null),'');assert.equal(silhouettePath({type:'Point',coordinates:[5,46]}),'');
  assert.equal(silhouettePath({type:'Polygon',coordinates:[[[5,46],[5,46],[5,46],[5,46]]]}),'');
});
test('les longs contours sont allégés', () => {
  const ring=[];for(let i=0;i<2000;i++){const a=i/2000*2*Math.PI;ring.push([5+Math.cos(a)*.01,46+Math.sin(a)*.01]);}ring.push(ring[0]);
  assert.ok((silhouettePath({type:'Polygon',coordinates:[ring]}).match(/L/g)||[]).length<=170);
});
test('cache par version de parcelle', () => {
  const p={id:'a',version:1,geometry:rect};const d=cachedSilhouette(p);const n=silhouetteCacheSize();
  assert.equal(cachedSilhouette(p),d);assert.equal(silhouetteCacheSize(),n);
  cachedSilhouette({...p,version:2});assert.equal(silhouetteCacheSize(),n+1);
  assert.equal(cachedSilhouette({id:'b'}),'');
});
test('frise de rotation sur 3 campagnes', () => {
  assert.equal(shiftCampaign('2026/27',-2),'2024/25');
  const rot=[{parcelId:'a',campaignId:'2024/25',culture:'Maïs'},{parcelId:'a',campaignId:'2025/26',culture:'Blé',deletedAt:1},{parcelId:'b',campaignId:'2025/26',culture:'Orge'}];
  assert.deepEqual(rotationFrieze({id:'a',culture:'Colza'},rot,'2026/27'),[{campaignId:'2024/25',culture:'Maïs',current:false},{campaignId:'2025/26',culture:'',current:false},{campaignId:'2026/27',culture:'Colza',current:true}]);
});
