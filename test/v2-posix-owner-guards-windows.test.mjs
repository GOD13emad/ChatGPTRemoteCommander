import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createV2V1ToolBridge} from '../src/v2-v1-tool-bridge.mjs';
import {createV2OwnerApprovalQueue} from '../src/v2-owner-approval-queue.mjs';
import {inspectV2OAuthProvider} from '../src/v2-oauth-provider-readiness.mjs';

// Windows has distinct native owner/identity adapters. Do not emulate POSIX
// uid/mode/TTY security and accidentally admit Linux-only noauth review lanes.
test('Windows refuses Linux-only owner queues and provider preflight before any filesystem effect',
 {skip:process.platform!=='win32'},async()=>{
  const root=path.join(os.tmpdir(),'v2-windows-posix-denial-sentinel');
  assert.equal(fs.existsSync(root),false);
  assert.throws(()=>createV2V1ToolBridge({
   root,loadCatalog:async()=>['system_status']
  }),{code:'V2_BRIDGE_OWNER_RUNTIME_REQUIRED'});
  assert.throws(()=>createV2OwnerApprovalQueue({root}),{
   code:'V2_APPROVAL_OWNER_USER_REQUIRED'
  });
  await assert.rejects(()=>inspectV2OAuthProvider({
   file:path.join(root,'oauth-provider.json')
  }),{code:'V2_OAUTH_PREFLIGHT_CONFIG_INVALID'});
  assert.equal(fs.existsSync(root),false);
});
