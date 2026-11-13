import assert from 'node:assert/strict';
import {parseImportDate,geometryCentroid,haversineMeters,pointInGeometry,normalize,toNullableNumber,validateGeometry} from './utils.js';

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
// Identifiants : jamais de quoi sortir d'un attribut HTML (XSS stockée), mais aucun id légitime refusé.
const {isSafeId}=await import('./state.js');
for(const id of ['obj_m3k2_9zx','p1',12,'parcelle 12','FR-123/4','é_ü']) assert.equal(isSafeId(id),true,String(id));
for(const id of ['x" onmouseover="a','<img>','a`b',"a'b",'','x'.repeat(257),null,{}]) assert.equal(isSafeId(id),false,String(id));

// Statuts au féminin ramenés à « Annulé » et « Terminé » (écriture, chargement).
{
  const {migrateData, normalizeEntity, canonicalStatus, emptyState} = await import('./state.js');
  assert.equal(canonicalStatus('Annulée'), 'Annulé');
  assert.equal(canonicalStatus('À faire'), 'À faire');
  assert.equal(normalizeEntity('interventions', {id: 'w1', parcelId: 'p', type: 'Semis', date: '2026-03-01', status: 'Annulée'}).status, 'Annulé');
  assert.equal(normalizeEntity('tasks', {id: 't1', title: 'x', status: 'Terminée'}).status, 'Terminé');
  const data = migrateData({...emptyState(), interventions: [{id: 'w2', parcelId: 'p', type: 'Semis', date: '2026-03-01', status: 'Terminée'}]});
  assert.equal(data.interventions[0].status, 'Terminé');
}
