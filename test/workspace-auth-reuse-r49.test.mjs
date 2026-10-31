import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooseWorkspaceRoute} from '../src/workspace-routing.mjs';

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

test('legacy explicit fresh isolated browser remains available when reuse is not required',()=>{
  const r=chooseWorkspaceRoute({target:'new-browser',desktop:'windows',sameUserSession:true});
  assert.equal(r.route,'COMMANDER_OWNED_PERSISTENT_PROFILE');
});

test('read-only workspace planner accepts owner existing authentication requirement',()=>{
  const source=readFileSync(new URL('../src/workspace-tools.mjs',import.meta.url),'utf8');
  assert.match(source,/requireExistingAuthentication:\{type:'boolean'\}/);
  assert.match(source,/name:'workspace_plan'/);
});
