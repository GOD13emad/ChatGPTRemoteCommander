// Read-only, native systemd LoadCredentialEncrypted proof for an EXISTING
// owner-pinned Ed25519 Worker key; never generates, exports, enrolls or grants.
// Invoked explicitly by an owner-controlled systemd --user transient service.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,createPublicKey,randomBytes,sign,verify}
  from 'node:crypto';
import {createLinuxNativeOwnerSessionProvider}
  from '../src/native-owner-session-provider-linux.mjs';
import {readLinuxOwnerTunnelPin}
  from '../src/linux-private-tunnel-owner-pin.mjs';
import {createSystemdWorkerKeyProvider}
  from '../src/native-worker-key-provider-linux.mjs';

const PROFILE=/^[A-Za-z0-9_-]{1,64}$/;
const SHA=/^[a-f0-9]{64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=b=>createHash('sha256').update(b).digest('hex');

function privateFile(file,uid){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1
    ||stat.uid!==uid||(stat.mode&0o077)!==0
    ||stat.size<1||stat.size>4096)
    fail('RC012_NATIVE_WORKER_QA_OWNER_FILE_UNTRUSTED');
  return fs.readFileSync(file);
}
async function main(){
  if(process.platform!=='linux'||process.geteuid()===0
    ||process.argv.length!==3||!PROFILE.test(process.argv[2])
    ||process.env.RC012_QA_NATIVE_WORKER_SCOPE!=='VERIFY_EXISTING_NO_GRANT'
    ||typeof process.env.CREDENTIALS_DIRECTORY!=='string')
    fail('RC012_NATIVE_WORKER_QA_SCOPE_REQUIRED');
  const profile=process.argv[2],home=os.homedir(),uid=process.geteuid();
  const parent=path.join(home,'.local','state',
    'chatgpt-remote-commander','private-pair-security-'+profile);
  const capsule=path.join(parent,'worker-identity');
  const dirStat=fs.lstatSync(capsule);
  if(!dirStat.isDirectory()||dirStat.isSymbolicLink()
    ||dirStat.uid!==uid||(dirStat.mode&0o077)!==0)
    fail('RC012_NATIVE_WORKER_QA_OWNER_CAPSULE_UNTRUSTED');
  const raw=privateFile(path.join(capsule,'worker-key-id.json'),uid);
  let receipt;
  try{receipt=JSON.parse(raw.toString('utf8'));}
  finally{raw.fill(0);}
  if(receipt.schema!==2||receipt.profileId!==profile
    ||![receipt.ownerSidHash,receipt.clientLeafDerSha256,
      receipt.keyId,receipt.cipherSha256].every(h=>
      typeof h==='string'&&SHA.test(h)))
    fail('RC012_NATIVE_WORKER_QA_RECEIPT_INVALID');
  const native=createLinuxNativeOwnerSessionProvider({
    ownerIdentityMode:'host-uid-v2'
  });
  const currentOwner=await native.resolveOwnerSidHash();
  const pair=path.join(home,'.config','chatgpt-remote-commander',
    'private-pair',profile==='chatgpt-remote-commander'?'default':profile);
  const pinned=readLinuxOwnerTunnelPin({directory:pair,ownerUid:uid});
  if(receipt.ownerSidHash!==currentOwner
    ||pinned.profileId!==profile||pinned.hostId!==receipt.hostId
    ||receipt.clientLeafDerSha256!==pinned.expectedClientLeafDerSha256)
    fail('RC012_NATIVE_WORKER_QA_OWNER_TUNNEL_CHANGED');
  const encrypted=privateFile(
    path.join(capsule,'worker-ed25519-seed.cred'),uid);
  const cipherHash=sha(encrypted);
  encrypted.fill(0);
  if(cipherHash!==receipt.cipherSha256)
    fail('RC012_NATIVE_WORKER_QA_CIPHER_CHANGED');
  const provider=createSystemdWorkerKeyProvider({
    profileId:profile,expectedKeyId:receipt.keyId
  });
  const privateKey=await provider.loadPrivateKey();
  const publicKey=createPublicKey(privateKey);
  const pub=publicKey.export({type:'spki',format:'der'});
  if(sha(pub)!==receipt.keyId)
    fail('RC012_NATIVE_WORKER_QA_KEY_ID_MISMATCH');
  const nonce=randomBytes(64);
  let proof;
  try{
    proof=sign(null,nonce,privateKey);
    if(proof.length!==64||verify(null,nonce,publicKey,proof)!==true)
      fail('RC012_NATIVE_WORKER_QA_SIGNATURE_INVALID');
  }finally{proof?.fill(0);nonce.fill(0);}
  console.log(JSON.stringify({
    result:'RC012_ACTUAL_SYSTEMD_OWNER_WORKER_KEY_SIGN_VERIFY_PASS',
    profile,ownerSidAndTunnelPinned:true,
    encryptedReceiptVerified:true,nativeCredentialLoaded:true,
    ephemeralEd25519SignatureVerified:true,
    workerGrantIssued:false,coreToolDispatched:false,
    productionTunnelChanged:false
  }));
}
main().catch(error=>{
  console.error(error?.code?.startsWith?.('RC012_')||error?.code?.startsWith?.('NATIVE_WORKER_')
    ?error.code:'RC012_NATIVE_WORKER_QA_FAILED');
  process.exitCode=2;
});
