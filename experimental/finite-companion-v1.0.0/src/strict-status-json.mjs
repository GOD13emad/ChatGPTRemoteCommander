// Vendored from admitted service-admission R3. This revision additionally denies
// a UTF-8 BOM and enforces the bound on UTF-8 bytes, including string callers.
// Malformed UTF-8 and duplicate decoded names are never repaired into authority.
const bad=()=>{throw Object.assign(new Error('SAEED_TRANSPORT_JSON'),{code:'SAEED_TRANSPORT_JSON'});};
export function parseStatusJson(value){
  let text;
  try{text=typeof value==='string'?value:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(value);}catch{bad();}
  if(!text.isWellFormed()||Buffer.byteLength(text,'utf8')>1048576)bad();
  const stack=[];let tokens=0;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(/[ \r\n\t]/.test(c))continue;if(++tokens>100000)bad();
    if(c==='{'||c==='['){stack.push({object:c==='{',members:new Set()});if(stack.length>32)bad();}
    else if(c==='}'||c===']'){if(!stack.length)bad();stack.pop();}
    else if(c==='"'){
      const begin=i;let ended=false;
      for(i++;i<text.length;i++){if(text[i]==='\\'){i++;continue;}if(text[i]==='"'){ended=true;break;}}
      if(!ended)bad();let next=i+1;while(/[ \r\n\t]/.test(text[next]??'!'))next++;
      if(text[next]===':'&&stack.at(-1)?.object){let name;try{name=JSON.parse(text.slice(begin,i+1));}catch{bad();}
        if(!name.isWellFormed()||stack.at(-1).members.has(name))bad();stack.at(-1).members.add(name);}
    }
  }
  if(stack.length)bad();let parsed;try{parsed=JSON.parse(text);}catch{bad();}return parsed;
}
