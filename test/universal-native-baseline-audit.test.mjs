import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {audit,auditExitCode} from '../tools/universal-install/native-baseline-audit.mjs';

const P=process.platform==='win32'?'C:\\test\\previous.exe':'/qa/previous.deb';
const R=process.platform==='win32'?'C:\\test\\installed':'/qa/installed';
const H='a'.repeat(64);
const valid=['--previous',P,'--sha256',H,'--installed-root',R];
test('read-only native baseline audit denies missing and malformed identity',async()=>{
  const invalid=[
    [],valid.slice(0,4),
    ['--previous','relative.deb','--sha256',H,'--installed-root',R],
    ['--previous',P,'--sha256','UNTRUSTED','--installed-root',R],
    ['--previous',P,'--previous',P,'--installed-root',R],
    ['--previous',P,'--sha256',H,'--random',R]
  ];
  for(const x of invalid)await assert.rejects(audit(x),{
    code:/NATIVE_BASELINE_AUDIT_(ARGS_REQUIRED|ARGS_INVALID|IDENTITY_INVALID)/
  });
});
test('read-only native baseline audit CLI reports denial, not an owner approval',()=>{
  const file=fileURLToPath(new URL('../tools/universal-install/native-baseline-audit.mjs',import.meta.url));
  const proc=spawnSync(process.execPath,[file],{
    encoding:'utf8',timeout:10000
  });
  assert.equal(proc.status,2);
  const denial=JSON.parse(proc.stderr.trim());
  assert.equal(denial.status,'DENIED');
  assert.equal(denial.completeRestoreVerified,false);
  assert.equal(proc.stdout.trim(),'');
});

test('nonzero audit CLI exit codes prevent CI from mistaking partial parity or drift for full restore',()=>{
  assert.equal(auditExitCode({status:'ARCHIVE_MEMBERS_DIFFER'}),3);
  assert.equal(auditExitCode({status:'ARCHIVE_MEMBERS_MATCHED_ONLY'}),4);
  assert.equal(auditExitCode({status:'DENIED'}),2);
  assert.equal(auditExitCode(null),2);
  for(const incomplete of [
    {status:'ARCHIVE_MEMBERS_DIFFER',completeRestoreVerified:false},
    {status:'ARCHIVE_MEMBERS_MATCHED_ONLY',completeRestoreVerified:false}
  ]) assert.notEqual(auditExitCode(incomplete),0);
});
