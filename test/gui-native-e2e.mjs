import { spawn } from 'node:child_process';
import { readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGuiController } from '../src/gui-tools-windows.mjs';

const root=path.resolve('.');
const dll=path.join(root,'test','gui-e2e-app','bin','Release','net10.0-windows','GuiE2EApp.dll');
const ready=path.join(root,'var','gui-e2e-ready.json');
const result=path.join(root,'var','gui-e2e-result.json');
await mkdir(path.dirname(ready),{recursive:true});
await rm(ready,{force:true});
await rm(result,{force:true});
const child=spawn('dotnet',[dll,ready,result],{cwd:root,windowsHide:false,stdio:['ignore','ignore','pipe']});
let err='';
child.stderr.on('data',c=>err+=c.toString());
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitJson(file,ms=10000){
  const until=Date.now()+ms;
  while(Date.now()<until){
    try{return JSON.parse(await readFile(file,'utf8'));}catch{}
    await sleep(100);
  }
  throw new Error('timeout waiting for '+file+' stderr='+err);
}
const app=await waitJson(ready);
const ctx={config:{powerMode:{enabled:true,guiControl:{
  enabled:true,allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true,
  maxScreenshotWidth:1000,maxScreenshotBytes:2097152
}}}};
const c=createGuiController();
let lease;
let originalCursor;
try {
  console.error('E2E_STEP status');
  const status=await c.execute(ctx,'gui_status',{});
  if(!status.available) throw new Error('GUI not available');
  console.error('E2E_STEP lease');
  ({lease}=await c.execute(ctx,'gui_session_begin',{ttlSeconds:60}));
  console.error('E2E_STEP cursor');
  originalCursor=await c.execute(ctx,'gui_cursor_position',{lease});

  console.error('E2E_STEP screenshot-initial');
  let shot=await c.execute(ctx,'gui_screenshot',{lease,screenIndex:0,format:'jpeg',quality:60,maxWidth:1000});
  const before=shot.__structuredContent;
  const hashBefore=createHash('sha256').update(Buffer.from(shot.__mcpContent[0].data,'base64')).digest('hex');
  const originalForeground=before.snapshot.foreground;
  let interactionFrame=before;
  if(before.snapshot.foreground!==app.handle){
    console.error('E2E_STEP focus-window');
    await c.execute(ctx,'gui_focus_window',{
      lease,frame:before.frame,handle:app.handle
    });
    console.error('E2E_STEP screenshot-focused');
    shot=await c.execute(ctx,'gui_screenshot',{lease,screenIndex:0,format:'jpeg',quality:60,maxWidth:1000});
    interactionFrame=shot.__structuredContent;
    if(interactionFrame.snapshot.foreground!==app.handle){
      throw new Error('E2E focus verification failed: expected '+app.handle+' got '+interactionFrame.snapshot.foreground);
    }
  }
  console.error('E2E_STEP click-textbox');
  await c.execute(ctx,'gui_mouse_click',{
    lease,frame:interactionFrame.frame,x:app.textX,y:app.textY,button:'left',clicks:1,intervalMs:80
  });

  shot=await c.execute(ctx,'gui_screenshot',{lease,screenIndex:0,format:'jpeg',quality:60,maxWidth:1000});
  if(shot.__structuredContent.snapshot.foreground!==app.handle){
    throw new Error('E2E click did not retain target window: expected '+app.handle+' got '+shot.__structuredContent.snapshot.foreground);
  }
  const marker='GUI_E2E_PASS_سلام_日本語_123';
  console.error('E2E_STEP type-text');
  await c.execute(ctx,'gui_type_text',{
    lease,frame:shot.__structuredContent.frame,text:marker,intervalMs:1
  });

  shot=await c.execute(ctx,'gui_screenshot',{lease,screenIndex:0,format:'jpeg',quality:60,maxWidth:1000});
  console.error('E2E_STEP click-button');
  await c.execute(ctx,'gui_mouse_click',{
    lease,frame:shot.__structuredContent.frame,x:app.buttonX,y:app.buttonY,button:'left',clicks:1,intervalMs:80
  });

  console.error('E2E_STEP wait-result');
  const applied=await waitJson(result,5000);
  await sleep(150);
  shot=await c.execute(ctx,'gui_screenshot',{lease,screenIndex:0,format:'jpeg',quality:60,maxWidth:1000});
  const after=shot.__structuredContent;
  const hashAfter=createHash('sha256').update(Buffer.from(shot.__mcpContent[0].data,'base64')).digest('hex');
  const verified=applied.ok===true && applied.text===marker && hashBefore!==hashAfter;

  console.error('E2E_STEP restore-cursor');
  await c.execute(ctx,'gui_mouse_move',{
    lease,frame:after.frame,x:originalCursor.x,y:originalCursor.y
  });

  let focusRestored = originalForeground===app.handle;
  let focusRestoreError = null;
  if(!focusRestored){
    try {
      console.error('E2E_STEP screenshot-before-focus-restore');
      shot=await c.execute(ctx,'gui_screenshot',{lease,screenIndex:0,format:'jpeg',quality:50,maxWidth:800});
      console.error('E2E_STEP restore-focus');
      await c.execute(ctx,'gui_focus_window',{
        lease,frame:shot.__structuredContent.frame,handle:originalForeground
      });
      focusRestored=true;
    } catch(error) {
      focusRestoreError=error?.guiCode || error?.message || 'GUI_FOCUS_RESTORE_FAILED';
      console.error('E2E_CLEANUP_FOCUS_NOT_RESTORED '+focusRestoreError);
    }
  }

  console.log(JSON.stringify({
    verified,
    marker,
    applied,
    cursorStart:{x:originalCursor.x,y:originalCursor.y},
    screenshotBefore:{sha256:hashBefore,width:before.width,height:before.height,bytes:before.bytes},
    screenshotAfter:{sha256:hashAfter,width:after.width,height:after.height,bytes:after.bytes},
    originalForeground,
    focusRestored,
    focusRestoreError,
    app
  },null,2));
  if(!verified) process.exitCode=2;
} finally {
  if(lease){try{await c.execute(ctx,'gui_session_end',{lease});}catch{}}
  child.kill();
  await rm(ready,{force:true});
}
