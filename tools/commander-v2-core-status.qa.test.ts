import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createEmbeddedCoreSupervisor} from '../src/main/commander-v1-core-supervisor.js';
import {createCommanderV2Center} from '../src/main/commander-v2-center.js';

const unpacked=path.join(process.cwd(),'release','commander-v2-supervised-qa',
 process.platform==='win32'?'win-unpacked':'linux-unpacked');
const resources=path.join(unpacked,'resources');
const exe=path.join(unpacked,process.platform==='win32'?'Commander V2.exe':'commander-v2');
const server=path.join(resources,'commander-v2-workspace','server.mjs');
const available=fs.existsSync(exe)&&fs.existsSync(server);

describe('embedded V1 Core to read-only R18 UI status contract',()=>{
 it('center passes only a preverified loopback Core URL to existing workspace adapter',async()=>{
  const seen:Array<{port:number;coreUrl?:string}>=[];
  class WindowStub{
   on(_event:string,_cb:()=>void){}
   show(){}
   focus(){}
   destroy(){}
   isDestroyed(){return false;}
   loadURL(_url:string){return Promise.resolve();}
   webContents={
    setWindowOpenHandler(_cb:(d:{url:string})=>{action:'deny'}){},
    on(_event:'will-navigate',_cb:(e:{preventDefault():void},url:string)=>void){},
    session:{setPermissionRequestHandler(_cb:(c:unknown,p:string,d:(allowed:boolean)=>void)=>void){}}
   };
  }
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cmd-v2-core-center-'));
  try{
   const bundle=path.join(tmp,'commander-v2-workspace');
   fs.mkdirSync(bundle);fs.writeFileSync(path.join(bundle,'server.mjs'),'// QA only');
   const controller=createCommanderV2Center({
    resourcesPath:tmp,BrowserWindowClass:WindowStub,
    coreEndpoint:()=> 'http://127.0.0.1:49152/',
    loadWorkspace:async()=>({createWorkspace:async(o)=>{
     seen.push(o);
     return {url:'http://127.0.0.1:47951/#'+'a'.repeat(48),server:{close:(cb:()=>void)=>cb()}};
    }})
   });
   await controller.open();
   expect(seen).toEqual([{port:0,coreUrl:'http://127.0.0.1:49152/'}]);
   await controller.close();
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 });
 it.skipIf(!available)('real packaged Core health arrives in token-protected, read-only R18 API status',async()=>{
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cmd-v2-core-ui-status-'));
  const core=createEmbeddedCoreSupervisor({
   resourcesPath:resources,executablePath:exe,
   stateRoot:()=>path.join(scratch,'private-qa'),qaAllowed:true
  });
  let site:null|{url:string;server:{close:(cb:()=>void)=>unknown}}=null;
  try{
   const started=await core.start();
   expect(started.state).toBe('READY');
   const mod=await import(pathToFileURL(server).href);
   const opened=await mod.createWorkspace({port:0,coreUrl:core.coreUrl()});
   site=opened;
   const u=new URL(opened.url);
   const origin=u.origin;
   const forbidden=await fetch(origin+'/api/status',{signal:AbortSignal.timeout(2000)});
   expect(forbidden.status).toBe(403);
   const response=await fetch(origin+'/api/status',{headers:{
    'x-commander-workspace-token':u.hash.slice(1)
   },signal:AbortSignal.timeout(4500)});
   expect(response.status).toBe(200);
   const data=await response.json();
   expect(data).toMatchObject({
    product:'Commander V2 Workspace',mode:'READ_ONLY_GUI_PREVIEW',
    auth:'NOT_ENROLLED',workflow:'NOT_CONNECTED',
    gui:'NOT_CONNECTED',browser:'NOT_CONNECTED',tasks:'LOCAL_DRAFTS_ONLY',
    core:{state:'REACHABLE',version:'0.11.0-dev.23-capgap-qa'}
   });
  }finally{
   if(site)await new Promise<void>(yes=>site!.server.close(()=>yes()));
   await core.stop();
   fs.rmSync(scratch,{recursive:true,force:true});
  }
 },30000);
});
