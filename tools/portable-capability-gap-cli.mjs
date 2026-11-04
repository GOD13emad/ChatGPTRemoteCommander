#!/usr/bin/env node
// Standalone owner-local CLI distributed beside the pinned V2 capability-gap-registry.mjs.
// Reads V1 dev23's own deliveryLocation function: NEVER invents/copies another profile's scope.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {CapabilityGapRegistry} from './capability-gap-registry.mjs';
const V1_DELIVERY_SHA='a4b1dff7e8293136215b12ade45062dc0f3a034f677f92e4a656679b513c5c47';
const VERSION='0.1.0';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fail(code){throw Error('PORTABLE_CAPGAP_'+code);}
function parse(args){
 const [verb,...rest]=args;
 if(!['status','list','get','report','triage'].includes(verb))fail('ACTION_INVALID');
 const out={verb};
 for(let i=0;i<rest.length;i+=2){
  const k=rest[i],v=rest[i+1];
  if(!['--config','--delivery-module','--expected-profile','--expected-config-sha','--input'].includes(k)||!v||out[k]!==undefined)fail('ARGUMENT_INVALID');
  out[k]=v;
 }
 for(const k of ['--config','--delivery-module','--expected-profile','--expected-config-sha'])
  if(!out[k])fail('ARGUMENT_REQUIRED');
 if((verb==='report'||verb==='get'||verb==='triage')&&!out['--input'])fail('PRIVATE_INPUT_REQUIRED');
 if(['status','list'].includes(verb)&&out['--input'])fail('UNEXPECTED_INPUT');
 if(!/^[0-9a-f]{64}$/.test(out['--expected-config-sha']))fail('CONFIG_HASH_INVALID');
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(out['--expected-profile']))fail('PROFILE_INVALID');
 return out;
}
function regular(file,max=1024*1024){
 if(typeof file!=='string'||!path.isAbsolute(file))fail('ABSOLUTE_FILE_REQUIRED');
 let cursor=path.parse(path.resolve(file)).root;
 for(const bit of path.resolve(file).slice(cursor.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,bit);
  const stat=fs.lstatSync(cursor);
  if(stat.isSymbolicLink())fail('SYMLINK_PATH_DENIED');
 }
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.nlink!==1||st.size<1||st.size>max)fail('FILE_NOT_REGULAR');
 return fs.readFileSync(file);
}
function within(root,dir){
 const rel=path.relative(path.resolve(root),path.resolve(dir));
 return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));
}
let registry;
try{
 const opt=parse(process.argv.slice(2));
 const configPath=path.resolve(opt['--config']);
 const configRaw=regular(configPath,1024*1024);
 if(sha(configRaw)!==opt['--expected-config-sha'])fail('ACTIVE_CONFIG_HASH_MISMATCH');
 const config=JSON.parse(configRaw.toString('utf8'));
 const profile=config.instance?.profile??'default';
 if(profile!==opt['--expected-profile'])fail('ACTIVE_PROFILE_MISMATCH');
 const deliveryPath=path.resolve(opt['--delivery-module']);
 if(sha(regular(deliveryPath,64*1024))!==V1_DELIVERY_SHA)fail('PINNED_V1_DELIVERY_SOURCE_MISMATCH');
 const {deliveryLocation}=await import(pathToFileURL(deliveryPath).href);
 if(typeof deliveryLocation!=='function')fail('V1_DELIVERY_EXPORT_MISSING');
 const loc=deliveryLocation(config,configPath);
 if(!loc||typeof loc.directory!=='string'||typeof loc.scope!=='string')fail('V1_DELIVERY_SCOPE_INVALID');
 if((loc.forbiddenRoots||[]).some(root=>within(root,loc.directory)))fail('DELIVERY_INSIDE_PROJECT');
 const device=typeof config.deviceName==='string'&&config.deviceName.length<=110?config.deviceName:undefined;
 registry=new CapabilityGapRegistry({directory:loc.directory,scope:loc.scope,device});
 let args={};
 if(opt['--input']){
  const file=path.resolve(opt['--input']);
  const b=regular(file,8192);
  if(process.platform!=='win32'&&(fs.statSync(file).mode&0o077)!==0)fail('PRIVATE_INPUT_PERMISSIONS_INVALID');
  args=JSON.parse(b.toString('utf8'));
 }
 const action=opt.verb;
 const result=action==='status'?registry.status():
   action==='get'?registry.evidence(args):
   registry[action](args);
 console.log(JSON.stringify({schema:1,clientVersion:VERSION,profile,
   privateProfileOnly:true,readOnly:action==='status'||action==='list'||action==='get',
   result}));
}catch(error){
 const code=typeof error?.capabilityGapCode==='string'?error.capabilityGapCode:
   /^PORTABLE_CAPGAP_[A-Z0-9_]+$/.test(error?.message??'')?error.message:'PORTABLE_CAPGAP_FAILED';
 console.error(code);
 process.exitCode=2;
}finally{registry?.close();}
