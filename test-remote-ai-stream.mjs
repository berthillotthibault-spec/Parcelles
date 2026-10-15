// n° 104 — Assistant distant : parseur de flux, repli JSON et contexte élargi.
import test from 'node:test';
import assert from 'node:assert/strict';
import {streamFormat, createStreamParser, askRemoteAssistant, buildAssistantContext, weatherSummary} from './remote-ai.js';

globalThis.location??={href:'https://exemple.test/'};

test('streamFormat reconnaît SSE, NDJSON, JSON et texte', () => {
  assert.equal(streamFormat('text/event-stream; charset=utf-8'), 'sse');
  assert.equal(streamFormat('application/x-ndjson'), 'ndjson');
  assert.equal(streamFormat('application/json'), 'json');
  assert.equal(streamFormat('text/plain'), 'text');
  assert.equal(streamFormat(undefined), 'text');
});

test('SSE : morceaux coupés au milieu d’une ligne, commentaires et [DONE]', () => {
  const p = createStreamParser('sse');
  assert.equal(p.push(': ping\n\ndata: {"delta":"Bon'), false);
  assert.equal(p.push('jour"}\n\n'), true);
  assert.equal(p.text, 'Bonjour');
  p.push('data: {"delta":" à vous"}\r\n\r\ndata: {"actions":[{"type":"open_map","label":"Carte"}]}\n\ndata: [DONE]\n\n');
  const out = p.end();
  assert.equal(out.answer, 'Bonjour à vous');
  assert.equal(out.actions.length, 1);
});

test('SSE : données multilignes et texte non JSON', () => {
  const p = createStreamParser('sse');
  p.push('data: ligne 1\ndata: ligne 2\n\n');
  p.push('data: {"delta":{"text":"!"}}');
  assert.equal(p.end().answer, 'ligne 1\nligne 2!');
});

test('NDJSON : deltas puis réponse complète qui remplace', () => {
  const p = createStreamParser('ndjson');
  p.push('{"delta":"Par"}\n{"del');
  p.push('ta":"celle"}\n');
  assert.equal(p.text, 'Parcelle');
  p.push('{"answer":"Texte final","actions":[]}');
  assert.equal(p.end().answer, 'Texte final');
});

test('texte brut progressif et JSON complet servi en text/plain', () => {
  const p = createStreamParser('text');
  p.push('Il ');p.push('pleut.');
  assert.equal(p.end().answer, 'Il pleut.');
  const j = createStreamParser('text');
  j.push('{"answer":"OK","actions":[{"type":"search"}]}');
  assert.deepEqual(j.end(), {answer:'OK', actions:[{type:'search'}]});
});

test('erreur signalée dans le flux et longueur bornée', () => {
  const p = createStreamParser('ndjson');
  p.push('{"error":{"message":"quota"}}\n');
  assert.throws(() => p.end(), /quota/);
  const long = createStreamParser('text', {maxLength:5});
  long.push('abcdefgh');
  assert.equal(long.end().answer, 'abcde');
});

function streamResponse(chunks, type) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({start(c){for(const x of chunks)c.enqueue(enc.encode(x));c.close();}}), {headers:{'content-type':type}});
}

test('askRemoteAssistant diffuse le texte et filtre les actions', async () => {
  const seen = [];let sent;
  const result = await askRemoteAssistant({endpoint:'https://ia.exemple.test/', question:'Bonjour', state:{}, onDelta:t=>seen.push(t),
    fetchImpl:async (url, init) => {sent = JSON.parse(init.body);return streamResponse(['data: {"delta":"Bon"}\n\n', 'data: {"delta":"jour"}\n\ndata: {"actions":[{"type":"create_work","label":"Créer"},{"type":"delete_all"}]}\n\n'], 'text/event-stream');}});
  assert.equal(sent.stream, true);
  assert.deepEqual(seen, ['Bon', 'Bonjour']);
  assert.equal(result.answer, 'Bonjour');
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].requiresConfirmation, true);
});

