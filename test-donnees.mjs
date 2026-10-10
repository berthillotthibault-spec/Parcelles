// n° 143 : non-régression sur les données (migrations, transport cloud, règles Firestore).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {APP_VERSION, ENTITY_TYPES} from './utils.js';
import {emptyState, migrateData} from './state.js';
import {validateBackup} from './import-export.js';
import {encodeCloudPayload, decodeCloudDocument} from './sync.js';
import {roleScope} from './permissions.js';

const DIR=new URL('./fixtures/backups/',import.meta.url);
const fixtures=fs.readdirSync(DIR).filter(name=>name.endsWith('.json')).sort().map(name=>({name,raw:JSON.parse(fs.readFileSync(new URL(name,DIR),'utf8'))}));
const rawState=raw=>raw.format?raw.data:raw;
// Champs renommés ou normalisés par une migration : leur présence suffit, la valeur peut changer de forme.
const NORMALIZED=new Set(['updatedAt','version','date','surfaceHa','tags','documentDate','parcelIds','completedParcelIds','status','campaignId']);
const sourceEntities=(type,data)=>type==='interventions'&&!(data.interventions||[]).length&&Array.isArray(data.manualInterventions)?data.manualInterventions:(data[type]||[]);

test('une fixture par forme historique, de la v1 à la version actuelle',()=>{
  assert.ok(fixtures.length>=10,'au moins dix formes historiques');
  const versions=new Set(fixtures.map(({raw})=>Number(rawState(raw).version)||1));
  assert.ok(versions.has(1)&&versions.has(APP_VERSION),'la plus ancienne et la plus récente sont couvertes');
});

for(const {name,raw} of fixtures){
  test(`migration de ${name}`,async()=>{
    const source=rawState(raw),migrated=migrateData(source);
    assert.equal(migrated.version,APP_VERSION);
    for(const type of ENTITY_TYPES){
      assert.ok(Array.isArray(migrated[type]),`${type} est une liste`);
      const before=sourceEntities(type,source);
      assert.equal(migrated[type].length,before.length,`${type} : aucune fiche perdue`);
      before.forEach((original,index)=>{
        const after=migrated[type][index];
        for(const key of ['id','createdAt','updatedAt'])assert.ok(after[key],`${name} ${type}[${index}].${key} présent`);
        assert.ok(Number.isFinite(after.version),`${name} ${type}[${index}].version présent`);
        for(const [key,value] of Object.entries(original)){
          assert.ok(key in after,`${name} ${type}[${index}] : champ métier « ${key} » perdu`);
          if(!NORMALIZED.has(key)&&value!==null&&value!==undefined)assert.deepEqual(after[key],value,`${name} ${type}[${index}].${key} modifié`);
        }
        if(original.id)assert.equal(after.id,original.id);
        if(original.deletedAt)assert.equal(after.deletedAt,original.deletedAt,'une suppression est conservée');
      });
    }
    // Préférences choisies par l’utilisateur jamais écrasées par les valeurs par défaut.
    for(const [key,value] of Object.entries(source.preferences||{}))if(!['syncRetryMax'].includes(key))assert.deepEqual(migrated.preferences[key],value,`préférence ${key}`);
    // Idempotence : appliquer migrateData deux fois ne change plus rien.
    assert.deepEqual(migrateData(migrated),migrated,'migrateData idempotent');
    assert.deepEqual(migrateData(migrateData(migrated)),migrated);
    // Le même fichier relu comme sauvegarde JSON passe la validation.
    if(raw.format){const {data}=await validateBackup(raw);assert.equal(data.version,APP_VERSION);assert.equal(data.parcelles.length,migrated.parcelles.length);}
  });
}

test('formes particulières : renommages v1, économie v6, observations v8',()=>{
  const get=name=>migrateData(rawState(fixtures.find(f=>f.name===name).raw));
  const v1=get('v01-sans-version.json');
  assert.equal(v1.parcelles[0].nom,'Champ du Moulin');assert.equal(v1.parcelles[0].surfaceHa,7.5);assert.equal(v1.parcelles[1].nom,'Pré sans identifiant');
  assert.equal(v1.interventions[0].parcelId,'p_a');assert.equal(v1.interventions[0].type,'Labour');
  assert.ok(Object.keys(get('v05.json').parcelles[0].economicsByCampaign).length===1);
  assert.deepEqual(get('v07.json').observations.map(o=>o.status),['Résolu','À surveiller']);
  assert.deepEqual(get('v08.json').documents[0].tags,['achat','engrais']);
  assert.deepEqual(get('v16.json').routeSessions[0].parcelIds,['p_k','p_k2']);
  assert.equal(get('v12.json').queue[0].attempts,0);
  assert.equal(get('v17-actuelle.json').vetTreatments[0].withdrawalMeatDays,28);
  assert.deepEqual(get('v16.json').vetTreatments,[]);
});

