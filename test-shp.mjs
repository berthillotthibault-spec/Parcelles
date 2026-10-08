import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseShpDbf} from './shapefile-fallback.js';

const here=path.dirname(fileURLToPath(import.meta.url));
// Jeu ANONYMISÉ généré par tools/make-fixture.mjs : noms, communes et identifiants fictifs,
// géométries déplacées, même structure qu'un export réel (Lambert-93, DBF Windows-1252 accentué).
const find=ext=>path.join(here,'fixtures','parcelles-fictives'+ext);
const asArrayBuffer=file=>{const b=fs.readFileSync(file);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const dbf=asArrayBuffer(find('.dbf'));
assert.equal(new Uint8Array(dbf)[29],0x03,'pilote de langue DBF Windows-1252');
const result=parseShpDbf({shp:asArrayBuffer(find('.shp')),dbf,prj:fs.readFileSync(find('.prj'),'utf8')});

assert.equal(result.diagnostic.shapeType,5);
assert.equal(result.diagnostic.projection,'lambert93');
assert.equal(result.diagnostic.shapeCount,22);
assert.equal(result.diagnostic.recordCount,22);
assert.equal(result.geojson.features.length,22);
assert.ok(result.diagnostic.fields.includes('GUID_PARC'));
assert.ok(result.diagnostic.fields.includes('NOM_PARCEL'));
assert.equal(result.diagnostic.fields.length,135,'schéma DBF complet de l\'export');
const first=result.geojson.features[0];
assert.equal(first.properties.NOM_PARCEL,'LES GRANDS PRÉS');
assert.equal(first.properties.LIB_COMMUN,'Saint-Fictif-en-Bresse');
assert.equal(first.properties.RAIS_SOCIA,'EARL DU PRÉ FICTIF');
assert.equal(first.properties.CP_CULTU,"Orge 2 rangs d'hiver");
assert.ok(Math.abs(Number(first.properties.SURFACE)-5.7589929)<1e-7);
const coord=first.geometry.type==='Polygon'?first.geometry.coordinates[0][0]:first.geometry.coordinates[0][0][0];
assert.ok(Math.abs(coord[0]-2.759655)<0.00002);
assert.ok(Math.abs(coord[1]-46.980327)<0.00002);
const names=result.geojson.features.map(f=>f.properties.NOM_PARCEL);
for(const name of ["PRÉ DE L'ÉTANG","COMBE À L'ÂNE",'SOUS LA CÔTE','LA BRUYÈRE','LES PÂTIS','CHAMP NOËL'])assert.ok(names.includes(name),`accent conservé : ${name}`);
assert.deepEqual([...new Set(result.geojson.features.map(f=>f.properties.LIB_COMMUN))].sort(),['Bourg-Imaginaire','Les Prés-Dorés','Saint-Fictif-en-Bresse',"Val-d'Ève"]);
assert.ok(result.geojson.features.some(f=>f.properties.CP_CULTU==='Prairie perm. pât fauchée'));
assert.ok(result.geojson.features.every(f=>f.properties.SIRET==='99999999900019'&&f.properties.PACAGE==='099999999'),'identifiants d\'exploitation fictifs');
const total=result.geojson.features.reduce((s,f)=>s+(Number(f.properties.SURFACE)||0),0);
assert.ok(Math.abs(total-50.4957106)<1e-6);
console.log('✓ SHP fictif : 22 parcelles, DBF Windows-1252 accentué et Lambert-93 validés.');
