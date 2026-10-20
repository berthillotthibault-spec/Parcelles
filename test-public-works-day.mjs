import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from './state.js';
import {canMutate} from './permissions.js';
import {limitedCloudPayload} from './sync.js';
import {TP_DAY_METER_OPERATION,keypadInput,parseDecimal,planTpDay,saveTpDay,tpDayAllowed,tpDayEquipment,tpDaySaveOperations,tpDayShareText,tpDayUndoScope,tpDayWriteCount,undoTpDay} from './public-works-day.js';

class MemoryStorage{
  constructor(){this.value=null;}
  async init(){}
  async get(){return this.value;}
  async set(_k,v){this.value=structuredClone(v);}
  async backupPut(){}
  async pruneBackups(){}
  async blobDelete(){}
}

const chantier={id:'c1',kind:'tp',type:'Terrassement Dupont',address:'Route du moulin',clientId:'cl1',equipmentId:'m1',status:'En cours',tpLogs:[
  {id:'l0',date:'2026-10-14',equipmentId:'m2',hours:6,createdAt:1,deletedAt:null}
]};
const base=()=>({
  chantiers:[structuredClone(chantier)],
  materiels:[{id:'m1',nom:'Pelle 8 t',currentMeter:1200},{id:'m2',nom:'Tombereau',currentMeter:null},{id:'m3',nom:'Mini-pelle',currentMeter:50,deletedAt:5}],
  integrationImports:[],documents:[],preferences:{fuelPrice:1.5}
});

test('pavé numérique : chiffres, virgule, effacement et limites', ()=>{
  let v='';
  for(const k of ['0','7',',','5','2','9'])v=keypadInput(v,k);
  assert.equal(v,'7,52','zéro initial remplacé, deux décimales maximum');
  assert.equal(keypadInput('',','),'0,');
  assert.equal(keypadInput('3,1',','),'3,1','une seule virgule');
  assert.equal(keypadInput('12','back'),'1');
  assert.equal(keypadInput('12','clear'),'');
  assert.equal(keypadInput('123456789','1'),'123456789');
  assert.equal(keypadInput('4','x'),'4');
  assert.equal(parseDecimal('7,5'),7.5);
  assert.equal(parseDecimal(''),null);
  assert.ok(Number.isNaN(parseDecimal('-2')));
});

test('engins proposés : principal puis journal, sans engin supprimé', ()=>{
  const rows=tpDayEquipment(base(),chantier);
  assert.deepEqual(rows.map(r=>r.id),['m1','m2']);
  assert.equal(rows[0].previousMeter,1200);
  assert.equal(rows[1].previousMeter,null);
});

test('récapitulatif : différence de compteur, unités, carburant et contrôles', ()=>{
  const plan=planTpDay(base(),chantier,{date:'2026-10-15',operator:' Paul ',rows:[
    {equipmentId:'m1',meter:'1207,5',quantity:'42',unit:'volumeM3',fuel:'60'},
    {equipmentId:'m2',hours:'7',quantity:'18,5',unit:'tonnage'},
    {equipmentId:'m3'}
  ]},{today:'2026-10-15'});
  assert.equal(plan.ready,true,plan.errors.join());
  assert.equal(plan.entries[0].hours,7.5);
  assert.equal(plan.entries[0].hoursFromMeter,true);
  assert.equal(plan.entries[0].fuelAmount,90);
  assert.equal(plan.entries[1].tonnage,18.5);
  assert.equal(plan.entries[1].volumeM3,null);
  assert.deepEqual(plan.totals,{hours:14.5,volumeM3:42,tonnage:18.5,fuelLiters:60,fuelAmount:90});
  assert.equal(plan.operator,'Paul');
  assert.deepEqual(tpDayWriteCount(plan,{photo:true}),{logs:2,meters:1,fuels:1,photo:1});
  const low=planTpDay(base(),chantier,{date:'2026-10-15',rows:[{equipmentId:'m1',meter:'1100'}]});
  assert.match(low.errors[0],/inférieur au dernier relevé/);
  const tooMany=planTpDay(base(),chantier,{date:'2026-10-15',rows:[{equipmentId:'m2',hours:'30'}]});
  assert.match(tooMany.errors[0],/24 h maximum/);
  const jump=planTpDay(base(),chantier,{date:'2026-10-15',rows:[{equipmentId:'m1',meter:'1250'}]});
  assert.equal(jump.ready,true);
  assert.match(jump.warnings[0],/50 h depuis le dernier relevé/);
  const empty=planTpDay(base(),chantier,{date:'2026-10-15',rows:[{equipmentId:'m1'}]});
  assert.equal(empty.ready,false);
  const future=planTpDay(base(),chantier,{date:'2026-10-20',rows:[{equipmentId:'m2',hours:'2'}]},{today:'2026-10-15'});
  assert.match(future.errors[0],/futur/);
  const bad=planTpDay(base(),chantier,{date:'2026-10-15',rows:[{equipmentId:'m2',hours:'2,x'}]});
  assert.match(bad.errors[0],/Heures invalide/);
});

