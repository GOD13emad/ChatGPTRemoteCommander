/**
 * Optional OpenTelemetry tracer boundary for Commander agents and workflows.
 *
 * No SDK import, global registration, environment-variable configuration,
 * exporter, filesystem, logging or network activity. The caller must validate
 * an actual native owner export grant and revalidate it on EVERY observe()
 * call, including after revocation. The boolean is NOT an authorization
 * mechanism or substitute for J01; the verifier is provided by the Core.
 *
 * Compatible with the OpenTelemetry JS tracer's startSpan/setAttribute/end
 * surface. An SDK and exporter remain a separately consented capability pack.
 */
import { createHmac, randomBytes } from 'node:crypto';

const kinds = new Set(['tool','workflow','agent']);
const actions = new Set(['read','write','execute','browse','plan','inspect']);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function safeMeta(metadata,field) {
  // Tool/agent metadata may be a Proxy, a getter or partially hydrated.
  // Observability must never be allowed to interrupt the actual operation.
  try { return metadata?.[field]; } catch { return undefined; }
}
function safeTracer(tracer) {
  try { return typeof tracer?.startSpan==='function'; }
  catch { return false; }
}

function pseudonym(key, namespace, raw) {
  if(typeof raw!=='string' || !idPattern.test(raw))return undefined;
  return createHmac('sha256',key).update(namespace).update('\0').update(raw).digest('hex').slice(0,24);
}

function outcomeOf(receipt) {
  try {
    const value=receipt?.status;
    if(typeof value!=='string' || value.length>48)return 'unknown';
    switch(value.toUpperCase()){
      case 'APPLIED': case 'COMPLETED': case 'SUCCESS': case 'SUCCEEDED': case 'VERIFIED':
        // Observing a returned status is not independent proof of an OS effect.
        return 'reported_success';
      case 'UNCERTAIN': case 'UNKNOWN_EFFECT': return 'uncertain';
      case 'BLOCKED': case 'DENIED': case 'REJECTED': case 'CANCELLED': return 'blocked';
      case 'NOT_APPLIED': return 'not_applied';
      case 'FAILED': case 'ERROR': return 'error';
      default: return 'unknown';
    }
  }catch{return 'unknown';}
}

/**
 * @param {object} options
 * @param {boolean} options.enabled Default false; no data leaves Commander.
 * @param {boolean} options.ownerExportAuthorized True ONLY after separately
 *        verified owner consent for the exact exporter/destination/retention.
 * @param {function} options.verifyExportGrant Callback backed by the
 *        native owner-grant authority; returns only true if currently valid.
 *        Checked after operation and before export so mid-operation
 *        revocation suppresses the span. Denial/timeout/exception => none.
 * @param {number} options.grantTimeoutMs Bound a broken grant verifier; default 200ms.
 * @param {object} options.tracer Approved OpenTelemetry tracer supplied by caller.
 * @param {Buffer} options.key Optional local 32+-byte HMAC key for correlation.
 */
export function createCommanderTelemetry({
  enabled=false, ownerExportAuthorized=false, tracer=null, key=undefined,
  verifyExportGrant=null, grantTimeoutMs=200
}={}) {
  // Never instantiate an SDK or honor OTEL_EXPORTER_* environment variables.
  const configured=enabled===true && ownerExportAuthorized===true &&
    typeof verifyExportGrant==='function' && safeTracer(tracer);
  const hmacKey=configured
    ? (Buffer.isBuffer(key) && key.length>=32 ? Buffer.from(key) : randomBytes(32))
    : null;

  // A failed/unresponsive observer is never allowed to hold up a business tool.
  const deadline=Number.isInteger(grantTimeoutMs) && grantTimeoutMs>=10 &&
    grantTimeoutMs<=1000 ? grantTimeoutMs : 200;
  async function currentGrant() {
    let timer;
    try {
      const permitted=await Promise.race([
        Promise.resolve().then(()=>verifyExportGrant()),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(false),deadline);})
      ]);
      return permitted===true;
    }catch{return false;}
    finally{if(timer)clearTimeout(timer);}
  }

  return Object.freeze({
    async observe(metadata, operation) {
      if(typeof operation!=='function')throw new TypeError('COMMANDER_TELEMETRY_OPERATION_REQUIRED');
      // Execute first; observe only after a fresh consent check, so a grant
      // revoked during a long operation cannot export a trace on completion.
      let receipt;
      let failed=false;
      let error;
      try { receipt=await operation(); }
      catch(e) {failed=true; error=e;}
      if(configured && await currentGrant()) {
        try {
          const candidateKind=safeMeta(metadata,'kind');
          const candidateAction=safeMeta(metadata,'action');
          const kind=kinds.has(candidateKind)?candidateKind:'unknown';
          const action=actions.has(candidateAction)?candidateAction:'unknown';
          // Fixed attribute schema: never serialize prompt, paths, raw IDs,
          // user, exception message/stack or the business result.
          const attributes={
            'commander.kind':kind,
            'commander.action':action
          };
          const operationHash=pseudonym(hmacKey,'operation',safeMeta(metadata,'operationId'));
          const projectHash=pseudonym(hmacKey,'project',safeMeta(metadata,'projectId'));
          if(operationHash)attributes['commander.operation_hash']=operationHash;
          if(projectHash)attributes['commander.project_hash']=projectHash;
          const span=tracer.startSpan(
            'commander.'+(kind==='unknown'?'event':kind)+'.operation',
            {attributes}
          );
          try {span?.setAttribute?.('commander.outcome',failed?'error':outcomeOf(receipt));}catch{}
          try {span?.end?.();}catch{}
        }catch{} // Never allow telemetry to affect a business outcome.
      }
      if(failed)throw error;
      return receipt;
    }
  });
}
