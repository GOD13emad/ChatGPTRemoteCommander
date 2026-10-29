// Chat-owned operator facade. This module is NOT a second planner, executor, lock or permission authority.
// It reports real routes and advances at most one already-enrolled step through the existing Project Engine.
const readOnly = Object.freeze({readOnlyHint:true,destructiveHint:false,openWorldHint:false});
const effect = Object.freeze({readOnlyHint:false,destructiveHint:true,openWorldHint:false,idempotentHint:false});
const empty = {type:'object',properties:{},additionalProperties:false};
const runIdSchema = {type:'string',minLength:1,maxLength:64,pattern:'^[a-z][a-z0-9_-]{0,63}$'};
const routeKinds = ['project','file','shell','owned_browser','user_browser','desktop','release'];
export const operatorToolDefinitions = Object.freeze([
  {
    name:'operator_status',
    description:'Primary Commander operator readout: current project, browser, GUI and host route readiness. Read-only; never grants OS access.',
    inputSchema:empty,annotations:readOnly
  },
  {
    name:'operator_route',
    description:'Plan one operator action through an existing authorized Commander subsystem, without executing it. Distinguishes owner-session consent from isolated-browser permission.',
    inputSchema:{type:'object',properties:{kind:{type:'string',enum:routeKinds}},required:['kind'],additionalProperties:false},
    annotations:readOnly
  },
  {
    name:'operator_advance',
    description:'Advance at most one step of an already-enrolled bounded project run through the existing Workflow Engine. Requires a stable requestId; never opens GUI or bypasses the project approval gates.',
    inputSchema:{type:'object',properties:{
      runId:runIdSchema,
      requestId:{type:'string',minLength:1,maxLength:128,pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'}
    },required:['runId','requestId'],additionalProperties:false},annotations:effect
  }
]);

function safeCode(error) {
  const code = error?.browserCode ?? error?.workflowCode ?? error?.guiCode ?? error?.code;
  return typeof code==='string' && /^[A-Z][A-Z0-9_]{2,100}$/.test(code) ? code : 'STATUS_UNAVAILABLE';
}
async function boundedRead(read, disabled) {
  if(typeof read!=='function')return {ok:false,reason:disabled};
  try{return {ok:true,value:await read()};}
  catch(error){return {ok:false,reason:safeCode(error)};}
}
const unavailable = (reason, next=[])=>({state:'BLOCKED',reason,next});
const gated = (reason, next=[])=>({state:'GATED',reason,next});
const ready = (reason, next=[])=>({state:'READY',reason,next});

/**
 * One operator API contract on Windows Desktop, Linux Desktop and Headless.
 * Actual execution remains with the ChatGPT conversation, existing WorkflowStore,
 * existing native browser/GUI tools, and native OS/session authorization.
 */
export function createOperatorCore({config={},platform=process.platform,toolNames=()=>[],
  readWorkflow,readBrowser,readGui,advance}={}) {
  const names=()=>new Set(toolNames());
  async function status() {
    const [workflow,browser,gui]=await Promise.all([
      boundedRead(readWorkflow,'WORKFLOW_DISABLED'),
      boundedRead(readBrowser,'BROWSER_DISABLED'),
      boundedRead(readGui,'GUI_DISABLED')
    ]);
    const wf=workflow.ok?workflow.value:{},br=browser.ok?browser.value:{},g=gui.ok?gui.value:{};
    const browserPolicy=config.powerMode?.browserControl??{};
    const existingRequired=br.policy?.requireExistingUserSession??(browserPolicy.requireExistingUserSession!==false);
    const isolatedAllowed=existingRequired===false ||
      (browserPolicy.allowOwnedIsolatedSession===true && br.policy?.allowOwnedIsolatedSession===true);
    const catalog=names();
    return {
      schema:1,
      operator:'CHAT_OWNED',
      architecture:'SINGLE_EXISTING_COMMANDER_EXECUTOR',
      platform,
      workflow:{
        available:workflow.ok && wf.enabled===true,
        runnerConfigured:workflow.ok && wf.runnerConfigured===true,
        automaticExecution:workflow.ok && wf.automaticExecution===true,
        reason:workflow.ok?null:workflow.reason
      },
      browser:{
        available:browser.ok && br.available===true,
        backend:typeof br.backend==='string'?br.backend:'',
        ownedIsolatedAllowed:browser.ok && br.available===true && isolatedAllowed,
        existingUserSessionRequired:existingRequired,
        reason:browser.ok?null:browser.reason
      },
      desktop:{
        available:gui.ok && g.available===true,
        backend:typeof g.backend==='string'?g.backend:'',
        ownerSessionConsentRequired:true,
        reason:gui.ok?null:gui.reason
      },
      routes:{
        filesystem:catalog.has('read_text')&&catalog.has('write_text'),
        shell:catalog.has('run_shell')&&config.powerMode?.enabled===true&&config.powerMode?.allowShell===true,
        workflow:catalog.has('workflow_run_tick')&&workflow.ok&&wf.runnerConfigured===true,
        nativeWorkspace:catalog.has('workspace_target_list'),
        browser:catalog.has('browser_session_begin'),
        updater:catalog.has('system_status')
      },
      guarantees:{
        crossUserSessionAccess:false,
        universalAdminOrRoot:false,
        autonomousUnenrolledRuns:false,
        uncertainEffectBlindReplay:false,
        nativeOSPermissionsApply:true
      }
    };
  }
  async function route(kind) {
    if(!routeKinds.includes(kind))throw Object.assign(new Error('OPERATOR_KIND_INVALID'),{operatorCode:'OPERATOR_KIND_INVALID'});
    const s=await status();
    const r=s.routes;
    let verdict;
    switch(kind) {
      case 'project':
        verdict=!r.workflow?unavailable('PROJECT_RUNNER_NOT_CONFIGURED',['workflow_status'])
          :gated('EXPLICIT_PROJECT_ENROLLMENT_REQUIRED',['workflow_create','workflow_run_start','operator_advance']);
        break;
      case 'file':
        verdict=r.filesystem?ready('SCOPED_FILESYSTEM_TOOLS',['list_directory','read_text','write_text'])
          :unavailable('FILESYSTEM_TOOLS_UNAVAILABLE');
        break;
      case 'shell':
        verdict=r.shell?gated('OS_PERMISSIONS_AND_COMMAND_POLICY_APPLY',['run_shell','operation_start'])
          :unavailable('SHELL_POLICY_OR_TOOL_UNAVAILABLE');
        break;
      case 'owned_browser':
        verdict=!r.browser||!s.browser.available?unavailable('BROWSER_BACKEND_UNAVAILABLE',['browser_status'])
          :s.browser.ownedIsolatedAllowed?ready('COMMANDER_OWNED_EPHEMERAL_PROFILE_ONLY',['browser_session_begin','browser_navigate','browser_snapshot','browser_session_end'])
          :unavailable('EXISTING_USER_SESSION_POLICY_BLOCKS_ISOLATED_PROFILE',['browser_status','operator_route']);
        break;
      case 'user_browser':
        verdict=!r.nativeWorkspace?unavailable('WORKSPACE_TOOLS_NOT_EXPOSED')
          :gated('OWNER_SESSION_AUTHORIZATION_REQUIRED',['workspace_target_list','workspace_target_open','workspace_target_snapshot']);
        break;
      case 'desktop':
        verdict=!s.desktop.available?unavailable('GUI_SESSION_UNAVAILABLE',['gui_status'])
          :gated('CURRENT_USER_SESSION_CONSENT_AND_FRESH_TARGET_REQUIRED',['workspace_target_list','workspace_target_open','workspace_target_snapshot']);
        break;
      case 'release':
        verdict=gated('EXACT_BUILD_CI_NATIVE_INSTALL_AND_ACCEPTANCE_REQUIRED',['system_status','workflow_health']);
        break;
    }
    return {schema:1,kind,operator:'CHAT_OWNED',...verdict};
  }
  async function execute(name,args={}) {
    switch(name){
      case 'operator_status': return status();
      case 'operator_route': return route(args.kind);
      case 'operator_advance': {
        if(typeof args.runId!=='string'||!runIdSchema.pattern||!new RegExp(runIdSchema.pattern).test(args.runId))
          throw Object.assign(new Error('OPERATOR_RUN_ID_INVALID'),{operatorCode:'OPERATOR_RUN_ID_INVALID'});
        if(typeof advance!=='function')throw Object.assign(new Error('OPERATOR_RUNNER_UNAVAILABLE'),{operatorCode:'OPERATOR_RUNNER_UNAVAILABLE'});
        const s=await status();
        if(!s.routes.workflow)throw Object.assign(new Error('OPERATOR_RUNNER_UNAVAILABLE'),{operatorCode:'OPERATOR_RUNNER_UNAVAILABLE'});
        // Only the existing Project Engine may authorize and journal the next effect.
        return advance(args.runId);
      }
      default: throw Object.assign(new Error('OPERATOR_TOOL_UNKNOWN'),{operatorCode:'OPERATOR_TOOL_UNKNOWN'});
    }
  }
  return {definitions:operatorToolDefinitions,execute};
}
