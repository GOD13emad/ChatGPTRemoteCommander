import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooseWorkspaceRoute,classifySavedLoginFallback} from '../src/workspace-routing.mjs';

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
