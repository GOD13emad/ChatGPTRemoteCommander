import http from 'node:http';
import { isUtf8 } from 'node:buffer';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateTransport } from './transport-guard.mjs';
import {
  ROUTER_REVISION, loadPointer, loadPointerSync, loadRouterConfig, probeBackend, requestBackend, routerError,
  writeJsonAtomic
} from './router-state.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sendJson(response, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json',
    'content-length': data.length,
    'x-content-type-options': 'nosniff'
  });
  response.end(data);
}

function readBody(request, maximum) {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers['content-length'] ?? 0);
    const chunks = [];
    let size = 0;
    let settled = false;
    const tooLarge = () => Object.assign(routerError('ROUTER_REQUEST_TOO_LARGE'), {
      httpStatus: 413,
      terminateRequest: true
    });
    const fail = error => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      request.pause();
      reject(error);
    };
    request.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maximum) {
        fail(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.once('error', fail);
    request.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    if (Number.isFinite(declared) && declared > maximum) fail(tooLarge());
  });
}

function upstreamHeaders(request, bodyLength) {
  const headers = {
    'content-type': 'application/json',
    'content-length': String(bodyLength)
  };
  if (typeof request.headers.accept === 'string') headers.accept = request.headers.accept;
  for (const name of ['mcp-protocol-version', 'mcp-method', 'mcp-name', 'mcp-session-id']) {
    const value = request.headers[name];
    if (typeof value === 'string' || Array.isArray(value)) headers[name] = value;
  }
  return headers;
}

function inFlightView(active) {
  const byBackend = {};
  let total = 0;
  for (const [key, count] of active) {
    if (count <= 0) continue;
    byBackend[key] = count;
    total += count;
  }
  return { total, byBackend };
}

function publicError(error) {
  const code = typeof error?.code === 'string' && error.code.startsWith('ROUTER_')
    ? error.code : 'ROUTER_INTERNAL_ERROR';
  const body = { ok: false, error: code };
  if (error?.uncertainEffect === true) {
    body.uncertainEffect = true;
    body.retryPermitted = false;
  }
  return body;
}

