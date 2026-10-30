import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const installer=readFileSync('enable-boot-recovery.ps1','utf8');
test('boot recovery does not accept stale legacy app root when routed release differs',()=>{
 assert.match(installer,/BOOT_RECOVERY_ACTIVE_ROUTE_MISMATCH_STALE_ROOT/);
 assert.match(installer,/BOOT_RECOVERY_ACTIVE_ROUTE_MISSING/);
 assert.match(installer,/route\.active\.projectDir/);
 assert.match(installer,/\[IO\.Path\]::GetFullPath\(\$activeProjectDir\)/);
});
test('routed source checks precede any profile credential or Task Scheduler mutation',()=>{
 const guard=installer.indexOf('BOOT_RECOVERY_ACTIVE_ROUTE_MISMATCH_STALE_ROOT');
 const convert=installer.indexOf('Convert-OneCredential $profile');
 const register=installer.indexOf('Register-ScheduledTask -TaskName $probeName');
 assert.ok(guard>0 && convert>guard && register>guard);
});
