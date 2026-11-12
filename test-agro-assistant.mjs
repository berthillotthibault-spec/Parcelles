// Assistant agronomique local (agro-assistant.js, agro-knowledge.js) : reconnaissance des questions,
// réponses chiffrées appuyées sur les modules existants, et faux positifs à éviter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {answerAgroQuestion, parcelInQuestion, nitrogenBalance} from './agro-assistant.js';
import {agroIntent, agroText, cropAfterWord, nextCropOptions} from './agro-knowledge.js';
import {answerLocalIntelligence} from './intelligence.js';

const pad = n => String(n).padStart(2, '0');
const localMs = (day, h) => new Date(`${day}T${pad(h)}:00:00`).getTime();

function farm() {
  return {
    parcelles: [
      {id: 'p1', nom: 'Les Brosses', culture: 'Blé tendre', surfaceHa: 10},
      {id: 'p2', nom: 'Grand Champ', culture: 'Maïs grain', surfaceHa: 8},
      {id: 'p3', nom: 'La Noue', culture: 'Pois', surfaceHa: 5}
    ],
    stockItems: [
      {id: 's1', name: 'Prosaro', phyto: {dar: 35, dre: 48}},
      {id: 's2', name: 'Ammonitrate 33,5', fertilizer: {N: 33.5, type: 'III'}}
    ],
    rotations: [
      {id: 'r1', parcelId: 'p1', campaignId: '2024/25', culture: 'Colza'},
      {id: 'r2', parcelId: 'p1', campaignId: '2025/26', culture: 'Blé tendre'}
    ],
    interventions: [
      {id: 't1', parcelId: 'p1', type: 'Traitement fongicide', product: 'Prosaro', status: 'Terminé', date: '2026-05-08', endTime: '10:00'},
      {id: 'f1', parcelId: 'p1', type: 'Apport azote', product: 'Ammonitrate 33,5', dose: 150, doseUnit: 'kg/ha', status: 'Terminé', date: '2026-03-01'},
      {id: 'f2', parcelId: 'p1', type: 'Apport azote', product: 'Engrais maison', dose: 100, doseUnit: 'kg/ha', status: 'Terminé', date: '2026-04-01'},
      {id: 'f3', parcelId: 'p1', type: 'Apport azote', product: 'Ammonitrate 33,5', dose: 90, doseUnit: 'kg/ha', status: 'À faire', plannedDate: '2026-05-20'}
    ],
    preferences: {}
  };
}

function weather(now) {
  const time = [], wind = [], gust = [], temp = [], rh = [], rain = [], cloud = [];
  for (const [day, w] of [['2026-05-10', 8], ['2026-05-11', 32]]) for (let h = 0; h < 24; h++) {
    time.push(`${day}T${pad(h)}:00`); wind.push(w); gust.push(w + 6); temp.push(15); rh.push(70); rain.push(0); cloud.push(80);
  }
  return {loadedAt: now, hourly: {time, wind_speed_10m: wind, wind_gusts_10m: gust, temperature_2m: temp, relative_humidity_2m: rh, precipitation: rain, cloud_cover: cloud}};
}
const NOW = localMs('2026-05-10', 7), CTX = {today: '2026-05-10', now: NOW};

// ---- Reconnaissance -------------------------------------------------------------------------

test('reconnaissance tolérante : accents, fautes et formulations', () => {
  assert.equal(agroIntent('Puis-je traiter aujourd’hui ?'), 'spray');
  assert.equal(agroIntent('peut on pulvé demain'), 'spray');
  assert.equal(agroIntent('je peux traitter ce soir ?'), 'spray');
  assert.equal(agroIntent('Quel est le délai avant récolte des Brosses ?'), 'dar');
  assert.equal(agroIntent('quand puis-je moissonner les Brosses'), 'dar');
  assert.equal(agroIntent('Délai de rentrée sur Grand Champ ?'), 'reentry');
  assert.equal(agroIntent('quand puis je retourner dans la parcelle'), 'reentry');
  assert.equal(agroIntent('peut-on semer le maïs ?'), 'sowing');
  assert.equal(agroIntent('le sol est-il ressuyé ?'), 'sowing');
  assert.equal(agroIntent('risque de septo cette semaine ?'), 'risk');
  assert.equal(agroIntent('y a-t-il un risque de gel ?'), 'risk');
  assert.equal(agroIntent('combien d’azote sur les Brosses ?'), 'nitrogen');
  assert.equal(agroIntent('quelle culture après un colza ?'), 'nextCrop');
  assert.equal(agroIntent('que puis-je semer derrière le blé ?'), 'nextCrop');
  assert.equal(agroText('Pulvérisation'), 'pulveriser');
});

