// Diagnostic graphique automatique : parcourt les écrans et les fenêtres, détecte débordements,
// textes coupés, icônes cassées ou mal dimensionnées, éléments hors écran, cibles trop petites.
// Usage : node tools/scan-graphique.mjs http://localhost:8080/index.html <dossier> [--device=iPhone SE|iPhone 14|Desktop]
import {chromium, devices} from 'playwright';
import fs from 'node:fs';
import {seedDemoFarm} from './seed-demo.mjs';

const URL = process.argv[2] || 'http://localhost:8080/index.html';
const OUT = process.argv[3] || '/tmp/scan';
const devArg = (process.argv.find(a => a.startsWith('--device=')) || '--device=iPhone 14').slice(9);
const MAX = Number((process.argv.find(a => a.startsWith('--max=')) || '--max=400').slice(6));
fs.mkdirSync(OUT, {recursive: true});
const dev = devArg === 'Desktop' ? {viewport: {width: 1366, height: 860}} : devices[devArg];

const browser = await chromium.launch();
const ctx = await browser.newContext({...dev, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block'});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('dialog', d => d.dismiss().catch(() => {}));
await page.goto(URL, {waitUntil: 'load'});
await page.evaluate(seedDemoFarm);
await page.reload({waitUntil: 'load'});
await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 20000});
const noAnim = () => page.addStyleTag({content: '*,*::before,*::after{animation:none!important;transition:none!important}'}).catch(() => {});
await noAnim();

