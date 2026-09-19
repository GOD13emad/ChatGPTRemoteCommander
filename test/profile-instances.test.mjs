import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildProfileInstance, validateInstanceRecord, validateMcpPort, validateProfileName } from '../src/profile-instances.mjs';

const base={host:'127.0.0.1',port:47831,allowedRoots:['C:\\Projects'],allowedPrograms:['git','node'],
  auditLog:'var/audit.jsonl',powerMode:{enabled:true,fullFilesystem:true,allowShell:true,allowProcessControl:true,allowPermanentDelete:false,guiControl:{enabled:true}}};

test('isolated standard profile gets separate port/state, memory and conservative permissions',()=>{
  const out=buildProfileInstance({baseConfig:base,profile:'saeed-emad',port:47834,stateDirectory:'C:\\State\\saeed-emad',platform:'win32'});
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

test('explicit isolated power still keeps permanent delete off and GUI opt-in',()=>{
  const out=buildProfileInstance({baseConfig:base,profile:'power-user',port:47835,stateDirectory:'C:\\State\\power-user',powerMode:true,guiControl:false});
  assert.equal(out.config.powerMode.enabled,true);
  assert.equal(out.config.powerMode.fullFilesystem,true);
  assert.equal(out.config.powerMode.allowPermanentDelete,false);
  assert.equal(out.config.powerMode.guiControl.enabled,false);
  assert.deepEqual(out.config.allowedPrograms,['git','node']);
  assert.equal(out.config.durableWorkflows.executionTools.includes('run_project_command'),true);
});

test('explicit Power+GUI profile journals bounded GUI and power operations without shell/delete/terminal tools',()=>{
  const out=buildProfileInstance({baseConfig:base,profile:'gui-user',port:47836,stateDirectory:'C:\\State\\gui-user',powerMode:true,guiControl:true});
  const tools=out.config.durableWorkflows.executionTools;
  for(const name of ['run_project_command','power_status','file_info','read_file','write_file','create_directory','gui_screenshot','gui_type_text','gui_mouse_click','gui_focus_window']) assert.ok(tools.includes(name),name);
  for(const name of ['run_shell','delete_path','kill_process','start_terminal','send_terminal','stop_terminal']) assert.equal(tools.includes(name),false,name);
  assert.equal(out.config.powerMode.guiControl.enabled,true);
});

test('profile, port and local-state guards fail closed',()=>{
  assert.throws(()=>validateProfileName('../x'),/INVALID_NAME/);
  assert.throws(()=>validateMcpPort(47831),/INVALID_PORT/);
  assert.throws(()=>buildProfileInstance({baseConfig:base,profile:'ok',port:47836,stateDirectory:'\\\\server\\share'}),/LOCAL_PATH/);
});
