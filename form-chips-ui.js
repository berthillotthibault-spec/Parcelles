// n° 34 — Formulaires unifiés en pastilles : couche d’interface.
// Chaque champ garde son contrôle d’origine (même name, même valeur enregistrée) ; les pastilles
// écrivent dedans et déclenchent input/change, si bien que les gestionnaires existants restent valables.
// « Autre… » / « Choisir » affiche le contrôle d’origine (saisie libre, liste complète, sélecteur de date).
// Les erreurs s’affichent sous le champ (« Champ obligatoire : … ») au lieu des bulles natives.
import {escapeHtml} from './utils.js';
import {animateElement} from './motion.js';
import {GLYPHS} from './quick-entry-ui.js';
import {WORK_STATUS_CHIPS, TASK_STATUSES, TASK_PRIORITIES, dateOptions, workTypeOptions, parcelOptions, fieldCaption, validityMessage} from './form-chips.js';

let seq = 0;
const nextId = prefix => `${prefix}-${++seq}`;
const fire = (el, type) => el.dispatchEvent(new Event(type, {bubbles: true}));
const isVisible = el => Boolean(el?.getClientRects?.().length);
// Texte propre d’un <label> (sans celui du contrôle qu’il contient).
const ownText = label => [...(label?.childNodes || [])].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();

// Transforme <label>Libellé<contrôle></label> en bloc de champ : légende, puis contrôle
// dans un <label class="fc-other"> qui garde un nom accessible.
function wrapField(control) {
  const existing = control.closest('.fc-field');
  if (existing) return existing;
  const label = control.closest('label');
  if (!label || control.type === 'checkbox' || control.type === 'radio') return null;
  const doc = control.ownerDocument;
  const host = doc.createElement('div');
  host.className = `field-label fc-field ${label.className}`.trim();
  if (label.hidden) host.hidden = true;
  const captionText = ownText(label) || control.name;
  const caption = doc.createElement('span');
  caption.className = 'fc-caption';
  caption.id = nextId('fc-caption');
  caption.textContent = captionText;
  const box = doc.createElement('label');
  box.className = 'fc-other';
  box.innerHTML = `<span class="sr-only">${escapeHtml(fieldCaption(captionText))}</span>`;
  label.replaceWith(host);
  box.append(control);
  host.append(caption, box);
  return host;
}

// Remplace un choix par des pastilles. options : [{value, label, glyph?}] ; other : libellé de la
// pastille qui affiche le contrôle d’origine (null : pas de saisie libre, contrôle toujours masqué).
// field : conteneur existant quand le contrôle n’est pas dans un <label> (carte).
export function chipify(control, {options = [], other = 'Autre…', field = null, ariaLabel = ''} = {}) {
  if (!control || control.dataset.fcReady) return null;
  const doc = control.ownerDocument;
  let host, box, caption;
  if (field) {
    host = field;
    host.classList.add('fc-field');
    caption = host.querySelector('label, .fc-caption');
    box = doc.createElement('div');
    box.className = 'fc-other';
    control.replaceWith(box);
    box.append(control);
  } else {
    host = wrapField(control);
    if (!host) return null;
    caption = host.querySelector('.fc-caption');
    box = host.querySelector('.fc-other');
  }
  control.dataset.fcReady = '1';
  box.id ||= nextId('fc-other');
  if (caption && !caption.id) caption.id = nextId('fc-caption');
  const values = options.map(o => String(o.value ?? ''));
  const group = doc.createElement('div');
  group.className = 'chip-choices fc-chips';
  group.setAttribute('role', 'group');
  if (ariaLabel) group.setAttribute('aria-label', ariaLabel);
  else if (caption) group.setAttribute('aria-labelledby', caption.id);
  group.innerHTML = options.map((o, i) => `<button type="button" class="choice-chip fc-chip" data-fc-index="${i}" aria-pressed="false">${o.glyph || ''}<span>${escapeHtml(o.label)}</span></button>`).join('')
    + (other ? `<button type="button" class="choice-chip fc-chip fc-chip-other" data-fc-other aria-pressed="false" aria-expanded="false" aria-controls="${box.id}"><span>${escapeHtml(other)}</span></button>` : '');
  box.before(group);
  let manualOther = false;
  const sync = () => {
    const value = String(control.value ?? '');
    const match = values.indexOf(value);
    const open = Boolean(other) && (manualOther || (value !== '' && match < 0));
    group.querySelectorAll('.fc-chip').forEach(chip => {
      const on = chip.hasAttribute('data-fc-other') ? open : (!open && Number(chip.dataset.fcIndex) === match);
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-pressed', String(on));
      if (chip.hasAttribute('data-fc-other')) chip.setAttribute('aria-expanded', String(open));
    });
    box.hidden = !open;
  };
  group.addEventListener('click', event => {
    const chip = event.target.closest('.fc-chip');
    if (!chip) return;
    if (chip.hasAttribute('data-fc-other')) {
      manualOther = true;
      sync();
      control.focus?.();
      return;
    }
    manualOther = false;
    const value = values[Number(chip.dataset.fcIndex)];
    if (String(control.value) !== value) {
      control.value = value;
      fire(control, 'input');
      fire(control, 'change');
    }
    clearFieldError(control);
    sync();
  });
  control.addEventListener('input', sync);
  control.addEventListener('change', sync);
  host.fcSync = sync;
  sync();
  return {host, group, sync};
}

// Remet les pastilles d’accord avec les champs modifiés par programme (modèle, brouillon…).
export function syncChips(root) {
  root?.querySelectorAll?.('.fc-field').forEach(host => host.fcSync?.());
}

