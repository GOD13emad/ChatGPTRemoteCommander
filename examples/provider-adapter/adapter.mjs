// Explicit, proposal-only command provider for Remote Commander.
// No change to Core, no implicit provider selection, and no tool execution here.
import { pathToFileURL } from 'node:url';

const MAX_CONTEXT_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const PROVIDERS = Object.freeze({
  ollama: 'http://127.0.0.1:11434/v1/chat/completions',
  llamacpp: 'http://127.0.0.1:18080/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions'
});
const PROPOSAL_FIELDS = Object.freeze(['action', 'tool', 'argumentsJson', 'summary']);
const SYSTEM_PROMPT = [
  'Return exactly one JSON proposal with the four string fields action, tool, argumentsJson, summary.',
  'action must be call, block, extend, or delegate. For non-call actions tool must be empty.',
  'argumentsJson must be a JSON object encoded as a string.',
  'You are a proposal-only planner. Do not execute tools, read files, modify files, or claim completion.',
  'Use only the supplied project context. Choose block if evidence or authority is missing.',
  'Commander independently verifies policy, tool arguments, revisions and acceptance.'
].join(' ');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateProposal(source) {
  let value;
  try { value = JSON.parse(source); } catch { throw fail('ADAPTER_INVALID_PROPOSAL'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== PROPOSAL_FIELDS.length
    || PROPOSAL_FIELDS.some(field => !Object.hasOwn(value, field) || typeof value[field] !== 'string')
    || !['call', 'block', 'extend', 'delegate'].includes(value.action)
    || (value.action === 'call' && !/^[A-Za-z][A-Za-z0-9_.:-]{0,199}$/.test(value.tool))
    || (value.action !== 'call' && value.tool !== '')
    || value.summary.length > 8000 || value.argumentsJson.length > MAX_RESPONSE_BYTES) {
    throw fail('ADAPTER_INVALID_PROPOSAL');
  }
  let args;
  try { args = JSON.parse(value.argumentsJson); } catch { throw fail('ADAPTER_INVALID_PROPOSAL'); }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw fail('ADAPTER_INVALID_PROPOSAL');
  const result = Object.fromEntries(PROPOSAL_FIELDS.map(field => [field, value[field]]));
  if (result.action === 'block') result.argumentsJson = '{}'; // No argument payload can be executed for block.
  return result;
}

async function readBoundedResponse(response) {
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw fail('ADAPTER_RESPONSE_TOO_LARGE');
  if (!response.body || typeof response.body.getReader !== 'function') throw fail('ADAPTER_RESPONSE_INVALID');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw fail('ADAPTER_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally { try { await reader.cancel(); } catch {} }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail('ADAPTER_RESPONSE_INVALID'); }
  return result;
}

export async function proposeViaProvider(context, { env = process.env, fetchImpl = fetch } = {}) {
  const provider = env.RC_MODEL_PROVIDER;
  if (!provider) throw fail('ADAPTER_PROVIDER_DISABLED');
  if (!Object.hasOwn(PROVIDERS, provider)) throw fail('ADAPTER_PROVIDER_UNSUPPORTED');
  const model = env.RC_MODEL_NAME;
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model))
    throw fail('ADAPTER_MODEL_INVALID');
  const remote = provider === 'openrouter';
  if (remote && env.RC_ALLOW_EXTERNAL_CONTEXT !== 'yes') throw fail('ADAPTER_REMOTE_OPT_IN_REQUIRED');
  if (remote && !env.OPENROUTER_API_KEY) throw fail('ADAPTER_KEY_MISSING');
  if (provider === 'llamacpp' && !env.LLAMA_CPP_API_KEY) throw fail('ADAPTER_KEY_MISSING');
  if (remote && !model.endsWith(':free') && env.RC_ALLOW_PAID_MODEL !== 'yes')
    throw fail('ADAPTER_PAID_MODEL_OPT_IN_REQUIRED');
  let serialized;
  try { serialized = JSON.stringify(context); } catch { throw fail('ADAPTER_CONTEXT_INVALID'); }
  if (typeof serialized !== 'string') throw fail('ADAPTER_CONTEXT_INVALID');
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONTEXT_BYTES) throw fail('ADAPTER_CONTEXT_TOO_LARGE');

  const headers = { 'Content-Type': 'application/json' };
  if (remote) headers.Authorization = 'Bearer ' + env.OPENROUTER_API_KEY;
  if (provider === 'llamacpp') headers.Authorization = 'Bearer ' + env.LLAMA_CPP_API_KEY;
  const body = JSON.stringify({
    model, stream: false, max_tokens: 1024,
    ...(provider === 'llamacpp' ? { response_format: { type: 'json_object' } } : {}),
    messages: [{ role: 'system', content: provider === 'llamacpp' ? '/no_think\n' + SYSTEM_PROMPT : SYSTEM_PROMPT }, { role: 'user', content: serialized }]
  });
  let response;
  try {
    response = await fetchImpl(PROVIDERS[provider], {
      method: 'POST', redirect: 'error', headers, body, signal: AbortSignal.timeout(12_000)
    });
  } catch { throw fail('ADAPTER_NETWORK_ERROR'); }
  if (!response || response.status < 200 || response.status >= 300)
    throw fail('ADAPTER_PROVIDER_HTTP_ERROR');
  const envelope = await readBoundedResponse(response);
  const content = envelope?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw fail('ADAPTER_RESPONSE_INVALID');
  return validateProposal(content);
}

async function runCli() {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.byteLength;
      if (size > MAX_CONTEXT_BYTES) throw fail('ADAPTER_CONTEXT_TOO_LARGE');
      chunks.push(chunk);
    }
    let context;
    try { context = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw fail('ADAPTER_CONTEXT_INVALID'); }
    const proposal = await proposeViaProvider(context);
    process.stdout.write(JSON.stringify(proposal) + '\n');
  } catch (error) {
    // Never forward provider diagnostics, prompts, HTTP responses or secrets.
    process.stderr.write((/^ADAPTER_[A-Z_]+$/.test(error?.code) ? error.code : 'ADAPTER_INTERNAL_ERROR') + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
