import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DRAFT_MAX_AGE_MS,applyFields,draftKey,draftTimeLabel,persistFormDraft,purgeStaleDrafts,readDraft,removeDraft,serializeForm,writeDraft} from './form-drafts.js';

function memoryStorage(){const map=new Map();return {map,get length(){return map.size;},key:i=>[...map.keys()][i]??null,getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
function el(name,value='',type='text',extra={}){return {name,value,type,checked:false,disabled:false,dispatchEvent(){},...extra};}
function fakeForm(elements){
  const listeners={};
  return {elements,isConnected:true,addEventListener(type,fn){(listeners[type]??=[]).push(fn);},fire(type,event={}){for(const fn of listeners[type]||[])fn(event);},querySelector:()=>null,querySelectorAll:()=>[],prepend(){}};
}
const fakeDoc=()=>({visibilityState:'visible',listeners:{},addEventListener(t,f){(this.listeners[t]??=[]).push(f);},removeEventListener(t,f){this.listeners[t]=(this.listeners[t]||[]).filter(x=>x!==f);}});

test('clé par type et identifiant, « nouveau » sans identifiant',()=>{
  assert.equal(draftKey('interventions','w3'),'parcelles:draft:interventions:w3');
  assert.equal(draftKey('tasks',null),'parcelles:draft:tasks:nouveau');
});

test('sérialisation : champs nommés, cases à cocher, jamais de fichier ni de mot de passe',()=>{
  const form=fakeForm([el('type','Semis'),el('dose','140'),el('file','C:\\fakepath\\photo.jpg','file'),el('secret','x','password'),Object.assign(el('urgent','on','checkbox'),{checked:true}),el('','sans nom'),el('note','à revoir',undefined,{disabled:true})]);
  assert.deepEqual(serializeForm(form),{type:'Semis',dose:'140',urgent:true});
  assert.deepEqual(serializeForm(form,{only:['dose']}),{dose:'140'});
});

test('stockage : try/catch, brouillon de plus de 7 jours ignoré et purgé',()=>{
  const storage=memoryStorage(),at=Date.now();
  writeDraft('parcelles:draft:tasks:nouveau',{title:'A'},{storage,at:at-DRAFT_MAX_AGE_MS-1});
  writeDraft('parcelles:draft:tasks:t1',{title:'B'},{storage,at});
  storage.setItem('parcelles:draft:tasks:abime','{pas du json');
  assert.equal(readDraft('parcelles:draft:tasks:abime',{storage}),null);
  purgeStaleDrafts({storage,at});
  assert.deepEqual([...storage.map.keys()].sort(),['parcelles:draft:tasks:abime','parcelles:draft:tasks:t1']);
  const throwing={getItem(){throw new Error('SecurityError');},setItem(){throw new Error('QuotaExceededError');},removeItem(){throw new Error('x');}};
  assert.equal(readDraft('k',{storage:throwing}),null);assert.equal(writeDraft('k',{},{storage:throwing}),false);removeDraft('k',{storage:throwing});
});

test('enregistrement à la saisie et au passage en arrière-plan, purge à l’enregistrement',async()=>{
  const storage=memoryStorage(),doc=fakeDoc(),title=el('title','');
  const form=fakeForm([title,el('dueDate','2026-10-08')]);
  const draft=persistFormDraft(form,draftKey('tasks',null),{storage,doc});
  assert.equal(storage.map.size,0,'rien n’est écrit tant que rien n’est saisi');
  title.value='Réparer la clôture';form.fire('input');
  doc.visibilityState='hidden';for(const fn of doc.listeners.visibilitychange)fn();
  const saved=readDraft(draftKey('tasks',null),{storage});
  assert.equal(saved.fields.title,'Réparer la clôture');
  // Retour à la valeur d’origine : le brouillon disparaît.
  title.value='';form.fire('input');for(const fn of doc.listeners.visibilitychange)fn();
  assert.equal(storage.map.size,0);
  title.value='Autre';form.fire('input');draft.save();assert.equal(storage.map.size,1);
  draft.clear();assert.equal(storage.map.size,0);
  assert.equal(doc.listeners.visibilitychange.length,0,'écouteurs retirés');
});

test('reprise : valeurs restaurées, cases à cocher comprises',()=>{
  const a=el('title','vide'),b=el('urgent','on','checkbox');
  applyFields(fakeForm([a,b]),{title:'Repris',urgent:true});
  assert.equal(a.value,'Repris');assert.equal(b.checked,true);
});

test('libellé de l’heure : « 10:42 » le jour même, date sinon',()=>{
  const at=new Date(2026,9,8,15,0).getTime();
  assert.equal(draftTimeLabel(new Date(2026,9,8,10,42).getTime(),at),'10:42');
  assert.equal(draftTimeLabel(new Date(2026,9,7,10,42).getTime(),at),'07/10 à 10:42');
});

test('formulaires branchés : travail, tâche, observation, pièce jointe (note seulement), entretien, pâturage',()=>{
  const app=readFileSync(new URL('app.js',import.meta.url),'utf8'),grazing=readFileSync(new URL('grazing-ui.js',import.meta.url),'utf8');
  for(const key of ["draftKey('interventions'","draftKey('tasks'","draftKey('observations'","draftKey('attachment'","draftKey('maintenanceRecords'","draftKey('grazingSessions'"])assert.ok(app.includes(key),key);
  assert.match(app,/draftKey\('attachment',[^;]*\{only:\['note'\]\}/);
  assert.ok(grazing.includes('draft?.clear()'));
  for(const file of ['sw.js','runtime.js'])assert.ok(readFileSync(new URL(file,import.meta.url),'utf8').includes("'./form-drafts.js'"));
});
