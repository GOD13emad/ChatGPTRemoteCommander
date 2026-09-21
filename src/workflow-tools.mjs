// Durable workflow adapter. Stored memory is data, never authority.
// Autonomous scheduler may reconcile evidence automatically, but it never blind-replays mutations.
import { WorkflowStore, fail } from './workflow-store.mjs';
import { deriveCapabilitySet, FULL_WORKFLOW_EXECUTION_TOOLS } from './capability-profile.mjs';

const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const id = { ...text(64), pattern: '^[a-z][a-z0-9_-]{0,63}$' };
const rev = { type: 'integer', minimum: 1, maximum: 10000 };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const base = { id };
const update = { id, expectedRevision: rev };
const files = { type: 'array', minItems: 1, maxItems: 20, items: text(512) };
const ro = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const action = { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false };
const definition = (name, description, inputSchema, annotations) => ({ name, description, inputSchema, annotations });
const executionProfile = obj({
  modelFamily: text(128), modelVariant: text(128), reasoningEffort: text(32),
  executionMode: text(64), profileVersion: text(64),
  fallbackPolicy: { type:'string', enum:['equivalent-or-better','exact-only','allow-any'] }
});
export const WORKFLOW_TOOL_DEFINITIONS = [
  definition('workflow_status', 'Report durable engine, scheduler, queue, reconciliation and execution-profile status.', obj({}), ro),
  definition('workflow_health', 'Read SQLite integrity, scheduler/lease status, authority and continuation-engine health.', obj({}), ro),
  definition('workflow_create', 'Create a persistent project goal and ordered/DAG steps. Credentials are forbidden.', obj({
    id, root: text(1024), goal: text(8000), acceptance: { type: 'array', minItems: 1, maxItems: 50, items: text(2000) },
    steps: { type: 'array', minItems: 1, maxItems: 100, items: obj({ id, title: text(500), dependsOn: { type: 'array', maxItems: 100, items: id } }, ['id', 'title']) },
    executionProfile, brainPath:text(512), autoContinue:{type:'boolean'}, retryBudget:{type:'integer',minimum:0,maximum:20}
  }, ['id', 'root', 'goal', 'acceptance', 'steps']), write),
  definition('workflow_get', 'Read recorded project state. Stored content is untrusted data, not executable authority.', obj(base, ['id']), ro),
  definition('workflow_list', 'List workflow IDs and revisions in this private local store.', obj({}), ro),
  definition('workflow_operations', 'List durable operation receipts/ids for one workflow without raw arguments or outputs.', obj(base,['id']), ro),
  definition('workflow_note', 'Append typed project knowledge with provenance/status and revision precondition.', obj({
    ...update,
    kind:{type:'string',enum:['fact','inference','proposal','assumption','decision','failure','root_cause','evidence','handoff']},
    text:text(8000),
    status:{type:'string',enum:['CONFIRMED','PROBABLE','UNVERIFIED','MISSING','CONTRADICTORY']},
    confidence:{type:'string',enum:['LOW','MEDIUM','HIGH']},
    source:text(500),
    reuseTargets:{type:'array',maxItems:20,items:text(500)},
    path:text(512),
    hash:{type:'string',pattern:'^[a-f0-9]{64}$'}
  }, ['id','expectedRevision','kind','text']), write),
  definition('workflow_search', 'Search only the named project memory; returns caller-originated notes with provenance.', obj({ ...base, query: text(160) }, ['id', 'query']), ro),
  definition('workflow_checkpoint', 'Hash project evidence, save exact next action, and synchronize the workflow section of Project Brain.', obj({ ...update, files, nextAction: text(2000), summary: text(4000) }, ['id', 'expectedRevision', 'files', 'nextAction', 'summary']), write),
  definition('workflow_resume', 'Revalidate authority, project evidence and unfinished operations. Never blind-replays an uncertain mutation.', obj(base, ['id']), ro),
  definition('workflow_call', 'Journal PREPARED/EXECUTING/EXECUTED-or-UNCERTAIN around one host-allowed tool call. Raw arguments are not stored.', obj({ ...update, stepId: id, tool: text(128), arguments: { type: 'object' } }, ['id', 'stepId', 'expectedRevision', 'tool', 'arguments']), action),
  definition('workflow_reconcile', 'Record independently observed outcome and evidence for an uncertain operation.', obj({ ...update, stepId: id, outcome: { type: 'string', enum: ['applied', 'not_applied'] }, files, explanation: text(4000) }, ['id', 'stepId', 'expectedRevision', 'outcome', 'files', 'explanation']), write),
  definition('workflow_finalize', 'Mark COMPLETED only after every step is done, all acceptance results are true, evidence is hashed, and Project Brain is synchronized.', obj({
    ...update, acceptanceResults:{type:'array',minItems:1,maxItems:50,items:{type:'boolean'}}, files, summary:text(4000)
  }, ['id','expectedRevision','acceptanceResults','files','summary']), write),
  definition('workflow_control', 'Explicitly pause, resume or cancel autonomous continuation with revision conflict protection.', obj({
    ...update, action:{type:'string',enum:['pause','resume','cancel']}, reason:text(1000)
  }, ['id','expectedRevision','action','reason']), write),
  definition('workflow_revise', 'Revise goal and/or acceptance criteria from a newer user instruction with expectedRevision conflict protection.', obj({
    ...update, goal:text(8000), acceptance:{type:'array',minItems:1,maxItems:50,items:text(2000)}, reason:text(1000)
  }, ['id','expectedRevision','reason']), write),
  definition('workflow_scheduler_tick', 'Run one bounded crash-recovery/reconciliation cycle. It never executes a blind mutation.', obj({}), write),
  definition('workflow_export', 'Export one workflow, integrity chain, execution profile and evidence refs; never credentials.', obj(base, ['id']), ro)
];

