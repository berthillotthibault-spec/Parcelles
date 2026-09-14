import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {emptyState,migrateData} from '../js/state.js';
import {buildStatistics} from '../js/statistics.js';
import {computeNotifications} from '../js/notifications.js';
import {clientReportHtml,equipmentReportHtml} from '../js/reports.js';
import {APP_VERSION} from '../js/utils.js';

const state=emptyState();
state.parcelles.push({id:'p1',nom:'Pré du Moulin',surfaceHa:4.2,culture:'Prairie',ownershipType:'own',deletedAt:null});
state.interventions.push({id:'w1',parcelId:'p1',type:'Fauche',date:'2026-09-14',campaignId:'2026/27',cost:84,durationHours:2,machineCost:50,deletedAt:null});
state.tasks.push({id:'t1',title:'Contrôler clôture',dueDate:'2020-01-01',status:'À faire',deletedAt:null});
state.materiels.push({id:'m1',nom:'Tracteur',currentMeter:995,maintenanceDue:1000,deletedAt:null});
state.stockItems.push({id:'s1',name:'Semences',quantity:0,unit:'kg',alertBelow:20,deletedAt:null});
state.clients.push({id:'c1',name:'Client Test',deletedAt:null});
state.parcelles.push({id:'pc',nom:'Client 1',surfaceHa:3,culture:'Maïs',ownershipType:'client',clientId:'c1',deletedAt:null});
state.interventions.push({id:'wc',parcelId:'pc',type:'Semis',date:'2026-09-14',campaignId:'2026/27',cost:120,deletedAt:null});
state.maintenanceRecords.push({id:'r1',equipmentId:'m1',date:'2026-08-01',meter:980,type:'Vidange',cost:90,deletedAt:null});

const stats=buildStatistics(state,{campaign:'2026/27'});
assert.equal(stats.parcelCount,1);
assert.equal(stats.area,4.2);
assert.equal(stats.workCount,2);
assert.ok(stats.totalCost>=204);
assert.ok(stats.byCulture.some(x=>x.name==='Prairie'));

const notifications=computeNotifications(state);
assert.ok(notifications.some(x=>x.id==='stock-s1'),'stock faible/épuisé doit être notifié');
assert.ok(notifications.some(x=>x.entity==='materiels'),'entretien proche doit être notifié');
assert.ok(notifications.some(x=>x.entity==='tasks'),'tâche en retard doit être notifiée');

assert.match(clientReportHtml(state,'c1'),/Client Test/);
assert.match(equipmentReportHtml(state,'m1'),/Vidange/);

const migrated=migrateData({version:4,parcelles:[],interventions:[],preferences:{},metadata:{}});
assert.equal(migrated.version,APP_VERSION);
for(const key of ['observations','stockItems','maintenanceRecords','routeSessions'])assert.ok(Array.isArray(migrated[key]),`${key} doit exister après migration`);
assert.ok(Object.hasOwn(migrated.preferences,'remoteAiEnabled'));

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
const imports=[...app.matchAll(/from ['"](\.\/[^'"]+)['"]/g)].map(m=>m[1]);
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'js/runtime.js'),'utf8');
for(const imp of imports){const rel=`./js/${imp.replace('./','')}`;assert.ok(sw.includes(rel),`SW doit mettre en cache ${rel}`);assert.ok(runtime.includes(rel),`Diagnostic doit vérifier ${rel}`);}
console.log('✓ Parcelles 4.0 : migrations, pilotage, notifications, rapports et ressources validés.');
