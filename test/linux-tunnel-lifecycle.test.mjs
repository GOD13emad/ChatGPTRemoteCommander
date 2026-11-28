import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
  assert.match(s,/control_plane_fresh\(\)/);
  assert.match(s,/commands_poll_last_successful_timestamp_seconds/);
  assert.match(s,/TUNNEL_SHARED_CONTROL_PLANE_STALE_PRESERVED/);
  assert.match(s,/TUNNEL_ISOLATED_CONTROL_PLANE_STALE_RECYCLE/);
  assert.match(s,/REMOTE_COMMANDER_TUNNEL_STALE_SECONDS/);
  assert.match(s,/tools\/tunnel-log-runner[.]mjs/);
  assert.match(s,/--log[.]file stdout/);
  assert.match(s,/--max-bytes 8388608/);
  assert.match(s,/--max-files 3/);
  assert.match(s,/log[.]rotation[.]json/);
  const enroll=read('enable-autostart-linux.sh');
  assert.ok(enroll.includes('^tunnel_[0-9a-f]{32}$'),'Linux enrollment must enforce the official tunnel ID format');
});

test('linux autostart enables user lingering when systemd user services are available',()=>{
  const s=read('enable-autostart-linux.sh');
  assert.match(s,/loginctl enable-linger "\$USER"/);
  assert.match(s,/loginctl show-user "\$USER" -p Linger --value/);
  assert.match(s,/linger=\$\{LINGER_STATUS:-n\/a\}/);
});

test('fresh linux installer delegates tunnel install to the single pinned helper',()=>{
  const s=read('install.sh');
  assert.doesNotMatch(s,/^TUNNEL_VERSION=/m);
  assert.match(s,/tools\/tunnel-client-pin\.json/);
  assert.match(s,/tools\/install-tunnel-client-linux\.sh/);
  assert.match(s,/\/bin\/bash "\$helper" --install-dir "\$INSTALL_DIR"/);
  assert.match(s,/chmod \+x[\s\S]*install-tunnel-client-linux\.sh/);
});

