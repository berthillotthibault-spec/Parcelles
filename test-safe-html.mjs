import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {html, raw, isSafeHtml, escapeText} from './safe-html.js';

test('toute interpolation est échappée', () => {
  const name = '<img src=x onerror=alert(1)>';
  assert.equal(String(html`<td>${name}</td>`), '<td>&lt;img src=x onerror=alert(1)&gt;</td>');
  assert.equal(String(html`<a title="${'" onmouseover="x'}">`), '<a title="&quot; onmouseover=&quot;x">');
  assert.equal(escapeText("'`&"), '&#39;&#96;&amp;');
});

test('raw, imbrication, tableaux et valeurs vides', () => {
  const rows = ['a<b', 'c'].map(x => html`<li>${x}</li>`);
  assert.equal(`${html`<ul>${rows}</ul>`}`, '<ul><li>a&lt;b</li><li>c</li></ul>');
  assert.equal(String(html`${raw('<b>ok</b>')}`), '<b>ok</b>');
  assert.equal(String(html`[${null}${undefined}${false}${0}]`), '[0]');
  assert.ok(isSafeHtml(html``));
  assert.equal(raw(html`<i>x</i>`).toString(), '<i>x</i>');
});

test('écrans à risque branchés sur le gabarit', () => {
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const io = fs.readFileSync(new URL('./import-export.js', import.meta.url), 'utf8');
  assert.match(app, /box\.innerHTML=html`/, 'réponse de l’assistant distant');
  assert.match(io, /sample\.map\(row=>html`/, 'aperçu des noms importés');
});

test('CSP réelle mais permissive dans index.html, journal des violations', () => {
  const page = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const csp = page.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
  assert.ok(csp, 'meta CSP présente');
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.doesNotMatch(csp, /frame-ancestors|report-uri|script-src|connect-src|img-src/, 'pas de directive ignorée en meta ni de liste d’origines qui casserait Firebase ou les tuiles');
  const diag = fs.readFileSync(new URL('./diagnostics.js', import.meta.url), 'utf8');
  assert.match(diag, /securitypolicyviolation/);
});