// Contrôles DOM génériques, exécutés dans la page sur la zone visible (modale ouverte sinon vue active).
const inspect = () => {
  const vw = document.documentElement.clientWidth;
  const root = document.querySelector('#modal-root .modal, #modal-root [role=dialog], .sheet.open, .bottom-sheet.open') || document.querySelector('.view.is-active') || document.body;
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0; };
  const sel = el => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; const c = [...el.classList].slice(0, 3).join('.'); if (c) s += '.' + c; const p = el.parentElement; let ps = ''; if (p) { ps = p.tagName.toLowerCase() + (p.id ? '#' + p.id : '') + ([...p.classList][0] ? '.' + [...p.classList][0] : '') + ' > '; } return ps + s; };
  const txt = el => (el.getAttribute('aria-label') || el.textContent || el.value || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const issues = [];
  const push = (type, el, extra = '') => issues.push({type, sel: sel(el), text: txt(el), extra});
  const all = [...root.querySelectorAll('*')].filter(vis);
  if (document.documentElement.scrollWidth > vw + 1) issues.push({type: 'page-hscroll', sel: 'html', text: '', extra: `${document.documentElement.scrollWidth}>${vw}`});
  for (const el of all) {
    if (el.closest('.sr-only, .visually-hidden')) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    // Hors écran horizontalement (hors conteneurs défilants)
    let scroller = el.parentElement, inScroll = false;
    while (scroller && scroller !== document.body) { const o = getComputedStyle(scroller).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { inScroll = true; break; } scroller = scroller.parentElement; }
    if (!inScroll && (r.right > vw + 1 || r.left < -1) && r.width < vw * 3 && !el.closest('.leaflet-container')) push('offscreen-x', el, `left=${Math.round(r.left)} right=${Math.round(r.right)} vw=${vw}`);
    // Débordement du parent (enfant plus large que son parent sans défilement)
    const p = el.parentElement;
    if (p && !inScroll && !el.closest('.leaflet-container') && s.position !== 'absolute' && s.position !== 'fixed') {
      const pr = p.getBoundingClientRect(); const ps = getComputedStyle(p);
      if (r.right > pr.right + 2 && ps.overflowX === 'visible' && pr.width > 0 && r.right - pr.right < 2000) push('overflow-parent', el, `dépasse de ${Math.round(r.right - pr.right)}px (parent ${sel(p)})`);
    }
    // Champs
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'hidden' && el.type !== 'checkbox' && el.type !== 'radio') {
      if (p) { const pr = p.getBoundingClientRect(); if (r.right > pr.right + 2 || r.left < pr.left - 2) push('field-overflow', el, `champ ${Math.round(r.width)}px, parent ${Math.round(pr.width)}px`); }
      if (r.height < 36 && el.type !== 'range' && el.type !== 'color') push('field-small', el, `h=${Math.round(r.height)}`);
      if (el.tagName === 'SELECT' && el.scrollWidth > el.clientWidth + 2) push('select-clipped', el, `${el.scrollWidth}>${el.clientWidth}`);
      if (el.tagName === 'INPUT' && el.placeholder && el.scrollWidth > el.clientWidth + 2 && !el.value) push('placeholder-clipped', el, el.placeholder);
    }
    // Texte coupé
    if (el.children.length === 0 && el.textContent.trim() && (s.overflow === 'hidden' || s.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 2 && s.textOverflow !== 'ellipsis') push('text-clipped', el, `${el.scrollWidth}>${el.clientWidth}`);
    if (el.children.length === 0 && el.textContent.trim() && s.overflow === 'hidden' && el.scrollHeight > el.clientHeight + 3 && !/-webkit-box/.test(s.display) && s.webkitLineClamp === 'none') push('text-clipped-y', el, `${el.scrollHeight}>${el.clientHeight}`);
    // Mot qui sort de sa boîte
    if (el.children.length === 0 && el.textContent.trim().length > 3 && el.scrollWidth > el.clientWidth + 2 && s.overflowX === 'visible' && s.display !== 'inline') push('text-overflow-box', el, `${el.scrollWidth}>${el.clientWidth}`);
    // Icônes
    if (el.tagName === 'svg') {
      if (r.width < 8 || r.height < 8) push('icon-tiny', el, `${Math.round(r.width)}x${Math.round(r.height)}`);
      if (Math.abs(r.width - r.height) > 2 && el.getAttribute('viewBox') === '0 0 24 24') push('icon-distorted', el, `${Math.round(r.width)}x${Math.round(r.height)}`);
      if (!el.querySelector('path,circle,rect,line,polyline,polygon,use,ellipse,g')) push('icon-empty', el);
      try { const b = el.getBBox(); if (el.getAttribute('viewBox') === '0 0 24 24' && (b.x < -1 || b.y < -1 || b.x + b.width > 25 || b.y + b.height > 25)) push('icon-path-outside', el, `bbox ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)},${b.height.toFixed(1)}`); } catch {}
    }
    if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0) push('img-broken', el, el.getAttribute('src'));
    // Glyphes problématiques : symboles de remplacement, émojis utilisés comme icônes
    if (el.children.length === 0 && /[�□]/.test(el.textContent)) push('glyph-tofu', el);
    if (el.children.length === 0 && /\p{Extended_Pictographic}/u.test(el.textContent) && el.textContent.trim().length <= 3) push('emoji-icon', el, el.textContent.trim());
    // Cibles tactiles
    if ((el.tagName === 'BUTTON' || (el.tagName === 'A' && el.href)) && (r.height < 32 || r.width < 32) && !el.closest('.leaflet-control-attribution')) push('tap-small', el, `${Math.round(r.width)}x${Math.round(r.height)}`);
    // Bouton dont le contenu déborde
    if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 2) push('button-content-overflow', el, `${el.scrollWidth}>${el.clientWidth}`);
  }
  // Chevauchements entre boutons frères
  const btns = [...root.querySelectorAll('button, a.button, .chip, .filter-chip')].filter(vis);
  for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < Math.min(btns.length, i + 30); j++) {
    const a = btns[i].getBoundingClientRect(), b = btns[j].getBoundingClientRect();
    if (btns[i].contains(btns[j]) || btns[j].contains(btns[i])) continue;
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 4 && oy > 4) push('overlap', btns[i], `chevauche ${sel(btns[j])} « ${txt(btns[j])} » (${Math.round(ox)}x${Math.round(oy)})`);
  }
  return issues;
};

const report = [];
let n = 0;
const slug = s => s.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 50).toLowerCase();
const record = async (name) => {
  if (n >= MAX) return;
  n++;
  const file = `${String(n).padStart(3, '0')}-${slug(name)}.png`;
  await page.screenshot({path: `${OUT}/${file}`, fullPage: false}).catch(() => {});
  // capture de la modale entière si elle défile
  const issues = await page.evaluate(inspect).catch(e => [{type: 'inspect-error', sel: '', text: '', extra: e.message}]);
  report.push({screen: name, file, issues});
};
const closeModal = async () => {
  for (let k = 0; k < 4; k++) {
    const open = await page.evaluate(() => !!document.querySelector('#modal-root .modal, #modal-root [role=dialog]'));
    if (!open) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelector('#modal-root .modal-close')?.click()).catch(() => {});
    await page.waitForTimeout(200);
  }
};
const go = async v => { await closeModal(); await page.evaluate(v => document.querySelector(`button[data-view="${v}"]`)?.click(), v); await page.waitForTimeout(600); };

