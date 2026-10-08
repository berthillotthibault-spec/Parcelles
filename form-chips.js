// n° 34 — Formulaires unifiés en pastilles : logique pure, testable sous node:test.
// Les pastilles ne sont qu’une couche de saisie : elles écrivent dans les champs existants
// (mêmes noms, mêmes formats), si bien que les valeurs enregistrées ne changent pas.
import {rankTypes, typeFamily, normalizeType} from './quick-entry.js';

export const WORK_STATUSES = ['À faire', 'À préparer', 'Prêt', 'En cours', 'Bloqué', 'Terminé', 'En retard', 'Annulé', 'Brouillon'];
// Statuts proposés en pastilles ; les autres restent dans la liste « Autre… ».
export const WORK_STATUS_CHIPS = ['À faire', 'En cours', 'Terminé'];
export const TASK_STATUSES = ['À faire', 'En cours', 'Terminé'];
export const TASK_PRIORITIES = ['Basse', 'Normale', 'Haute'];
export const TYPE_CHIP_LIMIT = 6;
export const PARCEL_CHIP_LIMIT = 5;

const live = list => (Array.isArray(list) ? list : []).filter(item => item && !item.deletedAt);
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

// Jour ISO décalé de n jours, sans dépendre du fuseau horaire.
export function addDaysIso(iso, days) {
  const m = ISO.exec(String(iso || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(days || 0)));
  return d.toISOString().slice(0, 10);
}

// Pastilles de date : « Aujourd’hui », « Demain », sinon « Choisir » (sélecteur de date affiché).
export function dateOptions(today) {
  return [{value: today, label: 'Aujourd’hui'}, {value: addDaysIso(today, 1), label: 'Demain'}];
}

// Types de travaux les plus fréquents de l’exploitation, complétés par les types courants.
// Le type déjà saisi est toujours proposé, pour qu’une modification ne bascule pas sur « Autre… ».
export function workTypeOptions(data = {}, current = '', limit = TYPE_CHIP_LIMIT) {
  const ranked = rankTypes(data, {limit});
  const out = ranked.map(item => ({value: item.type, label: item.type, family: item.family}));
  const key = normalizeType(current);
  if (key && !out.some(o => normalizeType(o.value) === key)) {
    const value = String(current).trim();
    if (out.length >= limit) out.pop();
    out.unshift({value, label: value, family: typeFamily(value)});
  }
  return out;
}

// Parcelles en pastilles : la parcelle choisie, puis les favorites, puis les récentes
// (consultées puis travaillées). Les autres restent dans la liste complète « Autre… ».
export function parcelOptions(data = {}, {current = '', recentIds = [], limit = PARCEL_CHIP_LIMIT} = {}) {
  const parcels = live(data.parcelles).filter(p => !p.archived);
  const byId = new Map(parcels.map(p => [p.id, p]));
  const order = [];
  const push = id => {if (id && byId.has(id) && !order.includes(id)) order.push(id);};
  push(current);
  parcels.filter(p => p.favorite).sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr')).forEach(p => push(p.id));
  (Array.isArray(recentIds) ? recentIds : []).forEach(push);
  live(data.interventions).sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)).forEach(w => push(w.parcelId));
  return order.slice(0, limit).map(id => {
    const p = byId.get(id);
    return {value: p.id, label: p.nom || 'Parcelle', favorite: Boolean(p.favorite)};
  });
}

// Libellé d’un champ sans l’astérisque d’obligation.
export const fieldCaption = text => String(text ?? '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();

// Message d’erreur en ligne, en français, à partir de l’état ValidityState du navigateur.
export function validityMessage(validity = {}, caption = '') {
  const name = fieldCaption(caption) || 'ce champ';
  if (validity.valueMissing) return `Champ obligatoire : ${name}`;
  if (validity.rangeUnderflow) return `Valeur trop petite : ${name}`;
  if (validity.rangeOverflow) return `Valeur trop grande : ${name}`;
  if (validity.tooShort) return `Texte trop court : ${name}`;
  if (validity.tooLong) return `Texte trop long : ${name}`;
  return `Valeur invalide : ${name}`;
}
