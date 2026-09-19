// Spawned only by tests, always in a test-created temporary directory.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WorkflowStore } from '../src/workflow-store.mjs';
const [mode, root] = process.argv.slice(2);
if (!root || !['crash','race','transaction-crash'].includes(mode)) throw Error('invalid fixture');
const options={directory:path.join(root,'memory'),allowedRoots:[root],device:'fixture',configSha256:'1'.repeat(64)};
if(mode==='transaction-crash'){
 const db=new DatabaseSync(path.join(root,'memory','workflows.sqlite'));
 db.exec("BEGIN IMMEDIATE; UPDATE workflows SET snapshot='{}' WHERE id='sample';");process.exit(74);
}
const store=new WorkflowStore(options);
try{
 await store.call({id:'sample',stepId:'first',expectedRevision:1,tool:'read_text',arguments:{path:'x'}}, {
  validate:async()=>{},dispatch:async()=>{
   if(mode==='crash'){fs.writeFileSync(path.join(root,'effect.txt'),'once');process.exit(73);}
   fs.appendFileSync(path.join(root,'effects.txt'),'once\n');await new Promise(r=>setTimeout(r,60));return{ok:true};
  }
 });
}catch(e){if(mode==='race'&&/CONFLICT|RECONCILIATION|BLOCKED|UNCERTAIN/.test(e.message)){process.exitCode=2;}else{throw e;}}
finally{store.close();}
