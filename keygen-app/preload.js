const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("kg", {
  keyStatus: () => ipcRenderer.invoke("key-status"),
  pickKey: () => ipcRenderer.invoke("pick-key"),
  genCDK: (opts) => ipcRenderer.invoke("gen-cdk", opts)
});
