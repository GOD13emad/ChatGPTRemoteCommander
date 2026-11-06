// A routing label only, never caller identity or permission. Legacy default stays unchanged.
const namespacePattern = /^[a-z][a-z0-9]{0,15}(?:-[a-z0-9]{1,16}){0,3}$/;
export function validateTerminalNamespace(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 64 || !namespacePattern.test(value)) {
    throw Object.assign(new Error('TERMINAL_NAMESPACE_INVALID'), {code:'TERMINAL_NAMESPACE_INVALID'});
  }
  return value;
}
export function formatTerminalId(sequence, namespace = null) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 9_999_999_999_999) {
    throw Object.assign(new Error('TERMINAL_SEQUENCE_EXHAUSTED'), {code:'TERMINAL_SEQUENCE_EXHAUSTED'});
  }
  if (namespace !== null) validateTerminalNamespace(namespace);
  return `${namespace === null ? '' : namespace + '-'}term-${sequence}`;
}
export function isTerminalId(value) {
  if (typeof value !== 'string' || value.length > 84) return false;
  if (/^term-[1-9][0-9]{0,12}$/.test(value)) return true;
  const match = /^(.+)-term-([1-9][0-9]{0,12})$/.exec(value);
  return match !== null && match[1].length <= 64 && namespacePattern.test(match[1]);
}