test('bon de chantier : sans carburant, avec compteur et totaux', ()=>{
  const plan=planTpDay(base(),chantier,{date:'2026-10-15',operator:'Paul',rows:[{equipmentId:'m1',meter:'1207,5',quantity:'42',fuel:'60'}]});
  const text=tpDayShareText(plan,{chantier,clientName:'Dupont SARL'});
  assert.match(text,/^Bon de chantier : Terrassement Dupont/);
  assert.match(text,/15\/10\/2026 · Dupont SARL/);
  assert.match(text,/Pelle 8 t : 7,5 h \(compteur 1 ?200 → 1 ?207,5\), 42 m³/);
  assert.doesNotMatch(text,/ L|GNR|carburant/i);
});

test('écriture groupée puis annulation complète', async ()=>{
  const store=new Store(new MemoryStorage());await store.init();await store.setPreferences({autoBackup:false,syncEnabled:true});
  const seed=base();
  await store.mutate('Préparation',state=>{state.chantiers.push(...seed.chantiers);state.materiels.push(...seed.materiels);state.preferences.fuelPrice=1.5;},{queue:false});
  const input={date:'2026-10-15',operator:'Paul',note:'Décapage',rows:[{equipmentId:'m1',meter:'1207,5',quantity:'42',fuel:'60'},{equipmentId:'m2',hours:'7',quantity:'18',unit:'tonnage'}]};
  const expected=planTpDay(store.state,store.get('chantiers','c1'),input);
  const doc={id:'doc_bon',name:'bon.jpg',mimeType:'image/jpeg',size:10};
  const queued=store.state.queue.length;
  const result=await saveTpDay(store,'c1',input,{expected,document:doc});
  assert.deepEqual(result.count,{logs:2,meters:1,fuels:1,photo:1});
  const c=store.get('chantiers','c1');
  const logs=c.tpLogs.filter(l=>l.dayId===result.dayId);
  assert.equal(logs.length,2);
  assert.equal(logs[0].meterStart,1200);assert.equal(logs[0].meterEnd,1207.5);assert.equal(logs[0].hours,7.5);assert.equal(logs[0].documentId,'doc_bon');
  assert.equal(store.get('materiels','m1').currentMeter,1207.5);
  const fill=store.state.integrationImports.find(r=>r.tpDayId===result.dayId);
  assert.equal(fill.farmKind,'fuel');assert.equal(fill.litres,60);assert.equal(fill.entry,'machine');
  assert.equal(store.get('documents','doc_bon').chantierId,'c1');
  assert.equal(store.get('documents','doc_bon').clientId,'cl1');
  assert.ok(store.state.queue.length>queued,'opérations à synchroniser');
  assert.deepEqual(['chantiers','materiels','integrationImports'].map(type=>store.state.queue.some(op=>op.entity===type&&op.status==='pending')),[true,true,true]);
  await assert.rejects(()=>saveTpDay(store,'c1',input,{expected}),/ont changé/,'compteur déjà avancé : récapitulatif périmé');
  const undone=await undoTpDay(store,'c1',result.dayId);
  assert.deepEqual(undone,{logs:2,fuels:1,documents:1,meters:1});
  assert.equal(store.get('materiels','m1').currentMeter,1200);
  assert.equal(store.get('chantiers','c1').tpLogs.filter(l=>l.dayId&&!l.deletedAt).length,0);
  assert.equal(store.get('documents','doc_bon'),undefined,'photo du bon à la corbeille');
  assert.ok(store.get('documents','doc_bon',{includeDeleted:true}).deletedAt);
  await assert.rejects(()=>undoTpDay(store,'c1',result.dayId),/déjà été annulée/);
});

