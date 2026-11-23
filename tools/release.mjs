#!/usr/bin/env node
// Publication en une commande (n° 148), sans dépendance et idempotent.
//   npm run release -- 10.15.0                 build aux 3 endroits, CORE/REQUIRED_ASSETS, ?v= des feuilles CSS modifiées
//                                              (index.html et feuilles différées de lazy-styles.js),
//                                              entrées CHANGELOG et whatsnew.json à compléter, puis npm test
//   npm run release -- 10.15.0 --dry-run       montre ce qui serait fait, n'écrit rien
//   npm run release -- 10.15.0 --upload-dir    prépare aussi ~/Downloads/Parcelles-a-uploader-<build>/ et son ZIP
// Options : --date AAAA-MM-JJ, --root <dossier>, --out <dossier parent du dossier d'upload>, --base <ref git>
//           (origin/main par défaut), --no-test, --no-apply (signaler les manques de CORE sans les ajouter).
// Relancer la commande avec la même version ne change plus rien : chaque étape vérifie d'abord l'état.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_EXCLUDE = [/^\.claude\//, /^\.cursor\//, /^\.kiro\//, /^CLAUDE(_RESUME)?\.md$/, /^\.github\/(copilot-instructions\.md$|hooks\/|instructions\/)/, /^node_modules\//, /^audit\//];
const VERSION_RE = /^\d+\.\d+\.\d+$/;

export function parseArgs(argv) {
  const opts = {version: '', dryRun: false, uploadDir: false, test: true, apply: true, date: '', root: path.resolve(HERE, '..'), out: path.join(os.homedir(), 'Downloads'), base: 'origin/main'};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--upload-dir') opts.uploadDir = true;
    else if (a === '--no-test') opts.test = false;
    else if (a === '--no-apply') opts.apply = false;
    else if (['--date', '--root', '--out', '--base'].includes(a)) opts[a.slice(2)] = argv[++i] || '';
    else if (!a.startsWith('--') && !opts.version) opts.version = a.replace(/^v/, '');
    else throw new Error(`Option inconnue : ${a}`);
  }
  if (!VERSION_RE.test(opts.version)) throw new Error('Version attendue au format X.Y.Z, par exemple : npm run release -- 10.15.0');
  if (opts.date && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new Error('--date attend AAAA-MM-JJ');
  opts.root = path.resolve(opts.root);
  return opts;
}

export function isoDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
// Format actuel : AAAA.MM.JJ-vX.Y.Z
export const buildString = (version, day) => `${day.replaceAll('-', '.')}-v${version}`;

