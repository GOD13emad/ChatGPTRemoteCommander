// Spawned only by tests, always in a test-created temporary directory.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WorkflowStore } from '../src/workflow-store.mjs';
const [mode, root] = process.argv.slice(2);
if (!root || !['crash','crash-write','race','transaction-crash'].includes(mode)) throw Error('invalid fixture');
const options={
 directory:path.join(root,'memory'),allowedRoots:[root],device:'fixture',configSha256:'1'.repeat(64),
 authority:{profileId:'default',tier:'FULL_POWER',capabilities:['filesystem.full','workflow.durable','workflow.scheduler']},
 executionProfile:{modelFamily:'GPT-5.6',modelVariant:'Sol',reasoningEffort:'High',executionMode:'project-agent',profileVersion:'1',fallbackPolicy:'equivalent-or-better'},
 schedulerPolicy:{enabled:true,resumeInterrupted:true,resumeAfterRestart:true,resumeAfterUpdate:true,oneWriterPerRoot:true,maxConcurrentProjects:1,leaseMs:5000,intervalMs:1000,retryBudget:3}
};
if(mode==='transaction-crash'){
 const db=new DatabaseSync(path.join(root,'memory','workflows.sqlite'));
 db.exec("BEGIN IMMEDIATE; UPDATE workflows SET snapshot='{}' WHERE id='sample';");process.exit(74);
}
const store=new WorkflowStore(options);
try{
 const tool=mode==='crash-write'?'write_text':'read_text';
 const argumentsValue=mode==='crash-write'?{path:'proof.txt',mode:'overwrite',content:'expected'}:{path:'x'};
 await store.call({id:'sample',stepId:'first',expectedRevision:1,tool,arguments:argumentsValue}, {
  validate:async()=>{},dispatch:async()=>{
   if(mode==='crash'){fs.writeFileSync(path.join(root,'effect.txt'),'once');process.exit(73);}
   if(mode==='crash-write'){fs.writeFileSync(path.join(root,'proof.txt'),'expected');process.exit(75);}
   fs.appendFileSync(path.join(root,'effects.txt'),'once\n');await new Promise(r=>setTimeout(r,60));return{ok:true};
  }
 });
}catch(e){if(mode==='race'&&/CONFLICT|RECONCILIATION|BLOCKED|UNCERTAIN/.test(e.message)){process.exitCode=2;}else{throw e;}}
finally{store.close();}
