import path from 'node:path';
import os from 'node:os';
import { createAgentExtensionRegistry } from '../src/agent-extensions.mjs';

const args=process.argv.slice(2);
const roots=[];
const capabilities=[];
let id=null;
for(let i=0;i<args.length;i++){
  if(args[i]==='--root' && args[i+1]) roots.push(path.resolve(args[++i]));
  else if(args[i]==='--id' && args[i+1]) id=args[++i];
  else if(args[i]==='--capability' && args[i+1]) capabilities.push(args[++i]);
  else if(args[i]==='--help'){
    console.log('Usage: node tools/agent-extension-inspect.mjs [--root DIR] [--id ID] [--capability CAP]...');
    process.exit(0);
  } else {
    console.error('AGENT_EXTENSION_INSPECT_ARGUMENT_INVALID');
    process.exit(2);
  }
}
if(!roots.length) roots.push(path.join(os.homedir(),'.agents','extensions'));
const registry=createAgentExtensionRegistry({directories:roots});
let out;
try {
  if(id) out=registry.execute('agent_extension_get',{id});
  else if(capabilities.length) out=registry.execute('agent_extension_match',{capabilities});
  else out=registry.execute('agent_extension_list',{});
} catch(error) {
  console.error(error.message);
  process.exit(2);
}
console.log(JSON.stringify(out,null,2));
