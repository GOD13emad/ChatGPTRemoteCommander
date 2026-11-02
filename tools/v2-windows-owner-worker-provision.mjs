// Native logged-in Windows owner only; restricted V2 diagnostic worker identity.
import {mkdir,writeFile,readFile,lstat} from 'node:fs/promises';
import {homedir,userInfo} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
async function acl(target,sid,isDirectory){
 const grant=isDirectory?'*'+sid+':(OI)(CI)F':'*'+sid+':F';
 const system=isDirectory?'*S-1-5-18:(OI)(CI)F':'*S-1-5-18:F';
 try{await exec('icacls.exe',[target,'/inheritance:r','/grant:r',grant,system],
  {windowsHide:true,timeout:8500,maxBuffer:4096});}
 catch{fail('V2_WINDOWS_OWNER_ACL_REQUIRED');}
}
export async function provisionOwnerWindowsWorker({owner='Aa.Emad',root=join(homedir(),'AppData','Local','CommanderV2','Worker')}={}){
 if(process.platform!=='win32'||userInfo().username.toLowerCase()!==owner.toLowerCase()||
  resolve(homedir()).toLowerCase()!==resolve('C:\\Users\\Aa.Emad').toLowerCase()||
  resolve(root).toLowerCase()!==resolve(join(homedir(),'AppData','Local','CommanderV2','Worker')).toLowerCase())
   fail('V2_NATIVE_INTERACTIVE_OWNER_REQUIRED');
 const info=await exec('whoami.exe',['/user','/fo','csv','/nh'],
  {timeout:6000,maxBuffer:2048,windowsHide:true});
 const sid=info.stdout.match(/S-1-5-21-(?:\d+-){3}\d+/)?.[0];
 if(!sid)fail('V2_WINDOWS_OWNER_SID_UNVERIFIED');
 const tokenPath=join(root,'mmz-coordinator.token');
 const recordPath=join(root,'registration.json');
 try{await lstat(root);fail('V2_WORKER_ROOT_ALREADY_EXISTS');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 await mkdir(root,{mode:0o700});
 await acl(root,sid,true);
 const token=randomBytes(32).toString('base64url');
 await writeFile(tokenPath,token,{flag:'wx'});
 await acl(tokenPath,sid,false);
 const record=Object.freeze({schema:1,kind:'V2_OWNER_DIAGNOSTIC_ONLY',owner,
  hostId:'Emad-PC-Ultimate',principalId:'Aa.Emad',profileId:'owner',
  conversationId:'local-v2-diagnostic',operationId:'win-tailnet-proof-20261031',
  target:{kind:'workflow-root',id:'commander-v2-diagnostic'},
  tokenSha256:hash(token),chatGPTAuthenticated:false});
 await writeFile(recordPath,JSON.stringify(record),{flag:'wx'});
 await acl(recordPath,sid,false);
 if(hash(await readFile(tokenPath,'utf8'))!==record.tokenSha256)
  fail('V2_WORKER_CREDENTIAL_READBACK_FAIL');
 return record;
}
if(process.argv[1]&&resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()){
 try{const r=await provisionOwnerWindowsWorker();
  process.stdout.write('V2_OWNER_WORKER_PROVISIONED '+r.tokenSha256+'\n');
 }catch(e){process.stderr.write(String(e.code||'V2_OWNER_PROVISION_FAILED')+'\n');process.exitCode=2;}
}
