// Shared motion and honest operation feedback. No animation delays application work.
// 10.39 : mêmes courbes et durées que tokens.css (--motion-ease, --ease-in, --ease-sheet, --motion-*).
export const EASE = 'cubic-bezier(.2,.7,.2,1)';
export const EASE_IN = 'cubic-bezier(.4,0,1,1)';
export const EASE_SHEET = 'cubic-bezier(.32,.72,0,1)';
export const DUR = {fast: 120, base: 200, slow: 320};
const tasks = new Map();
const runningAnimations = new Set();
const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
let hideTimer;

reducedMotion?.addEventListener?.('change', event => {
  if (event.matches) for (const animation of runningAnimations) animation.cancel();
});

export function animateElement(element, frames, options = {}) {
  if (!element?.animate || reducedMotion?.matches) return Promise.resolve();
  const animation = element.animate(frames, {duration: 260, easing: EASE, ...options});
  runningAnimations.add(animation);
  return animation.finished.catch(() => {}).finally(() => runningAnimations.delete(animation));
}

export function revealView(view) {
  if (!view || reducedMotion?.matches) return;
  // Never transform Leaflet or its ancestors: map controls must stay in place.
  const container = view.querySelector('.page-container');
  if (!container) return;
  [...container.children].filter(node => !node.hidden && !node.classList.contains('hidden')).slice(0, 7).forEach((node, i) => {
    node.getAnimations?.().forEach(animation => animation.cancel());
    animateElement(node, [{opacity: 0, translate: '0 10px'}, {opacity: 1, translate: '0 0'}], {delay: i * 28, fill: 'backwards'});
  });
}

// 10.39 : FLIP. L’élément part de son ancienne place (rect mesuré avant le changement) et glisse vers la nouvelle.
export function flip(element, rect, {duration = DUR.base, easing = EASE} = {}) {
  if (!element || !rect || reducedMotion?.matches) return Promise.resolve();
  const next = element.getBoundingClientRect();
  const dx = rect.left - next.left, dy = rect.top - next.top;
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return Promise.resolve();
  return animateElement(element, [{translate: `${dx}px ${dy}px`}, {translate: '0 0'}], {duration, easing});
}

// 10.39 : changement d’onglet ou de filtre. Seule la liste se renouvelle, sans glissement ni cascade.
export function revealList(list) {
  if (!list || reducedMotion?.matches) return;
  list.getAnimations?.().forEach(animation => animation.cancel());
  animateElement(list, [{opacity: .4}, {opacity: 1}], {duration: 140, easing: 'ease-out'});
}

// 10.39 : sortie d’une feuille ou d’une boîte de dialogue. closeModal() reste synchrone (focus, pile, modales
// enchaînées) : on anime une copie inerte (« fantôme ») pendant que la vraie fenêtre est déjà vidée.
export function sheetExit(root, {fromY = 0, narrow = false} = {}) {
  const sheet = root?.querySelector?.('.modal');
  if (!sheet || reducedMotion?.matches || !globalThis.document?.body) return;
  const ghost = document.createElement('div');
  ghost.className = [...root.classList].filter(name => name !== 'has-modal' && name !== 'modal-root').concat('modal-root', 'has-modal', 'modal-ghost').join(' ');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  const backdrop = root.querySelector('.modal-backdrop')?.cloneNode(false);
  const copy = sheet.cloneNode(true);
  copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  copy.style.transform = '';
  if (backdrop) ghost.append(backdrop);
  ghost.append(copy);
  document.body.append(ghost);
  // Le contenu garde sa position de défilement : la feuille part telle qu’on la voyait.
  const from = [sheet, ...sheet.querySelectorAll('*')], to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((node, i) => {if (node.scrollTop > 0 && to[i]) to[i].scrollTop = node.scrollTop;});
  const out = narrow
    ? animateElement(copy, [{translate: `0 ${Math.max(0, fromY)}px`}, {translate: '0 100%'}], {duration: DUR.base, easing: EASE_IN, fill: 'forwards'})
    : animateElement(copy, [{opacity: 1, scale: 1}, {opacity: 0, scale: .98}], {duration: 160, easing: EASE_IN, fill: 'forwards'});
  const fade = backdrop ? animateElement(backdrop, [{opacity: 1}, {opacity: 0}], {duration: 160, easing: 'ease-out', fill: 'forwards'}) : null;
  const safety = setTimeout(() => ghost.remove(), 600);
  Promise.all([out, fade]).then(() => {clearTimeout(safety); ghost.remove();});
}

