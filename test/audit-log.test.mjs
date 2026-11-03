import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { audit } from '../src/tools-v0.3.mjs';

test('audit log is serialized, bounded and rotated without corrupting JSONL', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-audit-log-'));
  const auditLog = path.join(root, 'audit.jsonl');
  const ctx = {
    auditLog,
    config: {
      auditMaxBytes: 65536,
      auditKeepFiles: 2
    }
  };

  try {
    const payload = 'x'.repeat(1800);
    await Promise.all(Array.from({ length: 120 }, (_, index) =>
      audit(ctx, { action: 'rotation-test', index, payload })
    ));

    const names = (await fs.readdir(root)).sort();
    assert.ok(names.includes('audit.jsonl'));
    assert.ok(names.includes('audit.jsonl.1'));
    assert.ok(names.includes('audit.jsonl.2'));
    assert.equal(names.includes('audit.jsonl.3'), false);

    const observed = [];
    for (const name of ['audit.jsonl.2', 'audit.jsonl.1', 'audit.jsonl']) {
      const file = path.join(root, name);
      let text;
      try { text = await fs.readFile(file, 'utf8'); }
      catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      const info = await fs.stat(file);
      assert.ok(info.size <= ctx.config.auditMaxBytes + 4096, `${name} exceeded bounded envelope`);
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        const parsed = JSON.parse(line);
        assert.equal(parsed.action, 'rotation-test');
        assert.equal(typeof parsed.ts, 'string');
        assert.equal(Number.isInteger(parsed.index), true);
        observed.push(parsed.index);
      }
    }

    assert.ok(observed.length > 0);
    assert.ok(observed.includes(119), 'newest audit record must survive rotation');
    assert.equal(new Set(observed).size, observed.length, 'serialized audit writes must not duplicate/corrupt records');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
