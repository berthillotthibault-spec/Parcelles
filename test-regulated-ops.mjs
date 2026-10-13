// n° 72 : opérateurs et matériel réglementés (données fictives).
import assert from 'node:assert/strict';
import test from 'node:test';
import {addYears, adminDeadlines, adminDeadlinesCheck, deadlineNotifications, operatorCards, operatorCertificateWarning, regulatedSettings} from './regulated-ops.js';
import {checkTreatment} from './phyto.js';
import {computeNotifications} from './notifications.js';
import {complianceChecks} from './compliance.js';
import {emptyState} from './state.js';

const TODAY='2026-10-12';
function farm(){
  const s=emptyState();
  s.exploitation.conformite={warnDays:60,certiphytos:[
    {nom:'Alice Fictive',numero:'CP-0001',categorie:'decideur',expiresAt:'2027-06-30'},
    {nom:'Bruno Exemple',numero:'',categorie:'operateur',expiresAt:'2026-11-20'},
    {nom:'Chloé Test',expiresAt:'2026-01-31'}
  ],cspDate:'2021-03-01'};
  s.materiels=[
    {id:'m1',nom:'Pulvé traîné 24 m',controleDate:'2023-11-01'},
    {id:'m2',nom:'Tracteur',insuranceDue:'2026-10-01'},
    {id:'m3',nom:'Atomiseur',deletedAt:1}
  ];
  return s;
}

test('fiches opérateur : n°, catégorie, validité', ()=>{
  const cards=operatorCards(farm());
  assert.deepEqual(cards[0],{nom:'Alice Fictive',numero:'CP-0001',categorie:'decideur',expiresAt:'2027-06-30'});
  assert.equal(cards[2].categorie,'');
  assert.equal(regulatedSettings(farm()).sprayerControlYears,3,'périodicité par défaut');
});

test('traitement : avertissement si Certiphyto absent ou expiré, rien si valide', ()=>{
  const s=farm(),work=extra=>({type:'Traitement fongicide',isPhytosanitary:true,parcelId:'p',date:TODAY,product:'Produit fictif',...extra});
  assert.equal(operatorCertificateWarning(s,work({operator:'Alice Fictive'})),null);
  assert.match(operatorCertificateWarning(s,work({operator:'chloe test'})).message,/expiré le 31 janv\. 2026/);
  assert.match(operatorCertificateWarning(s,work({operator:'Inconnu'})).message,/aucun Certiphyto/);
  assert.equal(operatorCertificateWarning(s,work({})),null,'sans opérateur : pas d’avertissement');
  const result=checkTreatment(s,work({operator:'Inconnu'}));
  assert.ok(result.warnings.some(w=>w.code==='certiphyto'));
  assert.ok(!result.blocking.some(w=>w.code==='certiphyto'),'avertit, ne bloque pas');
});

test('échéances regroupées et triées', ()=>{
  const rows=adminDeadlines(farm(),{today:TODAY});
  const by=id=>rows.find(r=>r.id===id);
  assert.equal(by('sprayer:m1').dueDate,'2026-11-01');assert.equal(by('sprayer:m1').status,'warn');
  assert.equal(by('insurance:m2').status,'ko');
  assert.equal(by('certiphyto:chloe test').status,'ko');
  assert.equal(by('certiphyto:bruno exemple').status,'warn');
  assert.equal(by('certiphyto:alice fictive').status,'ok');
  assert.equal(by('csp').dueDate,'2026-03-01');assert.equal(by('csp').status,'ko');
  assert.ok(!rows.some(r=>r.id==='sprayer:m3'),'matériel supprimé ignoré');
  assert.deepEqual([...new Set(rows.map(r=>r.status))],['ko','warn','ok']);
  assert.equal(addYears('2024-02-29',3),'2027-03-01');
});

test('périodicité modifiable : contrôle tous les 5 ans', ()=>{
  const s=farm();s.exploitation.conformite.sprayerControlYears=5;
  assert.equal(adminDeadlines(s,{today:TODAY}).find(r=>r.kind==='sprayer').dueDate,'2028-11-01');
});

test('rappels sur l’accueil (notifications) et voyant de conformité', ()=>{
  const notes=deadlineNotifications(farm(),{today:TODAY});
  assert.ok(notes.every(n=>['urgent','warning'].includes(n.level)));
  assert.ok(notes.some(n=>n.entity==='materiels'&&n.entityId==='m1'));
  assert.ok(notes.some(n=>n.entity==='regulated'&&/Certiphyto de Chloé Test/.test(n.message)));
  const all=computeNotifications(farm());
  assert.ok(all.some(n=>n.id.startsWith('deadline-')));
  const check=adminDeadlinesCheck(farm(),{today:TODAY});
  assert.equal(check.status,'ko');assert.equal(check.action.type,'regulated');
  assert.ok(complianceChecks(farm(),{today:TODAY}).some(c=>c.id==='admin-deadlines'));
  assert.equal(adminDeadlinesCheck(emptyState(),{today:TODAY}).status,'na');
});
