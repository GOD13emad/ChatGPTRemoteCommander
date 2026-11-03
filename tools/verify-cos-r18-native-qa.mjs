// Offline, read-only verification of a real extracted CoS+Commander V2 R18 native package.
// Does not install, publish, authenticate ChatGPT, touch a browser or execute a Worker.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';

const EXPECTED_MANIFEST='7512cbc77ed07281864355184da1db1a9d89c00321d50c77bf50b6216e2b9e2a';
const EXPECTED_SERVER='95ea301d60763875e246a47566d06e856bb4d0a64763d2c7612845093705fb6b';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fail(reason){throw new Error('COS_R18_NATIVE_QA_'+reason)}
function trustedFile(file) {
 if(!fs.existsSync(file))fail('FILE_MISSING');
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)fail('FILE_UNTRUSTED');
 return fs.readFileSync(file);
}
export async function verifyExtractedNativeR18(root,{request=fetch}={}) {
 if(typeof root!=='string'||!path.isAbsolute(root)||typeof request!=='function')fail('ARGS_INVALID');
 const cwd=path.resolve(root);
 if(!fs.existsSync(cwd)||!fs.lstatSync(cwd).isDirectory()||fs.lstatSync(cwd).isSymbolicLink())fail('ROOT_INVALID');
 const resources=path.join(cwd,'resources'),bundle=path.join(resources,'commander-v2-workspace');
 if(!fs.existsSync(bundle)||!fs.lstatSync(bundle).isDirectory()||fs.lstatSync(bundle).isSymbolicLink())fail('BUNDLE_MISSING');
 const manifestBytes=trustedFile(path.join(bundle,'MANIFEST.json'));
 if(sha(manifestBytes)!==EXPECTED_MANIFEST)fail('MANIFEST_HASH_CHANGED');
 let m;try{m=JSON.parse(manifestBytes.toString('utf8'))}catch{fail('MANIFEST_JSON_INVALID')}
 if(m.mode!=='LOCAL_GUI_PREVIEW_NO_PROMOTION'||m.qaOverlay!=='V2_ELECTRON_CLOSE_RACE_GUARD'||
    m.schema!==1||!Array.isArray(m.files)||m.files.length!==21)fail('MANIFEST_SEMANTICS_INVALID');
 const checked=new Set();
 for(const f of m.files) {
   if(!f||typeof f.path!=='string'||!/^[a-zA-Z0-9][\w.-]{0,100}$/.test(f.path)||
      checked.has(f.path)||!Number.isSafeInteger(f.bytes)||f.bytes<0||
      typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))fail('ENTRY_INVALID');
   checked.add(f.path);
   const bytes=trustedFile(path.join(bundle,f.path));
   if(bytes.length!==f.bytes||sha(bytes)!==f.sha256)fail('ENTRY_HASH_MISMATCH_'+f.path);
 }
 if(!checked.has('server.mjs')||!checked.has('index.html')||!checked.has('app.js')||
    sha(trustedFile(path.join(bundle,'server.mjs')))!==EXPECTED_SERVER)fail('SERVER_MISMATCH');
 const appAsar=trustedFile(path.join(resources,'app.asar'));
 if(appAsar.length<100000)fail('CO_S_ASAR_INVALID');
 const module=await import(pathToFileURL(path.join(bundle,'server.mjs')).href);
 if(typeof module.createWorkspace!=='function')fail('NO_WORKSPACE_FACTORY');
 const server=await module.createWorkspace({port:0,coreUrl:''});
 try{
  const base='http://127.0.0.1:'+server.port;
  const opts={signal:AbortSignal.timeout(7000)};
  const authorized={...opts,headers:{'X-Commander-Workspace-Token':server.token}};
  const [page,allowed,denied,v1,post]=await Promise.all([
   request(base+'/',opts),request(base+'/api/local-ai',authorized),
   request(base+'/api/local-ai',opts),request(base+'/api/v1-runtime',authorized),
   request(base+'/api/local-ai',{...authorized,method:'POST'})
  ]);
  const html=await page.text(),localAI=await allowed.json(),v1view=await v1.json();
  const result={
    status:'COS_R18_EXTRACTED_NATIVE_HTTP_QA_PASS',
    manifestSHA256:sha(manifestBytes),serverSHA256:EXPECTED_SERVER,
    appAsarSHA256:sha(appAsar),verifiedR18Files:checked.size,
    web:page.status,authorized:allowed.status,unauthorized:denied.status,
    unauthorizedWrite:post.status,v1Http:v1.status,v1State:v1view.state??null,
    localModelState:localAI.state??null,workerEffectVerified:localAI.workerEffectVerified,
    canExecute:localAI.canExecute,oauthLoginVerified:false,
    signedInstallerVerified:false,productionWorkerVerified:false
  };
  if(!html.includes('Commander V2')||page.status!==200||allowed.status!==200||
     denied.status!==403||post.status!==405||v1.status!==200||
     typeof v1view.state!=='string'||localAI.workerEffectVerified!==false||
     localAI.canExecute!==false||!/default-src 'none'/.test(page.headers.get('content-security-policy')||''))
      fail('SECURITY_OR_RUNTIME_ENDPOINT_FAILED');
  return Object.freeze(result);
 }finally{
   await new Promise(resolve=>server.server.close(resolve));
 }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await verifyExtractedNativeR18(process.argv[2])));}
 catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=2;}
}
