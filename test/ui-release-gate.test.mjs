import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {evaluate,GATES,HOSTS} from '../tools/ui-release-gate.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),manifest=resolve(root,'docs/UI_RELEASE_CANDIDATE_R47.json');
const original=()=>JSON.parse(readFileSync(manifest,'utf8'));
const bad=(m,p)=>assert.throws(()=>evaluate(m),p);
test('blocked is safe, 4 hosts and 8 critical gates',()=>{
 const r=evaluate(original());assert.equal(r.status,'BLOCKED');assert.equal(r.hostsChecked,4);
 assert.equal(r.openCriticalGates.length,8);assert.equal(r.automaticDeploymentAuthorized,false);
 assert.ok(r.blockers.includes('HOST:linux-secondary:connected'));
});
test('missing/forged hosts are rejected',()=>{
 let m=original();m.hosts.pop();bad(m,/FOUR_HOSTS/);
 m=original();m.hosts[1].id=m.hosts[0].id;bad(m,/HOST_IDENTITY/);
 m=original();m.hosts[0].platform='linux';bad(m,/HOST_PLATFORM/);
});
test('unsigned transient CI artifacts do not become stable',()=>{
 const m=original();m.components.browser.stableArtifactSha256='artifact:temporary';bad(m,/STABLE_SHA/);
});
test('cannot silently omit or promote critical gates',()=>{
 let m=original();delete m.gates[GATES[0]];bad(m,/PRODUCT_GATES/);
 m=original();m.gates[GATES[0]]={status:'PASS'};bad(m,/GATE_EVIDENCE/);
 m=original();m.gates[GATES[0]]={status:'DONE'};bad(m,/GATE_STATUS/);
});
test('all user-declared green is never actual deployment authority',()=>{
 const m=original();for(const h of m.hosts){h.connected=true;h.ownerVisualAccepted=true;h.rollbackReceiptAccepted=true;h[h.platform==='windows'?'trustedCodeSignature':'runtimeSandboxAccepted']=true;}
 for(const g of GATES)m.gates[g]={status:'PASS',evidence:{sha256:'a'.repeat(64),reference:'local-audit:synthetic'}};
 for(const p of Object.values(m.components)){p.stableArtifactSha256='b'.repeat(64);p.ci.status='PASS';}
 assert.equal(evaluate(m).status,'AWAITING_INDEPENDENT_RELEASE_ATTESTATION');
 assert.equal(evaluate(m).automaticDeploymentAuthorized,false);m.productionPromoted=true;bad(m,/CANDIDATE_ONLY/);
});
test('source SHA and CI evidence are mandatory',()=>{
 let m=original();m.components.browser.commit='main';bad(m,/SOURCE/);
 m=original();m.components.browser.ci.status='PASS';m.components.browser.ci.workflowRuns=[];bad(m,/CI_EVIDENCE/);
});
test('CLI --require-ready cannot trigger update',()=>{
 const cli=resolve(root,'tools/ui-release-gate.mjs');
 let p=spawnSync(process.execPath,[cli,'--manifest',manifest],{encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(p.stdout).status,'BLOCKED');
 p=spawnSync(process.execPath,[cli,'--manifest',manifest,'--require-ready'],{encoding:'utf8'});
 assert.equal(p.status,3,p.stderr);
 p=spawnSync(process.execPath,[cli,'--manifest',manifest,'--install'],{encoding:'utf8'});
 assert.equal(p.status,2);
});
test('schema cardinalities',()=>{assert.equal(new Set(HOSTS).size,4);assert.equal(new Set(GATES).size,8);});

test('R63 new Browser HEAD has four completed success runs but fleet release is blocked',()=>{
 const m=original();
 assert.equal(m.baseline.lastAcceptedBrainRevision,'MAIN_R61');
 assert.equal(m.baseline.lastAcceptedBrainSha256,'9262117223821464f2f8eb3eaf9b83b1bf1ff0c22c40d63bd63ce997b149856a');
 assert.equal(m.components.browser.commit,'8d214c52852fa474509886c2374f85b5e616f86b');
 assert.equal(m.components.browser.ci.status,'PASS');
 assert.deepEqual([...m.components.browser.ci.workflowRuns].sort(),[38046034967,38046035028,38046034978,38046035120].sort());
 const result=evaluate(m);
 assert.equal(result.status,'BLOCKED');
 assert.equal(result.automaticDeploymentAuthorized,false);
 assert.ok(!result.blockers.includes('COMPONENT:browser:CI'));
 assert.equal(result.blockers.length,24);
 assert.equal(result.openCriticalGates.length,8);
});
test('missing new-head CI or unsigned fleet packages remain fail closed',()=>{
 let m=original();m.components.browser.ci.status='OPEN';
 const open=evaluate(m);assert.ok(open.blockers.includes('COMPONENT:browser:CI'));
 assert.equal(open.blockers.length,25);
 m=original();m.components.browser.ci.workflowRuns=[];bad(m,/CI_EVIDENCE/);
 m=original();const success=evaluate(m);
 assert.ok(success.blockers.includes('COMPONENT:browser:STABLE_ARTIFACT_MISSING'));
 assert.equal(success.productionPromoted,false);assert.equal(success.automaticDeploymentAuthorized,false);
});
