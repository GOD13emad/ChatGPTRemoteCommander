import {afterEach,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCommanderV2Center} from '../src/main/commander-v2-center.js';

const dirs:string[]=[];
afterEach(()=>{for(const x of dirs.splice(0))fs.rmSync(x,{recursive:true,force:true});});
function setup(url='http://127.0.0.1:47951/#'+'a'.repeat(48)){
 const resources=fs.mkdtempSync(path.join(os.tmpdir(),'cos-v2center-'));dirs.push(resources);
 const bundle=path.join(resources,'commander-v2-workspace');
 fs.mkdirSync(bundle);fs.writeFileSync(path.join(bundle,'server.mjs'),'// QA module presence');
 const windows:FakeWindow[]=[];
 let started=0,closed=0;
 class FakeWindow{
  options:Record<string,any>;
  url='';
  visible=false;
  killed=false;
  popupHandler:((details:{url:string})=>{action:'deny'})|null=null;
  navigation:((event:{preventDefault():void},url:string)=>void)|null=null;
  permission:((_c:unknown,_p:string,decision:(allowed:boolean)=>void)=>void)|null=null;
  ended:(()=>void)|null=null;
  webContents={
   setWindowOpenHandler:(fn:(details:{url:string})=>{action:'deny'})=>{this.popupHandler=fn;},
   on:(_event:string,cb:(event:{preventDefault():void},url:string)=>void)=>{this.navigation=cb;},
   session:{setPermissionRequestHandler:(fn:(_c:unknown,_p:string,decision:(allowed:boolean)=>void)=>void)=>{this.permission=fn;}}
  };
  constructor(opts:object){this.options=opts;windows.push(this);}
  isDestroyed(){return this.killed;}
  show(){this.visible=true;}
  focus(){}
  destroy(){this.killed=true;this.ended?.();}
  loadURL(url:string){this.url=url;return Promise.resolve();}
  on(_event:'closed',cb:()=>void){this.ended=cb;}
 }
 const controller=createCommanderV2Center({
  resourcesPath:resources,
  BrowserWindowClass:FakeWindow,
  loadWorkspace:async()=>({createWorkspace:async()=>{
   started++;
   return {url,server:{close:(cb:(error?:Error)=>void)=>{closed++;cb();}}};
  }})
 });
 return {controller,windows,counts:()=>({started,closed}),resources};
}
describe('embedded Commander V2 control center',()=>{
 it('refuses missing install resources without opening a window',async()=>{
  const s=setup();
  fs.unlinkSync(path.join(s.resources,'commander-v2-workspace/server.mjs'));
  expect(s.controller.available()).toBe(false);
  await expect(s.controller.open()).rejects.toThrow('V2_CENTER_BUNDLED_RUNTIME_MISSING');
  expect(s.counts()).toEqual({started:0,closed:0});
 });
 it('opens only a tokenized loopback R18 read-only window, denies popup, navigation and permissions',async()=>{
  const s=setup();
  await Promise.all([s.controller.open(),s.controller.open()]);
  expect(s.counts()).toEqual({started:1,closed:0});
  expect(s.windows.length).toBe(1);
  const w=s.windows[0]!;
  expect(w.visible).toBe(true);
  expect(w.options.webPreferences).toMatchObject({sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,webviewTag:false,partition:'temp:commander-v2-center'});
  expect(w.popupHandler?.({url:'https://evil.example/'})).toEqual({action:'deny'});
  let blocked=false;
  w.navigation?.({preventDefault:()=>{blocked=true;}},'https://evil.example/');
  expect(blocked).toBe(true);
  blocked=false;
  w.navigation?.({preventDefault:()=>{blocked=true;}},w.url);
  expect(blocked).toBe(false);
  let allowed:boolean|null=null;
  w.permission?.(null,'camera',decision=>{allowed=decision;});
  expect(allowed).toBe(false);
  await s.controller.open();
  expect(s.windows.length).toBe(1);
  await s.controller.close();
  expect(s.counts()).toEqual({started:1,closed:1});
  expect(w.isDestroyed()).toBe(true);
  await s.controller.close();
  expect(s.counts()).toEqual({started:1,closed:1});
 });
 it('never displays invalid or unauthenticated server URL, and releases the server',async()=>{
  for(const bad of ['http://127.0.0.1:47951/','http://example.net:47951/#'+'a'.repeat(48),
     'http://127.0.0.1:47951/?secret=x#'+'a'.repeat(48)]){
   const s=setup(bad);
   await expect(s.controller.open()).rejects.toThrow('V2_CENTER_LOCAL_AUTH_REQUIRED');
   expect(s.windows).toHaveLength(0);
   expect(s.counts()).toEqual({started:1,closed:1});
  }
 });
 it('closes a server automatically when owner closes the secondary window',async()=>{
   const s=setup();
   await s.controller.open();
   s.windows[0]!.destroy();
   expect(s.counts()).toEqual({started:1,closed:1});
   await s.controller.open();
   expect(s.counts().started).toBe(2);
   await s.controller.close();
   expect(s.counts().closed).toBe(2);
 });
});
