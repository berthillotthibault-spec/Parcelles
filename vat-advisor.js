// Conseil de taux de TVA (logique pure, sans interface).
// Sources : CGI art. 278-0 B II, 278 bis, 279 b septies, 279-0 bis, 293 B, 283-2 nonies ;
// BOFiP BOI-TVA-SECT-80-70 (opérations de façon, travaux agricoles et forestiers).
// Le conseil reste indicatif : chaque taux proposé est modifiable, et les cas incertains sont signalés
// (« confidence: 'check' ») avec les autres taux possibles. À confirmer avec votre comptable.
import {normalize} from './utils.js';

/** Fin du taux de 10 % des travaux forestiers pour les exploitants agricoles (LF 2026, art. 96). */
export const FORESTRY_END = '2028-12-31';
const SECT = 'BOFiP BOI-TVA-SECT-80-70';
const FOREST_REF = `CGI art. 279 b septies ; ${SECT} §110`;
const EU_PREFIXES = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI']);

export const fmtRate = r => `${String(r).replace('.', ',')} %`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const res = (rate, {basis, reason = '', ref = '', confidence = 'probable', category = 'autre', alternatives = []}) =>
  ({rate, alternatives: alternatives.filter(a => a.rate !== rate), basis, reason: reason || basis, ref, confidence, category});

// ---------- Client : exploitant agricole, collectivité, particulier ----------
const PUBLIC_RE = /\b(commune|mairie|ville de|departement|conseil (departemental|regional|general)|region|communaute (de communes|d agglomeration|urbaine)|agglomeration|metropole|syndicat intercommunal|sivom|sivu|sictom|smictom|prefecture|etat|onf|office national des forets|collectivite|etablissement public|epci)\b/;
const FARM_RE = /\b(gaec|earl|scea|ea|cuma|exploitation agricole|exploitant agricole|agriculteurs?|eleveurs?|ferme)\b/;
/**
 * Catégorie prudente du client : 'farm' (exploitant agricole probable), 'public' (État, collectivité),
 * 'private' (particulier), 'pro' (professionnel sans autre indice) ou 'unknown'.
 */
export function clientCategory({clientKind = '', clientName = '', client = null} = {}) {
  const name = normalize(clientName || client?.name || client?.nom || '');
  const hint = normalize([client?.kind, client?.category, client?.type, client?.activity].filter(Boolean).join(' '));
  if (client && (client.farmer === true || client.isFarmer === true || client.agricultural === true)) return 'farm';
  if (/\b(exploitant|agricole|agriculteur|eleveur)\b/.test(hint)) return 'farm';
  if (/\b(collectivite|public|commune)\b/.test(hint) || PUBLIC_RE.test(name)) return 'public';
  const kind = clientKind || client?.clientKind || '';
  if (kind === 'particulier' || hint === 'particulier') return 'private';
  if (FARM_RE.test(name)) return 'farm';
  if (kind === 'pro') return 'pro';
  return 'unknown';
}

