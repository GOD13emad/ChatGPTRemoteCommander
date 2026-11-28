// Isolated ChatGPT content script. NEVER reads message text, cookies or the DOM.
(()=>{'use strict';
  if(window.top!==window)return;
  let previous='',lastSentAt=0;
  function report(){
    if(location.protocol!=='https:'||!['chatgpt.com','chat.openai.com'].includes(location.hostname))return;
    const key=location.origin+location.pathname;
    const now=Date.now();
    if(key===previous&&now-lastSentAt<30000)return;
    previous=key;lastSentAt=now;
    try{chrome.runtime.sendMessage({kind:'CHAT_URL'},()=>{void chrome.runtime.lastError;});}catch{}
  }
  report();
  window.addEventListener('popstate',report);
  window.addEventListener('hashchange',report);
  // React navigation changes history without firing popstate; lightweight periodic detection.
  setInterval(report,2500);
})();
