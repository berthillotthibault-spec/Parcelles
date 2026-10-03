import assert from 'node:assert/strict';
import {test, mock, after} from 'node:test';
import fs from 'node:fs';

class Element {
  hidden=true; disabled=false; textContent=''; attributes=new Map();
  classes=new Set();
  classList={add: name=>this.classes.add(name),remove:name=>this.classes.delete(name),toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name),contains:name=>this.classes.has(name)};
  style={removeProperty: name=>delete this.style[name]};
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  removeAttribute(name){this.attributes.delete(name);}
  querySelector(selector){return this.children[selector];}
}
const label=new Element(),count=new Element(),bar=new Element(),root=new Element();
bar.firstElementChild=new Element();
root.children={'[data-progress-label]':label,'[data-progress-count]':count,'[role="progressbar"]':bar};
const preference={matches:false,addEventListener(type,fn){this.changed=fn;}};
globalThis.matchMedia=()=>preference;
globalThis.document={getElementById:()=>root};
mock.timers.enable({apis:['setTimeout']});
const {startProgress,withProgress,progressRatio,animateElement}=await import('./motion.js');
after(()=>{mock.timers.reset();delete globalThis.matchMedia;delete globalThis.document;});

test('fast operations never flash a loading indicator',()=>{
  root.hidden=true;const progress=startProgress('Rapide');progress.finish();mock.timers.tick(500);assert.equal(root.hidden,true);
});
test('unknown duration stays indeterminate, measured progress is bounded',()=>{
  const progress=startProgress('Chargement');mock.timers.tick(140);
  assert.equal(root.hidden,false);assert.equal(bar.getAttribute('aria-valuenow'),null);
  progress.update({completed:25,total:100});assert.equal(bar.getAttribute('aria-valuenow'),'25');assert.equal(bar.firstElementChild.style.transform,'scaleX(0.25)');
  progress.update({completed:400,total:100});assert.equal(bar.getAttribute('aria-valuenow'),'100');
  progress.update({total:null});assert.equal(bar.getAttribute('aria-valuenow'),null);
  progress.finish({error:true});assert.equal(root.hidden,true);
});
test('overlapping operations cannot hide the remaining operation',()=>{
  const first=startProgress('Première');mock.timers.tick(140);
  const second=startProgress('Deuxième');mock.timers.tick(140);
  assert.equal(label.textContent,'Deuxième');assert.equal(count.textContent,'2 opérations en cours');
  second.finish();assert.equal(root.hidden,false);assert.equal(label.textContent,'Première');
  first.finish();assert.equal(label.textContent,'Terminé');mock.timers.tick(240);assert.equal(root.hidden,true);
  second.update({label:'Périmée'});assert.equal(label.textContent,'Terminé');
});
test('pending replacement and rapid new operation clear old completion timers',()=>{
  const first=startProgress('A');mock.timers.tick(140);first.finish();
  const second=startProgress('B');mock.timers.tick(140);mock.timers.tick(240);assert.equal(root.hidden,false);assert.equal(label.textContent,'B');
  const third=startProgress('C');second.finish();assert.equal(root.hidden,true);mock.timers.tick(140);assert.equal(label.textContent,'C');third.finish({error:true});
});
test('failures restore buttons and never report success',async()=>{
  const button=new Element();let reject;
  const result=withProgress('Échec',()=>new Promise((resolve,r)=>{reject=r;}),{button});
  mock.timers.tick(140);assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');
  const rejected=assert.rejects(result,/réseau/);reject(new Error('réseau'));await rejected;
  assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),null);assert.equal(root.hidden,true);assert.notEqual(label.textContent,'Terminé');
});
test('success preserves existing button state and returns operation result',async()=>{
  const button=new Element();button.disabled=true;button.setAttribute('aria-busy','false');
  assert.equal(await withProgress('OK',async()=>42,{button}),42);
  assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'false');
});
test('reduced motion skips animations and dismisses progress immediately',async()=>{
  preference.matches=true;
  await animateElement({animate(){assert.fail('must not animate');}},[]);
  const progress=startProgress('Accessible');mock.timers.tick(140);progress.finish();assert.equal(root.hidden,true);
  preference.matches=false;
});
test('live reduced-motion preference cancels in-flight animations',async()=>{
  let canceled=false,reject;
  const promise=animateElement({animate(){return {finished:new Promise((resolve,r)=>{reject=r;}),cancel(){canceled=true;reject(new Error('cancel'));}};}},[]);
  preference.changed({matches:true});await promise;assert.equal(canceled,true);
});
test('invalid progress totals never invent a percentage',()=>{
  assert.equal(progressRatio(2,0),null);assert.equal(progressRatio(2,undefined),null);assert.equal(progressRatio(NaN,10),null);assert.equal(progressRatio(-2,10),0);assert.equal(progressRatio(5,10),.5);
});
test('flat release includes motion assets in HTML, offline cache and diagnostics',()=>{
  const read=file=>fs.readFileSync(new URL(file,import.meta.url),'utf8');
  for(const file of ['sw.js','runtime.js'])for(const asset of ['./motion.js','./motion.css'])assert.ok(read(file).includes(`'${asset}'`));
  const html=read('index.html');assert.ok(html.includes('href="./motion.css"'));assert.ok(html.includes('id="activity-progress"'));assert.ok(html.includes("document.getElementById('app-boot')?.remove()"));
  const version=read('utils.js').match(/BUILD_ID = '([^']+)'/)[1];assert.ok(read('sw.js').includes(version));assert.ok(html.includes(version));
  assert.ok(read('motion.css').includes('@media(prefers-reduced-motion:reduce)'));
});