// ---------- Transport cloud : encodeCloudPayload / decodeCloudDocument ----------
function prng(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const ring=(rand,n)=>{const pts=[];for(let i=0;i<n;i++)pts.push([Number((5+rand()).toFixed(6)),Number((46+rand()).toFixed(6))]);pts.push([...pts[0]]);return pts;};
const polygon=(rand,holes=0)=>[ring(rand,3+Math.floor(rand()*8)),...Array.from({length:holes},()=>ring(rand,3))];
function randomValue(rand,depth=0){
  const r=rand();
  if(depth>3||r<0.25)return [null,true,false,Math.round(rand()*1e6)/100,'texte é ; « ok »',''][Math.floor(rand()*6)];
  if(r<0.45)return Array.from({length:Math.floor(rand()*4)},()=>randomValue(rand,depth+1));
  if(r<0.6)return Array.from({length:1+Math.floor(rand()*3)},()=>Array.from({length:Math.floor(rand()*3)},()=>randomValue(rand,depth+2)));
  const o={};for(let i=0;i<1+Math.floor(rand()*4);i++)o[`k${i}`]=randomValue(rand,depth+1);
  // Objets qui ressemblent aux marqueurs internes : doivent être échappés, jamais confondus.
  if(rand()<0.1)o.parcellesNestedArrayV1='[1]';
  return o;
}
const roundTrip=value=>decodeCloudDocument({payloadEncoding:'nested-arrays-v1',payload:encodeCloudPayload(value)}).payload;
const hasNestedArray=value=>Array.isArray(value)?value.some(Array.isArray)||value.some(hasNestedArray):value&&typeof value==='object'?Object.values(value).some(hasNestedArray):false;

test('aller-retour cloud : Polygon à trous, MultiPolygon et parcelle de type RPG',()=>{
  const rand=prng(143);
  const rpg={id:'p_rpg',nom:'Îlot 12',source:'rpg',sourceId:'RPG-2025-012',surfaceHa:4.32,rpg:{codeCultu:'BTH',ilot:12,pacte:null},
    geometry:{type:'MultiPolygon',coordinates:[polygon(rand,2),polygon(rand,0),polygon(rand,1)]},history:[{campaign:'2024/25',culture:'Maïs'}]};
  const holes={type:'Polygon',coordinates:polygon(rand,3)};
  for(const value of [rpg,{id:'x',geometry:holes},{coords:[[[]]],empty:[],deep:[[[[1]]]]}]){
    const encoded=encodeCloudPayload(value);
    assert.equal(hasNestedArray(encoded),false,'aucun tableau imbriqué n’est envoyé à Firestore');
    assert.deepEqual(roundTrip(value),value);
  }
});

test('aller-retour cloud : 500 valeurs aléatoires (graine fixe)',()=>{
  const rand=prng(20261010);
  for(let i=0;i<500;i++){
    const value={id:`e${i}`,payload:randomValue(rand),geometry:rand()<0.5?{type:'Polygon',coordinates:polygon(rand,Math.floor(rand()*3))}:{type:'MultiPolygon',coordinates:Array.from({length:1+Math.floor(rand()*3)},()=>polygon(rand,Math.floor(rand()*2)))}};
    const encoded=encodeCloudPayload(value);
    assert.equal(hasNestedArray(encoded),false,`valeur ${i} : tableau imbriqué non encodé`);
    assert.deepEqual(roundTrip(value),value,`valeur ${i} : aller-retour différent`);
  }
  // Document ancien, sans encodage : rendu tel quel.
  const legacy={payload:{a:[1,2]}};assert.equal(decodeCloudDocument(legacy),legacy);
});

// ---------- Règles Firestore (sans émulateur) ----------
test('firestore.rules couvre chaque collection de emptyState() avec les mêmes rôles que permissions.js',()=>{
  const rules=fs.readFileSync(new URL('./firestore.rules',import.meta.url),'utf8');
  const fn=rules.slice(rules.indexOf('function canWriteData'),rules.indexOf('function invitePath'));
  const listFor=role=>{const m=new RegExp(`role == '${role}' && \\(entityType in \\[([^\\]]+)\\]`).exec(fn);assert.ok(m,`liste ${role} introuvable`);return new Set([...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1]));};
  const collections=Object.keys(emptyState()).filter(key=>Array.isArray(emptyState()[key])&&!['campagnes','queue','journal'].includes(key));
  assert.deepEqual(new Set(collections),new Set(ENTITY_TYPES),'emptyState() et ENTITY_TYPES déclarent les mêmes collections');
  // Propriétaire, responsable, collaborateur : toutes les collections.
  assert.match(fn,/role in \['owner','manager','editor'\]/);
  const operator=listFor('operator'),accountant=listFor('accountant');
  for(const type of [...operator,...accountant])assert.ok(ENTITY_TYPES.includes(type),`${type} : collection inconnue dans firestore.rules`);
  // integrationImports est traité à part (factures : comptabilité ; le reste : opérateur).
  assert.match(fn,/role == 'operator'[\s\S]*entityType == 'integrationImports' && !financeKind\(d\)/);
  assert.match(fn,/role == 'accountant'[\s\S]*entityType == 'integrationImports' && financeKind\(d\)/);
  assert.deepEqual(new Set([...operator,'integrationImports']),new Set(roleScope('operator').entities),'opérateur : rules = permissions.js');
  assert.deepEqual(accountant,new Set(roleScope('accountant').entities),'comptabilité : rules = permissions.js');
  for(const type of collections)assert.ok(roleScope('owner').all||operator.has(type),`${type} accessible au propriétaire`);
});
