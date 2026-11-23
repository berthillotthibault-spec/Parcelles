// Bombes à retardement (n° 160) : relance les tests de `npm test` avec l'horloge avancée de 400 puis 800 jours.
// Un test qui dépend de la date réelle (isoDay(), new Date()) face à des dates codées en dur échoue ici
// des mois avant de casser la CI. Usage : node tools/test-horloge.mjs [jours ...]
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.test;
const files = script.match(/test-[\w-]+\.mjs/g) || [];
const shifts = process.argv.slice(2).map(Number).filter(Number.isFinite);
let failed = false;
for (const days of shifts.length ? shifts : [400, 800]) {
  const run = spawnSync(process.execPath, ['--import', './tools/clock-shift.mjs', '--test', ...files], {cwd: ROOT, env: {...process.env, SHIFT_DAYS: String(days)}, encoding: 'utf8'});
  const out = `${run.stdout}${run.stderr}`, fails = out.split('\n').filter(l => l.startsWith('✖') && !l.includes('failing tests'));
  const pass = /ℹ pass (\d+)/.exec(out)?.[1] || '?';
  console.log(`Horloge +${days} j : ${pass} réussis, ${fails.length} en échec`);
  if (run.status !== 0) { failed = true; for (const l of [...new Set(fails)]) console.log(`  ${l}`); }
}
process.exit(failed ? 1 : 0);