function uncertainPostResponse(code) {
  return Object.assign(routerError(code), {
    httpStatus: 502,
    uncertainEffect: true,
    retryPermitted: false
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validJsonRpcId(value) {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function requestExpectation(body) {
  let message;
  try { message = JSON.parse(body.toString('utf8')); }
  catch { return { kind: 'unknown' }; }
  if (!isPlainObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { kind: 'unknown' };
  }
  if (!Object.hasOwn(message, 'id')) return { kind: 'notification' };
  return validJsonRpcId(message.id) ? { kind: 'request', id: message.id } : { kind: 'unknown' };
}

function validatePostResponse(upstream, expectation) {
  if (!Number.isInteger(upstream.statusCode) || upstream.statusCode < 200 || upstream.statusCode > 599 ||
      (upstream.statusCode >= 300 && upstream.statusCode < 400)) {
    throw uncertainPostResponse('ROUTER_BACKEND_STATUS_INVALID_AFTER_DISPATCH');
  }
  const media = String(upstream.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (upstream.body.length === 0) {
    if (expectation.kind === 'notification' && [202, 204].includes(upstream.statusCode) && media.length === 0) return;
    throw uncertainPostResponse('ROUTER_BACKEND_JSONRPC_INVALID_AFTER_DISPATCH');
  }
  if (media !== 'application/json') {
    throw uncertainPostResponse('ROUTER_BACKEND_CONTENT_TYPE_INVALID_AFTER_DISPATCH');
  }
  if (!isUtf8(upstream.body)) throw uncertainPostResponse('ROUTER_BACKEND_JSON_INVALID_AFTER_DISPATCH');
  let message;
  try { message = JSON.parse(upstream.body.toString('utf8')); }
  catch { throw uncertainPostResponse('ROUTER_BACKEND_JSON_INVALID_AFTER_DISPATCH'); }
  const hasResult = isPlainObject(message) && Object.hasOwn(message, 'result');
  const hasError = isPlainObject(message) && Object.hasOwn(message, 'error');
  const allowed = hasResult ? ['jsonrpc', 'id', 'result'] : ['jsonrpc', 'id', 'error'];
  if (!isPlainObject(message) || message.jsonrpc !== '2.0' || !Object.hasOwn(message, 'id') ||
      !validJsonRpcId(message.id) || hasResult === hasError ||
      Object.keys(message).some(key => !allowed.includes(key)) || expectation.kind === 'notification' ||
      (expectation.kind === 'request' && message.id !== expectation.id)) {
    throw uncertainPostResponse('ROUTER_BACKEND_JSONRPC_INVALID_AFTER_DISPATCH');
  }
  if (hasError && (!isPlainObject(message.error) || !Number.isSafeInteger(message.error.code) ||
      typeof message.error.message !== 'string')) {
    throw uncertainPostResponse('ROUTER_BACKEND_JSONRPC_INVALID_AFTER_DISPATCH');
  }
}

export function createRouter({ config, configSha256 }) {
  const active = new Map();
  let ready = false;
  const identity = Object.freeze({
    name: 'chatgpt-remote-commander-router',
    revision: ROUTER_REVISION,
    routerId: config.routerId,
    profile: config.profile,
    host: config.host,
    port: config.port,
    configSha256
  });

  function snapshot() {
    // Synchronous admission snapshot is the routing linearization point. Once
    // captured, no await or pointer reload can move this request to a new slot.
    const pointer = loadPointerSync(config.pointerPath);
    if (pointer.backend.profile !== config.profile) throw routerError('ROUTER_PROFILE_MISMATCH');
    if (pointer.backend.port === config.port) throw routerError('ROUTER_BACKEND_PORT_CONFLICT');
    return pointer;
  }

  function begin(pointer) {
    const key = `${pointer.generation}:${pointer.backend.slotId}`;
    active.set(key, (active.get(key) ?? 0) + 1);
    return () => {
      const next = (active.get(key) ?? 1) - 1;
      if (next <= 0) active.delete(key);
      else active.set(key, next);
    };
  }

  const server = http.createServer(async (request, response) => {
    try {
      validateTransport(request, config);
      if (!ready) return sendJson(response, 503, { ok: false, error: 'ROUTER_NOT_READY' });
      const route = request.url;
      if (!['/router/health', '/health', '/mcp'].includes(route)) {
        return sendJson(response, 404, { ok: false, error: 'ROUTER_NOT_FOUND' });
      }

      if (request.method === 'GET' && route === '/router/health') {
        let pointer;
        try {
          pointer = snapshot();
          const health = await probeBackend(pointer.backend, {
            timeoutMs: config.healthTimeoutMs,
            responseMaxBytes: config.responseMaxBytes
          });
          return sendJson(response, 200, {
            ok: true,
            router: identity,
            generation: pointer.generation,
            backend: pointer.backend,
            backendHealth: { ok: health.ok },
            inFlight: inFlightView(active)
          });
        } catch (error) {
          return sendJson(response, 503, {
            ...publicError(error),
            router: identity,
            generation: pointer?.generation ?? null,
            backend: pointer?.backend ?? null,
            backendHealth: { ok: false, error: publicError(error).error },
            inFlight: inFlightView(active)
          });
        }
      }

      if (request.method === 'GET' && route === '/health') {
        const pointer = snapshot();
        const end = begin(pointer);
        try {
          const health = await probeBackend(pointer.backend, {
            timeoutMs: config.healthTimeoutMs,
            responseMaxBytes: config.responseMaxBytes
          });
          return sendJson(response, 200, {
            ...health.body,
            router: { ...identity, generation: pointer.generation, inFlight: inFlightView(active) }
          });
        } finally { end(); }
      }

      if (request.method !== 'POST' || route !== '/mcp') {
        return sendJson(response, 404, { ok: false, error: 'ROUTER_NOT_FOUND' });
      }
      if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
        return sendJson(response, 415, { ok: false, error: 'ROUTER_CONTENT_ENCODING_UNSUPPORTED' });
      }

      // Capture one immutable routing generation at admission. A concurrent switch
      // affects later requests only; this request remains owned by the old backend.
      const pointer = snapshot();
      const end = begin(pointer);
      try {
        const body = await readBody(request, config.requestMaxBytes);
        const expectation = requestExpectation(body);
        const upstream = await requestBackend(pointer.backend, {
          method: 'POST', route: '/mcp', body,
          headers: upstreamHeaders(request, body.length),
          timeoutMs: config.upstreamTimeoutMs,
          responseMaxBytes: config.responseMaxBytes
        });
        validatePostResponse(upstream, expectation);
        const headers = {
          'cache-control': 'no-store',
          'content-length': upstream.body.length,
          'x-content-type-options': 'nosniff'
        };
        const contentType = upstream.headers['content-type'];
        if (typeof contentType === 'string') headers['content-type'] = contentType;
        const session = upstream.headers['mcp-session-id'];
        if (typeof session === 'string') headers['mcp-session-id'] = session;
        response.writeHead(upstream.statusCode, headers);
        response.end(upstream.body);
      } finally { end(); }
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = error.httpStatus ?? (
        error.code === 'ROUTER_REQUEST_TOO_LARGE' ? 413
          : error.code === 'ROUTER_BACKEND_RESPONSE_TOO_LARGE' ? 502
            : error.code?.startsWith?.('ROUTER_') ? 503 : 500
      );
      if (error.terminateRequest === true) {
        response.setHeader('connection', 'close');
        response.once('finish', () => request.destroy());
      }
      sendJson(response, status, publicError(error));
    }
  });

  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return {
    server,
    identity,
    snapshot,
    inFlight: () => inFlightView(active),
    markReady: () => { ready = true; }
  };
}

async function main() {
  const configPath = process.env.REMOTE_COMMANDER_ROUTER_CONFIG;
  if (!configPath) throw routerError('ROUTER_CONFIG_ENV_REQUIRED');
  const loaded = await loadRouterConfig(configPath);
  // Invalid/missing pointer or a profile/port mismatch prevents the listener from
  // opening. Backend unavailability is reported by health after a valid startup.
  const initial = await loadPointer(loaded.config.pointerPath);
  if (initial.backend.profile !== loaded.config.profile) throw routerError('ROUTER_PROFILE_MISMATCH');
  if (initial.backend.port === loaded.config.port) throw routerError('ROUTER_BACKEND_PORT_CONFLICT');
  const router = createRouter({ config: loaded.config, configSha256: loaded.sha256 });
  await new Promise((resolve, reject) => {
    router.server.once('error', reject);
    router.server.listen(loaded.config.port, loaded.config.host, resolve);
  });
  try {
    await writeJsonAtomic(loaded.config.runtimeStatePath, {
      pid: process.pid,
      role: 'router',
      routerId: loaded.config.routerId,
      profile: loaded.config.profile,
      host: loaded.config.host,
      port: loaded.config.port,
      configSha256: loaded.sha256,
      projectDir,
      startedAt: new Date().toISOString()
    });
    router.markReady();
  } catch (error) {
    await new Promise(resolve => router.server.close(resolve));
    throw error;
  }
  console.log(`ChatGPT Remote Commander router ${ROUTER_REVISION} listening at http://${loaded.config.host}:${loaded.config.port}/mcp`);
  const close = () => router.server.close(() => { process.exitCode = 0; });
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invoked === import.meta.url) {
  try { await main(); }
  catch (error) {
    console.error(`${error.code ?? 'ROUTER_START_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}
