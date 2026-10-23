import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const script=fileURLToPath(new URL('./gui-owner-native-pipe-qa.ps1',import.meta.url));
const pwsh='pwsh.exe';
const spawnQa=(args)=>{
 const child=spawn(pwsh,['-NoProfile','-NonInteractive','-File',script,...args],{
  windowsHide:true,stdio:['ignore','pipe','pipe']
 });
 const out={stdout:'',stderr:'',child};
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',s=>out.stdout+=s);
 child.stderr.on('data',s=>out.stderr+=s);
 out.closed=new Promise((resolve,reject)=>{
  child.on('error',reject);
  child.on('close',code=>resolve(code));
 });
 return out;
};
async function actualPipeProbe(claim){
 const name='rc-owner-qa-'+randomBytes(16).toString('hex');
 const server=spawnQa(['-Mode','server','-PipeName',name]);
 let client;
 const timeout=setTimeout(()=>{
  server.child.kill();
  if(client)client.child.kill();
 },12000);
 try{
  await Promise.race([
   new Promise((resolve,reject)=>{
    const check=()=>{if(server.stdout.includes('QA_PIPE_READY'))resolve();};
    server.child.stdout.on('data',check);
    server.child.on('exit',()=>reject(Error('Server exited before ready: '+server.stderr)));
    check();
   }),
   new Promise((_,reject)=>setTimeout(()=>reject(Error('QA server startup timed out')),7000))
  ]);
  client=spawnQa(['-Mode','client','-PipeName',name,'-UntrustedClaim',claim]);
  const [c,s]=await Promise.all([client.closed,server.closed]);
  assert.equal(c,0,client.stderr);
  assert.equal(s,0,server.stderr);
  const parsed=JSON.parse(client.stdout.trim());
  assert.equal(parsed.schema,'rc-qa-os-pipe-peer-v1');
  assert.equal(parsed.osTokenPeerMatchesServer,true);
  assert.equal(parsed.accessAclExplicit,true);
  assert.equal(parsed.claimedIdentityUsed,false);
  assert.equal(parsed.ownerAuthenticated,false);
  assert.equal(parsed.releaseAuthorized,false);
  assert.equal(parsed.nativeOutcome,'UNKNOWN');
  return parsed;
 }finally{
  clearTimeout(timeout);
  if(server.child.exitCode===null)server.child.kill();
  if(client&&client.child.exitCode===null)client.child.kill();
 }
}
test('actual Windows pipe uses peer OS impersonation, not declared SYSTEM', {skip:process.platform!=='win32',timeout:16000},async()=>{
 const r=await actualPipeProbe('S-1-5-18');
 assert.match(r.notes,/NOT physical-owner approval/);
});
test('spoofed arbitrary claimed SID cannot change privilege outcome', {skip:process.platform!=='win32',timeout:16000},async()=>{
 const a=await actualPipeProbe('S-1-5-18');
 const b=await actualPipeProbe('S-1-5-32-544');
 assert.deepEqual(a,b);
});
test('invalid pipe name fails before any OS connection', {skip:process.platform!=='win32',timeout:10000},async()=>{
 const p=spawnQa(['-Mode','client','-PipeName','..\\bad']);
 const code=await p.closed;
 assert.notEqual(code,0);
 assert.equal(p.stdout.includes('releaseAuthorized'),false);
});
