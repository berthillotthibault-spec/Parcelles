import assert from 'node:assert/strict';
import {test,mock,after} from 'node:test';

class Target extends EventTarget{}
const preference=new Target();preference.matches=false;
globalThis.matchMedia=()=>preference;
const {finishBoot}=await import('./motion.js');
mock.timers.enable({apis:['setTimeout','Date'],now:1000});
mock.method(performance,'now',()=>Date.now());
function fixture(elapsed=0){
  let removed=false,released=false,focused=false;
  const bar={setAttribute(){},firstElementChild:{style:{}}};
  const root={dataset:{startedAt:performance.now()-elapsed},querySelector:s=>s==='[role="progressbar"]'?bar:{},contains:()=>true,remove(){removed=true;},animate(frames,options){let complete;const finished=new Promise(resolve=>complete=resolve),timer=setTimeout(complete,options.duration);return {finished,cancel(){clearTimeout(timer);complete();}};}};
  globalThis.document={activeElement:root,querySelector:()=>null,getElementById:id=>id==='app-boot'?root:id==='main'?{focus(){focused=true;}}:{removeAttribute(){released=true;}}};
  return {get removed(){return removed;},get released(){return released;},get focused(){return focused;}};
}
async function tick(ms){mock.timers.tick(ms);await Promise.resolve();await Promise.resolve();}

test('default startup opens as soon as the app is ready, with a 220 ms fade, without a click',async()=>{
  const view=fixture(),done=finishBoot();
  await tick(0);assert.equal(view.released,true,'the app is usable from the start of the fade');assert.equal(view.focused,true);assert.equal(view.removed,false);
  await tick(219);assert.equal(view.removed,false);
  await tick(1);await done;assert.equal(view.removed,true);
});
test('an explicit 3.5 second choice is honoured, fade included',async()=>{
  const view=fixture(),done=finishBoot({duration:3500});
  await tick(3279);assert.equal(view.released,false);await tick(1);assert.equal(view.released,true);
  await tick(219);assert.equal(view.removed,false);await tick(1);await done;assert.equal(view.removed,true);
});
test('a custom shorter duration also opens automatically',async()=>{
  const view=fixture(),done=finishBoot({duration:1200});await tick(979);assert.equal(view.released,false);await tick(1);assert.equal(view.released,true);await tick(220);await done;assert.equal(view.removed,true);
});
test('slow real initialization receives no extra presentation delay',async()=>{
  const view=fixture(5000),done=finishBoot({duration:3500});await tick(0);assert.equal(view.released,true);await tick(220);await done;assert.equal(view.removed,true);
});
test('reduced motion skips the delay and reacts to live preference changes',async()=>{
  preference.matches=true;const initial=fixture();await finishBoot({duration:3500});assert.equal(initial.removed,true);
  preference.matches=false;const live=fixture(),done=finishBoot({duration:3500});preference.matches=true;const event=new Event('change');event.matches=true;preference.dispatchEvent(event);await done;assert.equal(live.removed,true);preference.matches=false;
});
after(()=>{mock.timers.reset();mock.restoreAll();delete globalThis.document;delete globalThis.matchMedia;});
