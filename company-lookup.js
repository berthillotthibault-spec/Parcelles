// Recherche d'une entreprise dans l'annuaire public de l'État (recherche-entreprises.api.gouv.fr, sans clé) :
// nom, SIREN, SIRET, commune ou code postal, seuls ou combinés. Appel uniquement sur demande de l'utilisateur ;
// le résultat préremplit la fiche client, qu'il relit avant d'enregistrer. Logique pure + un fetch injecté.
export const COMPANY_SEARCH_URL = 'https://recherche-entreprises.api.gouv.fr/search';

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
/** Clé de TVA intracommunautaire française calculée depuis le SIREN. */
export function vatFromSiren(siren) {
  const s = String(siren || '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(s)) return '';
  const key = (12 + 3 * (Number(s) % 97)) % 97;
  return `FR${String(key).padStart(2, '0')}${s}`;
}
/** Requête : un SIREN/SIRET seul, sinon le texte libre ; un code postal (5 chiffres) devient un filtre. */
export function companySearchUrl(query, {perPage = 8} = {}) {
  let q = clean(query); if (q.length < 2) return null;
  const params = new URLSearchParams({per_page: String(perPage), page: '1'});
  const compact = q.replace(/[\s.\-]/g, '').replace(/^FR\d{2}(?=\d{9}$)/i, '');
  if (/^\d{9}$|^\d{14}$/.test(compact)) q = compact;
  else {
    const cp = q.match(/\b(\d{5})\b/);
    if (cp) { params.set('code_postal', cp[1]); q = clean(q.replace(cp[0], ' ')) || cp[1]; }
  }
  params.set('q', q);
  return `${COMPANY_SEARCH_URL}?${params.toString()}`;
}
// ---------- Exploitant agricole probable (pré-remplissage, toujours modifiable) ----------
// Code NAF (activite_principale, ex. « 01.11Z ») : 01.1 à 01.5 (cultures, élevage, culture et élevage associés)
// et 02.1 à 02.3 (sylviculture, exploitation forestière, récolte de produits forestiers). Les services de
// soutien (01.6, 02.4 : entreprises de travaux agricoles ou forestiers) et la chasse (01.7) sont exclus par prudence.
const AGRI_NAF_RE = /^(01\.?[1-5]|02\.?[1-3])/;
export function agriculturalActivity(code) { return AGRI_NAF_RE.test(String(code || '').trim()); }
// Catégories juridiques INSEE (nature_juridique) des formes agricoles usuelles ; le nom sert de repli.
const LEGAL_CODES = {'6533': 'GAEC', '6597': 'SCEA', '6598': 'EARL', '6316': 'CUMA'};
const FARM_FORMS = new Set(['GAEC', 'EARL', 'SCEA']);
export function legalFormOf(code, name = '') {
  const known = LEGAL_CODES[String(code || '').trim()];
  if (known) return known;
  const m = /\b(GAEC|EARL|SCEA|CUMA)\b/i.exec(String(name || ''));
  return m ? m[1].toUpperCase() : '';
}
/** Exploitant agricole probable d'après l'activité principale (NAF) ou la forme juridique (GAEC, EARL, SCEA). */
export function farmerLikely({activity = '', legalForm = ''} = {}) { return agriculturalActivity(activity) || FARM_FORMS.has(String(legalForm || '').toUpperCase()); }

const title = s => clean(s).toLowerCase().replace(/(^|[\s'’\-])([a-zàâçéèêëîïôûùüÿ])/g, (m, a, b) => a + b.toUpperCase());
/** Réponse de l'API → propositions de fiche client (champs de clientBillingValues). */
export function parseCompanyResults(payload) {
  return (Array.isArray(payload?.results) ? payload.results : []).map(r => {
    const s = r.siege || {}, street = clean([s.numero_voie, s.indice_repetition, s.type_voie, s.libelle_voie].filter(Boolean).join(' '));
    const address = [s.complement_adresse, street, clean(`${s.code_postal || ''} ${s.libelle_commune || ''}`)].map(clean).filter(Boolean).join('\n') || clean(s.adresse);
    const dirigeant = (r.dirigeants || []).find(d => d.nom || d.denomination);
    const activity = clean(r.activite_principale), legalForm = legalFormOf(r.nature_juridique, r.nom_raison_sociale || r.nom_complet);
    return {
      legalForm, farmerLikely: farmerLikely({activity, legalForm}),
      name: clean(r.nom_raison_sociale || r.nom_complet) || clean(r.nom_complet), displayName: clean(r.nom_complet || r.nom_raison_sociale),
      siren: clean(r.siren), siret: clean(s.siret), vatNumber: vatFromSiren(r.siren), billingAddress: address, kind: 'pro',
      city: title(s.libelle_commune || ''), postalCode: clean(s.code_postal), activity: clean(r.activite_principale),
      contact: dirigeant ? clean(dirigeant.denomination || `${title(dirigeant.prenoms || '')} ${title(dirigeant.nom || '')}`) : '',
      closed: r.etat_administratif === 'C'
    };
  }).filter(x => x.name && x.siren);
}
export async function searchCompanies(query, {fetchImpl = globalThis.fetch, signal} = {}) {
  const url = companySearchUrl(query);
  if (!url) throw new Error('Tapez au moins 2 caractères : nom, SIREN, commune ou code postal.');
  let response;
  try { response = await fetchImpl(url, {headers: {accept: 'application/json'}, signal}); }
  catch (error) { if (error?.name === 'AbortError') throw error; throw new Error('Annuaire des entreprises injoignable (connexion ?).'); }
  if (response.status === 429) throw new Error('Annuaire des entreprises surchargé : réessayez dans quelques secondes.');
  if (!response.ok) throw new Error(`Annuaire des entreprises indisponible (${response.status}).`);
  return parseCompanyResults(await response.json());
}
