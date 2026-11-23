import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConversationStore } from '../src/conversation-store.mjs';
import { createProjectEngine } from '../src/project-engine.mjs';

const targets=[
  {
    name:'conversation',journal:'conversation.sqlite-journal',aliasCode:'CONVERSATION_STATE_ALIAS',
    create:directory=>new ConversationStore({directory})
  },
  {
    name:'project',journal:'project-runs.sqlite-journal',aliasCode:'PROJECT_STATE_ALIAS',
    create:directory=>createProjectEngine({
      directory,
      planner:{describe:()=>({available:true,callsPerPlan:1}),plan:async()=>({})},
      execute:async()=>({}),
      lookup:()=>null
    })
  }
];
for(const target of targets){
  test(target.name+' ignores a disappeared SQLite journal but rejects a present non-file entry',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-sqlite-journal-'));
    const directory=path.join(root,'secure');
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const journal=path.join(directory,target.journal);
    const originalExists=fs.existsSync;
    let opened;
    try{
      // Deterministic race reproduction: a presence check made before SQLite
      // removed its rollback journal is stale by the time lstat is attempted.
      fs.existsSync=p=>p===journal?true:originalExists(p);
      try{opened=target.create(directory);}
      finally{
        fs.existsSync=originalExists;
        await opened?.close?.();
        opened=undefined;
      }
      // Missing is okay; an existing directory where the journal belongs isn't.
      fs.mkdirSync(journal);
      assert.throws(()=>target.create(directory),
        e=>e?.message===target.aliasCode);
    }finally{
      fs.existsSync=originalExists;
      await opened?.close?.();
      fs.rmSync(root,{recursive:true,force:true});
    }
  });
}
