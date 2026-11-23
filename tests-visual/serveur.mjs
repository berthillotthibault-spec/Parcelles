// Serveur statique des tests visuels (n° 146), lancé par playwright.config.mjs (webServer).
// Port par défaut 8310, modifiable par PORT_VISUEL.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startStaticServer} from '../tools/static-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {origin} = await startStaticServer(root, {port: Number(process.env.PORT_VISUEL || 8310)});
console.log(`Tests visuels : ${origin}/index.html`);
