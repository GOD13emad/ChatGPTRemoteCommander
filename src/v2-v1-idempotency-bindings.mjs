// Native-only V2-to-V1 tool binding. Never invoked by the unauthenticated MCP.
// Bind V1's required mutation requestId to the exact approved V2 request
// before the native owner confirmation and before any V1 dispatch.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const TOOL=/^[a-z][a-z0-9_]{0,79}$/;
const fail=code=>{throw Object.assign(new Error(code),{code})};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
export function bindV2V1MutationId({tool,args,requestId,toolDefinitions}={}){
 if(!TOOL.test(tool??'')||!UUID.test(requestId??'')||!plain(args)||
   !Array.isArray(toolDefinitions)||toolDefinitions.length>256)
   fail('V2_V1_IDEMPOTENCY_INVALID_INPUT');
 const matches=toolDefinitions.filter(x=>x?.name===tool);
 if(matches.length!==1)fail('V2_V1_IDEMPOTENCY_TOOL_MISSING_OR_AMBIGUOUS');
 const schema=matches[0].inputSchema;
 if(!plain(schema)||schema.type!=='object'||!plain(schema.properties))
   fail('V2_V1_IDEMPOTENCY_SCHEMA_UNAVAILABLE');
 // Never let a remote caller inject an arbitrary V1 idempotency identity.
 if(Object.hasOwn(args,'requestId'))
   fail('V2_V1_IDEMPOTENCY_REMOTE_ID_FORBIDDEN');
 const input={...structuredClone(args)};
 if(Object.hasOwn(schema.properties,'requestId')){
   const field=schema.properties.requestId;
   if(!plain(field)||field.type!=='string')
     fail('V2_V1_IDEMPOTENCY_SCHEMA_UNSUPPORTED');
   input.requestId='v2-'+requestId;
 }
 // If tool has no requestId parameter, retain exact approved arguments.
 return Object.freeze(input);
}
