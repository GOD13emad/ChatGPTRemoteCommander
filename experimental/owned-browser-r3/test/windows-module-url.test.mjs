import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
test('Windows absolute module requires file URL before ANY browser process',async()=>{
  const file=path.resolve(fileURLToPath(new URL('../src/graceful-browser-close.mjs',import.meta.url)));
  if(process.platform==='win32')await assert.rejects(import(file),e=>e.code==='ERR_UNSUPPORTED_ESM_URL_SCHEME');
  const loaded=await import(pathToFileURL(file).href);assert.equal(typeof loaded.closeOwnedBrowser,'function');
});
