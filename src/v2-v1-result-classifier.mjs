// Exact, private-output-free V1 Shell completion metadata for V2 receipts.
// The V1 tool return is trusted only as an RPC result, not proof of side effects.
// This module is called by the local owner CLI, NEVER by the noauth MCP endpoint.
const VALID=new Set(['EXIT_ZERO','EXIT_NONZERO','TIMED_OUT','TOOL_ERROR','UNKNOWN']);
export const V2_SHELL_COMPLETION=Object.freeze([...VALID]);
export function classifyV2V1ShellResult(v1Response){
 if(!v1Response||typeof v1Response!=='object'||Array.isArray(v1Response))
  return 'UNKNOWN';
 if(v1Response.isError===true)return 'TOOL_ERROR';
 if(v1Response.isError!==false)return 'UNKNOWN';
 const s=v1Response.structuredContent;
 if(!s||typeof s!=='object'||Array.isArray(s))return 'UNKNOWN';
 if(s.timedOut===true)return 'TIMED_OUT';
 if(s.timedOut!==false)return 'UNKNOWN';
 if(s.signal!==null)return 'UNKNOWN';
 if(!Number.isSafeInteger(s.exitCode)||s.exitCode<0||s.exitCode>255)return 'UNKNOWN';
 return s.exitCode===0?'EXIT_ZERO':'EXIT_NONZERO';
}
export function validateV2ShellReceiptValue(value){
 if(value===undefined)return 'UNKNOWN'; // old receipts do not contain exit metadata
 if(typeof value!=='string'||!VALID.has(value))
  throw Object.assign(new Error('V2_SHELL_RECEIPT_UNTRUSTED'),{code:'V2_SHELL_RECEIPT_UNTRUSTED'});
 return value;
}
