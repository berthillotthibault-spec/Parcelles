// Catalogue E-Phy : détection de la publication data.gouv et mise à jour automatique (sans réseau réel).
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCatalogFile,filterForCultures,catalogRecord,assertCatalogUpdate} from './phyto-catalog.js';
import {pickEphyResource,ephyRemoteSource,updateCatalogIfNeeded,isNewerEphy,culturesChanged,ephyZipTexts,EPHY_API_URL} from './phyto-catalog-auto.js';
import {createZip,readZip} from './zip-lite.js';

const BASE='https://static.data.gouv.fr/resources/donnees-ouvertes-du-catalogue-e-phy/';
const API={last_update:'2026-11-10T17:45:49',resources:[
  {title:'decisionamm-intrant-format-csv-20261110-windows-1252.zip',url:`${BASE}20261110-174542/decisionamm-intrant-format-csv-20261110-windows-1252.zip`,filesize:3940359},
  {title:'decisionamm-intrant-format-csv-20261103-utf8.zip',url:`${BASE}20261103-100000/decisionamm-intrant-format-csv-20261103-utf8.zip`,filesize:3900000},
  {title:'decisionamm-intrant-format-csv-20261110-utf8.zip',url:`${BASE}20261110-174543/decisionamm-intrant-format-csv-20261110-utf8.zip`,filesize:3989088,last_modified:'2026-11-10T17:45:44.047000+00:00'},
  {title:'decisionamm-intrant-format-xml-20261110.zip',url:`${BASE}20261110-174544/decisionamm-intrant-format-xml-20261110.zip`,filesize:8633268}
]};
const USAGES=`numero AMM;nom produit;identifiant usage; date decision;etat usage;dose retenue;dose retenue unite;delai avant recolte jour;nombre max d'application;ZNT aquatique (en m)
9990001;FONGIX FICTIF;Blé*Trt Part.Aer.*Septoriose(s);;Autorisé;1.0;L/ha;35;2;5.0
9990001;FONGIX FICTIF;Orge*Trt Part.Aer.*Rouille;;Autorisé;1.0;L/ha;35;2;5.0
9990002;HERBANET TEST;Maïs*Désherbage;;Autorisé;2.0;L/ha;;1;
`;
const PRODUCTS=`type produit;numero AMM;nom produit;fonctions;Etat d’autorisation;Date de retrait du produit
PPP;9990001;FONGIX FICTIF;Fongicide;AUTORISE;
PPP;9990002;HERBANET TEST;Herbicide;AUTORISE;
`;
const zipBuffer=async()=>(await createZip([{name:'produits_usages_utf8.csv',data:USAGES},{name:'produits_utf8.csv',data:PRODUCTS},{name:'produits_condition_emploi_utf8.csv',data:'x'.repeat(1000)}])).arrayBuffer();
const remote=pickEphyResource(API);

function harness({catalog=null,fetchFails=false,parseFails=false}={}){
  const calls={fetch:[],save:[],readZip:[]};
  const fetch=async url=>{calls.fetch.push(url);if(fetchFails)return{ok:false,status:503};return{ok:true,status:200,headers:new Map([['content-length','2000']]),arrayBuffer:zipBuffer};};
  const read=async(buf,opts)=>{const entries=await readZip(buf,opts);calls.readZip.push(entries.map(e=>e.name));return entries;};
  const parse=(text,opts)=>{if(parseFails)throw new Error('CSV illisible');return parseCatalogFile(text,opts);};
  const save=async(entries,opts)=>{assertCatalogUpdate(catalog,entries,opts);calls.save.push({entries,opts});return{kept:entries.length};};
  return{calls,deps:{remote,catalog,cultures:['Blé tendre','Maïs grain'],fetch,readZip:read,parseCatalogFile:parse,filterForCultures,save,now:Date.now()+40*864e5}}; // catalogue local de plus d'un mois : mise à jour automatique permise
}

