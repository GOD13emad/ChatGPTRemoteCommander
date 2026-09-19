// Local read/export helper; no execution and no project creation from CLI.
import fs from 'node:fs';
import path from 'node:path';
import { WorkflowStore } from '../src/workflow-store.mjs';
const [configPath, action, id] = process.argv.slice(2);
if(!configPath || !['list','get','resume','export','status'].includes(action)) {
 console.error('Usage: node tools/workflow-cli.mjs CONFIG.json list|get|resume|export|status [workflow-id]');process.exit(1);
}
let store;
try {
 const cfg=JSON.parse(fs.readFileSync(configPath,'utf8'));
 if(!fs.existsSync(path.join(cfg.directory,'workflows.sqlite'))) throw Error('Existing workflow database required');
 store=new WorkflowStore(cfg);
 const result=action==='list'?store.list():action==='status'?store.capabilities():store[action](id);
 console.log(JSON.stringify(result,null,2));
 if(action==='resume'&&result.blockers.length)process.exitCode=2;
}catch(e){console.error(e.workflowCode??'WORKFLOW_CLI_FAILED');process.exitCode=1;}
finally{store?.close();}
