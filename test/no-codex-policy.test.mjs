import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertNoCodexCommand,
  assertNoCodexDelegatingScript,
  assertNoCodexExecutable,
  assertNoCodexShellDelegation,
  commanderChildEnv,
  codexLaunchAuthorized,
  delegationRequirement,
  delegationStatus,
  isCodexExecutable,
  NO_CODEX_POLICY
} from '../src/no-codex-policy.mjs';

const POLICY_CODE='CODEX_DELEGATION_FORBIDDEN';

test('Codex executables and private/package paths are recognized', () => {
  for (const value of [
    'codex','codex.exe',
    'C:\\state\\tools\\codex-cli\\0.156.1\\node_modules\\@openai\\codex-win32-x64\\vendor\\bin\\codex.exe',
    '/state/tools/codex-cli/0.156.1/node_modules/@openai/codex-linux-x64/vendor/bin/codex',
    '/tmp/node_modules/.bin/codex'
  ]) assert.equal(isCodexExecutable(value),true,value);
  assert.equal(isCodexExecutable('code.exe'),false);
  assert.equal(NO_CODEX_POLICY.mode,'DEFAULT_DENY');
  assert.equal(NO_CODEX_POLICY.default,'CONTINUE_CHAT');
  assert.equal(NO_CODEX_POLICY.commanderMayLaunchCodex,false);
});

test('handoff gate offers only continue-chat or external Work/Codex and starts nothing', () => {
  const gate=delegationRequirement('Work/Codex may help');
  assert.equal(gate.approvalRequired,true);
  assert.equal(gate.default,'continue_chat');
  assert.deepEqual(gate.options.map(x=>x.id),['work_codex','continue_chat']);
  assert.equal(gate.commanderMayLaunchCodex,false);
  const status=delegationStatus();
  assert.equal(status.active,false);
  assert.equal(status.policy,'external-handoff-only');
  assert.equal(status.commanderMayLaunchCodex,false);
});

test('explicit Full-Power owner opt-in authorizes local Codex launch policy only for that profile', () => {
  const config={powerMode:{enabled:true,codexControl:{allowLaunch:true}},capabilityProfile:{tier:'FULL_POWER',explicitlyAuthorized:true}};
  assert.equal(codexLaunchAuthorized(config),true);
  assert.equal(delegationStatus(config).commanderMayLaunchCodex,true);
  assert.equal(delegationRequirement('requested',config).commanderMayLaunchCodex,true);
  assert.doesNotThrow(()=>assertNoCodexExecutable('codex.exe',{allowCodex:true}));
  assert.doesNotThrow(()=>assertNoCodexCommand('codex exec -',{allowCodex:true}));
  const env=commanderChildEnv(process.cwd(),{PATH:process.env.PATH,CODEX_HOME:'C:/owner-codex'},{allowCodex:true});
  assert.equal(env.REMOTE_COMMANDER_NO_CODEX,undefined);
  assert.equal(env.CODEX_HOME,'C:/owner-codex');
});

test('Codex opt-in is fail-closed outside explicitly authorized Full-Power', () => {
  for (const config of [
    {powerMode:{enabled:true,codexControl:{allowLaunch:true}},capabilityProfile:{tier:'STANDARD',explicitlyAuthorized:true}},
    {powerMode:{enabled:true,codexControl:{allowLaunch:true}},capabilityProfile:{tier:'FULL_POWER',explicitlyAuthorized:false}},
    {powerMode:{enabled:true,codexControl:{allowLaunch:false}},capabilityProfile:{tier:'FULL_POWER',explicitlyAuthorized:true}}
  ]) assert.equal(codexLaunchAuthorized(config),false);
});

test('direct and package-manager Codex commands fail closed', () => {
  for (const command of [
    'codex exec -',
    'codex.exe login status',
    'npx @openai/codex exec -',
    'npm exec @openai/codex -- exec -',
    'pnpm dlx @openai/codex',
    '& "C:\\state\\tools\\codex-cli\\0.156.1\\bin\\codex.exe" exec -'
  ]) assert.throws(() => assertNoCodexCommand(command), error => error?.code === POLICY_CODE, command);
  assert.doesNotThrow(() => assertNoCodexCommand('git status --short'));
  assert.throws(() => assertNoCodexExecutable('codex.exe'), error => error?.code === POLICY_CODE);
});

test('run-project preflight rejects scripts that launch Codex', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-no-codex-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const bad=path.join(dir,'worker.py');
  const indirect=path.join(dir,'indirect.py');
  const good=path.join(dir,'safe.py');
  fs.writeFileSync(bad,'import subprocess\nsubprocess.run(["codex","exec","-"])\n');
  fs.writeFileSync(indirect,'import subprocess\nCODEX=r"C:\\\\state\\\\tools\\\\codex-cli\\\\0.156.1\\\\bin\\\\codex.exe"\nsubprocess.Popen([CODEX,"exec","-"])\n');
  fs.writeFileSync(good,'print("safe")\n');
  for(const script of [bad,indirect]) {
    await assert.rejects(
      assertNoCodexDelegatingScript(process.platform==='win32'?'python.exe':'python',[script],dir),
      error => error?.code === POLICY_CODE
    );
  }
  await assert.doesNotReject(assertNoCodexDelegatingScript(process.platform==='win32'?'python.exe':'python',[good],dir));
});

test('shell preflight rejects script-mediated and package-manager Codex launches', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-no-codex-shell-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const bad=path.join(dir,'worker.py');
  fs.writeFileSync(bad,'import subprocess\nsubprocess.Popen(["codex","exec","-"])\n');
  await assert.rejects(
    assertNoCodexShellDelegation(`python "${bad}"`,dir),
    error => error?.code === POLICY_CODE
  );
  await assert.rejects(
    assertNoCodexShellDelegation('npx @openai/codex exec -',dir),
    error => error?.code === POLICY_CODE
  );
});

test('all Commander child environments strip OpenAI/Codex credentials', () => {
  const source={
    PATH:process.env.PATH,
    OPENAI_API_KEY:'secret',
    OPENAI_BASE_URL:'https://example.invalid',
    CODEX_ACCESS_TOKEN:'secret2',
    KEEP_ME:'yes'
  };
  for(const env of [
    commanderChildEnv(source),
    commanderChildEnv(process.cwd(),source)
  ]) {
    assert.equal(env.OPENAI_API_KEY,undefined);
    assert.equal(env.OPENAI_BASE_URL,undefined);
    assert.equal(env.CODEX_ACCESS_TOKEN,undefined);
    assert.equal(env.KEEP_ME,'yes');
    assert.equal(env.REMOTE_COMMANDER_NO_CODEX,'1');
    assert.ok(env.CODEX_HOME.includes('chatgpt-remote-commander-no-codex'));
  }
});
