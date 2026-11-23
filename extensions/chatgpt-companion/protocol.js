// Shared pure helpers: content scripts never receive the bridge credential.
export function chatFromUrl(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port
      ||!['chatgpt.com','chat.openai.com'].includes(url.hostname))return null;
    const match=/^\/(?:g\/[^/]{1,120}\/)?c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(url.pathname);
    return match?match[1].toLowerCase():null;
  }catch{return null;}
}
export function observationFromUrl(url){
  const conversationId=chatFromUrl(url);
  return conversationId?{schema:1,phase:'CHAT_OPEN',conversationId}
    :{schema:1,phase:'CHAT_OTHER'};
}
export function validExtensionOrigin(origin){
  return /^(?:chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[0-9a-f-]{36})$/.test(origin);
}
