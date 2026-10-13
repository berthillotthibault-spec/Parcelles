// n° 47 : vérification du parcellaire (données fictives, géométries synthétiques et fixture anonymisée).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {checkParcels, geometryIssues, matchRpg, overlapArea, rpgYearOptions, surfaceGaps} from './parcel-check.js';
import {parseShpDbf} from './shapefile-fallback.js';
import {geometryAreaHa} from './utils.js';

const sq=(x0,y0,w=0.01,h=0.01)=>({type:'Polygon',coordinates:[[[x0,y0],[x0+w,y0],[x0+w,y0+h],[x0,y0+h],[x0,y0]]]});
const parcel=(id,geometry,extra={})=>({id,nom:id,geometry,surfaceHa:Math.round(geometryAreaHa(geometry)*100)/100,...extra});
const rpgFeature=(id,geometry,surf)=>({type:'Feature',geometry,properties:{id_parcel:id,surf_parc:surf??Math.round(geometryAreaHa(geometry)*100)/100}});

test('contours : non fermé, auto-intersecté, correct', ()=>{
  assert.deepEqual(geometryIssues(sq(5,46)),[]);
  assert.deepEqual(geometryIssues({type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1]]]}),['open']);
  const bowtie={type:'Polygon',coordinates:[[[0,0],[1,1],[1,0],[0,1],[0,0]]]};
  assert.deepEqual(geometryIssues(bowtie),['self']);
  assert.deepEqual(geometryIssues({type:'Polygon',coordinates:[[[0,0],[1,0],[0,0]]]}),['short']);
});

test('chevauchement approché par grille', ()=>{
  const a=sq(5,46,0.01,0.01),b=sq(5.005,46,0.01,0.01);
  const half=geometryAreaHa(a)/2,{areaHa,bbox}=overlapArea(a,b);
  assert.ok(Math.abs(areaHa-half)/half<0.03,`${areaHa} ≈ ${half}`);
  assert.ok(bbox[0]>=5.0049&&bbox[2]<=5.0101);
  assert.equal(overlapArea(a,sq(6,46)).areaHa,0);
  assert.ok(overlapArea(a,sq(5.01,46)).areaHa<0.01,'bord commun : pas de chevauchement');
});

test('écarts de surface > 2 % entre saisie, contour, déclarée et RPG', ()=>{
  const g=sq(5,46),area=geometryAreaHa(g);
  assert.equal(surfaceGaps({surfaceHa:area,geometry:g}).worst,null);
  assert.equal(surfaceGaps({surfaceHa:area*1.019,geometry:g}).worst,null,'1,9 % toléré');
  const gap=surfaceGaps({surfaceHa:area,geometry:g,declaredSurfaceHa:area*0.9}).worst;
  assert.ok(gap&&gap.gap>0.09&&gap.gap<0.11);
  const rpg=surfaceGaps({surfaceHa:area,geometry:g},{rpgFeature:rpgFeature('7',g,area*1.2)}).worst;
  assert.equal(rpg.b.label,'RPG');
});

test('contrôle complet : chevauchement, surface, découpe RPG, RPG non reprise', ()=>{
  const state={parcelles:[
    parcel('A',sq(5,46,0.02,0.01)),
    parcel('B',sq(5.015,46,0.01,0.01)),               // chevauche A sur un quart
    parcel('C',sq(5.1,46),{surfaceHa:5}),               // surface saisie fausse
    parcel('D',{type:'Polygon',coordinates:[[[5.2,46],[5.21,46.01],[5.21,46],[5.2,46.01],[5.2,46]]]}),
    parcel('E',sq(5.3,46,0.02,0.01)),
    parcel('Supprimée',sq(5,46),{deletedAt:1}),
    parcel('Client',sq(5,46),{ownershipType:'client'})
  ]};
  const rpg=[rpgFeature('E1',sq(5.3,46)),rpgFeature('E2',sq(5.31,46)),rpgFeature('X',sq(5.32,46,0.01,0.01)),rpgFeature('voisin',sq(5.5,46))];
  // Une parcelle RPG à cheval sur E (moitié dedans) mais dont le centre est dehors.
  rpg.push(rpgFeature('F',sq(5.315,46.008,0.004,0.004)));
  const r=checkParcels(state,{rpgFeatures:rpg,rpgYear:2025});
  assert.equal(r.checked,5);
  assert.equal(r.counts.overlap,1);
  const overlap=r.issues.find(i=>i.kind==='overlap');
  assert.deepEqual(overlap.parcelIds,['A','B']);
  assert.ok(overlap.overlapHa>0.5&&overlap.geometry.type==='Polygon');
  assert.equal(r.counts.geometry,1);
  assert.ok(r.issues.find(i=>i.kind==='surface'&&i.parcelIds[0]==='C'));
  assert.ok(r.issues.find(i=>i.kind==='rpg-split'&&i.parcelIds[0]==='E'));
  const missing=r.issues.filter(i=>i.kind==='rpg-missing').map(i=>i.rpgId);
  assert.deepEqual(missing,['F'],'X (bord commun) et le voisin éloigné ne sont pas signalés');
  assert.equal(r.rpgYear,2025);
  const offline=checkParcels(state);
  assert.equal(offline.counts['rpg-split'],undefined,'sans RPG : contrôles locaux seulement');
  assert.equal(offline.rpgYear,null);
});

test('correspondance RPG par identifiant mémorisé ou par centre', ()=>{
  const f1=rpgFeature('123',sq(5,46)),f2=rpgFeature('456',sq(5.1,46));
  assert.equal(matchRpg({rpgId:'456',geometry:sq(5,46)},[f1,f2]),f2);
  assert.equal(matchRpg({sourceId:'rpg:2024:parcel:123',geometry:sq(9,9)},[f1,f2]),f1);
  assert.equal(matchRpg({geometry:sq(5.001,46.001,0.005,0.005)},[f1,f2]),f1);
});

test('millésimes RPG : le plus récent d’abord', ()=>{
  const years=rpgYearOptions(new Date('2026-10-12'));
  assert.equal(years[0],2025);assert.equal(years.at(-1),2020);
});

test('fixture anonymisée : défauts dus au bruit d’anonymisation repérés, surfaces cohérentes', ()=>{
  const read=ext=>{const b=fs.readFileSync(new URL(`./fixtures/parcelles-fictives${ext}`,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
  const features=parseShpDbf({shp:read('.shp'),dbf:read('.dbf'),prj:fs.readFileSync(new URL('./fixtures/parcelles-fictives.prj',import.meta.url),'utf8')}).geojson.features;
  const state={parcelles:features.map((f,i)=>({id:`p${i}`,nom:f.properties.NOM_PARCEL,geometry:f.geometry,surfaceHa:Number(f.properties.SURFACE)}))};
  const r=checkParcels(state);
  assert.equal(r.checked,features.length);
  // Le bruit de quelques mètres ajouté à chaque sommet par tools/make-fixture.mjs crée de petits recoupements.
  assert.ok(r.issues.some(i=>i.kind==='geometry'&&i.title.startsWith('PETIT PRÉ')&&i.codes.includes('self')));
  assert.equal(r.counts.surface||0,0,'surface du fixture recalculée sur le contour');
  assert.ok(r.issues.filter(i=>i.kind==='overlap').every(i=>i.overlapHa>=0.01));
});
