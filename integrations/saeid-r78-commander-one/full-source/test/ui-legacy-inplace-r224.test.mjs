import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src=readFileSync(new URL('../desktop/install-windows.ps1',import.meta.url),'utf8').replace(/\r\n/g,'\n');
test('R224 legacy exact four binaries only and no uninstall/reinstall',()=>{
  assert.match(src,/R224_LEGACY_VERIFIER_END/);
  assert.match(src,/R224_LEGACY_FILE_COUNT_UNKNOWN_OR_EXTRA/);
  assert.match(src,/R224_LEGACY_SHA_DRIFT_/);
  assert.match(src,/R224_LEGACY_ROOT_IDENTITY_MISMATCH/);
  assert.match(src,/R224_LEGACY_MODE_NOT_ACCEPTED/);
  assert.match(src,/v0\.10\.14-d06f2162b54b/);
  const sums=['7AF21BBAA8036906B0483ECA89154460CD8B10219CD13E6615FCB475A655EA5B','91EBF4A7BB2C363667D4427C8108ADC31A29E7BFC4CE41EDB2E5AC1AE92D27B9','CFE1E0503B8105ED53401CBF33747DCE838D12651CBAECF508309FB8CD7BA163','E993D3A8570B98EEEE71DC9AD9E24C4ED9120123A8303D0B436465FA7CDA18E8'];
  sums.forEach(x=>assert.equal(src.split(x).length,2));
  assert.match(src,/legacyUnmanifestedBaselineVerified=\[bool\]\$script:R224LegacyAccepted/);
  assert.match(src,/R203_CURRENT_TARGET_NOT_OWNED_INSTALL/);
  assert.match(src,/R203_TRANSACTION_DEGRADED_ROLLBACK_UNRESOLVED/);
  assert.match(src,/R219_UNINSTALL_REFUSED_NO_ACCEPTED_RETIREMENT_PLAN/);
  assert.doesNotMatch(src,/rmdir\s+\/s\s+\/q/i);
});
