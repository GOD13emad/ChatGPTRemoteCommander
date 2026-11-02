import test from 'node:test';
import assert from 'node:assert/strict';
import {provisionOwnerWindowsWorker} from '../tools/v2-windows-owner-worker-provision.mjs';

test('forged owner identity cannot provision a Windows V2 worker token',async()=>{
 await assert.rejects(provisionOwnerWindowsWorker({owner:'not-the-owner'}),
  {code:'V2_NATIVE_INTERACTIVE_OWNER_REQUIRED'});
});
test('unavailable/non-native Windows owner refuses before creating credentials',async t=>{
 if(process.platform==='win32'){t.skip('real logged-in Windows owner covered by native scheduled-task receipt');return;}
 await assert.rejects(provisionOwnerWindowsWorker(),
  {code:'V2_NATIVE_INTERACTIVE_OWNER_REQUIRED'});
});
