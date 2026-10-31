import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWorkspaceController,workspaceToolDefinitions,isOwnerBackgroundWorkspaceTool} from '../src/workspace-tools.mjs';
import {createMemoryWorkspaceJournal,createWorkspaceTargetJournal} from '../src/workspace-target-journal.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createOwnerWorkspaceProxy} from '../src/owner-workspace-proxy.mjs';
import {chooseWorkspaceRoute,classifySavedLoginFallback,probeOwnerLoginRoutes} from '../src/workspace-routing.mjs';

test('already signed-in browser never silently chooses a fresh automation profile',()=>{
  const r=chooseWorkspaceRoute({target:'existing-browser',desktop:'windows',sameUserSession:true,existingProfileGrant:false,requireExistingAuthentication:true});
  assert.equal(r.route,'PROFILE_ATTACH_AUTHORIZATION_REQUIRED');
  assert.equal(r.credentials,'NEVER_EXPORT_OR_CLONE');
  assert.equal(r.physicalMouse,'UNCHANGED');
  assert.equal(r.foreground,'PRESERVE');
});

test('owner-requested browser opening requires original owner session and native launch',()=>{
  const r=chooseWorkspaceRoute({target:'new-browser',desktop:'windows',sameUserSession:true,requireExistingAuthentication:true});
  assert.equal(r.route,'OWNER_NATIVE_BROWSER_LAUNCH_REQUIRED');
  assert.equal(r.authenticationPolicy,'REUSE_OWNER_EXISTING_SESSION_ONLY');
  assert.equal(r.profilePolicy,'NO_PROFILE_COPY_NO_DEBUG_FLAGS_NO_PASSWORD_EXPORT');
  assert.equal(r.launchStatus,'NOT_EXECUTED');
  assert.equal(r.foreground,'UNVERIFIED_UNTIL_LAUNCH');
  assert.equal(r.backgroundControl,'REQUIRES_EXACT_WINDOW_AND_NATIVE_CONSENT');
  assert.ok(!JSON.stringify(r).includes('COMMANDER_OWNED_PERSISTENT_PROFILE'));
});

test('opening existing-session app is not falsely reported as launched',()=>{
  for (const desktop of ['windows','x11','wayland']){
    const r=chooseWorkspaceRoute({target:'new-app',desktop,sameUserSession:true,requireExistingAuthentication:true});
    assert.equal(r.route,'OWNER_NATIVE_APP_LAUNCH_REQUIRED');
    assert.equal(r.launchStatus,'NOT_EXECUTED');
    assert.equal(r.credentials,'NEVER_EXPORT_OR_CLONE');
  }
});

test('cross-user and detached sessions fail closed instead of using stored credentials',()=>{
  for (const target of ['new-app','new-browser']){
    const r=chooseWorkspaceRoute({target,desktop:'windows',sameUserSession:false,requireExistingAuthentication:true});
    assert.equal(r.route,'OWNER_SESSION_BRIDGE_REQUIRED');
    assert.equal(r.authenticationPolicy,'SAME_OWNER_SESSION_REQUIRED');
    assert.equal(r.credentials,'NEVER_EXPORT_OR_CLONE');
  }
});

test('signed-in Brave and Firefox prefer native owner AX candidate over unsupported CDP',()=>{
  for(const browserEngine of ['brave','firefox']){
    const r=chooseWorkspaceRoute({target:'existing-browser',desktop:'windows',
      sameUserSession:true,requireExistingAuthentication:true,browserEngine,
      existingProfileGrant:true});
    assert.equal(r.route,'OWNER_BROWSER_ACCESSIBILITY_CANDIDATE');
    assert.equal(r.inspectionStatus,'NOT_EXECUTED');
    assert.equal(r.inputStatus,'NATIVE_APPROVAL_REQUIRED');
    assert.equal(r.backgroundControl,'CAPABILITY_UNVERIFIED');
    assert.equal(r.credentials,'NEVER_EXPORT_OR_CLONE');
  }
});

test('signed-in Chrome retains qualified CDP path only when native profile grant exists',()=>{
  const ungranted=chooseWorkspaceRoute({target:'existing-browser',desktop:'windows',
    sameUserSession:true,browserEngine:'chrome',existingProfileGrant:false});
  assert.equal(ungranted.route,'PROFILE_ATTACH_AUTHORIZATION_REQUIRED');
  const granted=chooseWorkspaceRoute({target:'existing-browser',desktop:'windows',
    sameUserSession:true,browserEngine:'chrome',existingProfileGrant:true});
  assert.equal(granted.route,'CUA_EXISTING_BROWSER_CDP');
});

