const status=document.getElementById('status'),code=document.getElementById('code');
function show(x){status.textContent=x;}
async function send(msg){return await chrome.runtime.sendMessage(msg);}
async function refresh(){try{const r=await send({kind:'STATUS'});show(r.paired?'Paired':'Not connected');}catch{show('Extension unavailable');}}
document.getElementById('pair').addEventListener('click',async()=>{
  const value=code.value.trim().toUpperCase();
  if(!/^[A-F0-9]{16}$/.test(value)){show('Enter the 16-character code');return;}
  try{const result=await send({kind:'PAIR',code:value});show(result.ok?'Paired':result.error);code.value='';}
  catch{show('Pairing unavailable');}
});
document.getElementById('disconnect').addEventListener('click',async()=>{
  try{const result=await send({kind:'DISCONNECT'});show(result.ok?'Disconnected':result.error);}
  catch{show('Disconnect unavailable');}
});
void refresh();
