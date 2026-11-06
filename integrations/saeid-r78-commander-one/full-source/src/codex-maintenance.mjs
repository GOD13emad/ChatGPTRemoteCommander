import path from 'node:path';
import { spawn } from 'node:child_process';
import { terminateProcessTree } from './platform.mjs';
import { codexMaintenanceAuthorized, commanderCodexMaintenanceEnv } from './no-codex-policy.mjs';

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_STDERR_CHARS = 16 * 1024;
const MAX_STDOUT_LINE_CHARS = 2 * 1024 * 1024;
const MAX_MARKETPLACES = 32;
const MAX_RETURNED_PLUGINS = 256;
const MAX_FIELD_CHARS = 512;

function clippedText(value) {
  if (typeof value !== 'string') return null;
  return value.length <= MAX_FIELD_CHARS ? value : value.slice(0, MAX_FIELD_CHARS);
}

function compactPluginSource(source) {
  const type = clippedText(source?.type);
  if (type === 'local') {
    return { type, path: clippedText(source?.path) };
  }
  if (type === 'git') {
    return {
      type,
      url: clippedText(source?.url),
      path: clippedText(source?.path),
      refName: clippedText(source?.refName),
      sha: clippedText(source?.sha)
    };
  }
  if (type === 'npm') {
    return {
      type,
      package: clippedText(source?.package),
      version: clippedText(source?.version),
      registry: clippedText(source?.registry)
    };
  }
  if (type === 'remote') return { type };
  return null;
}

function compactPlugin(plugin) {
  return {
    id: clippedText(plugin?.id),
    name: clippedText(plugin?.name),
    localVersion: clippedText(plugin?.localVersion),
    source: compactPluginSource(plugin?.source),
    installed: plugin?.installed === true,
    enabled: plugin?.enabled === true
  };
}

function summarizePluginList(response, targetName = null) {
  const source = Array.isArray(response?.marketplaces) ? response.marketplaces : [];
  const marketplaces = [];
  let observedPluginCount = 0;
  let returnedPluginCount = 0;
  let target = null;

  for (const marketplace of source) {
    const plugins = Array.isArray(marketplace?.plugins) ? marketplace.plugins : [];
    observedPluginCount += plugins.length;

    if (targetName && target === null) {
      const match = plugins.find((plugin) => plugin?.name === targetName || plugin?.id === targetName);
      if (match) target = { marketplace: clippedText(marketplace?.name), ...compactPlugin(match) };
    }

    if (marketplaces.length >= MAX_MARKETPLACES || returnedPluginCount >= MAX_RETURNED_PLUGINS) continue;
    const remaining = MAX_RETURNED_PLUGINS - returnedPluginCount;
    const compacted = plugins.slice(0, remaining).map(compactPlugin);
    returnedPluginCount += compacted.length;
    marketplaces.push({
      name: clippedText(marketplace?.name),
      plugins: compacted
    });
  }

  return {
    marketplaces,
    target,
    observedMarketplaceCount: source.length,
    observedPluginCount,
    returnedPluginCount,
    truncated: source.length > marketplaces.length || observedPluginCount > returnedPluginCount
  };
}

