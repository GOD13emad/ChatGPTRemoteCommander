// Commander V2 Workspace — owner-local presentation gateway.
// No mutation, no shell execution, no credentials, no competing coordinator.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hostname, platform } from 'node:os';
import { spawn } from 'node:child_process';
import { readOwnerEvidence } from './local-evidence.mjs';
import { readLocalV1Runtime,readLocalV1Project } from './v1-runtime-bridge.mjs';
import {compactV1ProjectForContinuation} from './continuation-handoff.mjs';
import { readOwnerSeatHeartbeat } from './owner-seat-evidence.mjs';
import { readV2LocalTransport } from './transport-evidence.mjs';
import { readLocalModelCatalog } from './local-model-evidence.mjs';
import { normalizeOwnerWorkflowView,normalizeCoordinatorReceiptView,normalizePrivateArtifactProof } from './workflow-view.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
]);
const NO_CACHE = 'no-store, max-age=0';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function isLoopback(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' &&
      ['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) &&
      !parsed.username && !parsed.password &&
      (!parsed.pathname || parsed.pathname === '/') &&
      !parsed.search && !parsed.hash &&
      Number(parsed.port) >= 1024 && Number(parsed.port) <= 65535;
  } catch { return false; }
}
export function normalizeCoreUrl(candidate) {
  return typeof candidate === 'string' && isLoopback(candidate) ? new URL(candidate).origin : null;
}
function authorized(req, secret) {
  const header = req.headers['x-commander-workspace-token'];
  if (typeof header !== 'string' || header.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(secret));
}
async function probeCore(coreUrl) {
  if (!coreUrl) return { state:'NOT_CONFIGURED', version:null };
  try {
    const response = await fetch(coreUrl + '/health', { method:'GET', redirect:'error', signal:AbortSignal.timeout(1200) });
    if (!response.ok) return { state:'UNVERIFIED', version:null };
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { state:'UNVERIFIED', version:null };
    const health = data.ok === true || data.status === 'ok' || data.status === 'healthy' ||
      data.healthy === true || data.health === 'ok';
    const version = typeof data.version === 'string' ? data.version.slice(0,48) : null;
    return { state: health ? 'REACHABLE' : 'RESPONDED_UNVERIFIED', version };
  } catch {
    return { state:'UNREACHABLE', version:null };
  }
}
export async function createWorkspace(options = {}) {
  if(options.continuationBuilder!==undefined&&typeof options.continuationBuilder!=='function')
    throw Error('V2_WORKSPACE_CONTINUATION_BUILDER_REQUIRED');
  if(options.v1ProjectReader!==undefined&&typeof options.v1ProjectReader!=='function')
    throw Error('V2_WORKSPACE_PROJECT_READER_REQUIRED');
  if(options.v1RuntimeReader!==undefined&&typeof options.v1RuntimeReader!=='function')
    throw Error('V2_WORKSPACE_V1_READER_REQUIRED');
  if(options.localModelReader!==undefined&&typeof options.localModelReader!=='function')
    throw Error('V2_WORKSPACE_LOCAL_MODEL_READER_REQUIRED');
  if(options.trustedWorkflowReader!==undefined&&typeof options.trustedWorkflowReader!=='function')
    throw Error('V2_WORKSPACE_TRUSTED_READER_REQUIRED');
  if(options.trustedReceiptReader!==undefined&&typeof options.trustedReceiptReader!=='function')
    throw Error('V2_WORKSPACE_TRUSTED_RECEIPT_READER_REQUIRED');
  if(options.trustedPrivateArtifactReader!==undefined&&typeof options.trustedPrivateArtifactReader!=='function')
    throw Error('V2_WORKSPACE_TRUSTED_ARTIFACT_READER_REQUIRED');
  const coreUrl = normalizeCoreUrl(options.coreUrl ?? process.env.RC_V2_CORE_URL);
  const token = randomBytes(24).toString('hex');
  const port = options.port ?? (Number(process.env.RC_V2_PORT) || 47955);
  const server = http.createServer(async (req, res) => {
    const host = req.headers.host || '';
    const address = server.address();
    const validHost = host === '127.0.0.1:' + address.port || host === 'localhost:' + address.port ||
      host === '[::1]:' + address.port;
    const headers = {
      'Cache-Control':NO_CACHE, 'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer', 'Content-Security-Policy':CSP,
      'X-Frame-Options':'DENY'
    };
    const respond = (status, data, type='text/plain; charset=utf-8') => {
      res.writeHead(status,{ ...headers, 'Content-Type':type }); res.end(data);
    };
    if (!validHost) return respond(403,'Forbidden');
    if (req.method !== 'GET' && req.method !== 'HEAD') return respond(405,'Method not allowed');
    if (typeof req.url==='string' && req.url.startsWith('/api/v1-handoff')) {
      if (!authorized(req,token)) return respond(403,'Forbidden');
      const parsed=new URL(req.url,'http://127.0.0.1');
      if(parsed.pathname!=='/api/v1-handoff'||parsed.searchParams.size!==1||
        !parsed.searchParams.has('id')||
        !/^[a-z][a-z0-9_-]{0,63}$/.test(parsed.searchParams.get('id')||''))
        return respond(400,'Invalid project id');
      try{
        const id=parsed.searchParams.get('id');
        // The project reader *independently* obtains the fresh V1 project list
        // and rejects absent IDs. No stale browser metadata is trusted.
        const detail=await (options.v1ProjectReader||readLocalV1Project)(id);
        const preview=(options.continuationBuilder||compactV1ProjectForContinuation)(detail);
        return respond(200,JSON.stringify(preview),'application/json; charset=utf-8');
      }catch{
        return respond(503,JSON.stringify({state:'UNVERIFIED',canExecute:false,canResume:false}),
          'application/json; charset=utf-8');
      }
    }
    if (typeof req.url==='string' && req.url.startsWith('/api/v1-project')) {
      if (!authorized(req,token)) return respond(403,'Forbidden');
      const parsed=new URL(req.url,'http://127.0.0.1');
      if (parsed.pathname!=='/api/v1-project'||parsed.searchParams.size!==1||
          !parsed.searchParams.has('id')||!(/^[a-z][a-z0-9_-]{0,63}$/.test(parsed.searchParams.get('id')||'')))
        return respond(400,'Invalid project id');
      try{
        const snapshot=await (options.v1ProjectReader||readLocalV1Project)(parsed.searchParams.get('id'));
        return respond(200,JSON.stringify(snapshot),'application/json; charset=utf-8');
      }catch{
        return respond(503,JSON.stringify({state:'UNVERIFIED',source:'V1_WORKFLOW_STORE',project:null,canExecute:false}),
          'application/json; charset=utf-8');
      }
    }
    if (req.url === '/api/v1-runtime') {
      if (!authorized(req,token)) return respond(403,'Forbidden');
      try {
        const snapshot=await (options.v1RuntimeReader||readLocalV1Runtime)();
        return respond(200,JSON.stringify(snapshot),'application/json; charset=utf-8');
      } catch {
        return respond(503,JSON.stringify({state:'UNVERIFIED',source:'V1_LOCAL_CORE',canExecute:false}),
          'application/json; charset=utf-8');
      }
    }
    if (req.url === '/api/local-ai') {
      if (!authorized(req,token)) return respond(403,'Forbidden');
      try{
        const data=await (options.localModelReader||readLocalModelCatalog)();
        if(!data||data.schema!==1||data.source!=='LOCAL_OLLAMA_CATALOG'||
          !['LOCAL_API_UNAVAILABLE','CATALOG_UNVERIFIED','MODEL_CATALOG_OBSERVED'].includes(data.state)||
          data.canExecute!==false||data.workerEffectVerified!==false||data.chatAuthenticated!==false||
          !Array.isArray(data.models)||data.models.length>8||
          data.models.some(n=>typeof n!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(n))||
          (data.modelCount!==null&&(!Number.isSafeInteger(data.modelCount)||data.modelCount<0||data.modelCount>1000)))
          throw Error('MODEL_CATALOG_UNVERIFIED');
        return respond(200,JSON.stringify({schema:1,source:'LOCAL_OLLAMA_CATALOG',
          state:data.state,modelCount:data.modelCount,models:data.models,
          workerEffectVerified:false,canExecute:false,chatAuthenticated:false}),
          'application/json; charset=utf-8');
      }catch{return respond(503,JSON.stringify({schema:1,source:'LOCAL_OLLAMA_CATALOG',state:'CATALOG_UNVERIFIED',
        modelCount:null,models:[],workerEffectVerified:false,canExecute:false,chatAuthenticated:false}),
        'application/json; charset=utf-8');}
    }
    if (req.url === '/api/status') {
      if (!authorized(req,token)) return respond(403,'Forbidden');
      const core = await probeCore(coreUrl);
      const evidence = await readOwnerEvidence();
      const ownerSeat = await readOwnerSeatHeartbeat();
      const transport = await readV2LocalTransport();
      const body = JSON.stringify({
        product:'Commander V2 Workspace', mode:'READ_ONLY_GUI_PREVIEW',
        observedAt:new Date().toISOString(),
        device:{ name:hostname(), platform:platform() },
        core, evidence, ownerSeat, transport, auth:'NOT_ENROLLED', workflow:'NOT_CONNECTED',
        gui:'NOT_CONNECTED', browser:'NOT_CONNECTED',
        tasks:'LOCAL_DRAFTS_ONLY'
      });
      return respond(200,body,'application/json; charset=utf-8');
    }
    if (req.url === '/api/workflow') {
      if (!authorized(req,token)) return respond(403,'Forbidden');
      if (!options.trustedWorkflowReader)
        return respond(200,JSON.stringify({state:'NOT_CONNECTED',workflow:null}),
          'application/json; charset=utf-8');
      try {
        // The trusted native-owner callback has NO request arguments and must
        // independently attest session, OAuth principal, grant and owner approval.
        // No browser-supplied workflow/chat/host identifier is ever forwarded.
        const raw=await options.trustedWorkflowReader();
        const workflow=normalizeOwnerWorkflowView(raw);
        return respond(200,JSON.stringify({state:'OWNER_READER_OBSERVED',workflow}),
          'application/json; charset=utf-8');
      }catch {
        return respond(503,JSON.stringify({state:'UNVERIFIED',workflow:null}),
          'application/json; charset=utf-8');
      }
    }
    if (req.url === '/api/fenced-receipt') {
      if (!authorized(req,token)) return respond(403,'Forbidden');
      if (!options.trustedReceiptReader)
        return respond(200,JSON.stringify({state:'NOT_CONNECTED',receipt:null}),
          'application/json; charset=utf-8');
      try {
        // No request-supplied workflow or receipt ID; trusted owner worker must
        // re-check its session, grant, approval and central Coordinator record.
        const raw=await options.trustedReceiptReader();
        const receipt=normalizeCoordinatorReceiptView(raw);
        return respond(200,JSON.stringify({state:'COORDINATOR_RECORD_OBSERVED',receipt}),
          'application/json; charset=utf-8');
      }catch {
        return respond(503,JSON.stringify({state:'UNVERIFIED',receipt:null}),
          'application/json; charset=utf-8');
      }
    }
    if (req.url === '/api/private-artifact') {
      if (!authorized(req,token)) return respond(403,'Forbidden');
      if (!options.trustedPrivateArtifactReader)
        return respond(200,JSON.stringify({state:'NOT_CONNECTED',artifact:null}),
          'application/json; charset=utf-8');
      try {
        // Only a separately attested owner worker can supply this evidence.
        // Never assume a verified private artifact means a desktop/tool effect.
        const data=await options.trustedPrivateArtifactReader();
        const artifact=normalizePrivateArtifactProof(data);
        return respond(200,JSON.stringify({state:'PRIVATE_ARTIFACT_OBSERVED',artifact}),
          'application/json; charset=utf-8');
      }catch{
        return respond(503,JSON.stringify({state:'UNVERIFIED',artifact:null}),
          'application/json; charset=utf-8');
      }
    }
    const asset=files.get(req.url || '');
    if (!asset) return respond(404,'Not found');
    try {
      const buf = await readFile(join(directory,asset[0]));
      res.writeHead(200,{...headers,'Content-Type':asset[1]});
      if (req.method === 'HEAD') res.end(); else res.end(buf);
    } catch { respond(500,'Asset unavailable'); }
  });
  await new Promise((resolve,reject) => {
    server.once('error',reject); server.listen(port,'127.0.0.1',resolve);
  });
  const url='http://127.0.0.1:'+server.address().port+'/#'+token;
  return {server,url,token,port:server.address().port,coreUrl};
}
function openLocalBrowser(url) {
  const os=platform();
  const command=os==='win32' ? 'cmd.exe' : os==='darwin' ? 'open' : 'xdg-open';
  const args=os==='win32' ? ['/d','/s','/c','start "" "'+url+'"'] : [url];
  try { const child=spawn(command,args,{detached:true,stdio:'ignore',windowsHide:true});child.on('error',()=>{});child.unref(); }
  catch { /* UI is still reachable from printed local URL without fragment token only on same process */ }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase()) {
  const workspace=await createWorkspace();
  if (process.env.RC_V2_NO_OPEN !== '1') openLocalBrowser(workspace.url);
  process.stdout.write('Commander V2 Workspace: local-only UI listening on 127.0.0.1:'+workspace.port+'\n');
  process.stdout.write('If auto-open is unavailable, run the launcher from your interactive desktop session.\n');
}
