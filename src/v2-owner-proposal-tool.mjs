// No OAuth: permit only a bounded, non-executing owner-review proposal.
// Never accept paths, shell commands, URLs, GUI inputs or workflow payloads.
export const OWNER_PROPOSAL_TOOL=Object.freeze({
 name:'v2_request_owner_note',
 title:'Request a V2 Owner-Approved Local Note',
 description:'Submit a short proposed note to the owner-private review queue. The MCP call NEVER creates the note or authorizes shell, GUI, file or workflow operations. Local interactive owner review is required; no ChatGPT user identity is attested.',
 inputSchema:Object.freeze({type:'object',properties:Object.freeze({
  title:{type:'string',minLength:1,maxLength:64},
  text:{type:'string',minLength:1,maxLength:512}
 }),required:Object.freeze(['title','text']),additionalProperties:false}),
 annotations:Object.freeze({readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}),
 securitySchemes:Object.freeze([{type:'noauth'}])
});
export function createV2OwnerProposalHandler({queue}={}){
 if(!queue||typeof queue.proposeNote!=='function')throw new Error('V2_PROPOSAL_OWNER_QUEUE_REQUIRED');
 return ({name,args})=>{
  if(name!==OWNER_PROPOSAL_TOOL.name)return null;
  const valid=args&&typeof args==='object'&&!Array.isArray(args)
    &&Object.getPrototypeOf(args)===Object.prototype
    &&Object.keys(args).length===2
    &&Object.keys(args).every(x=>x==='title'||x==='text');
  if(!valid)return {isError:true,content:[{type:'text',text:'V2_PROPOSAL_INPUT_INVALID'}]};
  try{
   const result=queue.proposeNote({title:args.title,text:args.text});
   return {isError:false,
     content:[{type:'text',text:'Request queued for local owner review. No action executed. Request: '+result.requestId}],
     structuredContent:result};
  }catch(e){
   const allowed=['V2_APPROVAL_TITLE_INVALID','V2_APPROVAL_TEXT_INVALID','V2_APPROVAL_QUEUE_FULL','V2_APPROVAL_QUEUE_CAPACITY'];
   return {isError:true,content:[{type:'text',text:allowed.includes(e?.code)?e.code:'V2_PROPOSAL_DENIED'}]};
  }
 };
}
