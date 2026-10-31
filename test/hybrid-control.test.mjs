import test from 'node:test';
import assert from 'node:assert/strict';
import {createHybridControl,hybridControlToolDefinitions} from '../src/hybrid-control.mjs';

const tools=['read_text','write_text','list_directory','start_terminal','read_terminal',
  'workspace_target_list','workspace_target_open','workspace_target_snapshot',
  'workspace_window_observe','workspace_app_catalog','workspace_app_open','workspace_app_reconcile',
  'workspace_accessibility_open','workflow_run_tick'];
function controller(platform='win32',extra={}){
  return createHybridControl({
    platform,
    config:{powerMode:{enabled:true,allowShell:true,allowProcessControl:true}},
    toolNames:()=>tools,
    ...extra
  });
}
test('hybrid API is read-only with closed schemas',()=>{
  assert.deepEqual(hybridControlToolDefinitions.map(x=>x.name),
    ['hybrid_control_status','hybrid_control_plan']);
  for(const def of hybridControlToolDefinitions){
    assert.equal(def.annotations.readOnlyHint,true);
    assert.equal(def.inputSchema.additionalProperties,false);
  }
});
test('existing commander terminal capabilities are reused instead of installing duplicate DesktopCommander',async()=>{
  const s=await controller().execute('hybrid_control_status');
  assert.equal(s.backends.terminal.status,'AVAILABLE');
  assert.equal(s.backends.desktopCommander.status,'AVAILABLE');
  assert.equal(s.backends.directFiles.status,'AVAILABLE');
  assert.equal(s.source,'CURRENT_COMMANDER_CATALOG_AND_TRUSTED_OWNER_PROBES');
  const p=await controller().execute('hybrid_control_plan',{target:'terminal'});
  assert.equal(p.selection.id,'commander-terminal');
  assert.equal(p.selection.mode,'DISCOVERY_ONLY');
  assert.equal(p.effectPerformed,false);
});
test('disabled shell cannot be falsely replaced by unrestricted Desktop Commander MCP',async()=>{
  const c=controller('win32',{config:{powerMode:{enabled:false,allowShell:false,allowProcessControl:false}}});
  const r=await c.execute('hybrid_control_plan',{target:'terminal'});
  assert.equal(r.selection.id,null);
  assert.equal(r.authorization,'COMMANDER_TOOL_POLICY_AND_OS_ACL_REQUIRED');
  const s=await c.execute('hybrid_control_status');
  assert.equal(s.backends.desktopCommander.status,'GATED');
});
test('Browser default selects original session without CDP/debug-profile bypass or secret export',async()=>{
  for(const browserEngine of ['brave','chrome','edge','firefox']){
    const p=await controller().execute('hybrid_control_plan',{
      target:'existing-browser',browserEngine,activity:'interact'});
    assert.equal(p.authorization,'SAME_OWNER_SESSION_PROOF_REQUIRED');
    assert.equal(p.existingAuthentication,'REUSE_ORIGINAL_OWNER_SESSION_ONLY');
    assert.equal(p.guiActionAuthorized,false);
    assert.equal(p.savedCredentialsInspected,false);
    assert.equal(p.guarantees.passwordExport,false);
    assert.equal(p.guarantees.cookieExport,false);
    assert.equal(p.guarantees.profileCloning,false);
    assert.equal(p.selection.id,'window-scoped-observe');
    assert.equal(p.selection.mode,'DISCOVERY_ONLY');
  }
});
test('Firefox route never inserts Playwright Chrome extension before Firefox owner extension',async()=>{
  const p=await controller().execute('hybrid_control_plan',{target:'existing-browser',browserEngine:'firefox'});
  assert.equal(p.routeOrder[0].id,'firefox-native-messaging');
  assert.equal(p.routeOrder.some(x=>x.id==='playwright-extension'),false);
  assert.equal(p.routeOrder.some(x=>x.id==='chrome-devtools-native'),false);
});
test('Brave and Edge need extension native consent and do not claim Chrome DevTools autoconnect',async()=>{
  for(const browserEngine of ['brave','edge']){
    const p=await controller().execute('hybrid_control_plan',{target:'existing-browser',browserEngine});
    assert.equal(p.routeOrder[0].id,'playwright-extension');
    assert.equal(p.routeOrder.some(x=>x.id==='chrome-devtools-native'),false);
    assert.equal(p.effectPerformed,false);
  }
});
test('Chrome Devtools is a distinct native-consent candidate, not automatically ready',async()=>{
  const p=await controller().execute('hybrid_control_plan',{target:'existing-browser',browserEngine:'chrome'});
  assert.deepEqual(p.routeOrder.slice(0,2).map(x=>x.id),
    ['playwright-extension','chrome-devtools-native']);
  assert.ok(p.routeOrder.slice(0,2).every(x=>x.status==='GATED'));
});
test('Windows semantic UIA is candidate only and never asserted installed by catalog',async()=>{
  const s=await controller().execute('hybrid_control_status');
  assert.equal(s.backends.windowsUia.status,'GATED');
  assert.equal(s.backends.windowsUia.reason,'WINDOWS_OWNER_WINAPP_INSTALL_AND_UIA_INSPECTION_REQUIRED');
  assert.equal(s.owner.sameUserSessionVerified,false);
});
test('Linux semantic route is AT-SPI then portal; Windows UIA unsupported',async()=>{
  const s=await controller('linux').execute('hybrid_control_status');
  assert.equal(s.backends.windowsUia.status,'UNSUPPORTED');
  assert.equal(s.backends.linuxAtspi.status,'GATED');
  assert.equal(s.backends.waylandPortal.status,'GATED');
  const p=await controller('linux').execute('hybrid_control_plan',{target:'existing-app',activity:'interact'});
  assert.deepEqual(p.routeOrder.slice(0,3).map(x=>x.id),
    ['owner-app-catalog','linux-atspi','wayland-portal']);
});
test('headless shell and filesystem remain independent of a blocked GUI consent route',async()=>{
  const c=controller('linux',{toolNames:()=>tools.filter(n=>!n.startsWith('workspace_'))});
  const p=await c.execute('hybrid_control_plan',{target:'existing-app',activity:'interact'});
  assert.equal(p.selection.id,null);
  const q=await c.execute('hybrid_control_plan',{target:'filesystem'});
  assert.equal(q.selection.id,'direct-files');
});
test('verified presence of a tool is not evidence of native owner access',async()=>{
  const c=controller('win32',{ownerStatus:async()=>({sameUserSessionVerified:false,nativeBrokerAccepted:true}),
    providerEvidence:async()=>({windowsUia:{sessionVerified:true,consentAccepted:true}})});
  const s=await c.execute('hybrid_control_status');
  assert.equal(s.backends.windowsUia.status,'GATED');
});
test('trusted owner verification and native provider consent may upgrade that ONE backend only',async()=>{
  const c=controller('win32',{ownerStatus:async()=>({
    sameUserSessionVerified:true,nativeBrokerAccepted:true
  }),providerEvidence:async()=>({windowsUia:{sessionVerified:true,consentAccepted:true}})});
  const s=await c.execute('hybrid_control_status');
  assert.equal(s.backends.windowsUia.status,'AVAILABLE');
  assert.equal(s.backends.browserExtension.status,'GATED');
  const p=await c.execute('hybrid_control_plan',{target:'existing-app',activity:'observe'});
  assert.equal(p.selection.id,'windows-uia-winapp');
  assert.equal(p.effectPerformed,false);
});
test('a failing owner or provider probe never grants capability',async()=>{
  const c=controller('win32',{ownerStatus:async()=>{throw Error('UNAVAILABLE')},
    providerEvidence:async()=>{throw Error('UNAVAILABLE')}});
  const s=await c.execute('hybrid_control_status');
  assert.equal(s.owner.sameUserSessionVerified,false);
  assert.equal(s.backends.windowsUia.status,'GATED');
});
test('untrusted or malformed input cannot change backend inventory or select an effect',async()=>{
  const c=controller();
  for(const args of [
    {target:'existing-browser',password:'secret'},
    {target:'shell;rm -rf /'},
    {target:'existing-app',activity:'bypass'},
    {target:'existing-app',sameUserSession:true},
    {target:'existing-browser',browserEngine:'other',preserveExistingLogin:'false'}
  ])await assert.rejects(()=>c.execute('hybrid_control_plan',args),/HYBRID_CONTROL_INPUT_INVALID/);
  await assert.rejects(()=>c.execute('hybrid_control_status',{ownerApproved:true}),
    /HYBRID_CONTROL_INPUT_INVALID/);
});
test('new app still requires same-owner session proof and lists next native tool without launching',async()=>{
  const c=controller();
  const p=await c.execute('hybrid_control_plan',{target:'new-app',activity:'launch'});
  assert.equal(p.routeOrder[0].id,'owner-app-catalog');
  assert.equal(p.routeOrder[0].status,'GATED');
  assert.equal(p.selection.mode,'DISCOVERY_ONLY');
  assert.equal(p.selection.id,'window-scoped-observe');
  assert.equal(p.effectPerformed,false);
});
test('no client-provided passwords/credentials appear in status and plan outputs',async()=>{
  const c=controller('linux');
  const s=await c.execute('hybrid_control_status');
  const p=await c.execute('hybrid_control_plan',{target:'existing-browser',browserEngine:'firefox'});
  assert.equal(s.guarantees.tokenExport,false);
  assert.equal(p.guarantees.passwordExport,false);
  assert.equal(p.note.includes('No existing user login was inspected'),false); // read-only route can be discovered
});