test('faux positifs : facturation, achats et historique ne sont pas captés', () => {
  for (const q of ['combien me doit Martin', 'facture du traitement de demain pour Dupont', 'quel taux de TVA pour une prestation de traitement',
    'prix de l’ammonitrate', 'quand ai-je fait le dernier traitement', 'combien de traitements cette année', 'bonjour', '', 'stock d’azote'])
    assert.equal(agroIntent(q), null, q);
  assert.equal(answerAgroQuestion('combien me doit Martin', farm(), CTX), null);
  assert.equal(answerAgroQuestion('Quelle est ma marge sur les prestations ?', farm(), CTX), null);
});

test('parcelle citée : nom complet, sans article, ou parcelle courante', () => {
  const s = farm();
  assert.equal(parcelInQuestion('azote sur les brosses', s).id, 'p1');
  assert.equal(parcelInQuestion('azote sur brosses', s).id, 'p1');
  assert.equal(parcelInQuestion('délai sur noue', s).id, 'p3');
  assert.equal(parcelInQuestion('délai de rentrée ici', s, {currentParcelId: 'p2'}).id, 'p2');
  assert.equal(parcelInQuestion('délai de rentrée', s), null);
});

// ---- Traitement -----------------------------------------------------------------------------

test('puis-je traiter aujourd’hui : créneau favorable tiré de la prévision horaire', () => {
  const r = answerAgroQuestion('Puis-je traiter aujourd’hui ?', farm(), {...CTX, weather: weather(NOW)});
  assert.equal(r.intent, 'spray_window');
  assert.match(r.answer, /Créneaux favorables aujourd’hui : \d+ h–\d+ h/);
  assert.match(r.answer, /19 km\/h/);
  assert.match(r.answer, /ZNT/);
});

test('puis-je traiter demain : vent trop fort, pas de créneau, raison citée', () => {
  const r = answerAgroQuestion('peut-on traiter demain ?', farm(), {...CTX, weather: weather(NOW)});
  assert.match(r.answer, /Pas de créneau favorable demain/);
  assert.match(r.answer, /Vent 32 km\/h/);
});

test('traiter sans prévision horaire : pluie du jour et renvoi vers la météo', () => {
  const r = answerAgroQuestion('je peux traiter aujourd’hui ?', farm(), {...CTX, agroDays: [{date: '2026-05-10', tmin: 8, tmax: 18, rain: 4.2}]});
  assert.match(r.answer, /Pluie prévue aujourd’hui : 4,2 mm/);
  assert.match(r.answer, /ouvrez la météo/);
});

test('traiter sur une parcelle en délai de rentrée : le délai est rappelé', () => {
  const now = localMs('2026-05-09', 8);
  const r = answerAgroQuestion('puis-je traiter les Brosses aujourd’hui ?', farm(), {today: '2026-05-09', now});
  assert.match(r.answer, /Les Brosses : accès interdit jusqu’à demain 10 h/);
});

// ---- DAR et délai de rentrée ----------------------------------------------------------------

test('délai avant récolte : date à partir de laquelle récolter, avec la source', () => {
  const r = answerAgroQuestion('Quel est le délai avant récolte sur les Brosses ?', farm(), CTX);
  assert.equal(r.intent, 'dar');
  assert.match(r.answer, /Les Brosses : Prosaro du 08\/05, délai avant récolte de 35 j : récolte possible à partir du 12\/06\./);
  assert.match(r.answer, /étiquette du produit/);
  assert.deepEqual(r.actions[0], {type: 'open_parcel', label: 'Ouvrir · Les Brosses', payload: {parcelId: 'p1'}});
});

test('délai avant récolte : aucun délai en cours, traitement sans fiche signalé', () => {
  const s = farm();
  s.interventions.push({id: 't2', parcelId: 'p2', type: 'Traitement insecticide', product: 'Produit X', status: 'Terminé', date: '2026-05-01'});
  const r = answerAgroQuestion('quand puis-je récolter Grand Champ ?', s, CTX);
  assert.match(r.answer, /Grand Champ : aucun délai avant récolte en cours/);
  assert.match(r.answer, /1 traitement de la campagne sans délai avant récolte connu \(Produit X\)/);
});

