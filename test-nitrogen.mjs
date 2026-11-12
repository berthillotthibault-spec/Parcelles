// n° 63 — PPF (méthode du bilan simplifiée) et cahier d’enregistrement azote.
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from './state.js';
import {
  NITROGEN_REFERENCES,FERTILIZER_LIBRARY,nitrogenReferences,cultureReference,precedentEffect,fertilizerFor,nitrogenPerHa,
  olympicAverage,previousCampaigns,yieldHistory,parcelPlan,nitrogenRegister,gauge,banPeriodFor,nitrogenAlerts,
  nitrogenOverview,nitrogenComplianceChecks,parcelInZone,normalizeComposition,planPdfBlocks,registerPdfBlocks,hasInAppPlan,isFertilization,
  farmInZone,zvSourceLabel,zvStaleWarning,zvParcelNote
} from './nitrogen.js';
import {complianceChecks} from './compliance.js';

const TODAY='2026-10-08',C='2026/27';
function farm(extra={}){
  const s=emptyState();
  s.exploitation.conformite={zoneVulnerable:true};
  s.parcelles=[
    {id:'p1',nom:'Les Noues',culture:'Blé tendre',surfaceHa:10},
    {id:'p2',nom:'Grand Champ',culture:'Maïs grain',surfaceHa:5,zoneVulnerable:false}
  ];
  Object.assign(s,extra);
  return s;
}

test('références : table versionnée, source citée, modifications appliquées et bornées', ()=>{
  assert.match(NITROGEN_REFERENCES.source,/GREN Auvergne-Rhône-Alpes/);
  assert.match(NITROGEN_REFERENCES.verify,/à vérifier/);
  const s=farm();s.exploitation.azote={references:{cultures:{ble:{b:'3.2',yield:80},colza:{b:999}},organicCap:160,banPeriods:[{type:'III',season:'automne',from:'09-15',to:'01-31'},{type:'X'}]}};
  const r=nitrogenReferences(s);
  assert.equal(r.cultures.find(c=>c.key==='ble').b,3.2);
  assert.equal(r.cultures.find(c=>c.key==='ble').yield,80);
  assert.equal(r.cultures.find(c=>c.key==='colza').b,6.5);
  assert.equal(r.organicCap,160);
  assert.equal(r.banPeriods.length,1);
  assert.ok(r.modified);assert.match(r.label,/modifiée/);
  assert.equal(nitrogenReferences(emptyState()).modified,false);
});

test('cultures et précédents reconnus', ()=>{
  assert.equal(cultureReference('Blé dur').key,'ble-dur');
  assert.equal(cultureReference('Blé tendre d’hiver').key,'ble');
  assert.equal(cultureReference('Maïs ensilage').key,'mais-ensilage');
  assert.equal(cultureReference('Maïs grain').key,'mais');
  assert.equal(cultureReference('Orge de printemps').season,'printemps');
  assert.equal(cultureReference('Inconnue'),null);
  assert.equal(precedentEffect('Colza').effect,20);
  assert.equal(precedentEffect('Pois protéagineux').effect,30);
  assert.equal(precedentEffect('Blé').effect,0);
});

test('fertilisants : bibliothèque intégrée et composition du stock prioritaire', ()=>{
  assert.deepEqual(FERTILIZER_LIBRARY.map(f=>f.id),['ammonitrate','uree','solution-azotee','fumier-bovin','lisier-bovin']);
  const s=farm({stockItems:[{id:'s1',name:'Ammonitrate',fertilizer:{N:27,type:'III'}}]});
  assert.equal(fertilizerFor(s,'Ammonitrate').N,27);
  assert.equal(fertilizerFor(s,'Ammonitrate').source,'stock');
  assert.equal(fertilizerFor(s,'Ammonitrate 33,5 vrac').N,33.5);
  assert.equal(fertilizerFor(s,'Lisier de vaches').type,'II');
  assert.equal(fertilizerFor(s,'Fumier pailleux').type,'I');
  assert.equal(fertilizerFor(s,'Glyphosate'),null);
  assert.equal(normalizeComposition({N:'abc'}),null);
  assert.deepEqual(normalizeComposition({N:'18',P2O5:46,type:'III'}),{N:18,P2O5:46,K2O:0,SO3:0,type:'III',keq:1,density:1});
});