test('pickEphyResource : ZIP CSV UTF-8 le plus récent, sinon null', ()=>{
  assert.deepEqual(remote,{version:'20261110',url:`${BASE}20261110-174543/decisionamm-intrant-format-csv-20261110-utf8.zip`,size:3989088,lastModified:'2026-11-10T17:45:44.047000+00:00'});
  assert.equal(pickEphyResource({resources:[{title:'decisionamm-intrant-format-xml-20261110.zip',url:'https://x/y.zip'}]}),null);
  assert.equal(pickEphyResource({resources:[{title:'decisionamm-intrant-format-csv-20261110-utf8.zip',url:'http://insecure/x.zip'}]}),null);
  assert.equal(pickEphyResource(null),null);assert.equal(pickEphyResource({resources:'x'}),null);
});

test('ephyRemoteSource : contrat du registre, check et validate', async()=>{
  assert.equal(ephyRemoteSource.id,'ephy');assert.equal(ephyRemoteSource.label,'Catalogue E-Phy (ANSES)');assert.equal(ephyRemoteSource.ttlMs,24*3600*1000);
  assert.ok(ephyRemoteSource.embedded&&'value'in ephyRemoteSource.embedded);
  const seen=[];
  const result=await ephyRemoteSource.check({fetch:async(url,opts)=>{seen.push([url,opts.signal]);return{ok:true,text:async()=>JSON.stringify(API)};},signal:'sig',cached:null,now:Date.now()});
  assert.deepEqual(seen,[[EPHY_API_URL,'sig']]);
  assert.equal(result.version,'20261110');assert.equal(result.sourceDate,'2026-11-10');assert.equal(result.value.url,remote.url);
  assert.equal(ephyRemoteSource.validate(result),true);
  assert.equal(ephyRemoteSource.validate({value:{version:'x',url:'https://a'},version:'x'}),false);
  await assert.rejects(ephyRemoteSource.check({fetch:async()=>({ok:false,status:500})}),/500/);
  await assert.rejects(ephyRemoteSource.check({fetch:async()=>({ok:true,text:async()=>'{"resources":[]}'})}),/Aucun fichier/);
});

test('comparaison de versions et de cultures', ()=>{
  assert.equal(isNewerEphy(remote,null),true);assert.equal(isNewerEphy(remote,{sourceVersion:'20261103'}),true);
  assert.equal(isNewerEphy(remote,{sourceVersion:'20261110'}),false);assert.equal(isNewerEphy(null,{}),false);
  assert.equal(culturesChanged({cultures:['Blé tendre','Maïs grain']},['maïs grain','Blé tendre']),false);
  assert.equal(culturesChanged({cultures:['Blé tendre']},['Blé tendre','Colza']),true);
});

test('version identique et mêmes cultures : aucun téléchargement', async()=>{
  const catalog=catalogRecord([{amm:'1',usages:[{culture:'Blé'}]}],{origin:'auto',cultures:['Blé tendre','Maïs grain'],sourceVersion:'20261110'});
  const {calls,deps}=harness({catalog});
  const r=await updateCatalogIfNeeded(deps);
  assert.equal(r.status,'up-to-date');assert.equal(calls.fetch.length,0);assert.equal(calls.save.length,0);
});

test('économiseur de données : pas de téléchargement, sauf demande explicite', async()=>{
  const {calls,deps}=harness();
  const r=await updateCatalogIfNeeded({...deps,canDownload:()=>false});
  assert.equal(r.status,'skipped');assert.equal(r.reason,'save-data');assert.equal(calls.fetch.length,0);
  const forced=await updateCatalogIfNeeded({...deps,canDownload:()=>false,userRequested:true});
  assert.equal(forced.status,'updated');assert.equal(calls.fetch.length,1);
});

test('cultures vides ou publication inconnue : rien n’est lancé', async()=>{
  const {calls,deps}=harness();
  assert.equal((await updateCatalogIfNeeded({...deps,cultures:[]})).reason,'no-cultures');
  assert.equal((await updateCatalogIfNeeded({...deps,remote:null})).reason,'no-remote');
  assert.equal(calls.fetch.length,0);
});

