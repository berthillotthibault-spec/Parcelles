import assert from 'node:assert/strict';
import {test,mock,after} from 'node:test';

class Target extends EventTarget{}
const preference=new Target();preference.matches=false;
globalThis.matchMedia=()=>preference;
const {finishBoot}=await import('./motion.js');
mock.timers.enable({apis:['setTimeout']});
function fixture(){
  const skip=new Target();skip.hidden=true;
  let removed=false,released=false,focused=false;
  const bar={setAttribute(){},firstElementChild:{style:{}}};
  const root={dataset:{startedAt:performance.now()},querySelector:s=>s==='[data-boot-skip]'?skip:s==='[role="progressbar"]'?bar:{},contains:()=>true,remove(){removed=true;}};
  globalThis.document={activeElement:skip,querySelector:()=>null,getElementById:id=>id==='app-boot'?root:id==='main'?{focus(){focused=true;}}:{removeAttribute(){released=true;}}};
  return {skip,get removed(){return removed;},get released(){return released;},get focused(){return focused;}};
}
test('startup remains visible for its minimum duration and releases inert content afterwards',async()=>{
  const view=fixture(),done=finishBoot({duration:2200});
  mock.timers.tick(1000);await Promise.resolve();assert.equal(view.removed,false);assert.equal(view.released,false);assert.equal(view.skip.hidden,false);
  mock.timers.tick(1300);await done;assert.equal(view.removed,true);assert.equal(view.released,true);assert.equal(view.focused,true);
});
test('Open now bypasses the remaining presentation delay',async()=>{
  const view=fixture(),done=finishBoot({duration:3500});view.skip.dispatchEvent(new Event('click'));await done;assert.equal(view.removed,true);assert.equal(view.released,true);
});
test('reduced motion skips the delay and reacts to live preference changes',async()=>{
  preference.matches=true;const initial=fixture();await finishBoot({duration:3500});assert.equal(initial.removed,true);assert.equal(initial.skip.hidden,true);
  preference.matches=false;const live=fixture(),done=finishBoot({duration:3500});const event=new Event('change');event.matches=true;preference.dispatchEvent(event);await done;assert.equal(live.removed,true);
});
after(()=>{mock.timers.reset();delete globalThis.document;delete globalThis.matchMedia;});
