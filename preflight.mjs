import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const refs=[...index.matchAll(/(?:src|href)=["'](\.\/[^"'#?]+)(?:\?[^"']*)?["']/g)].map(m=>m[1]);
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const swRefs=[...sw.matchAll(/["'](\.\/[^"']+)["']/g)].map(m=>m[1]).filter(x=>!x.includes('${'));
const all=[...new Set([...refs,...swRefs])];
const missing=[];
for(const ref of all){const rel=ref.replace(/^\.\//,'');if(rel===''||rel==='/')continue;const target=path.join(root,rel);if(!fs.existsSync(target))missing.push(ref);}
const duplicates=[];
for(const folder of ['js','css']){for(const name of fs.readdirSync(path.join(root,folder))){if(/\(\d+\)|\.bak$| copy/i.test(name))duplicates.push(`${folder}/${name}`);}}
if(missing.length||duplicates.length){console.error('Préflight échoué.');if(missing.length)console.error('Ressources manquantes:',missing);if(duplicates.length)console.error('Fichiers non canoniques:',duplicates);process.exit(1);}
console.log(`✓ Préflight déploiement : ${all.length} ressources vérifiées, aucune copie ambiguë.`);