test('délai de rentrée : fiche produit (48 h) puis plus rien après', () => {
  const r = answerAgroQuestion('délai de rentrée des Brosses ?', farm(), {today: '2026-05-09', now: localMs('2026-05-09', 8)});
  assert.equal(r.intent, 'reentry');
  assert.match(r.answer, /Les Brosses : accès interdit jusqu’à demain 10 h \(Prosaro\)/);
  const later = answerAgroQuestion('quand puis-je retourner dans les Brosses ?', farm(), {today: '2026-05-10', now: localMs('2026-05-10', 12)});
  assert.match(later.answer, /Les Brosses : aucun délai de rentrée en cours/);
});

// ---- Semis, portance, risques ---------------------------------------------------------------

test('peut-on semer le maïs : température du sol comparée au repère', () => {
  const hourly = {time: [], soil_temperature_6cm: [], soil_moisture_3_to_9cm: []};
  for (const day of ['2026-05-10', '2026-05-11', '2026-05-12']) for (let h = 0; h < 24; h++) {hourly.time.push(`${day}T${pad(h)}:00`); hourly.soil_temperature_6cm.push(12); hourly.soil_moisture_3_to_9cm.push(0.25);}
  const r = answerAgroQuestion('peut-on semer le maïs sur Grand Champ ?', farm(), {...CTX, agro: {days: [{date: '2026-05-09', rain: 2}, {date: '2026-05-10', rain: 1}], hourly}});
  assert.equal(r.intent, 'sowing_conditions');
  assert.match(r.answer, /Sol à 12 °C, au-dessus du seuil maïs \(10 °C\)/);
  assert.match(r.answer, /3 mm de pluie sur les 3 derniers jours/);
  assert.match(r.answer, /test à la bêche/);
});

test('sol ressuyé sans aucune donnée : réponse prudente', () => {
  const r = answerAgroQuestion('le sol est-il ressuyé ?', farm(), CTX);
  assert.match(r.answer, /Bilan hydrique du sol non chargé/);
});

test('risque de gel : minimale prévue sous 0 °C', () => {
  const days = [{date: '2026-05-10', tmin: 3, tmax: 15, rain: 0}, {date: '2026-05-12', tmin: -1.5, tmax: 12, rain: 0}];
  const r = answerAgroQuestion('y a-t-il un risque de gel ?', farm(), {...CTX, agroDays: days});
  assert.equal(r.intent, 'agro_risk');
  assert.match(r.answer, /Gelée possible : 1 jour sous 0 °C prévu sur 7 jours, minimale -1,5 °C le 12\/05/);
});

test('risque de septoriose : pluies contaminatrices sur le blé', () => {
  const days = [{date: '2026-05-05', tmin: 8, tmax: 16, rain: 12}, {date: '2026-05-08', tmin: 8, tmax: 16, rain: 15}];
  const r = answerAgroQuestion('risque de septoriose ?', farm(), {...CTX, agroDays: days});
  assert.match(r.answer, /Les Brosses · risque de septoriose/);
  assert.match(r.answer, /Source : Arvalis/);
});

test('mildiou : non modélisé, renvoi au BSV', () => {
  const r = answerAgroQuestion('risque de mildiou ?', farm(), CTX);
  assert.match(r.answer, /n’est pas modélisé/);
  assert.match(r.answer, /BSV/);
});

// ---- Azote et culture suivante --------------------------------------------------------------

test('azote apporté : cumul réalisé, prévu et apport sans teneur', () => {
  const s = farm();
  const b = nitrogenBalance(s, s.parcelles[0], '2025/26');
  assert.equal(Math.round(b.realized), 50);
  assert.equal(Math.round(b.planned), 30);
  assert.deepEqual(b.unknown, ['Engrais maison']);
  const r = answerAgroQuestion('combien d’azote ai-je apporté sur les Brosses ?', s, CTX);
  assert.equal(r.intent, 'nitrogen_applied');
  assert.match(r.answer, /Les Brosses \(Blé tendre\) : 50 kg N efficace\/ha apportés, 30 prévus/);
  assert.match(r.answer, /teneur en azote inconnue pour Engrais maison/);
  assert.match(r.answer, /dose prévisionnelle indicative/);
});

test('azote sur une légumineuse : rappel prudent', () => {
  const r = answerAgroQuestion('combien d’azote sur la Noue ?', farm(), CTX);
  assert.match(r.answer, /La Noue : aucun apport d’engrais saisi en 2025\/26/);
  assert.match(r.answer, /légumineuse : en général pas d’apport d’azote minéral nécessaire, à confirmer/);
});

