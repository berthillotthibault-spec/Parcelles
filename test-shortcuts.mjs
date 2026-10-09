import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseLaunchRoute,shouldResumeField,PWA_SHORTCUTS} from './shortcuts.js';

const read=f=>fs.readFileSync(new URL(`./${f}`,import.meta.url));

test('routes profondes du mode terrain', () => {
  assert.equal(parseLaunchRoute('#field'),'field');
  assert.equal(parseLaunchRoute('new/work'),'work');
  assert.equal(parseLaunchRoute('#/new/observation/'),'observation');
  assert.equal(parseLaunchRoute('#new/photo?source=pwa'),'photo');
  assert.equal(parseLaunchRoute('#voice'),'voice');
  for(const other of ['','#today','#map','#work/list','#equipment/m1/log','#new','#fieldx'])assert.equal(parseLaunchRoute(other),null,other);
});

test('reprise du mode terrain au lancement', () => {
  assert.equal(shouldResumeField('',true),true);
  assert.equal(shouldResumeField('#today',true),true);
  assert.equal(shouldResumeField('#map',true),false);
  assert.equal(shouldResumeField('',false),false);
});

test('manifeste : 4 raccourcis avec icônes PNG 96 px, routes reconnues, en cache hors ligne', () => {
  const manifest=JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.shortcuts.length,4);
  const sw=read('sw.js').toString(),runtime=read('runtime.js').toString();
  manifest.shortcuts.forEach((s,i)=>{
    assert.equal(s.name,PWA_SHORTCUTS[i].name);assert.equal(s.url,PWA_SHORTCUTS[i].url);
    assert.ok(parseLaunchRoute(s.url.replace('./','')),s.url);
    const [icon]=s.icons;assert.equal(icon.sizes,'96x96');assert.equal(icon.type,'image/png');
    const png=read(icon.src.replace('./',''));
    assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    assert.equal(png.readUInt32BE(16),96);assert.equal(png.readUInt32BE(20),96);
    assert.ok(sw.includes(`'${icon.src}'`)&&runtime.includes(`'${icon.src}'`),`${icon.src} dans CORE et REQUIRED_ASSETS`);
  });
  assert.ok(sw.includes("'./shortcuts.js'"));
});
