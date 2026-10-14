// n° 118 : exploitation de démonstration (fictive) à explorer sans risque.
// Générateur pur : mêmes données pour une même date de référence, dates des travaux relatives à cette date.
// Aucune vraie donnée : noms, contours et chiffres sont inventés (bocage de la Bresse, dans l'Ain).
import {APP_VERSION, campaignFor} from './utils.js';
import {DEMO_WORKSPACE_ID, emptyState} from './state.js';

export {DEMO_WORKSPACE_ID};
export const DEMO_FARM_NAME = 'Ferme des Saules (exemple)';
// Réglages personnels gardés de la vraie ferme pendant la visite (affichage seulement).
export const DEMO_CARRIED_PREFERENCES = Object.freeze(['theme', 'highContrast', 'compactMode', 'userName', 'lastSeenBuild', 'seenTips', 'mapLayer', 'routeProvider']);

const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');

// Date de référence ramenée au jour (midi UTC) : indépendante de l'heure et du fuseau.
function referenceDay(ref) {
  const raw = ref instanceof Date ? ref : new Date(ref ?? Date.now());
  const date = Number.isNaN(raw.getTime()) ? new Date() : raw;
  const local = /^\d{4}-\d{2}-\d{2}$/.test(String(ref || '')) ? String(ref) : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const [y, m, d] = local.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12);
}
const isoOf = ms => new Date(ms).toISOString().slice(0, 10);
// Campagne d'une date ISO, lue à midi heure locale (comme l'application).
const campaignOfIso = iso => campaignFor(`${iso}T12:00:00`);
const previousCampaignId = id => { const y = Number(String(id).slice(0, 4)) - 1; return `${y}/${String(y + 1).slice(-2)}`; };

