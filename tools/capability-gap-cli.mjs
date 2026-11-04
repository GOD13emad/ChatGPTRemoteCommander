#!/usr/bin/env node
// Local CLI adapter for chats that can run Commander shell but have not yet upgraded MCP tools.
// Uses the same durable profile-private SQLite ledger as capability_gap_* MCP. No elevation.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deliveryLocation} from '../src/delivery-store.mjs';
import {createCapabilityGapTools} from '../src/capability-gap-registry.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [verb,...args]=process.argv.slice(2);
let cfg=process.env.REMOTE_COMMANDER_CONFIG||path.join(repo,'config.json');
let file=null;
for(let i=0;i<args.length;i++){
 if(args[i]==='--config'&&args[i+1])cfg=path.resolve(args[++i]);
 else if(args[i]==='--input'&&args[i+1])file=path.resolve(args[++i]);
 else {process.stderr.write('CAPABILITY_GAP_CLI_ARGUMENT_INVALID\n');process.exit(2);}
}
if(!['report','list','get','triage','status'].includes(verb)){process.stderr.write('CAPABILITY_GAP_CLI_VERB_INVALID\n');process.exit(2);}
let tools;
try{
 const st=fs.lstatSync(cfg);
 if(!st.isFile()||st.isSymbolicLink())throw Error('CAPABILITY_GAP_CONFIG_INVALID');
 const config=JSON.parse(fs.readFileSync(cfg,'utf8'));
 const where=deliveryLocation(config,cfg);
 // Keep delivery's canonical private-root restrictions, never write within a tracked project.
 for(const root of where.forbiddenRoots??[]){
  const base=path.resolve(root),relative=path.relative(base,where.directory);
  if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))
   throw Error('CAPABILITY_GAP_STORE_INSIDE_PROJECT');
 }
 tools=createCapabilityGapTools({directory:where.directory,scope:where.scope,
   device:config.deviceName||undefined});
 let input={};
 if(file!==null){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>8192)throw Error('CAPABILITY_GAP_INPUT_FILE_INVALID');
  input=JSON.parse(fs.readFileSync(file,'utf8'));
 }
 const name=verb==='status'?'status':'execute';
 const out=verb==='status'?tools.status():await tools.execute('capability_gap_'+verb,input);
 process.stdout.write(JSON.stringify(out)+'\n');
}catch(error){
 const code=typeof error?.capabilityGapCode==='string'?error.capabilityGapCode:
  typeof error?.message==='string'&&/^CAPABILITY_GAP_[A-Z_]+$/.test(error.message)?error.message:
  'CAPABILITY_GAP_CLI_FAILED';
 process.stderr.write(code+'\n');
 process.exitCode=2;
}finally{tools?.close();}
