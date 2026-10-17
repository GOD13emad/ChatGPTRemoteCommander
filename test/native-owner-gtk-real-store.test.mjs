import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createWorkflowTools } from '../src/workflow-tools.mjs';

const supported=process.platform==='linux'&&typeof process.getuid==='function'&&process.getuid()>0;
const ownerNative=(name,run)=>test(name,{skip:!supported,timeout:20000},run);
const pyPath=fileURLToPath(new URL('../desktop/linux-control-center',import.meta.url));
const snippet=String.raw`
import sys,json
sys.path.insert(0,sys.argv[1])
from native_owner_gtk import _file,_read_workflow_rows
try:
    result=_read_workflow_rows(_file(sys.argv[2]),json.loads(sys.argv[3]))
    print(json.dumps({"status":"ACCEPTED","records":result["records"]}))
except ValueError as ex:
    print(json.dumps({"status":"REJECTED","code":str(ex)}))
`;
const checksum=(p)=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function inspect(db,target){
 const p=spawnSync('/usr/bin/python3',['-I','-B','-c',snippet,pyPath,db,JSON.stringify(target)],
   {encoding:'utf8',timeout:7000,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});
 assert.equal(p.error,undefined);
 assert.equal(p.status,0,(p.stderr||'').slice(-260));
 return JSON.parse(p.stdout);
}

ownerNative('owner GUI reader binds actual WorkflowStore snapshot identity and revision before any control',async t=>{
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rcm-owner-real-sqlite-')));
 fs.chmodSync(root,0o700);
 const storePath=path.join(root,'private-store');
 const target={deviceId:'fixture',profileId:'default',configSha256:'1'.repeat(64),routeGeneration:4};
 const engine=createWorkflowTools({
   config:{durableWorkflows:{enabled:true,directory:storePath,scheduler:{enabled:false},
     authority:{profileId:'default'}}},
   roots:[root],device:target.deviceId,configSha256:target.configSha256,
   lookup:()=>null,validateSchema:()=>[],dispatch:async()=>assert.fail('NO_GUI_EFFECTS_ALLOWED'),
 });
 t.after(async()=>{await engine.close();fs.rmSync(root,{recursive:true,force:true});});
 await engine.execute('workflow_create',{id:'sample',root,goal:'Test isolated real Core row identity',
   acceptance:['Read-only inventory'],steps:[{id:'step',title:'No execution'}]});
 const db=path.join(storePath,'workflows.sqlite');
 assert.equal(fs.statSync(db).mode&0o077,0);
 assert.equal(fs.statSync(storePath).mode&0o077,0);
 const before=checksum(db);
 const ok=inspect(db,target);
 assert.equal(ok.status,'ACCEPTED');
 assert.deepEqual(ok.records,[{id:'sample',revision:1,state:'CREATED',profileId:'default'}]);
 for(const [reason,delta] of [
   ['config', {configSha256:'2'.repeat(64)}],
   ['device', {deviceId:'other'}],
   ['profile', {profileId:'other'}],
 ]) {
   const outcome=inspect(db,{...target,...delta});
   assert.equal(outcome.status,'REJECTED',reason);
   assert.equal(outcome.code,'MANAGEMENT_WORKFLOW_SCOPE_UNVERIFIED',reason);
 }
 assert.equal(checksum(db),before);
 assert.equal((await engine.execute('workflow_get',{id:'sample'})).state.revision,1);
});
