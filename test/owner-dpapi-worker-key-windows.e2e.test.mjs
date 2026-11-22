// Actual Windows DPAPI CurrentUser and ACL integration on an isolated
// disposable synthetic owner fixture. NEVER touches live account/Tunnel roots.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
  createHash,createPrivateKey,createPublicKey,randomBytes,sign,verify
} from 'node:crypto';
import {createWindowsDpapiWorkerKeyProvider,
  createWindowsNativeOwnerSidHashResolver}
  from '../src/native-worker-key-provider-windows.mjs';

const ps=path.join(path.dirname(fileURLToPath(import.meta.url)),
  '../tools/owner-dpapi-worker-key-windows.ps1');
const PROFILE='chatgpt-remote-commander',HOST='qa-nonproduction';
const PREFIX=Buffer.from('302e020100300506032b657004220420','hex');
const sha=x=>createHash('sha256').update(x).digest('hex');
const POWERSHELL=path.join(process.env.ProgramFiles??'C:\\Program Files',
  'PowerShell','7','pwsh.exe');
function runPs(args,env,input){
  return spawnSync(POWERSHELL,args,{
    env:env??process.env,input:input??Buffer.alloc(0),
    encoding:'utf8',timeout:22000,maxBuffer:8192,windowsHide:true
  });
}
function scope(file,mode,owner,key,cert,host=HOST){
  return ['-NoLogo','-NoProfile','-NonInteractive','-File',file,
    '-Mode',mode,'-ProfileName',PROFILE,'-OwnerSidHash',owner,
    '-KeyId',key,'-ClientLeafSha256',cert,'-HostId',host];
}
test('isolated DPAPI Windows seed enroll/readback/revocation-like mismatch and no cross-scope grant',{
  skip:process.platform!=='win32',timeout:90000
},async()=>{
  const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-owner-dpapi-e2e-'));
  const fakeAppData=path.join(fixture,'fake-appdata');
  const pair=path.join(fakeAppData,'ChatGPTRemoteCommander',
    'private-pair','default');
  const capsule=path.join(pair,'worker-identity');
  const digestFile=path.join(capsule,'worker-ed25519-seed.dpapi');
  let seed,der,privateKey;
  try{
    fs.mkdirSync(pair,{recursive:true});
    // Restrict ONLY the synthetic fixture; live profile ACLs are not changed.
    const privateAclScript=[
      "$ErrorActionPreference='Stop'",
      "$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+
        Buffer.from(pair).toString('base64')+"'))",
      "$a=Get-Acl -LiteralPath $p",
      "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User",
      "$a.SetOwner($sid)",
      "$a.SetAccessRuleProtection($true,$false)",
      "foreach($rule in @($a.Access)){[void]$a.RemoveAccessRuleSpecific($rule)}",
      "$flags=[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor "+
        "[Security.AccessControl.InheritanceFlags]::ObjectInherit",
      "$r=[Security.AccessControl.FileSystemAccessRule]::new($sid,"+
        "[Security.AccessControl.FileSystemRights]::FullControl,$flags,"+
        "[Security.AccessControl.PropagationFlags]::None,"+
        "[Security.AccessControl.AccessControlType]::Allow)",
      "$a.AddAccessRule($r)",
      "Set-Acl -LiteralPath $p -AclObject $a"
    ].join('\n');
    const acl=runPs(['-NoProfile','-NonInteractive','-EncodedCommand',
      Buffer.from(privateAclScript,'utf16le').toString('base64')]);
    assert.equal(acl.status,0,'synthetic owner ACL must be created before QA');
    const owner=await createWindowsNativeOwnerSidHashResolver({
      ownerHashMode:'native-j01-v2'
    })();
    seed=randomBytes(32);
    der=Buffer.concat([PREFIX,seed]);
    privateKey=createPrivateKey({key:der,format:'der',type:'pkcs8'});
    const keyId=sha(createPublicKey(privateKey).export({
      type:'spki',format:'der'
    }));
    const cert=sha(randomBytes(48)),env={
      ...process.env,APPDATA:fakeAppData
    };
    const args=scope(ps,'Enroll',owner,keyId,cert);
    const enrolled=runPs(args,env,seed);
    assert.equal(enrolled.status,0,'synthetic owner DPAPI enrollment failed');
    assert.equal(enrolled.stdout.trim(),
      'RC012_WINDOWS_OWNER_DPAPI_WORKER_ENROLL_PASS');
    assert.equal(enrolled.stderr.trim(),'');
    assert.ok(fs.existsSync(digestFile));
    const provider=createWindowsDpapiWorkerKeyProvider({
      profileId:PROFILE,expectedKeyId:keyId,credentialPath:digestFile,
      ownerHashMode:'native-j01-v2',
      resolveOwnerSidHash:createWindowsNativeOwnerSidHashResolver({
        ownerHashMode:'native-j01-v2'
      })
    });
    const loaded=await provider.loadPrivateKey();
    const challenge=randomBytes(32);
    const signature=sign(null,challenge,loaded);
    assert.equal(verify(null,challenge,createPublicKey(privateKey),signature),true);
    signature.fill(0);challenge.fill(0);
    const checked=runPs(scope(ps,'Verify',owner,keyId,cert),env);
    assert.equal(checked.status,0);
    assert.equal(checked.stdout.trim(),
      'RC012_WINDOWS_OWNER_DPAPI_WORKER_VERIFY_PASS');
    assert.equal(checked.stderr.trim(),'');
    // Existing capsules MUST NOT be silently regenerated or overwritten.
    const replay=runPs(args,env,seed);
    assert.equal(replay.status,2);
    const wrongOwner=runPs(scope(ps,'Verify','f'.repeat(64),keyId,cert),env);
    assert.equal(wrongOwner.status,2);
    const wrongCert=runPs(scope(ps,'Verify',owner,keyId,'e'.repeat(64)),env);
    assert.equal(wrongCert.status,2);
    // Read-only identity receipt changes cannot be laundered into a valid key.
    const receiptFile=path.join(capsule,'worker-key-id.json');
    const oldReceipt=fs.readFileSync(receiptFile);
    try{
      const r=JSON.parse(oldReceipt.toString('utf8'));
      r.cipherSha256='0'.repeat(64);
      fs.writeFileSync(receiptFile,JSON.stringify(r));
      const tampered=runPs(scope(ps,'Verify',owner,keyId,cert),env);
      assert.equal(tampered.status,2);
    }finally{fs.writeFileSync(receiptFile,oldReceipt);oldReceipt.fill(0);}
    assert.equal(fs.existsSync(path.join(pair,'.worker-identity-provision.lock')),false);
    assert.equal(fs.readdirSync(pair).some(x=>x.startsWith('.worker-identity-stage-')),false);
  }finally{
    seed?.fill(0);der?.fill(0);
    // Only this exact randomly created synthetic temp root is in-scope.
    assert.ok(path.basename(fixture).startsWith('rc012-owner-dpapi-e2e-'));
    fs.rmSync(fixture,{recursive:true,force:true});
  }
});
