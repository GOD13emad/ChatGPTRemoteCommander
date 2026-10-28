// Explicit, application-scoped Workspace Target route for existing owner desktop windows.
// This never opens another browser, copies a profile, reads cookies, or bypasses native GUI guards.
const obj=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const text=(n=128)=>({type:'string',minLength:1,maxLength:n});
const processId={type:'integer',minimum:1,maximum:2147483647};
const handle={type:'string',pattern:'^[1-9][0-9]{0,18}$'};
const target={processId,handle};
const bound={...target,lease:text(),frame:text()};
const read={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
const coordinate={readOnlyHint:false,destructiveHint:false,openWorldHint:false};
const mutate={readOnlyHint:false,destructiveHint:true,openWorldHint:true};
const def=(name,description,inputSchema,annotations)=>({name,description,inputSchema,annotations});
export const workspaceTargetDefinitions=[
 def('workspace_target_list','List windows of an already running application on this same owner session. Does not launch browsers or access profiles.',obj({application:{type:'string',enum:['firefox','all']}}),read),
 def('workspace_target_open','Bind a short-lived native GUI lease to an exact existing window (pid+handle). Takeover requires explicit current-user authorization.',obj({...target,mode:{type:'string',enum:['observe','takeover']},explicitUserAuthorization:text(500)},['processId','handle']),coordinate),
 def('workspace_target_snapshot','Check exact window identity and capture a fresh desktop frame for that native GUI lease.',obj({...target,lease:text()},['processId','handle','lease']),read),
 def('workspace_target_focus','Focus only the exact existing observed window with a fresh one-use frame; native GUI takeover policy still applies.',obj(bound,['processId','handle','lease','frame']),mutate),
 def('workspace_target_click','Click only when the exact existing window is currently focused, with a fresh native frame.',obj({...bound,x:{type:'number',minimum:-65536,maximum:65536},y:{type:'number',minimum:-65536,maximum:65536}},['processId','handle','lease','frame','x','y']),mutate),
 def('workspace_target_type','Type literal text only when the exact existing window is currently focused, with a fresh native frame.',obj({...bound,text:{type:'string',minLength:1,maxLength:1024}},['processId','handle','lease','frame','text']),mutate),
 def('workspace_target_end','Release only the provided native GUI lease.',obj({lease:text()},['lease']),coordinate)
];
function reject(code){throw Object.assign(new Error('WORKSPACE_TARGET_'+code),{rpcCode:-32602,workspaceCode:code});}
function assertIdentity(args){if(!Number.isSafeInteger(args.processId)||args.processId<=0||typeof args.handle!=='string'||!(/^[1-9][0-9]{0,18}$/.test(args.handle)))reject('INVALID_IDENTITY');}
function findWindow(windows,args){assertIdentity(args);return (Array.isArray(windows?.windows)?windows.windows:[]).find(w=>w.processId===args.processId&&String(w.handle)===args.handle);}
function safeApplication(w){return /firefox/i.test(String(w.wmClass||''));}
export function createWorkspaceTargetTools({gui}){
 if(typeof gui!=='function')throw Error('WORKSPACE_GUI_BACKEND_REQUIRED');
 const status=async()=>{const s=await gui('gui_status',{});if(s?.ok!==true||s.available!==true)reject('GUI_UNAVAILABLE');return s;};
 const enumerate=lease=>gui('gui_list_windows',{lease});
 const exact=async args=>{const rows=await enumerate(args.lease);const w=findWindow(rows,args);if(!w)reject('WINDOW_CHANGED_OR_MISSING');return w;};
 return {definitions:workspaceTargetDefinitions,execute:async(name,args={})=>{
  switch(name){
   case 'workspace_target_list':{
    await status();const session=await gui('gui_session_begin',{mode:'observe',ttlSeconds:30});
    if(!session?.ok||!session.lease)reject('OBSERVE_LEASE_UNAVAILABLE');
    try{const rows=await enumerate(session.lease);
      return {ok:true,backend:'owner-native-gui',application:args.application||'all',windows:(rows.windows||[]).filter(w=>args.application!=='firefox'||safeApplication(w)).map(w=>({processId:w.processId,handle:String(w.handle),title:w.title,wmClass:w.wmClass,focused:w.focused})),privateProfileAccess:false};
    }finally{await gui('gui_session_end',{lease:session.lease});}
   }
   case 'workspace_target_open':{
    await status();assertIdentity(args);
    if(args.mode==='takeover'&&(!args.explicitUserAuthorization||args.explicitUserAuthorization.length<5))reject('AUTHORIZATION_REQUIRED');
    const input={mode:args.mode||'observe',ttlSeconds:60,...(args.mode==='takeover'?{explicitUserAuthorization:args.explicitUserAuthorization}:{})};
    const session=await gui('gui_session_begin',input);
    if(!session?.ok||!session.lease)reject('LEASE_UNAVAILABLE');
    try{await exact({...args,lease:session.lease});}
    catch(e){await gui('gui_session_end',{lease:session.lease});throw e;}
    return {ok:true,lease:session.lease,mode:session.mode,processId:args.processId,handle:args.handle,source:'existing-owner-window',profileInherited:false};
   }
   case 'workspace_target_snapshot':{await exact(args);return gui('gui_screenshot',{lease:args.lease,format:'jpeg',quality:55,maxWidth:1280});}
   case 'workspace_target_focus':{await exact(args);return gui('gui_focus_window',{lease:args.lease,frame:args.frame,handle:args.handle});}
   case 'workspace_target_click':{const w=await exact(args);if(w.focused!==true)reject('FOCUS_NOT_CONFIRMED');return gui('gui_mouse_click',{lease:args.lease,frame:args.frame,x:args.x,y:args.y});}
   case 'workspace_target_type':{const w=await exact(args);if(w.focused!==true)reject('FOCUS_NOT_CONFIRMED');return gui('gui_type_text',{lease:args.lease,frame:args.frame,text:args.text});}
   case 'workspace_target_end':return gui('gui_session_end',{lease:args.lease});
   default:reject('UNKNOWN_TOOL');
  }
 }};
}
