const id = { type:'string', minLength:1, maxLength:128, pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' };
const uuid = { type:'string', pattern:'^[a-f0-9-]{36}$' };
const ro = { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false };
const action = { readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:false };

export const deliveryToolDefinitions = [
  { name:'delivery_status', description:'Read compact durable completion-delivery health. Does not expose records, chat text, tool arguments or output.', inputSchema:{type:'object',properties:{},additionalProperties:false}, annotations:ro },
  { name:'delivery_list', description:'List bounded delivery metadata for one caller-supplied opaque correlation ID. The correlation ID is a trusted-profile routing key, not authenticated ChatGPT conversation identity.', inputSchema:{type:'object',properties:{correlationId:id,after:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50},includeDelivered:{type:'boolean'}},required:['correlationId'],additionalProperties:false}, annotations:ro },
  { name:'delivery_get', description:'Read one compact delivery record using its exact opaque correlation ID.', inputSchema:{type:'object',properties:{deliveryId:uuid,correlationId:id},required:['deliveryId','correlationId'],additionalProperties:false}, annotations:ro },
  { name:'delivery_claim', description:'Claim one delivery for bounded presentation. Reusing the same attemptId is idempotent; a live different claim fails closed.', inputSchema:{type:'object',properties:{deliveryId:uuid,correlationId:id,attemptId:id,leaseMs:{type:'integer',minimum:1000,maximum:300000}},required:['deliveryId','correlationId','attemptId'],additionalProperties:false}, annotations:action },
  { name:'delivery_ack', description:'Acknowledge that an exact claimed delivery was presented. Repeated acknowledgement with the same attempt is idempotent.', inputSchema:{type:'object',properties:{deliveryId:uuid,correlationId:id,attemptId:id},required:['deliveryId','correlationId','attemptId'],additionalProperties:false}, annotations:action },
  { name:'delivery_read_artifact', description:'Read one bounded base64 chunk of a content-addressed delivery artifact. Never returns an arbitrary filesystem path.', inputSchema:{type:'object',properties:{deliveryId:uuid,correlationId:id,offset:{type:'integer',minimum:0},maxBytes:{type:'integer',minimum:1,maximum:16384}},required:['deliveryId','correlationId'],additionalProperties:false}, annotations:ro }
];

export function createDeliveryTools(store) {
  return {
    definitions:deliveryToolDefinitions,
    status:()=>store.health(),
    execute(name,args={}) {
      if(name==='delivery_status') return store.health();
      if(name==='delivery_list') return store.list(args);
      if(name==='delivery_get') return store.get(args.deliveryId,args.correlationId);
      if(name==='delivery_claim') return store.claim(args);
      if(name==='delivery_ack') return store.ack(args);
      if(name==='delivery_read_artifact') return store.readArtifact(args);
      throw new Error('unknown delivery tool');
    }
  };
}
