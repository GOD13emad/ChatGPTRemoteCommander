// Windows QA ONLY. Same per-workspace Desktop HWND remains observable across
// three host snapshots, then all children and Win32 desktop handles close.
// No GUI input or switching to an active user desktop.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const script=fileURLToPath(new URL('../tools/native-desktop-lifecycle-host-win-qa.ps1',import.meta.url));
test('two retained Desktop objects survive three scoped observations and clean shutdown',
  {skip:process.platform!=='win32'},()=>{
    const pwsh=path.join(process.env.ProgramFiles||'C:\\Program Files','PowerShell','7','pwsh.exe');
    const run=spawnSync(pwsh,['-NoLogo','-NoProfile','-NonInteractive','-File',script],{
      windowsHide:true,encoding:'utf8',timeout:25000,maxBuffer:65536
    });
    assert.ifError(run.error);
    assert.equal(run.signal,null);
    assert.equal(run.status,0,run.stderr);
    const result=JSON.parse(run.stdout.trim());
    assert.equal(result.schema,1);
    assert.equal(result.pass,true);
    assert.equal(result.noSwitchDesktop,true);
    assert.equal(result.noUserInput,true);
    assert.equal(result.station,'WinSta0');
    assert.equal(result.children.length,2);
    const [a,b]=result.children;
    assert.notEqual(a.pid,b.pid);
    assert.notEqual(a.requestedDesktop,b.requestedDesktop);
    for(const child of result.children){
      assert.equal(child.desktopCreated,true);
      assert.equal(child.desktopHandleClosed,true);
      assert.equal(child.desktopEnumerationSucceeded,true);
      assert.equal(child.ownWindowObserved,true);
      assert.equal(child.remainedAliveAcrossObservations,true);
      assert.equal(child.observationsWhileAlive,3);
      assert.deepEqual(child.observedOwnersAcrossTime,Array(3).fill(String(child.pid)));
      assert.equal(child.reported.pid,child.pid);
      assert.equal(child.reported.desktop,child.requestedDesktop);
      assert.equal(child.reported.hiddenWindowCreated,true);
      assert.equal(child.reported.hiddenWindowDestroyed,true);
      assert.equal(child.reported.windowsNotShown,true);
      assert.equal(child.reported.inputNotSent,true);
      assert.equal(child.childExitCode,0);
      assert.equal(child.error,null);
      assert.equal(child.matched,true);
    }
    assert.equal(a.observedOwnersAcrossTime.includes(String(b.pid)),false);
    assert.equal(b.observedOwnersAcrossTime.includes(String(a.pid)),false);
  });
