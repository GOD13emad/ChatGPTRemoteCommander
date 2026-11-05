import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const load=name=>fs.readFileSync(new URL(name,new URL('../',import.meta.url)),'utf8');

test('V2 installer workflow runs only on scoped candidate changes, hosted runner matrix and read-only checkout',()=>{
 const body=load('.github/workflows/v2-unsigned-installer-qa.yml');
 assert.match(body,/branches: \[mmz\/v2-unified-candidate-20261103\]/);
 assert.match(body,/paths:\s*\n\s*- '\.github\/workflows\/v2-unsigned-installer-qa.yml'/);
 assert.match(body,/workflow_dispatch:/);
 assert.match(body,/permissions:\s*\n\s*contents: read/);
 assert.match(body,/runs-on: ubuntu-24\.04/);
 assert.match(body,/runs-on: windows-2022/);
 assert.match(body,/persist-credentials: false/g);
 assert.ok(!body.includes('secrets.'));
 assert.ok(!body.includes('self-hosted'));
 assert.ok(!body.includes('main]'));
});
test('release acquisition is fixed to the exact published unsigned QA artifacts and pinned hashes',()=>{
 const linux=load('tools/v2-unsigned-installer-hosted-linux.sh');
 const win=load('tools/v2-unsigned-installer-hosted-windows.ps1');
 for(const source of [linux,win]){
  assert.match(source,/commander-v2\.1\.50-unsigned-qa\.readonlyfix\.20261105/);
  assert.match(source,/GOD13emad\/ChatGPTRemoteCommander/);
  assert.ok(!source.includes('curl | sh'));
  assert.ok(!source.includes('iex('));
 }
 assert.match(linux,/e16d14114b877c7389b05f97215b95077aafd854803292fcb689c0f04c98df12/);
 assert.match(win,/823cf44f3f63710bbf44a2a69490fef96445a676325041da2e46cb3d04f49076/);
 assert.match(linux,/sha256sum -c --status/);
 assert.match(win,/Get-FileHash/);
});
test('real installer lifecycle cannot begin on an ordinary owner session',()=>{
 const linux=load('tools/v2-unsigned-installer-hosted-linux.sh');
 const win=load('tools/v2-unsigned-installer-hosted-windows.ps1');
 for(const s of [linux,win]){
  assert.match(s,/GITHUB_ACTIONS/);
  assert.match(s,/RUNNER_ENVIRONMENT/);
  assert.match(s,/GITHUB_REPOSITORY/);
  assert.match(s,/RUNNER_OS/);
  assert.match(s,/HOSTED_.*ONLY_DENY/);
 }
 assert.match(linux,/apt-get install -y/);
 assert.match(linux,/apt-get purge -y/);
 assert.match(win,/RunOwned \$download '\/S'/);
 assert.match(win,/RunOwned \$uninstaller '\/S'/);
 assert.match(win,/InstallEntries/);
});
