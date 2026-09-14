import assert from 'node:assert/strict';
import {parseImportDate,geometryCentroid,haversineMeters,pointInGeometry,normalize,toNullableNumber,validateGeometry} from '../js/utils.js';

assert.equal(parseImportDate('14/09/2026'),'2026-09-14');
assert.equal(parseImportDate('2026-09-14'),'2026-09-14');
assert.equal(parseImportDate('31/02/2026'),null);
assert.equal(toNullableNumber('0'),0);
assert.equal(normalize('Bâgé-Dommartin'),'bage dommartin');
const polygon={type:'Polygon',coordinates:[[[5,46],[5.01,46],[5.01,46.01],[5,46.01],[5,46]]]};
assert.deepEqual(validateGeometry(polygon),[]);
const c=geometryCentroid(polygon);
assert.ok(c.longitude>5&&c.longitude<5.01&&c.latitude>46&&c.latitude<46.01);
assert.equal(pointInGeometry(5.005,46.005,polygon),true);
assert.equal(pointInGeometry(6,47,polygon),false);
assert.ok(haversineMeters({latitude:46,longitude:5},{latitude:46.01,longitude:5})>1000);
console.log('✓ Utilitaires : dates FR, zéro valide, géométrie et distance validés.');