// Remplacement en gardant les fins de ligne : on ne touche qu'à la valeur.
export function setBuild(files, build) {
  const out = {...files};
  out['sw.js'] = files['sw.js'].replace(/const BUILD='[^']*'/, `const BUILD='${build}'`);
  out['index.html'] = files['index.html'].replace(/(<meta name="parcelles-build" content=")[^"]*(")/, `$1${build}$2`);
  out['utils.js'] = files['utils.js'].replace(/(BUILD_ID = ')[^']*(')/, `$1${build}$2`);
  return out;
}
export const currentBuild = sw => (sw.match(/const BUILD='([^']+)'/) || [])[1] || '';

const listIn = (src, re) => { const m = src.match(re); return m ? [...m[1].matchAll(/'(\.\/[^']*)'/g)].map(x => x[1]) : []; };
export const CORE_RE = /const CORE=\[([\s\S]*?)\];/;
export const ASSETS_RE = /const REQUIRED_ASSETS = \[([\s\S]*?)\];/;

// Graphe d'imports (statiques et dynamiques) depuis app.js, comme visit() de test-static.mjs.
export function importGraph(root, entry = 'app.js') {
  const seen = new Set(), missing = [];
  const visit = rel => {
    if (seen.has(rel)) return; seen.add(rel);
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) { missing.push(rel); return; }
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]\.\/([^'"]+\.js)['"]/g)) visit(m[1]);
  };
  visit(entry);
  return {modules: [...seen], missing};
}

// Tout ce qui doit être disponible hors connexion : modules, ressources d'index.html, icônes du manifeste,
// fichiers vendor (vendor-loader.js), images et polices citées par les CSS locales, scripts du service worker.
export function requiredFiles(root) {
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  const need = new Set(['./index.html', './manifest.webmanifest']);
  const add = rel => { const clean = rel.replace(/^\.\//, '').replace(/[?#].*$/, ''); if (clean && !/^(https?:|data:|#)/.test(clean)) need.add(`./${clean}`); };
  const html = read('index.html');
  for (const m of html.matchAll(/(?:src|href)=["']\.\/([^"'#?]+)/g)) add(m[1]);
  if (fs.existsSync(path.join(root, LAZY_STYLES))) for (const {file} of lazySheets(read(LAZY_STYLES))) add(file);
  for (const m of read('manifest.webmanifest').matchAll(/"src"\s*:\s*"\.\/([^"]+)"/g)) add(m[1]);
  const graph = importGraph(root);
  for (const rel of graph.modules) add(rel);
  if (fs.existsSync(path.join(root, 'vendor-loader.js'))) for (const m of read('vendor-loader.js').matchAll(/src:\s*'\.\/([^']+)'/g)) add(m[1]);
  for (const m of read('sw.js').matchAll(/importScripts\('\.\/([^']+)'\)/g)) add(m[1]);
  for (const rel of [...need].filter(r => r.endsWith('.css'))) {
    const file = path.join(root, rel); if (!fs.existsSync(file)) continue;
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/url\(\s*['"]?\.\/([^'")]+)['"]?\s*\)/g)) add(m[1]);
  }
  for (const rel of graph.modules) { // fetch('./whatsnew.json') et consorts
    for (const m of read(rel).matchAll(/(?:fetch|fetchImpl)\(\s*['"]\.\/([^'"]+\.json)['"]/g)) add(m[1]);
  }
  return {files: [...need], missingOnDisk: [...need].filter(r => !fs.existsSync(path.join(root, r))), graphMissing: graph.missing};
}

export function coverage(root) {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const rt = fs.readFileSync(path.join(root, 'runtime.js'), 'utf8');
  const core = new Set(listIn(sw, CORE_RE)), assets = new Set(listIn(rt, ASSETS_RE));
  const req = requiredFiles(root);
  return {...req, missingCore: req.files.filter(f => !core.has(f)), missingAssets: req.files.filter(f => !assets.has(f))};
}

// Ajoute les entrées manquantes sur une nouvelle ligne juste avant « ]; » (fins de ligne conservées).
export function appendToList(src, re, entries, indent = ' ') {
  if (!entries.length) return src;
  const m = src.match(re); if (!m) throw new Error('liste introuvable');
  const eol = /\r\n/.test(m[0]) ? '\r\n' : '\n';
  const body = m[1].replace(/\s*$/, '');
  // La virgule va en tête de la nouvelle ligne : un commentaire « // … » en fin de liste l'avalerait sinon.
  const sep = body.split(/\r?\n/).pop().replace(/\/\/.*$/, '').trimEnd().endsWith(',') ? '' : ',';
  const added = `${body}${eol}${indent}${sep}/* release */${entries.map(e => `'${e}'`).join(',')}${eol}`;
  return src.replace(m[0], m[0].replace(m[1], () => added));
}

// Feuilles de style liées par index.html, dans l'ordre : [{file, v}] (v vide sans ?v=).
export const stylesheets = html => [...html.matchAll(/<link rel="stylesheet" href="\.\/([^"?]+\.css)(?:\?v=([\d.]+))?"/g)].map(m => ({file: m[1], v: m[2] || ''}));

// ?v= d'une feuille (design-v3.css par défaut), monté une seule fois par rapport à la référence.
// Une feuille liée sans ?v= en reçoit un (?v=1) ; un ?v= différent de la référence (déjà monté ou ajouté) est laissé tel quel.
export function bumpCssVersion(html, baseHtml, sheet = 'design-v3.css') {
  const href = new RegExp(`(href="\\./${sheet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?:\\?v=([\\d.]+))?"`);
  const m = html.match(href);
  if (!m) return {html, from: '', to: '', changed: false};
  const cur = m[2] || '';
  if (!cur) return {html: html.replace(href, '$1?v=1"'), from: '', to: '1', changed: true};
  const base = baseHtml ? (baseHtml.match(href) || [])[2] || '' : cur;
  if (base !== cur) return {html, from: cur, to: cur, changed: false};
  const parts = cur.split('.'); parts[parts.length - 1] = String(Number(parts.at(-1)) + 1);
  const to = parts.join('.');
  return {html: html.replace(href, `$1?v=${to}"`), from: cur, to, changed: true};
}

// Monte le ?v= de chaque feuille liée qui figure dans changed (feuilles modifiées depuis la référence).
export function bumpChangedCss(html, baseHtml, changed) {
  const done = [];
  for (const {file} of stylesheets(html)) {
    if (!changed.includes(file)) continue;
    const r = bumpCssVersion(html, baseHtml, file);
    if (r.changed) { html = r.html; done.push(`${file} ?v=${r.from || '∅'} → ${r.to}`); }
  }
  return {html, done};
}

// Feuilles liées à la demande (lazy-styles.js, hors d'index.html) : [{file, v}] lus dans LAZY_SHEETS.
export const LAZY_STYLES = 'lazy-styles.js';
export const lazySheets = src => { const m = src.match(/LAZY_SHEETS = Object\.freeze\(\{([\s\S]*?)\}\)/); return m ? [...m[1].matchAll(/'([^']+\.css)':\s*'([\d.]*)'/g)].map(x => ({file: x[1], v: x[2]})) : []; };
// Versions de référence de toutes les feuilles : index.html, puis lazy-styles.js (une feuille sortie d'index.html
// garde ainsi sa version de référence).
export const sheetVersions = (html, lazySrc) => new Map([...stylesheets(html || ''), ...lazySheets(lazySrc || '')].map(s => [s.file, s.v]));
// Même règle que bumpCssVersion, sur la constante de lazy-styles.js : monté une seule fois par rapport à la
// référence (base : Map fichier → version, sheetVersions ; absente, la version actuelle sert de référence).
export function bumpLazySheets(src, base, changed) {
  const done = [];
  base ||= new Map(lazySheets(src).map(s => [s.file, s.v]));
  for (const {file, v} of lazySheets(src)) {
    if (!changed.includes(file)) continue;
    let to = '1';
    if (v) {
      if (base.get(file) !== v) continue; // déjà monté depuis la référence, ou feuille ajoutée depuis
      const parts = v.split('.'); parts[parts.length - 1] = String(Number(parts.at(-1)) + 1); to = parts.join('.');
    }
    src = src.replace(new RegExp(`('${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*')[\\d.]*'`), (_, head) => `${head}${to}'`);
    done.push(`${file} ?v=${v || '∅'} → ${to}`);
  }
  return {src, done};
}

export function changelogEntry(md, version, day) {
  if (new RegExp(`^## ${version.replaceAll('.', '\\.')}\\b`, 'm').test(md)) return {md, changed: false};
  const eol = /\r\n/.test(md) ? '\r\n' : '\n';
  const entry = [`## ${version} · À COMPLÉTER — ${day}`, '', '- À COMPLÉTER : ce que voit l’utilisateur.', '', ''].join(eol);
  const at = md.search(/^## /m);
  return {md: at < 0 ? `${md}${eol}${entry}` : md.slice(0, at) + entry + md.slice(at), changed: true};
}

export function whatsNewEntry(json, version, day) {
  const data = JSON.parse(json);
  if (data.versions.some(v => v.version === version)) return {json, changed: false};
  data.versions.unshift({version, date: day, title: 'À COMPLÉTER', items: ['À COMPLÉTER (1).', 'À COMPLÉTER (2).', 'À COMPLÉTER (3).']});
  return {json: `${JSON.stringify(data, null, 2)}\n`, changed: true};
}

// Fichiers à téléverser : différences avec la référence (fins de ligne ignorées) + fichiers non suivis.
export function uploadPlan(root, base = 'origin/main') {
  const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 64 << 20});
  const excluded = rel => UPLOAD_EXCLUDE.some(re => re.test(rel));
  const changed = new Set(), deleted = [];
  for (const line of git(['diff', '--name-status', '--no-renames', base]).split('\n').filter(Boolean)) {
    const [status, rel] = line.split('\t');
    if (excluded(rel)) continue;
    // Un fichier non suivi (nouveau module pas encore commité) apparaît « D » face à la référence : il existe, on le garde.
    if (status === 'D') { if (!fs.existsSync(path.join(root, rel))) deleted.push(rel); continue; }
    // --name-status ne tient pas compte de --ignore-cr-at-eol : on vérifie le contenu du diff.
    if (status === 'M' && !/^@@/m.test(git(['diff', '--ignore-cr-at-eol', base, '--', rel]))) continue;
    changed.add(rel);
  }
  for (const rel of git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) if (!excluded(rel)) changed.add(rel);
  return {files: [...changed].sort(), deleted: deleted.sort()};
}

export async function writeUpload(root, plan, dest) {
  const {createZip} = await import(pathToFileURL(path.join(HERE, '..', 'zip-lite.js')).href);
  fs.rmSync(dest, {recursive: true, force: true});
  const entries = [];
  for (const rel of plan.files) {
    const target = path.join(dest, rel);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(path.join(root, rel), target);
    entries.push({name: rel, data: new Uint8Array(fs.readFileSync(path.join(root, rel)))});
  }
  const zip = await createZip(entries);
  const zipPath = `${dest}.zip`;
  fs.writeFileSync(zipPath, Buffer.from(await zip.arrayBuffer()));
  return zipPath;
}

export async function release(opts, log = console.log) {
  const {root, version, dryRun} = opts;
  const day = opts.date || isoDay();
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  const write = (rel, text) => { if (!dryRun) fs.writeFileSync(path.join(root, rel), text); };
  const report = {changes: [], warnings: []};
  const note = msg => { report.changes.push(msg); log(`${dryRun ? '[essai] ' : ''}${msg}`); };
  const warn = msg => { report.warnings.push(msg); log(`! ${msg}`); };

  // 1. BUILD : on garde la date du build existant si la version est déjà la bonne (idempotence).
  const prev = currentBuild(read('sw.js'));
  const build = prev.endsWith(`-v${version}`) && !opts.date ? prev : buildString(version, day);
  report.build = build;
  const files = {'sw.js': read('sw.js'), 'index.html': read('index.html'), 'utils.js': read('utils.js')};
  const next = setBuild(files, build);
  for (const rel of Object.keys(files)) if (next[rel] !== files[rel]) { write(rel, next[rel]); note(`BUILD ${build} écrit dans ${rel}`); }

  // 2. Couverture CORE / REQUIRED_ASSETS.
  const cov = coverage(root);
  for (const rel of cov.missingOnDisk) warn(`${rel} est référencé mais absent du dépôt`);
  const coreAdd = cov.missingCore.filter(r => !cov.missingOnDisk.includes(r));
  const assetsAdd = cov.missingAssets.filter(r => !cov.missingOnDisk.includes(r));
  if (coreAdd.length) {
    if (opts.apply) { write('sw.js', appendToList(dryRun ? next['sw.js'] : read('sw.js'), CORE_RE, coreAdd)); note(`CORE complété : ${coreAdd.join(', ')}`); }
    else warn(`à ajouter au CORE de sw.js : ${coreAdd.join(', ')}`);
  }
  if (assetsAdd.length) {
    if (opts.apply) { write('runtime.js', appendToList(read('runtime.js'), ASSETS_RE, assetsAdd, '  ')); note(`REQUIRED_ASSETS complété : ${assetsAdd.join(', ')}`); }
    else warn(`à ajouter à REQUIRED_ASSETS de runtime.js : ${assetsAdd.join(', ')}`);
  }

  // 3. ?v= de chaque feuille de style modifiée depuis la référence, monté une seule fois.
  const indexHtml = dryRun ? next['index.html'] : read('index.html');
  const lazySrc = fs.existsSync(path.join(root, LAZY_STYLES)) ? read(LAZY_STYLES) : '';
  let baseHtml = '', baseLazy = '', cssChanged = [];
  try {
    baseHtml = execFileSync('git', ['show', `${opts.base}:index.html`], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20});
    try { baseLazy = execFileSync('git', ['show', `${opts.base}:${LAZY_STYLES}`], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20}); } catch { baseLazy = ''; }
    const sheets = [...stylesheets(indexHtml), ...lazySheets(lazySrc)].map(s => s.file);
    cssChanged = sheets.filter(file => !!execFileSync('git', ['diff', '--ignore-cr-at-eol', opts.base, '--', file], {cwd: root, encoding: 'utf8', maxBuffer: 64 << 20}).trim());
  } catch { cssChanged = []; warn(`référence ${opts.base} introuvable : vérifier à la main les ?v= des feuilles de style`); }
  if (cssChanged.length) {
    const css = bumpChangedCss(indexHtml, baseHtml, cssChanged);
    if (css.done.length) { write('index.html', css.html); note(`?v= montés : ${css.done.join(', ')}`); }
    // Feuilles différées : version de référence lue dans lazy-styles.js, ou dans index.html si elles y étaient liées.
    const lazy = bumpLazySheets(lazySrc, sheetVersions(baseHtml, baseLazy), cssChanged);
    if (lazy.done.length) { write(LAZY_STYLES, lazy.src); note(`?v= montés (${LAZY_STYLES}) : ${lazy.done.join(', ')}`); }
  }

  // 4. Entrées à compléter.
  const cl = changelogEntry(read('CHANGELOG.md'), version, day);
  if (cl.changed) { write('CHANGELOG.md', cl.md); note(`CHANGELOG.md : entrée ${version} préparée`); }
  const wn = whatsNewEntry(read('whatsnew.json'), version, day);
  if (wn.changed) { write('whatsnew.json', wn.json); note(`whatsnew.json : entrée ${version} préparée`); }
  if (/À COMPLÉTER/.test(dryRun ? cl.md + wn.json : read('CHANGELOG.md') + read('whatsnew.json'))) warn('CHANGELOG.md et whatsnew.json contiennent encore « À COMPLÉTER »');
  if (!report.changes.length) log('Rien à changer : la publication est déjà prête.');

  // 5. Tests.
  if (opts.test && !dryRun) {
    log('npm test…');
    const run = spawnSync('npm', ['test'], {cwd: root, stdio: 'inherit', env: process.env});
    report.testsOk = run.status === 0;
    if (!report.testsOk) warn('npm test a échoué');
  }

  // Dossier à téléverser.
  if (opts.uploadDir) {
    const plan = uploadPlan(root, opts.base);
    report.upload = plan;
    const dest = path.join(opts.out, `Parcelles-a-uploader-${build}`);
    log(`${plan.files.length} fichier(s) différent(s) de ${opts.base} :`);
    for (const rel of plan.files) log(`  + ${rel}`);
    if (plan.deleted.length) { log(`À supprimer à la main sur GitHub (${plan.deleted.length}) :`); for (const rel of plan.deleted) log(`  - ${rel}`); }
    if (!dryRun) { report.zip = await writeUpload(root, plan, dest); log(`Dossier : ${dest}\nZIP : ${report.zip}`); }
    else log(`[essai] dossier non créé : ${dest}`);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await release(parseArgs(process.argv.slice(2)));
    process.exitCode = report.testsOk === false ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