// 10.39 : retour d’une feuille relâchée avant le seuil, depuis la position du doigt.
export function sheetSettle(sheet, fromY) {
  if (!sheet || !(fromY > 0)) return;
  animateElement(sheet, [{translate: `0 ${fromY}px`}, {translate: '0 0'}], {duration: 220, easing: EASE});
}

// 10.39 : un toast retiré s’efface (jamais d’un coup) et les autres glissent à leur nouvelle place (FLIP).
export function dismissToast(item) {
  if (!item?.isConnected || item.dataset?.leaving) return;
  if (item.dataset) item.dataset.leaving = '1';
  if (item.style) item.style.pointerEvents = 'none';
  animateElement(item, [{opacity: 1, translate: '0 0'}, {opacity: 0, translate: '0 6px'}], {duration: 160}).then(() => {
    const siblings = [...(item.parentElement?.children || [])].filter(node => node !== item && node.classList?.contains('toast'));
    const rects = reducedMotion?.matches ? [] : siblings.map(node => node.getBoundingClientRect());
    item.remove();
    rects.forEach((rect, i) => flip(siblings[i], rect, {duration: DUR.base}));
  });
}

export function updateBoot(step, label) {
  const root = document.getElementById('app-boot');
  if (!root) return;
  root.querySelector('[data-boot-label]').textContent = label;
  const bar = root.querySelector('[role="progressbar"]');
  bar.setAttribute('aria-valuenow', String(step));
  bar.setAttribute('aria-valuetext', `${step} étapes sur 4 : ${label}`);
  bar.firstElementChild.style.transform = `scaleX(${step / 4})`;
}

export function bootRemaining(duration, startedAt, now, reduce = false) {
  return reduce ? 0 : Math.max(0, Math.min(3500, Number(duration) || 0) - Math.max(0, now - startedAt));
}

export const BOOT_FADE_MS = 280;
// 10.39 : signature du démarrage (tuile, tracé de la parcelle, nom en serif) jouée pendant le chargement.
// Si l’application est prête avant la fin, la signature accélère (classe boot-hurry) au plus BOOT_HURRY_MS.
export const BOOT_SIGNATURE_MS = 760;
export const BOOT_HURRY_MS = 160;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// n° 142 : par défaut (0), l’écran s’efface dès que l’application est prête.
// Une durée choisie (1,2 s ou 3,5 s) n’attend que le temps de présentation manquant.
// L’application redevient utilisable dès le début de la sortie : le voile ne capte plus les appuis.
export async function finishBoot({duration = 0} = {}) {
  const root = document.getElementById('app-boot');
  if (!root) {revealView(document.querySelector('.view.is-active')); return;}
  updateBoot(4, 'Votre exploitation est prête');
  const reduce = Boolean(reducedMotion?.matches);
  const startedAt = Number(root.dataset.startedAt) || 0;
  const remaining = bootRemaining(duration, startedAt, performance.now(), reduce);
  const fadeDuration = reduce ? 0 : BOOT_FADE_MS;
  if (remaining > fadeDuration) await new Promise(resolve => {
    const finish = () => {clearTimeout(timer);reducedMotion?.removeEventListener?.('change', onChange);resolve();};
    const onChange = event => {if (event.matches) finish();};
    const timer = setTimeout(finish, remaining - fadeDuration);
    reducedMotion?.addEventListener?.('change', onChange);
  });
  const returnFocus = root.contains(document.activeElement);
  if (root.style) root.style.pointerEvents = 'none';
  root.setAttribute?.('aria-hidden', 'true');
  document.getElementById('app')?.removeAttribute('inert');
  document.getElementById('assistant-dock')?.removeAttribute('inert');
  if (returnFocus) document.getElementById('main')?.focus({preventScroll:true});
  if (fadeDuration > 0 && !reducedMotion?.matches) {
    const signatureLeft = BOOT_SIGNATURE_MS - Math.max(0, performance.now() - startedAt);
    if (signatureLeft > 0) {root.classList?.add('boot-hurry'); await wait(Math.min(signatureLeft, BOOT_HURRY_MS));}
    // Sortie enchaînée : l’accueil monte pendant que la marque recule et que le voile s’efface.
    revealView(document.querySelector('.view.is-active'));
    animateElement(root.querySelector('.boot-identity'), [{opacity: 1, scale: 1}, {opacity: 0, scale: .96}], {duration: fadeDuration, easing: EASE_IN, fill: 'forwards'});
    await animateElement(root, [{opacity: 1}, {opacity: 0}], {duration: fadeDuration, easing: EASE_IN, fill: 'forwards'});
  }
  root.remove();
}

