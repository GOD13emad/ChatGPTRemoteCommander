import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {censusV2EnrollmentScope} from '../tools/v2-enrollment-census.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const upgrader=path.join(root,'auto-update-linux.sh');
async function fixture(fn){
  const d=await mkdtemp(path.join(os.tmpdir(),'v2-restart-'));
  const p=path.join(d,'profiles'),c=path.join(d,'credentials');
  await mkdir(p);await mkdir(c);
  try{await fn(p,c);}finally{await rm(d,{recursive:true,force:true});}
}
test('Linux updater blocks missing-key promotion before route maintenance',async()=>{
  const s=await readFile(upgrader,'utf8');
  const guard=s.indexOf('AUTO_UPDATE_PROFILE_CREDENTIAL_PRESERVATION_BLOCK');
  const maintenance=s.indexOf('if [[ "$FORCE" != 1 && -f "$ROUTE" ]]; then');
  const switchIndex=s.indexOf('node "$STAGE_DIR/tools/router-switch.mjs"');
  assert.ok(guard>0&&guard<maintenance&&guard<switchIndex);
  assert.match(s,/NO_PROMOTE" != 1.*PROFILE_DIR.*CRED_DIR/);
  assert.match(s,/--profile-dir "\$PROFILE_DIR" --credential-dir "\$CRED_DIR"/);
  assert.ok(s.includes('CRED_DIR=')&&s.includes('chatgpt-remote-commander/credentials'));
});
test('missing owner key rejects Linux restart-safety without exposing profile identity',async()=>{
  await fixture(async(p,c)=>{
    await writeFile(path.join(p,'present.yaml'),'config');
    await writeFile(path.join(p,'missing.yaml'),'config');
    await writeFile(path.join(c,'present.key'),'opaque-value');
    const out=await censusV2EnrollmentScope({profileDir:p,credentialDir:c,platform:'linux'});
    assert.equal(out.structuralStatus,'BLOCKED_RECONCILIATION');
    assert.equal(out.credentialMatches.missing,1);
    assert.equal(out.safeForAutomaticMigration,false);
    const publicReport=JSON.stringify(out);
    for(const secret of ['present.yaml','missing.yaml','opaque-value',p,c])
      assert.equal(publicReport.includes(secret),false);
  });
});
test('matching Linux owner key passes structure but does NOT approve cutover',async()=>{
  await fixture(async(p,c)=>{
    await writeFile(path.join(p,'one.yaml'),'config');
    await writeFile(path.join(c,'one.key'),'opaque-value');
    const out=await censusV2EnrollmentScope({profileDir:p,credentialDir:c,platform:'linux'});
    assert.equal(out.structuralStatus,'STRUCTURAL_MATCH');
    assert.equal(out.safeForAutomaticMigration,false);
    assert.equal(out.credentialUsability,'UNVERIFIED');
    assert.equal(out.chatIdentity,'UNVERIFIED');
  });
});

test('Linux V1-native upgrade reuses owner tunnel profiles, credentials, active config and stable route',async()=>{
 const s=await readFile(upgrader,'utf8');
 assert.ok(s.includes('PROFILE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/tunnel-client"'));
 assert.ok(s.includes('CRED_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/chatgpt-remote-commander/credentials"'));
 assert.ok(s.includes('active_config(){'));
 assert.ok(s.includes('route_tsv "$helper" "$route"'));
 assert.ok(s.includes('build_cfg(){'));
 assert.ok(s.includes('--existing "$ACTIVE_CFG"'));
 assert.ok(s.includes('--mode "$MODE"'));
  assert.ok(s.includes('FINAL_WF="$LIVE_WF"'));
  assert.ok(s.includes('FINAL_DELIVERY_MODE=preserve'));
  assert.ok(s.includes('FINAL_WF="$SHADOW_WF"; FINAL_DELIVERY_MODE=shadow'));
  assert.ok(s.includes('build_cfg "$FINAL_CFG" "$FINAL_WF" "$FINAL_DELIVERY_MODE"'));
 assert.ok(s.includes('find "$PROFILE_DIR" -maxdepth 1 -type f -name \'*.yaml\''));
 assert.ok(s.includes('tunnels_ready(){'));
 assert.ok(s.includes('router-switch.mjs'));
 assert.ok(s.includes('CUTOVER_COMMIT version=$VERSION'));
 // The current owner tunnel remains the transport; standard upgrade adds no
 // new tunnel, runtime key or OAuth registration command.
 assert.ok(!/tunnels create|tunnel create|CONTROL_PLANE_API_KEY\s*=|oauth client register/i.test(s));
});

test('Linux V1-native upgrade preserves one canonical router used by every existing tunnel profile',async()=>{
 const s=await readFile(upgrader,'utf8');
 assert.ok(s.includes('ROUTE="$ROUTING_ROOT/default.json"'));
 assert.ok(s.includes('http://127.0.0.1:47831/mcp'));
 assert.ok(s.includes('tunnels_ready(){'));
 assert.ok(s.includes('find "$PROFILE_DIR" -maxdepth 1 -type f -name \'*.yaml\' -print0'));
 assert.ok(s.includes('tunnel_profile_ready "$file"'));
 assert.ok(s.includes('tunnels_ready || { echo \'tunnel readiness failed\''));
 assert.ok(s.includes('node "$STAGE_DIR/tools/router-switch.mjs"'));
 assert.ok(s.includes('CUTOVER_COMMIT version=$VERSION'));
 // All existing per-chat/owner tunnel profiles stay on their existing local
 // MCP main-channel URL; V2 changes only the backend behind that route.
 assert.ok(!/tunnels create|tunnel create|CONTROL_PLANE_API_KEY\s*=|oauth client register/i.test(s));
});
