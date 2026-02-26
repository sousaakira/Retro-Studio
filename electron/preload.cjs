const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('retroStudio', {
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  listWorkspaceTree: () => ipcRenderer.invoke('workspace:tree'),
  readTextFile: (filePath) => ipcRenderer.invoke('fs:readTextFile', filePath),
  writeTextFile: (filePath, contents) => ipcRenderer.invoke('fs:writeTextFile', filePath, contents),
  createFile: (parentDirPath, name) => ipcRenderer.invoke('fs:createFile', parentDirPath, name),
  createFolder: (parentDirPath, name) => ipcRenderer.invoke('fs:createFolder', parentDirPath, name),
  renamePath: (oldPath, newName) => ipcRenderer.invoke('fs:renamePath', oldPath, newName),
  deletePath: (targetPath) => ipcRenderer.invoke('fs:deletePath', targetPath),
  searchFiles: (query, options) => ipcRenderer.invoke('fs:search', query, options),
  searchWorkspace: (query) => ipcRenderer.invoke('workspace:search', query),
  openTilemapEditor: (data) => ipcRenderer.invoke('tilemap:open', data),
  getTilemapEditorData: () => ipcRenderer.invoke('tilemap:get-data'),
  closeTilemapWindow: () => ipcRenderer.invoke('tilemap:close-window'),
  
  // Git APIs
  git: {
    isRepository: () => ipcRenderer.invoke('git:isRepository'),
    status: () => ipcRenderer.invoke('git:status'),
    currentBranch: () => ipcRenderer.invoke('git:currentBranch'),
    stage: (filePath) => ipcRenderer.invoke('git:stage', filePath),
    unstage: (filePath) => ipcRenderer.invoke('git:unstage', filePath),
    discard: (filePath) => ipcRenderer.invoke('git:discard', filePath),
    commit: (message) => ipcRenderer.invoke('git:commit', message),
    init: () => ipcRenderer.invoke('git:init'),
    config: (key, value) => ipcRenderer.invoke('git:config', key, value),
    getConfig: (key) => ipcRenderer.invoke('git:getConfig', key),
    // Novos comandos avançados
    pull: () => ipcRenderer.invoke('git:pull'),
    push: () => ipcRenderer.invoke('git:push'),
    fetch: () => ipcRenderer.invoke('git:fetch'),
    branches: () => ipcRenderer.invoke('git:branches'),
    createBranch: (name) => ipcRenderer.invoke('git:createBranch', name),
    checkout: (name) => ipcRenderer.invoke('git:checkout', name),
    deleteBranch: (name) => ipcRenderer.invoke('git:deleteBranch', name),
    log: (options) => ipcRenderer.invoke('git:log', options),
    diff: (filePath, staged) => ipcRenderer.invoke('git:diff', filePath, staged)
  },
  
  // Workspace Recent APIs
  workspace: {
    select: () => ipcRenderer.invoke('workspace:select'),
    getRecent: () => ipcRenderer.invoke('workspace:getRecent'),
    openRecent: (path) => ipcRenderer.invoke('workspace:openRecent', path),
    getLast: () => ipcRenderer.invoke('workspace:getLast'),
    removeRecent: (path) => ipcRenderer.invoke('workspace:removeRecent', path),
    onOpenFromCli: (callback) => {
      const listener = (_event, path) => callback(path)
      ipcRenderer.on('workspace:open-from-cli', listener)
      return () => ipcRenderer.removeListener('workspace:open-from-cli', listener)
    }
  },
  
  // Terminal APIs
  terminal: {
    create: (options) => ipcRenderer.invoke('terminal:create', options),
    write: (terminalId, data) => ipcRenderer.invoke('terminal:write', terminalId, data),
    resize: (terminalId, cols, rows) => ipcRenderer.invoke('terminal:resize', terminalId, cols, rows),
    destroy: (terminalId) => ipcRenderer.invoke('terminal:destroy', terminalId),
    getCwd: () => ipcRenderer.invoke('terminal:getCwd'),
    onData: (callback) => {
      const listener = (_event, terminalId, data) => callback(terminalId, data)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onExit: (callback) => {
      const listener = (_event, terminalId, exitCode) => callback(terminalId, exitCode)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.removeListener('terminal:exit', listener)
    }
  },
  
  // Settings APIs
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
    getConfigPath: () => ipcRenderer.invoke('settings:getConfigPath'),
    openConfigDir: () => ipcRenderer.invoke('settings:openConfigDir')
  },
  
  // AI Agent APIs
  ai: {
    init: (settings) => ipcRenderer.invoke('ai:init', settings),
    chat: (message, options) => ipcRenderer.invoke('ai:chat', message, options),
    clear: () => ipcRenderer.invoke('ai:clear'),
    updateSettings: (settings) => ipcRenderer.invoke('ai:updateSettings', settings),
    getTools: () => ipcRenderer.invoke('ai:getTools'),
    executeTool: (toolName, params) => ipcRenderer.invoke('ai:executeTool', toolName, params),
    // Modos de chat
    getModes: () => ipcRenderer.invoke('ai:getModes'),
    fetchModels: (baseUrl, provider) => ipcRenderer.invoke('ai:fetchModels', baseUrl, provider),
    getProviders: () => ipcRenderer.invoke('ai:getProviders'),
    setMode: (mode) => ipcRenderer.invoke('ai:setMode', mode),
    getMode: () => ipcRenderer.invoke('ai:getMode'),
    onToolCall: (callback) => {
      const listener = (_event, toolInfo) => callback(toolInfo)
      ipcRenderer.on('ai:tool-call', listener)
      return () => ipcRenderer.removeListener('ai:tool-call', listener)
    },
    // Autocomplete AI APIs
    autocomplete: {
      init: (settings) => ipcRenderer.invoke('ai:autocomplete:init', settings),
      complete: (params) => ipcRenderer.invoke('ai:autocomplete:complete', params),
      updateSettings: (settings) => ipcRenderer.invoke('ai:autocomplete:updateSettings', settings),
      setEnabled: (enabled) => ipcRenderer.invoke('ai:autocomplete:setEnabled', enabled),
      clearCache: () => ipcRenderer.invoke('ai:autocomplete:clearCache'),
      abort: () => ipcRenderer.invoke('ai:autocomplete:abort')
    }
  },
  
  // Filesystem change notifications
  onFileSystemChange: (callback) => {
    const listener = (_event, changeInfo) => callback(changeInfo)
    ipcRenderer.on('fs:changed', listener)
    return () => ipcRenderer.removeListener('fs:changed', listener)
  },

  // Store (Loja API)
  store: {
    login: (apiUrl, email, password) => ipcRenderer.invoke('store:login', apiUrl, email, password),
    logout: () => ipcRenderer.invoke('store:logout'),
    me: () => ipcRenderer.invoke('store:me'),
    listAssets: (apiUrl, params) => ipcRenderer.invoke('store:listAssets', apiUrl, params),
    getAsset: (apiUrl, slug) => ipcRenderer.invoke('store:getAsset', apiUrl, slug),
    purchase: (assetId) => ipcRenderer.invoke('store:purchase', assetId),
    myPurchases: () => ipcRenderer.invoke('store:myPurchases'),
    download: (purchaseId) => ipcRenderer.invoke('store:download', purchaseId),
    installAsset: (projectPath, asset, downloadUrl) => ipcRenderer.invoke('store:installAsset', projectPath, asset, downloadUrl)
  },

  // Retro Studio APIs
  retro: {
    isRetroProject: (path) => ipcRenderer.invoke('retro:is-retro-project', path),
    getProjectConfig: (path) => ipcRenderer.invoke('retro:get-project-config', path),
    reqProject: (path) => ipcRenderer.invoke('retro:req-project', { path }),
    createProject: (data) => ipcRenderer.invoke('retro:create-project', data),
    selectFolder: (options) => ipcRenderer.invoke('retro:select-folder', options),
    getUiSettings: () => ipcRenderer.invoke('retro:get-ui-settings'),
    saveUiSettings: (settings) => ipcRenderer.invoke('retro:save-ui-settings', settings),
    runGame: (path, toolkitPath) => ipcRenderer.send('retro:run-game', { path, toolkitPath }),
    buildOnly: (path, toolkitPath) => ipcRenderer.send('retro:build-only', { path, toolkitPath }),
    stopBuild: () => ipcRenderer.send('retro:stop-build'),
    getAvailableEmulators: () => ipcRenderer.invoke('retro:get-available-emulators'),
    getEmulatorConfig: () => ipcRenderer.invoke('retro:get-emulator-config'),
    setEmulatorConfig: (config) => ipcRenderer.invoke('retro:set-emulator-config', config),
    getCustomEmulatorPaths: () => ipcRenderer.invoke('retro:get-custom-emulator-paths'),
    setCustomEmulatorPaths: (paths) => ipcRenderer.invoke('retro:set-custom-emulator-paths', paths),
    browseEmulatorPath: (emulator) => ipcRenderer.invoke('retro:browse-emulator-path', { emulator }),
    selectFile: (options) => ipcRenderer.invoke('retro:select-file', options),
    selectSaveFile: (options) => ipcRenderer.invoke('retro:select-save-file', options),
    selectMultipleFiles: (options) => ipcRenderer.invoke('retro:select-multiple-files', options),
    importAssetFromPath: (opts) => ipcRenderer.invoke('retro:import-asset-from-path', opts),
    openExternalEditor: (editorPath, filePath) => ipcRenderer.invoke('retro:open-external-editor', { editorPath, filePath }),
    getDownloadablePackages: () => ipcRenderer.invoke('retro:get-downloadable-packages'),
    downloadPackage: (packageId) => ipcRenderer.invoke('retro:download-package', { packageId }),
    scanResources: (path) => ipcRenderer.invoke('retro:scan-resources', path),
    addAssetToConfig: (projectPath, asset) => ipcRenderer.invoke('retro:add-asset-to-config', { projectPath, asset }),
    saveProjectConfig: (projectPath, config) => ipcRenderer.invoke('retro:save-project-config', { projectPath, config }),
    copyAssetToProject: (projectPath, filename, buffer) => ipcRenderer.invoke('retro:copy-asset-to-project', { projectPath, filename, buffer }),
    registerAssetResource: (projectPath, resourceEntry, assetName) => ipcRenderer.invoke('retro:register-asset-resource', { projectPath, resourceEntry, assetName }),
    updateTilemapResourceEntry: (opts) => ipcRenderer.invoke('retro:update-tilemap-resource-entry', opts),
    removeAssetFromConfig: (projectPath, assetId) => ipcRenderer.invoke('retro:remove-asset-from-config', { projectPath, assetId }),
    renameAssetFile: (projectPath, oldFileName, newName, oldPath) => ipcRenderer.invoke('retro:rename-asset-file', { projectPath, oldFileName, newName, oldPath }),
    getAssetPreview: (projectPath, assetPath) => ipcRenderer.invoke('retro:get-asset-preview', { projectPath, assetPath }),
    getPaletteColors: (projectPath, assetPath) => ipcRenderer.invoke('retro:get-palette-colors', { projectPath, assetPath }),
    getFindDefinition: (projectPath, symbolName) => ipcRenderer.invoke('retro:find-definition', { projectPath, symbolName }),
    saveScene: (sceneData) => ipcRenderer.invoke('retro:save-scene', sceneData),
    loadScene: (scenePath) => ipcRenderer.invoke('retro:load-scene', scenePath),
    exportScene: (sceneData) => ipcRenderer.invoke('retro:export-scene', sceneData),
    loadMarkdownFile: (filePath) => ipcRenderer.invoke('retro:load-markdown-file', { filePath }),
    loadContentTopics: () => ipcRenderer.invoke('retro:load-content-topics'),
    loadTutorials: () => ipcRenderer.invoke('retro:load-tutorials'),
    openExternalUrl: (url) => ipcRenderer.send('open-external-url', { url }),
    onHelpContentUpdated: (callback) => {
      const listener = () => callback()
      ipcRenderer.on('help-content-updated', listener)
      return () => ipcRenderer.removeListener('help-content-updated', listener)
    },
    detectCartridgeDevice: () => ipcRenderer.invoke('retro:detect-cartridge-device'),
    checkDevicePermissions: (devicePath) => ipcRenderer.invoke('retro:check-device-permissions', devicePath),
    getCurrentRomInfo: (projectPath) => ipcRenderer.invoke('retro:get-current-rom-info', projectPath),
    validateRomFile: (filePath) => ipcRenderer.invoke('retro:validate-rom-file', filePath),
    connectSerial: (devicePath) => ipcRenderer.invoke('retro:connect-serial', devicePath),
    disconnectSerial: (devicePath) => ipcRenderer.invoke('retro:disconnect-serial', devicePath),
    writeSerial: (devicePath, data) => ipcRenderer.invoke('retro:write-serial', devicePath, data),
    onTerminalData: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on('retro:terminal-data', listener)
      return () => ipcRenderer.removeListener('retro:terminal-data', listener)
    },
    onRunGameError: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on('retro:run-game-error', listener)
      return () => ipcRenderer.removeListener('retro:run-game-error', listener)
    },
    onRunGameBuildComplete: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on('retro:run-game-build-complete', listener)
      return () => ipcRenderer.removeListener('retro:run-game-build-complete', listener)
    },
    onBuildComplete: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on('retro:build-complete', listener)
      return () => ipcRenderer.removeListener('retro:build-complete', listener)
    },
    onCompilationErrors: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on('retro:compilation-errors', listener)
      return () => ipcRenderer.removeListener('retro:compilation-errors', listener)
    },
    onDownloadProgress: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on('retro:download-package-progress', listener)
      return () => ipcRenderer.removeListener('retro:download-package-progress', listener)
    },
    onSerialData: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on('retro:serial-data', listener)
      return () => ipcRenderer.removeListener('retro:serial-data', listener)
    },
    onSerialError: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on('retro:serial-error', listener)
      return () => ipcRenderer.removeListener('retro:serial-error', listener)
    }
  }
})
