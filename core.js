import assert from 'node:assert/strict';
import {campaignFor, normalize, toNumber, validateIntervention, validateParcel} from '../js/utils.js';
import {migrateData} from '../js/state.js';

assert.equal(normalize('Bâgé-Dommartin'), 'bage dommartin');
assert.equal(toNumber('7,50 ha'), 7.5);
assert.equal(campaignFor('2026-01-15'), '2025/26');
assert.equal(campaignFor('2026-09-15'), '2026/27');
assert.deepEqual(validateParcel({nom:'SUD',surfaceHa:7.5}), []);
assert.ok(validateParcel({nom:'',surfaceHa:-1}).length >= 2);
assert.deepEqual(validateIntervention({parcelId:'p_1',date:'2026-09-14',type:'Semis',cost:0}), []);
assert.ok(validateIntervention({parcelId:'',date:'x',type:''}).length >= 3);

const migrated=migrateData({
  parcelles:[{name:'SUD',surface:'7,5',culture:'Blé'}],
  manualInterventions:[{parcelleId:'missing',date:'2026-09-14',operation:'Semis'}]
});
assert.equal(migrated.version,3);
assert.equal(migrated.parcelles[0].nom,'SUD');
assert.ok(migrated.parcelles[0].id);
assert.equal(migrated.interventions[0].type,'Semis');
assert.equal(migrated.interventions[0].campaignId,'2026/27');
console.log('Tests métier : OK');
