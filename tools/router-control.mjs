import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  initializePointer, loadPointer, loadRouterConfig, probeBackend, routerError,
  switchPointer, validateBackendIdentity
} from '../src/router-state.mjs';

const IDENTITY_OPTIONS = [
  'profile', 'version', 'config-sha256', 'commit', 'slot-id', 'project-dir', 'port'
];

function parse(argv) {
  const command = argv[0];
  if (!['init', 'status', 'switch'].includes(command)) throw routerError('ROUTER_CONTROL_COMMAND_REQUIRED');
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const token = argv[index];
    if (!token?.startsWith('--') || index + 1 >= argv.length) throw routerError('ROUTER_CONTROL_ARGUMENT_INVALID');
    const name = token.slice(2);
    if (Object.hasOwn(options, name)) throw routerError('ROUTER_CONTROL_ARGUMENT_DUPLICATE');
    options[name] = argv[index + 1];
  }
  const allowed = new Set(['expected-generation', ...IDENTITY_OPTIONS]);
  if (Object.keys(options).some(name => !allowed.has(name))) throw routerError('ROUTER_CONTROL_ARGUMENT_UNKNOWN');
  return { command, options };
}

function generation(value, required = true) {
  if (value === undefined && !required) return null;
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,15})$/.test(value)) {
    throw routerError('ROUTER_EXPECTED_GENERATION_INVALID');
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw routerError('ROUTER_EXPECTED_GENERATION_INVALID');
  return number;
}

function backend(options) {
  if (IDENTITY_OPTIONS.some(name => !Object.hasOwn(options, name))) {
    throw routerError('ROUTER_BACKEND_IDENTITY_REQUIRED');
  }
  return validateBackendIdentity({
    profile: options.profile,
    version: options.version,
    configSha256: options['config-sha256'],
    commit: options.commit,
    slotId: options['slot-id'],
    projectDir: options['project-dir'],
    port: Number(options.port)
  });
}

function assertRouterTarget(config, identity) {
  if (identity.profile !== config.profile) throw routerError('ROUTER_PROFILE_MISMATCH');
  if (identity.port === config.port) throw routerError('ROUTER_BACKEND_PORT_CONFLICT');
}

async function main(argv = process.argv.slice(2)) {
  const configPath = process.env.REMOTE_COMMANDER_ROUTER_CONFIG;
  if (!configPath) throw routerError('ROUTER_CONFIG_ENV_REQUIRED');
  const { command, options } = parse(argv);
  const loaded = await loadRouterConfig(configPath);
  const validateCandidate = async identity => {
    assertRouterTarget(loaded.config, identity);
    await probeBackend(identity, {
      timeoutMs: loaded.config.healthTimeoutMs,
      responseMaxBytes: loaded.config.responseMaxBytes
    });
  };

  if (command === 'status') {
    if (IDENTITY_OPTIONS.some(name => Object.hasOwn(options, name))) throw routerError('ROUTER_STATUS_IDENTITY_NOT_ALLOWED');
    const expected = generation(options['expected-generation'], false);
    const pointer = await loadPointer(loaded.config.pointerPath);
    assertRouterTarget(loaded.config, pointer.backend);
    if (expected !== null && pointer.generation !== expected) throw routerError('ROUTER_GENERATION_CONFLICT');
    const health = await probeBackend(pointer.backend, {
      timeoutMs: loaded.config.healthTimeoutMs,
      responseMaxBytes: loaded.config.responseMaxBytes
    });
    return { ok: true, command, routerId: loaded.config.routerId, configSha256: loaded.sha256,
      generation: pointer.generation, backend: pointer.backend, backendHealth: { ok: health.ok } };
  }

  const expectedGeneration = generation(options['expected-generation']);
  const identity = backend(options);
  assertRouterTarget(loaded.config, identity);
  const pointer = command === 'init'
    ? await initializePointer({ pointerPath: loaded.config.pointerPath, expectedGeneration, backend: identity, validateCandidate })
    : await switchPointer({ pointerPath: loaded.config.pointerPath, expectedGeneration, backend: identity, validateCandidate });
  const result = { ok: true, command, routerId: loaded.config.routerId, configSha256: loaded.sha256,
    generation: pointer.generation, backend: pointer.backend };
  if (pointer.alreadyActive === true) result.alreadyActive = true;
  return result;
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invoked === import.meta.url) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.code ?? 'ROUTER_CONTROL_FAILED' }));
    process.exitCode = 1;
  }
}

export { main as runRouterControl };
