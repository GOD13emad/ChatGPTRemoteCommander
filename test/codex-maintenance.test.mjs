import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  codexMaintenanceAuthorized,
  commanderCodexMaintenanceEnv
} from '../src/no-codex-policy.mjs';
import { refreshCodexPluginCache } from '../src/codex-maintenance.mjs';
import { powerToolDefinitions } from '../src/power-tools-v0.3.mjs';

function fullPowerCtx() {
  return {
    roots: ['/tmp'],
    config: {
      powerMode: { enabled: true, fullFilesystem: true, allowShell: true, allowProcessControl: true, codexControl: { allowLaunch: false } },
      capabilityProfile: { tier: 'FULL_POWER', explicitlyAuthorized: true }
    }
  };
}

function fakeSidecar(pluginListResult = null) {
  let child = null;
  const messages = [];
  const spawnCalls = [];
  const defaultPluginListResult = {
    marketplaces: [{
      name: 'personal',
      plugins: [{
        id: 'linux-project-skills@personal',
        name: 'linux-project-skills',
        localVersion: '1.4.13',
        installed: true,
        enabled: true
      }]
    }],
    marketplaceLoadErrors: [],
    featuredPluginIds: []
  };

  const spawnImpl = (command, args, options) => {
    spawnCalls.push({ command, args: [...args], options: { cwd: options.cwd, shell: options.shell } });
    child = new EventEmitter();
    child.pid = 424242;
    child.killed = false;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();

    let buffer = '';
    child.stdin.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (true) {
        const index = buffer.indexOf('\n');
        if (index < 0) break;
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        messages.push(message);
        if (message.method === 'initialize' && message.id) {
          queueMicrotask(() => child.stdout.write(JSON.stringify({
            id: message.id,
            result: {
              userAgent: 'codex-cli/0.157.1',
              codexHome: '/tmp/codex-home',
              platformFamily: 'unix',
              platformOs: 'linux'
            }
          }) + '\n'));
        } else if (message.method === 'plugin/list' && message.id) {
          queueMicrotask(() => child.stdout.write(JSON.stringify({
            id: message.id,
            result: pluginListResult ?? defaultPluginListResult
          }) + '\n'));
        }
      }
    });
    return child;
  };

  const terminateImpl = (_pid, { signal }) => {
    if (!child || child.killed) return;
    child.killed = true;
    queueMicrotask(() => child.emit('close', 0, signal === 'SIGTERM' ? null : signal));
  };

  return { spawnImpl, terminateImpl, messages, spawnCalls };
}

test('scoped maintenance requires explicit current-request confirmation but not general Codex launch', () => {
  const ctx = fullPowerCtx();
  assert.equal(ctx.config.powerMode.codexControl.allowLaunch, false);
  assert.equal(codexMaintenanceAuthorized(ctx, { confirmCurrentRequest: true }), true);
  assert.equal(codexMaintenanceAuthorized(ctx, { confirmCurrentRequest: false }), false);
  assert.equal(codexMaintenanceAuthorized({
    config: {
      powerMode: { enabled: true, allowShell: true, allowProcessControl: true },
      capabilityProfile: { tier: 'STANDARD', explicitlyAuthorized: true }
    }
  }, { confirmCurrentRequest: true }), false);
});

test('maintenance environment strips API credentials without redirecting a legitimate Codex home', () => {
  const env = commanderCodexMaintenanceEnv({
    HOME: '/home/test',
    CODEX_HOME: '/home/test/.codex',
    OPENAI_API_KEY: 'secret',
    CODEX_API_KEY: 'secret2',
    CODEX_ACCESS_TOKEN: 'secret3',
    KEEP_ME: 'yes',
    REMOTE_COMMANDER_NO_CODEX: '1'
  });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CODEX_API_KEY, undefined);
  assert.equal(env.CODEX_ACCESS_TOKEN, undefined);
  assert.equal(env.REMOTE_COMMANDER_NO_CODEX, undefined);
  assert.equal(env.CODEX_HOME, '/home/test/.codex');
  assert.equal(env.KEEP_ME, 'yes');
  assert.equal(env.REMOTE_COMMANDER_CODEX_MAINTENANCE, '1');
});

