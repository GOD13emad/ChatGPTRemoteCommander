import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createEmbeddedCoreSupervisor} from '../src/main/commander-v1-core-supervisor.js';

const root=path.join(process.cwd(),'release','commander-v2-supervised-qa',
 process.platform==='win32'?'win-unpacked':'linux-unpacked');
const resource=path.join(root,'resources');
const executable=path.join(root,process.platform==='win32'?'Commander V2.exe':'commander-v2');
const available=fs.existsSync(executable)&&fs.existsSync(path.join(resource,'commander-v1-core','MANIFEST.json'));

describe('Commander V2 bundled V1 Core QA supervisor',()=>{
 it('is disabled by default; no I/O, process, account or data path access',async()=>{
  let accessed=false;
  const core=createEmbeddedCoreSupervisor({
   resourcesPath:'/definitely/invalid',executablePath:'/definitely/invalid',
   stateRoot:()=>{accessed=true;throw Error('must not access state path');},
   qaAllowed:false
  });
  expect(core.status().state).toBe('DISABLED');
  expect(core.coreUrl()).toBeNull();
  await core.start();
  await core.stop();
  expect(accessed).toBe(false);
  expect(core.status().state).toBe('DISABLED');
 });
 it('rejects absent/incorrect bundled source before state creation',async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cmd-v2-supervisor-no-source-'));
  try{
   let touched=false;
   const core=createEmbeddedCoreSupervisor({
    resourcesPath:path.join(tmp,'missing'),executablePath:executable,
    stateRoot:()=>{touched=true;return path.join(tmp,'state');},qaAllowed:true
   });
   const r=await core.start();
   expect(r.state).toBe('FAILED');
   expect(touched).toBe(false);
   expect(core.coreUrl()).toBeNull();
   await core.stop();
   expect(core.status().state).toBe('STOPPED');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 });
 it.skipIf(!available)('an invalid executable emits a managed failure rather than crashing Commander V2',async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cmd-v2-core-spawn-error-'));
  try{
   const fake=path.join(tmp,process.platform==='win32'?'Commander V2.exe':'commander-v2');
   fs.writeFileSync(fake,'not an executable binary',{mode:0o600});
   const core=createEmbeddedCoreSupervisor({
    resourcesPath:resource,executablePath:fake,
    stateRoot:()=>path.join(tmp,'private-data'),qaAllowed:true
   });
   const result=await core.start();
   expect(result.state).toBe('FAILED');
   expect(core.coreUrl()).toBeNull();
   await core.stop();
   expect(core.status().state).toBe('STOPPED');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 },10000);
 it.skipIf(!available)('starts V1 with the packaged Commander executable, projects read-only health, then terminates owned child',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cmd-v2-core-managed-'));
  const states:string[]=[];
  const core=createEmbeddedCoreSupervisor({
   resourcesPath:resource,executablePath:executable,
   stateRoot:()=>path.join(temp,'private-qa'),qaAllowed:true,
   onStatus:x=>{states.push(x.state);}
  });
  let oldUrl:string|null=null;
  try{
   const started=await core.start();
   expect(started).toMatchObject({state:'READY',version:'0.11.0-dev.23-capgap-qa',
    mode:'EXPLICIT_ISOLATED_QA',power:false,installed:false,authenticated:false});
   const url=core.coreUrl();
   expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
   oldUrl=url;
   const response=await fetch(url+'health',{signal:AbortSignal.timeout(1800)});
   expect((await response.json()).version).toBe('0.11.0-dev.23-capgap-qa');
   const mcp=await fetch(url+'mcp',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}),
    signal:AbortSignal.timeout(2000)
   });
   const data=await mcp.json();
   expect(data.result?.tools).toHaveLength(64);
   expect(data.result.tools.some((t:{name:string})=>t.name==='capability_gap_report')).toBe(true);
   await core.stop();
   expect(core.status().state).toBe('STOPPED');
   expect(core.coreUrl()).toBeNull();
   expect(states).toContain('READY');
   expect(states).toContain('STOPPING');
   await core.start();
   expect(core.status().state).toBe('STOPPED');
   await expect(fetch(oldUrl+'health',{signal:AbortSignal.timeout(500)})).rejects.toThrow();
  }finally{await core.stop();fs.rmSync(temp,{recursive:true,force:true});}
 },30000);
});
