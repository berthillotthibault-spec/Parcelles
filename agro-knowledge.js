// Connaissances agronomiques pures pour l'assistant et la veille : reconnaissance des questions
// agronomiques (tolérante aux accents et aux fautes courantes) et pistes de culture suivante.
// Aucune règle nouvelle n'est inventée : les délais de retour viennent de rotation-advice.js, les
// familles à risque de conseils.js et les arrière-effets azote de la table de nitrogen.js. Les pistes
// sont indicatives, à valider avec votre conseiller.
import {normalize} from './utils.js';
import {ROTATION_SOURCE, campaignYear, rotationDelay, rotationFamily} from './rotation-advice.js';
import {ADVICE_FAMILIES} from './conseils.js';
import {NITROGEN_REFERENCES, cultureReference, precedentEffect} from './nitrogen.js';

export const NEXT_CROP_CANDIDATES = Object.freeze(['Blé tendre', 'Orge d’hiver', 'Colza', 'Maïs grain', 'Tournesol', 'Pois', 'Féverole', 'Soja', 'Betterave']);
export const NEXT_CROP_SOURCE = `${ROTATION_SOURCE} ; arrière-effets azote de la table de références (indicatifs).`;

const inFamily = (culture, key) => {const f = ADVICE_FAMILIES[key], c = normalize(culture); return Boolean(c) && f.match.test(c) && !(f.exclude && f.exclude.test(c));};
export const isLegume = culture => Boolean(cultureReference(culture)?.legume);

// Questions de facturation, de vente ou d'argent : jamais captées par les réponses agronomiques.
/** Demandes d'écriture (« planifie un traitement demain », « crée une tâche ») : laissées aux actions de intelligence.js. */
export const WRITE_WORDS = /\b(ajoute|ajouter|cree|creer|planifie|planifier|enregistre|enregistrer|demarre|demarrer)\b/;
export const BILLING_WORDS = /\b(factur\w*|devis|(?:me|nous|m|lui|leur) doi(?:t|vent)|paye\w*|paie\w*|paiement\w*|client\w*|tva|avoirs?|tarif\w*|impaye\w*|reglement\w*|encaiss\w*|chiffre d affaires|marge)\b/;

// Variantes et fautes courantes ramenées à une forme unique avant reconnaissance.
const TYPOS = [
  [/\btrait?t?er\b/g, 'traiter'], [/\btraitt?ement\b/g, 'traitement'],
  [/\bpulv[ae]ri[sz]\w*/g, 'pulveriser'], [/\bpulve\b/g, 'pulveriser'],
  [/\bsem(?:m)?er\b/g, 'semer'], [/\bressuy\w*/g, 'ressuye'], [/\bgel(?:l)?ee?s?\b/g, 'gelee'],
  [/\bsclero\w*/g, 'sclerotinia'], [/\bsepto\w*/g, 'septoriose'], [/\bmildi?ou\w*/g, 'mildiou'], [/\bhelmint?ho\w*/g, 'helminthosporiose'],
  [/\bazot\w*/g, 'azote'], [/\bpeu ?t on\b/g, 'peut on'], [/\bpeu je\b/g, 'peux je'], [/\bpuije\b/g, 'puis je']
];
export function agroText(question) {
  let q = normalize(question);
  for (const [re, to] of TYPOS) q = q.replace(re, to);
  return q.replace(/\s+/g, ' ').trim();
}