// ---------- Cultures : taux du produit obtenu ----------
const DEST = {
  animale: /\b(fourrag\w*|alimentation animale|aliments? du betail|pour (le |les )?(betail|animaux|bovins|vaches|volailles))\b/,
  humaine: /\b(meunier\w*|panifiable|brasserie|alimentation humaine|consommation humaine|semoulier\w*|de bouche|de consommation)\b/,
  sol: /\b(restitu\w*|enfoui\w*|retour au sol)\b/,
  'non-alimentaire': /\b(biocarburants?|methanis\w*|industriel\w*|non alimentaire)\b/
};
const destinationOf = (n, given) => given && DEST[given] ? given : Object.keys(DEST).find(k => DEST[k].test(n)) || '';
const CROPS = [
  {re: /\bchanvre\b/, label: 'chanvre', kind: 'nonfood', sure: true},
  {re: /\b(lin textile|lin fibre|tabac|miscanthus|osier)\b/, label: 'culture non alimentaire', kind: 'nonfood'},
  {re: /\b(vignes?|raisins?|vendanges?|vendanger)\b/, label: 'raisin', kind: 'vine'},
  {re: /\b(betteraves? fourrageres?|mais (ensilage|fourrage)|luzerne|trefle|ray ?grass|prairies?|herbe|fourrages?|foin|regain|sorgho fourrager|pois fourragers?|triticale|feveroles?)\b/, label: 'fourrage ou culture fourragère', kind: 'feed'},
  {re: /\b(pailles?|menues pailles|residus|cannes|chaumes)\b/, label: 'paille ou résidus de récolte', kind: 'straw'},
  {re: /\b(bles?|froment|epeautre|seigle|riz|sarrasin)\b/, label: 'blé ou céréale panifiable', kind: 'food'},
  {re: /\b(pommes? de terre|patates?|legumes?|carottes?|oignons?|salades?|haricots?|petits pois|lentilles?|pois chiches?|choux?|poireaux?|fruits?|pommes?|poires?|cerises?|noix|chataignes?|fraises?|tomates?|endives?|betteraves? rouges?)\b/, label: 'légumes ou fruits', kind: 'food'},
  {re: /\bbetteraves?\b/, label: 'betterave sucrière', kind: 'food'},
  {re: /\b(colza|tournesol|soja|lin|oleagineux)\b/, label: 'oléagineux', kind: 'oil'},
  {re: /\b(orges?|escourgeon)\b/, label: 'orge', kind: 'barley'},
  {re: /\b(mais|avoine|sorgho|pois|proteagineux|cereales?)\b/, label: 'céréale ou protéagineux', kind: 'feedish'}
];
const ALT_ANIMAL = {rate: 10, when: 'si la récolte est destinée à l’alimentation animale'};
const ALT_HUMAN = {rate: 5.5, when: 'si la récolte est destinée à l’alimentation humaine (ex. blé meunier, orge de brasserie)'};
const ALT_NONFOOD = {rate: 20, when: 'si la récolte a une destination non alimentaire (chanvre, biocarburant, industrie)'};
/** Taux du produit obtenu pour une culture reconnue dans le libellé, ou null. */
export function cropRate(label, {destination = ''} = {}) {
  const n = normalize(label), crop = CROPS.find(c => c.re.test(n));
  if (!crop) return null;
  const dest = destinationOf(n, destination), out = (rate, confidence, why, alternatives = []) => ({crop: crop.label, rate, confidence, why, alternatives});
  if (crop.kind === 'nonfood') return out(20, crop.sure ? 'sure' : 'probable', `${crop.label} : produit non destiné à l’alimentation, taux normal`);
  if (dest === 'non-alimentaire') return out(20, 'probable', 'récolte à destination non alimentaire, taux normal', [ALT_ANIMAL]);
  if (dest === 'animale') return out(10, 'probable', `${crop.label} destiné à l’alimentation animale`, [ALT_HUMAN]);
  if (dest === 'humaine') return out(5.5, 'probable', `${crop.label} destiné à l’alimentation humaine`, [ALT_ANIMAL]);
  if (dest === 'sol' || crop.kind === 'straw') return out(5.5, 'probable', 'paille ou résidus destinés au bétail ou restitués au sol après la récolte', [{rate: 20, when: 'si la paille n’est destinée ni au bétail ni au retour au sol'}]);
  if (crop.kind === 'vine') return out(5.5, 'check', 'raisin : produit agricole alimentaire', [{rate: 20, when: 'si l’opération relève de la fabrication du vin (pressurage pour la vinification, §40)'}]);
  if (crop.kind === 'food') return out(5.5, 'probable', `${crop.label} : produit destiné à l’alimentation humaine`, [ALT_ANIMAL]);
  if (crop.kind === 'feed') return out(10, 'probable', `${crop.label} : alimentation animale`, [ALT_HUMAN]);
  if (crop.kind === 'oil') return out(5.5, 'check', 'oléagineux destinés en principe à l’alimentation (huile)', [ALT_ANIMAL, ALT_NONFOOD]);
  return out(10, 'check', `${crop.label} : destination (alimentation animale ou humaine) à préciser`, [ALT_HUMAN, ALT_NONFOOD]);
}