test('échec du parse ou du réseau : save n’est pas appelé, le catalogue est conservé', async()=>{
  const a=harness({parseFails:true});
  const r=await updateCatalogIfNeeded(a.deps);
  assert.equal(r.status,'error');assert.match(r.message,/CSV illisible/);assert.equal(a.calls.save.length,0);
  const b=harness({fetchFails:true});
  const r2=await updateCatalogIfNeeded(b.deps);
  assert.equal(r2.status,'error');assert.match(r2.message,/503/);assert.equal(b.calls.save.length,0);
});

test('chute de plus de 50 % des usages : enregistrement refusé', async()=>{
  const big=Array.from({length:10},(_,i)=>({amm:String(i),usages:[{culture:'Blé'},{culture:'Maïs'}]}));
  const catalog=catalogRecord(big,{origin:'auto',cultures:['Blé tendre','Maïs grain'],sourceVersion:'20261103'});
  const {calls,deps}=harness({catalog});
  const r=await updateCatalogIfNeeded(deps);
  assert.equal(r.status,'error');assert.match(r.message,/50 %/);assert.equal(calls.save.length,0);
});

test('cas nominal : ZIP lu partiellement, jointure, filtre, save avec sourceVersion', async()=>{
  const catalog=catalogRecord([{amm:'1',usages:[{culture:'Blé'}]}],{origin:'fichier',cultures:['Blé tendre','Maïs grain'],sourceVersion:'20261103'});
  const {calls,deps}=harness({catalog});
  const r=await updateCatalogIfNeeded(deps);
  assert.equal(r.status,'updated');assert.equal(r.version,'20261110');assert.equal(r.kept,2);
  assert.deepEqual(calls.fetch,[remote.url]);
  assert.deepEqual(calls.readZip[0].sort(),['produits_usages_utf8.csv','produits_utf8.csv'],'seules les entrées utiles sont décompressées');
  const {entries,opts}=calls.save[0];
  assert.equal(opts.origin,'auto');assert.equal(opts.sourceVersion,'20261110');assert.equal(opts.sourceDate,'2026-11-10');
  assert.deepEqual(opts.cultures,['Blé tendre','Maïs grain']);assert.equal(opts.reduce,false);
  const fongix=entries.find(e=>e.amm==='9990001');
  assert.equal(fongix.usages.length,1,'orge écartée');assert.equal(fongix.category,'fongicide');
});

test('cultures changées : nouvelle réduction même si la version est identique', async()=>{
  const catalog=catalogRecord([{amm:'1',usages:[{culture:'Blé'}]}],{origin:'auto',cultures:['Blé tendre'],sourceVersion:'20261110'});
  const {calls,deps}=harness({catalog});
  const r=await updateCatalogIfNeeded(deps);
  assert.equal(r.status,'updated');assert.equal(r.culturesChanged,true);assert.equal(calls.save[0].opts.allowShrink,true);
});

test('catalogue complet choisi à la main : pas de réduction aux cultures', async()=>{
  const catalog=catalogRecord([{amm:'1',usages:[{culture:'Blé'}]}],{origin:'fichier',cultures:[],sourceVersion:'20261103'});
  const {calls,deps}=harness({catalog});
  const r=await updateCatalogIfNeeded({...deps,cultures:[]});
  assert.equal(r.status,'updated');assert.deepEqual(calls.save[0].opts.cultures,[]);
  assert.ok(calls.save[0].entries.some(e=>e.usages.some(u=>u.culture==='Orge')));
});

test('ephyZipTexts : fichier des usages obligatoire', ()=>{
  assert.throws(()=>ephyZipTexts([{name:'produits_utf8.csv',text:()=>''}]),/usages/);
  const t=ephyZipTexts([{name:'usages_des_produits_autorises_utf8.csv',text:()=>'a'}],{fileName:'decisionamm-intrant-format-csv-20261110-utf8.zip'});
  assert.equal(t.usagesText,'a');assert.equal(t.productsText,'');assert.equal(t.sourceVersion,'20261110');
});

