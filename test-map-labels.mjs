import test from 'node:test';
import assert from 'node:assert/strict';
import {polylabel,labelPoint,labelLevel,labelLines,resolveLabelCollisions,parcelDayFlags,animateHighlights,labelFlagClasses,nextWorkText,MAP_ANIMATION_LIMIT} from './map-labels.js';
import {pointInGeometry} from './utils.js';
import {parcelSituation} from './home-priorities.js';

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

// n° 30 : classification aujourd'hui / retard / pâturage.
const TODAY='2026-10-15';
test('parcelDayFlags : travail à faire aujourd’hui, en retard, ou clos', () => {
  const data={interventions:[
    {id:'w1',parcelId:'p1',status:'Planifié',plannedDate:'2026-10-15'},
    {id:'w2',parcelId:'p2',status:'Planifié',plannedDate:'2026-10-10'},
    {id:'w3',parcelId:'p3',status:'Terminé',date:'2026-10-15'},
    {id:'w4',parcelId:'p4',status:'Planifié',plannedDate:'2026-10-15',deletedAt:'2026-10-14'},
    {id:'w5',parcelId:'p5',status:'Planifié',plannedDate:'2026-10-20'}
  ]};
  assert.deepEqual(parcelDayFlags(data,'p1',TODAY),{today:true,late:false,grazing:false});
  assert.deepEqual(parcelDayFlags(data,'p2',TODAY),{today:false,late:true,grazing:false});
  assert.deepEqual(parcelDayFlags(data,'p3',TODAY),{today:false,late:false,grazing:false});
  assert.deepEqual(parcelDayFlags(data,'p4',TODAY),{today:false,late:false,grazing:false});
  assert.deepEqual(parcelDayFlags(data,'p5',TODAY),{today:false,late:false,grazing:false});
});

test('parcelDayFlags : les tâches comptent, un travail sans date n’est ni du jour ni en retard', () => {
  const data={interventions:[{id:'w',parcelId:'p1',status:'Planifié'}],tasks:[{id:'t',parcelId:'p1',status:'À faire',dueDate:'2026-10-01'}]};
  assert.deepEqual(parcelDayFlags(data,'p1',TODAY),{today:false,late:true,grazing:false});
  assert.deepEqual(parcelDayFlags({interventions:[{id:'w',parcelId:'p1',status:'Planifié'}]},'p1',TODAY),{today:false,late:false,grazing:false});
});

test('parcelDayFlags : lot au pâturage en cours seulement', () => {
  const grazingSessions=[
    {id:'g1',parcelId:'p1',startDate:'2026-10-01',animalType:'Bovins',count:10},
    {id:'g2',parcelId:'p2',startDate:'2026-09-01',endDate:'2026-09-20',animalType:'Ovins',count:5}
  ];
  assert.equal(parcelDayFlags({grazingSessions},'p1',TODAY).grazing,true);
  assert.equal(parcelDayFlags({grazingSessions},'p2',TODAY).grazing,false);
  assert.deepEqual(parcelDayFlags(undefined,'p1',TODAY),{today:false,late:false,grazing:false});
});

test('animateHighlights : seuil de 200 parcelles', () => {
  assert.equal(MAP_ANIMATION_LIMIT,200);
  assert.equal(animateHighlights(200),true);
  assert.equal(animateHighlights(201),false);
});

test('labelFlagClasses : le retard prime sur aujourd’hui', () => {
  assert.equal(labelFlagClasses({today:true,late:true,grazing:true}),'is-late is-grazing');
  assert.equal(labelFlagClasses({today:true,late:false,grazing:false}),'is-today');
  assert.equal(labelFlagClasses(null),'');
});

test('nextWorkText : formulations selon l’échéance', () => {
  assert.equal(nextWorkText(null,TODAY),'Aucun travail prévu');
  assert.equal(nextWorkText({item:{type:'Semis'},kind:'work',date:TODAY,overdue:false},TODAY),'Aujourd’hui · Semis');
  assert.equal(nextWorkText({item:{type:'Traitement'},kind:'work',date:'2026-10-03',overdue:true},TODAY),'En retard (03/10) · Traitement');
  assert.equal(nextWorkText({item:{title:'Clôture'},kind:'task',date:'2026-10-20',overdue:false},TODAY),'20/10 · Clôture');
  assert.equal(nextWorkText({item:{status:'En cours'},kind:'work',date:'',overdue:false},TODAY),'En cours · Travail');
});

test('parcelDayFlags et parcelSituation s’accordent sur une tâche du jour', () => {
  const data={interventions:[],tasks:[{id:'t',parcelId:'p1',status:'À faire',dueDate:TODAY}],grazingSessions:[]};
  assert.equal(parcelDayFlags(data,'p1',TODAY).today,true);
  assert.equal(parcelSituation(data,'p1',TODAY).status.key,'today');
  data.tasks[0].status='Terminée';
  assert.equal(parcelDayFlags(data,'p1',TODAY).today,false);
  assert.notEqual(parcelSituation(data,'p1',TODAY).status.key,'today');
});