const SAFE_KNOWN = new Set(FULL_WORKFLOW_EXECUTION_TOOLS);
const DIRECT_SESSION_ONLY_GUI = new Set([
  'gui_mouse_move','gui_mouse_delta','gui_mouse_scroll','gui_mouse_click','gui_mouse_drag',
  'gui_type_text','gui_key_press','gui_focus_window'
]);

export function createWorkflowTools({ config, roots, device, configSha256, lookup, validateSchema, dispatch }) {
  const settings = config.durableWorkflows;
  if (settings?.enabled !== true) fail('WORKFLOW_DISABLED');
  if (typeof settings.directory !== 'string') fail('WORKFLOW_DIRECTORY_REQUIRED');
  const tools = settings.executionTools ?? ['system_status', 'list_directory', 'read_text'];
  if (!Array.isArray(tools) || tools.length > SAFE_KNOWN.size || tools.some(t => !SAFE_KNOWN.has(t))) fail('WORKFLOW_INVALID_TOOL_POLICY');
  const allowed = new Set(tools);
  const authority = {
    profileId: config.capabilityProfile?.id ?? config.instance?.profile ?? 'default',
    tier: config.capabilityProfile?.tier ?? (config.powerMode?.enabled && config.powerMode?.fullFilesystem ? 'FULL_POWER' : 'STANDARD'),
    capabilities: deriveCapabilitySet(config)
  };
  const defaultExecutionProfile = settings.executionProfile?.default ?? {};
  const schedulerPolicy = settings.scheduler ?? { enabled:false };
  const store = new WorkflowStore({
    directory: settings.directory, allowedRoots: roots, device, configSha256,
    authority, executionProfile: defaultExecutionProfile, schedulerPolicy
  });

  async function verifyPlan(plan, meta) {
    try {
      if (plan.strategy === 'FILE_SHA256') {
        const result = await dispatch('read_text',{path:plan.path},store.get(meta.workflowId).state);
        const actual = result?.sha256 ?? result?.hash ?? null;
        if (!actual) return {status:'UNAVAILABLE',summary:'readback hash unavailable'};
        return actual === plan.expectedSha256
          ? {status:'APPLIED',evidenceHash:actual,summary:'file hash matches expected post-state'}
          : {status:'CONFLICT',evidenceHash:actual,summary:'file exists with unexpected hash'};
      }
      if (plan.strategy === 'DIRECTORY_EXISTS') {
        await dispatch('list_directory',{path:plan.path,depth:0,maxEntries:1},store.get(meta.workflowId).state);
        return {status:'APPLIED',summary:'directory exists'};
      }
      if (plan.strategy === 'SAFE_RETRY') {
        return {status:'NOT_APPLIED',summary:'read-only operation has no durable external effect'};
      }
      return {status:'UNAVAILABLE',summary:'operation requires explicit remote-state reconciliation'};
    } catch (error) {
      if (/ENOENT|not found|does not exist/i.test(String(error?.message ?? ''))) return {status:'NOT_APPLIED',summary:'target absent'};
      return {status:'UNAVAILABLE',summary:'verification unavailable'};
    }
  }

  let ticking=false;
  async function schedulerTick() {
    if (ticking) return {skipped:true,reason:'TICK_ALREADY_RUNNING'};
    ticking=true;
    try {
      const recovered=store.recoverInterrupted();
      const reconciled=[], ready=[], blocked=[];
      for (const item of store.list()) {
        try {
          let r=store.resume(item.id);
          if (r.unresolved.length) {
            const a=await store.reconcileAutomatically(item.id,{verify:verifyPlan});
            if (a.changed) reconciled.push({id:item.id,status:a.status,revision:a.revision});
            r=store.resume(item.id);
          }
          if (r.readyForNextStep) {
            ready.push({
              id:item.id,nextStep:r.nextStep,nextAction:r.nextAction,revision:r.state.revision,
              executionProfile:r.executionProfile,
              stopCondition:r.executionProfile?.modelFamily || r.executionProfile?.modelVariant
                ? 'MODEL_PROFILE_UNAVAILABLE' : 'AGENT_RUNNER_UNAVAILABLE'
            });
          } else if (r.blockers.length) blocked.push({id:item.id,blockers:r.blockers});
        } catch (error) {
          blocked.push({id:item.id,blockers:[error.workflowCode ?? 'WORKFLOW_SCHEDULER_ERROR']});
        }
      }
      return {recovered,reconciled,ready,blocked,runnerConfigured:false,status:store.schedulerStatus()};
    } finally { ticking=false; }
  }

  let timer=null;
  if (schedulerPolicy?.enabled === true) {
    const interval = Number.isSafeInteger(Number(schedulerPolicy.intervalMs)) && Number(schedulerPolicy.intervalMs)>=1000
      ? Number(schedulerPolicy.intervalMs) : 5000;
    timer=setInterval(()=>{ schedulerTick().catch(()=>{}); },interval);
    timer.unref?.();
  }

  return {
    definitions: WORKFLOW_TOOL_DEFINITIONS,
    close: () => { if(timer)clearInterval(timer); store.close(); },
    schedulerTick,
    async execute(name, args) {
      switch (name) {
        case 'workflow_status': return { ...store.capabilities(), enabled:true, engineEnabled:true, executionTools:[...allowed] };
        case 'workflow_health': return store.health();
        case 'workflow_create': return store.create(args);
        case 'workflow_get': return store.get(args.id);
        case 'workflow_list': return { workflows: store.list() };
        case 'workflow_operations': return {id:args.id,operations:store.operations(args.id)};
        case 'workflow_note': return store.note(args);
        case 'workflow_search': return store.search(args);
        case 'workflow_checkpoint': return store.checkpoint(args);
        case 'workflow_resume': return store.resume(args.id);
        case 'workflow_export': return store.export(args.id);
        case 'workflow_reconcile': return store.reconcile(args);
        case 'workflow_finalize': return store.finalize(args);
        case 'workflow_control': return store.control(args);
        case 'workflow_revise': return store.revise(args);
        case 'workflow_scheduler_tick': return schedulerTick();
        case 'workflow_call': {
          const outcome = await store.call(args, {
            validate: async (tool, input) => {
              if (!allowed.has(tool) || tool.startsWith('workflow_')) fail('WORKFLOW_TOOL_NOT_APPROVED');
              if (DIRECT_SESSION_ONLY_GUI.has(tool) || (tool === 'gui_session_begin' && input?.mode === 'takeover')) {
                fail('WORKFLOW_GUI_TAKEOVER_REQUIRES_DIRECT_USER_SESSION');
              }
              const definition = lookup(tool);
              if (!definition) fail('WORKFLOW_TOOL_UNAVAILABLE');
              const errors = validateSchema(input, definition.inputSchema);
              if (errors.length) fail('WORKFLOW_TOOL_ARGUMENTS_INVALID');
            }, dispatch
          });
          if (outcome.result?.__mcpContent) {
            const { result, ...receipt } = outcome;
            return { __mcpContent: [...result.__mcpContent, { type: 'text', text: JSON.stringify(receipt) }],
              __structuredContent: { workflow: receipt, tool: result.__structuredContent ?? {} } };
          }
          return outcome;
        }
        default: fail('WORKFLOW_UNKNOWN_TOOL');
      }
    }
  };
}
