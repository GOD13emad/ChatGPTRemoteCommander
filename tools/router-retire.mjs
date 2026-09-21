import fs from 'node:fs';
import { readRouterState, writeRouterStateAtomic } from '../src/stable-router.mjs';

function parse(argv){
  const o={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i],v=argv[++i];
    if(v===undefined)throw new Error('ROUTER_RETIRE_ARGUMENT');
    if(a==='--state')o.stateFile=v;
    else if(a==='--expected-generation')o.expectedGeneration=Number(v);
    else if(a==='--profile')o.profile=v;
    else if(a==='--previous-port')o.previousPort=Number(v);
    else if(a==='--previous-commit')o.previousCommit=v;
    else throw new Error('ROUTER_RETIRE_ARGUMENT');
  }
  for(const k of ['stateFile','expectedGeneration','profile','previousPort','previousCommit']){
    if(o[k]===undefined||o[k]===null||o[k]==='')throw new Error('ROUTER_RETIRE_REQUIRED_'+k);
  }
  return o;
}
async function main(){
  const a=parse(process.argv.slice(2));
  const current=readRouterState(a.stateFile);
  if(current.profile!==a.profile)throw new Error('ROUTER_RETIRE_PROFILE_MISMATCH');
  if(current.generation!==a.expectedGeneration)throw new Error('ROUTER_GENERATION_CONFLICT');
  if(!current.previous){
    console.log(JSON.stringify({ok:true,alreadyRetired:true,generation:current.generation}));
    return;
  }
  if(Number(current.previous.port)!==a.previousPort)throw new Error('ROUTER_RETIRE_PREVIOUS_PORT_MISMATCH');
  if(String(current.previous.commit)!==String(a.previousCommit))throw new Error('ROUTER_RETIRE_PREVIOUS_COMMIT_MISMATCH');
  const next={...current,generation:current.generation+1,previous:null,updatedAt:new Date().toISOString()};
  writeRouterStateAtomic(a.stateFile,next,current.generation);
  console.log(JSON.stringify({ok:true,retired:true,generation:next.generation}));
}
try{await main();}catch(error){console.error(error.message);process.exitCode=2;}
