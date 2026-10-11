import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const installer=readFileSync(new URL('../desktop/install-windows.ps1',import.meta.url),'utf8');
test('R198 stage-only writes candidate without mutating installed current, HKCU or shortcuts',()=>{
 const beginning=installer.indexOf('if($StageOnly){\n  if(-not $PSBoundParameters.ContainsKey');
 const create=installer.indexOf('New-Item -ItemType Directory -Path $VersionDir');
 const stage=installer.indexOf("Write-Output ('REMOTE_COMMANDER_UI_STAGE_ONLY_PASS");
 const ret=installer.indexOf('  return\n}',stage);
 const destructive=installer.indexOf('if(Test-Path -LiteralPath $Current){Remove-Item');
 const startMenuMut=installer.indexOf('$s=$Wsh.CreateShortcut');
 const regMut=installer.indexOf('New-Item -Path $Reg -Force');
 assert.ok(beginning>0&&create>beginning&&stage>create&&ret>stage);
 assert.ok(destructive>ret && startMenuMut>ret && regMut>ret);
 assert.ok(installer.includes("throw 'R198_EXPLICIT_DEV_INSTALL_ROOT_REQUIRED'"));
 assert.ok(installer.includes("throw 'R198_STAGE_ROOT_OUTSIDE_DEVELOPMENT'"));
 assert.ok(installer.includes("throw 'R198_STAGE_ROOT_MUST_BE_NEW'"));
 assert.ok(installer.includes("currentPointerChanged=$false;startMenuChanged=$false;registryChanged=$false"));
});
