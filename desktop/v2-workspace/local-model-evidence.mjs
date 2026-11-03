// Fixed loopback-only Ollama catalog view; no prompt generation or Worker dispatch.
const URL='http://127.0.0.1:11434/api/tags';
const TIMEOUT=1250, MAX_BYTES=128*1024;
const modelName=name=>typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(name);
const empty=state=>Object.freeze({schema:1,source:'LOCAL_OLLAMA_CATALOG',state,
  modelCount:null,models:[],workerEffectVerified:false,canExecute:false,chatAuthenticated:false});
export async function readLocalModelCatalog({request=fetch,timeoutMs=TIMEOUT}={}){
  if(typeof request!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>2500)
    throw Error('V2_OLLAMA_CATALOG_CONFIG_INVALID');
  let response;
  try {
    response=await request(URL,{method:'GET',redirect:'error',
      headers:{accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});
  }catch{return empty('LOCAL_API_UNAVAILABLE');}
  if(!response?.ok||typeof response.body?.[Symbol.asyncIterator]!=='function')
    return empty('LOCAL_API_UNAVAILABLE');
  if(!String(response.headers?.get('content-type')||'').includes('application/json'))
    return empty('CATALOG_UNVERIFIED');
  let size=0;const chunks=[];
  try {
    for await(const part of response.body) {
      size+=part.byteLength;
      if(size>MAX_BYTES) return empty('CATALOG_UNVERIFIED');
      chunks.push(Buffer.from(part));
    }
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value)||
       !Array.isArray(value.models)||value.models.length>1000)
      return empty('CATALOG_UNVERIFIED');
    const listed=value.models.map(v=>v?.name);
    if(!listed.every(modelName))return empty('CATALOG_UNVERIFIED');
    return Object.freeze({
      schema:1,source:'LOCAL_OLLAMA_CATALOG',state:'MODEL_CATALOG_OBSERVED',
      modelCount:listed.length,models:listed.slice(0,8),
      workerEffectVerified:false,canExecute:false,chatAuthenticated:false
    });
  }catch{return empty('CATALOG_UNVERIFIED');}
}
