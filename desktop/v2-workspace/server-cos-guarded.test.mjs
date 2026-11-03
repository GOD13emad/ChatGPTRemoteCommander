import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createWorkspace} from './server-cos-guarded.mjs';

test('CoS-only close guard preserves the canonical installed R18 source hash',()=>{
 const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
 const root=new URL('./',import.meta.url);
 assert.equal(hash(fileURLToPath(new URL('server.mjs',root))),
   '65ced3f54f65e1d12a87387368be318068efd7f9f5b8321b8bfe94a092fb7f2c');
 assert.equal(hash(fileURLToPath(new URL('server-cos-guarded.mjs',root))),
   '95ea301d60763875e246a47566d06e856bb4d0a64763d2c7612845093705fb6b');
});
test('CoS guarded server returns 503 while listener address is null',async t=>{
 const app=await createWorkspace({port:0,coreUrl:''});
 const saved=app.server.address.bind(app.server);
 t.after(async()=>{
  app.server.address=saved;
  await new Promise(resolve=>app.server.close(resolve));
 });
 app.server.address=()=>null;
 const res=await fetch('http://127.0.0.1:'+app.port+'/api/local-ai',{headers:{'X-Commander-Workspace-Token':app.token}});
 assert.equal(res.status,503);
 assert.equal(await res.text(),'Unavailable');
 assert.equal(res.headers.get('cache-control'),'no-store, max-age=0');
 assert.match(res.headers.get('content-security-policy'),/default-src 'none'/);
});
test('CoS guarded R18 retains read-only token authorization',async t=>{
 const app=await createWorkspace({port:0,coreUrl:''});
 t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 const u='http://127.0.0.1:'+app.port;
 assert.equal((await fetch(u+'/api/local-ai')).status,403);
 const res=await fetch(u+'/api/local-ai',{headers:{'X-Commander-Workspace-Token':app.token}});
 assert.equal(res.status,200);
 const value=await res.json();
 assert.equal(value.workerEffectVerified,false);
 assert.equal(value.canExecute,false);
 assert.equal((await fetch(u+'/api/local-ai',{method:'POST'})).status,405);
});
