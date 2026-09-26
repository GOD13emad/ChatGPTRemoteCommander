import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('auto-update-linux.sh', 'utf8');
test('automatic updater holds a qualified same-version different commit', () => {
  assert.match(source, /AUTO_UPDATE_SAME_VERSION_COMMIT_HOLD/);
  const hold = source.indexOf('AUTO_UPDATE_SAME_VERSION_COMMIT_HOLD');
  const sameCommit = source.indexOf('if [[ "$ACTIVE_COMMIT" == "$COMMIT" ]]');
  assert.ok(hold > 0 && sameCommit > hold);
  assert.ok(source.includes('[[ -z "$SOURCE_REF" && "$ACTIVE_VERSION" == "$VERSION" && "$ACTIVE_COMMIT" != "$COMMIT" ]]'));
});