test('ligne sans heures ni quantité : note de relevé pour rester modifiable', async ()=>{
  const store=new Store(new MemoryStorage());await store.init();await store.setPreferences({autoBackup:false});
  const seed=base();
  await store.mutate('Préparation',state=>{state.chantiers.push(...seed.chantiers);state.materiels.push(...seed.materiels);},{queue:false});
  const {dayId}=await saveTpDay(store,'c1',{date:'2026-10-15',rows:[{equipmentId:'m2',meter:'350'}]});
  const log=store.get('chantiers','c1').tpLogs.find(l=>l.dayId===dayId);
  assert.equal(log.hours,null);
  assert.match(log.note,/Relevé de compteur : 350 h/);
  assert.equal(store.get('materiels','m2').currentMeter,350,'premier relevé enregistré');
  await undoTpDay(store,'c1',dayId);
  assert.equal(store.get('materiels','m2').currentMeter,null,'annulation : compteur remis à vide');
});

test('rôle lecture seule : aucune écriture', async ()=>{
  const store=new Store(new MemoryStorage());await store.init();await store.setPreferences({autoBackup:false});
  const seed=base();
  await store.mutate('Préparation',state=>{state.chantiers.push(...seed.chantiers);state.materiels.push(...seed.materiels);},{queue:false});
  store.setWriteGuard(op=>canMutate('viewer',op));
  await assert.rejects(()=>saveTpDay(store,'c1',{date:'2026-10-15',rows:[{equipmentId:'m2',hours:'3'}]}),/rôle/);
  assert.equal(store.get('chantiers','c1').tpLogs.length,1);
});

test('opérateur terrain : relevé de compteur et annulation permis, rien d’autre sur la fiche de l’engin (vague 12)', async ()=>{
  const store=new Store(new MemoryStorage());await store.init();await store.setPreferences({autoBackup:false,syncEnabled:true});
  const seed=base();
  await store.mutate('Préparation',state=>{state.chantiers.push(...seed.chantiers);state.materiels.push(...seed.materiels);},{queue:false});
  const guard=op=>canMutate('operator',op);
  store.setWriteGuard(guard);
  assert.equal(tpDayAllowed(guard,[TP_DAY_METER_OPERATION]),true,'case Compteur affichée pour l’opérateur');
  assert.equal(tpDayAllowed(guard,[{entity:'materiels',action:'update'}]),false,'fiche complète de l’engin refusée');
  const withMeter=planTpDay(store.state,store.get('chantiers','c1'),{date:'2026-10-15',rows:[{equipmentId:'m1',meter:'1207,5',hours:'7',quantity:'30'}]});
  assert.equal(tpDayAllowed(guard,tpDaySaveOperations('c1',tpDayWriteCount(withMeter,{photo:false}))),true,'« Vérifier » accepte le relevé');
  const day=await saveTpDay(store,'c1',{date:'2026-10-15',rows:[{equipmentId:'m1',meter:'1207,5',hours:'7',quantity:'30'}]});
  const machine=store.get('materiels','m1');
  assert.equal(machine.currentMeter,1207.5,'compteur relevé par l’opérateur');
  assert.equal(machine.nom,'Pelle 8 t');
  const queued=store.state.queue.find(item=>item.entity==='materiels'&&item.entityId==='m1');
  assert.deepEqual(queued.fields,['currentMeter'],'seul le compteur part au cloud');
  assert.equal(tpDayAllowed(guard,tpDayUndoScope(store.state,'c1',day.dayId).operations),true,'« Annuler » proposé');
  await undoTpDay(store,'c1',day.dayId);
  assert.equal(store.get('materiels','m1').currentMeter,1200,'annulation : compteur remis par l’opérateur');
  assert.deepEqual(store.state.queue.find(item=>item.entity==='materiels'&&item.entityId==='m1').fields,['currentMeter'],'annulation toujours limitée au compteur');
  assert.equal(store.get('chantiers','c1').tpLogs.filter(l=>l.dayId===day.dayId&&!l.deletedAt).length,0);
  // Tout autre changement de la fiche reste refusé, compteur compris s'il est accompagné d'un autre champ.
  await assert.rejects(()=>store.upsert('materiels',{id:'m1',nom:'Pelle 8 t',coutHoraire:0}),/rôle/);
  await assert.rejects(()=>store.upsert('materiels',{id:'m1',nom:'Pelle 8 t',currentMeter:1300}),/rôle/,'upsert ordinaire : écriture complète refusée');
  assert.equal(store.get('materiels','m1').currentMeter,1200);
  assert.equal(canMutate('operator',{entity:'materiels',action:'update',fields:['currentMeter','coutHoraire']}),false);
  assert.equal(canMutate('operator',{entity:'materiels',action:'update',fields:[]}),false);
  for(const action of ['create','delete'])assert.equal(canMutate('operator',{entity:'materiels',action,fields:['currentMeter']}),false,`${action} d’engin refusé`);
  assert.equal(canMutate('operator',{entity:'parcels',action:'update',fields:['currentMeter']}),false,'exception limitée aux engins');
  assert.equal(canMutate('accountant',TP_DAY_METER_OPERATION),false,'comptabilité : pas de relevé');
  assert.equal(canMutate('viewer',TP_DAY_METER_OPERATION),false);
  const fuel=await saveTpDay(store,'c1',{date:'2026-10-16',rows:[{equipmentId:'m1',hours:'7',fuel:'50'}]});
  const allowed=tpDayAllowed(guard,tpDayUndoScope(store.state,'c1',fuel.dayId).operations);
  assert.equal(allowed,canMutate('operator',{entity:'integrationImports',action:'delete',farmKind:'fuel'}),'« Annuler » proposé seulement si le rôle peut tout retirer');
  if(!allowed)await assert.rejects(()=>undoTpDay(store,'c1',fuel.dayId),/annuler/);
  assert.equal(tpDayAllowed(null,[{entity:'materiels',action:'update'}]),true,'sans garde-fou : tout est permis');
});

