// Modèles d'interventions (templates.js) : tri par usage, préremplissage, pastilles de la saisie rapide, nom.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {templateUses,templateList,templateSummary,templateToWork,templatesForType,cleanTemplateName} from './templates.js';

const state={
  templates:[{id:'t1',name:'Désherbage maïs',type:'Désherbage',product:'Produit A',dose:'1,5',doseUnit:'L/ha',culture:'Maïs'},
    {id:'t2',name:'Azote blé',type:'Fertilisation',product:'Ammonitrate',dose:150,doseUnit:'kg/ha'},
    {id:'t3',name:'Ancien',type:'Désherbage',deletedAt:1},
    {id:'t4',name:'Broyage',type:'Désherbage'}],
  interventions:[{type:'Fertilisation',product:'ammonitrate'},{type:'fertilisation',product:'Ammonitrate'},{type:'Désherbage',product:'Produit A'},
    {type:'Désherbage',product:'Autre'},{type:'Désherbage',product:'Produit A',deletedAt:2}]
};

test('usage : même type et même produit, sans casse ni accents, hors supprimés', ()=>{
  assert.equal(templateUses(state,state.templates[1]),2);
  assert.equal(templateUses(state,state.templates[0]),1);
  assert.equal(templateUses(state,state.templates[3]),2,'sans produit : tous les travaux du type');
});

test('liste : modèles actifs, les plus repris en tête', ()=>{
  assert.deepEqual(templateList(state).map(x=>x.template.id),['t2','t4','t1']);
  assert.deepEqual(templateList({}),[]);
});

test('préremplissage et résumé', ()=>{
  const w=templateToWork(state.templates[0],'2026-11-13');
  assert.deepEqual(w,{type:'Désherbage',culture:'Maïs',product:'Produit A',dose:'1,5',doseUnit:'L/ha',equipmentId:undefined,operator:undefined,status:'À faire',date:'2026-11-13'});
  assert.equal(templateSummary(state.templates[1]),'Fertilisation · Ammonitrate · 150 kg/ha');
  assert.equal(templateSummary({type:'Broyage',dose:0}),'Broyage · 0');
});

test('saisie rapide : modèles du type choisi, 3 au plus', ()=>{
  assert.deepEqual(templatesForType(state,'desherbage').map(t=>t.id),['t4','t1']);
  assert.deepEqual(templatesForType(state,''),[]);
  const many={templates:Array.from({length:5},(_,i)=>({id:`m${i}`,name:`M${i}`,type:'Semis'}))};
  assert.equal(templatesForType(many,'Semis').length,3);
});

test('nom nettoyé', ()=>{
  assert.equal(cleanTemplateName('  Azote   blé  '),'Azote blé');
  assert.equal(cleanTemplateName('   '),null);
  assert.equal(cleanTemplateName('x'.repeat(100)).length,80);
});
