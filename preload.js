const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('versions', {
  node: () => process.version.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electrons
})

contextBridge.exposeInMainWorld('socketAPI', {
  onConnect: (callback) => ipcRenderer.on('connect', (_event) => callback()),
  onHello: (callback) => ipcRenderer.on('hello', (_event, value) => callback(value)),
  sendCursor: (packet) => ipcRenderer.send('cursor-update', packet),
})