test('azote apporté par hectare selon l’unité de dose', ()=>{
  const amm=fertilizerFor(emptyState(),'ammonitrate'),lisier=fertilizerFor(emptyState(),'lisier'),sol=fertilizerFor(emptyState(),'solution azotée');
  assert.deepEqual(nitrogenPerHa({dose:150,doseUnit:'kg/ha'},amm),{nTotal:50.3,nEff:50.3});
  assert.deepEqual(nitrogenPerHa({dose:30,doseUnit:'m³/ha'},lisier),{nTotal:105,nEff:52.5});
  assert.deepEqual(nitrogenPerHa({dose:100,doseUnit:'L/ha'},sol),{nTotal:39,nEff:35.1});
  assert.deepEqual(nitrogenPerHa({dose:60,doseUnit:'unité/ha'},null),{nTotal:60,nEff:60});
  assert.equal(nitrogenPerHa({dose:'',doseUnit:'kg/ha'},amm),null);
  assert.equal(nitrogenPerHa({dose:10,doseUnit:'graines/ha'},amm),null);
});

test('moyenne olympique : 5 valeurs sans la plus haute ni la plus basse', ()=>{
  assert.deepEqual(olympicAverage([70,80,60,90,75]),{value:75,method:'olympique',count:5});
  assert.deepEqual(olympicAverage([70,80]),{value:75,method:'simple',count:2});
  assert.equal(olympicAverage([]),null);
  assert.deepEqual(previousCampaigns(C,3),['2025/26','2024/25','2023/24']);
});

test('historique des rendements : lots de récolte puis économie, même culture seulement', ()=>{
  const s=farm({
    rotations:[{id:'r1',parcelId:'p1',campaignId:'2025/26',culture:'Maïs grain'},{id:'r2',parcelId:'p1',campaignId:'2024/25',culture:'Blé tendre'}],
    integrationImports:[{id:'h1',farmKind:'harvest',parcelId:'p1',date:'2025-07-15',quantity:72,unit:'t'},{id:'h2',farmKind:'harvest',parcelId:'p1',date:'2025-09-20',quantity:95,unit:'t'}]
  });
  s.parcelles[0].economicsByCampaign={'2023/24':{yield:6.8,yieldUnit:'t/ha'},'2022/23':{yield:65,yieldUnit:'q/ha'}};
  const h=yieldHistory(s,s.parcelles[0],C,cultureReference('Blé'),TODAY);
  assert.deepEqual(h.map(x=>[x.campaign,x.value,x.source]),[['2024/25',72,'lots de récolte'],['2023/24',68,'économie'],['2022/23',65,'économie']]);
});

test('PPF : X = besoin − reliquat − sol − précédent, jamais négatif', ()=>{
  const s=farm({rotations:[{id:'r0',parcelId:'p1',campaignId:'2025/26',culture:'Colza'},{id:'r1',parcelId:'p1',campaignId:C,culture:'Blé tendre',ppf:{rsh:30}}]});
  const plan=parcelPlan(s,s.parcelles[0],C,{today:TODAY});
  assert.equal(plan.objective.method,'référence');
  assert.equal(plan.besoin,210);   // 3 × 70
  assert.equal(plan.precedent.effect,20);
  assert.equal(plan.dose,210-30-40-20);
  assert.ok(plan.complete);
  s.rotations[1].ppf={rsh:300,yieldTarget:50};
  assert.equal(parcelPlan(s,s.parcelles[0],C,{today:TODAY}).dose,0);
  const noRsh=parcelPlan(farm(),farm().parcelles[0],C,{today:TODAY});
  assert.equal(noRsh.complete,false);
  assert.deepEqual(noRsh.missing,['reliquat sortie hiver']);
  assert.equal(hasInAppPlan(s,C),true);
  assert.equal(hasInAppPlan(farm(),C),false);
});

test('zone vulnérable : champ de la parcelle prioritaire sur le réglage', ()=>{
  const s=farm();
  assert.equal(parcelInZone(s,s.parcelles[0]),true);
  assert.equal(parcelInZone(s,s.parcelles[1]),false);
  s.exploitation.conformite.zoneVulnerable=false;
  assert.equal(parcelInZone(s,{zoneVulnerable:true}),true);
});

test('cahier : apports terminés de la campagne, N efficace et jauge', ()=>{
  const s=farm({
    rotations:[{id:'r1',parcelId:'p1',campaignId:C,culture:'Blé tendre',ppf:{rsh:20}}],
    interventions:[
      {id:'w1',parcelId:'p1',type:'Fertilisation',product:'Ammonitrate',dose:300,doseUnit:'kg/ha',date:'2027-02-20',status:'Terminé'},
      {id:'w2',parcelId:'p1',type:'Fertilisation',product:'Ammonitrate',dose:200,doseUnit:'kg/ha',date:'2027-04-01',status:'À faire'},
      {id:'w3',parcelId:'p1',type:'Fertilisation',product:'Engrais maison',dose:100,doseUnit:'kg/ha',date:'2027-03-01',status:'Terminé'},
      {id:'w4',parcelId:'p1',type:'Semis',date:'2026-10-20',status:'Terminé'}
    ]});
  const reg=nitrogenRegister(s,C);
  assert.deepEqual(reg.map(r=>r.work.id),['w1','w3']);
  assert.equal(reg[0].nEff,100.5);assert.equal(reg[0].quantity,3000);
  assert.deepEqual(reg[1].missing,['composition']);
  const o=nitrogenOverview(s,{today:TODAY,campaign:C}),p1=o.plans.find(p=>p.parcel.id==='p1');
  assert.equal(p1.realized,100.5);
  assert.equal(p1.gauge.status,'under');
  assert.equal(gauge(100,120).status,'over');
  assert.equal(gauge(100,105).status,'ok');
  assert.equal(gauge(null,10).status,'unknown');
});

