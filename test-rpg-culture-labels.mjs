import test from 'node:test';
import assert from 'node:assert/strict';
import {pickCultureResource,parseCultureRows,createRpgCultureLabelsSource,rpgCultureLabelsSource,RPG_CULTURES_DATASET_URL} from './rpg-culture-labels.js';
import {rpgCultureLabel,setRpgCultureLabels} from './rpg.js';

const resource=(year,lastModified,url=`https://static.data.gouv.fr/resources/codes-cultures-pac/x/n-cultures-${year}.ods`)=>({title:`n-cultures-${year}.ods`,url,last_modified:lastModified,format:'ods'});
const DATASET={title:'Codes cultures PAC',resources:[resource(2025,'2025-08-08T07:43:08Z'),resource(2026,'2026-04-22T12:18:41Z'),resource(2024,'2024-04-02T09:17:48Z'),{title:'notice.pdf',url:'https://static.data.gouv.fr/notice.pdf'}]};
const codes=n=>Array.from({length:n},(_,i)=>[`C${String(i).padStart(2,'0')}`,`Culture ${i}`]);

test('ressource ODS de la campagne la plus récente', ()=>{
  const pick=pickCultureResource(DATASET);
  assert.equal(pick.year,2026);assert.match(pick.url,/n-cultures-2026\.ods$/);assert.equal(pick.lastModified,'2026-04-22T12:18:41Z');
  assert.equal(pickCultureResource({resources:[{title:'x.csv',url:'https://a/x.csv'}]}),null);
  assert.equal(pickCultureResource(null),null);
  assert.equal(pickCultureResource({resources:[resource(2030,'x','http://insecure/n-cultures-2030.ods')]}),null,'HTTPS seulement');
});

test('parseCultureRows : deux schémas d’en-têtes', ()=>{
  const a=parseCultureRows([['code_culture','nom_culture','num_chapitre'],['AVH','Avoine d’hiver','1.1'],['bdh','  Blé dur  ','1.1'],['','vide'],['ZZZ','']]);
  assert.deepEqual(a,{AVH:'Avoine d’hiver',BDH:'Blé dur'});
  const b=parseCultureRows([['Nomenclature 2024'],['Code','Libellé'],['MIS','Maïs']]);
  assert.deepEqual(b,{MIS:'Maïs'},'ligne de titre ignorée, en-têtes accentués');
  assert.deepEqual(parseCultureRows([{code:'SOJ',libelle:'Soja'}]),{SOJ:'Soja'});
  assert.deepEqual(parseCultureRows([['a','b'],['X','Y']]),{});
  assert.deepEqual(parseCultureRows(null),{});
});

test('validate : au moins 50 codes', ()=>{
  const source=rpgCultureLabelsSource;
  assert.equal(source.id,'rpg-cultures');assert.equal(source.label,'Codes cultures PAC');assert.equal(source.ttlMs,30*24*3600*1000);
  const labels=parseCultureRows([['code_culture','nom_culture'],...codes(49)]);
  assert.equal(source.validate({value:{labels}}),false);
  assert.equal(source.validate({value:{labels:parseCultureRows([['code_culture','nom_culture'],...codes(50)])}}),true);
  assert.equal(source.validate({}),false);
});

function fakeFetch(calls){
  return async url=>{
    calls.push(url);
    if(url===RPG_CULTURES_DATASET_URL)return new Response(JSON.stringify(DATASET));
    if(/n-cultures-2026\.ods$/.test(url))return new Response(new Uint8Array([1,2,3]));
    return new Response('',{status:404});
  };
}
const fakeXlsx={read:()=>({SheetNames:['n_cultures_2026'],Sheets:{n_cultures_2026:{}}}),utils:{sheet_to_json:()=>[['code_culture','nom_culture'],...codes(60)]}};

