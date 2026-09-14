import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {searchEverything,recentWorkSuggestions} from '../js/insights.js';
import {BUILD_ID} from '../js/utils.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const state={
  parcelles:[
    {id:'p1',nom:'LAURENCIN',surfaceHa:5.7537,culture:"Orge 2 rangs d'hiver",commune:'Montrevel-en-Bresse'},
    {id:'p2',nom:'Pré du Moulin',surfaceHa:3.2,culture:'Prairie',commune:'Bâgé-Dommartin'}
  ],
  interventions:[
    {id:'w1',parcelId:'p2',type:'Fauche',product:'',date:'2026-09-14',updatedAt:3},
    {id:'w2',parcelId:'p1',type:'Semis',product:'Orge',date:'2026-09-10',updatedAt:2},
    {id:'w3',parcelId:'p2',type:'Fauche',product:'',date:'2026-08-10',updatedAt:1}
  ],
  tasks:[],materiels:[],clients:[],points:[],observations:[],stockItems:[],documents:[]
};

assert.match(BUILD_ID,/^2026\.09\.14-v(?:4\.[12]|5\.0)\.0$/);
let rows=searchEverything(state,'parcelles orge > 5');
assert.equal(rows[0]?.id,'p1','Recherche parcelle + culture + surface');
rows=searchEverything(state,'laurencn');
assert.equal(rows[0]?.id,'p1','Recherche tolérante à une petite faute');
rows=searchEverything(state,'travaux fauche');
assert.ok(rows.length&&rows.every(r=>r.type==='work'),'Filtre de type travaux');
assert.equal(rows[0]?.id,'w1');
const suggestions=recentWorkSuggestions(state,3);
assert.deepEqual(suggestions.map(x=>x.id),['w1','w2'],'Raccourcis de travaux distincts');

const app=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
assert.match(app,/installErrorRecorder\(\{buildId:BUILD_ID\}\)/);
assert.match(app,/Aucun suivi ne démarre automatiquement/);
assert.doesNotMatch(app,/if\(lastGps\)renderFieldGps\(lastGps\);else requestGps\(\)/);
assert.match(index,/id="today-quick-actions"/);
assert.match(index,/value="distance">Distance/);
assert.match(sw,/diagnostics\.js/);
console.log('✓ Parcelles 4.1 : recherche intelligente, raccourcis, diagnostic et confidentialité terrain validés.');
