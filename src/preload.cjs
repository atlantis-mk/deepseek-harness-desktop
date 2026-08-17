const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopRuntime', {
  onStatus(callback) {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('runtime-status', listener)
    return () => ipcRenderer.removeListener('runtime-status', listener)
  },
  retry() {
    return ipcRenderer.invoke('retry-startup')
  },
})
