// Petit serveur statique sans dépendance pour les outils Playwright (n° 149, n° 150) :
// sert la racine du dépôt sans cache, sur un port libre, avec une réécriture facultative du contenu.
// Textes compressés en gzip quand le navigateur l'accepte, comme GitHub Pages : sans cela, le budget de performance
// mesurait 2,7 Mo de JavaScript au démarrage au lieu des 957 Ko réellement transférés. gzip:false pour s'en passer.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'};

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg']);

export async function startStaticServer(root, {port = Number(process.env.PORT || 0), rewrite = null, gzip = true} = {}) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    let body = fs.readFileSync(file);
    const changed = rewrite?.(rel, body);
    if (changed != null) body = Buffer.from(changed);
    const headers = {'content-type': `${TYPES[path.extname(file)] || 'application/octet-stream'};charset=utf-8`, 'cache-control': 'no-store'};
    if (gzip && COMPRESSIBLE.has(path.extname(file)) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = zlib.gzipSync(body, {level: 6}); headers['content-encoding'] = 'gzip'; headers.vary = 'Accept-Encoding';
    }
    res.writeHead(200, headers);
    res.end(body);
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const origin = `http://localhost:${server.address().port}`;
  return {origin, url: `${origin}/index.html`, close: () => new Promise(resolve => server.close(resolve))};
}
