// Native GUI QA only: do not authorize Windows input from Linux-only fsync
// receipts. No installed Core, GUI, credentials, or host services are touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {createNativeWorkspaceJournal} from '../src/native-workspace-journal.mjs';

test('Windows native journal denies dispatch without verified namespace durability',
  {skip:process.platform!=='win32'},async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),
      'rc-native-win-journal-nopromote-'));
    const workspaceRef=randomBytes(32).toString('hex');
    const directory=path.join(root,'workspace-'+workspaceRef);
    try{
      const journal=createNativeWorkspaceJournal({root});
      await assert.rejects(journal.prepare({
        workspaceRef,operationId:'test-owned-drag-no-native-dispatch',
        kind:'drag',revision:0
      }),error=>[
        'NATIVE_JOURNAL_DURABILITY_UNAVAILABLE',
        'NATIVE_JOURNAL_DIRECTORY_UNTRUSTED'
      ].includes(error?.code),
      'Windows must not silently claim Linux journal durability');
      let files=[];
      try{files=await fs.readdir(directory);}
      catch(error){if(error?.code!=='ENOENT')throw error;}
      assert.equal(files.some(name=>name.endsWith('.intent.json')||
        name.endsWith('.ack.json')),false,
        'no persistent receipt may imply an accepted native GUI effect');
    }finally{
      await fs.rm(root,{recursive:true,force:true});
    }
  });