const MAY = /\b(puis je|peux je|je peux|peut on|on peut|pourrai je|pourra t on|pourrais je|est ce que je peux|est ce qu on peut|possible|faut il|bon moment|quand)\b/;
export const AGRO_INTENTS = Object.freeze({
  // Point du matin (morning-brief.js) : « point du matin », « qu'est-ce que je fais aujourd'hui », « quoi de prévu demain ».
  brief: q => /\b(point du matin|point du jour|briefing|brief du jour|programme du jour)\b/.test(q) || (/\b(quoi de prevu|qu est ce qui est prevu|qu est ce que je fais|qu est ce qu on fait|que faire|je fais quoi|on fait quoi|quoi faire|prevu)\b/.test(q) && /\b(aujourd hui|ce matin|demain|journee)\b/.test(q) && !/\b(traiter|pulveriser|semer|recolter|epandre)\b/.test(q)),
  // Épandage en zone vulnérable (zv-calendar.js) : « puis-je épandre du lisier sur les Brosses ? ».
  zvSpread: q => /\b(zone vulnerable|calendrier d epandage|periode d interdiction|interdiction d epandage)\b/.test(q) || (/\b(epandre|epandage|epands?|mettre|apporter|passer)\b/.test(q) && /\b(lisier|fumier|purin|fientes?|digestat|compost|engrais|ammonitrate|uree|solution azotee|azote)\b/.test(q) && (MAY.test(q) || /\b(interdit|autorise|droit)\b/.test(q)) && !/\b(combien|quantite|total|cumul|bilan)\b/.test(q)),
  reentry: q => /\b(delais? de (re ?)?entree|delais? de rentree|\bdre\b|retourner dans|rentrer dans|re rentrer|entrer dans la parcelle|acces a la parcelle|y retourner|y rentrer|y entrer)\b/.test(q),
  dar: q => /\b(delais? avant recolte|\bdar\b)\b/.test(q) || (MAY.test(q) && /\b(recolter|moissonner|faucher|ensiler|battre|recolte|moisson)\b/.test(q) && !/\b(semer|semis)\b/.test(q)),
  sowing: q => (MAY.test(q) && /\b(semer|semis|implanter)\b/.test(q)) || /\b(ressuye|portance|portant|portante|praticable)\b/.test(q) || /\b(entrer|rentrer|aller)\b.*\bavec (le |un |les )?(tracteur|materiel|semoir|engins?)\b/.test(q),
  risk: q => /\b(mildiou|septoriose|sclerotinia|helminthosporiose|gelee|stress thermique|\bthi\b|canicule)\b/.test(q) || (/\b(risques?|pression|menace)\b/.test(q) && /\b(maladies?|rouille|gel|froid|chaleur|sanitaire)\b/.test(q)),
  nitrogen: q => /\b(azote|unites? n|kg n|ammonitrate|solution azotee)\b/.test(q) && /\b(combien|quantite|total|cumul|apporte\w*|mis|epandu\w*|reste|bilan|ou en (est|suis|sommes))\b/.test(q) && !/\b(prix|stock|command\w*|achet\w*|achat\w*|livr\w*|fournisseur\w*)\b/.test(q),
  nextCrop: q => (/\b(quelles? cultures?|culture suivante|prochaine culture|tete d assolement)\b/.test(q) || (/\b(que|quoi|qu est ce que)\b.*\b(semer|seme|mettre|mets|planter|plante|implanter|faire)\b/.test(q) && !/\b(apres|derriere) (la |le |les )?(moisson|recolte|battage|fauche|ensilage|dechaumage)\b/.test(q))) && /\b(apres|derriere|suivante|prochaine|suivre|succeder|tete d assolement)\b/.test(q),
  spray: q => /\b(traiter|pulveriser|traitement|desherber)\b/.test(q) && (MAY.test(q) || /\b(aujourd hui|demain|maintenant|ce matin|ce soir|cet apres midi|fenetre|creneau|conditions|meteo)\b/.test(q)) && !/\b(registre|combien|historique|liste|cout|prix|stock|dernier|derniere|ai je fait|a ete fait|realise)\b/.test(q)
});
/** Intention agronomique d'une question, ou null (les questions de facturation ne sont jamais captées). */
export function agroIntent(question) {
  const q = agroText(question);
  if (!q || BILLING_WORDS.test(q) || WRITE_WORDS.test(q)) return null;
  for (const key of ['brief', 'zvSpread', 'reentry', 'dar', 'nextCrop', 'sowing', 'risk', 'nitrogen', 'spray']) if (AGRO_INTENTS[key](q)) return key;
  return null;
}
export const targetDay = question => /\bdemain\b/.test(agroText(question)) ? 'tomorrow' : 'today';

