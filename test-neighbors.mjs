import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NEIGHBOR_TYPES,distanceToParcel,neighborsNear,neighborSummary,needsBeeReminder,neighborMessage,contactLinks,contactPatch,isNeighborPoint} from './neighbors.js';

const LAT=46.34,LON=5.13,mLat=1/111320,mLon=1/(111320*Math.cos(LAT*Math.PI/180));
const parcel={id:'p',nom:'La Côte',commune:'Montrevel',culture:'Colza',geometry:{type:'Polygon',coordinates:[[[LON,LAT],[LON+200*mLon,LAT],[LON+200*mLon,LAT+200*mLat],[LON,LAT+200*mLat],[LON,LAT]]]}};
const pt=(type,x,y,extra={})=>({id:`${type}${x}${y}`,type,latitude:LAT+y*mLat,longitude:LON+x*mLon,...extra});

test('distance au contour', () => {
  assert.equal(distanceToParcel(pt('Habitation',100,100),parcel.geometry),0);
  assert.ok(Math.abs(distanceToParcel(pt('Habitation',250,100),parcel.geometry)-50)<0.5);
  assert.equal(distanceToParcel({latitude:'x'},parcel.geometry),null);
});

test('voisins à proximité et résumé', () => {
  const points=[pt('Habitation',250,100),pt('Habitation',-30,10),pt('Rucher (contact apiculteur)',100,260),pt('Habitation',600,0),pt('Point d’eau',210,0),{...pt('Établissement sensible',205,0),deletedAt:1}];
  const rows=neighborsNear(parcel,points,100);
  assert.equal(rows.length,3);assert.equal(rows[0].distance<31,true);
  assert.equal(neighborSummary(rows),'2 habitations et 1 rucher à proximité');
  assert.equal(neighborsNear(parcel,points,20).length,0);
  assert.equal(neighborSummary([{kind:'etablissement'}]),'1 établissement sensible à proximité');
  assert.equal(neighborSummary([{kind:'habitation'},{kind:'rucher'},{kind:'etablissement'},{kind:'etablissement'}]),'1 habitation, 1 rucher et 2 établissements sensibles à proximité');
  assert.equal(neighborSummary([]),'');
  assert.ok(NEIGHBOR_TYPES.every(t=>isNeighborPoint({type:t})));
});

test('rappel abeilles pour le colza en fleur', () => {
  assert.equal(needsBeeReminder(parcel,{stage:'Floraison'}),true);
  assert.equal(needsBeeReminder(parcel,{stage:'BBCH 65'}),true);
  assert.equal(needsBeeReminder(parcel,{stage:'BBCH 32'}),false);
  assert.equal(needsBeeReminder(parcel,{date:'2026-04-10'}),true);
  assert.equal(needsBeeReminder(parcel,{date:'2026-10-10'}),false);
  assert.equal(needsBeeReminder({culture:'Blé'},{stage:'floraison'}),false);
});

test('message et liens SMS / e-mail', () => {
  const msg=neighborMessage({parcel,work:{date:'2026-04-10',startTime:'19:00',endTime:'21:00',product:'Produit X'},farmName:'GAEC Test',contactName:'M. Dupont'});
  assert.match(msg,/Bonjour M\. Dupont/);assert.match(msg,/Produit X/);assert.match(msg,/10\/04\/2026 entre 19:00 et 21:00/);assert.match(msg,/La Côte, Montrevel/);
  const l=contactLinks({phone:'06 12 34 56 78',email:'a@b.fr'},msg);
  assert.ok(l.sms.startsWith('sms:0612345678?&body=Bonjour'));assert.ok(l.mailto.startsWith('mailto:a%40b.fr?subject='));
  assert.deepEqual(contactLinks({phone:'',email:'faux'},msg),{});
});

test('coordonnées seulement avec accord', () => {
  assert.throws(()=>contactPatch({contactName:'Dupont',phone:'0612345678'}),/accord/);
  assert.throws(()=>contactPatch({email:'x',contactConsent:'1'}),/e-mail/);
  const ok=contactPatch({contactName:' Dupont ',phone:'06 12 34 56 78',contactConsent:'1'},);
  assert.equal(ok.contactName,'Dupont');assert.equal(ok.contactConsent,true);assert.ok(ok.contactConsentAt>0);
  assert.deepEqual(contactPatch({}),{contactName:'',phone:'',email:'',contactConsent:false,contactConsentAt:null});
});