test('maintenance sidecar runs only fixed app-server handshake and force-refetch plugin/list', async () => {
  const fake = fakeSidecar();
  const result = await refreshCodexPluginCache(
    fullPowerCtx(),
    { confirmCurrentRequest: true, pluginName: 'linux-project-skills', timeoutMs: 2000 },
    { spawnImpl: fake.spawnImpl, terminateImpl: fake.terminateImpl }
  );

  assert.equal(result.ok, true);
  assert.equal(result.forceRefetch, true);
  assert.equal(result.codexUserAgent, 'codex-cli/0.157.1');
  assert.equal(result.target?.localVersion, '1.4.13');
  assert.deepEqual(fake.spawnCalls.map(({ command, args }) => ({ command, args })), [
    { command: 'codex', args: ['app-server'] }
  ]);

  assert.deepEqual(fake.messages.map((message) => message.method), [
    'initialize',
    'initialized',
    'plugin/list'
  ]);
  const list = fake.messages.find((message) => message.method === 'plugin/list');
  assert.equal(list.params.forceRefetch, true);
  assert.deepEqual(list.params.marketplaceKinds, ['local']);
  assert.deepEqual(list.params.cwds, []);
  assert.equal(fake.messages.some((message) => ['exec', 'review', 'turn/start', 'thread/start'].includes(message.method)), false);
});



test('maintenance response is hard-bounded while target lookup survives display truncation', async () => {
  const marketplaces = Array.from({ length: 40 }, (_, marketplaceIndex) => ({
    name: `market-${marketplaceIndex}`,
    plugins: Array.from({ length: 10 }, (_, pluginIndex) => ({
      id: `plugin-${marketplaceIndex}-${pluginIndex}@personal`,
      name: marketplaceIndex === 39 && pluginIndex === 9 ? 'target-plugin' : `plugin-${marketplaceIndex}-${pluginIndex}`,
      localVersion: '1.0.0',
      installed: true,
      enabled: true
    }))
  }));
  const fake = fakeSidecar({ marketplaces, marketplaceLoadErrors: [], featuredPluginIds: [] });
  const result = await refreshCodexPluginCache(
    fullPowerCtx(),
    { confirmCurrentRequest: true, pluginName: 'target-plugin', timeoutMs: 2000 },
    { spawnImpl: fake.spawnImpl, terminateImpl: fake.terminateImpl }
  );

  assert.equal(result.marketplaceCount, 40);
  assert.equal(result.pluginCount, 400);
  assert.equal(result.returnedMarketplaceCount <= 32, true);
  assert.equal(result.returnedPluginCount <= 256, true);
  assert.equal(result.truncated, true);
  assert.equal(result.target?.name, 'target-plugin');
});

test('maintenance rejects an oversized app-server JSONL frame before parsing it', async () => {
  let child = null;
  const spawnImpl = () => {
    child = new EventEmitter();
    child.pid = 424243;
    child.killed = false;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin.once('data', () => {
      queueMicrotask(() => child.stdout.write('x'.repeat(2 * 1024 * 1024 + 1) + '\n'));
    });
    return child;
  };
  const terminateImpl = (_pid, { signal }) => {
    if (!child || child.killed) return;
    child.killed = true;
    queueMicrotask(() => child.emit('close', 0, signal === 'SIGTERM' ? null : signal));
  };

  await assert.rejects(
    refreshCodexPluginCache(
      fullPowerCtx(),
      { confirmCurrentRequest: true, timeoutMs: 2000 },
      { spawnImpl, terminateImpl }
    ),
    (error) => error?.code === 'CODEX_MAINTENANCE_OUTPUT_LIMIT'
  );
});

test('maintenance helper fails closed before spawning when confirmation is absent', async () => {
  let spawned = false;
  await assert.rejects(
    refreshCodexPluginCache(fullPowerCtx(), {}, {
      spawnImpl: () => { spawned = true; throw new Error('should not spawn'); }
    }),
    (error) => error?.code === 'CODEX_MAINTENANCE_REQUIRES_EXPLICIT_CURRENT_REQUEST'
  );
  assert.equal(spawned, false);
});

test('tool schema exposes only bounded maintenance inputs and no arbitrary command/args', () => {
  const tool = powerToolDefinitions.find((item) => item.name === 'codex_plugin_refresh');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ['confirmCurrentRequest']);
  assert.equal(tool.inputSchema.properties.confirmCurrentRequest.enum[0], true);
  assert.equal(tool.inputSchema.properties.command, undefined);
  assert.equal(tool.inputSchema.properties.args, undefined);
  assert.equal(tool.inputSchema.properties.prompt, undefined);
  assert.equal(tool.inputSchema.additionalProperties, false);
});