export function clearFieldError(control) {
  const host = control?.closest?.('.fc-field') || control?.closest?.('label') || control?.parentElement;
  const error = host?.querySelector?.(':scope > .fc-error') || (host?.nextElementSibling?.classList?.contains('fc-error') ? host.nextElementSibling : null);
  if (error) {
    const ids = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== error.id);
    if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
    else control.removeAttribute('aria-describedby');
    error.remove();
  }
  control?.removeAttribute?.('aria-invalid');
}

const SHAKE = [{transform: 'translateX(0)'}, {transform: 'translateX(-4px)'}, {transform: 'translateX(4px)'}, {transform: 'translateX(-3px)'}, {transform: 'translateX(0)'}];

function showFieldError(control) {
  clearFieldError(control);
  const doc = control.ownerDocument;
  const host = wrapField(control) || control.closest('label') || control.parentElement;
  const details = host.closest('details');
  if (details && !details.open) details.open = true;
  const caption = host.querySelector?.('.fc-caption')?.textContent || ownText(control.closest('label')) || control.getAttribute('aria-label') || control.name;
  const error = doc.createElement('span');
  error.className = 'form-error fc-error';
  error.id = nextId('fc-error');
  error.setAttribute('role', 'alert');
  error.textContent = validityMessage(control.validity, caption);
  if (host.classList.contains('fc-field')) host.append(error);
  else host.after(error);
  control.setAttribute('aria-invalid', 'true');
  control.setAttribute('aria-describedby', [control.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
  const clear = () => {clearFieldError(control); control.removeEventListener('input', clear); control.removeEventListener('change', clear);};
  control.addEventListener('input', clear);
  control.addEventListener('change', clear);
  animateElement(host, SHAKE, {duration: 300, easing: 'ease-in-out'});
  return host;
}

// Remplace form.reportValidity() : renvoie true si le formulaire est valide, sinon affiche
// les erreurs sous les champs, secoue légèrement les champs fautifs et place le focus sur le premier.
export function validateForm(form) {
  if (!form) return false;
  form.noValidate = true;
  const invalid = [...form.elements].filter(el => el.willValidate && !el.checkValidity());
  form.querySelectorAll('.fc-error').forEach(error => {
    const control = form.querySelector(`[aria-describedby~="${error.id}"]`);
    if (control) clearFieldError(control); else error.remove();
  });
  if (!invalid.length) return true;
  const hosts = invalid.map(showFieldError);
  const first = invalid[0];
  const target = isVisible(first) ? first : hosts[0]?.querySelector?.('.fc-chip') || first;
  target.focus?.();
  target.scrollIntoView?.({block: 'center', behavior: 'smooth'});
  return false;
}

const glyph = family => (GLYPHS[family] || GLYPHS.other).replace('class="quick-glyph"', 'class="quick-glyph fc-glyph"');

// Nouveau travail / modification : parcelle, type, date et statut en pastilles.
export function enhanceWorkForm(form, {data = {}, today = '', recentIds = []} = {}) {
  if (!form || form.dataset.fcEnhanced) return;
  form.dataset.fcEnhanced = '1';
  form.noValidate = true;
  const el = form.elements;
  if (el.parcelId) {
    const options = parcelOptions(data, {current: el.parcelId.value, recentIds});
    chipify(el.parcelId, {options: options.map(o => ({...o, label: o.favorite ? `${o.label} ★` : o.label})), other: el.parcelId.options.length > options.length ? 'Autre…' : null});
  }
  if (el.type) chipify(el.type, {options: workTypeOptions(data, el.type.value).map(o => ({...o, glyph: glyph(o.family)})), other: 'Autre…'});
  if (el.date && today) chipify(el.date, {options: dateOptions(today), other: 'Choisir'});
  if (el.status) chipify(el.status, {options: WORK_STATUS_CHIPS.map(v => ({value: v, label: v})), other: 'Autre…'});
  form.classList.add('fc-form');
  form.addEventListener('change', () => syncChips(form));
}

// Nouvelle tâche : échéance, statut, parcelle et priorité en pastilles.
export function enhanceTaskForm(form, {data = {}, today = '', recentIds = []} = {}) {
  if (!form || form.dataset.fcEnhanced) return;
  form.dataset.fcEnhanced = '1';
  form.noValidate = true;
  const el = form.elements;
  if (el.dueDate && today) chipify(el.dueDate, {options: dateOptions(today), other: 'Choisir'});
  if (el.status) chipify(el.status, {options: TASK_STATUSES.map(v => ({value: v, label: v})), other: null});
  const parcelLabel = el.parcelId?.closest('label');
  if (el.parcelId && !parcelLabel?.hidden) {
    const options = parcelOptions(data, {current: el.parcelId.value, recentIds});
    chipify(el.parcelId, {options: [{value: '', label: 'Aucune'}, ...options], other: el.parcelId.options.length - 1 > options.length ? 'Autre…' : null});
  }
  if (el.priority) chipify(el.priority, {options: TASK_PRIORITIES.map(v => ({value: v, label: v})), other: null});
  form.classList.add('fc-form');
  form.addEventListener('change', () => syncChips(form));
}

// Outils de la carte : « Parcelles affichées » en pastilles (la liste d’origine reste la source).
export function enhanceMapFilter(root) {
  const control = root?.querySelector?.('#map-parcel-filter');
  const field = control?.closest('.map-menu-filter');
  if (!control || !field) return;
  chipify(control, {options: [...control.options].map(o => ({value: o.value, label: o.textContent})), other: null, field});
}
