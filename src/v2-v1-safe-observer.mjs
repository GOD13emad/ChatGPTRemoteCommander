// Public no-auth V2 readiness snapshot: fixed fields only from fixed V1
// tools. No caller-supplied tool name, path, session, or pass-through data.
const fail=code=>{throw Object.assign(new Error(code),{code})};
export const V2_V1_READINESS_TOOL=Object.freeze({
 name:'v2_v1_live_readiness',
 title:'V2 Read V1 Runtime Readiness',
 description:'Check only fixed redacted readiness flags of the already-installed V1 GUI, browser, workflow and power mode; never include private file, process, browser tab, or raw tool response.',
 inputSchema:Object.freeze({type:'object',properties:Object.freeze({
   component:{type:'string',enum:['gui','browser','workflow','power']}
 }),required:Object.freeze(['component']),additionalProperties:false}),
 annotations:Object.freeze({readOnlyHint:true,destructiveHint:false,openWorldHint:false}),
 securitySchemes:Object.freeze([{type:'noauth'}])
});
const TABLE=Object.freeze({
 gui:Object.freeze(['gui_status',Object.freeze({
   available:'boolean',enabled:'boolean',inputAvailable:'boolean',consentRequired:'boolean',
   consentedSessionActive:'boolean',leased:'boolean',busy:'boolean'
 })]),
 browser:Object.freeze(['browser_status',Object.freeze({
   available:'boolean',enabled:'boolean',active:'boolean',
   backgroundOnly:'boolean',leased:'boolean',busy:'boolean'
 })]),
 workflow:Object.freeze(['workflow_health',Object.freeze({
   ok:'boolean',databaseIntegrity:'string'
 })]),
 power:Object.freeze(['power_status',Object.freeze({
   enabled:'boolean',fullFilesystem:'boolean',allowShell:'boolean',allowProcessControl:'boolean'
 })])
});
export function createV2V1SafeObserver({invokeReadOnly}={}){
 if(typeof invokeReadOnly!=='function')fail('V2_OBSERVER_TRUSTED_SOURCE_REQUIRED');
 return async function ready(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(args))||
    Object.keys(args).length!==1||!Object.hasOwn(args,'component')||
    typeof args.component!=='string'||!Object.hasOwn(TABLE,args.component))fail('V2_OBSERVER_INPUT_INVALID');
  const [tool,fields]=TABLE[args.component];
  const raw=await invokeReadOnly(tool);
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    fail('V2_OBSERVER_SOURCE_UNAVAILABLE');
  const result={component:args.component,source:'V1_REDACTED_SNAPSHOT'};
  for(const [key,type] of Object.entries(fields)){
   if(typeof raw[key]!==type)fail('V2_OBSERVER_SOURCE_SCHEMA');
   if(type==='string'){
    if(key==='databaseIntegrity'){
      if(!['ok','corrupt','unknown'].includes(raw[key]))
        fail('V2_OBSERVER_SOURCE_SCHEMA');
    }else fail('V2_OBSERVER_SOURCE_SCHEMA');
   }
   result[key]=raw[key];
  }
  if(args.component==='workflow'){
   const scheduler=raw.scheduler;
   if(!scheduler||typeof scheduler!=='object')fail('V2_OBSERVER_SOURCE_SCHEMA');
   for(const key of ['enabled','automaticExecution']){
    if(typeof scheduler[key]!=='boolean')fail('V2_OBSERVER_SOURCE_SCHEMA');
    result['scheduler'+key[0].toUpperCase()+key.slice(1)]=scheduler[key];
   }
  }
  return Object.freeze(result);
 };
}
