import test from 'node:test';
import assert from 'node:assert/strict';
import {PINS,patchSource,patchManifest} from '../tools/stage-v2-workspace-readonlyfix.mjs';

const old="const settled=await Promise.allSettled([...NAMES.slice(1),'tools/list'].map(n=>\n    invoke(n,request,{},target.endpoint)));";
test('read-only probe fan-out rewrite prioritizes owner catalog+GUI+browser with bounded concurrency',()=>{
 const source='async function probe(){\n  '+old+'\n  return settled;\n}';
 const got=patchSource(source);
 assert.equal(got.includes(old),false);
 assert.ok(got.includes("const first=['tools/list','gui_status','browser_status'];"));
 assert.ok(got.includes('for(let i=0;i<prioritized.length;i+=2)'));
 assert.ok(got.includes('const settled=names.map('));
 assert.ok(got.includes("reason:Error('PROBE_UNVERIFIED')"));
 assert.equal(got.includes('tools/call'),false);
});
test('no rewrite without one exact original anchor',()=>{
 assert.throws(()=>patchSource('no anchor'),{code:'SOURCE_ANCHOR_CHANGED'});
 assert.throws(()=>patchSource(old+'\n'+old),{code:'SOURCE_ANCHOR_CHANGED'});
});
test('manifest patch updates exactly one pinned source path and carries exact QA-only overlay',()=>{
 const m={schema:1,qaOverlay:'OLDER_GUARD',files:[
  {path:'v1-runtime-bridge.mjs',sha256:PINS.sourceOld,bytes:1},
  {path:'server.mjs',sha256:'untouched',bytes:10}
 ]};
 const next=JSON.parse(patchManifest(m,PINS.sourceNew,4111));
 assert.equal(next.files[0].sha256,PINS.sourceNew);
 assert.equal(next.files[0].bytes,4111);
 assert.deepEqual(next.files[1],{path:'server.mjs',sha256:'untouched',bytes:10});
 assert.equal(next.qaOverlay,'V2_ELECTRON_CLOSE_RACE_GUARD_AND_BOUNDED_OWNER_PROBES');
});
test('cannot silently patch duplicate or nonpinned manifest entries',()=>{
 assert.throws(()=>patchManifest({files:[{path:'v1-runtime-bridge.mjs',sha256:'other'}]},PINS.sourceNew,1),{code:'UNPINNED_MANIFEST'});
 assert.throws(()=>patchManifest({files:[]},PINS.sourceNew,1),{code:'UNPINNED_MANIFEST'});
 assert.throws(()=>patchManifest({files:[
  {path:'v1-runtime-bridge.mjs',sha256:PINS.sourceOld},
  {path:'v1-runtime-bridge.mjs',sha256:PINS.sourceOld}
 ]},PINS.sourceNew,1),{code:'UNPINNED_MANIFEST'});
});