test('pinned tunnel release downloads use bounded transient retries without weakening hash gates',()=>{
  const s=read('tools/install-tunnel-client-linux.sh');
  assert.match(s,/curl_release_fetch\(\)/);
  assert.match(s,/--retry 4/);
  assert.match(s,/--retry-delay 2/);
  assert.match(s,/--retry-max-time 90/);
  assert.match(s,/--retry-connrefused/);
  assert.doesNotMatch(s,/--retry-all-errors/);
  assert.match(s,/curl_release_fetch "\$BASE\/SHA256SUMS[.]txt" "\$TMP\/SHA256SUMS[.]txt"/);
  assert.match(s,/curl_release_fetch "\$BASE\/\$ASSET" "\$TMP\/\$ASSET"/);
  assert.match(s,/ACTUAL_SUMS_SHA=.*sha256sum/);
  assert.match(s,/ACTUAL_ASSET_SHA=.*sha256sum/);
  assert.match(s,/Tunnel-client SHA256SUMS pin mismatch/);
  assert.match(s,/Tunnel-client asset SHA-256 mismatch/);
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
  for(const rel of ['autostart-linux.sh','enable-autostart-linux.sh','install.sh','tools/install-tunnel-client-linux.sh']){
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

test('linux supervisor retains only explicit private backends and its original default route',
  {skip:process.platform!=='linux'&&'Linux-only supervisor Bash semantics; exercised on native Linux'},()=>{
  const shell=read('autostart-linux.sh');
  const fn=shell.match(/^profile_matches\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(fn);
  const bash=bashPath();
  if(!bash)return;
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-private-backend-fixture-'));
  try{
    const cases=[
      ['emad-mmz',47831,'',true],
      ['emad-mmz',47921,'',false],
      ['emad-mmz',47921,'emad-mmz:47921,saeid-mmz:47922',true],
      ['saeid-mmz',47922,'emad-mmz:47921,saeid-mmz:47922',true],
      ['saeid-mmz',47921,'emad-mmz:47921,saeid-mmz:47922',false],
      ['emad-mmz',47922,'emad-mmz:47921,saeid-mmz:47922',false],
      ['unrelated',47921,'emad-mmz:47921,saeid-mmz:47922',false],
      ['saeid-mmz',47922,'saeid-mmz:any',false],
      ['emad-mmz',47831,'emad-mmz:47921',true],
      ['mmz-linux',47831,'emad-mmz:47921',true],
      ['mmz-linux',47921,'emad-mmz:47921',false],
      // Exact HTTPS/mTLS native 0.12 profile, default deny unless explicitly pinned.
      ['chatgpt-remote-commander',52933,'',false,'https',true],
      ['chatgpt-remote-commander',52933,'chatgpt-remote-commander:52933',true,'https',true],
      ['chatgpt-remote-commander',52933,'chatgpt-remote-commander:52932',false,'https',true],
      ['other-account',52933,'chatgpt-remote-commander:52933',false,'https',true],
      ['chatgpt-remote-commander',52933,'chatgpt-remote-commander:52933',false,'https',false]
    ];
    for(const [name,port,extra,accepted,scheme='http',tlsFields=true] of cases){
      const target=path.join(tmp,name+'.yaml');
      const body=scheme==='https'
        ? 'mcp:\n  server_urls:\n    - channel: main\n      url: https://127.0.0.1:'+port+'/mcp\n'
          +(tlsFields?'  client_cert: "/owner/private/client.crt"\n  client_key: "/owner/private/client.key"\nca_bundle: "/owner/private/ca.crt"\n':'')
        : 'mcp:\n  server_urls:\n    - url: "http://127.0.0.1:'+port+'/mcp"\n';
      fs.writeFileSync(target,body);
      const p=spawnSync(bash,['-s','--',target],{input:fn+'\nprofile_matches "$1"',
        encoding:'utf8',env:{...process.env,REMOTE_COMMANDER_TUNNEL_PRIVATE_TARGETS:extra}
      });
      assert.equal(p.status===0,accepted,name+' '+port+' allow='+extra+' error='+p.stderr);
    }
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});


test('tunnel quarantine is scoped to the failed route; original route remains recoverable',
  {skip:process.platform!=='linux'},()=>{
  const source=read('autostart-linux.sh');
  const fn=['safe_profile','candidate_tunnels','rejected_tunnel_file','route_rejected_tunnel_file','marker_allows_tunnel','find_tunnel']
    .map(name=>{
      const match=source.match(new RegExp('^'+name+'\\(\\) \\{[\\s\\S]*?^\\}','m'));
      assert.ok(match,'missing '+name);
      return match[0];
    }).join('\n');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-route-quarantine-'));
  try{
    const script=[
      fn,
      'set -euo pipefail',
      'ROOT="$1"',
      'VAR_DIR="$ROOT/var"',
      'mkdir -p "$VAR_DIR" "$ROOT/tools/tunnel-client-v0.0.15-linux-amd64"',
      'binary="$ROOT/tools/tunnel-client-v0.0.15-linux-amd64/tunnel-client"',
      'printf "#!/bin/sh\\nexit 0\\n" > "$binary"',
      'chmod 700 "$binary"',
      'export PATH="$(dirname "$binary"):/usr/bin:/bin"',
      'profile=qa-owner',
      'yaml="$ROOT/profile.yaml"',
      'printf "original-route\\n" > "$yaml"',
      'test "$(find_tunnel "$profile" "$yaml")" = "$binary"',
      'printf "protected-route\\n" > "$yaml"',
      'printf "%s\\n" "$binary" > "$(route_rejected_tunnel_file "$profile" "$yaml")"',
      'if find_tunnel "$profile" "$yaml"; then exit 31; fi',
      'test "$(find_tunnel another-owner "$yaml")" = "$binary"',
      'printf "original-route\\n" > "$yaml"',
      'test "$(find_tunnel "$profile" "$yaml")" = "$binary"',
      'printf "%s\\n" "$binary" > "$(rejected_tunnel_file "$profile")"',
      'if find_tunnel "$profile" "$yaml"; then exit 32; fi',
      'echo ROUTE_SCOPED_QUARANTINE_PASS'
    ].join('\n');
    const result=spawnSync('bash',['-s','--',tmp],{input:script,encoding:'utf8',timeout:5000});
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout.trim(),'ROUTE_SCOPED_QUARANTINE_PASS');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});


test('supervisor permits a successful first long poll and still bounds readiness failure',
  {skip:process.platform!=='linux'},()=>{
  const source=read('autostart-linux.sh');
  const fn=source.match(/^wait_tunnel_ready\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(fn);
  const script=[
    fn,
    'set -euo pipefail',
    'sleep(){ SECONDS=$((SECONDS+1)); }',
    'kill(){ test "$alive" = 1; }',
    'tunnel_ready(){ (( SECONDS >= ready_after )); }',
    'SECONDS=0; alive=1; ready_after=30',
    'wait_tunnel_ready 47832 1234',
    'test "$SECONDS" -ge 30',
    'echo FIRST_LONG_POLL_PASS',
    'SECONDS=0; alive=1; ready_after=100',
    'if wait_tunnel_ready 47832 1234; then exit 41; fi',
    'test "$SECONDS" -ge 45',
    'test "$SECONDS" -lt 50',
    'echo DEADLINE_BOUNDED_PASS',
    'SECONDS=0; alive=0; ready_after=0',
    'if wait_tunnel_ready 47832 1234; then exit 42; fi',
    'test "$SECONDS" -lt 2',
    'echo DEAD_PROCESS_DENIED_PASS'
  ].join('\n');
  const result=spawnSync('bash',['-s'],{input:script,encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'),[
    'FIRST_LONG_POLL_PASS','DEADLINE_BOUNDED_PASS','DEAD_PROCESS_DENIED_PASS'
  ]);
});


test('supervisor accepts documented auth-required startup readiness but not 503 or timeout fallback',
  {skip:process.platform!=='linux'},()=>{
  const source=read('autostart-linux.sh');
  const fn=source.match(/^tunnel_ready\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(fn);
  const script=[
    fn,
    'set -euo pipefail',
    'curl(){ printf "%s\\n%s" "$fixture_body" "$fixture_status"; return "$fixture_exit"; }',
    'fixture_exit=0; fixture_status=200; fixture_body=ready',
    'tunnel_ready 47832',
    'fixture_body="ready (mcp initialize requires auth: Unauthorized)"',
    'tunnel_ready 47832',
    'fixture_status=503',
    'if tunnel_ready 47832; then exit 51; fi',
    'fixture_status=200; fixture_body="ready (mcp startup probe timed out: timeout)"',
    'if tunnel_ready 47832; then exit 52; fi',
    'fixture_body="ready forged suffix"',
    'if tunnel_ready 47832; then exit 53; fi',
    'fixture_body=ready; fixture_exit=22',
    'if tunnel_ready 47832; then exit 54; fi',
    'echo READY_CONTRACT_PASS'
  ].join('\n');
  const result=spawnSync('bash',['-s'],{input:script,encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout.trim(),'READY_CONTRACT_PASS');
});


test('primary and fallback share quarantine; route history is atomic, isolated and fail closed',
  {skip:process.platform!=='linux'},()=>{
  const source=read('autostart-linux.sh');
  const fn=['safe_profile','rejected_tunnel_file','route_rejected_tunnel_file',
    'marker_allows_tunnel','find_tunnel','fallback_tunnel','record_route_rejection']
    .map(name=>{
      const match=source.match(new RegExp('^'+name+'\\(\\) \\{[\\s\\S]*?^\\}','m'));
      assert.ok(match,'missing '+name);
      return match[0];
    }).join('\n');
  assert.match(source,/record_route_rejection "\$reject_file" "\$desired"/);
  assert.match(source,/fallback="\$\(fallback_tunnel "\$profile" "\$profile_file" "\$desired" "\$previous"/);
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-fallback-quarantine-'));
  try{
    const script=[
      fn,
      'set -euo pipefail',
      'umask 077',
      'VAR_DIR="$1/var"; mkdir "$VAR_DIR" "$1/bin"',
      'touch "$1/a" "$1/b" "$1/c" "$1/bin/tunnel-client"',
      'chmod 700 "$1/a" "$1/b" "$1/c" "$1/bin/tunnel-client"',
      'export PATH="$1/bin:$PATH"',
      'FIXTURE_ROOT="$1"',
      'candidate_tunnels(){ printf "%s\\n" "$FIXTURE_ROOT/a" "$FIXTURE_ROOT/b" "$FIXTURE_ROOT/c"; }',
      'yaml="$1/profile.yaml"; printf "route-one\\n" > "$yaml"',
      'route="$(route_rejected_tunnel_file qa "$yaml")"; legacy="$(rejected_tunnel_file qa)"',
      'test "$(fallback_tunnel qa "$yaml" "$1/c" "$1/b")" = "$1/b"',
      'printf "%s\\n" "$1/b" > "$legacy"',
      'test "$(fallback_tunnel qa "$yaml" "$1/c" "$1/b")" = "$1/a"',
      'rm "$legacy"',
      'record_route_rejection "$route" "$1/b"',
      'test "$(fallback_tunnel qa "$yaml" "$1/c" "$1/b")" = "$1/a"',
      'record_route_rejection "$route" "$1/a"; record_route_rejection "$route" "$1/a"',
      'test "$(grep -Fxc "$1/a" "$route")" = 1; test "$(grep -Fxc "$1/b" "$route")" = 1',
      'if fallback_tunnel qa "$yaml" "$1/c" "$1/b"; then exit 31; fi',
      'test "$(find_tunnel qa "$yaml")" = "$1/c"',
      'record_route_rejection "$route" "$1/c"',
      'test "$(find_tunnel qa "$yaml")" = "$1/bin/tunnel-client"',
      'test "$(fallback_tunnel other "$yaml" "$1/c" "$1/b")" = "$1/b"',
      'printf "route-two\\n" > "$yaml"',
      'test "$(fallback_tunnel qa "$yaml" "$1/c" "$1/b")" = "$1/b"',
      'other="$(route_rejected_tunnel_file qa "$yaml")"',
      'record_route_rejection "$other" "$1/a" & first=$!',
      'record_route_rejection "$other" "$1/b" & second=$!',
      'wait "$first"; wait "$second"',
      'test "$(grep -Fxc "$1/a" "$other")" = 1; test "$(grep -Fxc "$1/b" "$other")" = 1',
      'chmod 000 "$other"',
      'if [[ ! -r "$other" ]]; then if find_tunnel qa "$yaml"; then exit 32; fi; if record_route_rejection "$other" "$1/c"; then exit 33; fi; fi',
      'chmod 600 "$other"',
      'printf "route-three\\n" > "$yaml"',
      'bad="$(route_rejected_tunnel_file qa "$yaml")"; ln -s "$other" "$bad"',
      'if find_tunnel qa "$yaml"; then exit 34; fi',
      'if record_route_rejection "$bad" "$1/c"; then exit 35; fi',
      'test "$(grep -Fxc "$1/b" "$other")" = 1',
      'echo FALLBACK_QUARANTINE_PASS'];
    const result=spawnSync('bash',['-s','--',tmp],{
      input:script.join('\n'),encoding:'utf8',timeout:12000});
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout.trim(),'FALLBACK_QUARANTINE_PASS');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
