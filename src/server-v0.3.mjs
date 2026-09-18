import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { canonicalizeRoots } from './security-v0.3.mjs';
import { audit, listDirectory, readText, runProjectCommand, writeText } from './tools-v0.3.mjs';
import { executePowerTool, powerToolDefinitions } from './power-tools-v0.3.mjs';
import { lockStats } from './locks.mjs';
import { expandPathValue, shellName } from './platform.mjs';

const VERSION = '0.3.1';
const MODERN_VERSION = '2026-07-28';
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(here, '..');
const defaultConfigPath = path.join(projectDir, 'config.json');
const localConfigPath = path.join(projectDir, 'config.local.json');
let configPath = process.env.REMOTE_COMMANDER_CONFIG || defaultConfigPath;
if (!process.env.REMOTE_COMMANDER_CONFIG) {
  try { await readFile(localConfigPath, 'utf8'); configPath = localConfigPath; } catch { /* safe public config fallback */ }
}
const config = JSON.parse(await readFile(configPath, 'utf8'));
function expandEnvironment(value) { return expandPathValue(value); }
config.allowedRoots = config.allowedRoots.map(expandEnvironment);
const roots = await canonicalizeRoots(config.allowedRoots);
const ctx = {
  config,
  roots,
  auditLog: path.resolve(projectDir, config.auditLog || 'var/audit.jsonl')
};
const TOOLS = [
  {
    name: 'system_status',
    description: 'Return server version, allowed roots, command allowlist, and protocol support.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'list_directory',
    description: 'List a directory inside an allowed project root with bounded recursion.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        depth: { type: 'integer', minimum: 0, maximum: 4 },
        maxEntries: { type: 'integer', minimum: 1, maximum: 500 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'read_text',
    description: 'Read a UTF-8 text file inside an allowed root and return its SHA-256 hash.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', minLength: 1 } },
      required: ['path'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'write_text',
    description: 'Write or append UTF-8 text inside an allowed root. Existing files are backed up first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        content: { type: 'string' },
        mode: { type: 'string', enum: ['overwrite', 'append'] },
        expectedSha256: { type: 'string' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'run_project_command',
    description: 'Run one allowlisted executable directly in an allowed project directory without a shell.',
    inputSchema: {
      type: 'object',
      properties: {
        program: { type: 'string', minLength: 1 },
        args: { type: 'array', items: { type: 'string' }, maxItems: 100 },
        cwd: { type: 'string' },
        timeoutMs: { type: 'integer', minimum: 1000 }
      },
      required: ['program'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  },
  ...powerToolDefinitions
];
function serverMeta() {
  return { 'io.modelcontextprotocol/serverInfo': { name: 'chatgpt-remote-commander', version: VERSION } };
}

function modernResult(payload) {
  return { resultType: 'complete', ...payload, _meta: serverMeta() };
}

function legacyResult(payload) {
  return payload;
}

function rpcResult(id, payload, modern) {
  return { jsonrpc: '2.0', id, result: modern ? modernResult(payload) : legacyResult(payload) };
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}
async function executeTool(name, args) {
  switch (name) {
    case 'system_status':
      await audit(ctx, { action: 'system_status', ok: true });
      return {
        name: 'chatgpt-remote-commander', version: VERSION,
        deviceName: config.deviceName || os.hostname(),
        platform: process.platform, arch: process.arch, shell: shellName(),
        protocols: [MODERN_VERSION, ...LEGACY_VERSIONS],
        host: config.host, port: config.port, allowedRoots: roots,
        allowedPrograms: config.allowedPrograms,
        concurrency: { httpConcurrent: true, pathMutationLocks: true, ...lockStats() },
        powerMode: config.powerMode ?? { enabled: false }
      };
    case 'list_directory':
      return listDirectory(ctx, args);
    case 'read_text':
      return readText(ctx, args);
    case 'write_text':
      return writeText(ctx, args);
    case 'run_project_command':
      return runProjectCommand(ctx, args);
    default: {
      const result = await executePowerTool(ctx, name, args);
      await audit(ctx, { action: name, ok: true, powerMode: true });
      return result;
    }
  }
}
function header(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function protocolFailure(httpStatus, code, message, data) {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  error.rpcCode = code;
  error.rpcData = data;
  return error;
}

function isModernRequest(req, message) {
  const hv = header(req, 'mcp-protocol-version');
  const bv = message?.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
  return hv === MODERN_VERSION || bv === MODERN_VERSION;
}
function validateModern(req, message) {
  const hv = header(req, 'mcp-protocol-version');
  const meta = message?.params?._meta;
  const bv = meta?.['io.modelcontextprotocol/protocolVersion'];
  if (hv !== MODERN_VERSION || bv !== MODERN_VERSION || hv !== bv) {
    throw protocolFailure(400, -32020, 'MCP protocol header/body mismatch');
  }
  if (!meta || typeof meta['io.modelcontextprotocol/clientCapabilities'] !== 'object') {
    throw protocolFailure(400, -32602, 'Missing modern MCP client capabilities');
  }
  const methodHeader = header(req, 'mcp-method');
  if (methodHeader !== message.method) {
    throw protocolFailure(400, -32020, 'Mcp-Method header does not match request body');
  }
  if (message.method === 'tools/call') {
    const nameHeader = header(req, 'mcp-name');
    if (nameHeader !== message.params?.name) {
      throw protocolFailure(400, -32020, 'Mcp-Name header does not match request body');
    }
  }
}
async function handleMessage(req, message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { status: 400, body: rpcError(message?.id, -32600, 'Invalid Request') };
  }
  const modern = isModernRequest(req, message);
  if (modern) validateModern(req, message);
  try {
    if (!modern && message.method === 'initialize') {
      const requested = message.params?.protocolVersion;
      const protocolVersion = LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
      return { status: 200, body: rpcResult(message.id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'chatgpt-remote-commander', version: VERSION },
        instructions: 'Operate only inside configured project roots. Multiple chats may call concurrently; mutations are serialized per path.'
      }, false) };
    }
    if (modern && message.method === 'server/discover') {
      return { status: 200, body: rpcResult(message.id, {
        supportedVersions: [MODERN_VERSION],
        capabilities: { tools: {} },
        instructions: 'Operate only inside configured project roots. Prefer read-only inspection before mutation. Concurrent chats are supported with per-path mutation locks.',
        ttlMs: 300000,
        cacheScope: 'public'
      }, true) };
    }
    if (message.method === 'tools/list') {
      return { status: 200, body: rpcResult(message.id, { tools: TOOLS }, modern) };
    }
    if (message.method === 'tools/call') {
      const result = await executeTool(message.params?.name, message.params?.arguments ?? {});
      const payload = { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false };
      return { status: 200, body: rpcResult(message.id, payload, modern) };
    }
    if (message.method === 'notifications/initialized') {
      return { status: 202, body: null };
    }
    return { status: 200, body: rpcError(message.id, -32601, 'Method not found') };
  } catch (error) {
    await audit(ctx, { action: 'rpc_error', method: message.method, ok: false, error: error.message });
    return {
      status: error.httpStatus ?? 200,
      body: rpcError(message.id, error.rpcCode ?? -32000, error.message, error.rpcData)
    };
  }
}
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw protocolFailure(413, -32600, 'Request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw protocolFailure(400, -32700, 'Parse error');
  }
}

function sendJson(res, status, body) {
  if (body === null) {
    res.writeHead(status);
    res.end();
    return;
  }
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': data.length });
  res.end(data);
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, name: 'chatgpt-remote-commander', version: VERSION });
    }
    if (req.method !== 'POST' || url.pathname !== '/mcp') {
      return sendJson(res, 404, { error: 'not_found' });
    }
    const message = await readJsonBody(req);
    const outcome = await handleMessage(req, message);
    return sendJson(res, outcome.status, outcome.body);
  } catch (error) {
    await audit(ctx, { action: 'http_error', ok: false, error: error.message });
    return sendJson(res, error.httpStatus ?? 500, rpcError(null, error.rpcCode ?? -32603, error.message, error.rpcData));
  }
});

server.listen(config.port, config.host, () => {
  console.log(`ChatGPT Remote Commander ${VERSION} listening at http://${config.host}:${config.port}/mcp`);
  console.log(`Allowed roots: ${roots.join(', ')}`);
});
