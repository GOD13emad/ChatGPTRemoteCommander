import path from 'node:path';
import fs from 'node:fs';
import { reconfigureProfileInstance } from '../src/profile-reconfigure.mjs';

function parse(args){
  const o={roots:[],powerMode:undefined,guiControl:undefined};
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a==='--power'){o.powerMode=true;continue;}
    if(a==='--standard'){o.powerMode=false;continue;}
    if(a==='--gui'){o.guiControl=true;continue;}
    if(a==='--gui-off'){o.guiControl=false;continue;}
    const v=args[++i]; if(v===undefined)throw new Error('PROFILE_RECONFIGURE_ARGUMENT');
    if(a==='--profile')o.profile=v;
    else if(a==='--root')o.roots.push(v);
    else if(a==='--state-dir')o.stateDirectory=v;
    else if(a==='--base-config')o.baseConfigPath=v;
    else throw new Error('PROFILE_RECONFIGURE_ARGUMENT');
  }
  if(!o.profile)throw new Error('PROFILE_RECONFIGURE_PROFILE_REQUIRED');
  if(o.guiControl===true&&o.powerMode===false)throw new Error('PROFILE_RECONFIGURE_GUI_REQUIRES_POWER');
  const app=process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA,'ChatGPTRemoteCommander','app') : null;
  o.stateDirectory ??= path.join(process.env.LOCALAPPDATA ?? '', 'ChatGPTRemoteCommander','instances',o.profile);
  if(!o.baseConfigPath){
    const local=path.join(app,'config.local.json'), pub=path.join(app,'config.json');
    o.baseConfigPath=fs.existsSync(local)?local:pub;
  }
  return o;
}
const args=parse(process.argv.slice(2));
const result=reconfigureProfileInstance({...args,allowedRoots:args.roots.length?args.roots:undefined});
console.log(JSON.stringify(result));
