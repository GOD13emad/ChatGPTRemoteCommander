import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CORE_VERSION} from '../src/runtime-version.mjs';

const read=relative=>JSON.parse(readFileSync(new URL('../'+relative,import.meta.url),'utf8'));
const source=relative=>readFileSync(new URL('../'+relative,import.meta.url),'utf8');
test('one committed runtime version matches source, unified GUI and NoPromote train',()=>{
 const core=read('package.json'),gui=read('packaging/unified/package.json');
 const lock=read('packaging/unified/package-lock.json');
 const train=read('docs/release-train-0.12.json');
 assert.match(CORE_VERSION,/^0\.12\.0-dev\.[1-9][0-9]*$/);
 assert.equal(CORE_VERSION,core.version);
 assert.equal(CORE_VERSION,gui.version);
 assert.equal(CORE_VERSION,lock.version);
 assert.equal(CORE_VERSION,lock.packages[''].version);
 assert.equal(CORE_VERSION,train.sourceVersion);
 assert.equal(CORE_VERSION,train.migration.targetVersion);
 assert.equal(train.publishApproved,false);
 assert.equal(train.installedPromotionApproved,false);
 assert.equal(train.autoupdateApproved,false);
});
test('both advertised HTTP and private mTLS metadata use one version source',()=>{
 const server=source('src/server-v0.3.mjs');
 const ingress=source('src/v2-private-pair-mcp-http-ingress.mjs');
 const prepare=source('packaging/unified/prepare.mjs');
 assert.match(server,/import \{CORE_VERSION as VERSION\} from '\.\/runtime-version\.mjs'/);
 assert.match(ingress,/import \{CORE_VERSION\} from '\.\/runtime-version\.mjs'/);
 assert.match(ingress,/version:CORE_VERSION/);
 assert.doesNotMatch(server,/const VERSION\s*=\s*['"]0\.12/);
 assert.match(prepare,/UNIFIED_RUNTIME_HEALTH_VERSION_MISMATCH/);
});
