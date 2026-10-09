import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseShpDbf} from './shapefile-fallback.js';
import {readZip,createZip} from './zip-lite.js';
import {parcelShapefile,parcelShapefileZip,parcelsKml,parcelsIsoxml,kmlToGeoJson,kmlColor,exportableParcels} from './parcel-formats.js';
import {geometryAreaHa} from './utils.js';

// Fixture ANONYMISÉE uniquement (fixtures/parcelles-fictives.*).
const buf=ext=>{const b=fs.readFileSync(new URL(`./fixtures/parcelles-fictives${ext}`,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const fixture=parseShpDbf({shp:buf('.shp'),dbf:buf('.dbf'),prj:fs.readFileSync(new URL('./fixtures/parcelles-fictives.prj',import.meta.url),'utf8')});
const parcels=fixture.geojson.features.map((f,i)=>({id:`p${i}`,nom:f.properties.NOM_PARCEL,culture:f.properties.CP_CULTU,surfaceHa:Number(f.properties.SURFACE),ilot:f.properties.NUM_ILOT,geometry:f.geometry}));
const firstCoord=g=>g.type==='Polygon'?g.coordinates[0][0]:g.coordinates[0][0][0];

test('fixture : 22 parcelles exportables', () => {
  assert.equal(exportableParcels({parcelles:[...parcels,{id:'x',nom:'Sans contour'},{id:'y',nom:'Suppr',deletedAt:'z',geometry:parcels[0].geometry}]}).length,22);
});

test('Shapefile aller-retour : nom accentué, culture, ha, îlot et contours', async () => {
  const files=parcelShapefile(parcels);
  assert.equal(files.cpg,'UTF-8');
  const back=parseShpDbf({shp:files.shp,dbf:files.dbf,prj:files.prj,cpg:files.cpg});
  assert.equal(back.geojson.features.length,22);
  back.geojson.features.forEach((f,i)=>{
    const p=parcels[i];
    assert.equal(f.properties.NOM,p.nom);assert.equal(f.properties.CULTURE,p.culture);
    assert.ok(Math.abs(Number(f.properties.HA)-p.surfaceHa)<1e-4);
    assert.equal(String(f.properties.ILOT??''),String(p.ilot??''));
    assert.ok(Math.abs(geometryAreaHa(f.geometry)-geometryAreaHa(p.geometry))<1e-6,`surface géométrique ${p.nom}`);
    const a=firstCoord(f.geometry),b=p.geometry;const ring=(b.type==='Polygon'?b.coordinates[0]:b.coordinates[0][0]);
    assert.ok(ring.some(c=>Math.abs(c[0]-a[0])<1e-9&&Math.abs(c[1]-a[1])<1e-9));
  });
  const zip=await readZip(await parcelShapefileZip(parcels));
  assert.deepEqual(zip.map(e=>e.name).sort(),['parcelles.cpg','parcelles.dbf','parcelles.prj','parcelles.shp','parcelles.shx']);
});

test('Shapefile : un nom trop long est tronqué sans casser un caractère', () => {
  const long={...parcels[0],nom:'É'.repeat(80)};
  const back=parseShpDbf({shp:parcelShapefile([long]).shp,dbf:parcelShapefile([long]).dbf,cpg:'UTF-8'});
  assert.equal(back.geojson.features[0].properties.NOM,'É'.repeat(50));
});

test('KML aller-retour : couleur par culture, nom en étiquette, attributs', () => {
  const kml=parcelsKml(parcels,{colorFor:p=>/prairie/i.test(p.culture)?'#6fb37a':'#d9a441'});
  assert.match(kml,/<kml xmlns="http:\/\/www.opengis.net\/kml\/2.2">/);
  assert.match(kml,/<PolyStyle><color>807ab36f<\/color>/);
  const back=kmlToGeoJson(kml);
  assert.equal(back.features.length,22);
  back.features.forEach((f,i)=>{
    assert.equal(f.properties.nom,parcels[i].nom);assert.equal(f.properties.culture,parcels[i].culture);
    assert.ok(Math.abs(Number(f.properties.surface_ha)-parcels[i].surfaceHa)<0.006);
    assert.ok(Math.abs(geometryAreaHa(f.geometry)-geometryAreaHa(parcels[i].geometry))<1e-4);
  });
  assert.equal(kmlColor('#112233'),'ff332211');
});

test('KMZ : doc.kml dans un ZIP, lu par zip-lite', async () => {
  const kmz=await createZip([{name:'doc.kml',data:new Blob([parcelsKml(parcels.slice(0,3))])}]);
  const [entry]=await readZip(kmz);
  assert.equal(kmlToGeoJson(await entry.text()).features.length,3);
});

test('KML externe : polygone avec trou, MultiGeometry, CDATA ; points ignorés', () => {
  const kml=`<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name><![CDATA[Pré & bois]]></name><Polygon><outerBoundaryIs><LinearRing><coordinates>5,46,0 5.01,46,0 5.01,46.01,0 5,46.01,0</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>5.004,46.004 5.006,46.004 5.006,46.006 5.004,46.004</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
  <Placemark><name>Deux morceaux</name><ExtendedData><SchemaData><SimpleData name="culture">Maïs</SimpleData></SchemaData></ExtendedData><MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>6,46 6.01,46 6.01,46.01 6,46</coordinates></LinearRing></outerBoundaryIs></Polygon><Polygon><outerBoundaryIs><LinearRing><coordinates>6.02,46 6.03,46 6.03,46.01 6.02,46</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry></Placemark>
  <Placemark><name>Point</name><Point><coordinates>5,46</coordinates></Point></Placemark></Document></kml>`;
  const {features}=kmlToGeoJson(kml);
  assert.equal(features.length,2);
  assert.equal(features[0].properties.nom,'Pré & bois');
  assert.equal(features[0].geometry.coordinates.length,2,'trou conservé');
  assert.deepEqual(features[0].geometry.coordinates[0][0],features[0].geometry.coordinates[0].at(-1),'anneau fermé');
  assert.equal(features[1].geometry.type,'MultiPolygon');assert.equal(features[1].properties.culture,'Maïs');
  assert.throws(()=>kmlToGeoJson('<gpx/>'),/KML invalide/);
});

test('ISOXML parcellaire : une PFD par parcelle avec contours PLN', () => {
  const {xml,parcelCount}=parcelsIsoxml(parcels);
  assert.equal(parcelCount,22);
  assert.equal((xml.match(/<PFD /g)||[]).length,22);
  assert.ok((xml.match(/<PLN A="1">/g)||[]).length>=22);
  assert.ok(xml.includes(`C="${parcels[0].nom.slice(0,32).replace(/'/g,'&apos;')}"`));
  assert.match(xml,/^<\?xml version="1.0" encoding="UTF-8"\?><ISO11783_TaskData /);
});