test('culture suivante après colza : pas de colza ni de tournesol, atout azote pour le blé', () => {
  const r = nextCropOptions([{campaignId: '2025/26', culture: 'Colza'}]);
  const avoid = r.avoid.map(x => x.crop);
  assert.ok(avoid.includes('Colza') && avoid.includes('Tournesol') && avoid.includes('Soja'));
  const ble = r.good.find(x => x.crop === 'Blé tendre');
  assert.match(ble.reasons.join(' '), /20 kg N\/ha à déduire/);
});

test('culture suivante après maïs grain : paille déconseillée (DON)', () => {
  const r = nextCropOptions([{campaignId: '2025/26', culture: 'Maïs grain'}]);
  assert.match(r.avoid.find(x => x.crop === 'Blé tendre').reasons.join(' '), /DON/);
  assert.equal(nextCropOptions([]), null);
});

test('culture suivante d’une parcelle : historique de l’assolement', () => {
  assert.equal(cropAfterWord('quelle culture après un colza ?'), 'Colza');
  const r = answerAgroQuestion('que semer après le blé des Brosses ?', farm(), CTX);
  assert.equal(r.intent, 'next_crop');
  assert.match(r.answer, /Après blé tendre sur Les Brosses/);
  assert.match(r.answer, /Colza \(Colza en 2024\/25 : délai de retour conseillé 3 ans/);
  assert.match(r.answer, /conseiller/);
  const none = answerAgroQuestion('quelle culture après ?', {parcelles: []}, CTX);
  assert.match(none.answer, /Précisez la culture précédente/);
});

test('intelligence locale : la question agronomique arrive jusqu’à l’assistant', () => {
  const r = answerLocalIntelligence('Quel est le délai avant récolte sur les Brosses ?', farm(), CTX);
  assert.equal(r.intent, 'dar');
  const billing = answerLocalIntelligence('combien me doit Martin', farm(), CTX);
  assert.notEqual(billing.intent, 'dar');
  assert.ok(!['spray_window', 'nitrogen_applied', 'agro_risk', 'next_crop', 'reentry', 'sowing_conditions'].includes(billing.intent));
});

test('relecture : les demandes d’écriture restent aux actions (travail, tâche)', () => {
  assert.equal(agroIntent('planifie un traitement demain sur les Brosses'), null);
  assert.equal(agroIntent('crée une tâche traiter les Brosses demain'), null);
  assert.equal(answerLocalIntelligence('planifie un traitement demain sur les Brosses', farm(), CTX).intent, 'create_work');
  assert.equal(answerLocalIntelligence('ajoute un traitement aujourd’hui sur les Brosses', farm(), CTX).intent, 'create_work');
  assert.equal(answerLocalIntelligence('crée une tâche traiter les Brosses demain', farm(), CTX).intent, 'create_task');
  assert.equal(answerLocalIntelligence('ajoute une tâche : vérifier le pulvé demain', farm(), CTX).intent, 'create_task');
  assert.equal(agroIntent('puis-je traiter demain ?'), 'spray');
});

test('relecture : la culture citée ne remplace pas l’historique de la parcelle', () => {
  const state = farm();
  state.rotations = [
    {id: 'r1', parcelId: 'p1', campaignId: '2025/26', culture: 'Colza'},
    {id: 'r2', parcelId: 'p1', campaignId: '2026/27', culture: 'Blé tendre d’hiver'}
  ];
  const ctx = {...CTX, today: '2026-11-12'};
  const asked = answerAgroQuestion('que semer derrière le blé des Brosses ?', state, ctx);
  const generic = answerAgroQuestion('quelle culture suivante sur les Brosses ?', state, ctx);
  for (const r of [asked, generic]) {
    assert.equal(r.intent, 'next_crop');
    assert.doesNotMatch(r.answer, /pistes intéressantes : [^.]*Colza/);
    assert.match(r.answer, /à éviter[^.]*Colza/);
  }
});

test('relecture : achats d’azote et « après la moisson » ne sont pas captés', () => {
  assert.notEqual(agroIntent('combien d’azote ai-je acheté cette année ?'), 'nitrogen');
  assert.notEqual(agroIntent('combien d’azote commandé chez le fournisseur ?'), 'nitrogen');
  assert.notEqual(agroIntent('que faire après la moisson ?'), 'nextCrop');
  assert.equal(agroIntent('que semer après un colza ?'), 'nextCrop');
});