/** Culture citée après « après » / « derrière » (« quelle culture après un colza ? »), sinon ''. */
export function cropAfterWord(question) {
  const q = agroText(question), m = q.match(/\b(?:apres|derriere|suite a)\b(.*)$/);
  if (!m) return '';
  const tail = m[1].replace(/\b(un|une|le|la|les|du|des|de|l|mon|ma|mes|sur|cette|ce)\b/g, ' ').trim();
  if (!tail) return '';
  const ref = cultureReference(tail);
  if (ref) return ref.label;
  const fam = rotationFamily(tail);
  return fam ? fam.charAt(0).toUpperCase() + fam.slice(1) : '';
}

/** Deux libellés désignent-ils la même culture (« Blé tendre » et « Blé tendre d’hiver ») ? Référence azote, sinon famille de rotation. */
export function sameCrop(a, b) {
  if (!a || !b) return false;
  if (normalize(a) === normalize(b)) return true;
  const ra = cultureReference(a), rb = cultureReference(b);
  if (ra && rb) return ra.key === rb.key;
  const fa = rotationFamily(a), fb = rotationFamily(b);
  return Boolean(fa && fa === fb);
}

/**
 * Pistes de culture suivante d'après l'historique d'une parcelle ([{campaignId, culture}], du plus ancien au plus récent).
 * @returns {null|{previous:{campaignId,culture}, avoid:{crop,reasons}[], good:{crop,reasons}[], neutral:{crop,reasons}[], source:string}}
 */
export function nextCropOptions(history = [], {prefs = {}, candidates = NEXT_CROP_CANDIDATES, refs = NITROGEN_REFERENCES} = {}) {
  const hist = history.filter(h => h && h.culture && h.campaignId);
  const last = hist.at(-1);
  if (!last) return null;
  const year = campaignYear(last.campaignId) + 1;
  // Pailles d'affilée en fin d'historique (années consécutives).
  let straws = 0;
  for (let i = hist.length - 1; i >= 0 && inFamily(hist[i].culture, 'pailles') && campaignYear(hist[i].campaignId) === year - (hist.length - i); i--) straws++;
  const rows = candidates.map(crop => {
    const avoid = [], plus = [];
    const fam = rotationFamily(crop);
    if (fam) {
      const prev = [...hist].reverse().find(h => rotationFamily(h.culture) === fam), delay = rotationDelay(fam, prefs);
      if (prev && year - campaignYear(prev.campaignId) < delay) avoid.push(`${prev.culture} en ${prev.campaignId} : délai de retour conseillé ${delay} ans (réglable)`);
    }
    if (inFamily(crop, 'sclerotinia')) {
      const prev = [...hist].reverse().find(h => inFamily(h.culture, 'sclerotinia'));
      if (prev && year - campaignYear(prev.campaignId) < 3 && !avoid.length) avoid.push(`sclérotinia : ${prev.culture} en ${prev.campaignId}, moins de 3 ans entre deux cultures sensibles`);
    }
    if (inFamily(crop, 'pailles') && inFamily(last.culture, 'maisGrain')) avoid.push('paille après maïs grain : risque de fusariose et de mycotoxines (DON)');
    if (inFamily(crop, 'pailles') && straws >= 2) avoid.push(`${straws + 1}ᵉ céréale à paille d’affilée : piétin et graminées adventices`);
    const effect = precedentEffect(last.culture, refs), ref = cultureReference(crop, refs);
    if (effect.effect > 0 && ref && ref.b > 0) plus.push(`précédent ${effect.label.toLowerCase()} : environ ${effect.effect} kg N/ha à déduire de la dose (table de références)`);
    if (inFamily(last.culture, 'pailles') && !inFamily(crop, 'pailles')) plus.push('coupe le cycle des maladies et des adventices des pailles');
    return {crop, reasons: avoid.length ? avoid : plus, avoided: avoid.length > 0};
  });
  return {previous: last, avoid: rows.filter(r => r.avoided), good: rows.filter(r => !r.avoided && r.reasons.length), neutral: rows.filter(r => !r.avoided && !r.reasons.length), source: NEXT_CROP_SOURCE};
}