// ---------- Familles d'opérations ----------
const ACCESSORY_RE = /\b(refactur\w*|frais de deplacement|deplacements?|indemnites? kilometriques?|frais kilometriques|frais de route|peages?)\b/;
const FUEL_RE = /\b(gazole|gasoil|gnr|carburant|fioul)\b/;
const WINE_MAKING_RE = /\b(vinification|vinifier|distillation|distiller|pressurage|pressoir|fabrication (de |du |d )?(vin|cidre|poire|hydromel|alcool)|mise en bouteilles?)\b/;
const FOREST_RE = /\b(deboisement|reboisement|abattage|abattre|bucheronnage|troncon\w*|debardage|debusquage|elagage|elaguer|defrich\w*|dessouch\w*|debroussaill\w*|brulage|travaux (forestiers|sylvicoles)|sylvicole\w*|exploitation forestiere|stockage (du |de )?bois|(sentiers?|chemins?) forestiers?|taille (de |des |d )?(haies?|arbres?)|plantation (de |d |des )?(haies?|arbres?|peupliers?|resineux|feuillus)|plantation forestiere|andainage (de |des )?(branches|remanents|bois))\b/;
const AFTER_FOREST_RE = /\b(sciage|scier|fendage|fendre|refente)\b/;
const HOUSING_RE = /\b(logement|maison|habitation|appartement|salle de bains?|renovation|isolation|toiture|plomberie|electricite|peinture|menuiserie|carrelage|chaudiere|pompe a chaleur)\b/;
// Toujours au taux normal (§30) : services qui ne sont pas des opérations de façon.
const ALWAYS20 = [
  [/\b(semis|semailles?|semer|semoir|plantations?|planter)\b/, 'Semailles et plantations'],
  [/\b(pulveris\w*|traitements?( phyto\w*)?|phytosanitaires?|desherb\w*)\b/, 'Pulvérisations et désherbage'],
  [/\b(epandage|epandre|chaulage)\b/, 'Épandage de lisier, d’engrais ou d’amendements'],
  [/\b(chargement|manutention|entreposage|stockage|gardiennage|conditionnement|ensachage)\b/, 'Manutention, chargement, entreposage, gardiennage ou conditionnement'],
  [/\b(analyses?|tri|trier|sexage|calibrage|nettoyage|brossage)\b/, 'Analyse, tri, calibrage ou nettoyage'],
  [/\b(tonte|vaccination|epointage|desinfection|deratisation)\b/, 'Soins et désinfection (tonte, vaccination, dératisation)'],
  [/\b(taille|tailler)\b/, 'Taille (vigne, vergers)'],
  [/\b(terrassement|arasements?|drainage|irrigation|arrosage|curage|fosses?|travaux immobiliers)\b/, 'Terrassement, drainage, irrigation ou curage']
];
const HARVEST_RE = /\b(moisson\w*|recoltes?|recolter|battage|vendanges?|vendanger|defanage|cueillette|ecimage)\b/;
// Arrachage et ramassage : récolte seulement avec une culture récoltable (pommes de terre, betteraves, lin...).
const PULL_RE = /\b(arrachage|arracher|ramassage|ramasser)\b/;
const PULL_NOT_CROP_RE = /\b(vignes?|ceps?|haies?|arbres?|arbustes?|souches?|pierres?|cailloux|rochers?|piquets?|clotures?)\b/;
const SOIL_RE = /\b(labours?|labourer|dechaum\w*|hersage|herser|binage|biner|disquage|vibroculteur|sous solage|decompactage|rotavator|griffage|roulage|preparation (du |des )?sols?|travail du sol|faux semis|strip ?till)\b/;
const STRAW_WORK_RE = /\b(broyage|broyer|pressage|presser)\b/;
const NOT_COVERED = [
  [/\b(ensilage|ensiler|fauch\w*|fenaison|fanage|faner|andainage|andainer|enrubann\w*|sechage)\b/, 'Fauche, fenaison, ensilage, enrubannage ou séchage', true],
  [/\b(pressage|presser|broyage|broyer)\b/, 'Pressage ou broyage', true],
  [/\b(transports?|transporter|livraisons?|charroi)\b/, 'Transport ou livraison', false],
  [/\b(location|mise a disposition|loue\w*)\b/, 'Location de matériel', false]
];
// Ventes de produits (taux usuels).
const PRODUCTS = [
  [20, /\b(vins?|cidres?|bieres?|alcools?|eaux? de vie|spiritueux|hydromel)\b/, 'Boissons alcooliques (20 %)', 'probable', []],
  [5.5, /\b(jus|legumes?|fruits?|pommes? de terre|oeufs?|lait|miel|farine|viandes?|colis de viande|volailles? pretes?|fromages?|beurre|cremes?|confitures?|orge de brasserie|cereales? alimentaires?|lentilles?|noix|chataignes?)\b/, 'Produit alimentaire (5,5 %)', 'probable', []],
  [5.5, /\b(bles?|froment|seigle|epeautre)\b/, 'Céréale destinée en principe à l’alimentation humaine (5,5 %)', 'probable', [ALT_ANIMAL]],
  [10, /\b(pailles?|foin|fourrages?|ensilage|enrubann\w*|luzerne|regain|balles?|bottes?|ballots?|mais grain|mais|orges?|triticale|avoine|cereales?|semences?|aliments? du betail|tourteaux?|grains?)\b/, 'Produit agricole non transformé ou alimentation animale (10 %)', 'probable', [ALT_HUMAN]],
  [10, /\b(bois de chauffage|buches?|plaquettes?|granules?|bois energie|steres?)\b/, 'Bois de chauffage (10 %)', 'probable', []],
  [20, /\b(chevaux|cheval|equides?|poneys?|juments?|poulains?)\b/, 'Équidés : taux normal, sauf animaux destinés à la boucherie', 'check', [{rate: 10, when: 'si l’animal est destiné à la boucherie'}]],
  [10, /\b(bovins?|veaux?|genisses?|vaches?|taurillons?|broutards?|agneaux?|brebis|moutons?|porcs?|porcelets?|chevres?|animaux vivants?)\b/, 'Animaux vivants de boucherie ou d’élevage (10 %)', 'probable', []],
  [10, /\b(fumier|compost|lisier|amendements? organiques?|digestat)\b/, 'Matière fertilisante organique (10 % si utilisable en agriculture biologique, sinon 20 %)', 'check', [{rate: 20, when: 'si la matière n’est pas utilisable en agriculture biologique'}]],
  [20, /\b(gazole|gasoil|carburant|materiel|pieces?|reparations?|entretien)\b/, 'Vente de matériel, de pièces ou de carburant, réparation (20 %)', 'probable', []]
];
const GENERIC20 = /\b(prestations?|travaux|pelle|mini ?pelle|tracteur|main d ?oeuvre|heures?|deneigement|chauffeur|journees?)\b/;

