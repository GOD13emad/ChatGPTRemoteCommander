// First-class cross-platform control-engine router. Planning and evidence only:
// the existing Commander owner broker, tool guards and per-target journal remain
// the ONLY effect executor. No sub-MCP shell with ambient privileges is created.
const ro=Object.freeze({readOnlyHint:true,destructiveHint:false,openWorldHint:false});
const targets=Object.freeze(['filesystem','terminal','project','existing-browser','new-browser','existing-app','new-app']);
const engines=Object.freeze(['chrome','edge','brave','firefox','chromium','other']);
const activities=Object.freeze(['observe','interact','launch']);
const safe=(value)=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{2,80}$/.test(value)?value:'UNVERIFIED';
const entry=(id,status,tools=[],reason='UNVERIFIED',details={})=>({id,status,tools,reason,...details});
const noSecrets=Object.freeze({
  passwordExport:false,cookieExport:false,tokenExport:false,profileCloning:false,
  autoLoginWithoutNativeConsent:false,crossUserInput:false,
  physicalFocusInterferenceAllowedByDefault:false,blindEffectReplay:false
});
export const hybridControlToolDefinitions=Object.freeze([
  {name:'hybrid_control_status',
   description:'Read-only inventory of the OS/terminal/browser/native GUI control engines Commander can route to. Candidate is NOT an installed or authorized provider.',
   inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:ro},
  {name:'hybrid_control_plan',
   description:'Plan one original-user workflow across native OS, browser DOM, Windows UIA, Linux AT-SPI/Portal, and CUA fallback. No browser attach, launch, injection, secret access, or effect is performed.',
   inputSchema:{type:'object',properties:{
     target:{type:'string',enum:targets},
     activity:{type:'string',enum:activities},
     browserEngine:{type:'string',enum:engines},
     preserveExistingLogin:{type:'boolean'}
   },required:['target'],additionalProperties:false},annotations:ro}
]);
function assertInput(name,args) {
  if(!args||typeof args!=='object'||Array.isArray(args))throw Error('HYBRID_CONTROL_INPUT_INVALID');
  if(name==='hybrid_control_status'){
    if(Object.keys(args).length)throw Error('HYBRID_CONTROL_INPUT_INVALID');
    return;
  }
  if(name!=='hybrid_control_plan'||!targets.includes(args.target)||
    args.activity!==undefined&&!activities.includes(args.activity)||
    args.browserEngine!==undefined&&!engines.includes(args.browserEngine)||
    args.preserveExistingLogin!==undefined&&typeof args.preserveExistingLogin!=='boolean'||
    Object.keys(args).some(k=>!['target','activity','browserEngine','preserveExistingLogin'].includes(k)))
    throw Error('HYBRID_CONTROL_INPUT_INVALID');
}
function choose(candidates){
  // A candidate/consent-gated provider is not executable. Do not skip native
  // owner consent by failing over to a privileged shell or another profile.
  const first=candidates.find(x=>x.status==='AVAILABLE');
  return first?{id:first.id,mode:'DISCOVERY_ONLY',nextTool:first.tools[0]??null}:
    {id:null,mode:'NO_AUTHORIZED_EFFECT_ROUTE',nextTool:candidates.find(x=>x.status==='GATED')?.tools[0]??null};
}
export function createHybridControl({platform=process.platform,config={},
  toolNames=()=>[],ownerStatus=()=>({}),providerEvidence=()=>({})}={}) {
  const catalog=()=>new Set(toolNames());
  const has=(names,...ids)=>ids.every(n=>names.has(n));
  async function snapshot(){
    let owner={},providers={};
    try { owner=await ownerStatus()??{}; } catch { /* unknown, never upgrade */ }
    try { providers=await providerEvidence()??{}; } catch { /* no claim */ }
    // Never accept a caller-supplied flag as proof of active user consent.
    const ownerProven=owner.sameUserSessionVerified===true&&owner.nativeBrokerAccepted===true;
    const p=config.powerMode??{},names=catalog();
    const terminalEnabled=p.enabled===true&&p.allowShell===true&&p.allowProcessControl===true;
    const route=(name,test,reason,steps)=>entry(name,test?'AVAILABLE':'GATED',steps,reason);
    const providersVerified=id=>providers?.[id]?.sessionVerified===true&&
      providers?.[id]?.consentAccepted===true&&ownerProven;
    return {
      schema:1,platform,
      owner:{sameUserSessionVerified:ownerProven,code:ownerProven?'OWNER_NATIVE_BROKER_VERIFIED':'OWNER_SESSION_UNVERIFIED'},
      backends:{
        directFiles:route('direct-files',has(names,'read_text','list_directory'),'PROJECT_ROOT_AND_OS_ACL_APPLY',['list_directory','read_text']),
        terminal:route('commander-terminal',terminalEnabled&&has(names,'start_terminal','read_terminal'),
          'SHELL_AND_PROCESS_POLICY_APPLY',['start_terminal','read_terminal']),
        project:route('commander-workflow',names.has('workflow_run_tick'),'EXPLICIT_ENROLLMENT_AND_RUNNER_REQUIRED',['workflow_status','workflow_run_tick']),
        appCatalog:route('owner-app-catalog',ownerProven&&has(names,'workspace_app_catalog'),'SAME_OWNER_NATIVE_BROKER_REQUIRED',['workspace_app_catalog','workspace_app_open']),
        windowObserve:route('window-scoped-observe',has(names,'workspace_target_list'),'OBSERVE_ONLY_NOT_INPUT_CONSENT',['workspace_target_list','workspace_target_open','workspace_target_snapshot']),
        browserExtension:route('playwright-extension',providersVerified('playwrightExtension'),'INSTALL_AND_BROWSER_NATIVE_CONSENT_REQUIRED',['workspace_browser_inspect']),
        chromeDevtools:route('chrome-devtools-native',providersVerified('chromeDevtools'),'CHROME_NATIVE_DEBUG_CONSENT_REQUIRED',['workspace_browser_inspect']),
        firefoxExtension:route('firefox-native-messaging',providersVerified('firefoxExtension'),'FIREFOX_EXTENSION_AND_NATIVE_HOST_CONSENT_REQUIRED',['workspace_browser_inspect']),
        windowsUia:entry('windows-uia-winapp',
          platform!=='win32'?'UNSUPPORTED':providersVerified('windowsUia')&&names.has('workspace_winapp_probe')?'AVAILABLE':'GATED',
          ['workspace_winapp_probe','workspace_target_list'],'WINDOWS_OWNER_WINAPP_INSTALL_AND_UIA_INSPECTION_REQUIRED'),
        linuxAtspi:entry('linux-atspi',
          platform!=='linux'?'UNSUPPORTED':ownerProven&&names.has('workspace_accessibility_open')?'AVAILABLE':'GATED',
          ['workspace_accessibility_open'],'OWNER_DBUS_SESSION_AND_ACCESSIBILITY_REQUIRED'),
        waylandPortal:entry('wayland-portal-libei',
          platform!=='linux'?'UNSUPPORTED':providersVerified('waylandPortal')?'AVAILABLE':'GATED',
          ['workspace_accessibility_open'],'COMPOSITOR_PORTAL_INTERACTIVE_CONSENT_REQUIRED'),
        cua:entry('cua-visual-fallback',
          ownerProven&&has(names,'workspace_window_observe')?'AVAILABLE':'GATED',
          ['workspace_window_observe'],'EXACT_OWNER_WINDOW_AND_PER_ACTION_CONSENT_REQUIRED'),
        rustdesk:entry('remote-operator-recovery','GATED',[],'HUMAN_REMOTE_DESKTOP_ONLY_NOT_SEMANTIC_AUTOMATION'),
        desktopCommander:entry('desktopcommander-mcp-compat',
          has(names,'start_terminal','read_terminal','read_text','write_text')&&terminalEnabled?'AVAILABLE':'GATED',
          ['start_terminal','read_terminal','read_text','write_text'],
          'EXISTING_COMMANDER_TERMINAL_AND_FILE_TOOLS_NO_SECOND_PRIVILEGED_SERVER')
      },guarantees:noSecrets,source:'CURRENT_COMMANDER_CATALOG_AND_TRUSTED_OWNER_PROBES',
      effectPerformed:false
    };
  }
  async function plan(args){
    const s=await snapshot(),b=s.backends,kind=args.target,activity=args.activity??'observe';
    const chain=[];
    const push=id=>{const item=b[id];if(item&&item.status!=='UNSUPPORTED')chain.push(item);};
    if(kind==='filesystem'){push('directFiles');}
    else if(kind==='terminal'){push('terminal');}
    else if(kind==='project'){push('project');push('terminal');}
    else if(kind.endsWith('browser')){
      const engine=args.browserEngine??'other';
      // Explicit original profile only; never replace a denied browser extension
      // with a new headless profile or an exported credential.
      if(['chrome','edge','brave','chromium'].includes(engine)){push('browserExtension');if(engine==='chrome')push('chromeDevtools');}
      if(engine==='firefox')push('firefoxExtension');
      if(platform==='win32')push('windowsUia');
      if(platform==='linux'){push('linuxAtspi');push('waylandPortal');}
      push('windowObserve');push('cua');
    } else if(kind.endsWith('app')){
      // Existing windows use semantic inspection before any launcher.
      // A new app uses the verified installed owner catalog to start or reuse.
      if(kind==='new-app')push('appCatalog');
      if(platform==='win32')push('windowsUia');
      if(platform==='linux'){push('linuxAtspi');push('waylandPortal');}
      if(kind==='existing-app')push('appCatalog');
      push('windowObserve');push('cua');
    }
    // Capability to observe a UIA tree does not itself authorize invoke/set-value.
    // Both require a separate owner-native effect tool and proven readback.
    const qualified=activity==='observe'?chain:chain.map(item=>
      item.id==='windows-uia-winapp'&&item.status==='AVAILABLE'?
        {...item,status:'GATED',reason:'UIA_MUTATION_AND_READBACK_NOT_YET_QUALIFIED'}:item);
    const selected=choose(qualified);
    const requiresOwner=kind.includes('browser')||kind.includes('app');
    const originalLogin=args.preserveExistingLogin!==false;
    return {schema:1,target:kind,activity,platform,
      browserEngine:kind.includes('browser')?args.browserEngine??'other':null,
      routeOrder:qualified,selection:selected,
      authorization:requiresOwner?(s.owner.sameUserSessionVerified?'SAME_OWNER_VERIFIED':'SAME_OWNER_SESSION_PROOF_REQUIRED'):
        'COMMANDER_TOOL_POLICY_AND_OS_ACL_REQUIRED',
      existingAuthentication:originalLogin?'REUSE_ORIGINAL_OWNER_SESSION_ONLY':'NO_IMPLICIT_PROFILE_CLONE',
      note:requiresOwner&&selected.mode==='NO_AUTHORIZED_EFFECT_ROUTE'?
        'No existing user login was inspected; denial or unavailable route does not prove saved credentials absent':
        'Discovery only; use the selected existing Commander tool for a separate authorized, journaled effect',
      guarantees:noSecrets,effectPerformed:false,
      guiActionAuthorized:false,savedCredentialsInspected:false};
  }
  return {definitions:hybridControlToolDefinitions,
    async execute(name,args={}){assertInput(name,args);return name==='hybrid_control_status'?snapshot():plan(args);}};
}