// Petit générateur pseudo-aléatoire déterministe (contours légèrement irréguliers).
function random(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

// Origine fictive du parcellaire, au milieu des champs (aucun contour réel).
const ORIGIN = {lon: 5.118, lat: 46.322};
const M_PER_DEG_LAT = 111200, M_PER_DEG_LON = 76900;

// [nom, surface ha, culture des campagnes n-2, n-1, n, colonne, rangée]
const PARCELS = [
  ['Les Noues', 11.3, ['Maïs grain', 'Colza', 'Blé tendre'], 0, 0],
  ['Grand Champ', 14.2, ['Blé tendre', 'Orge d’hiver', 'Maïs grain'], 1, 0],
  ['Le Pré Bas', 6.4, ['Prairie permanente', 'Prairie permanente', 'Prairie permanente'], 2, 0],
  ['La Côte', 8.1, ['Orge d’hiver', 'Blé tendre', 'Colza'], 3, 0],
  ['Les Brosses', 7.6, ['Colza', 'Blé tendre', 'Orge d’hiver'], 4, 0],
  ['Champ du Bief', 9.8, ['Prairie temporaire', 'Blé tendre', 'Maïs ensilage'], 0, 1],
  ['La Verchère', 5.2, ['Maïs ensilage', 'Prairie temporaire', 'Prairie temporaire'], 1, 1],
  ['Les Teppes', 6.9, ['Blé tendre', 'Maïs grain', 'Soja'], 2, 1],
  ['Sous le Bois', 4.3, ['Prairie permanente', 'Prairie permanente', 'Prairie permanente'], 3, 1],
  ['Le Grand Pré', 7.7, ['Prairie permanente', 'Prairie permanente', 'Prairie permanente'], 4, 1],
  ['La Fontaine', 9.4, ['Soja', 'Maïs grain', 'Blé tendre'], 0, 2],
  ['Les Charmes', 5.5, ['Maïs grain', 'Blé tendre', 'Triticale'], 1, 2],
  ['Le Moulin', 10.6, ['Blé tendre', 'Soja', 'Maïs grain'], 2, 2],
  ['Les Communaux', 4.8, ['Blé tendre', 'Prairie temporaire', 'Prairie temporaire'], 3, 2],
  ['La Croix', 3.9, ['Orge d’hiver', 'Maïs grain', 'Tournesol'], 4, 2]
];

// Rendement de référence (t/ha) et prix (€/t) par culture ; prairies sans prix de vente (autoconsommées).
const CROPS = {
  'Blé tendre': [7.2, 210], 'Orge d’hiver': [6.6, 185], 'Triticale': [6.0, 175], 'Colza': [3.4, 460], 'Maïs grain': [10.2, 190],
  'Maïs ensilage': [15.5, null], 'Soja': [3.1, 420], 'Tournesol': [2.8, 430], 'Prairie permanente': [6.0, null], 'Prairie temporaire': [8.5, null]
};
const isGrass = culture => /^Prairie/.test(culture);

// Parcellaire en bandes de bocage : parcelles voisines séparées d'une haie (~20 m), contours un peu irréguliers.
function layout(rnd) {
  const dims = PARCELS.map(([, surfaceHa]) => { const area = surfaceHa * 10000, ratio = 1.2 + rnd() * 0.5, w = Math.sqrt(area * ratio); return {w, h: area / w}; });
  const rows = [...new Set(PARCELS.map(row => row[4]))].sort((a, b) => a - b), cells = [];
  let y = 0;
  for (const r of rows) {
    const members = PARCELS.map((row, i) => [row, i]).filter(([row]) => row[4] === r).sort((a, b) => a[0][3] - b[0][3]);
    const height = Math.max(...members.map(([, i]) => dims[i].h));
    let x = (rnd() - 0.5) * 60;
    for (const [, i] of members) {
      const {w, h} = dims[i];
      cells[i] = {x, y: y - (height - h) * rnd(), w, h};
      x += w + 18 + rnd() * 12;
    }
    y -= height + 22 + rnd() * 10;
  }
  return cells;
}
function polygon({x, y, w, h}, rnd) {
  const jitter = () => (rnd() - 0.5) * Math.min(w, h) * 0.08;
  const corners = [[x + Math.abs(jitter()), y - h + Math.abs(jitter())], [x + w - Math.abs(jitter()), y - h + Math.abs(jitter())], [x + w - Math.abs(jitter()), y - Math.abs(jitter())], [x + Math.abs(jitter()), y - Math.abs(jitter())]];
  const ring = corners.map(([px, py]) => [Number((ORIGIN.lon + px / M_PER_DEG_LON).toFixed(6)), Number((ORIGIN.lat + py / M_PER_DEG_LAT).toFixed(6))]);
  ring.push([...ring[0]]);
  return {type: 'Polygon', coordinates: [ring]};
}

// Construit l'état complet de la démonstration. ref : date de référence (Date, ms ou AAAA-MM-JJ).
export function buildDemoFarm(ref = Date.now(), {preferences = {}} = {}) {
  const day0 = referenceDay(ref), today = isoOf(day0), D = n => isoOf(day0 + n * DAY), at = n => day0 + n * DAY;
  const current = campaignOfIso(today), previous = previousCampaignId(current), older = previousCampaignId(previous);
  const campaigns = [older, previous, current];
  const rnd = random(20260118), cells = layout(rnd);
  const base = emptyState();
  const meta = (id, n = -400) => ({id, createdAt: at(n), updatedAt: at(n), deletedAt: null, version: 1, source: 'demo', sourceId: null});

  const parcelles = PARCELS.map(([nom, surfaceHa, cultures], i) => {
    const id = `demo_p${pad(i + 1)}`, economicsByCampaign = {};
    cultures.forEach((culture, k) => {
      const [yieldRef, price] = CROPS[culture], factor = k === 2 ? 1 : 0.9 + ((i * 7 + k * 3) % 5) * 0.05;
      economicsByCampaign[campaigns[k]] = {yield: Number((yieldRef * factor).toFixed(1)), yieldUnit: 't/ha', ...(price ? {salePrice: price} : {}), ...(k === 2 && !isGrass(culture) ? {inputCostHa: culture === 'Colza' ? 420 : 380} : {})};
    });
    return {
      ...meta(id), nom, surfaceHa, culture: cultures[2], commune: i % 4 === 3 ? 'Malafretaz' : 'Montrevel-en-Bresse', ilot: String(Math.floor(i / 3) + 1),
      ownershipType: i % 5 === 4 ? 'lease' : 'own', clientId: null, exploitant: '', favorite: i === 0 || i === 2, archived: false, status: 'À jour',
      notes: i === 2 ? 'Pré des génisses, abreuvoir au nord.' : '', agronomic: {}, economics: economicsByCampaign[current], economicsByCampaign, fieldOverrides: {},
      geometry: polygon(cells[i], rnd)
    };
  });
  const pid = n => `demo_p${pad(n)}`, surface = n => PARCELS[n - 1][1];

  const rotations = parcelles.flatMap((p, i) => PARCELS[i][2].map((culture, k) => ({...meta(`demo_r${pad(i + 1)}_${k}`), parcelId: p.id, campaignId: campaigns[k], culture})));

  const materiels = [
    {...meta('demo_m1'), nom: 'Tracteur 150 ch', brand: 'Exemple', model: 'T150', registration: '', currentMeter: 4820, hourlyCost: 38, workingWidthM: 3, maintenanceDue: D(9), controleDate: '', insurance: '', insuranceDue: '', amortization: '', actualFuel: '', note: 'Vidange prévue sous 10 jours.', location: 'Hangar'},
    {...meta('demo_m2'), nom: 'Pelle mécanique 14 t', brand: 'Exemple', model: 'P14', registration: '', currentMeter: 2310, hourlyCost: 62, workingWidthM: null, maintenanceDue: '', controleDate: '', insurance: '', insuranceDue: '', amortization: '', actualFuel: '', note: 'Utilisée pour les chantiers de terrassement.', location: 'Cour'}
  ];

  // Travaux : [parcelle, type, décalage en jours, statut, coût €, heure, opérateur]
  const DONE = 'Terminé', TODO = 'À faire';
  const workRows = [
    [1, 'Déchaumage', -41, DONE, 520, '', 'Paul'], [1, 'Semis blé', -12, DONE, 980, '09:00', 'Paul'], [1, 'Désherbage', 3, TODO, 640, '', 'Paul'],
    [2, 'Récolte maïs', -9, DONE, 1850, '08:30', 'Julien'], [2, 'Broyage des cannes', -6, TODO, 430, '', 'Julien'],
    [3, 'Clôture électrique', -20, DONE, 90, '', 'Paul'],
    [4, 'Semis colza', -52, DONE, 610, '', 'Paul'], [4, 'Désherbage', -3, TODO, 560, '', 'Paul'],
    [5, 'Labour', -18, DONE, 690, '', 'Julien'], [5, 'Semis orge', 0, TODO, 720, '14:00', 'Julien'],
    [6, 'Ensilage maïs', -33, DONE, 2100, '', 'Julien'], [6, 'Épandage fumier', 6, TODO, 380, '', 'Paul'],
    [7, 'Fauche', -60, DONE, 260, '', 'Paul'],
    [8, 'Récolte soja', -2, DONE, 890, '', 'Julien'],
    [10, 'Ébousage', 2, TODO, 120, '', 'Paul'],
    [11, 'Semis blé', -1, DONE, 840, '10:00', 'Paul'], [11, 'Analyse de sol', 12, TODO, null, '', ''],
    [12, 'Semis triticale', 1, TODO, 410, '', 'Julien'],
    [13, 'Récolte maïs', -5, TODO, 1400, '', 'Julien'],
    [14, 'Sursemis prairie', -25, DONE, 300, '', 'Paul'],
    [15, 'Récolte tournesol', -15, DONE, 350, '', 'Julien']
  ];
  // Récoltes des campagnes précédentes : rendements et coûts pour l'historique et les marges.
  const history = parcelles.flatMap((p, i) => [0, 1].flatMap(k => {
    const culture = PARCELS[i][2][k];
    if (isGrass(culture)) return [];
    const start = Number(campaigns[k].slice(0, 4)), month = /Maïs|Soja|Tournesol/.test(culture) ? 10 : 7;
    const date = `${month <= 7 ? start + 1 : start}-${pad(month)}-${pad(10 + (i % 15))}`;
    return [[i + 1, `Récolte ${culture.toLowerCase().replace('’', '\'')}`, date, DONE, Math.round(PARCELS[i][1] * 135), '', i % 2 ? 'Julien' : 'Paul']];
  }));
  const interventions = [...workRows, ...history].map(([n, type, when, status, cost, startTime, operator], i) => {
    const date = typeof when === 'number' ? D(when) : when, done = status === DONE;
    return {
      ...meta(`demo_w${pad(i + 1)}`, -60), parcelId: pid(n), type, date, plannedDate: done ? (typeof when === 'number' ? D(when - 1) : date) : date, status,
      campaignId: campaignOfIso(date), operator, startTime, surfaceWorked: surface(n), cost, equipmentId: /Récolte|Ensilage/.test(type) ? null : 'demo_m1',
      machineCost: cost ? Math.round(cost * 0.35) : 0, inputCost: cost && /Semis|Désherbage/.test(type) ? Math.round(cost * 0.5) : 0, operatorCost: 0, otherCost: 0,
      fuelCost: 0, doseUnit: '', productUnitPrice: null, note: ''
    };
  });

  const tasks = [
    {...meta('demo_t1'), title: 'Réparer la clôture du Pré Bas', parcelId: pid(3), dueDate: D(-2), status: 'À faire', note: ''},
    {...meta('demo_t2'), title: 'Commander les semences d’orge', parcelId: null, dueDate: D(1), status: 'À faire', note: ''},
    {...meta('demo_t3'), title: 'Contrôle du pulvérisateur', parcelId: null, dueDate: D(-30), status: 'Terminé', note: ''}
  ];

  const grazingSessions = [
    {...meta('demo_g1'), nom: 'Lot des génisses', parcelId: pid(3), animalType: 'Génisses', animalsCount: 18, startDate: D(-11), endDate: null, note: 'Lot de génisses charolaises au pré.'},
    {...meta('demo_g2'), nom: 'Lot des génisses', parcelId: pid(10), animalType: 'Génisses', animalsCount: 18, startDate: D(-40), endDate: D(-11), note: ''}
  ];

  const clients = [{...meta('demo_c1'), name: 'Mairie (exemple)', contact: '', phone: '', email: '', address: 'Place du village', hourlyRate: 75, hectareRate: null, tonneRate: null, note: 'Client fictif.'}];
  const chantiers = [{
    ...meta('demo_tp1', -20), kind: 'tp', type: 'Terrassement d’une plateforme', address: 'Chemin des Saules', plannedDate: D(-4), status: 'En cours', clientId: 'demo_c1',
    equipmentId: 'demo_m2', operator: 'Julien', parcelId: null, parcelIds: [], note: 'Plateforme de stockage, 600 m² environ.',
    tpLogs: [
      {id: 'demo_tplog1', date: D(-4), equipmentId: 'demo_m2', operator: 'Julien', hours: 7.5, volumeM3: 180, tonnage: null, note: 'Décapage de la terre végétale.', createdAt: at(-4), updatedAt: at(-4), deletedAt: null},
      {id: 'demo_tplog2', date: D(-3), equipmentId: 'demo_m2', operator: 'Julien', hours: 6, volumeM3: 140, tonnage: null, note: 'Mise à niveau.', createdAt: at(-3), updatedAt: at(-3), deletedAt: null}
    ]
  }];

  const stockItems = [
    {...meta('demo_s1'), name: 'Ammonitrate 33,5', category: 'Engrais', quantity: 4200, unit: 'kg', unitPrice: 0.42, alertBelow: 1000, note: ''},
    {...meta('demo_s2'), name: 'Semences d’orge', category: 'Semences', quantity: 300, unit: 'kg', unitPrice: 0.65, alertBelow: 500, note: ''}
  ];
  const observations = [{...meta('demo_o1', -3), parcelId: pid(4), type: 'Ravageur', title: 'Limaces en bordure', note: 'Dégâts sur une dizaine de mètres côté haie.', status: 'À surveiller', date: D(-3)}];

  const farm = {...base.exploitation, id: 'farm_demo', nom: DEMO_FARM_NAME, commune: 'Montrevel-en-Bresse', latitude: 46.33, longitude: 5.13, createdAt: at(-400), updatedAt: at(-400)};
  const carried = Object.fromEntries(DEMO_CARRIED_PREFERENCES.filter(key => preferences[key] !== undefined).map(key => [key, preferences[key]]));
  return {
    ...base,
    version: APP_VERSION,
    exploitation: farm,
    parcelles, interventions, tasks, rotations, grazingSessions, materiels, clients, chantiers, stockItems, observations,
    preferences: {
      ...base.preferences, ...carried, workspaceId: DEMO_WORKSPACE_ID, cloudRole: null, onboardingComplete: true, activeModules: 'all',
      syncEnabled: false, autoSync: false, autoBackup: false, platformBackendEnabled: false, remoteAiEnabled: false, notificationsEnabled: false,
      // La carte « Bien démarrer » concerne la vraie ferme : masquée pendant la visite.
      gettingStartedHidden: true
    },
    metadata: {...base.metadata, createdAt: at(-400), updatedAt: day0, demo: true, demoReferenceDate: today, lastExternalBackupAt: day0},
    queue: [], journal: [], syncConflicts: []
  };
}
