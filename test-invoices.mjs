import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,emptyState} from './state.js';
import {INVOICE_KIND,billableItems,billedKeys,createCreditNote,createDraft,deleteDraft,emissionProblems,emitInvoice,invoiceHtml,invoiceStatus,invoiceTotals,invoicesCsv,lineTotal,markPaid,nextNumber,numberingIssues,overdueInvoices,receivable,saveDraft,saveSettings,validateDraft,validateSettings,workLine,fuelLine} from './invoices.js';
import {composeMorningBrief} from './home-story.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
class MemoryStorage{constructor(){this.value=null;}async init(){}async get(){return this.value;}async set(_k,v){this.value=structuredClone(v);}async backupPut(){}async pruneBackups(){}async blobDelete(){}}
const SETTINGS={legalName:'EARL du Sougey',legalForm:'EARL au capital de 7 500 €',address:'1 route du Sougey\n01340 Montrevel',siret:'12345678900012',vatNumber:'fr 12 345678901',iban:'FR76 3000 6000 0112 3456 7890 189',bic:'AGRIFRPP',paymentDays:30,vatRate:20,prefix:'F'};

function farm(){
  const s=emptyState();
  s.clients=[{id:'c1',name:'GAEC du Bois',address:'Le Bois, 01000 Bourg',hourlyRate:60,hectareRate:45,m3Rate:4.5},{id:'c2',name:'SCEA Sans Tarif',address:'Ici'}];
  s.parcelles=[{id:'p1',nom:'Champ du Bois',surfaceHa:8,clientId:'c1'},{id:'p2',nom:'Chez nous',surfaceHa:5},{id:'p3',nom:'Pré SCEA',surfaceHa:3,clientId:'c2'}];
  s.interventions=[
    {id:'w1',parcelId:'p1',type:'Semis',date:'2026-09-02',status:'Terminé',duration:4,fuel:40,fuelCost:60},
    {id:'w2',parcelId:'p1',type:'Pressage',date:'2026-09-10',status:'Terminé',surfaceWorked:5.5,fuel:20},
    {id:'w3',parcelId:'p1',type:'Récolte',date:'2026-10-20',status:'À faire'},
    {id:'w4',parcelId:'p2',type:'Labour',date:'2026-09-05',status:'Terminé'},
    {id:'w5',parcelId:'p3',type:'Broyage',date:'2026-09-06',status:'Terminé',duration:2}
  ];
  s.chantiers=[{id:'tp1',kind:'tp',type:'Terrassement',address:'ZA Nord',clientId:'c1',status:'En cours',tpLogs:[{id:'log1',date:'2026-09-12',hours:6,volumeM3:120,tonnage:null},{id:'log2',date:'2026-08-01',hours:2,deletedAt:5}]}];
  return s;
}
async function makeStore(data=farm()){
  const store=new Store(new MemoryStorage());await store.init();await store.setPreferences({autoBackup:false,fuelPrice:null});
  for(const t of ['clients','parcelles','interventions','chantiers'])await store.upsertMany(t,data[t]);
  return store;
}

