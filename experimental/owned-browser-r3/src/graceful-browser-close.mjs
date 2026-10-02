const code=e=>e?.browserCode??e?.code??'BROWSER_CLOSE_UNEXPECTED';
const failure=value=>Object.assign(new Error(value),{browserCode:value});
export async function closeOwnedBrowser(browser,{waitMs=5000}={}) {
  if(!browser)return {closed:true,profileRetained:true,forceTermination:false};
  let primary=null;const secondary=[];
  try{await browser.cdp?.send('Browser.close',{},undefined,2000);}catch(e){primary=e;}
  try{browser.cdp?.close();}catch(e){if(primary)secondary.push({code:code(e),phase:'CDP_CLOSE'});else primary=e;}
  if(browser.child&&browser.child.exitCode===null){let timer,listener;
    try{await Promise.race([new Promise(resolve=>{listener=resolve;browser.child.once('close',listener);}),new Promise(resolve=>{timer=setTimeout(resolve,waitMs);})]);}
    finally{clearTimeout(timer);if(listener)browser.child.removeListener('close',listener);}
  }
  if(browser.child&&browser.child.exitCode===null){const e=failure('BROWSER_CLOSE_UNCONFIRMED_RECONCILE');if(primary)secondary.push({code:code(e),phase:'PROCESS_CLOSE'});else primary=e;}
  if(primary)throw Object.assign(new Error(primary.message??code(primary)),{browserCode:code(primary),secondaryRecords:[...(primary.secondaryRecords??[]),...secondary],processClosed:browser.child?.exitCode!==null});
  return {closed:true,profileRetained:true,forceTermination:false};
}
