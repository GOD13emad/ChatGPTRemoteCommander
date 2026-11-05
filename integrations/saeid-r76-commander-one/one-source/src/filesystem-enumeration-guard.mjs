import path from 'node:path';

export const WINDOWS_SEARCH_VISIT_LIMIT = 5000;

function normalizedWindowsRoot(value) {
  const resolved = path.win32.resolve(String(value));
  const root = path.win32.parse(resolved).root;
  const trim = (item) => item.replace(/[\\/]+$/, '').toLowerCase();
  return { resolved, root, same: trim(resolved) === trim(root) };
}

export function assertEnumerationScope({ target, depth, operation, platform = process.platform }) {
  const requestedDepth = Number(depth);
  if (platform !== 'win32' || !Number.isFinite(requestedDepth) || requestedDepth <= 0) return;
  if (!normalizedWindowsRoot(target).same) return;
  const error = new Error(`WINDOWS_VOLUME_ROOT_RECURSION_REFUSED: ${operation} must use a narrower directory than ${target}`);
  error.code = 'WINDOWS_VOLUME_ROOT_RECURSION_REFUSED';
  throw error;
}

export function boundedSearchVisitLimit(value) {
  if (value === undefined) return WINDOWS_SEARCH_VISIT_LIMIT;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return WINDOWS_SEARCH_VISIT_LIMIT;
  return Math.max(1, Math.min(parsed, WINDOWS_SEARCH_VISIT_LIMIT));
}
