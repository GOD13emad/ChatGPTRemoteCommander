import {spawn} from 'node:child_process';
import {parseStatusJson} from '../deps/strict-status-json.mjs';
const error=code=>Object.assign(new Error(code),{code});
const actions=new Set(['status','start','end','navigate','snapshot']);
// One owned helper, strict single flight, NO force kill, NO retry, NO profile deletion.
export function createGracefulBrowserClient({file,args,env,timeoutMs=15000,maxBytes=262144,closeMs=6000}) {
  let child=null,ready=null,pending=null,buffer=Buffer.alloc(0),poisoned=false,closed=false,exitCode=null,exitSignal=null;
  function fail(e){poisoned=true;if(pending){clearTimeout(pending.timer);pending.reject(e);pending=null;}if(ready){clearTimeout(ready.timer);ready.reject(e);ready=null;}}
  function line(bytes){let value;try{value=parseStatusJson(bytes);}catch(e){fail(e);return;}
    if(ready){if(value.ok!==true||value.ready!==true||value.protocol!==1){fail(error('FIXTURE_HELPER_STARTUP'));return;}clearTimeout(ready.timer);ready.resolve();ready=null;return;}
    if(!pending){fail(error('FIXTURE_HELPER_UNEXPECTED_OUTPUT'));return;}
    const current=pending;pending=null;clearTimeout(current.timer);
    if(value.ok!==true){poisoned=true;current.reject(Object.assign(error(value.error??'FIXTURE_HELPER_ERROR'),{secondaryRecords:value.secondaryRecords??[]}));}
    else current.resolve(value);
  }
  async function start(){
    if(child)return;
    child=spawn(file,args,{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:{...env,NODE_OPTIONS:'',NODE_PATH:''}});
    child.once('close',(code,signal)=>{closed=true;exitCode=code;exitSignal=signal;if(ready||pending)fail(error('FIXTURE_HELPER_EARLY_EXIT'));});
    child.on('error',e=>fail(e));child.stdin.on('error',e=>fail(e));
    child.stderr.on('data',()=>fail(error('FIXTURE_HELPER_STDERR')));
    child.stdout.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);
      if(buffer.length>maxBytes){fail(error('FIXTURE_HELPER_SIZE'));return;}
      let index;while((index=buffer.indexOf(10))>=0){const bytes=buffer.subarray(0,index);buffer=buffer.subarray(index+1);line(bytes);}
    });
    await new Promise((resolve,reject)=>{ready={resolve,reject,timer:setTimeout(()=>fail(error('FIXTURE_HELPER_STARTUP_TIMEOUT')),timeoutMs)};});
  }
  let reserved=false;
  async function invoke(request){
    if(poisoned||closed)throw error('FIXTURE_HELPER_RECONCILE_REQUIRED');
    if(reserved||pending)throw error('FIXTURE_HELPER_BUSY');
    if(!request||!actions.has(request.action))throw error('FIXTURE_ACTION_NOT_ADMITTED');
    reserved=true;
    try{await start();if(poisoned||closed)throw error('FIXTURE_HELPER_RECONCILE_REQUIRED');
      return await new Promise((resolve,reject)=>{
        pending={resolve,reject,timer:setTimeout(()=>fail(error('FIXTURE_HELPER_TIMEOUT_NO_RETRY')),timeoutMs)};
        child.stdin.write(JSON.stringify(request)+'\n',e=>{if(e)fail(e);});
      });
    }finally{reserved=false;}
  }
  async function close(){
    if(!child)return {closed:true,forceTermination:false};
    if(closed){if(exitCode!==0||exitSignal)throw error('FIXTURE_HELPER_CLOSE_EXIT_FAILURE');return {closed:true,exitCode,forceTermination:false};}
    if(ready||pending)fail(error('FIXTURE_HELPER_CLOSE_DURING_OPERATION'));
    child.stdin.end();let timer;
    try{await Promise.race([new Promise(resolve=>child.once('close',resolve)),new Promise(resolve=>{timer=setTimeout(resolve,closeMs);})]);}finally{clearTimeout(timer);}
    if(!closed){poisoned=true;throw error('FIXTURE_HELPER_CLOSE_UNCONFIRMED_RECONCILE');}
    if(exitCode!==0||exitSignal)throw error('FIXTURE_HELPER_CLOSE_EXIT_FAILURE');
    return {closed:true,exitCode,forceTermination:false};
  }
  return Object.freeze({invoke,close,state:()=>Object.freeze({pid:child?.pid??null,busy:reserved||pending!==null,poisoned,closed,exitCode,exitSignal})});
}
