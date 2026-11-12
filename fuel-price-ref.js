// Prix du gazole « du moment » (data.economie.gouv.fr, flux instantané des stations).
// Source du registre auto-update.js : ne fait que proposer une valeur. Le module n'écrit
// jamais dans preferences.fuelPrice : l'utilisateur choisit dans Paramètres.
// Attention : c'est le gazole ROUTIER, TTC. Le GNR agricole est moins cher, et aucune
// source GNR vérifiée n'existe : pas d'estimation chiffrée du GNR.

export const FUEL_PRICE_ID = 'fuel-price';
export const FUEL_PRICE_MIN = 0.8;
export const FUEL_PRICE_MAX = 4;
export const FUEL_VAT_RATE = 0.2;
const DATASET_URL = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

/**
 * Code département accepté : 01 à 95 (sauf 20), 2A, 2B, 971 à 976. Sinon null.
 * Le flux ne couvre que la métropole et la Corse : l'outre-mer est reconnu pour être refusé (prix réglementés).
 */
export function normalizeDept(dept) {
  const raw = String(dept ?? '').trim().toUpperCase();
  if (/^[1-9]$/.test(raw)) return `0${raw}`;
  if (/^(0[1-9]|1\d|[3-8]\d|9[0-5]|2[1-9]|2A|2B|97[1-6])$/.test(raw)) return raw;
  return null;
}

/** Vrai pour un département d'outre-mer (absent du flux des stations). */
export const isOverseasDept = code => /^97[1-6]$/.test(String(code ?? ''));

/** URL de la moyenne nationale, ou départementale si le département est connu. */
export function fuelPriceUrl(dept) {
  const code = normalizeDept(dept);
  let url = `${DATASET_URL}?select=avg(gazole_prix)%20as%20p,max(gazole_maj)%20as%20maj&limit=1`;
  if (code) url += `&where=code_departement%3D%22${code}%22`;
  return url;
}

const inRange = price => Number.isFinite(price) && price >= FUEL_PRICE_MIN && price <= FUEL_PRICE_MAX;

/** Lit la réponse de l'API. Renvoie {price, maj} ou null si absente ou hors fourchette. */
export function parseFuelPrice(json) {
  const row = Array.isArray(json?.results) ? json.results[0] : null;
  if (!row || row.p == null || row.p === '') return null;
  const price = Number(row.p);
  if (!inRange(price)) return null;
  const maj = typeof row.maj === 'string' && !Number.isNaN(Date.parse(row.maj)) ? row.maj : null;
  return {price: Math.round(price * 1000) / 1000, maj};
}

/** Prix hors TVA (20 %) d'un prix TTC, arrondi au centime. */
export function fuelPriceHt(priceTtc, vatRate = FUEL_VAT_RATE) {
  const price = Number(priceTtc);
  if (!Number.isFinite(price)) return null;
  return Math.round(price / (1 + vatRate) * 100) / 100;
}

const frPrice = n => Number(n).toLocaleString('fr-FR', {minimumFractionDigits: 2, maximumFractionDigits: 2});

const OLD_AFTER_MS = 180 * 24 * 3600 * 1000;

