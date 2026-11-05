// Commander V2: explicit-QA-only managed V1 child process. Default is DISABLED.
// It never migrates or touches the installed V1 service, profile, browser or privileges.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createHash, randomBytes} from 'node:crypto';
import {spawn, type ChildProcess} from 'node:child_process';

export type CoreStatus={
 state:'DISABLED'|'STOPPED'|'STARTING'|'READY'|'FAILED'|'STOPPING';
 version:string|null; port:number|null; mode:'EXPLICIT_ISOLATED_QA';
 installed:false; power:false; authenticated:false;
};
export type CoreOptions={
 resourcesPath:string; executablePath:string; stateRoot:()=>string;
 qaAllowed:boolean; onStatus?:(status:CoreStatus)=>void;
};
const accepted:Record<string,string>={
 linux:'45f141302e19728d7ee2eb4898c5fa35d1b99889ef6707760fd079dda7771842',
 win32:'f91097d773bb754cba34900d8f44609555b1936a510e55af9ee933cd4f7d239a'
};
const hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
const sleep=(n:number)=>new Promise<void>(r=>setTimeout(r,n));
function bytes(f:string):Buffer{
 const st=fs.lstatSync(f);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error('V1_SUPERVISOR_FILE_INVALID');
 return fs.readFileSync(f);
}
function directory(p:string):void{
 const abs=path.resolve(p);
 let cur=path.parse(abs).root;
 for(const part of abs.slice(cur.length).split(path.sep).filter(Boolean)){
  cur=path.join(cur,part);
  if(fs.existsSync(cur)){
   const st=fs.lstatSync(cur);
   if(!st.isDirectory()||st.isSymbolicLink())throw Error('V1_SUPERVISOR_DIRECTORY_ALIAS');
  }else fs.mkdirSync(cur,{mode:0o700});
 }
}
function pinnedServer(resources:string):string{
 const component=path.join(resources,'commander-v1-core');
 const metaRaw=bytes(path.join(component,'MANIFEST.json'));
 if(!accepted[process.platform]||hash(metaRaw)!==accepted[process.platform])
  throw Error('V1_SUPERVISOR_MANIFEST_NOT_PINNED');
 const meta=JSON.parse(metaRaw.toString('utf8')) as {
  mode:string;sourceVersion:string;serverSha:string;
  files:Array<{file:string;bytes:number;sha256:string}>;
 };
 if(meta.mode!=='QA_INTERNAL_NOT_ACTIVATED'||meta.sourceVersion!=='0.11.0-dev.23-capgap-qa'||
  !Array.isArray(meta.files)||meta.files.length!==75||
  (meta as typeof meta & {qaTransportAuth?:string}).qaTransportAuth!=='QA_EPHEMERAL_PROCESS_BEARER_NOT_OWNER_LOGIN')throw Error('V1_SUPERVISOR_MANIFEST_INVALID');
 const seen=new Set<string>();
 for(const f of meta.files){
  if(typeof f.file!=='string'||!(/^(?:package\.json|src\/[A-Za-z][A-Za-z0-9_.-]{1,95}\.mjs|src\/gui-libei-receiver\.c)$/.test(f.file))||
   seen.has(f.file)||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>600000||
   !/^[a-f0-9]{64}$/.test(f.sha256))throw Error('V1_SUPERVISOR_ENTRY_INVALID');
  seen.add(f.file);
  const b=bytes(path.join(component,...f.file.split('/')));
  if(b.length!==f.bytes||hash(b)!==f.sha256)throw Error('V1_SUPERVISOR_SOURCE_CHANGED');
 }
 const server=path.join(component,'src','server-v0.3.mjs');
 if(hash(bytes(server))!==meta.serverSha)throw Error('V1_SUPERVISOR_SERVER_CHANGED');
 return server;
}
async function port():Promise<number>{
 const s=net.createServer();
 await new Promise<void>((yes,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',yes);});
 const result=(s.address() as net.AddressInfo).port;
 await new Promise<void>(yes=>s.close(()=>yes()));
 return result;
}
async function terminate(child:ChildProcess):Promise<void>{
 if(!child.pid||child.exitCode!==null||child.signalCode!==null)return;
 const done=new Promise<void>(resolve=>child.once('close',()=>resolve()));
 child.kill('SIGTERM');
 await Promise.race([done,sleep(1800)]);
 if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
 await Promise.race([done,sleep(450)]);
}
export function createEmbeddedCoreSupervisor(opts:CoreOptions){
 let state:CoreStatus['state']=opts.qaAllowed?'STOPPED':'DISABLED';
 let child:ChildProcess|null=null;
 let currentPort:number|null=null;
 let version:string|null=null;
 let localBearer:string|null=null;
 let begin:Promise<CoreStatus>|null=null;
 let stopping:Promise<void>|null=null;
 let permanentlyStopped=false;
 const status=():CoreStatus=>({state,version,port:state==='READY'?currentPort:null,
  mode:'EXPLICIT_ISOLATED_QA',installed:false,power:false,authenticated:false});
 const notify=()=>opts.onStatus?.(status());
 const coreUrl=()=>state==='READY'&&currentPort!==null?'http://127.0.0.1:'+currentPort+'/':null;
 const toolsCatalog=async():Promise<{count:number;gapMethods:number}|null>=>{
  if(state!=='READY'||currentPort===null||!localBearer)return null;
  const reply=await fetch('http://127.0.0.1:'+currentPort+'/mcp',{
   method:'POST',redirect:'error',
   headers:{'content-type':'application/json',authorization:'Bearer '+localBearer},
   body:JSON.stringify({jsonrpc:'2.0',id:'internal-readonly-catalog',method:'tools/list',params:{}}),
   signal:AbortSignal.timeout(2000)
  });
  if(!reply.ok)return null;
  const body=await reply.json() as {result?:{tools?:Array<{name:string}>}};
  const methods=body.result?.tools;
  if(!Array.isArray(methods)||methods.some(t=>typeof t.name!=='string'))return null;
  return {count:methods.length,gapMethods:methods.filter(t=>t.name.startsWith('capability_gap_')).length};
 };
 async function start():Promise<CoreStatus>{
  if(!opts.qaAllowed||permanentlyStopped||state==='DISABLED')return status();
  if(state==='READY')return status();
  if(begin)return begin;
  begin=(async()=>{
   state='STARTING';notify();let own:ChildProcess|null=null;
   try{
    if(!['linux','win32'].includes(process.platform)||
     path.basename(opts.executablePath)!==(process.platform==='win32'?'Commander V2.exe':'commander-v2'))
     throw Error('V1_SUPERVISOR_EXECUTABLE_INVALID');
    const st=fs.lstatSync(opts.executablePath);
    if(!st.isFile()||st.isSymbolicLink())throw Error('V1_SUPERVISOR_EXECUTABLE_ALIAS');
    const server=pinnedServer(opts.resourcesPath);
    const dataRoot=opts.stateRoot();
    directory(dataRoot);
    for(const name of ['home','data','tmp'])directory(path.join(dataRoot,name));
    const assigned=await port();
    const startBearer=randomBytes(32).toString('hex');
    if(permanentlyStopped)throw Error('V1_SUPERVISOR_STOP_REQUESTED');
    const privateHome=path.join(dataRoot,'home');
    const config={
     host:'127.0.0.1',port:assigned,allowedRoots:[path.join(dataRoot,'data')],
     allowedPrograms:[],auditLog:path.join(dataRoot,'audit.jsonl'),
     runtimeState:path.join(dataRoot,'runtime.json'),
     durableDelivery:{directory:path.join(dataRoot,'delivery'),scope:'embedded-qa'},
     powerMode:{enabled:false,fullFilesystem:false,guiControl:{enabled:false}},
     instance:{profile:'embedded-qa',isolated:true}
    };
    const cfg=path.join(dataRoot,'config.json');
    if(fs.existsSync(cfg)&&fs.lstatSync(cfg).isSymbolicLink())throw Error('V1_SUPERVISOR_CONFIG_ALIAS');
    fs.writeFileSync(cfg,JSON.stringify(config),{mode:0o600});
    const env:NodeJS.ProcessEnv={
     PATH:process.env.PATH||'',HOME:privateHome,USERPROFILE:privateHome,
     APPDATA:path.join(privateHome,'AppData','Roaming'),
     LOCALAPPDATA:path.join(privateHome,'AppData','Local'),
     XDG_CONFIG_HOME:path.join(privateHome,'.config'),
     XDG_DATA_HOME:path.join(privateHome,'.local','share'),
     XDG_CACHE_HOME:path.join(privateHome,'.cache'),
     TMPDIR:path.join(dataRoot,'tmp'),TEMP:path.join(dataRoot,'tmp'),
     TMP:path.join(dataRoot,'tmp'),SystemRoot:process.env.SystemRoot||'',
     windir:process.env.windir||'',ComSpec:process.env.ComSpec||'',
     PATHEXT:process.env.PATHEXT||'',ELECTRON_RUN_AS_NODE:'1',
     REMOTE_COMMANDER_CONFIG:cfg,COMMANDER_V2_QA_MCP_SECRET:startBearer
    };
    let spawnFailed=false;
    own=spawn(opts.executablePath,[server],{
     cwd:path.dirname(server),env,stdio:'ignore',windowsHide:true
    });
    own.once('error',()=>{spawnFailed=true;});
    child=own;currentPort=assigned;localBearer=startBearer;
    own.once('exit',()=>{if(state==='READY'){state='FAILED';child=null;currentPort=null;version=null;localBearer=null;notify();}});
    let ready=false;
    for(let i=0;i<85&&!permanentlyStopped;i++){
     if(spawnFailed||own.exitCode!==null||own.signalCode!==null)break;
     try{
      const r=await fetch('http://127.0.0.1:'+assigned+'/health',
       {redirect:'error',signal:AbortSignal.timeout(500)});
      if(r.ok){
       const health=await r.json() as {ok?:boolean;version?:string};
       if(health.ok===true&&health.version==='0.11.0-dev.23-capgap-qa'){
        version=health.version;ready=true;break;
       }
      }
     }catch{}
     await sleep(90);
    }
    if(!ready||permanentlyStopped)throw Error('V1_SUPERVISOR_HEALTH_NOT_READY');
    state='READY';notify();return status();
   }catch{
    if(own)await terminate(own);
    child=null;currentPort=null;version=null;localBearer=null;
    state=permanentlyStopped?'STOPPED':'FAILED';notify();return status();
   }finally{begin=null;}
  })();
  return begin;
 }
 async function stop():Promise<void>{
  if(stopping)return stopping;
  permanentlyStopped=true;
  stopping=(async()=>{
   if(state==='DISABLED')return;
   state='STOPPING';notify();
   if(child)await terminate(child);
   if(begin)await Promise.race([begin,sleep(2800)]);
   if(child)await terminate(child);
   child=null;currentPort=null;version=null;localBearer=null;state='STOPPED';notify();
  })();
  try{await stopping;}finally{stopping=null;}
 }
 return {start,stop,status,coreUrl,toolsCatalog};
}
