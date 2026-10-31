#!/usr/bin/env node
// Portable local Control Center. Never creates another Commander installation
// or bypasses owner-session/browser permission or modifies live service config.
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chooseHybridCapability,hybridCandidates} from '../src/hybrid-capability-engine.mjs';

const HOST='127.0.0.1';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT=48773;
const SERVICES=[
 {id:'core',port:47831,path:'/health'},
 {id:'runtime',port:47832,path:'/health'},
 {id:'ownerBroker',port:48838,path:'/health'}
];
// Optional, read-only loopback discovery. Service health is not model/Planner acceptance.
const MODEL_SERVICES=[
 {id:'llamaCpp',port:18080,path:'/health'},
 {id:'ollama',port:11434,path:'/api/version'}
];
function checkPort(arg){const n=Number(arg);if(!Number.isInteger(n)||n<1024||n>65535)throw Error('INVALID_LOCAL_PORT');return n;}
async function probe(s){
 try{
  const r=await fetch('http://'+HOST+':'+s.port+s.path,{signal:AbortSignal.timeout(1400)});
  if(!r.ok)return {id:s.id,reachable:false,httpStatus:r.status};
  const x=await r.json();const v={id:s.id,reachable:true};
  if(s.id==='core'){v.version=typeof x.version==='string'?x.version:null;v.healthy=x.ok===true;}
  if(s.id==='runtime'){v.live=x.live===true;v.ready=x.ready===true;}
  if(s.id==='ownerBroker'){
   v.healthy=x.ok===true;v.ownerSession=x.ownerSession===true;
   v.active=x.active===true;v.sharedDesktopInput=x.sharedDesktopInput===true;
  }
  if(s.id==='llamaCpp')v.healthy=x.status==='ok';
  if(s.id==='ollama')v.healthy=typeof x.version==='string';
  return v;
 }catch{return {id:s.id,reachable:false};}
}
async function snapshot(){
 const [services,modelServices]=await Promise.all([
  Promise.all(SERVICES.map(probe)),Promise.all(MODEL_SERVICES.map(probe))
 ]);
 return {schema:1,name:'Commander Hybrid Quickstart',mode:'LOCAL_CONTROL_CENTER',
  platform:process.platform,arch:process.arch,host:os.hostname(),
  checkedAt:new Date().toISOString(),services,modelServices,
  localModelRuntimeDetected:modelServices.some(s=>s.healthy===true),
  availableDomains:Object.keys(hybridCandidates),
  localCodeAvailable:true,
  fleetCoordinatorConfigured:false,localModelConfigured:false,
  nativeGuiPermissionDelegated:false,
  workflowPlan:chooseHybridCapability({
   domain:'workflow',capabilities:{commanderWorkflowReady:services[0].healthy===true},
   context:{localJournalHealthy:false}
  }),
  note:'Core HTTP health is not enough to confirm Workflow Journal health; verify via Commander workflow_health.'};
}
async function main(args=process.argv.slice(2)){
 const action=args[0]||'--status';
 if(action==='--status'||action==='status'){
  process.stdout.write(JSON.stringify(await snapshot(),null,2)+'\n');
  return;
 }
 if(action==='--serve'||action==='serve'){
  const port=checkPort(args[1]||DEFAULT_PORT);
  const html=fs.readFileSync(path.join(HERE,'hybrid-control-center.html'),'utf8');
  const server=http.createServer(async(req,res)=>{
   const url=new URL(req.url||'/', 'http://localhost');
   const send=(code,type,body)=>{
    res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store',
     'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
     'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
    res.end(body);
   };
   if(req.method!=='GET')return send(405,'text/plain','GET only');
   if(url.pathname==='/')return send(200,'text/html; charset=utf-8',html);
   if(url.pathname==='/health')return send(200,'application/json',JSON.stringify({ok:true,role:'hybrid-local-control-center',version:1}));
   if(url.pathname==='/api/status')return send(200,'application/json',JSON.stringify(await snapshot()));
   return send(404,'text/plain','not found');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,HOST,resolve);});
  process.stdout.write('HYBRID_LOCAL_CONTROL_CENTER_READY http://'+HOST+':'+port+'\n');
  return;
 }
 throw Error('USE_--status_OR_--serve');
}
if(process.argv[1] && import.meta.url===new URL('file:///'+path.resolve(process.argv[1]).replaceAll('\\','/').replace(/^\/+/,'')).href){
 main().catch(e=>{process.stderr.write('HYBRID_QUICKSTART_ERROR '+e.message+'\n');process.exitCode=1;});
}
export {snapshot,main};
