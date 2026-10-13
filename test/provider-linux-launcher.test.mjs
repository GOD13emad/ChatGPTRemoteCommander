import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const script = path.resolve('examples/provider-adapter/linux-local-qwen3.sh');

test('Linux launcher pins local provider and model without enabling the Commander runner', () => {
  const text = readFileSync(script, 'utf8');
  assert.match(text, /^#!\/bin\/sh\n/);
  assert.match(text, /RC_MODEL_PROVIDER=ollama/);
  assert.match(text, /RC_MODEL_NAME=rc-qwen3-4b:q4km/);
  assert.match(text, /exec\s+\/usr\/bin\/node/);
  assert.doesNotMatch(text, /(?:openrouter|sudo|systemctl|ollama pull|curl|wget|api.key)/i);
});
test('Linux launcher shell syntax is valid and no installation is performed by its contract', {skip:process.platform==='win32'}, () => {
  const r = spawnSync('/bin/sh', ['-n', script], { encoding:'utf8', timeout:3000 });
  assert.equal(r.status, 0, r.stderr);
});
