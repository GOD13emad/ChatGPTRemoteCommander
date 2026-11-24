'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('commander',Object.freeze({
  status:()=>ipcRenderer.invoke('commander:status'),
  preflight:()=>ipcRenderer.invoke('commander:migration:preflight'),
  startPreview:()=>ipcRenderer.invoke('commander:preview:start'),
  stopPreview:()=>ipcRenderer.invoke('commander:preview:stop'),
  companionStatus:()=>ipcRenderer.invoke('commander:companion:status'),
  companionStart:()=>ipcRenderer.invoke('commander:companion:start'),
  companionStop:()=>ipcRenderer.invoke('commander:companion:stop'),
  companionPairCode:()=>ipcRenderer.invoke('commander:companion:pair-code'),
  companionExtensionFolder:()=>ipcRenderer.invoke('commander:companion:extension-folder'),
  companionBrowserList:()=>ipcRenderer.invoke('commander:companion:browser-list'),
  companionBrowserOpen:id=>ipcRenderer.invoke('commander:companion:browser-open',id),
  monitorInstances:()=>ipcRenderer.invoke('commander:monitor:list'),
  monitorSelect:id=>ipcRenderer.invoke('commander:monitor:select',id),
  openChatBrowser:()=>ipcRenderer.invoke('commander:chat:open'),
  openChatExtensionPopup:()=>ipcRenderer.invoke('commander:chat:extension-popup')
}));
