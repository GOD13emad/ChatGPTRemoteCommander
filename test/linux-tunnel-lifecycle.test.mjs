import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

function bashPath(){
  if(process.platform!=='win32')return 'bash';
  const candidates=[
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
  ];
  return candidates.find(fs.existsSync) ?? null;
}

test('linux tunnel supervisor never self-stops its own service and scopes recycle to owned profile tunnels',()=>{
  const s=read('autostart-linux.sh');
  assert.doesNotMatch(s,/systemctl\s+--user\s+stop\s+chatgpt-remote-commander\.service/);
  assert.match(s,/candidate_tunnels\(\)/);
  assert.match(s,/sort -V/);
  assert.match(s,/owned_tunnel_exe\(\)/);
  assert.match(s,/stop_owned_profile_tunnels\s+"\$profile"/);
  assert.match(s,/--profile-dir\s+"\$PROFILE_DIR"/);
  assert.match(s,/TUNNEL_CANDIDATE_REJECTED/);
  assert.match(s,/TUNNEL_ROLLBACK_PASS/);
  assert.match(s,/rejected_tunnel_file/);
});

test('fresh linux installer delegates tunnel install to the single pinned helper',()=>{
  const s=read('install.sh');
  assert.doesNotMatch(s,/^TUNNEL_VERSION=/m);
  assert.match(s,/tools\/tunnel-client-pin\.json/);
  assert.match(s,/tools\/install-tunnel-client-linux\.sh/);
  assert.match(s,/\/bin\/bash "\$helper" --install-dir "\$INSTALL_DIR"/);
  assert.match(s,/chmod \+x[\s\S]*install-tunnel-client-linux\.sh/);
});

test('tunnel pin has exact qualified v0.0.15 provenance',()=>{
  const pin=JSON.parse(read('tools/tunnel-client-pin.json'));
  assert.equal(pin.version,'0.0.15');
  assert.equal(pin.releaseTag,'v0.0.15');
  assert.equal(pin.upstreamCommit,'a390c168ff1b2d14e73a95991c186c6aba3ff5a0');
  assert.equal(pin.sha256sumsSha256,'8a32bbcd724468f1874f12d5b0dedb6e6b07dfe5aa323cf5b4c070a5a81b0b4e');
});

test('linux lifecycle shell files parse and tunnel installer self-test resolves the pin',()=>{
  const bash=bashPath();
  if(!bash)return;
  for(const rel of ['autostart-linux.sh','install.sh','tools/install-tunnel-client-linux.sh']){
    const p=path.join(root,rel);
    const r=spawnSync(bash,['-n',p],{encoding:'utf8'});
    assert.equal(r.status,0,rel+' bash -n failed: '+r.stderr);
  }
  const self=spawnSync(bash,[path.join(root,'tools/install-tunnel-client-linux.sh'),'--install-dir',root,'--self-test'],{
    cwd:root,encoding:'utf8',env:{...process.env,PATH:process.env.PATH}
  });
  assert.equal(self.status,0,self.stderr);
  const body=JSON.parse(self.stdout.trim());
  assert.equal(body.ok,true);
  assert.equal(body.version,'0.0.15');
  assert.equal(body.tag,'v0.0.15');
});
