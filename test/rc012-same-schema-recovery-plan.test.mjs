import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import { recoveryPlan, catalogReceipt } from './rc012-same-schema-recovery-qa.mjs';
const head='5735f68d005907fcbf7465651bf1a41c6dfff375';
test('recovery plan is QA-only, exact, distinct, version-scoped',()=>{
 const plan=recoveryPlan('0.12.0-dev.13',head);
 assert.equal(plan.recoveryHead,'248b017f5c29f6d701e35e76fe00767a6f687d32');
 assert.equal(plan.recoveryTree,'80d681d0ad5d4a42811b2faaeb5834d6e8ac24a9');
 assert.equal(plan.rejectedDev12Head,'46a8256186e09f3355b10f796717aefee29ed309');
 assert.equal(plan.releaseAuthorization,false);
 assert.throws(()=>recoveryPlan('0.12.0-dev.12',head));
 assert.throws(()=>recoveryPlan('0.12.0-dev.13',plan.recoveryHead));
 assert.throws(()=>recoveryPlan('0.12.0-dev.13','not-a-sha'));
});
test('catalog receipt requires the exact native reconcile schema and unique tools',()=>{
 const tool={name:'workspace_target_reconcile',inputSchema:{properties:{snapshotId:{type:'string',pattern:'^[sbn][0-9a-f]{8}$'}}}};
 const receipt=catalogReceipt([tool]);assert.match(receipt.schemaSha256,/^[0-9a-f]{64}$/);assert.equal(receipt.releaseAuthorization,false);
 assert.throws(()=>catalogReceipt([tool,tool]));assert.throws(()=>catalogReceipt([]));
 const narrow=structuredClone(tool);narrow.inputSchema.properties.snapshotId.pattern='^[sb][0-9a-f]{8}$';assert.throws(()=>catalogReceipt([narrow]));
});

test('diagnostic CLI refuses a non-hosted context before attempting network access',()=>{
 const file=fileURLToPath(new URL('./rc012-same-schema-recovery-qa.mjs',import.meta.url));
 for(const args of [['plan','0.12.0-dev.13',head],['catalog']]){
  const r=spawnSync(process.execPath,[file,...args],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false',CI:'false',RUNNER_ENVIRONMENT:''}});
  assert.equal(r.status,2);assert.match(r.stderr,/RC012_RECOVERY_QA_HOSTED_ONLY/);assert.equal(r.stdout,'');
 }
});
test('historical lane stays default; separate QA receipt requires refusal and recovered catalog',()=>{
 const read=relative=>readFileSync(new URL('../'+relative,import.meta.url),'utf8');
 const linux=read('test/release-rollback-linux-r170.sh'),win=read('test/release-rollback-windows-r173.ps1');
 for(const path of ['.github/workflows/release-rollback-r170.yml','.github/workflows/release-rollback-windows-r173.yml']){
  const y=read(path);assert.match(y,/default: historical-dev12/);assert.match(y,/options: \[historical-dev12, same-schema-rc012\]/);assert.match(y,/releaseAuthorization!==false|releaseAuthorization -ne \$false/);
 }
 assert.match(linux,/R170_DEV12_INCOMPATIBLE_SCHEMA_REFUSED_WITHOUT_MUTATION/);assert.match(linux,/PASS_LINUX_SAME_SCHEMA_RECOVERY_QA/);assert.match(linux,/CATALOG_RECOVERY\.json/);
 assert.match(win,/R173_REFUSAL_MUTATED_ROUTE_OR_ROUTER/);assert.match(win,/PASS_WINDOWS_SAME_SCHEMA_RECOVERY_QA/);assert.match(win,/R173_RECOVERY_TREE_MISMATCH/);
});