const DANGER = /supprim|delete|remove|reset|effac|vider|clear|logout|deconn|sign-out|purge|wipe|restore|import-file|export|download|print|share|copy|install|update-app|reload|sync-now|finish|toggle-done|complete|archive|duplicate|undo/i;

const views = ['today', 'map', 'parcels', 'work', 'herd', 'more'];
for (const v of views) {
  await go(v);
  await record(`vue ${v}`);
  // défiler la vue pour capturer le bas
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(250);
  await record(`vue ${v} bas`);
  await page.evaluate(() => window.scrollTo(0, 0));
  const actions = await page.evaluate(() => {
    const v = document.querySelector('.view.is-active') || document;
    const seen = new Set(); const out = [];
    for (const b of v.querySelectorAll('[data-action]')) {
      const r = b.getBoundingClientRect(); if (!r.width) continue;
      const key = b.dataset.action + '|' + (b.dataset.id || '') + '|' + (b.dataset.app || b.dataset.module || b.dataset.tool || b.dataset.view || '');
      const k2 = b.dataset.action + '|' + (b.dataset.app || b.dataset.module || b.dataset.tool || b.dataset.sub || b.dataset.tab || '');
      if (seen.has(k2)) continue; seen.add(k2);
      out.push({action: b.dataset.action, key, label: (b.getAttribute('aria-label') || b.textContent).trim().replace(/\s+/g, ' ').slice(0, 40)});
    }
    return out;
  });
  for (const a of actions) {
    if (n >= MAX) break;
    if (DANGER.test(a.action)) continue;
    await go(v);
    const ok = await page.evaluate(k => {
      const v = document.querySelector('.view.is-active') || document;
      const b = [...v.querySelectorAll('[data-action]')].find(b => (b.dataset.action + '|' + (b.dataset.id || '') + '|' + (b.dataset.app || b.dataset.module || b.dataset.tool || b.dataset.view || '')) === k);
      if (!b) return false; b.click(); return true;
    }, a.key);
    if (!ok) continue;
    await page.waitForTimeout(500);
    await record(`${v} › ${a.action} › ${a.label}`);
    // dans une modale : ouvrir un niveau de plus (formulaires, sous-écrans)
    const inner = await page.evaluate(() => {
      const m = document.querySelector('#modal-root .modal, #modal-root [role=dialog]'); if (!m) return [];
      const seen = new Set();
      return [...m.querySelectorAll('[data-action]')].filter(b => b.getBoundingClientRect().width && !b.classList.contains('modal-close')).map(b => ({action: b.dataset.action, label: (b.getAttribute('aria-label') || b.textContent).trim().replace(/\s+/g, ' ').slice(0, 40), idx: [...m.querySelectorAll('[data-action]')].indexOf(b)})).filter(x => !seen.has(x.action) && seen.add(x.action)).slice(0, 4);
    });
    if (inner.length && /open|show|new|add|app|module|tool|form|edit|view|tab|sub/i.test(a.action)) {
      // défiler la modale
      await page.evaluate(() => { const m = document.querySelector('#modal-root .modal-body, #modal-root .modal'); if (m) m.scrollTop = m.scrollHeight; });
      await page.waitForTimeout(150);
      await record(`${v} › ${a.action} › ${a.label} (bas)`);
      for (const x of inner) {
        if (n >= MAX || DANGER.test(x.action)) continue;
        const clicked = await page.evaluate(i => { const m = document.querySelector('#modal-root .modal, #modal-root [role=dialog]'); const b = m && m.querySelectorAll('[data-action]')[i]; if (!b) return false; b.click(); return true; }, x.idx);
        if (!clicked) continue;
        await page.waitForTimeout(450);
        await record(`${v} › ${a.label} › ${x.action} › ${x.label}`);
        // rouvrir la fenêtre parente pour le sous-niveau suivant
        await go(v);
        await page.evaluate(k => { const v = document.querySelector('.view.is-active'); const b = v && [...v.querySelectorAll('[data-action]')].find(b => (b.dataset.action + '|' + (b.dataset.id || '') + '|' + (b.dataset.app || b.dataset.module || b.dataset.tool || b.dataset.view || '')) === k); b?.click(); }, a.key);
        await page.waitForTimeout(450);
      }
    }
  }
}
await closeModal();
fs.writeFileSync(`${OUT}/rapport.json`, JSON.stringify({device: devArg, errors, report}, null, 1));
const counts = {};
for (const r of report) for (const i of r.issues) counts[i.type] = (counts[i.type] || 0) + 1;
console.log(devArg, 'captures', report.length, counts, 'erreurs', errors.length);
await browser.close();
