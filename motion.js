// Shared motion and honest operation feedback. No animation delays application work.
const tasks = new Map();
const runningAnimations = new Set();
const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
let hideTimer;

reducedMotion?.addEventListener?.('change', event => {
  if (event.matches) for (const animation of runningAnimations) animation.cancel();
});

export function animateElement(element, frames, options = {}) {
  if (!element?.animate || reducedMotion?.matches) return Promise.resolve();
  const animation = element.animate(frames, {duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)', ...options});
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

export function dismissToast(item) {
  if (!item?.isConnected) return;
  animateElement(item, [{opacity: 1, translate: '0 0'}, {opacity: 0, translate: '0 6px'}], {duration: 160}).then(() => item.remove());
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

export function finishBoot() {
  const root = document.getElementById('app-boot');
  if (root) {
    updateBoot(4, 'Votre exploitation est prête');
    root.style.pointerEvents = 'none';
    animateElement(root, [{opacity: 1}, {opacity: 0}], {duration: 240}).then(() => root.remove());
  }
  revealView(document.querySelector('.view.is-active'));
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