test('askRemoteAssistant : repli sur la réponse JSON complète', async () => {
  let deltas = 0;
  const result = await askRemoteAssistant({endpoint:'https://ia.exemple.test/', question:'Bonjour', state:{}, onDelta:()=>deltas++,
    fetchImpl:async () => new Response(JSON.stringify({answer:'Réponse', actions:[{type:'open_map'}]}), {headers:{'content-type':'application/json'}})});
  assert.equal(result.answer, 'Réponse');
  assert.equal(result.actions.length, 1);
  assert.equal(deltas, 0);
  const plain = await askRemoteAssistant({endpoint:'https://ia.exemple.test/', question:'Bonjour', state:{},
    fetchImpl:async (url, init) => {assert.equal(JSON.parse(init.body).stream, false);return new Response('{"text":"Ancien format"}', {headers:{'content-type':'application/json'}});}});
  assert.equal(plain.answer, 'Ancien format');
  await assert.rejects(askRemoteAssistant({endpoint:'https://ia.exemple.test/', question:'x', state:{}, onDelta:()=>{}, fetchImpl:async () => streamResponse([''], 'text/plain')}), /aucune réponse/);
});

test('weatherSummary : cache de moins de 72 h, 3 jours à venir', () => {
  const now = Date.parse('2026-10-15T08:00:00Z');
  const cache = {loadedAt:now - 3600e3, current:{temperature_2m:12, wind_speed_10m:9}, daily:{time:['2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18'], temperature_2m_min:[1,2,3,4,5], temperature_2m_max:[11,12,13,14,15], precipitation_sum:[0,1.5,null,0,0]}};
  const w = weatherSummary(cache, {now});
  assert.deepEqual(w.days.map(d => d.date), ['2026-10-15','2026-10-16','2026-10-17']);
  assert.equal(w.days[0].rainMm, 1.5);
  assert.equal(w.days[1].rainMm, null);
  assert.equal(weatherSummary({...cache, loadedAt:now - 73 * 3600e3}, {now}), null);
  assert.equal(weatherSummary(null, {now}), null);
});

test('contexte élargi : lots au pré, récoltes, chantiers TP, stocks sous le seuil, météo, avec filtrage', () => {
  const now = new Date(2026, 8, 15, 10).getTime(), today = '2026-09-15';
  const state = {
    parcelles:[{id:'p1', nom:'Grand Pré', surfaceHa:3}],
    grazingSessions:[{id:'g1', parcelId:'p1', startDate:'2020-01-01', animalsCount:12, type:'Vaches'}, {id:'g2', parcelId:'p1', startDate:'2020-01-01', endDate:'2020-02-01', animalsCount:3}],
    integrationImports:[{id:'h1', farmKind:'harvest', code:'L1', crop:' Blé ', parcelId:'p1', date:today, quantity:10, unit:'t'}, {id:'h2', farmKind:'harvest', code:'L0', parcelId:'p1', date:'2001-08-01', quantity:5, unit:'t'}],
    chantiers:[{id:'c1', kind:'tp', type:'Fossé', status:'En cours'}, {id:'c2', kind:'tp', type:'Ancien', status:'Terminé'}, {id:'c3', type:'Ensilage'}],
    stockItems:[{id:'s1', name:'Engrais', quantity:2, alertBelow:5}, {id:'s2', name:'Semence', quantity:9, alertBelow:5}, {id:'s3', name:'Sans seuil', quantity:0}]
  };
  const weather = {loadedAt:now, current:{temperature_2m:10}, daily:{time:[today], temperature_2m_min:[2], temperature_2m_max:[12]}};
  const all = buildAssistantContext(state, {weather, now});
  assert.equal(all.campaign, '2026/27');
  assert.deepEqual(all.grazing.map(g => [g.id, g.parcel, g.animals]), [['g1', 'Grand Pré', 12]]);
  assert.deepEqual(all.harvests.map(h => [h.code, h.culture]), [['L1', 'Blé']]);
  assert.deepEqual(all.publicWorks.map(c => c.name), ['Fossé']);
  assert.deepEqual(all.lowStocks.map(s => s.name), ['Engrais']);
  assert.equal(all.weather.days.length, 1);
  const filtered = buildAssistantContext(state, {question:'Quels stocks sont faibles ?', weather, now});
  assert.equal(filtered.grazing.length, 0);
  assert.equal(filtered.harvests.length, 0);
  assert.equal(filtered.publicWorks.length, 0);
  assert.equal(filtered.weather, null);
  assert.deepEqual(filtered.lowStocks.map(s => s.name), ['Engrais']);
  const meteo = buildAssistantContext(state, {question:'Quelle météo pour traiter ?', weather, now});
  assert.equal(meteo.weather.days.length, 1);
  const pature = buildAssistantContext(state, {question:'Quels lots sont au pré ?', weather, now});
  assert.equal(pature.grazing.length, 1);
  assert.equal(buildAssistantContext(state, {question:'chantier TP en cours'}).publicWorks.length, 1);
});

