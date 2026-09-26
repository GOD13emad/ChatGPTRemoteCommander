import test from 'node:test';
import assert from 'node:assert/strict';
import { compactToolSuccessPayload, RETRY_GUARD_LIMITS, serializeBoundedJsonResponse, synchronousCommandInput } from '../src/retry-guard.mjs';

test('synchronous command guard defaults to 20s and rejects longer direct calls before execution', () => {
  assert.equal(synchronousCommandInput({ program: 'node' }).timeoutMs, 20000);
  assert.equal(synchronousCommandInput({ timeoutMs: 20000 }).timeoutMs, 20000);
  assert.throws(() => synchronousCommandInput({ timeoutMs: 20001 }), /SYNCHRONOUS_COMMAND_DEADLINE_RISK/);
});

test('large tool results are not duplicated into content text', () => {
  const payload = { data: 'x'.repeat(RETRY_GUARD_LIMITS.duplicateTextMaxBytes + 4096) };
  const out = compactToolSuccessPayload(payload);
  assert.equal(out.structuredContent, payload);
  assert.equal(out.isError, false);
  assert.match(out.content[0].text, /omitted from duplicate text rendering/);
  assert.ok(Buffer.byteLength(out.content[0].text, 'utf8') < 1024);
});

test('oversized final MCP response is replaced by a compact JSON-RPC error', () => {
  const body = { jsonrpc: '2.0', id: 7, result: { data: 'x'.repeat(RETRY_GUARD_LIMITS.mcpResponseMaxBytes + 4096) } };
  const bounded = serializeBoundedJsonResponse(body);
  assert.equal(bounded.overflow, true);
  assert.ok(bounded.data.length < 2048);
  const parsed = JSON.parse(bounded.data.toString('utf8'));
  assert.equal(parsed.id, 7);
  assert.equal(parsed.error.code, -32051);
  assert.match(parsed.error.message, /MCP_RESPONSE_TOO_LARGE/);
});
