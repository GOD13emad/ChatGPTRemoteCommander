const DEFAULT_SYNC_COMMAND_MAX_MS = 20_000;
const DEFAULT_DUPLICATE_TEXT_MAX_BYTES = 128 * 1024;
const DEFAULT_MCP_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

export const RETRY_GUARD_LIMITS = Object.freeze({
  syncCommandMaxMs: DEFAULT_SYNC_COMMAND_MAX_MS,
  duplicateTextMaxBytes: DEFAULT_DUPLICATE_TEXT_MAX_BYTES,
  mcpResponseMaxBytes: DEFAULT_MCP_RESPONSE_MAX_BYTES
});

export function synchronousCommandInput(input = {}, maxMs = DEFAULT_SYNC_COMMAND_MAX_MS) {
  const requested = input?.timeoutMs;
  if (requested !== undefined) {
    const value = Number(requested);
    if (!Number.isFinite(value) || value < 1000) throw new Error('timeoutMs must be at least 1000');
    if (value > maxMs) {
      throw new Error(`SYNCHRONOUS_COMMAND_DEADLINE_RISK: timeoutMs ${value} exceeds the ${maxMs} ms synchronous transport limit; use operation_start with a stable requestId`);
    }
  }
  return { ...input, timeoutMs: requested ?? maxMs };
}

export function compactToolSuccessPayload(result, maxTextBytes = DEFAULT_DUPLICATE_TEXT_MAX_BYTES) {
  if (result?.__mcpContent) {
    return { content: result.__mcpContent, structuredContent: result.__structuredContent ?? {}, isError: false };
  }
  const text = JSON.stringify(result, null, 2);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= maxTextBytes) return { content: [{ type: 'text', text }], structuredContent: result, isError: false };
  return {
    content: [{ type: 'text', text: `Large structured result omitted from duplicate text rendering (${bytes} bytes). Use structuredContent; for command output prefer operation_start/operation_result.` }],
    structuredContent: result,
    isError: false
  };
}

export function serializeBoundedJsonResponse(body, maxBytes = DEFAULT_MCP_RESPONSE_MAX_BYTES) {
  let data = Buffer.from(JSON.stringify(body));
  if (data.length <= maxBytes) return { data, overflow: false };
  const isRpc = body && body.jsonrpc === '2.0';
  const fallback = isRpc
    ? { jsonrpc: '2.0', id: body.id ?? null, error: { code: -32051, message: 'MCP_RESPONSE_TOO_LARGE: response exceeded the 8 MiB safe transport envelope; use bounded/paged reads or operation_start + operation_result' } }
    : { error: 'response_too_large' };
  data = Buffer.from(JSON.stringify(fallback));
  return { data, overflow: true, fallback };
}
