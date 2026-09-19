// HTTP request admission before parsing or dispatch. This is browser/DNS-rebinding
// protection, NOT authentication against other processes/users on the same host.
export function transportFailure(status, message) {
  return Object.assign(new Error(message), { httpStatus: status, rpcCode: -32600 });
}
export function validateTransport(req, config, listenPort = config.port) {
  const host = req.headers.host;
  const port = Number(listenPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw transportFailure(500, 'Invalid listener configuration');
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (typeof host !== 'string' || !hosts.has(host.toLowerCase())) throw transportFailure(403, 'Untrusted Host');
  const origin = req.headers.origin;
  // No web origin is necessary for the local tunnel-to-MCP backend.
  if (origin !== undefined) throw transportFailure(403, 'Browser Origin is not permitted');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw transportFailure(403, 'Cross-site request is not permitted');
  if (req.method === 'POST') {
    const mediaType = req.headers['content-type'];
    if (typeof mediaType !== 'string' || mediaType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw transportFailure(415, 'Content-Type must be application/json');
  }
}
export function assertLocalTransport(config, listenPort = config.port) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(config.host)) throw transportFailure(500, 'Unauthenticated MCP must stay loopback-only');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw transportFailure(500, 'Invalid listener port');
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) throw transportFailure(500, 'Invalid backend listener port');
}