test('Worker d’exemple : hors CORE, origine vérifiée, flux relayé lisible par le parseur', async () => {
  const fs = await import('node:fs');
  assert.doesNotMatch(fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8'), /worker-assistant/);
  const {default: worker} = await import('./tools/worker-assistant.example.js');
  const env = {ANTHROPIC_API_KEY:'cle-de-test', ALLOWED_ORIGINS:'https://ok.test'};
  const req = (origin, body) => new Request('https://w.test/', {method:'POST', headers:{origin, 'content-type':'application/json'}, body:JSON.stringify(body)});
  assert.equal((await worker.fetch(req('https://pirate.test', {}), env)).status, 403);
  const realFetch = globalThis.fetch;let sent;
  globalThis.fetch = async (url, init) => {sent = {url, init:{...init, body:JSON.parse(init.body)}};
    return streamResponse(['event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Deux "}}\n\n', 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lots."}}\n\ndata: {"type":"message_stop"}\n\n'], 'text/event-stream');};
  try {
    const res = await worker.fetch(req('https://ok.test', {client:'Parcelles', mode:'assistant-v7.0', question:'Lots au pré ?', context:{}, stream:true}), env);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://ok.test');
    assert.equal(sent.init.headers['x-api-key'], 'cle-de-test');
    assert.equal(sent.init.body.stream, true);
    assert.match(sent.init.body.system, /source explicite/);
    const p = createStreamParser(streamFormat(res.headers.get('content-type')));
    p.push(await res.text());
    assert.deepEqual(p.end(), {answer:'Deux lots.', actions:[]});
  } finally {globalThis.fetch = realFetch;}
});

test('repli JSON en text/plain : corps de plus de 6000 caractères, actions conservées, rien affiché en flux', () => {
  const body = JSON.stringify({answer:'x'.repeat(5990), actions:[{type:'open_map', label:'Carte'}]});
  const p = createStreamParser('text');
  assert.equal(p.push(body.slice(0, 3000)), false);
  assert.equal(p.push(body.slice(3000)), false);
  assert.equal(p.text, '');
  const out = p.end();
  assert.equal(out.answer, 'x'.repeat(5990));
  assert.equal(out.actions.length, 1);
  const t = createStreamParser('text');
  assert.equal(t.push('Bonjour'), true);
  assert.equal(t.end().answer, 'Bonjour');
  const broken = createStreamParser('text');
  broken.push('{pas du json');
  assert.equal(broken.end().answer, '{pas du json');
});

test('météo : jour courant en heure locale, même près de minuit', () => {
  const now = new Date(2026, 9, 15, 23, 30).getTime();
  const cache = {loadedAt:now, daily:{time:['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']}};
  assert.deepEqual(weatherSummary(cache, {now}).days.map(d => d.date), ['2026-10-15', '2026-10-16', '2026-10-17']);
  const early = new Date(2026, 9, 15, 0, 30).getTime();
  assert.deepEqual(weatherSummary({...cache, loadedAt:early}, {now:early}).days.map(d => d.date), ['2026-10-15', '2026-10-16', '2026-10-17']);
});
