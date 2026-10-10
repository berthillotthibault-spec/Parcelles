import test from 'node:test';
import assert from 'node:assert/strict';
import {bearingDeg,arrowRotation,compassLabel,formatDistance,headingFromOrientation,headingFromGps,approachInfo,whereAmI,entryPointFor,APPROACH_MAX_M} from './approach.js';

const sq=(x,y,d=0.004)=>({type:'Polygon',coordinates:[[[x,y],[x+d,y],[x+d,y+d],[x,y+d],[x,y]]]});
const parcel={id:'p1',nom:'Pré du Moulin',culture:'Prairie',geometry:sq(5,46)};

test('cap et flèche', () => {
  assert.ok(Math.abs(bearingDeg({latitude:46,longitude:5},{latitude:46.01,longitude:5})-0)<0.01);
  assert.ok(Math.abs(bearingDeg({latitude:46,longitude:5},{latitude:46,longitude:5.01})-90)<0.1);
  assert.equal(arrowRotation(90,30),60);
  assert.equal(arrowRotation(10,350),20);
  assert.equal(arrowRotation(45,null),45);
  assert.equal(compassLabel(44),'nord-est');assert.equal(compassLabel(350),'nord');assert.equal(compassLabel(200),'sud');
});

test('distances et orientation de l’appareil', () => {
  assert.equal(formatDistance(437),'435 m');assert.equal(formatDistance(1530),'1,5 km');
  assert.equal(headingFromOrientation({webkitCompassHeading:120}),120);
  assert.equal(headingFromOrientation({absolute:true,alpha:90}),270);
  assert.equal(headingFromOrientation({absolute:false,alpha:90}),null);
  assert.equal(headingFromGps({heading:80,speed:2}),80);
  assert.equal(headingFromGps({heading:80,speed:0}),null);
});

test('approche : entrée de champ, côté et seuil de 2 km', () => {
  const entry={id:'e',parcelId:'p1',type:'Entrée de champ',latitude:46.004,longitude:5.004};
  const info=approachInfo({latitude:45.995,longitude:5.002},parcel,[entry]);
  assert.equal(info.isEntry,true);assert.equal(info.entrySide,'Entrée côté nord-est');
  assert.ok(info.near);assert.ok(info.distanceM>900&&info.distanceM<1200);
  const far=approachInfo({latitude:45.97,longitude:5.002},parcel,[]);
  assert.equal(far.near,false);assert.ok(far.distanceM>APPROACH_MAX_M);
  assert.match(far.entrySide,/centre/);
  assert.equal(approachInfo({latitude:46.002,longitude:5.002},parcel,[]).arrived,true);
  assert.equal(approachInfo({},parcel,[]),null);
});

test('Où suis-je : parcelle, culture, animaux et durée', () => {
  const now=new Date('2026-10-10T12:00:00');
  const data={parcelles:[parcel],grazingSessions:[{id:'g',parcelId:'p1',animalType:'Vaches',animalsCount:24,startDate:'2026-10-04'}]};
  assert.equal(whereAmI({latitude:46.002,longitude:5.002},data,{now}).text,'Vous êtes dans : Pré du Moulin · Prairie · 24 vaches depuis 6 j');
  assert.equal(whereAmI({latitude:46.002,longitude:5.002},{parcelles:[parcel],grazingSessions:[]},{now}).text,'Vous êtes dans : Pré du Moulin · Prairie');
  assert.equal(whereAmI({latitude:47,longitude:5},data,{now}),null);
  assert.equal(whereAmI({latitude:46.002,longitude:5.002},{parcelles:[{...parcel,archived:true}]},{now}),null);
});

test('Définir l’entrée ici : mise à jour ou création', () => {
  const pos={latitude:46.001,longitude:5.0005,accuracy:6};
  const created=entryPointFor(parcel,[],pos);
  assert.equal(created.type,'Entrée de champ');assert.equal(created.parcelId,'p1');assert.equal(created.id,undefined);
  const existing={id:'e1',parcelId:'p1',type:'Entrée de champ',nom:'Portail',latitude:1,longitude:1};
  const updated=entryPointFor(parcel,[existing],{...pos,accuracy:40});
  assert.equal(updated.id,'e1');assert.equal(updated.nom,'Portail');assert.equal(updated.latitude,46.001);assert.match(updated.note,/contrôler/);
});