test('alertes : épandage prévu en période d’interdiction et plafond de 170 kg N organique', ()=>{
  assert.equal(banPeriodFor('2026-12-01','III','automne').from,'09-01');
  assert.equal(banPeriodFor('2027-03-01','III','automne'),null);
  assert.equal(banPeriodFor('2027-01-10','I','prairie').from,'12-15');
  const s=farm({interventions:[
    {id:'w1',parcelId:'p1',type:'Fertilisation',product:'Ammonitrate',dose:150,doseUnit:'kg/ha',plannedDate:'2026-11-10',date:'2026-11-10',status:'À faire'},
    {id:'w2',parcelId:'p2',type:'Fertilisation',product:'Ammonitrate',dose:150,doseUnit:'kg/ha',plannedDate:'2026-11-10',date:'2026-11-10',status:'À faire'},
    {id:'w3',parcelId:'p1',type:'Épandage',product:'Fumier bovin',dose:40,doseUnit:'t/ha',date:'2026-09-15',status:'Terminé'}
  ]});
  const {alerts,organic}=nitrogenAlerts(s,{today:TODAY,campaign:C});
  assert.deepEqual(alerts.filter(a=>a.kind==='ban').map(a=>a.workId),['w1']); // p2 hors zone vulnérable
  assert.equal(organic.perHa,146.7); // 40 t × 5,5 kg × 10 ha / 15 ha
  assert.equal(alerts.some(a=>a.kind==='cap'),false);
  s.interventions[2].dose=50;
  assert.ok(nitrogenAlerts(s,{today:TODAY,campaign:C}).alerts.some(a=>a.kind==='cap'));
});

test('alertes : épandage réalisé en période d’interdiction, campagne affichée seulement', ()=>{
  const s=farm({interventions:[
    {id:'w1',parcelId:'p1',type:'Fertilisation',product:'Ammonitrate',dose:150,doseUnit:'kg/ha',date:'2026-10-15',status:'Terminé'},
    {id:'w2',parcelId:'p1',type:'Fertilisation',product:'Ammonitrate',dose:150,doseUnit:'kg/ha',date:'2025-10-15',status:'Terminé'}
  ]});
  const ban=nitrogenAlerts(s,{today:'2026-10-20',campaign:C}).alerts.filter(a=>a.kind==='ban');
  assert.deepEqual(ban.map(a=>a.workId),['w1']);
  assert.match(ban[0].label,/réalisé le/);
});

test('conformité : entrée azote ajoutée au tableau et PPF calculé reconnu', ()=>{
  const s=farm({rotations:[{id:'r1',parcelId:'p1',campaignId:C,culture:'Blé tendre',ppf:{rsh:20}}]});
  const checks=complianceChecks(s,{today:TODAY});
  const plan=checks.find(c=>c.id==='nitrogen-plan');
  assert.ok(plan);assert.equal(plan.status,'ok');
  assert.equal(checks.find(c=>c.id==='nitrogen').status,'ok');
  const out=farm();out.exploitation.conformite.zoneVulnerable=false;out.parcelles[1].zoneVulnerable=false;
  assert.equal(nitrogenComplianceChecks(out,{today:TODAY})[0].status,'na');
});

test('PDF : blocs du PPF et du cahier avec source et mention indicative', ()=>{
  const s=farm({rotations:[{id:'r1',parcelId:'p1',campaignId:C,culture:'Blé tendre',ppf:{rsh:20}}]});
  const plan=planPdfBlocks(s,{today:TODAY,campaign:C}),reg=registerPdfBlocks(s,{today:TODAY,campaign:C});
  assert.match(plan[0].text,/Plan prévisionnel/);
  assert.ok(plan.some(b=>/GREN/.test(b.text||'')));
  assert.ok(plan.some(b=>b.type==='note'&&/indicatif/.test(b.text)));
  assert.equal(plan.find(b=>b.type==='table').rows.length,2);
  assert.match(reg[0].text,/Cahier/);
});

