import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Default commit destination: test/security-audit-provenance.test.mjs.
// Overrides exist only to qualify the identical test against an isolated scanner.
const repo=process.env.RC_SECURITY_AUDIT_GIT_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scannerFile=process.env.RC_SECURITY_AUDIT_SCANNER_PATH ||
  path.join(repo,'test','security-audit.mjs');
const source=fs.readFileSync(scannerFile,'utf8');
const start=source.indexOf('const patterns =');
const end=source.indexOf('const boundaryProbe =');
assert.ok(start>=0&&end>start,'Audit scanner declaration bounds must be explicit');
const api=vm.runInNewContext(source.slice(start,end)+
  '\n({makeHistoryScanner,patterns,KNOWN_INVALID_PEM_FIXTURE,KNOWN_INVALID_BEARER_FIXTURES})',
  {Buffer},{timeout:1000});

const PEM='Private key block',BEARER='Bearer token literal';
const expected=[
 [PEM,'d890bd978b07aa738ceeef97bd6af2782538bac1','test/v2-mcp-http-ingress.test.mjs','c5a00fec5ba8ec5e'],
 [PEM,'d890bd978b07aa738ceeef97bd6af2782538bac1','test/v2-mcp-http-ingress.test.mjs','642666ec0adf94ef'],
 [BEARER,'456e37e2553b4268b3ee0b22cd193be00911ef87','test/v2-oauth-v1-mcp-dispatcher.test.mjs','8272109f95e18312'],
 [BEARER,'456e37e2553b4268b3ee0b22cd193be00911ef87','test/v2-oauth-v1-mcp-dispatcher.test.mjs','b1bc25c1f8b8e215'],
 [BEARER,'456e37e2553b4268b3ee0b22cd193be00911ef87','test/v2-oauth-v1-mcp-dispatcher.test.mjs','2545a1ac17808792'],
 [BEARER,'fab67310c53f0a2e50b1568d062c0a0bc65ad02d','test/v2-capability-gap-registry.test.mjs','92be4c62c850f4c4'],
 [BEARER,'5b713ab4f34883f5b916b0009caabafde63a255d','test/v2-capability-gap-registry.test.mjs','24cacbe3a36df2a2'],
 [BEARER,'e9f1681a9ad85c4d4a34c31425df96bf24b15567','test/v2-oauth-v1-mcp-dispatcher.test.mjs','be67c7c80a073d0c'],
 [BEARER,'e9f1681a9ad85c4d4a34c31425df96bf24b15567','test/v2-oauth-v1-mcp-dispatcher.test.mjs','75ee5eb8ec5b34c3'],
 [BEARER,'27c84a7db84efb863348f39384221b7c378a7871','test/v2-oauth-v1-mcp-dispatcher.test.mjs','507b380675074a7e'],
 [BEARER,'27c84a7db84efb863348f39384221b7c378a7871','test/v2-oauth-v1-mcp-dispatcher.test.mjs','f4603e811c4aa531']
];
const key=x=>x.join(':');
function fingerprint(line){
 let h=0xcbf29ce484222325n;
 for(const b of Buffer.from(line))h=BigInt.asUintN(64,(h^BigInt(b))*0x100000001b3n);
 return h.toString(16).padStart(16,'0');
}
function history(commit,file,line,decorated=false){
 return 'commit '+commit+(decorated?' (HEAD -> provenance-fixture)':'')+
  '\ndiff --git a/'+file+' b/'+file+'\n'+line;
}
function scan(text,split){
 const s=api.makeHistoryScanner(api.patterns);
 if(split===undefined)s.write(text);else{s.write(text.slice(0,split));s.write(text.slice(split));}
 return s.finish();
}
const marker='-----BEGIN '+'PRIVATE KEY-----';
const arbitraryCommit='f'.repeat(40);
const knownCommit=expected[0][1],knownPath=expected[0][2];

