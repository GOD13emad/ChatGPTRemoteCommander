import http from 'node:http';
import { createHash } from 'node:crypto';
import { validateTransport, assertLocalTransport } from './transport-guard.mjs';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { canonicalizeRoots } from './security-v0.3.mjs';
import { audit, listDirectory, prepareProjectCommand, readText, runProjectCommand, writeText } from './tools-v0.3.mjs';
import { executePowerTool, powerToolDefinitions, prepareShellCommand } from './power-tools-v0.3.mjs';
import { executeGuiTool, guiToolDefinitions } from './gui-tools-windows.mjs';
import { executeBrowserTool, browserToolDefinitions } from './browser-tools.mjs';
import { lockStats } from './locks.mjs';
import { expandPathValue, shellName } from './platform.mjs';
import { formatToolInputErrors, validateJsonSchema } from './schema-validator.mjs';
import { createAsyncOperationTools } from './async-operations.mjs';
import { DeliveryStore, deliveryLocation } from './delivery-store.mjs';
import { createDeliveryTools } from './delivery-tools.mjs';
import { compactToolSuccessPayload, serializeBoundedJsonResponse } from './retry-guard.mjs';

let workflowTools = null;
const VERSION = '0.9.3';
const MODERN_VERSION = '2026-07-28';
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const MODERN_CACHE_HINT = Object.freeze({ ttlMs: 30000, cacheScope: 'private' });
const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(here, '..');
const defaultConfigPath = path.join(projectDir, 'config.json');
const localConfigPath = path.join(projectDir, 'config.local.json');
let configPath = process.env.REMOTE_COMMANDER_CONFIG || defaultConfigPath;
if (!process.env.REMOTE_COMMANDER_CONFIG) {
  try { await readFile(localConfigPath, 'utf8'); configPath = localConfigPath; } catch { /* safe public config fallback */ }
}
const configRaw = await readFile(configPath, 'utf8');
const configSha256 = createHash('sha256').update(configRaw).digest('hex');
const config = JSON.parse(configRaw);
assertLocalTransport(config);
function expandEnvironment(value) { return expandPathValue(value); }
config.allowedRoots = config.allowedRoots.map(expandEnvironment);
const roots = await canonicalizeRoots(config.allowedRoots);
const runtimeDir = path.resolve(projectDir, 'var');
const runtimeStatePath = config.runtimeState
  ? path.resolve(expandEnvironment(config.runtimeState))
  : path.join(runtimeDir, 'mcp-runtime.json');
const ctx = {
  config,
  roots,
  auditLog: path.resolve(projectDir, config.auditLog || 'var/audit.jsonl')
};
const GUI_BACKEND_SUPPORTED = process.platform === 'win32' || process.platform === 'linux';
const GUI_ENABLED = GUI_BACKEND_SUPPORTED && config.powerMode?.enabled === true && config.powerMode?.guiControl?.enabled === true;
const BROWSER_ENABLED = config.powerMode?.enabled === true && config.powerMode?.browserControl?.enabled === true;
const LEGACY_FULL_FILESYSTEM = config.powerMode?.enabled === true && config.powerMode?.fullFilesystem === true;
const deliveryStore = new DeliveryStore(deliveryLocation(config, configPath));
const deliveryTools = createDeliveryTools(deliveryStore);
const asyncOperationTools = createAsyncOperationTools({
  config,
  deliveryStore,
  prepare: async (name, args) => {
    if (name === 'run_project_command') return prepareProjectCommand(ctx, args);
    if (name === 'run_shell') return prepareShellCommand(ctx, args);
    throw new Error('unsupported async operation tool');
  }
});