test('file d’envoi : écriture limitée au compteur, élargie par une écriture complète', async ()=>{
  const store=new Store(new MemoryStorage());await store.init();await store.setPreferences({autoBackup:false,syncEnabled:true});
  store.queue({entity:'materiels',entityId:'m1',action:'update',payload:{id:'m1'},fields:['currentMeter']});
  store.queue({entity:'materiels',entityId:'m1',action:'update',payload:{id:'m1'},fields:['currentMeter']});
  assert.deepEqual(store.state.queue.filter(item=>item.entityId==='m1').map(item=>item.fields),[['currentMeter']]);
  store.queue({entity:'materiels',entityId:'m1',action:'update',payload:{id:'m1'}});
  assert.equal(store.state.queue.find(item=>item.entityId==='m1').fields,undefined,'écriture complète : plus de limite');
  store.queue({entity:'materiels',entityId:'m1',action:'update',payload:{id:'m1'},fields:['currentMeter']});
  assert.equal(store.state.queue.find(item=>item.entityId==='m1').fields,undefined,'une écriture complète en attente reste complète');
});

test('sync : fiche limitée = fiche du serveur + compteur local', ()=>{
  const remote={id:'m1',nom:'Pelle 8 t',coutHoraire:45,currentMeter:1200,version:3,updatedAt:5};
  const local={id:'m1',nom:'Pelle modifiée',coutHoraire:0,currentMeter:1207.5,version:2,updatedAt:9};
  const limited=limitedCloudPayload(remote,local,['currentMeter']);
  assert.deepEqual(limited,{id:'m1',nom:'Pelle 8 t',coutHoraire:45,currentMeter:1207.5,version:4,updatedAt:9});
  assert.equal(remote.currentMeter,1200,'fiche du serveur intacte');
  assert.equal(limitedCloudPayload(remote,{id:'m1',version:7,updatedAt:9},['currentMeter']).currentMeter,null,'compteur vidé');
  assert.equal(limitedCloudPayload(remote,{id:'m1',version:7,updatedAt:9},['currentMeter']).version,7);
});

test('virgule finale du pavé tolérée', ()=>{
  assert.equal(parseDecimal('12,'),12);
  assert.ok(Number.isNaN(parseDecimal(',5')));
  const plan=planTpDay(base(),base().chantiers[0],{date:'2026-10-15',rows:[{equipmentId:'m1',meter:'1207,'}]},{today:'2026-10-18'});
  assert.equal(plan.ready,true,plan.errors.join(' '));
  assert.equal(plan.entries[0].meterEnd,1207);
});

test('fichiers de la fin de journée dans CORE et REQUIRED_ASSETS', async ()=>{
  const {readFile}=await import('node:fs/promises');
  const [sw,runtime]=await Promise.all([readFile(new URL('./sw.js',import.meta.url),'utf8'),readFile(new URL('./runtime.js',import.meta.url),'utf8')]);
  for(const src of ['./public-works-day.js','./public-works-day-ui.js'])assert.ok(sw.includes(`'${src}'`)&&runtime.includes(`'${src}'`),`${src} dans CORE et REQUIRED_ASSETS`);
});
