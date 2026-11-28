#!/usr/bin/env node
// Native package verifier delegates to the exact contract used by the GUI.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import integrity from '../packaging/unified/companion-integrity.cjs';
const fail=(ok,code)=>{if(!ok)throw Error(code);};
export function verifyCompiledCompanion(options){
  fail(typeof options?.sourceManifest==='string','COMPANION_ARGUMENTS_INVALID');
  return integrity.verifyCompanion(options);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),map=new Map();
    for(let i=0;i<args.length;i+=2){
      fail(i+1<args.length&&['--companion-root','--source-manifest','--expected-commit'].includes(args[i])
        &&!map.has(args[i]),'COMPANION_CLI_ARGUMENTS');
      map.set(args[i],args[i+1]);
    }
    fail(map.size===3,'COMPANION_CLI_REQUIRED');
    console.log(JSON.stringify(verifyCompiledCompanion({
      companionRoot:map.get('--companion-root'),
      sourceManifest:map.get('--source-manifest'),
      expectedCommit:map.get('--expected-commit')
    })));
  }catch(err){
    console.error(JSON.stringify({status:'COMPILED_COMPANION_HASH_FAIL',
      code:String(err?.message||err)}));
    process.exitCode=2;
  }
}