test('fertilisation : le genre choisi prime sur le libellé', () => {
  assert.equal(isFertilization({kind:'none',type:'Épandage lisier'}),false);
  assert.equal(isFertilization({kind:'fertilize',type:'Apport'}),true);
});

// A5 — détection Sandre : explicite > automatique > exploitation ; signal d’obsolescence.
const AUTO_IN={inZone:true,zones:[{nom:'désignation',bassin:'G',arrete:'21.231',datePubli:'2021-08-30',dateMaj:'2024-09-04'}],checkedAt:new Date(2026,10,12,9).getTime()};
const AUTO_OUT={inZone:false,zones:[],checkedAt:new Date(2026,10,3,9).getTime()};

test('zone vulnérable : choix explicite > détection Sandre > réglage de l’exploitation', ()=>{
  const s=farm();
  assert.equal(parcelInZone(s,s.parcelles[0],AUTO_OUT),false,'détection avant réglage');
  assert.equal(parcelInZone(s,s.parcelles[1],AUTO_IN),false,'choix explicite avant détection');
  assert.equal(parcelInZone(s,s.parcelles[0],{inZone:null}),true,'inconnu : réglage');
  assert.equal(parcelInZone(s,s.parcelles[0],id=>id==='p1'?AUTO_OUT:null),false,'résolveur par id');
  s.exploitation.conformite.zoneVulnerable=false;
  assert.equal(parcelInZone(s,s.parcelles[0],AUTO_IN),true);
  assert.equal(farmInZone(s),false);
  assert.equal(farmInZone(s,id=>id==='p1'?AUTO_IN:null),true);
  assert.equal(farmInZone(s,id=>id==='p2'?AUTO_IN:null),false,'p2 refusée explicitement');
  assert.equal(nitrogenComplianceChecks(s,{today:TODAY})[0].status,'na');
  assert.notEqual(nitrogenComplianceChecks(s,{today:TODAY,zvAuto:id=>id==='p1'?AUTO_IN:null})[0].status,'na');
  assert.equal(parcelPlan(s,s.parcelles[0],C,{today:TODAY,zvAuto:()=>AUTO_IN}).zone,true);
  const n=complianceChecks(s,{today:TODAY,zvAuto:id=>id==='p1'?AUTO_IN:null}).find(c=>c.id==='nitrogen');
  assert.notEqual(n.status,'na','compliance : la détection révèle l’obligation');
  assert.equal(complianceChecks(s,{today:TODAY}).find(c=>c.id==='nitrogen').status,'na','sans détection : inchangé');
});

test('zone vulnérable : libellé de la source, écart et avertissement d’obsolescence', ()=>{
  assert.equal(zvSourceLabel(AUTO_IN),'détectée (Sandre, arrêté 21.231, vérifiée le 12/11)');
  assert.equal(zvSourceLabel(AUTO_OUT),'hors zone détectée (Sandre, vérifiée le 03/11)');
  assert.equal(zvSourceLabel(null),'');
  assert.equal(zvStaleWarning(AUTO_IN),'','désignation antérieure à la table');
  const recent={...AUTO_IN,zones:[{...AUTO_IN.zones[0],dateMaj:'2026-10-15'}]};
  assert.match(zvStaleWarning(recent),/^Références d’interdiction à revérifier/);
  assert.match(zvStaleWarning(recent),/2026/);
  assert.equal(zvStaleWarning(recent,{date:'2026-12-01'}),'');
  assert.equal(NITROGEN_REFERENCES.banPeriods.length>0,true,'périodes inchangées');
  const note=zvParcelNote({zoneVulnerable:false},AUTO_IN);
  assert.equal(note.diverges,true);assert.equal(note.confirmed,false);assert.equal(note.detected,true);
  assert.equal(zvParcelNote({zoneVulnerable:true},AUTO_IN).confirmed,true);
  assert.equal(zvParcelNote({},AUTO_IN).diverges,false);
  assert.equal(zvParcelNote({},{inZone:null}),null);
});

test('A5 : zvStaleWarning garde le bon jour quel que soit le fuseau (revue)', async ()=>{
  const {execFileSync}=await import('node:child_process');
  const code=`import('./nitrogen.js').then(m=>process.stdout.write(m.zvStaleWarning({inZone:true,zones:[{dateMaj:'2026-10-15'}]},{date:'2026-09-01'})))`;
  for(const TZ of ['America/Martinique','Pacific/Tahiti','Europe/Paris']){
    const out=execFileSync(process.execPath,['-e',code],{env:{...process.env,TZ},encoding:'utf8'});
    assert.match(out,/15 oct\. 2026/,TZ);assert.match(out,/1 sept\. 2026/,TZ);
  }
});
