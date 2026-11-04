// Exact-tag CoS 2.1.50 isolated QA-only patch: one-level JSON-schema Goal planner.
// No V1/owner services, production binaries, credentials or browser state are modified.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const PINNED_TAG='11f7e92db9be74701c8b9c0f890280b206814846';
const PINNED_GOAL_SHA='728e16cee50a70e6ecdc9a6f41e4006506f4a986ba6eed3890194bc9c794fc90';
const digest=b=>createHash('sha256').update(b).digest('hex');
const fail=x=>{throw Error('COS_LOCAL_PLAN_QA_'+x);};
function replaceOnce(s,a,b){
 if(s.split(a).length!==2)fail('ANCHOR_MISMATCH');
 return s.replace(a,b);
}
export function applyLocalPlanQa(root){
 if(typeof root!=='string'||!path.isAbsolute(root))fail('ABSOLUTE_ROOT_REQUIRED');
 const dir=path.resolve(root),p=path.join(dir,'src/main/goal.ts');
 const marker=path.join(dir,'.commander-v2-isolated-qa');
 for(const f of [dir,p,marker]){
  const st=fs.lstatSync(f);
  if(st.isSymbolicLink())fail('SYMLINK_DENIED');
 }
 if(fs.readFileSync(marker,'utf8')!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')fail('QA_MARKER_REQUIRED');
 const repo=spawnSync('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8',timeout:5000});
 if(repo.status!==0||repo.stdout.trim()!==PINNED_TAG)fail('UPSTREAM_TAG_MISMATCH');
 const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
 if(pkg.name!=='chat-on-steroids'||pkg.version!=='2.1.50')fail('VERSION_MISMATCH');
 const original=fs.readFileSync(p),before=digest(original);
 if(before!==PINNED_GOAL_SHA)fail('GOAL_SOURCE_CHANGED_OR_ALREADY_PATCHED');
 let next=original.toString('utf8');
 const payload=[
  "/* QA: a one-level planner schema avoids nested JSON escaping failures from small local models. */",
  "const LOCAL_PLAN_RESPONSE_FORMAT = {",
  " type:'json_schema',json_schema:{name:'goal_workflow_plan',strict:true,schema:{",
  "  type:'object',properties:{",
  "   action:{type:'string',enum:['continue']},",
  "   stages:{type:'array',items:{type:'string'},minItems:2,maxItems:12}",
  "  },required:['action','stages'],additionalProperties:false",
  " }}} as const;",
  "const LOCAL_PLAN_OUTPUT_PROTOCOL = 'Return only one JSON object with action continue and a stages array. Provide 2 to 12 text stages directly as strings, not a JSON-encoded string in reply. No reply field and no execution claims.';",
  "const LOCAL_PLAN_JSON_IN_WORDS = 'Return exactly one JSON object, no markdown or reasoning: {\"action\":\"continue\",\"stages\":[\"complete implementation stage\",\"verification stage\"]}. Do not include a reply field.';",
  ""
 ].join('\n');
 next=replaceOnce(next,'const LOOP_OUTPUT_PROTOCOL =',payload+'\nconst LOOP_OUTPUT_PROTOCOL =');
 next=replaceOnce(next,
  "  const schema = request.mode === 'loop' ? LOOP_RESPONSE_FORMAT : GOAL_RESPONSE_FORMAT;",
  "  const directPlan = request.lifetime === 'temporary-planner' && request.endpoint.kind === 'custom';\n  const schema = directPlan ? LOCAL_PLAN_RESPONSE_FORMAT : request.mode === 'loop' ? LOOP_RESPONSE_FORMAT : GOAL_RESPONSE_FORMAT;");
 next=replaceOnce(next,
  "      { role: 'system', content: protocolFor(request) },",
  "      { role: 'system', content: directPlan ? LOCAL_PLAN_OUTPUT_PROTOCOL : protocolFor(request) },");
 next=replaceOnce(next,
  "body['messages'] = format === 'json_schema' ? messages : [...messages, { role: 'system', content: jsonInWords(request.mode) }];",
  "body['messages'] = format === 'json_schema' ? messages : [...messages, { role: 'system', content: directPlan ? LOCAL_PLAN_JSON_IN_WORDS : jsonInWords(request.mode) }];");
 next=replaceOnce(next,
  "  const completion = await readGoalCompletion(response, request.publish);\n  return normalizeGoalDecision(completion.text, completion.legacy);",
  [
  "  const completion = await readGoalCompletion(response, request.publish);",
  "  if(directPlan){",
  "   const candidate = decisionObjectIn(completion.text.trim());",
  "   if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))",
  "    return {action:'invalid',error:'invalid_plan_decision_schema'};",
  "   const item=candidate as Record<string,unknown>;",
  "   // Legacy custom endpoints that ignore schema remain strictly validated by the old path.",
  "   if(Object.keys(item).every(k=>k==='action'||k==='reply'))",
  "    return normalizeGoalDecision(completion.text,completion.legacy);",
  "   if(Object.keys(item).some(k=>k!=='action'&&k!=='stages')||item.action!=='continue'||",
  "      !Array.isArray(item.stages)||item.stages.length<2||item.stages.length>12||",
  "      item.stages.some(s=>typeof s!=='string'||!s.trim()||s.length>16000||",
  "        s.includes('<|')||s.includes('|>')||UNSAFE_REASONING_TAG.test(s)||",
  "        NO_REPLY_TOKEN.test(s)||NO_REPLY.test(s))||",
  "      JSON.stringify(item.stages).length>12000)",
  "    return {action:'invalid',error:'invalid_plan_decision_schema'};",
  "   // JS serialization, not the model, escapes nested quotes before the existing guard.",
  "   return normalizeGoalDecision(JSON.stringify({action:'continue',",
  "    reply:JSON.stringify({stages:item.stages})}),false);",
  "  }",
  "  return normalizeGoalDecision(completion.text, completion.legacy);"
  ].join('\n'));
 const backup=p+'.qa-rollback-'+PINNED_GOAL_SHA.slice(0,12),tmp=p+'.qa-stage-'+process.pid;
 if(fs.existsSync(backup)||fs.existsSync(tmp))fail('BACKUP_OR_STAGE_COLLISION');
 fs.writeFileSync(backup,original,{mode:0o600,flag:'wx'});
 let promoted=false;
 try{
  fs.writeFileSync(tmp,next,{mode:0o600,flag:'wx'});
  if(digest(fs.readFileSync(p))!==PINNED_GOAL_SHA)fail('CONCURRENT_SOURCE_CHANGE');
  fs.renameSync(tmp,p);promoted=true;
  const current=digest(fs.readFileSync(p));
  if(current!==digest(Buffer.from(next)))fail('READBACK_MISMATCH');
  return {status:'COS_LOCAL_PLAN_SCHEMA_QA_PATCHED',beforeSHA256:before,afterSHA256:current,rollbackPath:backup};
 }catch(e){
  if(promoted&&digest(fs.readFileSync(p))===digest(Buffer.from(next)))fs.writeFileSync(p,original);
  throw e;
 }finally{try{fs.rmSync(tmp,{force:true});}catch{}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(applyLocalPlanQa(process.argv[2])));}
 catch(e){console.error(String(e?.message??e));process.exitCode=2;}
}