function createJsonLineRouter(child, writeLine) {
  let buffer = '';
  const pending = new Map();
  let closed = null;

  const failAll = (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    while (true) {
      const index = buffer.indexOf('\n');
      if (index < 0) {
        if (buffer.length > MAX_STDOUT_LINE_CHARS) {
          closed = Object.assign(new Error('Codex maintenance app-server emitted an oversized JSONL frame'), {
            code: 'CODEX_MAINTENANCE_OUTPUT_LIMIT'
          });
          buffer = '';
          failAll(closed);
        }
        break;
      }
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      if (line.length > MAX_STDOUT_LINE_CHARS) {
        closed = Object.assign(new Error('Codex maintenance app-server emitted an oversized JSONL frame'), {
          code: 'CODEX_MAINTENANCE_OUTPUT_LIMIT'
        });
        failAll(closed);
        continue;
      }
      let message;
      try { message = JSON.parse(line); }
      catch { continue; }
      if (message && Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
        const key = String(message.id);
        const waiter = pending.get(key);
        if (!waiter) continue;
        pending.delete(key);
        if (message.error) {
          const messageText = clippedText(String(message.error?.message ?? 'Codex app-server request failed'));
          const error = new Error(messageText ?? 'Codex app-server request failed');
          error.code = 'CODEX_MAINTENANCE_RPC_ERROR';
          waiter.reject(error);
        } else {
          waiter.resolve(message.result);
        }
        continue;
      }
      if (message?.method && Object.prototype.hasOwnProperty.call(message, 'id')) {
        writeLine({
          id: message.id,
          error: { code: -32601, message: 'Remote Commander maintenance sidecar does not service server requests' }
        });
      }
    }
  });

  child.once('error', (error) => {
    closed = error;
    failAll(error);
  });
  child.once('close', (code, signal) => {
    if (closed) return;
    closed = Object.assign(new Error(`Codex maintenance sidecar closed before response (code=${code}, signal=${signal ?? 'none'})`), {
      code: 'CODEX_MAINTENANCE_SIDECAR_CLOSED'
    });
    failAll(closed);
  });

  function request(id, method, params, timeoutMs) {
    if (closed) return Promise.reject(closed);
    const key = String(id);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(key);
        const error = Object.assign(new Error(`Codex maintenance RPC timed out: ${method}`), {
          code: 'CODEX_MAINTENANCE_TIMEOUT'
        });
        reject(error);
      }, timeoutMs);
      pending.set(key, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      writeLine({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  return { request };
}

export async function refreshCodexPluginCache(ctx, input = {}, deps = {}) {
  if (!codexMaintenanceAuthorized(ctx, input)) {
    const error = new Error('CODEX_MAINTENANCE_REQUIRES_EXPLICIT_CURRENT_REQUEST');
    error.code = 'CODEX_MAINTENANCE_REQUIRES_EXPLICIT_CURRENT_REQUEST';
    throw error;
  }

  const spawnImpl = deps.spawnImpl ?? spawn;
  const terminateImpl = deps.terminateImpl ?? terminateProcessTree;
  const command = deps.command ?? 'codex';
  const timeoutMs = Math.max(1_000, Math.min(Number(input.timeoutMs ?? DEFAULT_TIMEOUT_MS), DEFAULT_TIMEOUT_MS));
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(250, deadline - Date.now());
  const cwd = input.cwd ? path.resolve(input.cwd) : ctx.roots?.[0] ?? process.cwd();

  const child = spawnImpl(command, ['app-server'], {
    cwd,
    windowsHide: true,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: commanderCodexMaintenanceEnv(process.env)
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    if (stderr.length < MAX_STDERR_CHARS) stderr += chunk.toString('utf8');
  });

  const writeLine = (message) => child.stdin.write(JSON.stringify(message) + '\n');
  const router = createJsonLineRouter(child, writeLine);
  const stop = async () => {
    if (!child.pid) return;
    try { terminateImpl(child.pid, { signal: 'SIGTERM' }); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 60));
    try { if (!child.killed) terminateImpl(child.pid, { signal: 'SIGKILL' }); } catch {}
  };

  try {
    const initialize = await router.request('rc-maint-init', 'initialize', {
      clientInfo: {
        name: 'chatgpt-remote-commander-maintenance',
        title: 'Remote Commander Codex Maintenance',
        version: '1'
      },
      capabilities: { experimentalApi: false }
    }, remaining());
    writeLine({ method: 'initialized' });

    const pluginList = await router.request('rc-maint-plugin-list', 'plugin/list', {
      cwds: input.cwd ? [cwd] : [],
      marketplaceKinds: ['local'],
      forceRefetch: true
    }, remaining());

    const summary = summarizePluginList(
      pluginList,
      typeof input.pluginName === 'string' && input.pluginName ? input.pluginName : null
    );

    return {
      ok: true,
      mode: 'scoped-codex-plugin-maintenance',
      forceRefetch: true,
      codexUserAgent: clippedText(initialize?.userAgent),
      marketplaceCount: summary.observedMarketplaceCount,
      pluginCount: summary.observedPluginCount,
      returnedMarketplaceCount: summary.marketplaces.length,
      returnedPluginCount: summary.returnedPluginCount,
      truncated: summary.truncated,
      marketplaces: summary.marketplaces,
      target: summary.target,
      diagnostics: stderr.trim() ? 'sidecar-stderr-present' : null
    };
  } finally {
    try { child.stdin.end(); } catch {}
    await stop();
  }
}
