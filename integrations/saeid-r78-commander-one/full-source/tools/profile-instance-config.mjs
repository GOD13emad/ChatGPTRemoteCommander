import fs from 'node:fs';
import path from 'node:path';
import { buildProfileInstance } from '../src/profile-instances.mjs';

function parse(argv){
 const out={roots:[],powerMode:false,guiControl:false};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(a==='--power'){out.powerMode=true;continue;}
  if(a==='--gui'){out.guiControl=true;continue;}
  const v=argv[++i]; if(v===undefined)throw new Error('PROFILE_INSTANCE_CLI_ARGUMENT');
  if(a==='--profile')out.profile=v;
  else if(a==='--port')out.port=Number(v);
  else if(a==='--state-dir')out.stateDirectory=v;
  else if(a==='--base-config')out.baseConfigPath=v;
  else if(a==='--out-config')out.outConfig=v;
  else if(a==='--out-record')out.outRecord=v;
  else if(a==='--root')out.roots.push(v);
  else throw new Error('PROFILE_INSTANCE_CLI_ARGUMENT');
 }
 for(const k of ['profile','port','stateDirectory','baseConfigPath','outConfig','outRecord'])if(!out[k])throw new Error('PROFILE_INSTANCE_CLI_REQUIRED');
 if(out.guiControl&&!out.powerMode)throw new Error('PROFILE_INSTANCE_GUI_REQUIRES_POWER');
 return out;
}
function writeAtomic(file,text){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const tmp=file+'.tmp-'+process.pid;
 fs.writeFileSync(tmp,text,{encoding:'utf8',mode:0o600});
 fs.renameSync(tmp,file);
}
const args=parse(process.argv.slice(2));
const base=JSON.parse(fs.readFileSync(args.baseConfigPath,'utf8'));
const built=buildProfileInstance({baseConfig:base,profile:args.profile,port:args.port,stateDirectory:args.stateDirectory,
  allowedRoots:args.roots.length?args.roots:undefined,powerMode:args.powerMode,guiControl:args.guiControl});
writeAtomic(args.outConfig,built.json);
const record={...built.record,configPath:path.resolve(args.outConfig)};
writeAtomic(args.outRecord,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({profile:record.profile,mcpPort:record.mcpPort,configPath:record.configPath,configSha256:record.configSha256,powerMode:built.config.powerMode.enabled,guiControl:built.config.powerMode.guiControl?.enabled===true,durableWorkflows:true}));
