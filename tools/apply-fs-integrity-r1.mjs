// Narrow F1 revision: exact baseline, missing-file hash preconditions + recovery copy retention.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const baseline='402b9f4110f0c27bc7da3059f956df309048ca53';
const digest=s=>createHash('sha256').update(s).digest('hex');
const paths=['src/tools-v0.3.mjs','src/power-tools-v0.3.mjs'];
const output=[];
for(const file of paths){
 const raw=fs.readFileSync(file,'utf8'),source=raw.replaceAll('\r\n','\n');
 const original=execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'}).replaceAll('\r\n','\n');
 if(source!==original)throw Error('FS_BASELINE_MISMATCH');
 const name=file.includes('power-')?'writeAnyFile':'writeText';
 const start=source.indexOf(`export async function ${name}(`),end=source.indexOf('\nexport async function ',start+1);
 if(start<0||end<0)throw Error('FS_FUNCTION_ANCHOR');
 let body=source.slice(start,end);
 const anchor="      if (error?.code !== 'ENOENT') throw error;\n";
 if(body.split(anchor).length!==2)throw Error('FS_CATCH_ANCHOR');
 body=body.replace(anchor,anchor+"      if (input.expectedSha256 !== undefined) throw new Error('expectedSha256 precondition failed: target does not exist');\n");
 const open=body.indexOf('{\n');
 body=body.slice(0,open+2)+"  if (input.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.expectedSha256)) throw new Error('expectedSha256 must be a lowercase 64-hex SHA-256');\n"+body.slice(open+2);
 if(name==='writeAnyFile'){
  const mk="    if (input.createParents !== false) await mkdir(path.dirname(target), { recursive: true });\n";
  if(body.split(mk).length!==2)throw Error('FS_MKDIR_ANCHOR');body=body.replace(mk,'');
  const b='    const backupPath = await backupExisting(ctx, target);';body=body.replace(b,mk+b);
 }
 let updated=source.slice(0,start)+body+source.slice(end);
 if(name==='writeAnyFile'){
  const startMove=updated.indexOf('export async function movePath('),endMove=updated.indexOf('export async function deletePath(',startMove);
  let move=updated.slice(startMove,endMove);
  const once=(a,b)=>{if(move.split(a).length!==2)throw Error('MOVE_ANCHOR');move=move.replace(a,b);};
  once('    let promoted = false;','    let promoted = false;\n    let sourceDeletionStarted = false;');
  once('      await rm(sourceNow, { recursive: true, force: true });','      sourceDeletionStarted = true;\n      await rm(sourceNow, { recursive: true, force: true });');
  once('    } catch (error) {\n      try { await rm(stage,',`    } catch (error) {
      if (promoted && sourceDeletionStarted) {
        // Source deletion may have removed SOME entries before failing. The
        // destination is now the only complete copy. Never delete it to restore
        // an overwritten target; keep displaced/backup copies for reconciliation.
        const recovery = { source: sourceNow, destination: destinationNow,
          displaced: displacedExists ? displaced : null, backupPath,
          destinationPreserved: true, sourceMayBePartial: true };
        throw Object.assign(new Error('MOVE_RECOVERY_REQUIRED ' + JSON.stringify(recovery)), { recovery, cause: error });
      }
      try { await rm(stage,`);
  updated=updated.slice(0,startMove)+move+updated.slice(endMove);
 }
 fs.writeFileSync(file,updated,'utf8');output.push({file,before:digest(raw),after:digest(updated)});
}
console.log(JSON.stringify({revision:'F1-file-integrity',changes:output,productionPromotion:false}));
