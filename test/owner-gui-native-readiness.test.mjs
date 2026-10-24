import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const script='tools/owner-gui-native-readiness.ps1';
const code=fs.readFileSync(script,'utf8');
test('native readiness script cannot silently authorize GUI input or mutate incident evidence',()=>{
 assert.match(code,/osTrustedOwnerConsentVerified=\$false/);
 assert.match(code,/fleetNativeDispatchersQuiescenceProven=\$false/);
 assert.match(code,/takeoverAuthorized=\$false/);
 assert.match(code,/inputExecuted=\$false/);
 assert.match(code,/modifiesState=\$false/);
 for(const forbidden of ['Remove-Item','Set-Content','Start-Process','Add-Type',
    'SendInput','SendKeys','Move-Item','New-ScheduledTask','Register-ScheduledTask']){
   assert.ok(!code.includes(forbidden),forbidden);
 }
});
test('native execution never treats SYSTEM/Session0 as interactive owner authorization',t=>{
 if(process.platform!=='win32'){t.skip('native Windows only');return}
 const r=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',script],
   {encoding:'utf8',windowsHide:true,timeout:12000});
 assert.equal(r.status,0,r.stderr);
 const report=JSON.parse(r.stdout.trim());
 assert.equal(report.schema,'rc-owner-gui-native-readiness-v1');
 assert.equal(report.takeoverAuthorized,false);
 assert.equal(report.osTrustedOwnerConsentVerified,false);
 assert.equal(report.incidentEffectReconciled,false);
 assert.equal(report.inputExecuted,false);
 assert.equal(report.modifiesState,false);
 if(report.sessionInteractiveOwnerCandidate===false)
   assert.equal(report.reason,'OWNER_INTERACTIVE_SESSION_REQUIRED');
});
