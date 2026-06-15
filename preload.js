const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kh", {
  setToken: (token) => ipcRenderer.invoke("set-token", token),
  clearSession: () => ipcRenderer.invoke("clear-session"),
  checkUpdate: () => ipcRenderer.invoke("check-update")
});