test('check : téléchargement, puis court-circuit si last_modified est inchangé', async ()=>{
  const calls=[];
  const source=createRpgCultureLabelsSource({loadXlsx:async()=>fakeXlsx});
  const result=await source.check({fetch:fakeFetch(calls)});
  assert.equal(calls.length,2);assert.equal(result.value.year,2026);assert.equal(result.version,'2026');
  assert.equal(result.value.lastModified,'2026-04-22T12:18:41Z');assert.equal(Object.keys(result.value.labels).length,60);
  assert.ok(source.validate(result));
  const again=[];
  const cached=await source.check({fetch:fakeFetch(again),cached:{value:result.value,version:'2026'}});
  assert.deepEqual(again,[RPG_CULTURES_DATASET_URL],'aucun téléchargement du fichier');
  assert.equal(cached.value,result.value);
  const older=[];
  await source.check({fetch:fakeFetch(older),cached:{value:{...result.value,lastModified:'2025-01-01'},version:'2026'}});
  assert.equal(older.length,2,'fichier modifié : relu');
});

test('check : sans lecteur de tableur, le cache est gardé', async ()=>{
  const source=createRpgCultureLabelsSource({loadXlsx:async()=>null});
  const previous={value:{year:2025,lastModified:'old',labels:Object.fromEntries(codes(60))},version:'2025'};
  const calls=[];
  const kept=await source.check({fetch:fakeFetch(calls),cached:previous});
  assert.equal(kept.value,previous.value);assert.equal(calls.length,1);
  await assert.rejects(source.check({fetch:fakeFetch([])}),/tableur/);
  await assert.rejects(source.check({fetch:async()=>new Response('',{status:500})}),/500/);
});

test('check : la valeur embarquée (aucun code) ne remplace pas une vraie lecture', async ()=>{
  const source=createRpgCultureLabelsSource({loadXlsx:async()=>null});
  const embedded={value:source.embedded.value,version:source.embedded.version,origin:'embarque'};
  await assert.rejects(source.check({fetch:fakeFetch([]),cached:embedded}),/tableur/,'erreur explicite, pas un résultat vide');
  const thin={value:{year:2026,lastModified:'2026-04-22T12:18:41Z',labels:{AAA:'A'}},version:'2026'};
  const calls=[];
  const reread=await createRpgCultureLabelsSource({loadXlsx:async()=>fakeXlsx}).check({fetch:fakeFetch(calls),cached:thin});
  assert.equal(calls.length,2,'cache trop maigre : fichier relu');assert.equal(Object.keys(reread.value.labels).length,60);
});

test('check : réponses illisibles signalées en français', async ()=>{
  await assert.rejects(createRpgCultureLabelsSource({loadXlsx:async()=>fakeXlsx}).check({fetch:async()=>new Response('<html>')}),/data\.gouv\.fr illisible/);
  const broken={read:()=>{throw new Error('Unsupported file');},utils:fakeXlsx.utils};
  await assert.rejects(createRpgCultureLabelsSource({loadXlsx:async()=>broken}).check({fetch:fakeFetch([])}),/Fichier des cultures illisible/);
});

test('rpgCultureLabel : surcharge, puis embarqué, puis libellé source, puis code brut', ()=>{
  try{
    assert.equal(rpgCultureLabel('BTH'),'Blé tendre d’hiver');
    assert.equal(setRpgCultureLabels({bth:'Blé tendre hiver',ACP:'Autre culture pérenne',BAD:42}),2);
    assert.equal(rpgCultureLabel('BTH'),'Blé tendre hiver','surcharge prioritaire');
    assert.equal(rpgCultureLabel('acp'),'Autre culture pérenne');
    assert.equal(rpgCultureLabel('MIE'),'Maïs ensilage','ancien code conservé');
    assert.equal(rpgCultureLabel('ZZZ','Libellé source'),'Libellé source');
    assert.equal(rpgCultureLabel('ZZZ'),'ZZZ');
  }finally{setRpgCultureLabels(null);}
  assert.equal(rpgCultureLabel('ACP'),'ACP');
});
