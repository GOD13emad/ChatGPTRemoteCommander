import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compactV1ProjectForContinuation} from './continuation-handoff.mjs';

const observed=()=>({
  state:'PERSISTED_WORKFLOW_OBSERVED',
  canExecute:false,ownerChatAuthenticated:false,activeWorkerAttested:false,
  project:{id:'project_a',goal:'Finish scope',revision:4,lifecycle:'INTERRUPTED',
    acceptance:'UNVALIDATED',checkpointPresent:true,
    steps:[{id:'a',title:'Initial setup',status:'DONE',dependsOn:0},
      {id:'b',title:'Deployment',status:'WAITING',dependsOn:1}],
    goalGraph:{state:'PERSISTED_DEPENDENCY_GRAPH',canExecute:false,
      reason:null,counts:{recordedComplete:1,dependencySatisfied:1,dependencyBlocked:0,unknown:0},
      nodes:[{id:'a',status:'COMPLETE_RECORDED_ONLY',dependencies:[]},
        {id:'b',status:'DEPENDENCIES_SATISFIED_STORED_ONLY',dependencies:['a']}]}
  },
  recordedOperations:{count:1,items:[{stepId:'a',status:'DONE',resultStatus:'SUCCESS',
    hasPostStateHash:true,rawArguments:{password:'DO_NOT_COPY'}}]},
  binding:{projectHasConversationBinding:true,currentChatAttested:false,
    sessionHandle:'DO_NOT_COPY'}
});
test('manual continuation is a stable, bounded context without private data or action grants',()=>{
 const a=compactV1ProjectForContinuation(observed());
 const b=compactV1ProjectForContinuation(observed());
 assert.deepEqual(a,b);
 assert.match(a.sha256,/^[a-f0-9]{64}$/);
 assert.equal(a.state,'MANUAL_CONTINUATION_PREVIEW');
 assert.equal(a.canExecute,false);assert.equal(a.canResume,false);
 assert.match(a.content,/Project: project_a/);
 assert.match(a.content,/Snapshot digest SHA-256: [a-f0-9]{64}/);
 assert.match(a.content,/not an execution receipt/);
 assert.doesNotMatch(JSON.stringify(a),/DO_NOT_COPY|sessionHandle|password|rawArguments|run_shell/);
 assert.equal(Object.isFrozen(a),true);
});
test('untrusted project states, execution claims and corrupt graph fail closed',()=>{
 for(const bad of [
   {...observed(),canExecute:true},
   {...observed(),ownerChatAuthenticated:true},
   {...observed(),activeWorkerAttested:true},
   {...observed(),project:{...observed().project,goalGraph:null}},
   {...observed(),project:{...observed().project,id:'../secrets'}},
   {...observed(),project:{...observed().project,steps:[{id:'x',title:'bad\u0000',dependsOn:[]}]}}
 ])assert.throws(()=>compactV1ProjectForContinuation(bad),/V2_HANDOFF_/);
});
