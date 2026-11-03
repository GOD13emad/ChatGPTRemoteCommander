// CoS native menu adapter for bundled Commander V2 R18 read-only Workspace.
// User-initiated tray action only; no new browser profile, no V1 mutation or Worker grant.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type V2CenterWindow = {
  isDestroyed(): boolean;
  show(): void;
  focus(): void;
  destroy(): void;
  loadURL(url: string): Promise<void>;
  webContents: {
    setWindowOpenHandler(handler: (details: {url: string}) => {action:'deny'}): void;
    on(event: 'will-navigate', callback: (event: {preventDefault(): void}, url: string) => void): void;
    session: {setPermissionRequestHandler(handler: (_contents: unknown, permission: string, decision: (allow: boolean) => void) => void): void};
  };
  on(event: 'closed', handler: () => void): void;
};
export type V2CenterWorkspace = {
  url: string;
  server: {close(callback: () => void): unknown};
};
export type V2CenterOptions = {
  resourcesPath: string;
  BrowserWindowClass: new (options: object) => V2CenterWindow;
  loadWorkspace?: (url: string) => Promise<{createWorkspace(options: {port: number}): Promise<V2CenterWorkspace>}>;
};

const isPrivateWorkspaceUrl=(url: string): boolean => {
  try {
    const u=new URL(url);
    return u.protocol==='http:' && u.hostname==='127.0.0.1' &&
      Number(u.port)>=1024 && Number(u.port)<=65535 &&
      u.pathname==='/' && !u.search && /^[a-f0-9]{48}$/.test(u.hash.slice(1)) &&
      !u.username && !u.password;
  } catch { return false; }
};

export function createCommanderV2Center(options: V2CenterOptions) {
  const runtime=join(options.resourcesPath,'commander-v2-workspace','server.mjs');
  const load=options.loadWorkspace ?? (async (url: string) =>
    await import(/* @vite-ignore */ url) as {createWorkspace(options: {port: number}): Promise<V2CenterWorkspace>});
  let active: {window: V2CenterWindow; close: () => Promise<void>} | null = null;
  let pending: Promise<void> | null = null;
  const available=()=>existsSync(runtime);
  const open=async ():Promise<void>=>{
    if (active && !active.window.isDestroyed()) {
      active.window.show();
      active.window.focus();
      return;
    }
    if (pending) return pending;
    pending=(async()=>{
      if (!available()) throw Error('V2_CENTER_BUNDLED_RUNTIME_MISSING');
      const mod=await load(pathToFileURL(runtime).href);
      if (typeof mod.createWorkspace!=='function') throw Error('V2_CENTER_RUNTIME_INVALID');
      const server=await mod.createWorkspace({port:0});
      let stopped=false;
      const stop=async()=>{
        if(stopped)return;
        stopped=true;
        await new Promise<void>(resolve=>server.server.close(()=>resolve()));
      };
      let win:V2CenterWindow|undefined;
      try {
        if(!isPrivateWorkspaceUrl(server.url))throw Error('V2_CENTER_LOCAL_AUTH_REQUIRED');
        win=new options.BrowserWindowClass({
          title:'Commander V2 Control Center — Read-only',
          width:1420,height:920,minWidth:860,minHeight:600,show:false,
          autoHideMenuBar:true,
          webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,
            webSecurity:true,webviewTag:false,partition:'temp:commander-v2-center'}
        });
        const localWindow=win;
        localWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
        localWindow.webContents.on('will-navigate',(event,url)=>{
          if(url!==server.url)event.preventDefault();
        });
        localWindow.webContents.session.setPermissionRequestHandler((_contents,_permission,decision)=>decision(false));
        localWindow.on('closed',()=>{
          if(active?.window===localWindow) active=null;
          void stop();
        });
        await localWindow.loadURL(server.url);
        active={window:localWindow,close:stop};
        localWindow.show();
        localWindow.focus();
      }catch(error){
        try{if(win && !win.isDestroyed())win.destroy();}catch{}
        await stop();
        throw error;
      }
    })();
    try{await pending;}finally{pending=null;}
  };
  const close=async()=>{
    if(pending){try{await pending;}catch{}}
    const entry=active;
    active=null;
    if(!entry)return;
    if(!entry.window.isDestroyed())entry.window.destroy();
    await entry.close();
  };
  return {available,open,close};
}
