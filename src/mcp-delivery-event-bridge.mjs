// Internal, opt-in projection of a durable operation receipt into one MCP
// Events notification. Does not authenticate a chat, auto-subscribe, or ACK
// Commander delivery. Production publish MUST revalidate current ownership.
import {createHash} from 'node:crypto';
import {EVENT_NAME} from './mcp-events-security.mjs';

const PROJECT=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FINAL=new Set(['SUCCEEDED','FAILED','TIMED_OUT','CANCELLED','UNCERTAIN']);

export function operationEventFromDelivery(delivery,state) {
  const projectId=state?.continuation?.projectId;
  // Never infer recipient ownership from a transport correlation or profile.
  if(!PROJECT.test(projectId??'')||!UUID.test(state?.operationId??'')||
     !UUID.test(delivery?.deliveryId??'')||
     delivery?.source!=='operation'||delivery?.sourceId!==state.operationId||
     delivery?.correlationId!==(state.correlationId??state.requestId)||
     !FINAL.has(state.status)||typeof state.finishedAt!=='string'||
     !/Z$|[+-]\d\d:\d\d$/.test(state.finishedAt))return null;
  const time=new Date(state.finishedAt);
  if(!Number.isFinite(time.getTime()))return null;
  const eventId='evt_'+createHash('sha256')
    .update(JSON.stringify([projectId,delivery.deliveryId])).digest('hex');
  return Object.freeze({
    eventId,name:EVENT_NAME,timestamp:time.toISOString(),
    data:Object.freeze({
      project_id:projectId,correlation_id:delivery.correlationId,
      delivery_id:delivery.deliveryId,state:state.status
    })
  });
}

export function createOperationEventPublisher(endpoint) {
  if(!endpoint)return null;
  if(typeof endpoint.publish!=='function')throw new Error('MCP_EVENT_PUBLISHER_INVALID');
  return async(delivery,state)=>{
    const event=operationEventFromDelivery(delivery,state);
    if(!event)return {skipped:true,chatDelivered:0};
    return endpoint.publish(event);
  };
}
