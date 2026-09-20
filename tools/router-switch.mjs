import fs from 'node:fs';
import path from 'node:path';
import { readRouterState, writeRouterStateAtomic } from '../src/stable-router.mjs';

function parse(argv){
  const o={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i],v=argv[++i];if(v===undefined)throw new Error('ROUTER_SWITCH_ARGUMENT');
    if(a==='--state')o.stateFile=v;
    else if(a==='--expected-generation')o.expectedGeneration=Number(v);
    else if(a==='--profile')o.profile=v;
    else if(a==='--port')o.port=Number(v);
    else if(a==='--version')o.version=v;
    else if(a==='--commit')o.commit=v;
    else if(a==='--config-sha')o.configSha256=v;
    else if(a==='--config-path')o.configPath=path.resolve(v);
    else if(a==='--project-dir')o.projectDir=path.resolve(v);
    else throw new Error('ROUTER_SWITCH_ARGUMENT');
  }
  for(const k of ['stateFile','expectedGeneration','profile','port','version','commit','configSha256','configPath','projectDir'])if(o[k]===undefined||o[k]===null||o[k]==='')throw new Error('ROUTER_SWITCH_REQUIRED_'+k);
  return o;
}
async function main(){
 const a=parse(process.argv.slice(2));
 const current=readRouterState(a.stateFile);
 if(current.profile!==a.profile)throw new Error('ROUTER_SWITCH_PROFILE_MISMATCH');
 if(current.generation!==a.expectedGeneration)throw new Error('ROUTER_GENERATION_CONFLICT');
 if(!fs.existsSync(a.configPath)||!fs.existsSync(a.projectDir))throw new Error('ROUTER_SWITCH_PATH_MISSING');
 const response=await fetch('http://127.0.0.1:'+a.port+'/health',{redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw new Error('ROUTER_SWITCH_CANDIDATE_HEALTH');
 const health=await response.json();
 if(health?.ok!==true||health.version!==a.version||health.configSha256!==a.configSha256||health.instance?.profile!==a.profile)throw new Error('ROUTER_SWITCH_CANDIDATE_IDENTITY');
 const next={
   schema:1,profile:a.profile,generation:current.generation+1,
   active:{port:a.port,version:a.version,commit:a.commit,configSha256:a.configSha256,configPath:a.configPath,projectDir:a.projectDir},
   previous:current.active,updatedAt:new Date().toISOString()
 };
 writeRouterStateAtomic(a.stateFile,next,current.generation);
 console.log(JSON.stringify({ok:true,previous:current.active,active:next.active,generation:next.generation}));
}
try{await main();}catch(error){console.error(error.message);process.exitCode=2;}
