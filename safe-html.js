// Gabarits HTML sûrs (n° 152) : html`...${valeur}...` échappe toute interpolation par défaut.
// raw(chaîne) marque un fragment de confiance (icône, HTML déjà produit par html``) ; un tableau est concaténé
// élément par élément avec la même règle ; null, undefined et false ne produisent rien.
// Le résultat est un SafeHtml : String(x), `${x}` et innerHTML = x donnent la chaîne finale.
// À utiliser dans les nouveaux écrans et là où s'affichent des textes venus de l'extérieur
// (noms importés de SHP, réponses de l'assistant distant). Pas de migration globale.
export class SafeHtml {
  constructor(value) { this.value = String(value); }
  toString() { return this.value; }
}

const ESCAPES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;'};
export const escapeText = value => String(value).replace(/[&<>"'`]/g, char => ESCAPES[char]);

export const raw = value => value instanceof SafeHtml ? value : new SafeHtml(value ?? '');
export const isSafeHtml = value => value instanceof SafeHtml;

function part(value) {
  if (value == null || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(part).join('');
  return escapeText(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}
