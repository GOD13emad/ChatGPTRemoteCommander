import test from 'node:test';
import assert from 'node:assert/strict';
import {runLocalPlannerE2e} from '../tools/local-llamacpp-runner-smoke.mjs';
const valid={action:'call',tool:'read_text',argumentsJson:'{"path":"PROJECT_BRAIN.md"}',summary:'Synthetic read only'};
const mock=value=>({
 describe(){return {kind:'command',available:true,mode:'proposal-only'};},
 async plan(){return value;}
});
test('three-worker Team Planner and actual SQLite ProjectEngine complete bounded read-only workflow',async()=>{
 const r=await runLocalPlannerE2e({basePlanner:mock(valid)});
 assert.equal(r.status,'PASS',JSON.stringify(r));
 assert.equal(r.firstCode,'PROJECT_STEP_RECORDED');
 assert.equal(r.finalCode,'PROJECT_ACCEPTANCE_VERIFIED');
 assert.equal(r.realReadOnlyToolExecutions,1);
 assert.equal(r.modelProviderCalls,3);
 assert.equal(r.fixtureUnmodified,true);
 assert.equal(r.actualProjectTouched,false);
});
test('invalid executable tool is never performed in real project engine',async()=>{
 const r=await runLocalPlannerE2e({basePlanner:mock({...valid,tool:'run_shell'})});
 assert.notEqual(r.status,'PASS');
 assert.equal(r.realReadOnlyToolExecutions,0);
 assert.equal(r.fixtureUnmodified,true);
 assert.equal(r.actualProjectTouched,false);
});