function operatingInstructions() {
  if (LEGACY_FULL_FILESYSTEM) {
    return 'Power Mode full-filesystem is enabled. configured/allowedRoots are Standard Mode roots and the default relative-path base, not an active filesystem boundary. Legacy list_directory/read_text/write_text/run_project_command accept absolute paths outside allowedRoots subject to OS permissions and policy. run_project_command remains executable-allowlisted and Python -c / Node eval-print remain blocked. Prefer read-only inspection before mutation. Background-first is the default: use operation_start for long-running or high-output command work so the MCP call returns immediately, and use the owned headless browser before shared-desktop GUI takeover. Saved browser passwords are never extracted; if MFA, WebAuthn, CAPTCHA, or user-browser credentials require foreground interaction, request explicit current-task approval and use the minimum temporary GUI takeover.';
  }
  return 'Operate only inside configured project roots. Prefer read-only inspection before mutation. Background-first is the default: use operation_start for long-running allowlisted commands; synchronous command calls are for short bounded work. Concurrent chats are supported with per-path mutation locks.';
}
const TOOLS = [
  {
    name: 'system_status',
    description: 'Return server version, capability profile, configured roots, effective access, workflow/scheduler health, Power Mode state, and protocol support.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'list_directory',
    description: LEGACY_FULL_FILESYSTEM ? 'List a directory with bounded recursion. Power Mode fullFilesystem=true permits absolute paths outside configured allowedRoots.' : 'List a directory inside an allowed project root with bounded recursion.',
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
    description: LEGACY_FULL_FILESYSTEM ? 'Read a UTF-8 text file and return its SHA-256 hash. Power Mode fullFilesystem=true permits absolute paths outside configured allowedRoots.' : 'Read a UTF-8 text file inside an allowed root and return its SHA-256 hash.',
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
    description: LEGACY_FULL_FILESYSTEM ? 'Write or append UTF-8 text. Power Mode fullFilesystem=true permits absolute paths outside configured allowedRoots; existing files are backed up using the Power Mode backup root.' : 'Write or append UTF-8 text inside an allowed root. Existing files are backed up first.',
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
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  },
  {
    name: 'run_project_command',
    description: LEGACY_FULL_FILESYSTEM ? 'Run one short bounded allowlisted executable directly without a shell. Synchronous calls are hard-limited to 15 seconds; use operation_start with a stable requestId for longer, unknown-duration, or high-output work. Power Mode fullFilesystem=true permits cwd and path arguments outside configured allowedRoots; Python -c and Node eval/print remain blocked.' : 'Run one short bounded allowlisted executable directly in an allowed project directory without a shell. Synchronous calls are hard-limited to 15 seconds; use operation_start with a stable requestId for longer, unknown-duration, or high-output work.',
    inputSchema: {
      type: 'object',
      properties: {
        program: { type: 'string', minLength: 1 },
        args: { type: 'array', items: { type: 'string' }, maxItems: 100 },
        cwd: { type: 'string' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 15000 }
      },
      required: ['program'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  },
  ...asyncOperationTools.definitions,
  ...deliveryTools.definitions,
  ...powerToolDefinitions,
  ...(BROWSER_ENABLED ? browserToolDefinitions : []),
  ...(GUI_ENABLED ? guiToolDefinitions : [])
];
// Opt-in only. Baseline tool catalog is unchanged when durable workflows are disabled.
if (config.durableWorkflows?.enabled === true) {
  const { createWorkflowTools } = await import('./workflow-tools.mjs');
  workflowTools = createWorkflowTools({
    config, roots, device: config.deviceName || os.hostname(), configSha256,
    deliveryStore,
    lookup: toolDefinition, validateSchema: validateJsonSchema,
    dispatch: async (name, args, workflow) => {
      // Further restrict file operations to the project, even in full Power Mode.
      // Executed programs remain OS processes, NOT sandboxed by these path checks.
      const scoped = { ...ctx, roots: [workflow.root], config: {
        ...config, allowedRoots: [workflow.root],
        powerMode: { ...config.powerMode, fullFilesystem: false }
      } };
      switch (name) {
        case 'system_status': return executeTool(name, args);
        case 'list_directory': return listDirectory(scoped, args);
        case 'read_text': return readText(scoped, args);
        case 'write_text': return writeText(scoped, args);
        case 'run_project_command': return runProjectCommand(scoped, args);
        default: return name.startsWith('gui_')
          ? executeGuiTool(scoped, name, args) : executePowerTool(scoped, name, args);
      }
    }
  });
  TOOLS.push(...workflowTools.definitions);
}
function serverMeta() {
  return { 'io.modelcontextprotocol/serverInfo': { name: 'chatgpt-remote-commander', version: VERSION } };
}

function modernResult(payload) {
  return { resultType: 'complete', ...payload, _meta: serverMeta() };
}

function legacyResult(payload) {
  return payload;
}

function toolDefinition(name) {
  return typeof name === 'string' ? TOOLS.find(tool => tool.name === name) : undefined;
}

function toolErrorPayload(message) {
  return {
    content: [{ type: 'text', text: String(message) }],
    isError: true
  };
}

function toolSuccessPayload(result) {
  return compactToolSuccessPayload(result);
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
  if (!toolDefinition(name)) throw protocolFailure(200, -32602, 'Unknown tool');
  if (name.startsWith('operation_')) return asyncOperationTools.execute(name, args);
  if (name.startsWith('delivery_')) return deliveryTools.execute(name, args);
  if (name.startsWith('workflow_')) return workflowTools.execute(name, args);
  switch (name) {
    case 'system_status': {
      await audit(ctx, { action: 'system_status', ok: true });
      const workflowStatus = workflowTools
        ? await workflowTools.execute('workflow_status', {})
        : { enabled:false, engineEnabled:false, scheduler:false, automaticContinuation:false };
      return {
        name: 'chatgpt-remote-commander', version: VERSION,
        deviceName: config.deviceName || os.hostname(),
        platform: process.platform, arch: process.arch, shell: shellName(),
        protocols: [MODERN_VERSION, ...LEGACY_VERSIONS],
        host: config.host, port: config.port,
        allowedRoots: roots,
        configuredRoots: roots,
        allowedRootsEnforced: !LEGACY_FULL_FILESYSTEM,
        effectiveAccess: {
          filesystem: LEGACY_FULL_FILESYSTEM ? 'full-filesystem' : 'allowed-roots',
          legacyFiveToolCompatibility: LEGACY_FULL_FILESYSTEM,
          legacyFileTools: LEGACY_FULL_FILESYSTEM ? 'full-filesystem' : 'allowed-roots',
          runProjectCommandCwd: LEGACY_FULL_FILESYSTEM ? 'full-filesystem' : 'allowed-roots',
          programPolicy: 'allowlist',
          evalPolicy: 'python-c-and-node-eval-print-blocked',
          osPermissionsApply: true
        },
        allowedPrograms: config.allowedPrograms,
        concurrency: { httpConcurrent: true, pathMutationLocks: true, ...lockStats() },
        configSha256,
        configSchema: {
          capabilityProfile: config.capabilityProfile?.schemaVersion ?? 0,
          durableWorkflow: workflowStatus.schema ?? 0,
          asyncOperations: 1,
          durableDelivery: 1
        },
        capabilityProfile: config.capabilityProfile ?? {
          id: config.instance?.profile ?? 'default',
          tier: config.powerMode?.enabled && config.powerMode?.fullFilesystem ? 'FULL_POWER' : 'STANDARD',
          explicitlyAuthorized: false,
          persistAcrossUpdates: false
        },
        instance: config.instance ?? { profile: 'default', isolated: false },
        durableWorkflows: workflowStatus,
        asyncOperations: asyncOperationTools.status(),
        durableDelivery: deliveryTools.status(),
        powerMode: config.powerMode ?? { enabled: false },
        browserControl: { availability: BROWSER_ENABLED ? 'CHECK_browser_status' : 'DISABLED', enabled: BROWSER_ENABLED,
          policy: { ...(config.powerMode?.browserControl ?? { enabled:false }), backgroundFirst:true,
            foregroundFallback:'explicit-current-request-only', workflowBrowserAllowed:false,
            userBrowserProfileReuse:false, savedPasswordExtraction:false, foregroundInterferenceByDefault:false } },
        guiControl: { backendSupported: GUI_BACKEND_SUPPORTED, availability: 'CHECK_gui_status', enabled: GUI_ENABLED,
          policy: { ...(config.powerMode?.guiControl ?? { enabled:false }), interactionPolicy:'explicit-current-request-only',
            defaultSessionMode:'observe', backgroundPreferred:true, workflowTakeoverAllowed:false, foregroundInterferenceByDefault:false } }
      };
    }
    case 'list_directory':
      return listDirectory(ctx, args);
    case 'read_text':
      return readText(ctx, args);
    case 'write_text':
      return writeText(ctx, args);
    case 'run_project_command':
      return runProjectCommand(ctx, args);
    default: {
      if (name.startsWith('browser_')) {
        const result = await executeBrowserTool(ctx, name, args);
        await audit(ctx, { action: name, ok: true, powerMode: true, browserControl: true });
        return result;
      }
      if (name.startsWith('gui_')) {
        const result = await executeGuiTool(ctx, name, args);
        await audit(ctx, { action: name, ok: true, powerMode: true, guiControl: true });
        return result;
      }
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function classifyProtocol(req, message) {
  const hv = header(req, 'mcp-protocol-version');
  const meta = message?.params?._meta;
  const bv = meta?.['io.modelcontextprotocol/protocolVersion'];

  if (bv !== undefined || hv === MODERN_VERSION) {
    if (hv !== bv) throw protocolFailure(400, -32020, 'MCP protocol header/body mismatch');
    if (bv !== MODERN_VERSION) {
      throw protocolFailure(400, -32022, `Unsupported MCP protocol version: ${String(bv)}`);
    }
    return 'modern';
  }

  if (hv !== undefined && !LEGACY_VERSIONS.includes(hv)) {
    throw protocolFailure(400, -32022, `Unsupported MCP protocol version: ${String(hv)}`);
  }
  return 'legacy';
}

function validateModern(req, message) {
  const meta = message?.params?._meta;
  const capabilities = meta?.['io.modelcontextprotocol/clientCapabilities'];
  if (!isPlainObject(capabilities)) {
    throw protocolFailure(400, -32021, 'Missing required modern MCP client capabilities');
  }
  const clientInfo = meta?.['io.modelcontextprotocol/clientInfo'];
  if (clientInfo !== undefined && (
    !isPlainObject(clientInfo) ||
    typeof clientInfo.name !== 'string' ||
    typeof clientInfo.version !== 'string'
  )) {
    throw protocolFailure(400, -32602, 'Malformed modern MCP clientInfo');
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
  let era;
  try {
    era = classifyProtocol(req, message);
    if (era === 'modern') validateModern(req, message);
  } catch (error) {
    return {
      status: error.httpStatus ?? 400,
      body: rpcError(message.id, error.rpcCode ?? -32600, error.message, error.rpcData)
    };
  }
  const modern = era === 'modern';
  try {
    if (!modern && message.method === 'initialize') {
      const requested = message.params?.protocolVersion;
      const protocolVersion = LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
      return { status: 200, body: rpcResult(message.id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'chatgpt-remote-commander', version: VERSION },
        instructions: operatingInstructions()
      }, false) };
    }
    if (modern && message.method === 'server/discover') {
      return { status: 200, body: rpcResult(message.id, {
        supportedVersions: [MODERN_VERSION],
        capabilities: { tools: {} },
        instructions: operatingInstructions(),
        ...MODERN_CACHE_HINT
      }, true) };
    }
    if (message.method === 'tools/list') {
      const payload = modern ? { tools: TOOLS, ...MODERN_CACHE_HINT } : { tools: TOOLS };
      return { status: 200, body: rpcResult(message.id, payload, modern) };
    }
    if (message.method === 'tools/call') {
      const name = message.params?.name;
      const definition = toolDefinition(name);
      if (!definition) throw protocolFailure(200, -32602, 'Unknown tool');

      const args = message.params?.arguments ?? {};
      const validationErrors = validateJsonSchema(args, definition.inputSchema);
      if (validationErrors.length > 0) {
        const messageText = formatToolInputErrors(name, validationErrors);
        await audit(ctx, { action: 'tool_validation_error', tool: name, ok: false, errors: validationErrors.slice(0, 8) });
        return { status: 200, body: rpcResult(message.id, toolErrorPayload(messageText), modern) };
      }

      try {
        const result = await executeTool(name, args);
        return { status: 200, body: rpcResult(message.id, toolSuccessPayload(result), modern) };
      } catch (error) {
        await audit(ctx, { action: 'tool_error', tool: name, ok: false, error: error.message });
        return { status: 200, body: rpcResult(message.id, toolErrorPayload(error.message), modern) };
      }
    }
    if (!modern && message.method === 'notifications/initialized') {
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
  res.setHeader('Cache-Control', 'no-store');
  const bounded = serializeBoundedJsonResponse(body);
  const responseStatus = bounded.overflow && body?.jsonrpc !== '2.0' ? 500 : status;
  res.writeHead(responseStatus, { 'content-type': 'application/json', 'content-length': bounded.data.length });
  res.end(bounded.data);
}
const server = http.createServer(async (req, res) => {
  try {
    validateTransport(req, config);
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, name: 'chatgpt-remote-commander', version: VERSION, configSha256,
        instance: config.instance ?? { profile: 'default', isolated: false } });
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

server.listen(config.port, config.host, async () => {
  try {
    await mkdir(path.dirname(runtimeStatePath), { recursive: true });
    await writeFile(runtimeStatePath, JSON.stringify({
      pid: process.pid,
      projectDir,
      version: VERSION,
      configSha256,
      instance: config.instance ?? { profile: 'default', isolated: false },
      host: config.host,
      port: config.port,
      startedAt: new Date().toISOString()
    }, null, 2) + '\n', { mode: 0o600 });
  } catch (error) {
    console.error('RUNTIME_STATE_WRITE_FAILED', error.message);
  }
  console.log(`ChatGPT Remote Commander ${VERSION} listening at http://${config.host}:${config.port}/mcp`);
  console.log(`Allowed roots: ${roots.join(', ')}`);
});