test('valorisation : tarif hectare, horaire, m³ et gazole refacturé, sans prix inventé',()=>{
  const s=farm(),c1=s.clients[0],c2=s.clients[1];
  const ha=workLine(s.interventions[1],s.parcelles[0],c1,20);assert.deepEqual([ha.quantity,ha.unit,ha.unitPrice],[5.5,'ha',45]);
  const h=workLine(s.interventions[4],s.parcelles[2],c2,20);assert.deepEqual([h.quantity,h.unit,h.unitPrice],[2,'h',null]);assert.match(h.basis,/à saisir/);
  const fuel=fuelLine(s.interventions[0],s.parcelles[0],20);assert.equal(fuel.quantity,40);assert.equal(fuel.unitPrice,1.5,'coût carburant ÷ litres');
  assert.equal(fuelLine(s.interventions[1],s.parcelles[0],20).unitPrice,null,'pas de prix carburant connu');
  assert.equal(fuelLine(s.interventions[1],s.parcelles[0],20,1.62).unitPrice,1.62);assert.match(fuelLine(s.interventions[1],s.parcelles[0],20,1.62).basis,/à vérifier/);
  const items=billableItems(s,'c1');
  assert.deepEqual(items.map(i=>i.key),['work:w1','fuel:w1','work:w2','fuel:w2','tp-h:log1','tp-m3:log1'],'travaux réalisés des parcelles du client, gazole et journal TP');
  assert.equal(items.find(i=>i.key==='tp-m3:log1').line.unitPrice,4.5);assert.equal(items.find(i=>i.key==='work:w1').line.unit,'ha','tarif hectare prioritaire quand la surface est connue');
  assert.equal(billableItems(s,'c1',{from:'2026-09-11'}).length,2,'filtre de période');
  assert.equal(billableItems(s,'c1',{includeFuel:false}).length,4);
});

test('totaux : HT par ligne au centime, TVA par taux, lignes sans prix signalées',()=>{
  const t=invoiceTotals([{quantity:3,unitPrice:33.333,vatRate:20},{quantity:1,unitPrice:10,vatRate:5.5},{quantity:2,unitPrice:null,vatRate:20}]);
  assert.equal(lineTotal({quantity:3,unitPrice:33.333}),100);assert.deepEqual(t,{ht:110,tva:20.55,ttc:130.55,byRate:[{rate:20,base:100,tax:20},{rate:5.5,base:10,tax:0.55}],missing:1});
});

test('paramètres et brouillon : validations en ligne',()=>{
  assert.equal(validateSettings({...SETTINGS,legalName:''}).error,'Champ obligatoire : Raison sociale');
  assert.match(validateSettings({...SETTINGS,siret:'123'}).error,/14 chiffres/);
  const ok=validateSettings(SETTINGS).value;assert.equal(ok.vatNumber,'FR12345678901');assert.equal(ok.iban,'FR7630006000011234567890189');
  assert.match(validateSettings({...SETTINGS,prefix:'F 26'}).error,/Préfixe/);
  assert.equal(validateDraft({clientName:'',lines:[]}).error,'Champ obligatoire : Client');
  assert.equal(validateDraft({clientName:'X',lines:[{label:'',quantity:1,unitPrice:2}]}).error,'Champ obligatoire : Désignation (ligne 1)');
  assert.match(validateDraft({clientName:'X',issueDate:'2026-10-10',dueDate:'2026-10-01',lines:[]}).error,/échéance/);
  assert.equal(validateDraft({clientName:'X',lines:[{label:'A',quantity:'1,5',unitPrice:'10',unit:'zz',vatRate:'7'}]}).value.lines[0].unit,'forfait');
});

