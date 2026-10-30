// AgentOS capability router. No model/driver can confer OS privileges.
// Execution stays under Commander policy; this module only chooses a provider.
const TARGETS=new Set(['existing-browser','new-browser','existing-app','new-app','project']);
const OS=new Set(['win32','linux']);
const b=v=>v===true;
const denied=(code,next)=>Object.freeze({status:'BLOCKED',code,next,autoElevate:false,credentials:'NEVER_COPY',foreground:'PRESERVE'});
const selected=(provider,mode,description)=>Object.freeze({
 status:'READY',provider,mode,description,execution:'COMMANDER_POLICY_ENFORCED',
 autoElevate:false,credentials:'NEVER_COPY',foreground:'PRESERVE'
});
export const agentosProviders=Object.freeze({
 'ufo2-app-native':{platform:'win32',transport:'local MCP / UFO2 AppAgent',kind:'GUI_AND_NATIVE_API'},
 'windows-uia-native':{platform:'win32',transport:'native UIAutomation pattern',kind:'SEMANTIC_UI'},
 'linux-atspi-native':{platform:'linux',transport:'AT-SPI (owning session)',kind:'SEMANTIC_UI'},
 'playwright-mcp':{platform:'cross',transport:'Playwright DOM accessibility',kind:'BROWSER'},
 'chrome-devtools-mcp':{platform:'cross',transport:'Chrome DevTools protocol',kind:'BROWSER'},
 'commander-owned-browser':{platform:'cross',transport:'existing Browser Commander lease',kind:'BROWSER'},
 'cua-last-resort':{platform:'cross',transport:'verified owner-target visual fallback',kind:'VISUAL'},
 'codex-app-server':{platform:'cross',transport:'app-server JSON-RPC',kind:'AGENT_PLANNER'}
});
export function chooseAgentOSProvider(input={}){
 const {target,platform,ownerSession,capabilities={},grants={},application={}}=input;
 if(!TARGETS.has(target)||!OS.has(platform))throw Error('AGENTOS_INPUT_INVALID');
 if(typeof capabilities!=='object'||!capabilities||Array.isArray(capabilities)
    ||typeof grants!=='object'||!grants||Array.isArray(grants))throw Error('AGENTOS_INPUT_INVALID');
 const planner=b(capabilities.codexAuthenticated)&&b(capabilities.codexAppServer)
   ? 'codex-app-server' : 'commander-workflow';
 const withPlanner=route=>Object.freeze({...route,planner,
   fallbackAllowed:route.status==='READY'&&route.provider!=='cua-last-resort'});
 if(target==='project')return withPlanner(b(capabilities.commanderWorkflow)
   ?selected('commander-workflow','STRUCTURED_TASKS','Use the existing project engine and approved host tools')
   :denied('PROJECT_ENGINE_UNAVAILABLE','Restore Commander workflow engine; no new competing orchestrator'));
 if(target.startsWith('existing-')&&!b(ownerSession))return withPlanner(denied(
   'OWNER_SESSION_REQUIRED','Run native provider under verified owning OS principal and login session'));
 const browser=target.endsWith('browser');
 if(browser){
  if(target==='existing-browser'){
   if(!b(grants.browserProfileAttach))return withPlanner(denied('BROWSER_OWNER_CONSENT_REQUIRED',
     'Ask browser-native owner consent; cannot attach by copying cookies/profiles'));
   if(b(capabilities.playwrightExistingAuthorized))return withPlanner(selected('playwright-mcp','DOM', 'Existing browser with supported authorized CDP/Playwright route'));
   if(b(capabilities.chromeDevtoolsExistingAuthorized))return withPlanner(selected('chrome-devtools-mcp','CDP','Existing browser with authorized DevTools route'));
   return withPlanner(denied('BROWSER_EXISTING_PROFILE_ROUTE_UNAVAILABLE',
     'Use owner-authorized browser-native route or Commander-owned isolated profile, not an unsafe attach'));
  }
  if(b(capabilities.playwrightOwned))return withPlanner(selected('playwright-mcp','OWNED_ISOLATED_DOM','Owned isolated browser DOM/API'));
  if(b(capabilities.chromeDevtoolsOwned))return withPlanner(selected('chrome-devtools-mcp','OWNED_ISOLATED_CDP','Owned isolated Chromium DevTools'));
  if(b(capabilities.commanderOwnedBrowser))return withPlanner(selected('commander-owned-browser','OWNED_ISOLATED','Existing Commander-owned managed browser'));
  return withPlanner(denied('OWNED_BROWSER_UNAVAILABLE','Install or configure an isolated owned browser in the existing managed Commander runtime'));
 }
 if(platform==='win32'){
  if(b(application.nativeAPI)&&b(capabilities.ufo2AppAgent)&&b(grants.nativeApplication))
   return withPlanner(selected('ufo2-app-native','NATIVE_API','UFO2 AppAgent: WinCOM / native app API before GUI'));
  if(b(capabilities.windowsUIA)&&b(ownerSession))
   return withPlanner(selected('windows-uia-native','SEMANTIC_UI','Native UI Automation Invoke/Value patterns, exact target'));
 }else if(b(capabilities.linuxATSPI)&&b(ownerSession)){
  return withPlanner(selected('linux-atspi-native','SEMANTIC_UI','AT-SPI semantic UI on the owning X11/Wayland session'));
 }
 if(b(capabilities.cuaVerifiedOwnerTarget)&&b(grants.visualFallback))
  return withPlanner(selected('cua-last-resort','EXACT_TARGET_VISUAL','Fallback only after verified owner target; never global input'));
 if(target==='new-app')
  return withPlanner(denied('APPLICATION_EXECUTOR_REQUIRED','Install platform-native app executor or create a private application session'));
 return withPlanner(denied('SEMANTIC_PROVIDER_UNAVAILABLE','Prepare UFO2/UIA (Windows) or AT-SPI (Linux); CUA is never the only path'));
}
