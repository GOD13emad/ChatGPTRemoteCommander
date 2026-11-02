// Proposal JSON is untrusted model/provider output. JSON.parse accepts duplicate
// keys (including escaped aliases); reject them before any argument reaches an actuator.
// This module parses data only: it never authorizes or dispatches tools.
const invalid = () => {
  throw Object.assign(new Error('PROJECT_JSON_INVALID'), {code:'PROJECT_JSON_INVALID'});
};

export function parseProjectJsonStrict(text, maxBytes = 512 * 1024) {
  if (typeof text !== 'string' || !text.isWellFormed() ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      Buffer.byteLength(text, 'utf8') > maxBytes ||
      text.charCodeAt(0) === 0xfeff) invalid();
  const stack = [];
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') continue;
    if (++tokens > 100000) invalid();
    if (char === '{' || char === '[') {
      stack.push({kind:char, names:char === '{' ? new Set() : null});
      if (stack.length > 64) invalid();
    } else if (char === '}' || char === ']') {
      const previous = stack.pop();
      if (!previous || (char === '}' ? previous.kind !== '{' : previous.kind !== '[')) invalid();
    } else if (char === '"') {
      const begin = i;
      let ended = false;
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (text[i] === '"') { ended = true; break; }
      }
      if (!ended) invalid();
      let after = i + 1;
      while (after < text.length && /[ \r\n\t]/.test(text[after])) after++;
      if (text[after] === ':' && stack.at(-1)?.kind === '{') {
        let key;
        try { key = JSON.parse(text.slice(begin, i + 1)); } catch { invalid(); }
        const names = stack.at(-1).names;
        if (typeof key !== 'string' || !key.isWellFormed() || names.has(key)) invalid();
        names.add(key);
      }
    }
  }
  if (stack.length) invalid();
  try { return JSON.parse(text); } catch { invalid(); }
}
