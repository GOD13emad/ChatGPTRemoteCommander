import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { evaluateSchemaContinuity } from '../tools/schema-continuity-gate.mjs';

function server(handler){return http.createServer(handler);}
let portCursor=20000+(process.pid%10000);
async function listen(s){
  for(let attempt=0;attempt<500;attempt+=1){
    const port=portCursor++;
    if(portCursor>45000)portCursor=20000;
    try{
      await new Promise((resolve,reject)=>{
        const cleanup=()=>{s.off('error',onError);s.off('listening',onListening);};
        const onError=error=>{cleanup();reject(error);};
        const onListening=()=>{cleanup();resolve();};
        s.once('error',onError);s.once('listening',onListening);s.listen(port,'127.0.0.1');
      });
      return port;
    }catch(error){
      if(error?.code!=='EADDRINUSE')throw error;
    }
  }
  throw new Error('SAFE_TEST_PORT_UNAVAILABLE');
}
async function close(s){await new Promise(r=>s.close(r));}
function schemaServer(tools){return server(async(req,res)=>{for await(const _ of req){}const data=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:1,result:{tools}}));res.writeHead(200,{'content-type':'application/json','content-length':data.length});res.end(data);});}
function statusServer(schemaContinuity){return server((req,res)=>{const data=Buffer.from(JSON.stringify({ok:true,router:true,schemaContinuity}));res.writeHead(200,{'content-type':'application/json','content-length':data.length});res.end(data);});}
const tool=(required=[])=>({name:'write_text',inputSchema:{type:'object',properties:{path:{type:'string'},requestId:{type:'string'}},required}});

async function run(oldTools,newTools,continuity){
 const a=schemaServer(oldTools),b=schemaServer(newTools),r=statusServer(continuity);
 const [ap,bp,rp]=await Promise.all([listen(a),listen(b),listen(r)]);
 try{return await evaluateSchemaContinuity({oldUrl:`http://127.0.0.1:${ap}/mcp`,candidateUrl:`http://127.0.0.1:${bp}/mcp`,routerUrl:`http://127.0.0.1:${rp}/router/status`});}
 finally{await Promise.all([close(a),close(b),close(r)]);}
}
test('unchanged tool schema does not require negotiated refresh',async()=>{const x=await run([tool([])],[tool([])],null);assert.equal(x.ok,true);assert.equal(x.decision,'UNCHANGED_SCHEMA');});
test('changed tool schema blocks without router continuity support',async()=>{const x=await run([tool([])],[tool(['requestId'])],null);assert.equal(x.ok,false);assert.equal(x.decision,'ROUTER_CONTINUITY_UNSUPPORTED');});
test('changed tool schema blocks after any legacy MCP traffic',async()=>{const x=await run([tool([])],[tool(['requestId'])],{legacyMcpSeen:true,toolsListSubscribers:1});assert.equal(x.ok,false);assert.equal(x.decision,'LEGACY_HOST_SEEN');});
test('changed tool schema blocks when tools-list refresh is not negotiated',async()=>{const x=await run([tool([])],[tool(['requestId'])],{legacyMcpSeen:false,toolsListSubscribers:0});assert.equal(x.ok,false);assert.equal(x.decision,'TOOLS_LIST_REFRESH_UNNEGOTIATED');});
test('changed tool schema passes with modern negotiated refresh and no legacy host',async()=>{const x=await run([tool([])],[tool(['requestId'])],{legacyMcpSeen:false,toolsListSubscribers:1});assert.equal(x.ok,true);assert.equal(x.decision,'NEGOTIATED_REFRESH');});
