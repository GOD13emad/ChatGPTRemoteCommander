// Test-only parent-death fixture. No production DB, GUI or runtime is imported.
import { startLinuxLocalManagement } from '../../src/local-management-linux.mjs';
process.once('message', async ({root,target}) => {
  try {
    const endpoint=await startLinuxLocalManagement({enabled:true,runtimeDirectory:root,target,readIdentity:()=>target,
      workflowTools:{definitions:[{name:'workflow_control'},{name:'workflow_get'}],execute:async()=>{throw new Error('NO_EFFECT_IN_PARENT_DEATH_FIXTURE');}}});
    process.send({endpoint:endpoint.endpoint,helperPid:endpoint.helperPid,target});
  }catch{process.send({error:'START_FAILED'});process.exitCode=2;}
});