test('history exception registry is exactly eleven reviewed immutable lines',()=>{
 const actual=[
  ...[...api.KNOWN_INVALID_PEM_FIXTURE.fingerprints].map(fp=>[
   PEM,api.KNOWN_INVALID_PEM_FIXTURE.commit,api.KNOWN_INVALID_PEM_FIXTURE.path,fp]),
  ...api.KNOWN_INVALID_BEARER_FIXTURES.map(x=>[BEARER,x.commit,x.path,x.fingerprint])
 ];
 assert.deepEqual(actual.map(key).sort(),expected.map(key).sort());
 assert.equal(new Set(actual.map(key)).size,11);
});
test('unrelated private marker is rejected in an arbitrary source path',()=>{
 assert.equal(scan(history(arbitraryCommit,'src/unrelated.mjs','+'+marker+'\n')).has(PEM),true);
});
test('a new real private key in memory never inherits a reviewed fixture scope',()=>{
 const key=generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'});
 assert.equal(scan(history(knownCommit,knownPath,'+'+key.split('\n').join('\n+'))).has(PEM),true);
});
test('same reviewed commit/path with changed private marker line remains a finding',()=>{
 const line="+  privateKeyPem:'"+marker+"other-value'\n";
 assert.equal(scan(history(knownCommit,knownPath,line)).has(PEM),true);
});
test('new bearer-shaped value is rejected even under a reviewed bearer file and commit',()=>{
 const entry=expected.find(x=>x[0]===BEARER);
 const line='+authorization: B'+'earer '+ 'x'.repeat(40)+'\n';
 assert.equal(scan(history(entry[1],entry[2],line)).has(BEARER),true);
});
test('nonfixture bearer across a newline survives every chunk split',()=>{
 const text='B'+'earer \n'+'A'.repeat(30)+'\n';
 for(let i=0;i<=text.length;i++)assert.equal(scan(text,i).has(BEARER),true);
});
test('nonfixture private marker survives every chunk split',()=>{
 const text='prefix\n'+marker+'\n';
 for(let i=0;i<=text.length;i++)assert.equal(scan(text,i).has(PEM),true);
});
test('one credential type never suppresses an adjacent different credential type',()=>{
 const text=history(knownCommit,knownPath,'+'+marker+'\n')+
  '+B'+'earer '+'z'.repeat(40)+'\n';
 const hits=scan(text);
 assert.equal(hits.has(PEM),true);assert.equal(hits.has(BEARER),true);
});
test('exact reviewed public fixtures, provenance mutations and decorated/chunked context',(t)=>{
 const commitCache=new Map(),patchCache=new Map(),fixtures=[];
 for(const [type,commit,file,fp]of expected){
  if(!commitCache.has(commit)){
   const present=spawnSync('git',['cat-file','-e',commit+'^{commit}'],{
    cwd:repo,windowsHide:true,encoding:'utf8',maxBuffer:1024*1024});
   assert.equal(present.error?.code,undefined,'Git must be available on PATH');
   commitCache.set(commit,present.status===0);
  }
  if(!commitCache.get(commit)){
   if(process.env.RC_SECURITY_AUDIT_REQUIRE_PUBLIC_FIXTURES==='1')
    assert.fail('Required immutable public fixture commit unavailable: '+commit);
   t.skip('Public branch history unavailable; negative controls still run');
   return;
  }
  const patchKey=commit+':'+file;
  if(!patchCache.has(patchKey)){
   const shown=spawnSync('git',['show','--format=','--no-color','--no-ext-diff',commit,'--',file],{
    cwd:repo,windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024});
   assert.equal(shown.status,0,'Public immutable fixture patch must be readable');
   patchCache.set(patchKey,shown.stdout.match(/[^\n]*\n|[^\n]+$/g)||[]);
  }
  const line=patchCache.get(patchKey).find(x=>fingerprint(x)===fp);
  assert.equal(typeof line,'string','Exact reviewed fixture fingerprint must resolve');
  fixtures.push({type,commit,file,line});
 }
 for(const fixture of fixtures){
  const {type,commit,file,line}=fixture;
  assert.equal(scan(history(commit,file,line)).has(type),false);
  assert.equal(scan(history(commit,file,line,true)).has(type),false);
  const text=history(commit,file,line);
  for(let split=0;split<=text.length;split++)assert.equal(scan(text,split).has(type),false);
  for(const [c,p,l]of [
   [arbitraryCommit,file,line],[commit,'test/unreviewed.test.mjs',line],
   [commit,file,(line[0]==='+'?'-':'+')+line.slice(1)],
   [commit,file,line.trimEnd()+' \n']
  ])assert.equal(scan(history(c,p,l)).has(type),true);
  assert.equal(scan(history(commit,file,line)+'+B'+'earer '+'q'.repeat(40)+'\n').has(BEARER),true);
 }
});
