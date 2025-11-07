// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  setTitle: (title: string) => ipcRenderer.send("set-title", title),
  onModelFilesUpdate: (callback: (value: string) => void) =>
    ipcRenderer.on("update-model", (_event, value) => callback(value)),
});
