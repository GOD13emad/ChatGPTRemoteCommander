import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../desktop/install-windows.ps1',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('$UninstallText=@"');
const end=source.indexOf('\n"@',start);
const body=source.slice(start,end);

test('R219 generated uninstaller blocks before any deletion or registry mutation',()=>{
 assert.ok(start>0 && end>start, 'a single quoted uninstall generator is required');
 assert.match(body,/R219_UNINSTALL_REFUSED_NO_ACCEPTED_RETIREMENT_PLAN/);
 assert.match(body,/^throw 'R219_UNINSTALL_REFUSED_NO_ACCEPTED_RETIREMENT_PLAN/m);
 for(const danger of [/rmdir\s+\/s\s+\/q/i,/Remove-Item/i,/cmd\.exe/i,/Start-Process/i,/HKCU:/i,/browser.*profile.*(?:remove|delete)/i]){
  assert.doesNotMatch(body,danger,'no destructive primitive may appear in generated Uninstall');
 }
 assert.doesNotMatch(source,/rmdir\s+\/s\s+\/q/i,'no recursive whole-root shell delete in installer');
});

test('R219 uninstall guard does not weaken current-pointer and StageOnly update protections',()=>{
 assert.match(source,/R198_STAGE_ROOT_MUST_BE_NEW/);
 assert.match(source,/R203_VERSION_PATH_ALREADY_EXISTS_NO_OVERWRITE/);
 assert.match(source,/R203_RESTORED_BASELINE_POINTER_MISMATCH/);
 assert.match(source,/if\(\$StageOnly\)\{/);
 assert.match(source,/R203_TRANSACTION_DEGRADED_ROLLBACK_UNRESOLVED/);
 const versioned=source.indexOf('Move-Item -LiteralPath $stage -Destination $VersionDir');
 const uninstall=source.indexOf('$UninstallText=@"');
 assert.ok(versioned>0 && uninstall>versioned);
});
