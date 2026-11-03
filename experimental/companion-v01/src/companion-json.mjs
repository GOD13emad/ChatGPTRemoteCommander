// Bounded wire parsing before JSON.parse can discard conflicting members.
export function parseCompanionJson(bytes, { maxBytes = 65536, maxDepth = 32, maxNodes = 50000 } = {}) {
  const fail = () => { throw new Error('COMPANION_JSON_INVALID'); };
  if (!Buffer.isBuffer(bytes) || bytes.length > maxBytes) fail();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail(); }
  const stack = []; let nodes = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (/\s/u.test(char)) continue;
    if (++nodes > maxNodes) fail();
    if (char === '{' || char === '[') {
      stack.push({ object: char === '{', members: new Set() }); if (stack.length > maxDepth) fail();
    } else if (char === '}' || char === ']') stack.pop();
    else if (char === '"') {
      const start = i;
      for (i++; i < text.length; i++) { if (text[i] === '\\') i++; else if (text[i] === '"') break; }
      if (i >= text.length) fail();
      let next = i + 1; while (next < text.length && /\s/u.test(text[next])) next++;
      if (text[next] === ':' && stack.at(-1)?.object) {
        let name; try { name = JSON.parse(text.slice(start, i + 1)); } catch { fail(); }
        const parent = stack.at(-1); if (parent.members.has(name)) fail(); parent.members.add(name);
      }
    } else if (char !== ',' && char !== ':') {
      while (i + 1 < text.length && !/[\s,\]}:]/u.test(text[i + 1])) i++;
    }
  }
  try { return JSON.parse(text); } catch { fail(); }
}
