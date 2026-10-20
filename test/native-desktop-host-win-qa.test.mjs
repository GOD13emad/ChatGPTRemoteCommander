// QA ONLY: real Windows Desktop OBJECTS hosting read-only child processes.
// No input, screenshot, active-desktop switching or real GUI Worker dispatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const host=path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../tools/native-desktop-host-two-children-win-qa.ps1');

test('two Windows Desktop objects host separate read-only children with real hidden windows',
  {skip:process.platform!=='win32'},()=>{
    const pwsh=path.join(process.env.ProgramFiles||'C:\\Program Files',
      'PowerShell','7','pwsh.exe');
    const result=spawnSync(pwsh,['-NoLogo','-NoProfile','-NonInteractive','-File',host],{
      windowsHide:true,encoding:'utf8',timeout:25000,maxBuffer:65536
    });
    assert.ifError(result.error);
    assert.equal(result.signal,null);
    assert.equal(result.status,0,result.stderr);
    const json=JSON.parse(result.stdout.trim());
    assert.equal(json.schema,1);
    assert.equal(json.pass,true);
    assert.equal(json.station,'WinSta0');
    assert.equal(json.noSwitchDesktop,true);
    assert.equal(json.noUserInput,true);
    assert.equal(json.children.length,2);
    const [a,b]=json.children;
    assert.notEqual(a.requestedDesktop,b.requestedDesktop);
    assert.notEqual(a.pid,b.pid);
    for(const entry of json.children){
      assert.equal(entry.desktopCreated,true);
      assert.equal(entry.desktopHandleClosed,true);
      assert.equal(entry.error,null);
      assert.equal(entry.childExitCode,0);
      assert.equal(entry.matched,true);
      assert.equal(entry.desktopEnumerationSucceeded,true);
      assert.equal(entry.ownWindowObserved,true);
      assert.equal(entry.observedQaWindowPids,String(entry.pid));
      assert.equal(entry.reported.desktop,entry.requestedDesktop);
      assert.equal(entry.reported.station,'WinSta0');
      assert.equal(entry.reported.sessionId,json.sessionId);
      assert.equal(entry.reported.inputNotSent,true);
      assert.equal(entry.reported.hiddenWindowCreated,true);
      assert.equal(entry.reported.hiddenWindowDestroyed,true);
      assert.equal(entry.reported.hiddenWindowOwnerPid,entry.pid);
      assert.equal(entry.reported.hiddenWindowCreateError,0);
      assert.equal(entry.reported.windowsNotShown,true);
    }
  });
