// Bounded DevTools bootstrap wait. A Windows Edge launcher may exit 0 after
// handing startup to a distinct, still-owned browser process. That clean
// launcher exit is not native-browser readiness or a launch failure.
import fs from 'node:fs';

const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const fail = code => Object.assign(new Error(code),{browserCode:code});

export async function waitForDevToolsPortFile(file,child,{
  now=Date.now,pause=sleep,fileExists=fs.existsSync,
  readText=path=>fs.readFileSync(path,'utf8'),timeoutMs=6000
}={}){
  const deadline=now()+timeoutMs;
  while(now()<deadline){
    if(child.signalCode!==null&&child.signalCode!==undefined)
      throw fail('BROWSER_LAUNCH_FAILED');
    if(child.exitCode!==null&&child.exitCode!==undefined&&child.exitCode!==0)
      throw fail('BROWSER_LAUNCH_FAILED');
    // A success (0) exit from a bootstrap PID alone is inconclusive.
    // Only a fresh profile's valid DevToolsActivePort followed by an actual
    // loopback CDP connection in the caller establishes browser readiness.
    if(fileExists(file)){
      let text=null;
      try{text=readText(file);}
      catch(error){
        if(error?.code!=='ENOENT')throw fail('BROWSER_DEVTOOLS_UNAVAILABLE');
      }
      if(typeof text==='string'){
        const port=Number(text.trim().split(/\r?\n/)[0]);
        if(Number.isInteger(port)&&port>0&&port<=65535)return port;
      }
    }
    await pause(25);
  }
  throw fail('BROWSER_DEVTOOLS_TIMEOUT');
}