// Jour et mois ; l'année s'ajoute quand le relevé a plus de six mois (cache ancien hors ligne).
function frDayMonth(iso, now = Date.now()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  // max(gazole_maj) agrège toutes les stations : une date aberrante dans le futur n'est pas affichée.
  if (Number.isFinite(now) && date.getTime() - now > 24 * 3600 * 1000) return '';
  const old = Number.isFinite(now) && now - date.getTime() > OLD_AFTER_MS;
  try {
    return date.toLocaleDateString('fr-FR', {day: '2-digit', month: '2-digit', ...(old ? {year: 'numeric'} : {}), timeZone: 'Europe/Paris'});
  } catch {
    const dm = `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    return old ? `${dm}/${date.getUTCFullYear()}` : dm;
  }
}

/** Texte de la suggestion, ou '' pour la valeur embarquée ou une valeur inexploitable. */
export function fuelSuggestion(value, {now = Date.now()} = {}) {
  if (!value || value.kind !== 'gazole-routier' || !inRange(Number(value.price))) return '';
  const where = value.dept ? ` (dép. ${value.dept})` : '';
  const day = value.maj ? frDayMonth(value.maj, now) : '';
  return `Gazole routier du moment${where} : ${frPrice(value.price)} €/L TTC${day ? ` au ${day}` : ''} (le GNR est moins cher)`;
}

/**
 * Crée la source du registre. getDept() donne le département de l'exploitation s'il est connu.
 * check({fetch, signal}) suit le contrat de auto-update.js ; dept peut aussi être passé dans le contexte.
 */
export function createFuelPriceSource({getDept = () => null, fetchJson: fetchJsonFn} = {}) {
  return {
    id: FUEL_PRICE_ID,
    label: 'Prix du gazole (routier)',
    ttlMs: 24 * 3600 * 1000,
    embedded: {value: {price: 1.7, kind: 'defaut'}, version: 'défaut', label: '1,70 €/L par défaut'},
    async check({fetch, signal, dept} = {}) {
      let code = null;
      try { code = normalizeDept(dept ?? getDept?.()); } catch { code = null; }
      // Outre-mer : prix réglementés et absents du flux, la moyenne de métropole tromperait.
      if (isOverseasDept(code)) throw new Error('outre-mer : pas de relevé des stations');
      const load = async url => {
        if (typeof fetchJsonFn === 'function') return fetchJsonFn(fetch, url, {signal, maxBytes: 4096});
        const response = await fetch(url, {signal, headers: {Accept: 'application/json'}});
        if (!response?.ok) throw new Error(`HTTP ${response?.status ?? '?'}`);
        return response.json();
      };
      let parsed = parseFuelPrice(await load(fuelPriceUrl(code)));
      // Département sans station relevée : repli sur la moyenne nationale plutôt qu'un échec chaque jour.
      if (!parsed && code) { code = null; parsed = parseFuelPrice(await load(fuelPriceUrl(null))); }
      if (!parsed) throw new Error('prix absent ou hors fourchette');
      return {
        value: {price: parsed.price, dept: code, maj: parsed.maj, kind: 'gazole-routier'},
        version: parsed.maj ? parsed.maj.slice(0, 10) : null,
        sourceDate: parsed.maj,
        note: code ? `Moyenne des stations du département ${code}` : 'Moyenne nationale des stations'
      };
    },
    validate(result) {
      return result?.value?.kind === 'gazole-routier' && inRange(Number(result.value.price));
    }
  };
}

export const fuelPriceSource = createFuelPriceSource();

const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** Suggestion affichée sous le champ « Prix carburant » (entry = autoUpdater.get('fuel-price')). */
export function fuelRefNoteHtml(entry) {
  const text = fuelSuggestion(entry?.value);
  if (!text) return '';
  const old = entry?.stale ? ' Dernière valeur connue, non revérifiée depuis plus d’un jour.' : '';
  return `<p class="form-note">${esc(text)}.${old} <button type="button" class="button secondary" data-fuel-ref="use">Utiliser</button></p>`;
}

/** Étape de confirmation : rien n'est écrit avant le choix HT ou TTC. */
export function fuelRefConfirmHtml(value) {
  if (!fuelSuggestion(value)) return '';
  const ttc = Math.round(Number(value.price) * 100) / 100, ht = fuelPriceHt(value.price);
  return `<p class="form-note">Ce prix est TTC et vaut pour le gazole routier : ${esc(frPrice(ttc))} €/L TTC, soit ${esc(frPrice(ht))} €/L HT (TVA 20 %). Les factures ajoutent la TVA à la ligne de gazole refacturé : le prix HT évite de la compter deux fois. Le GNR coûte moins cher : vérifiez votre dernier plein.</p><div style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" class="button primary" data-fuel-ref="ht" data-price="${ht}">Mettre ${esc(frPrice(ht))} €/L HT</button><button type="button" class="button secondary" data-fuel-ref="ttc" data-price="${ttc}">Mettre ${esc(frPrice(ttc))} €/L TTC</button><button type="button" class="button secondary" data-fuel-ref="cancel">Annuler</button></div>`;
}
