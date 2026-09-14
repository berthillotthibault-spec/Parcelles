import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const rel of ['css/base.css','css/components.css','css/map.css','css/responsive.css','js/app.js','manifest.webmanifest']){
  assert.ok(html.includes(`./${rel}`),`index.html doit référencer ./${rel}`);
  assert.ok(fs.existsSync(path.join(root,rel)),`${rel} doit exister`);
}
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
for(const rel of ['./js/app.js','./js/import-export.js','./css/base.css'])assert.ok(sw.includes(rel),`SW doit référencer ${rel}`);
const whole=fs.readdirSync(path.join(root,'js')).filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n');
assert.ok(!/\bV1\b|\bV2\b/.test(whole),'Le code livré ne doit pas utiliser de comparaison de versions historiques.');
console.log('✓ Arborescence canonique et références statiques validées.');
