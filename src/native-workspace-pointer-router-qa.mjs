// NO PROMOTE: in-memory virtual cursor routing for separately owned OS workspaces.
// Does not create a desktop, authenticate an MCP conversation or emit OS input.
import {randomBytes} from 'node:crypto';
const fail=code=>Object.assign(new Error(code),{code});
const own=(obj,key)=>Object.hasOwn(obj,key);
const idRe=/^[a-zA-Z0-9._:-]{1,128}$/;
const snapshot=v=>{
 if(!v||typeof v!=='object'||Array.isArray(v)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(v)))
   throw fail('POINTER_REQUEST_INVALID');
 const ds=Object.getOwnPropertyDescriptors(v);
 if(Reflect.ownKeys(ds).some(k=>typeof k!=='string'||!ds[k].enumerable||!own(ds[k],'value')))
   throw fail('POINTER_REQUEST_INVALID');
 return Object.fromEntries(Object.entries(ds).map(([k,d])=>[k,d.value]));
};
export function createNativePointerRouter({attest=()=>null,clock=()=>Date.now(),
 ticket=()=>randomBytes(32).toString('hex'),capacity=8}={}){
 if(!Number.isInteger(capacity)||capacity<1||capacity>32)throw fail('POINTER_CAPACITY_INVALID');
 const sessions=new Map(),activeWorkspaces=new Map();
 function verified(raw){
  const x=attest(raw);
  if(!x||x.authenticated!==true||x.conversationBound!==true||
     !idRe.test(x.subject)||!idRe.test(x.conversationId))
    throw fail('POINTER_AUTH_REQUIRED');
  return x;
 }
 function open(raw,{workspaceId,generation,width,height,ttlMs=30000}={}){
  const id=verified(raw);
  if(!idRe.test(workspaceId)||!idRe.test(generation)||
     !Number.isInteger(width)||!Number.isInteger(height)||
     width<1||height<1||width>16384||height>16384||
     !Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>120000)
    throw fail('POINTER_WORKSPACE_INVALID');
  if(activeWorkspaces.has(workspaceId))throw fail('POINTER_WORKSPACE_BUSY');
  if(sessions.size>=capacity)throw fail('POINTER_CAPACITY_REACHED');
  const token=ticket();
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||sessions.has(token))
    throw fail('POINTER_TOKEN_INVALID');
  const s={workspaceId,generation,subject:id.subject,conversationId:id.conversationId,
   width,height,x:0,y:0,deadline:clock()+ttlMs,serial:0};
  sessions.set(token,s);activeWorkspaces.set(workspaceId,token);
  return Object.freeze({token,workspaceId,generation});
 }
 function action(raw,token,input){
  const id=verified(raw),s=sessions.get(token);
  if(!s||clock()>=s.deadline)throw fail('POINTER_LEASE_INVALID');
  if(s.subject!==id.subject||s.conversationId!==id.conversationId)
   throw fail('POINTER_CONVERSATION_DENIED');
  if(activeWorkspaces.get(s.workspaceId)!==token)
   throw fail('POINTER_WORKSPACE_REVOKED');
  const v=snapshot(input);
  if(!['move','click','scroll'].includes(v.kind)||
     Object.keys(v).some(k=>!['kind','x','y','delta','generation','serial'].includes(k))||
     v.generation!==s.generation||v.serial!==s.serial+1)
   throw fail('POINTER_ACTION_DENIED');
  if(v.kind==='scroll'){
   if(Object.keys(v).some(k=>!['kind','delta','generation','serial'].includes(k))||
      !Number.isInteger(v.delta)||!v.delta||Math.abs(v.delta)>1200)
    throw fail('POINTER_ACTION_DENIED');
  }else if(!Number.isInteger(v.x)||!Number.isInteger(v.y)||
    v.x<0||v.y<0||v.x>=s.width||v.y>=s.height||
    Object.keys(v).some(k=>!['kind','x','y','generation','serial'].includes(k)))
   throw fail('POINTER_ACTION_DENIED');
  if(v.kind==='move'){s.x=v.x;s.y=v.y;}
  // This is a validated *request description*, not a dispatched OS action.
  s.serial++;
  return Object.freeze({workspaceId:s.workspaceId,generation:s.generation,
    serial:s.serial,kind:v.kind,x:v.kind==='scroll'?s.x:v.x,
    y:v.kind==='scroll'?s.y:v.y,delta:v.kind==='scroll'?v.delta:undefined,
    dispatched:false});
 }
 function revoke(raw,token){
  const id=verified(raw),s=sessions.get(token);
  if(!s)return false;
  if(id.subject!==s.subject||id.conversationId!==s.conversationId)
   throw fail('POINTER_CONVERSATION_DENIED');
  sessions.delete(token);activeWorkspaces.delete(s.workspaceId);return true;
 }
 function inspect(){return Object.freeze({workspaceCount:activeWorkspaces.size,sessionCount:sessions.size});}
 return Object.freeze({open,action,revoke,inspect});
}
