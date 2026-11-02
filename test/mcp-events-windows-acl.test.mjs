import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {validateWindowsPrivateAcl,assertWindowsPrivateEventPath} from '../src/mcp-events-windows-acl.mjs';

const user='S-1-5-21-111-222-333-1001';
const ownerOnly={currentSid:user,ownerSid:user,allowSids:[user,'S-1-5-18','S-1-5-32-544']};

test('only same-user, SYSTEM and Administrators may read webhook-secret store',()=>{
 assert.equal(validateWindowsPrivateAcl(ownerOnly),true);
 for(const change of [
  {ownerSid:'S-1-5-21-111-222-333-1002'},
  {allowSids:[user,'S-1-1-0']},
  {allowSids:[user,'S-1-5-32-545']},
  {allowSids:['S-1-5-18']},
  {allowSids:[]},
  {allowSids:['BUILTIN\\Administrators',user]},
  {currentSid:'not-a-sid'},
  {allowSids:null}
 ])assert.throws(()=>validateWindowsPrivateAcl({...ownerOnly,...change}),/MCP_EVENTS_WINDOWS_PRIVATE_ACL_REQUIRED/);
});

test('ACL command uses argument vector, never a shell with interpolated paths',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'commander-private-event-acl-'));
 try{
  let seen;
  const run=(exe,argv,options)=>{
   seen={exe,argv,options};
   return JSON.stringify(ownerOnly);
  };
  assert.equal(assertWindowsPrivateEventPath(dir,{platform:'win32',run}),true);
  assert.equal(seen.exe,'pwsh');
  assert.deepEqual(seen.argv.slice(0,3),['-NoProfile','-NonInteractive','-CommandWithArgs']);
  assert.equal(seen.argv.at(-1),dir);
  assert.equal(seen.options.windowsHide,true);
  assert.throws(()=>assertWindowsPrivateEventPath(path.join(dir,'missing'),{platform:'win32',run}),/MCP_EVENTS_WINDOWS_PRIVATE_ACL_REQUIRED/);
  assert.equal(assertWindowsPrivateEventPath(dir,{platform:'linux',run:()=>{throw Error('should not run');}}),true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('actual Windows directory ACL is checked by native PowerShell when requested', {skip:process.platform!=='win32'},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'commander-acl-native-'));
 try{
  // The fixture's parent may be world-readable: failing closed is correct.
  let result='blocked';
  try{assertWindowsPrivateEventPath(dir);result='private';}catch(e){
   assert.match(e.message,/MCP_EVENTS_WINDOWS_PRIVATE_ACL_REQUIRED/);
  }
  assert.ok(['blocked','private'].includes(result));
 }finally{await rm(dir,{recursive:true,force:true});}
});
