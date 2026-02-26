import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('retroStudio', {
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  listWorkspaceTree: () => ipcRenderer.invoke('workspace:tree'),
  readTextFile: (filePath) => ipcRenderer.invoke('fs:readTextFile', filePath),
  writeTextFile: (filePath, contents) => ipcRenderer.invoke('fs:writeTextFile', filePath, contents)
})