test('cycle complet : brouillon, émission numérotée sans trou, immuabilité, paiement, avoir',async()=>{
  const store=await makeStore();const version=store.snapshot().version;
  const items=billableItems(store.state,'c1');
  const draft=await createDraft(store,{clientId:'c1',items,from:'2026-09-01',to:'2026-09-30',today:'2026-10-01'});
  assert.equal(draft.farmKind,INVOICE_KIND);assert.equal(draft.status,'brouillon');assert.equal(draft.number,null);assert.equal(draft.dueDate,'2026-10-31');
  assert.equal(billableItems(store.state,'c1').length,0,'un brouillon réserve ses prestations');
  await assert.rejects(createDraft(store,{clientId:'c1',items}),/vient d’être facturée/);
  // Émission refusée tant que les mentions ou prix manquent.
  await assert.rejects(emitInvoice(store,draft.id),/Paramètres de facturation/);
  await saveSettings(store,SETTINGS);
  await assert.rejects(emitInvoice(store,draft.id),/Prix unitaire à saisir \(ligne 4\)/);
  const lines=store.get('integrationImports',draft.id).lines.map(l=>l.unitPrice===null?{...l,unitPrice:'1,6'}:l);
  const saved=await saveDraft(store,draft.id,{...draft,lines},{version:store.get('integrationImports',draft.id).version});
  await assert.rejects(saveDraft(store,draft.id,{...draft,lines},{version:saved.version-1}),/changé entre-temps/);
  assert.deepEqual(emissionProblems(store.state,saved),[]);
  assert.deepEqual([saved.totals.ht,saved.totals.tva,saved.totals.ttc],[1599.5,319.9,1919.4]);
  const emitted=await emitInvoice(store,draft.id,{version:saved.version});
  assert.equal(emitted.number,'F2026-0001');assert.equal(emitted.status,'emise');assert.equal(emitted.seller.siret,'12345678900012');assert.equal(emitted.seller.legalName,'EARL du Sougey');
  await assert.rejects(saveDraft(store,draft.id,{...draft,lines:[]}),/ne se modifie plus/);
  await assert.rejects(deleteDraft(store,draft.id),/ne peut pas être supprimée/);
  await assert.rejects(emitInvoice(store,draft.id),/déjà émise/);
  // Deuxième facture (client sans tarif) : numéro suivant, sans trou.
  const d2=await createDraft(store,{clientId:'c2',items:billableItems(store.state,'c2'),today:'2026-10-02'});
  await saveDraft(store,d2.id,{...d2,lines:d2.lines.map(l=>({...l,unitPrice:55}))});
  const e2=await emitInvoice(store,d2.id);assert.equal(e2.number,'F2026-0002');
  // Brouillon supprimé : pas de numéro consommé.
  const d3=await createDraft(store,{clientId:'c1',items:[],today:'2026-10-03'});await deleteDraft(store,d3.id);
  assert.deepEqual(nextNumber(store.state,{prefix:'F',year:2026}),{number:'F2026-0003',sequence:3});
  assert.deepEqual(numberingIssues(store.state),{duplicates:[],gaps:[]});
  // Statuts : en retard après l’échéance, payée, relance sur l’accueil.
  assert.equal(invoiceStatus(store.get('integrationImports',draft.id),store.state,'2026-10-15'),'emise');
  assert.equal(invoiceStatus(store.get('integrationImports',draft.id),store.state,'2026-11-05'),'retard');
  assert.equal(overdueInvoices(store.state,'2026-11-05').length,2);
  const brief=composeMorningBrief(store.state,null,{now:new Date('2026-11-05T08:00:00').getTime()});
  assert.ok(brief.sentences.some(x=>x.key==='invoice'&&x.action==='open-invoices'&&/2 factures en retard de paiement/.test(x.text)),'relance sur l’accueil');
  await markPaid(store,e2.id,{paidAt:'2026-10-20',method:'Virement'});
  assert.equal(invoiceStatus(store.get('integrationImports',e2.id),store.state,'2026-11-05'),'payee');
  assert.deepEqual(receivable(store.state,'2026-11-05'),{due:1919.4,late:1919.4,lateCount:1,draft:0});
  // Avoir total : la facture est annulée et ses prestations redeviennent facturables.
  const credit=await createCreditNote(store,draft.id,{today:'2026-11-06'});
  assert.equal(credit.docType,'avoir');assert.equal(credit.creditOf,draft.id);assert.equal(credit.totals.ttc,-1919.4);
  assert.equal((await createCreditNote(store,draft.id)).id,credit.id,'un seul avoir en brouillon à la fois');
  const ce=await emitInvoice(store,credit.id);assert.equal(ce.number,'F2026-0003');assert.equal(ce.creditOfNumber,'F2026-0001');
  assert.equal(invoiceStatus(store.get('integrationImports',draft.id),store.state,'2026-11-10'),'annulee');
  assert.equal(billableItems(store.state,'c1').length,6,'prestations libérées par l’avoir');
  await assert.rejects(createCreditNote(store,draft.id),/entièrement annulée/);
  // Les travaux et chantiers ne sont jamais modifiés ; aucun changement de schéma.
  assert.equal(store.get('interventions','w1').invoiceId,undefined);assert.equal(store.snapshot().version,version);
  // Export comptable.
  const csv=invoicesCsv(store.state);assert.ok(csv.startsWith('﻿Date;Numéro;Type'));
  assert.match(csv,/2026-10-01;F2026-0001;Facture;GAEC du Bois;;20;1599,5;319,9;1919,4;2026-10-31;Annulée par avoir;;/);
  assert.match(csv,/F2026-0003;Avoir;GAEC du Bois;;20;-1599,5;-319,9;-1919,4;/);
  // Document imprimable.
  const html=invoiceHtml(store.state,store.get('integrationImports',draft.id));
  for(const t of ['Facture','F2026-0001','SIRET 12345678900012','FR12345678901','Le Bois, 01000 Bourg','Pénalités de retard','40 €','Total TTC','Échéance','prestations de services','FR76 3000'])assert.ok(html.includes(t),t);
  assert.match(html,/@page\{size:A4/);assert.ok(!/NaN|undefined/.test(html));
  assert.match(invoiceHtml(store.state,store.get('integrationImports',credit.id)),/Avoir sur la facture F2026-0001/);
  const draftHtml=invoiceHtml(store.state,{...d3,status:'brouillon',lines:[]});assert.match(draftHtml,/Brouillon · sans valeur/);
});

test('numérotation : doublons hors ligne et trous détectés ; droits d’écriture respectés',async()=>{
  const s=emptyState();s.integrationImports=[{id:'a',farmKind:INVOICE_KIND,status:'emise',number:'F2026-0001'},{id:'b',farmKind:INVOICE_KIND,status:'emise',number:'F2026-0001'},{id:'c',farmKind:INVOICE_KIND,status:'emise',number:'F2026-0004'},{id:'d',farmKind:INVOICE_KIND,status:'emise',number:'B2026-0001'}];
  assert.deepEqual(numberingIssues(s),{duplicates:['F2026-0001'],gaps:['F2026-0002','F2026-0003']});
  assert.equal(nextNumber(s,{prefix:'B',year:2026}).number,'B2026-0002');assert.equal(nextNumber(s,{prefix:'F',year:2027}).number,'F2027-0001');
  assert.deepEqual(billedKeys(s),new Set());
  const store=await makeStore();store.writeGuard=()=>false;
  await assert.rejects(createDraft(store,{clientId:'c1',items:[]}),/rôle/);await assert.rejects(saveSettings(store,SETTINGS),/rôle/);
});

test('fichiers servis et accroches',()=>{
  const sw=read('sw.js');for(const f of ['./invoices.js','./invoices-ui.js'])assert.ok(sw.includes(`'${f}'`),`${f} dans CORE`);
  const app=read('app.js');assert.match(app,/action==='open-invoices'/);assert.match(app,/data-action="new-invoice"/);assert.match(app,/name="m3Rate"/);
  assert.match(read('design-v3.css'),/n° 56/);
});

test('un avoir total est exactement l’opposé de la facture (arrondi symétrique)', () => {
  const lines = [{label: 'Fauche', quantity: 37.37, unitPrice: 139.27, vatRate: 20}];
  const facture = invoiceTotals(lines);
  const avoir = invoiceTotals(lines.map(l => ({...l, quantity: -l.quantity})));
  assert.equal(avoir.ht, -facture.ht);
  assert.equal(avoir.tva, -facture.tva);
  assert.equal(avoir.ttc, -facture.ttc);
  for (let cents = 1; cents < 2000; cents += 7) {
    const l = [{label: 'x', quantity: 1, unitPrice: cents / 100 + 0.005, vatRate: 20}];
    assert.equal(invoiceTotals(l.map(x => ({...x, quantity: -1}))).ttc, -invoiceTotals(l).ttc);
  }
});