function forestry(n, opts) {
  if (AFTER_FOREST_RE.test(n)) return res(20, {basis: 'Travaux postérieurs au débardage (sciage, fendage) : taux normal', reason: 'Le taux de 10 % des travaux forestiers s’arrête au débardage et au stockage du bois en forêt ; le sciage et le fendage relèvent du taux normal.', ref: FOREST_REF, confidence: 'sure', category: 'forestier'});
  const who = clientCategory(opts), day = String(opts.today || todayIso()).slice(0, 10);
  const base = {ref: FOREST_REF, category: 'forestier'};
  if (day > FORESTRY_END) return res(20, {...base, basis: 'Travaux forestiers après le 31/12/2028 : taux normal', reason: 'Le taux de 10 % des travaux forestiers pour les exploitants agricoles est prévu jusqu’au 31 décembre 2028 (loi de finances pour 2026).', confidence: 'probable', alternatives: [{rate: 10, when: 'si le dispositif a été prorogé (à vérifier)'}]});
  if (who === 'public') return res(20, {...base, basis: 'Travaux forestiers pour l’État ou une collectivité : taux normal', reason: 'Les travaux sur les arbres d’alignement ou les parcs publics ne bénéficient pas du taux de 10 %, réservé aux exploitants agricoles.', confidence: 'sure'});
  if (who === 'private') return res(20, {...base, basis: 'Travaux forestiers pour un particulier : taux normal', reason: 'Le taux de 10 % est réservé aux travaux réalisés pour des exploitants agricoles ; l’entretien des parcs et jardins d’agrément d’un particulier est au taux normal.', confidence: 'sure'});
  const ten = {rate: 10, when: 'si le client est un exploitant agricole (régime de TVA agricole) et que les travaux servent son activité agricole, jusqu’au 31/12/2028'};
  if (who === 'farm') return res(10, {...base, basis: 'Travaux forestiers pour un exploitant agricole (10 %)', reason: 'Taux de 10 % pour les travaux sylvicoles et d’exploitation forestière (abattage, élagage, débardage, taille des haies…) réalisés au profit d’un exploitant agricole pour son activité agricole, jusqu’au 31/12/2028.', confidence: 'probable', alternatives: [{rate: 20, when: 'si le client n’est pas soumis au régime de TVA agricole ou si les travaux ne servent pas son activité agricole'}]});
  return res(20, {...base, basis: 'Travaux forestiers : taux normal, sauf client exploitant agricole', reason: 'Le taux de 10 % ne s’applique qu’aux travaux réalisés pour un exploitant agricole ; précisez le client pour affiner.', confidence: 'check', alternatives: [ten]});
}