test('default launch uses the existing signed-in owner profile without new password prompts',()=>{
  for (const target of ['new-browser','new-app']){
    const route=chooseWorkspaceRoute({target,desktop:'windows',sameUserSession:true});
    assert.equal(route.route,target==='new-browser'?'OWNER_NATIVE_BROWSER_LAUNCH_REQUIRED':'OWNER_NATIVE_APP_LAUNCH_REQUIRED');
    assert.equal(route.reuseAuthenticationByDefault,true);
    assert.equal(route.passwordPromptPolicy,'ONLY_AFTER_SAVED_LOGIN_AND_CREDENTIAL_OPTIONS_VERIFIED_ABSENT');
    assert.deepEqual(route.credentialFallbackOrder,[
      'EXISTING_OWNER_SESSION','NORMAL_OWNER_APP_PROFILE',
      'BROWSER_NATIVE_CONSENTED_ATTACH','NATIVE_ACCESSIBILITY',
      'BROWSER_MANAGED_AUTOFILL','OS_NATIVE_CREDENTIAL_UI','USER_SIGN_IN_LAST_RESORT']);
    assert.equal(route.credentialStoreProbe,'NO_SECRET_READS');
    assert.equal(route.launchStatus,'NOT_EXECUTED');
  }
});

test('new isolated browser remains available only when explicitly requested',()=>{
  const r=chooseWorkspaceRoute({target:'new-browser',desktop:'windows',sameUserSession:true,requireExistingAuthentication:false});
  assert.equal(r.route,'COMMANDER_OWNED_PERSISTENT_PROFILE');
  assert.equal(r.reuseAuthenticationByDefault,false);
  assert.equal(r.passwordPromptPolicy,'ONLY_AFTER_SAVED_LOGIN_AND_CREDENTIAL_OPTIONS_VERIFIED_ABSENT');
});

test('default cannot launch a separate profile from Session0',()=>{
  const r=chooseWorkspaceRoute({target:'new-browser',desktop:'windows',sameUserSession:false});
  assert.equal(r.route,'OWNER_SESSION_BRIDGE_REQUIRED');
  assert.equal(r.reuseAuthenticationByDefault,true);
});

