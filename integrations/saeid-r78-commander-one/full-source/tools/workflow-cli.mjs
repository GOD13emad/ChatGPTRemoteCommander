// Local read/export helper; no execution and no project creation from CLI.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { WorkflowStore } from '../src/workflow-store.mjs';
import { deriveCapabilitySet } from '../src/capability-profile.mjs';

function expandConfiguredPath(value){
  if(typeof value!=='string')return value;
  let out=value.replace(/%([^%]+)%/g,(_,name)=>process.env[name]??process.env[name.toUpperCase()]??process.env[name.toLowerCase()]??('%'+name+'%'));
  out=out.replace(/\$\{([^}]+)\}/g,(_,name)=>process.env[name]??('+name+'));
  if(out==='~'||out.startsWith('~/')||out.startsWith('~\\'))out=path.join(process.env.HOME??process.env.USERPROFILE??'',out.slice(2));
  return out;
}

const [configPath, action, id] = process.argv.slice(2);
if(!configPath || !['list','get','resume','export','status'].includes(action)) {
  console.error('Usage: node tools/workflow-cli.mjs CONFIG.json list|get|resume|export|status [workflow-id]');
  process.exit(1);
}

let store;
try {
  const configText=fs.readFileSync(configPath,'utf8');
  const cfg=JSON.parse(configText);
  const settings=cfg.durableWorkflows;
  if(settings?.enabled!==true || typeof settings.directory!=='string') throw Error('WORKFLOW_CLI_CONFIG_REQUIRED');
  if(!fs.existsSync(path.join(settings.directory,'workflows.sqlite'))) throw Error('Existing workflow database required');

  const authority={
    profileId:cfg.capabilityProfile?.id ?? cfg.instance?.profile ?? 'default',
    tier:cfg.capabilityProfile?.tier ?? (cfg.powerMode?.enabled&&cfg.powerMode?.fullFilesystem?'FULL_POWER':'STANDARD'),
    capabilities:deriveCapabilitySet(cfg)
  };
  store=new WorkflowStore({
    directory:settings.directory,
    rootLeaseDirectory:settings.rootLeaseDirectory ?? settings.directory,
    allowedRoots:Array.isArray(cfg.allowedRoots)?cfg.allowedRoots.map(expandConfiguredPath):[],
    device:cfg.deviceName ?? 'workflow-cli',
    configSha256:createHash('sha256').update(configText).digest('hex'),
    authority,
    executionProfile:settings.executionProfile?.default ?? {},
    schedulerPolicy:settings.scheduler ?? {enabled:false}
  });
  const result=action==='list'?store.list():action==='status'?store.capabilities():store[action](id);
  console.log(JSON.stringify(result,null,2));
  if(action==='resume'&&result.blockers.length)process.exitCode=2;
}catch(e){
  console.error(e.workflowCode??e.message??'WORKFLOW_CLI_FAILED');
  process.exitCode=1;
}finally{
  store?.close();
}
