const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kh", {
  setToken: (token) => ipcRenderer.invoke("set-token", token),
  clearSession: () => ipcRenderer.invoke("clear-session"),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  getVersion: () => ipcRenderer.invoke("get-version"),
  // 授权
  licMachineId: () => ipcRenderer.invoke("lic-machine-id"),
  licStatus: () => ipcRenderer.invoke("lic-status"),
  licActivate: (cdk) => ipcRenderer.invoke("lic-activate", cdk),
  licDeactivate: () => ipcRenderer.invoke("lic-deactivate")
});