test('read-only workspace planner accepts owner existing authentication requirement',()=>{
  const source=readFileSync(new URL('../src/workspace-tools.mjs',import.meta.url),'utf8');
  assert.match(source,/requireExistingAuthentication:\{type:'boolean'\}/);
  assert.match(source,/browserEngine:\{type:'string'/);
  assert.match(source,/name:'workspace_plan'/);
});

test('unknown or unexamined password stores NEVER trigger a password request',()=>{
  const r=classifySavedLoginFallback({signInRequired:true,authenticatedSession:'absent-verified',
    applicationLogin:'absent-verified',browserAutofill:'unknown',osCredential:'absent-verified'});
  assert.equal(r.route,'INSPECT_OWNER_NATIVE_LOGIN_OPTIONS');
  assert.equal(r.passwordRequested,false);
  assert.equal(r.askPasswordInChat,false);
});

test('an authenticated owner session requires no saved password access',()=>{
  const r=classifySavedLoginFallback({signInRequired:true,authenticatedSession:'authenticated'});
  assert.equal(r.route,'REUSE_AUTHENTICATED_OWNER_SESSION');
  assert.equal(r.secretsRead,false);
});

test('any existing native saved login is used before asking the user to sign in',()=>{
  for (const slot of ['applicationLogin','browserAutofill','osCredential']){
    const input={authenticatedSession:'absent-verified',applicationLogin:'absent-verified',
      browserAutofill:'absent-verified',osCredential:'absent-verified',signInRequired:true};
    input[slot]='available';
    const r=classifySavedLoginFallback(input);
    assert.equal(r.route,'USE_OWNER_NATIVE_SAVED_LOGIN');
    assert.equal(r.passwordRequested,false);
    assert.equal(r.credentialsExported,false);
  }
});

test('locked password manager requires native unlock, not chat password',()=>{
  const r=classifySavedLoginFallback({signInRequired:true,authenticatedSession:'absent-verified',
    applicationLogin:'absent-verified',browserAutofill:'locked',osCredential:'absent-verified'});
  assert.equal(r.route,'OWNER_NATIVE_UNLOCK_REQUIRED');
  assert.equal(r.askPasswordInChat,false);
});

test('normal native sign-in is eligible only after ALL options confirmed absent',()=>{
  const evidence={signInRequired:true,authenticatedSession:'absent-verified',
    applicationLogin:'absent-verified',browserAutofill:'absent-verified',
    osCredential:'absent-verified'};
  const r=classifySavedLoginFallback(evidence);
  assert.equal(r.route,'OWNER_NATIVE_SIGN_IN_LAST_RESORT');
  assert.equal(r.nativeLoginPromptEligible,true);
  assert.equal(r.passwordRequested,false);
  assert.equal(r.askPasswordInChat,false);
  for (const key of ['authenticatedSession','applicationLogin','browserAutofill','osCredential']){
    const shifted={...evidence,[key]:'unknown'};
    assert.notEqual(classifySavedLoginFallback(shifted).route,'OWNER_NATIVE_SIGN_IN_LAST_RESORT');
  }
});

test('unnecessary login never triggers native login prompt',()=>{
  const r=classifySavedLoginFallback({signInRequired:false,authenticatedSession:'absent-verified',
    applicationLogin:'absent-verified',browserAutofill:'absent-verified',
    osCredential:'absent-verified'});
  assert.equal(r.route,'NO_LOGIN_ACTION_REQUIRED');
});

test('invalid login evidence cannot masquerade as verified absence',()=>{
  assert.throws(()=>classifySavedLoginFallback({signInRequired:true,browserAutofill:'not-found'}),/WORKSPACE_LOGIN_EVIDENCE_INVALID/);
});

test('all supported owner login probes are attempted by default, last-resort only if absent',async()=>{
  const names=['EXISTING_OWNER_SESSION','NORMAL_OWNER_APP_PROFILE',
    'BROWSER_NATIVE_CONSENTED_ATTACH','NATIVE_ACCESSIBILITY',
    'BROWSER_MANAGED_AUTOFILL','OS_NATIVE_CREDENTIAL_UI'];
  const calls=[];
  const probes=Object.fromEntries(names.map(name=>[name,async opts=>{
    calls.push([name,opts]);return {status:'ABSENT_VERIFIED'};
  }]));
  const r=await probeOwnerLoginRoutes({sameUserSession:true,signInRequired:true,probes});
  assert.deepEqual(calls.map(x=>x[0]),names);
  assert.ok(calls.every(x=>x[1].readOnly===true&&x[1].secretOutput===false));
  assert.equal(r.decision,'OWNER_NATIVE_SIGN_IN_LAST_RESORT');
  assert.equal(r.nativeLoginPromptEligible,true);
  assert.equal(r.askPasswordInChat,false);
});

test('a saved browser credential stops fallback before system vault probes',async()=>{
  const calls=[];
  const probes={
    EXISTING_OWNER_SESSION:async()=>{calls.push('owner');return {status:'ABSENT_VERIFIED'};},
    NORMAL_OWNER_APP_PROFILE:async()=>{calls.push('app');return {status:'ABSENT_VERIFIED'};},
    BROWSER_NATIVE_CONSENTED_ATTACH:async()=>{calls.push('browser');return {status:'SAVED_LOGIN_AVAILABLE',secret:'MUST_NOT_ECHO'};},
    OS_NATIVE_CREDENTIAL_UI:async()=>{calls.push('vault');throw Error('VAULT_MUST_NOT_BE_READ');}
  };
  const r=await probeOwnerLoginRoutes({sameUserSession:true,probes});
  assert.equal(r.decision,'USE_NATIVE_SAVED_LOGIN');
  assert.deepEqual(calls,['owner','app','browser']);
  assert.ok(!JSON.stringify(r).includes('MUST_NOT_ECHO'));
});

test('native browser approval is distinct from a password request',async()=>{
  const probes={
    EXISTING_OWNER_SESSION:async()=>({status:'ABSENT_VERIFIED'}),
    NORMAL_OWNER_APP_PROFILE:async()=>({status:'ABSENT_VERIFIED'}),
    BROWSER_NATIVE_CONSENTED_ATTACH:async()=>({status:'NATIVE_CONSENT_REQUIRED'})
  };
  const r=await probeOwnerLoginRoutes({sameUserSession:true,probes});
  assert.equal(r.decision,'NATIVE_CONSENT_REQUIRED');
  assert.equal(r.passwordRequested,false);
  assert.equal(r.observations.length,3);
});

test('missing capability cannot be treated as proof of no password anywhere',async()=>{
  const r=await probeOwnerLoginRoutes({sameUserSession:true,probes:{
    EXISTING_OWNER_SESSION:async()=>({status:'ABSENT_VERIFIED'})
  }});
  assert.equal(r.decision,'SAVED_LOGIN_CHECKS_INCOMPLETE');
  assert.equal(r.nativeLoginPromptEligible,undefined);
});

test('provider failure is not retried or promoted to missing-credentials proof',async()=>{
  let invoked=0;
  const r=await probeOwnerLoginRoutes({sameUserSession:true,probes:{
    EXISTING_OWNER_SESSION:async()=>{invoked++;throw Error('UNKNOWN_SIDE_EFFECT');}
  }});
  assert.equal(invoked,1);
  assert.equal(r.decision,'OWNER_ROUTE_OBSERVATION_UNCERTAIN');
  assert.equal(r.passwordRequested,false);
});

test('cross-user/session0 cannot inspect native login stores',async()=>{
  let called=0;
  const r=await probeOwnerLoginRoutes({sameUserSession:false,probes:{
    EXISTING_OWNER_SESSION:async()=>{called++;return {status:'AUTHENTICATED'};}
  }});
  assert.equal(r.decision,'OWNER_SESSION_REQUIRED');
  assert.equal(called,0);
});

test('no sign-in requirement means no probes or login prompts',async()=>{
  const r=await probeOwnerLoginRoutes({sameUserSession:true,signInRequired:false,probes:{
    EXISTING_OWNER_SESSION:async()=>{throw Error('UNEXPECTED_PROBE');}
  }});
  assert.equal(r.decision,'NO_LOGIN_ACTION_REQUIRED');
});

test('unrecognized provider status fails closed',async()=>{
  const r=await probeOwnerLoginRoutes({sameUserSession:true,probes:{
    EXISTING_OWNER_SESSION:async()=>({status:'AVAILABLE_CREDENTIAL_TEXT'})
  }});
  assert.equal(r.decision,'OWNER_ROUTE_OBSERVATION_UNCERTAIN');
  assert.equal(r.askPasswordInChat,false);
});

test('readiness uses only same-owner driver window enumeration and never accesses passwords',async()=>{
  const called=[];
  const driver=async(name,args)=>{
    called.push({name,args});
    return {windows:[{pid:71,window_id:920,title:'do-not-echo-any-window-title'}]};
  };
  const controller=createWorkspaceController({platform:'win32',env:{},
    callDriver:driver,ownerSession:async()=>true});
  const result=await controller.execute('workspace_login_readiness',{
    target:'existing-browser',pid:71,windowId:920,browserEngine:'brave'});
  assert.equal(result.observation,'EXACT_WINDOW_PRESENT');
  assert.equal(result.authentication,'UNVERIFIED');
  assert.equal(result.savedCredentials,'NOT_INSPECTED');
  assert.equal(result.loginAbsenceVerified,false);
  assert.equal(result.plan.route,'OWNER_BROWSER_ACCESSIBILITY_CANDIDATE');
  assert.equal(result.credentialContentsRead,false);
  assert.equal(result.passwordRequested,false);
  assert.equal(result.focusChanged,false);
  assert.deepEqual(called.map(x=>x.name),['list_windows']);
  assert.deepEqual(called[0].args,{pid:71});
  assert.ok(!JSON.stringify(result).includes('do-not-echo-any-window-title'));
});

test('missing exact owner window is not proof of absent saved login',async()=>{
  const controller=createWorkspaceController({platform:'win32',
    callDriver:async()=>({windows:[{pid:71,window_id:921}]}),
    ownerSession:async()=>true});
  const result=await controller.execute('workspace_login_readiness',{
    target:'existing-browser',pid:71,windowId:920,browserEngine:'brave'});
  assert.equal(result.observation,'EXACT_WINDOW_NOT_OBSERVED');
  assert.equal(result.authentication,'UNVERIFIED');
  assert.equal(result.loginAbsenceVerified,false);
  assert.equal(result.passwordRequested,false);
});

test('unavailable native list is not an absence confirmation',async()=>{
  const controller=createWorkspaceController({platform:'win32',
    callDriver:async()=>({status:'refused',refusal:{code:'owner_native_consent_required'}}),
    ownerSession:async()=>true});
  const result=await controller.execute('workspace_login_readiness',{
    target:'new-app'});
  assert.equal(result.observation,'UNVERIFIED');
  assert.equal(result.loginAbsenceVerified,false);
});

test('cross-user readiness is denied before native driver access',async()=>{
  let nativeCalls=0;
  const controller=createWorkspaceController({platform:'win32',
    callDriver:async()=>{nativeCalls++;return {windows:[]}},
    ownerSession:async()=>false});
  await assert.rejects(()=>controller.execute('workspace_login_readiness',{
    target:'existing-app',pid:71,windowId:920}),/WORKSPACE_OWNER_SESSION_REQUIRED/);
  assert.equal(nativeCalls,0);
});

test('ambiguous one-sided native target identifiers are rejected without enumeration',async()=>{
  let called=0;
  const controller=createWorkspaceController({platform:'win32',
    callDriver:async()=>{called++;return {windows:[]}},
    ownerSession:async()=>true});
  await assert.rejects(()=>controller.execute('workspace_login_readiness',{
    target:'existing-app',pid:71}),/WORKSPACE_EXACT_WINDOW_ID_REQUIRED/);
  assert.equal(called,0);
});

test('readiness is explicitly exposed as a read-only owner-bound tool',()=>{
  const def=workspaceToolDefinitions.find(x=>x.name==='workspace_login_readiness');
  assert.ok(def);
  assert.equal(def.annotations.readOnlyHint,true);
  assert.equal(isOwnerBackgroundWorkspaceTool(def.name),true);
  assert.equal(def.inputSchema.additionalProperties,false);
});

test('owner proxy permits read-only login readiness without a fake input grant',async()=>{
  const calls=[];
  const proxy=createOwnerWorkspaceProxy({
    config:{ownerWorkspaceDelegation:{enabled:true,port:48838,authFile:'C:\\\\test\\\\owner.key'}},
    readFileImpl:async()=>('b'.repeat(64)),
    fetchImpl:async(_url,options)=>{
      const payload=JSON.parse(options.body);
      calls.push(payload);
      return {status:200,text:async()=>JSON.stringify({
        jsonrpc:'2.0',id:1,result:{structuredContent:{
          ok:true,authentication:'UNVERIFIED',savedCredentials:'NOT_INSPECTED'
        }}
      })};
    }
  });
  const out=await proxy.execute('workspace_login_readiness',{target:'existing-app'});
  assert.equal(out.handled,true);
  assert.equal(out.value.authentication,'UNVERIFIED');
  assert.equal(calls[0].params.name,'workspace_login_readiness');
  assert.equal(calls[0].params.arguments.explicitUserAuthorization,undefined);
});

test('app catalog returns installed identities but never executable command lines',async()=>{
  const c=createWorkspaceController({platform:'win32',ownerSession:async()=>true,
    callDriver:async name=>{
      assert.equal(name,'list_apps');
      return {apps:[{name:'Notepad',kind:'desktop',running:false,pid:0,
        launch_path:'C:\\Sensitive\\notepad.exe --private-secret-should-not-echo'}]};
    }});
  const r=await c.execute('workspace_app_catalog',{query:'note'});
  assert.equal(r.apps.length,1);
  assert.deepEqual(r.apps[0],{name:'Notepad',kind:'desktop',running:false,pid:0});
  assert.equal(r.credentials,'NOT_READ');
  assert.ok(!JSON.stringify(r).includes('Sensitive'));
});

test('same-owner installed app opens minimized with no caller-supplied profile or arguments',async()=>{
  const calls=[];
  let launched=false;
  const c=createWorkspaceController({platform:'win32',ownerSession:async()=>true,
    journal:createMemoryWorkspaceJournal(),
    callDriver:async(name,args)=>{
      calls.push({name,args});
      if(name==='list_apps')return {apps:[{name:'Notepad',kind:'desktop',
        running:launched,pid:launched?1234:0,launch_path:'C:\\Windows\\notepad.exe'}]};
      if(name==='launch_app'){launched=true;return {pid:1234};}
      throw Error('UNEXPECTED_DRIVER_CALL');
    }});
  const r=await c.execute('workspace_app_open',{name:'Notepad',
    requestId:'test-open-notepad-001',
    explicitUserAuthorization:'Launch the installed Notepad under this owner session'});
  assert.equal(r.status,'LAUNCHED_OWNER_PROFILE');
  assert.equal(r.pid,1234);
  assert.equal(r.authentication,'UNVERIFIED');
  assert.equal(r.foreground,'PRESERVE_REQUESTED_NOT_VERIFIED');
  assert.deepEqual(calls.map(x=>x.name),['list_apps','launch_app','list_apps']);
  assert.deepEqual(calls[1].args,{launch_path:'C:\\Windows\\notepad.exe',start_minimized:true});
  assert.ok(!JSON.stringify(calls).includes('--user-data-dir'));
  assert.equal(r.passwordRequested,false);
});

test('already-running owner app is reused without second launch',async()=>{
  let launches=0;
  const c=createWorkspaceController({platform:'win32',ownerSession:async()=>true,
    journal:createMemoryWorkspaceJournal(),
    callDriver:async name=>{
      if(name==='list_apps')return {apps:[{name:'Brave',kind:'desktop',
        running:true,pid:445,launch_path:'C:\\Program Files\\Brave\\brave.exe'}]};
      launches++;return {pid:999};
    }});
  const r=await c.execute('workspace_app_open',{name:'Brave',requestId:'reuse-brave-001',
    explicitUserAuthorization:'Reuse the existing Brave session in this desktop'});
  assert.equal(r.status,'ALREADY_RUNNING');
  assert.equal(r.pid,445);
  assert.equal(r.launchAttempted,false);
  assert.equal(launches,0);
});

test('unknown app launch is never automatically replayed and requires reconciliation',async()=>{
  let running=false,launches=0;
  const c=createWorkspaceController({platform:'win32',ownerSession:async()=>true,
    journal:createMemoryWorkspaceJournal(),
    callDriver:async name=>{
      if(name==='list_apps')return {apps:[{name:'Notepad',kind:'desktop',
        running,pid:running?77:0,launch_path:'C:\\Windows\\notepad.exe'}]};
      if(name==='launch_app'){launches++;if(launches===1)throw Error('TRANSPORT_LOST');running=true;return {pid:77};}
    }});
  const auth='Open the installed Notepad in the same desktop without focus';
  const first=await c.execute('workspace_app_open',{name:'Notepad',
    requestId:'try-notepad-001',explicitUserAuthorization:auth});
  assert.equal(first.status,'RECONCILE_TARGET');
  await assert.rejects(()=>c.execute('workspace_app_open',{name:'Notepad',
    requestId:'try-notepad-002',explicitUserAuthorization:auth}),/WORKSPACE_TARGET_RECONCILIATION_REQUIRED/);
  assert.equal(launches,1);
  const resolved=await c.execute('workspace_app_reconcile',{
    name:'Notepad',determination:'NOT_RUNNING_VERIFIED',
    requestId:'reconcile-notepad-001',explicitUserAuthorization:auth});
  assert.equal(resolved.replayed,false);
  const last=await c.execute('workspace_app_open',{name:'Notepad',
    requestId:'try-notepad-003',explicitUserAuthorization:auth});
  assert.equal(last.status,'LAUNCHED_OWNER_PROFILE');
  assert.equal(launches,2);
});

test('unknown app launch cannot be reconciled with contradictory observations',async()=>{
  let launched=false;
  const c=createWorkspaceController({platform:'win32',ownerSession:async()=>true,
    journal:createMemoryWorkspaceJournal(),
    callDriver:async name=>{
      if(name==='list_apps')return {apps:[{name:'Notepad',kind:'desktop',
        running:launched,pid:launched?91:0,launch_path:'C:\\Windows\\notepad.exe'}]};
      if(name==='launch_app'){launched=true;throw Error('UNKNOWN_AFTER_START');}
    }});
  const auth='Approve this exact installed Notepad launch for testing';
  await c.execute('workspace_app_open',{name:'Notepad',requestId:'probe-app-001',
    explicitUserAuthorization:auth});
  await assert.rejects(()=>c.execute('workspace_app_reconcile',{
    name:'Notepad',determination:'NOT_RUNNING_VERIFIED',
    requestId:'reconcile-app-002',explicitUserAuthorization:auth}),/WORKSPACE_APP_DETERMINATION_NOT_PROVEN/);
  const ok=await c.execute('workspace_app_reconcile',{
    name:'Notepad',determination:'RUNNING_VERIFIED',
    requestId:'reconcile-app-003',explicitUserAuthorization:auth});
  assert.equal(ok.determination,'RUNNING_VERIFIED');
});

test('app launch cannot accept caller-controlled executable paths, flags, URLs or system context',async()=>{
  let called=0;
  const c=createWorkspaceController({platform:'win32',ownerSession:async()=>true,
    journal:createMemoryWorkspaceJournal(),
    callDriver:async()=>{called++;return {apps:[]}}});
  await assert.rejects(()=>c.execute('workspace_app_open',{
    name:'powershell.exe -enc boom',requestId:'reject-exe-001',
    explicitUserAuthorization:'A valid signed-in owner authorizes app launch'}),/WORKSPACE_APP_NOT_IN_OWNER_CATALOG/);
  assert.equal(called,1); // only installed-app catalog read, never a launch
  const other=createWorkspaceController({platform:'win32',ownerSession:async()=>false,
    callDriver:async()=>{throw Error('DRIVER_MUST_NOT_BE_CALLED')}});
  await assert.rejects(()=>other.execute('workspace_app_open',{
    name:'Notepad',requestId:'deny-cross-owner-001',
    explicitUserAuthorization:'Launch Notepad as an unrelated owner'}),/WORKSPACE_OWNER_SESSION_REQUIRED/);
  const linux=createWorkspaceController({platform:'linux',ownerSession:async()=>false,
    callDriver:async()=>{throw Error('NO_CROSS_OWNER_LAUNCH')}});
  await assert.rejects(()=>linux.execute('workspace_app_open',{
    name:'Notepad',requestId:'deny-linux-open-001',
    explicitUserAuthorization:'Require the original Linux user session'}),/WORKSPACE_OWNER_SESSION_REQUIRED/);
});

test('owner proxy only forwards exact app names and hashed mutation identities',async()=>{
  const messages=[];
  const proxy=createOwnerWorkspaceProxy({
    config:{ownerWorkspaceDelegation:{enabled:true,port:48838,authFile:'C:\\owner.key'}},
    readFileImpl:async()=>('c'.repeat(64)),
    fetchImpl:async(_url,options)=>{
      messages.push(JSON.parse(options.body));
      return {status:200,text:async()=>JSON.stringify({jsonrpc:'2.0',id:1,
        result:{structuredContent:{ok:true,status:'ALREADY_RUNNING',pid:99}}})};
    }
  });
  const auth='Open the existing Notepad with owner native approval';
  const r=await proxy.execute('workspace_app_open',{name:'Notepad',requestId:'raw-private-request',explicitUserAuthorization:auth},{requestId:'outer-id-0001'});
  assert.equal(r.value.pid,99);
  assert.equal(messages.length,1);
  assert.equal(messages[0].params.name,'workspace_app_open');
  assert.match(messages[0].params.arguments.requestId,/^owrk-[a-f0-9]{48}$/);
  assert.notEqual(messages[0].params.arguments.requestId,'raw-private-request');
  assert.equal(messages[0].params.arguments.launch_path,undefined);
});

test('unverified running flag never causes duplicate launch and cannot claim reuse',async()=>{
  const calls=[];
  const c=createWorkspaceController({platform:'win32',ownerSession:async()=>true,
    journal:createMemoryWorkspaceJournal(),
    callDriver:async(name)=>{calls.push(name);return {apps:[{name:'Brave',
      kind:'desktop',running:true,pid:0,launch_path:'C:\\Brave\\brave.exe'}]};}});
  await assert.rejects(()=>c.execute('workspace_app_open',{name:'Brave',
    requestId:'bad-running-001',
    explicitUserAuthorization:'Open the same Brave app under the owner account'}),/WORKSPACE_APP_RUNNING_UNVERIFIED/);
  assert.deepEqual(calls,['list_apps']);
});

test('unknown incident determination cannot clear a durable pending launch',async()=>{
  let attempts=0;
  const c=createWorkspaceController({platform:'win32',ownerSession:async()=>true,
    journal:createMemoryWorkspaceJournal(),
    callDriver:async name=>{
      if(name==='list_apps')return {apps:[{name:'Notepad',kind:'desktop',running:false,pid:0,
        launch_path:'C:\\Windows\\notepad.exe'}]};
      attempts++;throw Error('UNKNOWN_NATIVE_LAUNCH');
    }});
  const a='Authorize exact installed Notepad while preserving desktop focus';
  const first=await c.execute('workspace_app_open',{name:'Notepad',requestId:'unknown-state-001',
    explicitUserAuthorization:a});
  assert.equal(first.status,'RECONCILE_TARGET');
  await assert.rejects(()=>c.execute('workspace_app_reconcile',{
    name:'Notepad',determination:'MAYBE_WORKED',
    requestId:'unknown-reconcile-001',explicitUserAuthorization:a}),/WORKSPACE_APP_DETERMINATION_INVALID/);
  await assert.rejects(()=>c.execute('workspace_app_open',{
    name:'Notepad',requestId:'unknown-state-002',
    explicitUserAuthorization:a}),/WORKSPACE_TARGET_RECONCILIATION_REQUIRED/);
  assert.equal(attempts,1);
});

test('durable journal blocks concurrent owner-app restarts and clears only proven event',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'rc-owner-launch-journal-'));
  const target='app:'+createHash('sha256').update('notepad','utf8').digest('hex');
  try{
    const first=createWorkspaceTargetJournal({dir});
    const second=createWorkspaceTargetJournal({dir});
    const receipt=await first.begin(target,'workspace_app_open','unique-run-0001');
    assert.equal((await second.pending(target)).action,'workspace_app_open');
    await assert.rejects(()=>second.begin(target,'workspace_app_open','unique-run-0002'),
      /WORKSPACE_TARGET_RECONCILIATION_REQUIRED/);
    await assert.rejects(()=>second.resolve(target,{...receipt,id:'not-the-same'}),
      /WORKSPACE_JOURNAL_RESOLUTION_MISMATCH/);
    assert.ok(await first.pending(target));
    await second.resolve(target,receipt);
    assert.equal(await first.pending(target),null);
    await assert.rejects(()=>first.begin('app:../../escape','workspace_app_open','unique-run-0003'),
      /WORKSPACE_JOURNAL_TARGET_INVALID/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('default Windows signed-in app launch route exposes native catalog/open/reconcile tools',()=>{
  const r=chooseWorkspaceRoute({target:'new-browser',desktop:'windows',sameUserSession:true});
  assert.equal(r.route,'OWNER_NATIVE_BROWSER_LAUNCH_REQUIRED');
  assert.deepEqual(r.nativeAppLauncher,{
    status:'NATIVE_OWNER_AGENT_REQUIRED',catalog:'workspace_app_catalog',
    open:'workspace_app_open',reconcile:'workspace_app_reconcile',
    minimizing:'REQUESTED_NOT_FOREGROUND_VERIFIED'
  });
  assert.equal(r.launchStatus,'NOT_EXECUTED');
});

test('Linux owner app launch advertises native agent but not Wayland background acceptance',()=>{
  for(const desktop of ['x11','wayland']){
    const r=chooseWorkspaceRoute({target:'new-browser',desktop,sameUserSession:true});
    assert.equal(r.route,'OWNER_NATIVE_BROWSER_LAUNCH_REQUIRED');
    assert.deepEqual(r.nativeAppLauncher,{
      status:'NATIVE_OWNER_AGENT_REQUIRED',catalog:'workspace_app_catalog',
      open:'workspace_app_open',reconcile:'workspace_app_reconcile',
      minimizing:'LINUX_BACKGROUND_CAPABILITY_NOT_VERIFIED'
    });
    assert.equal(r.credentials,'NEVER_EXPORT_OR_CLONE');
  }
});

test('Linux same-owner native desktop launch is name-scoped, no Windows flags or credentials',async()=>{
  for(const sessionType of ['wayland','x11']){
    let running=false;
    const calls=[];
    const c=createWorkspaceController({platform:'linux',env:{
      XDG_RUNTIME_DIR:'/run/user/1000',XDG_SESSION_TYPE:sessionType},
      ownerSession:async()=>true,journal:createMemoryWorkspaceJournal(),
      callDriver:async(name,args)=>{
        calls.push({name,args});
        if(name==='list_apps')return {apps:[{name:'Mousepad',kind:'desktop',
          running,pid:running?4131:0,launch_path:'/usr/bin/mousepad --session-owner'}]};
        if(name==='launch_app'){running=true;return {pid:4131};}
      }
    });
    const out=await c.execute('workspace_app_open',{
      name:'Mousepad',requestId:'linux-'+sessionType+'-owner-open-01',
      explicitUserAuthorization:'Launch original owner-installed Mousepad without focus steal'});
    assert.equal(out.status,'LAUNCHED_OWNER_PROFILE');
    assert.equal(out.authentication,'UNVERIFIED');
    assert.equal(out.foreground,'PRESERVE_REQUESTED_NOT_VERIFIED');
    assert.deepEqual(calls.map(x=>x.name),['list_apps','launch_app','list_apps']);
    assert.deepEqual(calls[1].args,{name:'Mousepad'});
    const again=await c.execute('workspace_app_open',{
      name:'Mousepad',requestId:'linux-'+sessionType+'-owner-open-02',
      explicitUserAuthorization:'Reuse installed Mousepad in this same Linux session'});
    assert.equal(again.status,'ALREADY_RUNNING');
    assert.equal(calls.filter(x=>x.name==='launch_app').length,1);
  }
});

test('Linux native refused background launch does not retry a second process',async()=>{
  let launched=0;
  const c=createWorkspaceController({platform:'linux',ownerSession:async()=>true,
    journal:createMemoryWorkspaceJournal(),
    callDriver:async(name)=>{
      if(name==='list_apps')return {apps:[{name:'Mousepad',kind:'desktop',running:false,pid:0}]};
      launched++;
      return {status:'refused',refusal:{code:'background_unavailable'}};
    }});
  const auth='Authorize an original Linux owner app launch without any foreground step';
  const r=await c.execute('workspace_app_open',{name:'Mousepad',requestId:'linux-refused-001',
    explicitUserAuthorization:auth});
  assert.equal(r.status,'REFUSED_NO_EFFECT');
  const r2=await c.execute('workspace_app_open',{name:'Mousepad',requestId:'linux-refused-002',
    explicitUserAuthorization:auth});
  assert.equal(r2.status,'REFUSED_NO_EFFECT');
  assert.equal(launched,2); // two independent user requests, no replay of one uncertain effect
});

test('Windows app in owner catalog without launch_path uses ONLY exact native name',async()=>{
  for(const entry of [
    {name:'Calculator',kind:'uwp',running:false,pid:0},
    {name:'Notepad',kind:'desktop',running:false,pid:0,launch_path:null},
    {name:'Notepad',kind:'desktop',running:false,pid:0,launch_path:'relative\\notepad.exe'}
  ]){
    let running=false;
    const calls=[];
    const controller=createWorkspaceController({platform:'win32',
      ownerSession:async()=>true,journal:createMemoryWorkspaceJournal(),
      callDriver:async(tool,args)=>{
        calls.push({tool,args});
        if(tool==='list_apps')return {apps:[{...entry,running,pid:running?822:0}]};
        if(tool==='launch_app'){running=true;return {pid:822};}
        throw Error('UNEXPECTED_TOOL');
      }});
    const result=await controller.execute('workspace_app_open',{
      name:entry.name,requestId:'native-fallback-'+entry.kind+'-'+calls.length+'-'+entry.name,
      explicitUserAuthorization:'Launch this uniquely installed Windows app as its current owner'});
    assert.equal(result.status,'LAUNCHED_OWNER_PROFILE');
    assert.deepEqual(calls.map(x=>x.tool),['list_apps','launch_app','list_apps']);
    assert.deepEqual(calls[1].args,{name:entry.name,start_minimized:true});
    assert.equal(result.authentication,'UNVERIFIED');
    assert.equal(result.passwordRequested,false);
  }
});

test('duplicate owner native catalog names cannot silently choose one executable',async()=>{
  let launches=0;
  const c=createWorkspaceController({platform:'win32',ownerSession:async()=>true,
    journal:createMemoryWorkspaceJournal(),
    callDriver:async name=>{
      if(name==='list_apps')return {apps:[
        {name:'Brave',kind:'desktop',running:false,pid:0,launch_path:'C:\\One\\brave.exe'},
        {name:'brave',kind:'desktop',running:false,pid:0,launch_path:'C:\\Two\\brave.exe'}
      ]};
      launches++;
    }});
  await assert.rejects(()=>c.execute('workspace_app_open',{
    name:'Brave',requestId:'ambiguous-brave-001',
    explicitUserAuthorization:'Open the original Brave app in this user account'}),/WORKSPACE_APP_NAME_AMBIGUOUS/);
  assert.equal(launches,0);
});