export function progressRatio(completed, total) {
  return Number.isFinite(completed) && Number.isFinite(total) && total > 0
    ? Math.max(0, Math.min(1, completed / total)) : null;
}

function renderProgress() {
  const root = document.getElementById('activity-progress');
  if (!root) return;
  const visible = [...tasks.values()].filter(task => task.visible);
  const task = visible.at(-1);
  if (!task) return;
  clearTimeout(hideTimer);
  root.hidden = false;
  root.classList.remove('is-complete');
  root.querySelector('[data-progress-label]').textContent = task.label;
  root.querySelector('[data-progress-count]').textContent = visible.length > 1 ? `${visible.length} opérations en cours` : '';
  const bar = root.querySelector('[role="progressbar"]');
  const ratio = progressRatio(task.completed, task.total);
  bar.setAttribute('aria-label', task.label);
  bar.classList.toggle('is-indeterminate', ratio === null);
  if (ratio === null) {
    bar.removeAttribute('aria-valuenow');
    bar.removeAttribute('aria-valuetext');
    bar.firstElementChild.style.removeProperty('transform');
  } else {
    const value = Math.round(ratio * 100);
    bar.setAttribute('aria-valuenow', String(value));
    bar.setAttribute('aria-valuetext', `${value} %`);
    bar.firstElementChild.style.transform = `scaleX(${ratio})`;
  }
}

// Each caller owns a token: overlapping requests cannot hide one another's feedback.
export function startProgress(label, {delay = 140, completed, total} = {}) {
  clearTimeout(hideTimer);
  const token = Symbol(label);
  const task = {label, completed, total, visible: false};
  tasks.set(token, task);
  const showTimer = setTimeout(() => {task.visible = true; renderProgress();}, delay);
  let ended = false;
  return {
    update(next = {}) {
      if (ended) return;
      Object.assign(task, next);
      if (task.visible) renderProgress();
    },
    finish({error = false} = {}) {
      if (ended) return;
      ended = true;
      clearTimeout(showTimer);
      tasks.delete(token);
      if ([...tasks.values()].some(item => item.visible)) {renderProgress(); return;}
      const root = document.getElementById('activity-progress');
      if (!root) return;
      // Completion is shown only after the operation resolves, never on a timer.
      if (error || tasks.size || !task.visible || reducedMotion?.matches) {root.hidden = true; return;}
      root.classList.add('is-complete');
      root.querySelector('[data-progress-label]').textContent = 'Terminé';
      root.querySelector('[data-progress-count]').textContent = '';
      const bar = root.querySelector('[role="progressbar"]');
      bar.classList.remove('is-indeterminate');
      bar.setAttribute('aria-valuenow', '100');
      bar.setAttribute('aria-valuetext', 'Terminé');
      bar.firstElementChild.style.transform = 'scaleX(1)';
      hideTimer = setTimeout(() => {root.hidden = true;}, 240);
    }
  };
}

export async function withProgress(label, operation, {button, ...options} = {}) {
  const progress = startProgress(label, options);
  const wasDisabled = button?.disabled;
  const previousBusy = button?.getAttribute('aria-busy');
  if (button) {button.disabled = true; button.setAttribute('aria-busy', 'true');}
  let failed = false;
  try {return await operation(progress);}
  catch (error) {failed = true; throw error;}
  finally {
    progress.finish({error: failed});
    if (button) {
      button.disabled = wasDisabled;
      if (previousBusy === null) button.removeAttribute('aria-busy');
      else button.setAttribute('aria-busy', previousBusy);
    }
  }
}

// Retour haptique discret : plugin natif (Capacitor) s’il existe, sinon navigator.vibrate (PWA Android).
// Jamais bloquant : un appareil sans vibration renvoie simplement false.
// n° 18 : « saved » (30 ms) perceptible avec des gants, « error » en trois temps.
export const HAPTIC_PATTERNS = {tick: 12, success: [12, 70, 24], saved: 30, error: [80, 60, 80]};
export async function haptic(kind = 'tick', {enabled = true, native = null, nav = globalThis.navigator} = {}) {
  if (!enabled) return false;
  try {
    if (native?.capabilities?.haptics && await native.haptic(kind === 'error' ? 'heavy' : kind === 'success' || kind === 'saved' ? 'medium' : 'light')) return true;
  } catch {}
  try {return Boolean(nav?.vibrate?.(HAPTIC_PATTERNS[kind] ?? HAPTIC_PATTERNS.tick));}
  catch {return false;}
}
