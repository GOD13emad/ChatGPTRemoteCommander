import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildProfileInstance, validateInstanceRecord, validateMcpPort, validateProfileName } from '../src/profile-instances.mjs';

const fixtureRoot=process.platform==='win32'?'C:\\Projects':'/tmp/remote-commander-projects';
const stateRoot=process.platform==='win32'?'C:\\State':'/tmp/remote-commander-state';
const stateDir=profile=>path.join(stateRoot,profile);
const base={host:'127.0.0.1',port:47831,allowedRoots:[fixtureRoot],allowedPrograms:['git','node'],
  auditLog:'var/audit.jsonl',powerMode:{enabled:true,fullFilesystem:true,allowShell:true,allowProcessControl:true,allowPermanentDelete:false,guiControl:{enabled:true}}};

test('isolated standard profile gets separate port/state, memory and conservative permissions',()=>{
  const out=buildProfileInstance({baseConfig:base,profile:'saeed-emad',port:47834,stateDirectory:stateDir('saeed-emad')});
  assert.equal(out.config.port,47834);
  assert.equal(out.config.instance.profile,'saeed-emad');
  assert.equal(out.config.powerMode.enabled,false);
  assert.equal(out.config.powerMode.fullFilesystem,false);
  assert.equal(out.config.powerMode.allowShell,false);
  assert.equal(out.config.powerMode.guiControl.enabled,false);
  assert.deepEqual(out.config.allowedPrograms,[]);
  assert.equal(out.config.durableWorkflows.executionTools.includes('run_project_command'),false);
  assert.match(out.config.durableWorkflows.directory,/workflows$/);
  assert.match(out.config.runtimeState,/mcp-runtime\.json$/);
  assert.equal(out.record.configSha256,out.configSha256);
  assert.equal(validateInstanceRecord(out.record),out.record);
});

test('explicit isolated Full Power honors explicit GUI opt-out while enabling remaining capabilities',()=>{
  const out=buildProfileInstance({baseConfig:base,profile:'power-user',port:47835,stateDirectory:stateDir('power-user'),powerMode:true,guiControl:false});
  assert.equal(out.config.powerMode.enabled,true);
  assert.equal(out.config.powerMode.fullFilesystem,true);
  assert.equal(out.config.powerMode.allowPermanentDelete,true);
  assert.equal(out.config.powerMode.guiControl.enabled,false);
  assert.deepEqual(out.config.allowedPrograms,['git','node']);
  assert.equal(out.config.durableWorkflows.executionTools.includes('run_project_command'),true);
});

test('explicit Full Power profile exposes all power and GUI operations to durable orchestration',()=>{
  const out=buildProfileInstance({baseConfig:base,profile:'gui-user',port:47836,stateDirectory:stateDir('gui-user'),powerMode:true,guiControl:true});
  const tools=out.config.durableWorkflows.executionTools;
  for(const name of ['run_project_command','power_status','file_info','read_file','write_file','create_directory','copy_path','move_path','delete_path','search_files','run_shell','system_info','list_processes','kill_process','start_terminal','read_terminal','send_terminal','stop_terminal','gui_screenshot','gui_type_text','gui_mouse_click','gui_focus_window']) assert.ok(tools.includes(name),name);
  assert.equal(out.config.powerMode.guiControl.enabled,true);
});

test('profile, port and local-state guards fail closed',()=>{
  assert.throws(()=>validateProfileName('../x'),/INVALID_NAME/);
  assert.throws(()=>validateMcpPort(47831),/INVALID_PORT/);
  assert.throws(()=>buildProfileInstance({baseConfig:base,profile:'ok',port:47836,stateDirectory:'\\\\server\\share'}),/LOCAL_PATH/);
});

test('isolated Full Power preserves scheduler/continuation and records GUI opt-out',()=>{
  const base2={...base,durableWorkflows:{enabled:true,directory:path.join(stateRoot,'old-workflows'),executionTools:['read_text'],
    scheduler:{enabled:true,resumeAfterRestart:true},continuation:{enabled:true},projectBrain:{enabled:true},executionProfile:{persist:true}}};
  const out=buildProfileInstance({baseConfig:base2,profile:'persist-user',port:47837,stateDirectory:stateDir('persist-user'),powerMode:true,guiControl:false});
  assert.equal(out.config.durableWorkflows.scheduler.enabled,true);
  assert.equal(out.config.durableWorkflows.continuation.enabled,true);
  assert.equal(out.config.durableWorkflows.projectBrain.enabled,true);
  assert.equal(out.config.durableWorkflows.executionProfile.persist,true);
  for(const cap of ['gui.screenshot','gui.mouse','gui.keyboard','gui.window_focus']) assert.ok(out.config.capabilityProfile.disabledCapabilities.includes(cap),cap);
  assert.equal(out.config.capabilityProfile.grantedCapabilities.includes('workflow.scheduler'),true);
  assert.equal(out.config.capabilityProfile.grantedCapabilities.includes('gui.mouse'),false);
});
