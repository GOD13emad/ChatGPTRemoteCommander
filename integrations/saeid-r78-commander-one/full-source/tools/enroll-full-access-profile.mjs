#!/usr/bin/env node
// One profile at a time. Never installs a privileged service, bypasses UAC/sudo,
// or changes operating-system permissions. Requires the existing native broker.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, lstat, open, rename, unlink } from 'node:fs/promises';
import { requestPrivilegeBroker } from '../src/privilege-client.mjs';
import { verifyPrivilegedBrokerProof } from '../src/full-access-status.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function assertNoDuplicateJsonKeys(raw) {
  const stack = [];
  for(let i=0;i<raw.length;) {
    const c=raw[i];
    if(c==='"') {
      let j=i+1, escaped=false;
      for(;j<raw.length;j++) {
        if(escaped){escaped=false;continue;}
        if(raw[j]==='\\'){escaped=true;continue;}
        if(raw[j]==='"')break;
      }
      if(j===raw.length)throw Error('INVALID_JSON_STRING');
      const top=stack.at(-1);
      if(top?.type==='object' && top.expectKey) {
        const key=JSON.parse(raw.slice(i,j+1));
        if(top.keys.has(key))throw Error('DUPLICATE_JSON_KEY');
        top.keys.add(key);top.expectKey=false;
      }
      i=j+1;continue;
    }
    if(c==='{')stack.push({type:'object',keys:new Set(),expectKey:true});
    else if(c==='[')stack.push({type:'array'});
    else if(c==='}'||c===']')stack.pop();
    else if(c===',' && stack.at(-1)?.type==='object')stack.at(-1).expectKey=true;
    i++;
  }
}

export function prepareFullAccessProfile(config, proof, platform) {
  if(!config || typeof config!=='object' || Array.isArray(config))throw Error('CONFIG_INVALID');
  const profile=config.capabilityProfile;
  if(!profile || profile.explicitlyAuthorized!==true || profile.tier!=='FULL_POWER' &&
      profile.tier!=='FULL_ACCESS' || config.powerMode?.enabled!==true) {
    throw Error('PROFILE_REQUIRES_EXPLICIT_FULL_POWER_OWNER_GRANT');
  }
  if(!verifyPrivilegedBrokerProof(proof,platform))throw Error('NATIVE_PRIVILEGED_BROKER_NOT_VERIFIED');
  if(profile.tier==='FULL_ACCESS')return {changed:false,config};
  return {changed:true,config:{
    ...config,
    capabilityProfile:{
      ...profile,tier:'FULL_ACCESS',source:'native-broker-verified-enrollment',
      persistAcrossUpdates:true
    }
  }};
}

async function inspectRuntime(runtimeRoot) {
  const server=path.join(runtimeRoot,'src','server-v0.3.mjs');
  const status=path.join(runtimeRoot,'src','full-access-status.mjs');
  const profile=path.join(runtimeRoot,'src','capability-profile.mjs');
  try {
    for(const f of [server,status,profile]) {
      const st=await lstat(f);
      if(!st.isFile()||st.isSymbolicLink())return false;
    }
    const [s,p]=await Promise.all([readFile(server,'utf8'),readFile(profile,'utf8')]);
    return s.includes('createAccessStatusReader') && s.includes('        accessStatus,') &&
      p.includes('FULL_ACCESS_NATIVE_BROKER_PROOF_REQUIRED');
  }catch{return false;}
}

async function writePrivate(file,buffer) {
  const fd=await open(file,'wx',0o600);
  try{await fd.writeFile(buffer);await fd.sync();}
  finally{await fd.close();}
}

function parseArgs(argv) {
  const opts={};
  for(let i=0;i<argv.length;i++) {
    const k=argv[i];
    if(k==='--check'||k==='--apply') {
      if(opts.mode)throw Error('ONE_MODE_REQUIRED');
      opts.mode=k;
    } else if(['--config','--runtime-root','--expected-sha'].includes(k)) {
      if(opts[k] || !argv[i+1])throw Error('ARGUMENT_INVALID');
      opts[k]=argv[++i];
    } else throw Error('ARGUMENT_UNKNOWN');
  }
  if(!opts.mode || !opts['--config'] || !opts['--runtime-root'])throw Error('CONFIG_RUNTIME_AND_MODE_REQUIRED');
  if(opts.mode==='--apply' && !/^[a-f0-9]{64}$/.test(opts['--expected-sha']||''))throw Error('EXACT_CONFIG_SHA_REQUIRED');
  if(!path.isAbsolute(opts['--config'])||!path.isAbsolute(opts['--runtime-root']))throw Error('ABSOLUTE_PATH_REQUIRED');
  return opts;
}

export async function runCli(argv, { probe=requestPrivilegeBroker, platform=process.platform }={}) {
  const opts=parseArgs(argv);
  const filename=path.resolve(opts['--config']);
  const runtimeRoot=path.resolve(opts['--runtime-root']);
  const st=await lstat(filename);
  if(!st.isFile() || st.isSymbolicLink())throw Error('REGULAR_CONFIG_REQUIRED');
  const original=await readFile(filename);
  if(original.byteLength>4*1024*1024)throw Error('CONFIG_TOO_LARGE');
  const originalSha=digest(original);
  if(opts['--expected-sha'] && originalSha!==opts['--expected-sha'])throw Error('CONFIG_SHA_CHANGED');
  const raw=original.toString('utf8');
  assertNoDuplicateJsonKeys(raw);
  const config=JSON.parse(raw);
  const runtimeReady=await inspectRuntime(runtimeRoot);
  const proof=await probe('os.probe',{platform});
  const proposed=prepareFullAccessProfile(config,proof,platform);
  const response={profile:config.instance?.profile||config.capabilityProfile?.id||'default',
    beforeTier:config.capabilityProfile.tier,afterTier:proposed.config.capabilityProfile.tier,
    brokerVerified:true,runtimeReady,configSha256:originalSha,changed:proposed.changed,
    configuredTierOnly:true,operationalFullAccess:false,fullAccessActive:false,
    privilegedActionGrantRequired:true};
  if(opts.mode==='--check')return {...response,mode:'CHECK',canApply:runtimeReady};
  if(!runtimeReady)throw Error('FULL_ACCESS_RUNTIME_NOT_DEPLOYED');
  if(!proposed.changed)return {...response,mode:'NO_OP'};
  const updated=Buffer.from(JSON.stringify(proposed.config,null,2)+'\n','utf8');
  const dir=path.dirname(filename);
  const backup=path.join(dir,'.'+path.basename(filename)+'.before-full-access-'+originalSha.slice(0,12));
  const temp=path.join(dir,'.'+path.basename(filename)+'.full-access-stage-'+randomUUID());
  try { await writePrivate(backup,original); }
  catch (error) {
    if (error?.code !== 'EEXIST' || digest(await readFile(backup)) !== originalSha) {
      throw Error('ENROLLMENT_BACKUP_CONFLICT');
    }
  }
  try {
    await writePrivate(temp,updated);
    if(digest(await readFile(filename))!==originalSha)throw Error('CONFIG_CHANGED_DURING_ENROLLMENT');
    await rename(temp,filename);
  } finally {await unlink(temp).catch(()=>{});}
  const confirm=await readFile(filename);
  if(digest(confirm)!==digest(updated))throw Error('CONFIG_WRITE_NOT_VERIFIED');
  return {...response,mode:'APPLIED',updatedSha256:digest(updated),
    effectiveTierRequiresRuntimeRestart:true,privilegedActionGrantRequired:true,
    backupCreated:true};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(String(error?.message||error));process.exitCode=1;});
}
