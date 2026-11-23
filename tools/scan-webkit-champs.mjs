// Contrôle des champs qui dépassent sous WebKit (moteur de Safari iOS) : formulaires de facturation, travail, tâche.
// Usage : node tools/scan-webkit-champs.mjs http://localhost:8093/index.html <dossier>
import {webkit, devices} from 'playwright';
import fs from 'node:fs';
import {seedDemoFarm} from './seed-demo.mjs';
import {semerFacturation} from '../tests-visual/semis-facturation.mjs';
const URL = process.argv[2] || 'http://localhost:8080/index.html';
const OUT = process.argv[3] || '/tmp/wk';
fs.mkdirSync(OUT, {recursive: true});
const browser = await webkit.launch();
const ctx = await browser.newContext({...devices['iPhone 14'], locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block'});
const page = await ctx.newPage();
await page.goto(URL, {waitUntil: 'load'});
await page.evaluate(seedDemoFarm);
await page.evaluate(semerFacturation);
await page.reload({waitUntil: 'load'});
await page.waitForFunction(() => document.documentElement.dataset.appReady === '1', null, {timeout: 20000});
const fire = d => page.evaluate(d => { const b = document.createElement('button'); b.type = 'button'; Object.assign(b.dataset, d); b.hidden = true; document.body.append(b); b.click(); setTimeout(() => b.remove()); }, d);
const close = () => page.evaluate(() => document.querySelectorAll('#modal-root .modal-close').forEach(b => b.click()));
const measure = () => page.evaluate(() => {
  const m = document.querySelector('#modal-root .modal'); if (!m) return ['pas de modale'];
  const mr = m.getBoundingClientRect(); const out = [];
  for (const el of m.querySelectorAll('input,select,textarea,fieldset,.chip-row,.form-grid')) {
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    const p = el.parentElement.getBoundingClientRect();
    if (r.right > p.right + 1.5 || r.right > mr.right - 8) out.push(`${el.tagName.toLowerCase()}${el.type ? '[' + el.type + ']' : ''}#${el.id || ''}.${[...el.classList].join('.')} right=${Math.round(r.right)} parent=${Math.round(p.right)} modale=${Math.round(mr.right)}`);
  }
  return out;
});
const cases = [
  ['facture', {bdoc: 'list', type: 'facture'}, 'Nouvelle facture'],
  ['devis', {bdoc: 'list', type: 'devis'}, 'Nouveau devis'],
  ['travail', {action: 'new-work'}],
  ['tache', {action: 'new-task'}],
];
for (const [name, d, bouton] of cases) {
  await close(); await page.waitForTimeout(300);
  await fire(d); await page.waitForTimeout(1500);
  if (bouton) {
    await page.locator('#modal-root .modal-footer').getByRole('button', {name: bouton}).click(); await page.waitForTimeout(700);
    await page.locator('#modal-root [data-bdoc="client-pick"]').first().click(); await page.waitForTimeout(900);
  }
  const shots = [];
  // défiler la modale par paliers et mesurer partout
  const res = new Set();
  for (let k = 0; k < 6; k++) {
    for (const x of await measure()) res.add(x);
    await page.screenshot({path: `${OUT}/${name}-${k}.png`});
    const more = await page.evaluate(() => { const b = document.querySelector('#modal-root .modal-body'); if (!b) return false; const before = b.scrollTop; b.scrollTop += b.clientHeight * .8; return b.scrollTop > before; });
    if (!more) break;
    await page.waitForTimeout(150);
  }
  console.log(`== ${name} : ${res.size} dépassement(s)`); for (const x of res) console.log('  ' + x);
}
await browser.close();
