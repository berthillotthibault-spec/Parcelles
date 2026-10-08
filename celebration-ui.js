// Retour visuel et haptique quand un travail ou une tâche est coché. Aucune donnée n’est écrite :
// seul un repère « déjà célébré aujourd’hui » est gardé dans le navigateur.
import {animateElement, haptic} from './motion.js';
import {CELEBRATION_KEY, completeLabel, dayCompletion, leafLayout, pendingIsFresh, shouldBloom} from './celebration.js';

const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const CHECK_SVG = '<svg class="check-draw" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 12.5l4 4 8-9"/></svg>';
const LEAF_PATH = 'M0 -7C4 -4 4 3 0 7C-4 3 -4 -4 0 -7Z';
let pending = null;
let frame = 0;
let review = null;

function readKey() {try {return globalThis.localStorage?.getItem(CELEBRATION_KEY) || '';} catch {return '';}}
function writeKey(value) {try {globalThis.localStorage?.setItem(CELEBRATION_KEY, value);} catch {}}
const cssEscape = value => globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&');

function rowFor(id) {
  const button = document.querySelector(`#today-work-list .row-check[data-id="${cssEscape(id)}"]`);
  return button?.closest('.work-row') || null;
}

// Appelé au clic, avant l’enregistrement : mémorise la position de la ligne et la progression d’avant.
export function armCelebration(control, {id, kind = 'work', preferences = {}, native = null} = {}) {
  if (!id) return;
  const row = rowFor(id) || control?.closest?.('.work-row,.task-date-row');
  const bar = document.querySelector('#day-review .review-bar');
  pending = {
    id: String(id), kind, at: Date.now(),
    rect: row?.getBoundingClientRect?.() || null,
    previousPct: bar ? Number(bar.getAttribute('aria-valuenow')) || 0 : null
  };
  haptic('tick', {enabled: preferences.nativeHaptics !== false, native});
  review = {preferences, native};
}

function drawCheck(button) {
  if (!button) return;
  button.innerHTML = CHECK_SVG;
  const path = button.querySelector('path');
  if (reducedMotion?.matches || !path?.getTotalLength) return;
  const length = Math.ceil(path.getTotalLength());
  path.style.strokeDasharray = String(length);
  animateElement(path, [{strokeDashoffset: length}, {strokeDashoffset: 0}], {duration: 220, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'backwards'});
  animateElement(button, [{transform: 'scale(.8)', backgroundColor: 'transparent'}, {transform: 'scale(1)'}], {duration: 220});
}

function slideRow(row, rect) {
  if (!row || !rect || reducedMotion?.matches) return;
  const next = row.getBoundingClientRect();
  const dy = rect.top - next.top;
  if (Math.abs(dy) < 2) return;
  animateElement(row, [{transform: `translateY(${dy}px)`}, {transform: 'translateY(0)'}], {duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)'});
}

function fillBar(root, fromPct, toPct) {
  const fill = root.querySelector('.review-bar i');
  if (!fill || fromPct === null || fromPct === toPct) return;
  animateElement(fill, [{width: `${fromPct}%`}, {width: `${toPct}%`}], {duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)'});
}

function bloom(root) {
  if (reducedMotion?.matches) return;
  const layer = document.createElement('div');
  layer.className = 'review-bloom';
  layer.setAttribute('aria-hidden', 'true');
  const leaves = leafLayout(7);
  layer.innerHTML = `<svg viewBox="-60 -60 120 120" focusable="false">${leaves.map((_, i) => `<path class="leaf leaf-${i % 3}" d="${LEAF_PATH}"/>`).join('')}</svg>`;
  root.append(layer);
  const paths = [...layer.querySelectorAll('path')];
  Promise.all(paths.map((path, i) => {
    const leaf = leaves[i];
    return animateElement(path, [
      {transform: `translate(0px,0px) rotate(${leaf.rotate}deg) scale(.3)`, opacity: 0},
      {opacity: 1, offset: .25},
      {transform: `translate(${leaf.x}px,${leaf.y}px) rotate(${leaf.rotate}deg) scale(1)`, opacity: 0}
    ], {duration: 900, delay: leaf.delay, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both'});
  })).finally(() => layer.remove());
}

// Décore la carte « Bilan de la journée » à chaque rendu (état vert) et joue la célébration
// une fois le dernier rendu de l’image terminé (finish-task peut re-rendre deux fois).
export function decorateDayReview(root, {done, total, doneArea, today}) {
  if (!root) return;
  const state = dayCompletion({done, total});
  root.classList.toggle('is-complete', state.complete);
  root.querySelector('.review-complete')?.remove();
  if (state.complete) {
    const line = document.createElement('p');
    line.className = 'review-complete';
    line.textContent = completeLabel(doneArea);
    root.querySelector('.review-bar')?.after(line);
  }
  if (!pendingIsFresh(pending)) {pending = null; return;}
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => play(state, today, doneArea));
}

function play(state, today, doneArea) {
  const current = pending;
  pending = null;
  if (!current) return;
  const root = document.getElementById('day-review');
  const row = rowFor(current.id);
  if (row?.classList.contains('is-done')) {
    drawCheck(row.querySelector('.row-check'));
    slideRow(row, current.rect);
  }
  if (!root) return;
  fillBar(root, current.previousPct, state.pct);
  if (shouldBloom({complete: state.complete, pending: current, today, lastCelebrated: readKey()})) {
    writeKey(today);
    const line = root.querySelector('.review-complete');
    if (line) {line.setAttribute('role', 'status'); line.textContent = completeLabel(doneArea);}
    bloom(root);
    haptic('success', {enabled: review?.preferences?.nativeHaptics !== false, native: review?.native});
  }
}
