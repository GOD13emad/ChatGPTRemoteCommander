import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeViaProvider } from '../examples/provider-adapter/adapter.mjs';

const proposal = {
  action: 'block', tool: '', argumentsJson: '{}', summary: 'Needs independent evidence'
};
function reply(message = JSON.stringify(proposal), status = 200) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: message } }]
  }), { status, headers: { 'content-type': 'application/json' } });
}
const local = { RC_MODEL_PROVIDER: 'ollama', RC_MODEL_NAME: 'qwen3:8b' };
const remote = {
  RC_MODEL_PROVIDER: 'openrouter', RC_MODEL_NAME: 'openai/gpt-oss-20b:free',
  OPENROUTER_API_KEY: 'test-private-key', RC_ALLOW_EXTERNAL_CONTEXT: 'yes'
};

test('Ollama sends bounded proposal-only chat request to pinned local endpoint without authorization', async () => {
  const calls = [];
  const result = await proposeViaProvider({ task: 'بازرسی' }, {
    env: local, fetchImpl: async (url, options) => { calls.push({ url, options }); return reply(); }
  });
  assert.deepEqual(result, proposal);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'qwen3:8b');
  assert.equal(body.stream, false);
  assert.equal(body.messages[1].content, '{"task":"بازرسی"}');
  assert.match(body.messages[0].content, /proposal/i);
});

test('OpenRouter requires explicit remote-context consent and API key before making requests', async () => {
  let count = 0;
  const fetchImpl = async () => { count++; return reply(); };
  await assert.rejects(proposeViaProvider({ private: true }, {
    env: { ...remote, RC_ALLOW_EXTERNAL_CONTEXT: 'no' }, fetchImpl
  }), { code: 'ADAPTER_REMOTE_OPT_IN_REQUIRED' });
  await assert.rejects(proposeViaProvider({}, {
    env: { ...remote, OPENROUTER_API_KEY: '' }, fetchImpl
  }), { code: 'ADAPTER_KEY_MISSING' });
  assert.equal(count, 0);
});

test('OpenRouter requests pinned HTTPS URL with bearer credential only in header', async () => {
  const calls = [];
  const output = await proposeViaProvider({ marker: 'safe' }, {
    env: remote, fetchImpl: async (url, options) => { calls.push({ url, options }); return reply(); }
  });
  assert.deepEqual(output, proposal);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-private-key');
  assert.equal(JSON.stringify(JSON.parse(calls[0].options.body)).includes('test-private-key'), false);
});

test('missing or unsupported provider and invalid model fail before network access', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return reply(); };
  for (const [env, code] of [
    [{}, 'ADAPTER_PROVIDER_DISABLED'],
    [{ ...local, RC_MODEL_PROVIDER: 'other' }, 'ADAPTER_PROVIDER_UNSUPPORTED'],
    [{ ...local, RC_MODEL_NAME: 'bad\u0000model' }, 'ADAPTER_MODEL_INVALID'],
    [{ ...local, RC_MODEL_NAME: '' }, 'ADAPTER_MODEL_INVALID']
  ]) await assert.rejects(proposeViaProvider({}, { env, fetchImpl }), { code });
  assert.equal(called, false);
});

test('invalid model output cannot produce executable proposal', async () => {
  for (const content of [
    'not JSON', JSON.stringify({ ...proposal, extra: true }),
    JSON.stringify({ ...proposal, action: 'call', tool: '../escape' }),
    JSON.stringify({ ...proposal, action: 'call', tool: 'write_text', argumentsJson: '[]' }),
    JSON.stringify({ ...proposal, action: 'extend', tool: 'write_text' })
  ]) {
    await assert.rejects(proposeViaProvider({}, {
      env: local, fetchImpl: async () => reply(content)
    }), { code: 'ADAPTER_INVALID_PROPOSAL' });
  }
});

test('provider non-2xx status is redacted and never leaks body or key', async () => {
  await assert.rejects(proposeViaProvider({}, {
    env: remote, fetchImpl: async () => new Response('private server stack and test-private-key', { status: 401 })
  }), err => err.code === 'ADAPTER_PROVIDER_HTTP_ERROR'
    && !String(err).includes('test-private-key') && !String(err).includes('private server'));
});

test('oversize context and response fail closed', async () => {
  let called = false;
  await assert.rejects(proposeViaProvider({ data: 'x'.repeat(600000) }, {
    env: local, fetchImpl: async () => { called = true; return reply(); }
  }), { code: 'ADAPTER_CONTEXT_TOO_LARGE' });
  assert.equal(called, false);
  await assert.rejects(proposeViaProvider({}, {
    env: local, fetchImpl: async () => new Response('x'.repeat(270000), { status: 200 })
  }), { code: 'ADAPTER_RESPONSE_TOO_LARGE' });
});

test('invalid response envelope, network failure and redirects fail closed', async () => {
  await assert.rejects(proposeViaProvider({}, {
    env: local, fetchImpl: async () => new Response('{}')
  }), { code: 'ADAPTER_RESPONSE_INVALID' });
  await assert.rejects(proposeViaProvider({}, {
    env: local, fetchImpl: async () => { throw new Error('PRIVATE_NETWORK_DETAIL'); }
  }), err => err.code === 'ADAPTER_NETWORK_ERROR' && !String(err).includes('PRIVATE_NETWORK_DETAIL'));
  await assert.rejects(proposeViaProvider({}, {
    env: local, fetchImpl: async () => new Response('redirect', { status: 302 })
  }), { code: 'ADAPTER_PROVIDER_HTTP_ERROR' });
});


test('remote paid models are opt-in and never silently charged', async () => {
  const paid = { ...remote, RC_MODEL_NAME: 'anthropic/claude-sonnet-4' };
  let count = 0;
  await assert.rejects(proposeViaProvider({}, {
    env: paid, fetchImpl: async () => { count++; return reply(); }
  }), { code: 'ADAPTER_PAID_MODEL_OPT_IN_REQUIRED' });
  assert.equal(count, 0);
  await proposeViaProvider({}, {
    env: { ...paid, RC_ALLOW_PAID_MODEL: 'yes' },
    fetchImpl: async () => { count++; return reply(); }
  });
  assert.equal(count, 1);
});


test('provider output token request is bounded before any external model call', async () => {
  let request;
  await proposeViaProvider({ task: 'bounded' }, {
    env: remote,
    fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return reply(); }
  });
  assert.equal(request.max_tokens, 1024);
});