/**
 * Taux de TVA conseillé pour une désignation de ligne.
 * opts : {clientKind, clientName, client, operationNature, regime, destination, today, mainRate}
 * Retour : {rate, alternatives:[{rate, when}], basis, reason, ref, confidence:'sure'|'probable'|'check', category} ou null.
 */
export function classify(label, opts = {}) {
  // Libellés générés depuis les travaux : « Type · Parcelle ». Le nom de parcelle ne doit pas orienter le taux.
  const raw = String(label ?? ''), full = normalize(raw), head = normalize(raw.split(/\s*·\s*/)[0]);
  const n = head || full;
  if (!n) return null;
  if (opts.regime === 'franchise') return res(0, {basis: 'Franchise en base de TVA (paramètres)', reason: 'En franchise en base, la TVA n’est pas facturée ; mention « TVA non applicable, art. 293 B du CGI ».', ref: 'CGI art. 293 B', confidence: 'sure', category: 'franchise'});
  if (opts.regime === 'remboursement-forfaitaire') return res(0, {basis: 'Remboursement forfaitaire agricole : TVA non facturée', ref: 'CGI art. 298 quater', confidence: 'sure', category: 'franchise'});
  const main = Number.isFinite(Number(opts.mainRate)) && opts.mainRate !== null && opts.mainRate !== '' ? Number(opts.mainRate) : null;
  // Frais accessoires refacturés : suivent la prestation principale.
  if (ACCESSORY_RE.test(full) || (main !== null && FUEL_RE.test(full))) return res(main ?? 20, {basis: 'Frais accessoire : suit le taux de la prestation principale', reason: 'Les frais refacturés (gazole, déplacement) accessoires à une prestation suivent le taux de cette prestation. Des débours (frais engagés au nom et pour le compte du client, refacturés à l’euro près) sont hors champ de la TVA.', ref: `${SECT} §20`, confidence: 'check', category: 'accessoire', alternatives: [{rate: 0, when: 'débours (frais engagés au nom et pour le compte du client, refacturés à l’euro près) : hors champ de la TVA'}]});
  const sale = /\b(vente|vendu\w*)\b/.test(n);
  if (!sale) {
    if (WINE_MAKING_RE.test(n)) return res(20, {basis: 'Fabrication de vin, cidre ou alcool, pressurage pour ces usages : taux normal', ref: `${SECT} §40`, confidence: 'sure', category: 'service'});
    if ((FOREST_RE.test(n) && !/\b(bovins?|porcs?|volailles?|agneaux?|ovins?|animaux|abattoir)\b/.test(n)) || (AFTER_FOREST_RE.test(n) && /\bbois\b/.test(n))) return forestry(n, opts);
    if (HOUSING_RE.test(n)) {
      const who = clientCategory(opts);
      if (who === 'private') return res(10, {basis: 'Travaux dans un logement d’un particulier (10 %)', reason: 'Taux de 10 % pour les travaux d’amélioration ou d’entretien d’un logement achevé depuis plus de 2 ans ; justificatif du client à conserver.', ref: 'CGI art. 279-0 bis', confidence: 'check', category: 'logement', alternatives: [{rate: 5.5, when: 'travaux d’amélioration énergétique éligibles (art. 278-0 bis A)'}, {rate: 20, when: 'logement de moins de 2 ans, construction neuve ou local non affecté à l’habitation'}]});
      return res(20, {basis: 'Travaux de bâtiment : taux normal', ref: 'CGI art. 279-0 bis', confidence: 'probable', category: 'logement', alternatives: [{rate: 10, when: 'si le client est un particulier et le logement achevé depuis plus de 2 ans'}]});
    }
    if (!/\bfaux semis\b/.test(n)) for (const [re, what] of ALWAYS20) if (re.test(n)) return res(20, {basis: `${what} : toujours au taux normal`, reason: `${what} ne sont pas des opérations de façon : taux normal, quelle que soit la culture.`, ref: `${SECT} §30`, confidence: 'sure', category: 'service'});
    if (/\b(elevage|engraissement|saillies?)\b/.test(n) && !/\b(aliments?|materiel)\b/.test(n)) return res(5.5, {basis: 'Élevage, engraissement ou saillie (5,5 %)', ref: `${SECT} §50`, confidence: 'probable', category: 'facon'});
    if (/\bpension\b/.test(n)) return res(5.5, {basis: 'Pension d’animaux d’élevage : à rapprocher de l’élevage (5,5 %)', reason: 'Si la pension comprend l’élevage ou l’engraissement des animaux, taux réduit ; s’il s’agit d’un simple gardiennage, taux normal.', ref: `${SECT} §30 et §50`, confidence: 'check', category: 'facon', alternatives: [{rate: 20, when: 'simple gardiennage (ou pension de chevaux de loisir)'}]});
    const crop = cropRate(n, opts);
    const facon = (what, ref) => crop
      ? res(crop.rate, {basis: `${what} : taux du produit obtenu (${crop.crop}, ${fmtRate(crop.rate)})`, reason: `${what} : opération de façon taxée au taux du produit obtenu ; ici ${crop.why}.`, ref, confidence: crop.confidence, category: 'facon', alternatives: crop.alternatives})
      : res(10, {basis: `${what} : taux du produit obtenu (culture à préciser)`, reason: `${what} : opération de façon taxée au taux du produit agricole obtenu. Précisez la culture et sa destination pour confirmer le taux.`, ref, confidence: 'check', category: 'facon', alternatives: [ALT_HUMAN, ALT_NONFOOD]});
    if (PULL_RE.test(n) && (PULL_NOT_CROP_RE.test(n) || !crop || crop.kind === 'vine')) {
      const woody = /\b(haies?|arbres?|arbustes?|souches?)\b/.test(n);
      return res(20, {basis: 'Arrachage ou ramassage sans récolte : taux normal', reason: 'Arracher des vignes, des haies ou des arbres, ou ramasser des pierres ne produit pas de récolte : ce n’est pas une opération de façon, taux normal par défaut, à confirmer avec votre comptable.', ref: SECT, confidence: 'check', category: 'service', alternatives: woody ? [{rate: 10, when: 'si assimilé à des travaux forestiers (dessouchage, défrichage) pour un exploitant agricole, jusqu’au 31/12/2028 (à vérifier)'}] : []});
    }
    if (HARVEST_RE.test(n) || PULL_RE.test(n)) return facon('Récolte', `${SECT} §50`);
    if (SOIL_RE.test(n)) return facon('Préparation des sols', `${SECT} §30`);
    if (STRAW_WORK_RE.test(n) && crop && /\b(pailles?|residus|cannes|chaumes)\b/.test(n)) return facon('Broyage ou pressage après récolte', `${SECT} §50`);
    for (const [re, what, harvestLike] of NOT_COVERED) if (re.test(n)) {
      const alt = harvestLike
        ? [{rate: crop && crop.rate !== 20 ? crop.rate : 10, when: 'si l’opération est retenue comme une opération de façon de récolte : taux du produit obtenu (à confirmer avec votre comptable)'}]
        : crop && crop.rate !== 20 ? [{rate: crop.rate, when: 'si c’est l’accessoire d’une récolte que vous réalisez pour ce client (§20, à confirmer)'}] : [];
      return res(20, {basis: `${what} : taux normal par défaut`, reason: `${what} : cas non traité expressément par la doctrine sur les opérations de façon ; taux normal par défaut, à confirmer avec votre comptable.`, ref: SECT, confidence: 'check', category: 'service', alternatives: alt});
    }
  }
  for (const [rate, re, basis, confidence, alternatives] of PRODUCTS) if (re.test(n)) return res(rate, {basis, ref: 'CGI art. 278-0 bis et 278 bis', confidence, category: 'vente', alternatives});
  if (GENERIC20.test(n)) return res(20, {basis: 'Prestation de services (20 %)', reason: 'Prestation de services sans régime particulier identifié : taux normal.', confidence: 'probable', category: 'service'});
  return null;
}