test('erreurs réseau du navigateur traduites en français', async ()=>{
  const {frenchError}=await import('./phyto-catalog-auto.js');
  assert.equal(frenchError(new TypeError('Failed to fetch')),'Téléchargement E-Phy impossible : réseau indisponible.');
  assert.equal(frenchError(new TypeError('Load failed')),'Téléchargement E-Phy impossible : réseau indisponible.');
  assert.equal(frenchError(Object.assign(new Error('The operation was aborted.'),{name:'AbortError'})),'Téléchargement E-Phy trop long : réessayez plus tard.');
  assert.equal(frenchError(new Error('Fichier E-Phy trop volumineux.')),'Fichier E-Phy trop volumineux.');
  const {deps}=harness();
  const r=await updateCatalogIfNeeded({...deps,fetch:async()=>{throw new TypeError('Failed to fetch');}});
  assert.equal(r.status,'error');assert.match(r.message,/réseau indisponible/);
});

test('interface : un seul téléchargement à la fois, hors connexion et service configuré', async ()=>{
  const {createPhytoCatalogUI}=await import('./phyto-catalog-ui.js');
  const stored=new Map();let fetches=0,isOnline=true,endpointUrl='';
  const store={state:{parcelles:[{id:'p1',culture:'Blé tendre'}],rotations:[]},storage:{get:async k=>stored.get(k),set:async(k,v)=>{stored.set(k,v);}}};
  const fetchImpl=async()=>{fetches++;await new Promise(r=>setTimeout(r,5));return{ok:true,status:200,headers:new Map(),arrayBuffer:zipBuffer};};
  const ui=createPhytoCatalogUI({store,modal(){},toast(){},remote:()=>remote,fetchImpl,canDownload:()=>true,online:()=>isOnline,endpoint:()=>endpointUrl});
  const [a,b]=await Promise.all([ui.autoUpdate(),ui.autoUpdate()]);
  assert.equal(fetches,1);assert.equal(a.status,'updated');assert.strictEqual(a,b);
  assert.equal(stored.get('phyto-catalog').sourceVersion,'20261110');
  assert.equal((await ui.autoUpdate()).status,'up-to-date');assert.equal(fetches,1);
  isOnline=false;
  assert.equal((await ui.autoUpdate({userRequested:true})).reason,'offline');
  isOnline=true;endpointUrl='https://service.example/ephy';
  stored.delete('phyto-catalog');
  const ui2=createPhytoCatalogUI({store,modal(){},toast(){},remote:()=>remote,fetchImpl,canDownload:()=>true,online:()=>true,endpoint:()=>endpointUrl});
  assert.equal((await ui2.autoUpdate()).reason,'endpoint');assert.equal(fetches,1);
});

test('mise à jour E-Phy automatique au plus une fois par mois (sauf cultures changées ou demande)', async () => {
  const {updateCatalogIfNeeded} = await import('./phyto-catalog-auto.js');
  const now = Date.parse('2026-11-12T12:00:00');
  const catalog = {entries: [{}], cultures: ['blé'], updatedAt: now - 10 * 864e5, sourceVersion: '20261020', sourceDate: '2026-10-20'};
  let fetched = 0;
  const base = {remote: {url: 'https://static.data.gouv.fr/x.zip', version: '20261110'}, catalog, cultures: ['blé'], fetch: async () => { fetched++; throw new Error('stop'); }, readZip: async () => ({}), parseCatalogFile: () => [], filterForCultures: x => x, save: async () => ({}), now};
  const r = await updateCatalogIfNeeded(base);
  assert.equal(r.reason, 'recent'); assert.equal(fetched, 0);
  await updateCatalogIfNeeded({...base, userRequested: true}); assert.equal(fetched, 1);
  await updateCatalogIfNeeded({...base, catalog: {...catalog, updatedAt: now - 40 * 864e5}}); assert.equal(fetched, 2);
});
