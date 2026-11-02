// Generate disposable TLS test identities locally; never bundle private keys or
// accept these identities for a real Commander service / production tunnel.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

export function createV2SyntheticTunnelFixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-synthetic-tunnel-'));
 fs.chmodSync(dir,0o700);
 const run=(...args)=>execFileSync('openssl',args,{
  cwd:dir,stdio:'ignore',timeout:15000
 });
 const put=(name,value)=>fs.writeFileSync(path.join(dir,name),value,{
  encoding:'utf8',flag:'wx',mode:0o600
 });
 try{
  run('req','-x509','-newkey','rsa:2048','-nodes','-sha256',
   '-days','1800','-keyout','ca-key.pem','-out','ca.pem',
   '-subj','/CN=V2 synthetic QA CA',
   '-addext','basicConstraints=critical,CA:TRUE',
   '-addext','keyUsage=critical,keyCertSign,cRLSign');
  run('req','-newkey','rsa:2048','-nodes','-keyout','server-key.pem',
   '-out','server.csr','-subj','/CN=localhost');
  put('server.ext','basicConstraints=CA:FALSE\nsubjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n');
  run('x509','-req','-in','server.csr','-CA','ca.pem','-CAkey',
   'ca-key.pem','-CAcreateserial','-out','server-cert.pem',
   '-days','1800','-sha256','-extfile','server.ext');
  run('req','-newkey','rsa:2048','-nodes','-keyout','client-key.pem',
   '-out','client.csr','-subj','/CN=commander-v2-tunnel-client');
  put('client.ext','basicConstraints=CA:FALSE\nsubjectAltName=DNS:commander-v2-tunnel-client\nextendedKeyUsage=clientAuth\nkeyUsage=digitalSignature\n');
  run('x509','-req','-in','client.csr','-CA','ca.pem','-CAkey',
   'ca-key.pem','-CAcreateserial','-out','client-cert.pem',
   '-days','1800','-sha256','-extfile','client.ext');
  for(const f of fs.readdirSync(dir))fs.chmodSync(path.join(dir,f),0o600);
  const to64=name=>fs.readFileSync(path.join(dir,name)).toString('base64');
  put('test-only-keys.json',JSON.stringify({
   purpose:'synthetic-only-test-fixture',schema:1,notForDeployment:true,
   serverPrivateKeyPemBase64:to64('server-key.pem'),
   clientPrivateKeyPemBase64:to64('client-key.pem')
  }));
  // Keep keys in a private user-local temp root while this test process runs.
  // Never write them to the source tree, command output, or persistent QA.
  process.once('exit',()=>{try{fs.rmSync(dir,{recursive:true,force:true})}catch{}});
  return dir;
 }catch(e){
  fs.rmSync(dir,{recursive:true,force:true});
  throw Object.assign(new Error('V2_SYNTHETIC_TEST_OPENSSL_REQUIRED'),
   {code:'V2_SYNTHETIC_TEST_OPENSSL_REQUIRED',cause:e});
 }
}