// ---------- Contrôle des taux d'un document ----------
const amountLine = l => !l?.kind || l.kind === 'item' || l.kind === 'deduction';
const lineHt = l => Math.abs((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0));
const sameRate = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001;

/**
 * Avertissements TVA (non bloquants) d'un document : [{code, line, text}], line = n° de ligne (1…) ou null.
 */
export function checkDocumentVat(state, doc, {today = todayIso()} = {}) {
  const s = state?.exploitation?.invoicing || {}, regime = s.vatRegime || 'normal', day = String(doc?.issueDate || today).slice(0, 10);
  const client = (state?.clients || []).find(c => c && c.id && c.id === doc?.clientId) || null;
  const ctx = {clientKind: doc?.clientKind || '', clientName: doc?.clientName || '', client, operationNature: doc?.operationNature || '', today: day};
  const who = clientCategory(ctx), out = [], all = doc?.lines || [];
  const lines = all.map((l, i) => ({l, no: i + 1})).filter(x => amountLine(x.l) && String(x.l.label || '').trim());
  if (regime === 'franchise' && [...lines.map(x => x.l), ...(doc?.shipping ? [doc.shipping] : [])].some(l => Number(l.vatRate) > 0))
    out.push({code: 'franchise', line: null, text: 'Franchise en base de TVA : aucune TVA ne doit être facturée (mention « TVA non applicable, art. 293 B du CGI »).'});
  if (regime !== 'normal') return out;
  const advice = lines.map(x => ({...x, a: classify(x.l.label, ctx)}));
  const principal = advice.filter(x => x.a?.category !== 'accessoire' && Number.isFinite(Number(x.l.vatRate))).sort((a, b) => lineHt(b.l) - lineHt(a.l))[0];
  const mainRate = principal ? Number(principal.l.vatRate) : null;
  const shown = r => fmtRate(Number(r));
  for (const {l, no, a} of advice) {
    const rate = Number(l.vatRate), name = String(l.label).trim();
    if (!Number.isFinite(rate)) continue;
    if (rate === 0 && !l.vatExemption && !doc.vatExemption && s.mention) { out.push({code: 'zero-sans-motif', line: no, text: `Ligne ${no} « ${name} » à 0 % sans motif d’exonération choisi : vérifiez que la mention libre des paramètres justifie bien l’absence de TVA.`}); continue; }
    if (!a) continue;
    if (a.category === 'forestier' && sameRate(rate, 10)) {
      if (day > FORESTRY_END) { out.push({code: 'forestier-date', line: no, text: `Ligne ${no} « ${name} » à 10 % : le taux réduit des travaux forestiers est prévu jusqu’au 31/12/2028 ; vérifiez s’il a été prorogé, sinon 20 %.`}); continue; }
      if (who === 'private' || who === 'public') { out.push({code: 'forestier-client', line: no, text: `Ligne ${no} « ${name} » à 10 % : le taux réduit des travaux forestiers est réservé aux exploitants agricoles ; pour ${who === 'public' ? 'une collectivité' : 'un particulier'}, le taux normal (20 %) s’applique en principe.`}); continue; }
      if (who !== 'farm') { out.push({code: 'forestier-verifier', line: no, text: `Ligne ${no} « ${name} » à 10 % : vérifiez que le client est bien un exploitant agricole (régime de TVA agricole) et que les travaux servent son activité agricole.`}); continue; }
    }
    if (a.category === 'facon' && who === 'private' && (sameRate(rate, 5.5) || sameRate(rate, 10))) { out.push({code: 'reduit-particulier', line: no, text: `Ligne ${no} « ${name} » à ${shown(rate)} pour un particulier : le taux réduit des opérations de façon suppose un produit destiné à l’alimentation ou à la production agricole ; vérifiez (à défaut, 20 %).`}); continue; }
    if (a.category === 'accessoire' && mainRate !== null && !sameRate(rate, mainRate) && rate !== 0) { out.push({code: 'accessoire', line: no, text: `Ligne ${no} « ${name} » à ${shown(rate)} alors que la prestation principale est à ${shown(mainRate)} : les frais accessoires refacturés suivent en principe le taux de la prestation principale (à confirmer avec votre comptable). S’il s’agit de débours refacturés à l’euro près, ils sont hors champ de la TVA.`}); continue; }
    if (a.category === 'logement' && sameRate(rate, 10)) {
      const txt = normalize([doc.terms, doc.subject, doc.notes, doc.reference, s.mention, s.template?.freeMentions].filter(Boolean).join(' '));
      if (!/\battestation|achev\w* depuis plus de (2|deux) ans\b/.test(txt)) { out.push({code: 'logement-attestation', line: no, text: `Ligne ${no} « ${name} » à 10 % : le taux réduit des travaux dans un logement suppose un logement achevé depuis plus de 2 ans ; conservez le justificatif du client (attestation ou mention prévue sur le devis ou la facture).`}); continue; }
    }
    if (a.confidence === 'sure' && a.category !== 'accessoire' && !sameRate(rate, a.rate) && !(rate === 0 && (l.vatExemption || doc.vatExemption)))
      out.push({code: 'ecart', line: no, text: `Ligne ${no} « ${name} » à ${shown(rate)} : le taux usuel est ${shown(a.rate)} (${a.basis}). Vérifiez.`});
  }
  if (doc?.shipping && mainRate !== null && Number.isFinite(Number(doc.shipping.vatRate)) && Number(doc.shipping.vatRate) !== 0 && !sameRate(doc.shipping.vatRate, mainRate))
    out.push({code: 'accessoire', line: null, text: `Frais de port ou de déplacement à ${shown(doc.shipping.vatRate)} alors que la prestation principale est à ${shown(mainRate)} : ces frais accessoires suivent en principe le taux de la prestation principale (à confirmer avec votre comptable).`});
  const vat = String(doc?.clientVat || '').replace(/[\s.-]/g, '').toUpperCase(), prefix = vat.slice(0, 2);
  const exempted = [doc?.vatExemption, ...lines.map(x => x.l.vatExemption)].some(e => e === 'autoliquidation' || e === 'intracom');
  if (EU_PREFIXES.has(prefix) && !exempted && lines.some(x => Number(x.l.vatRate) > 0))
    out.push({code: 'client-ue', line: null, text: `Client établi dans un autre État membre (n° de TVA ${prefix}…) : pour une prestation de services à un assujetti, la TVA est en principe due par le client (mention « Autoliquidation », n° de TVA du client) ; pour une livraison de biens, exonération intracommunautaire. Exception : les travaux portant sur un terrain ou un bâtiment situé en France restent taxables en France. À confirmer avec votre comptable.`});
  return out;
}
