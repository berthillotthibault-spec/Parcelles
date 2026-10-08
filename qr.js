// Encodeur QR code en JS pur, sans dépendance (idée n° 11).
// Mode octet (UTF-8), correction d’erreur M (~15 %), versions 1 à 40 (une URL tient en version 4 à 7),
// masque choisi par la pénalité normalisée (ISO/IEC 18004). modules[y][x] = true pour un module sombre.

const ECC_M_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const ECC_M_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const ECC_M_FORMAT = 0; // bits de niveau : L = 01, M = 00, Q = 11, H = 10

// ---- Corps de Galois GF(2^8), polynôme 0x11D ----
export function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
  return z & 0xFF;
}
function rsDivisor(degree) {
  const result = new Array(degree).fill(0); result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) { result[j] = gfMul(result[j], root); if (j + 1 < result.length) result[j] ^= result[j + 1]; }
    root = gfMul(root, 0x02);
  }
  return result;
}
// Codes correcteurs Reed-Solomon de `data` (tableau d’octets) sur `degree` octets.
export function rsEncode(data, degree) {
  const divisor = rsDivisor(degree), result = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift(); result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

const rawModules = ver => { let r = (16 * ver + 128) * ver + 64; if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; } return r; };
export const dataCapacity = ver => Math.floor(rawModules(ver) / 8) - ECC_M_PER_BLOCK[ver] * ECC_M_BLOCKS[ver];
// Octets utiles en mode octet pour une version (en-tête de 4 + 8 ou 16 bits).
export const byteCapacity = ver => Math.floor((dataCapacity(ver) * 8 - 4 - (ver < 10 ? 8 : 16)) / 8);

export function alignmentPositions(ver) {
  if (ver === 1) return [];
  const size = ver * 4 + 17, n = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2, out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}
// 15 bits d’information de format (niveau M + masque), déjà masqués par 0x5412.
export function formatBits(mask, level = ECC_M_FORMAT) {
  const data = (level << 3) | mask; let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
// 18 bits d’information de version (versions 7 et plus).
export function versionBits(ver) {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
  return (ver << 12) | rem;
}

function utf8(text) {
  if (typeof TextEncoder !== 'undefined') return [...new TextEncoder().encode(String(text))];
  return [...unescape(encodeURIComponent(String(text)))].map(c => c.charCodeAt(0));
}

// Bits de données + remplissage, puis découpage en blocs et entrelacement avec les codes correcteurs.
export function codewords(bytes, ver) {
  const capacity = dataCapacity(ver) * 8, bits = [];
  const put = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0x4, 4); put(bytes.length, ver < 10 ? 8 : 16); for (const b of bytes) put(b, 8);
  if (bits.length > capacity) throw new RangeError('Texte trop long pour cette version.');
  put(0, Math.min(4, capacity - bits.length)); put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const blocksCount = ECC_M_BLOCKS[ver], eccLen = ECC_M_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8);
  const shortCount = blocksCount - raw % blocksCount, shortLen = Math.floor(raw / blocksCount), blocks = [];
  for (let i = 0, k = 0; i < blocksCount; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortCount ? 0 : 1)); k += dat.length;
    const ecc = rsEncode(dat, eccLen); if (i < shortCount) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((block, j) => { if (i !== shortLen - eccLen || j >= shortCount) out.push(block[i]); });
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
  (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0
];

function baseMatrix(ver) {
  const size = ver * 4 + 17, m = Array.from({length: size}, () => new Array(size).fill(false)), fn = Array.from({length: size}, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  const align = alignmentPositions(ver), last = align.length - 1;
  align.forEach((ay, i) => align.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  drawFormat(m, fn, 0, size);
  if (ver >= 7) {
    const bits = versionBits(ver);
    for (let i = 0; i < 18; i++) { const dark = ((bits >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3); set(a, b, dark); set(b, a, dark); }
  }
  return {size, m, fn};
}
function drawFormat(m, fn, mask, size) {
  const bits = formatBits(mask), bit = i => ((bits >>> i) & 1) === 1;
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}
function placeData(m, fn, data, size) {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (!fn[y][x] && i < data.length * 8) { m[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
}

// Pénalité du masque : séries de 5+, blocs 2×2, motifs 1:1:3:1:1, équilibre clair/sombre.
export function penalty(m) {
  const size = m.length; let score = 0, dark = 0;
  const line = get => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else { if (run >= 5) score += 3 + run - 5; run = 1; }
    }
    const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let i = 0; i + 11 <= size; i++) {
      let a = true, b = true;
      for (let k = 0; k < 11; k++) { const v = get(i + k) ? 1 : 0; if (v !== A[k]) a = false; if (v !== B[k]) b = false; }
      if (a) score += 40; if (b) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line(x => m[y][x]);
  for (let x = 0; x < size; x++) line(y => m[y][x]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (m[y][x]) dark++;
    if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  }
  const total = size * size;
  return score + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
}

export function encodeQR(text, {minVersion = 1, maxVersion = 40, mask: forcedMask = null} = {}) {
  const bytes = utf8(text);
  let ver = Math.max(1, minVersion);
  while (ver <= maxVersion && byteCapacity(ver) < bytes.length) ver++;
  if (ver > maxVersion) throw new RangeError('Texte trop long pour un QR code.');
  const data = codewords(bytes, ver), {size, m, fn} = baseMatrix(ver);
  placeData(m, fn, data, size);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    if (forcedMask !== null && mask !== forcedMask) continue;
    const grid = m.map((row, y) => row.map((v, x) => fn[y][x] ? v : v !== MASKS[mask](x, y)));
    drawFormat(grid, fn.map(r => [...r]), mask, size);
    const score = penalty(grid);
    if (!best || score < best.score) best = {mask, score, modules: grid};
  }
  return {version: ver, size, mask: best.mask, modules: best.modules};
}

// SVG autonome (zone de silence de 4 modules), net à toutes les tailles.
export function qrSvg(text, {margin = 4, size = null, label = '', dark = '#000', light = '#fff'} = {}) {
  const q = encodeQR(text), n = q.size + margin * 2, parts = [];
  q.modules.forEach((row, y) => { let x = 0; while (x < q.size) { if (!row[x]) { x++; continue; } let w = 1; while (x + w < q.size && row[x + w]) w++; parts.push(`M${x + margin} ${y + margin}h${w}v1h-${w}z`); x += w; } });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}"${size ? ` width="${size}" height="${size}"` : ''} shape-rendering="crispEdges" role="img" aria-label="${esc(label || 'QR code')}"><rect width="${n}" height="${n}" fill="${light}"/><path fill="${dark}" d="${parts.join('')}"/></svg>`;
}

// Bandes horizontales de modules sombres : [x, y, largeur], pour un dessin vectoriel (PDF).
export function qrRuns(modules) {
  const out = [];
  modules.forEach((row, y) => { let x = 0; while (x < row.length) { if (!row[x]) { x++; continue; } let w = 1; while (x + w < row.length && row[x + w]) w++; out.push([x, y, w]); x += w; } });
  return out;
}
