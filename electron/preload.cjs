const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ricky", {
  createRealtimeToken: () => ipcRenderer.invoke("realtime:create-token"),
  executeTool: (toolCall) => ipcRenderer.invoke("tools:execute", toolCall),
  getToolSpecs: () => ipcRenderer.invoke("tools:list"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  revealPath: (targetPath) => ipcRenderer.invoke("shell:reveal", targetPath),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ricky:event", listener);
    return () => ipcRenderer.removeListener("ricky:event", listener);
  },
});
