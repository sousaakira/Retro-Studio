const { contextBridge, ipcRenderer, webUtils } = require('electron')

// O Electron embrulha o erro de um handler em "Error invoking remote method 'canal': Error: mensagem".
// Quem vê a mensagem é o usuário: fica só a mensagem.
const invoke = async (...args) => {
  try { return await ipcRenderer.invoke(...args) }
  catch (error) { throw new Error(String(error?.message || error).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '')) }
}

contextBridge.exposeInMainWorld('retroStudio', {
  getPathForFile: (file) => (file && webUtils?.getPathForFile) ? webUtils.getPathForFile(file) : (file?.path || ''),
  windowMinimize: () => invoke('window:minimize'),
  windowToggleMaximize: () => invoke('window:toggleMaximize'),
  windowClose: () => invoke('window:close'),
  onWindowCloseRequested: (callback) => { const listener = () => callback(); ipcRenderer.on('window:close-requested', listener); return () => ipcRenderer.removeListener('window:close-requested', listener) },
  answerWindowClose: (accepted) => ipcRenderer.send('window:close-answer', !!accepted),
  windowIsMaximized: () => invoke('window:isMaximized'),
  selectWorkspace: () => invoke('workspace:select'),
  listWorkspaceTree: () => invoke('workspace:tree'),
  readTextFile: (filePath) => invoke('fs:readTextFile', filePath),
  readTextFileOptional: (filePath) => invoke('fs:readTextFileOptional', filePath),
  writeTextFile: (filePath, contents) => invoke('fs:writeTextFile', filePath, contents),
  createFile: (parentDirPath, name) => invoke('fs:createFile', parentDirPath, name),

  // System functions
  getCwd: () => invoke('system:getCwd'),
  getAppInfo: () => invoke('app:getInfo'),
  checkUpdates: () => invoke('app:checkUpdates'),
  getChangelog: (options) => invoke('app:getChangelog', options || {}),
  openExternal: (url) => invoke('app:openExternal', url),
  onUpdateAvailable: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('app:update-available', listener)
    return () => ipcRenderer.removeListener('app:update-available', listener)
  },
  ensureDirectory: (dirPath) => invoke('fs:ensureDirectory', dirPath),
  createFolder: (parentDirPath, name) => invoke('fs:createFolder', parentDirPath, name),
  renamePath: (oldPath, newName) => invoke('fs:renamePath', oldPath, newName),
  deletePath: (targetPath) => invoke('fs:deletePath', targetPath),
  copyFileFromExternal: (sourcePath, destDirPath, options) => invoke('fs:copyFileFromExternal', sourcePath, destDirPath, options),
  searchFiles: (query, options) => invoke('fs:search', query, options),
  searchWorkspace: (query) => invoke('workspace:search', query),
  openTilemapEditor: (data) => invoke('tilemap:open', data),
  getTilemapEditorData: () => invoke('tilemap:get-data'),
  closeTilemapWindow: () => invoke('tilemap:close-window'),

  // Git APIs
  git: {
    serviceVersion: () => invoke('git:serviceVersion'),
    isRepository: () => invoke('git:isRepository'),
    status: () => invoke('git:status'),
    currentBranch: () => invoke('git:currentBranch'),
    stage: (filePath) => invoke('git:stage', filePath),
    unstage: (filePath) => invoke('git:unstage', filePath),
    discard: (filePath) => invoke('git:discard', filePath),
    commit: (message) => invoke('git:commit', message),
    init: () => invoke('git:init'),
    config: (key, value) => invoke('git:config', key, value),
    getConfig: (key) => invoke('git:getConfig', key),
    // Novos comandos avançados
    pull: () => invoke('git:pull'),
    push: () => invoke('git:push'),
    fetch: () => invoke('git:fetch'),
    getRemote: () => invoke('git:getRemote'),
    setRemote: (url) => invoke('git:setRemote', url),
    branches: () => invoke('git:branches'),
    createBranch: (name) => invoke('git:createBranch', name),
    checkout: (name) => invoke('git:checkout', name),
    deleteBranch: (name) => invoke('git:deleteBranch', name),
    log: (options) => invoke('git:log', options),
    diff: (filePath, staged) => invoke('git:diff', filePath, staged)
  },

  // Workspace Recent APIs
  workspace: {
    select: () => invoke('workspace:select'),
    getRecent: () => invoke('workspace:getRecent'),
    openRecent: (path) => invoke('workspace:openRecent', path),
    getLast: () => invoke('workspace:getLast'),
    removeRecent: (path) => invoke('workspace:removeRecent', path),
    onOpenFromCli: (callback) => {
      const listener = (_event, path) => callback(path)
      ipcRenderer.on('workspace:open-from-cli', listener)
      return () => ipcRenderer.removeListener('workspace:open-from-cli', listener)
    }
  },

  // Terminal APIs
  terminal: {
    create: (options) => invoke('terminal:create', options),
    write: (terminalId, data) => invoke('terminal:write', terminalId, data),
    resize: (terminalId, cols, rows) => invoke('terminal:resize', terminalId, cols, rows),
    destroy: (terminalId) => invoke('terminal:destroy', terminalId),
    getCwd: () => invoke('terminal:getCwd'),
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
    load: () => invoke('settings:load'),
    save: (settings) => invoke('settings:save', settings),
    savePartial: (partial) => invoke('settings:savePartial', partial),
    getConfigPath: () => invoke('settings:getConfigPath'),
    openConfigDir: () => invoke('settings:openConfigDir')
  },

  // Resolve binário no PATH / candidatos
  which: (commandName) => invoke('system:which', commandName),

  // OpenCode ACP
  acp: {
    start: (options) => invoke('acp:start', options),
    openSession: (options) => invoke('acp:openSession', options),
    listSessions: () => invoke('acp:listSessions'),
    prompt: (payload) => invoke('acp:prompt', payload),
    setConfigOption: (configId, value) => invoke('acp:setConfigOption', { configId, value }),
    getConfigOptions: () => invoke('acp:getConfigOptions'),
    cancel: () => invoke('acp:cancel'),
    stop: (options) => invoke('acp:stop', options),
    resolvePermission: (requestId, result) => invoke('acp:resolvePermission', { requestId, result }),
    authStatus: (options) => invoke('acp:authStatus', options || {}),
    authenticate: (methodId) => invoke('acp:authenticate', { methodId }),
    onUpdate: (callback) => {
      const listener = (_e, payload) => callback(payload)
      ipcRenderer.on('acp:update', listener)
      return () => ipcRenderer.removeListener('acp:update', listener)
    },
    onPermission: (callback) => {
      const listener = (_e, payload) => callback(payload)
      ipcRenderer.on('acp:permission', listener)
      return () => ipcRenderer.removeListener('acp:permission', listener)
    },
    onFileWritten: (callback) => {
      const listener = (_e, payload) => callback(payload)
      ipcRenderer.on('acp:fileWritten', listener)
      return () => ipcRenderer.removeListener('acp:fileWritten', listener)
    },
    onConfigOptions: (callback) => {
      const listener = (_e, payload) => callback(payload)
      ipcRenderer.on('acp:configOptions', listener)
      return () => ipcRenderer.removeListener('acp:configOptions', listener)
    },
    onReplaying: (callback) => {
      const listener = (_e, payload) => callback(payload)
      ipcRenderer.on('acp:replaying', listener)
      return () => ipcRenderer.removeListener('acp:replaying', listener)
    },
    onExit: (callback) => {
      const listener = (_e, payload) => callback(payload)
      ipcRenderer.on('acp:exit', listener)
      return () => ipcRenderer.removeListener('acp:exit', listener)
    },
    onStderr: (callback) => {
      const listener = (_e, payload) => callback(payload)
      ipcRenderer.on('acp:stderr', listener)
      return () => ipcRenderer.removeListener('acp:stderr', listener)
    }
  },

  // AI Agent APIs
  ai: {
    init: (settings) => invoke('ai:init', settings),
    chat: (message, options) => invoke('ai:chat', message, options),
    clear: () => invoke('ai:clear'),
    updateSettings: (settings) => invoke('ai:updateSettings', settings),
    getTools: () => invoke('ai:getTools'),
    executeTool: (toolName, params) => invoke('ai:executeTool', toolName, params),
    // Modos de chat
    getModes: () => invoke('ai:getModes'),
    fetchModels: (baseUrl, provider) => invoke('ai:fetchModels', baseUrl, provider),
    getProviders: () => invoke('ai:getProviders'),
    setMode: (mode) => invoke('ai:setMode', mode),
    getMode: () => invoke('ai:getMode'),
    onToolCall: (callback) => {
      const listener = (_event, toolInfo) => callback(toolInfo)
      ipcRenderer.on('ai:tool-call', listener)
      return () => ipcRenderer.removeListener('ai:tool-call', listener)
    },
    onChatChunk: (callback) => {
      const listener = (_event, chunk) => callback(chunk)
      ipcRenderer.on('ai:chunk', listener)
      return () => ipcRenderer.removeListener('ai:chunk', listener)
    },
    // Autocomplete AI APIs
    autocomplete: {
      init: (settings) => invoke('ai:autocomplete:init', settings),
      complete: (params) => invoke('ai:autocomplete:complete', params),
      updateSettings: (settings) => invoke('ai:autocomplete:updateSettings', settings),
      setEnabled: (enabled) => invoke('ai:autocomplete:setEnabled', enabled),
      clearCache: () => invoke('ai:autocomplete:clearCache'),
      abort: () => invoke('ai:autocomplete:abort')
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
    login: (apiUrl, email, password) => invoke('store:login', apiUrl, email, password),
    logout: () => invoke('store:logout'),
    me: () => invoke('store:me'),
    listAssets: (apiUrl, params) => invoke('store:listAssets', apiUrl, params),
    getAsset: (apiUrl, slug) => invoke('store:getAsset', apiUrl, slug),
    purchase: (assetId) => invoke('store:purchase', assetId),
    myPurchases: () => invoke('store:myPurchases'),
    download: (purchaseId) => invoke('store:download', purchaseId),
    installAsset: (projectPath, asset, downloadUrl) => invoke('store:installAsset', projectPath, asset, downloadUrl)
  },

  // Retro Studio APIs
  retro: {
    isRetroProject: (path) => invoke('retro:is-retro-project', path),
    getProjectConfig: (path) => invoke('retro:get-project-config', path),
    reqProject: (path) => invoke('retro:req-project', { path }),
    createProject: (data) => invoke('retro:create-project', data),
    selectFolder: (options) => invoke('retro:select-folder', options),
    getUiSettings: () => invoke('retro:get-ui-settings'),
    saveUiSettings: (settings) => invoke('retro:save-ui-settings', settings),
    runGame: (path, toolkitPath) => ipcRenderer.send('retro:run-game', { path, toolkitPath }),
    buildOnly: (path, toolkitPath, isClean) => ipcRenderer.send('retro:build-only', { path, toolkitPath, clean: isClean }),
    stopBuild: () => ipcRenderer.send('retro:stop-build'),
    getAvailableEmulators: () => invoke('retro:get-available-emulators'),
    getEmulatorConfig: () => invoke('retro:get-emulator-config'),
    setEmulatorConfig: (config) => invoke('retro:set-emulator-config', config),
    getCustomEmulatorPaths: () => invoke('retro:get-custom-emulator-paths'),
    setCustomEmulatorPaths: (paths) => invoke('retro:set-custom-emulator-paths', paths),
    browseEmulatorPath: (emulator) => invoke('retro:browse-emulator-path', { emulator }),
    selectFile: (options) => invoke('retro:select-file', options),
    readImageFile: (filePath) => invoke('retro:read-image-file', filePath),
    selectSaveFile: (options) => invoke('retro:select-save-file', options),
    selectMultipleFiles: (options) => invoke('retro:select-multiple-files', options),
    importAssetFromPath: (opts) => invoke('retro:import-asset-from-path', opts),
    openExternalEditor: (editorPath, filePath) => invoke('retro:open-external-editor', { editorPath, filePath }),
    getDownloadablePackages: () => invoke('retro:get-downloadable-packages'),
    downloadPackage: (packageId) => invoke('retro:download-package', { packageId }),
    inspectAssets: () => invoke('retro:asset-report'),
    inspectCompiledResources: (payload) => invoke('retro:compiled-resource-report', payload),
    saveHardwareBudget: (payload) => invoke('retro:save-hardware-budget', payload),
    inputConfiguration: (payload) => invoke('retro:input-configuration', payload),
    saveInputConfiguration: (payload) => invoke('retro:save-input-configuration', payload),
    buildMovementDiagnostic: (payload) => invoke('retro:build-movement-diagnostic', payload),
    openMovementDiagnostic: (payload) => invoke('retro:open-movement-diagnostic', payload),
    movementConfiguration: (payload) => invoke('retro:movement-configuration', payload),
    worldConfiguration: (payload) => invoke('retro:world-configuration', payload),
    saveWorldConfiguration: (payload) => invoke('retro:save-world-configuration', payload),
    saveMovementConfiguration: (payload) => invoke('retro:save-movement-configuration', payload),
    cameraConfiguration: (payload) => invoke('retro:camera-configuration', payload),
    saveCameraConfiguration: (payload) => invoke('retro:save-camera-configuration', payload),
    progressConfiguration: (payload) => invoke('retro:progress-configuration', payload),
    saveProgressConfiguration: (payload) => invoke('retro:save-progress-configuration', payload),
    audioConfiguration: (payload) => invoke('retro:audio-configuration', payload),
    saveAudioConfiguration: (payload) => invoke('retro:save-audio-configuration', payload),
    cutsceneAdapter: (payload) => invoke('retro:cutscene-adapter', payload),
    saveCutsceneAdapter: (payload) => invoke('retro:save-cutscene-adapter', payload),
    toolchainStatus: (payload) => invoke('retro:toolchain-status', payload),
    recordToolchain: (payload) => invoke('retro:record-toolchain', payload),
    editorDraft: (payload) => invoke('retro:editor-draft', payload),
    paletteConfiguration: (payload) => invoke('retro:palette-configuration', payload),
    gameHost: (payload) => invoke('retro:game-host', payload),
    saveGameHost: (payload) => invoke('retro:save-game-host', payload),
    useMapSpawnAsStart: (payload) => invoke('retro:game-host-use-map-spawn', payload),
    hudConfiguration: (payload) => invoke('retro:hud-configuration', payload),
    saveHudConfiguration: (payload) => invoke('retro:save-hud-configuration', payload),
    savePaletteConfiguration: (payload) => invoke('retro:save-palette-configuration', payload),
    paletteImage: (payload) => invoke('retro:palette-image', payload),
    debugConfiguration: (payload) => invoke('retro:debug-configuration', payload),
    debugStatus: (payload) => invoke('retro:debug-status', payload),
    debugBuild: (payload) => invoke('retro:debug-build', payload),
    debugStart: (payload) => invoke('retro:debug-start', payload),
    debugCommand: (payload) => invoke('retro:debug-command', payload),
    onDebugEvent: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on('retro:debug-event', listener)
      return () => ipcRenderer.removeListener('retro:debug-event', listener)
    },
    exportOverview: (payload) => invoke('retro:export-overview', payload),
    saveDebugConfiguration: (payload) => invoke('retro:save-debug-configuration', payload),
    runtimeStatus: (payload) => invoke('retro:runtime-status', payload),
    installRuntime: (payload) => invoke('retro:install-runtime', payload),
    quarantineAssets: (payload) => invoke('retro:quarantine-assets', payload),
    restoreAssets: (payload) => invoke('retro:restore-assets', payload),
    exportCharacter: (payload) => invoke('retro:export-character', payload),
    recoverExport: (transactionId) => invoke('retro:recover-export', transactionId),
    scanResources: (path) => invoke('retro:scan-resources', path),
    addAssetToConfig: (projectPath, asset) => invoke('retro:add-asset-to-config', { projectPath, asset }),
    saveProjectConfig: (projectPath, config) => invoke('retro:save-project-config', { projectPath, config }),
    copyAssetToProject: (projectPath, filename, buffer) => invoke('retro:copy-asset-to-project', { projectPath, filename, buffer }),
    registerAssetResource: (projectPath, resourceEntry, assetName) => invoke('retro:register-asset-resource', { projectPath, resourceEntry, assetName }),
    updateTilemapResourceEntry: (opts) => invoke('retro:update-tilemap-resource-entry', opts),
    exportMapAfterSave: (mapPath) => invoke('tilemap:export-after-save', { mapPath }),
    listTilemapPackMaps: (directory, excludedFile) => invoke('tilemap:list-kit-maps', { directory, excludedFile }),
    deleteTilemapPackMap: (directory, mapPath, excludedFile) => invoke('tilemap:delete-kit-map', { directory, mapPath, excludedFile }),
    findTilemapPackForMap: (mapPath) => invoke('tilemap:find-kit-for-map', { mapPath }),
    cutsceneRuntimeStatus: () => invoke('tilemap:cutscene-runtime-status'),
    installCutsceneRuntime: () => invoke('tilemap:install-cutscene-runtime'),
    listCutscenes: () => invoke('tilemap:list-cutscenes'),
    exportCutscenes: (payload) => invoke('tilemap:export-cutscenes', payload),
    removeAssetFromConfig: (projectPath, assetId) => invoke('retro:remove-asset-from-config', { projectPath, assetId }),
    renameAssetFile: (projectPath, oldFileName, newName, oldPath) => invoke('retro:rename-asset-file', { projectPath, oldFileName, newName, oldPath }),
    getAssetPreview: (projectPath, assetPath) => invoke('retro:get-asset-preview', { projectPath, assetPath }),
    getPaletteColors: (projectPath, assetPath) => invoke('retro:get-palette-colors', { projectPath, assetPath }),
    getFindDefinition: (projectPath, symbolName) => invoke('retro:find-definition', { projectPath, symbolName }),
    lspStatus: (options) => invoke('retro:lsp-status', options || {}),
    lspSync: (payload) => invoke('retro:lsp-sync', payload || {}),
    lspDefinition: (payload) => invoke('retro:lsp-definition', payload || {}),
    lspEnsureFlags: (projectPath) => invoke('retro:lsp-ensure-flags', { projectPath }),
    lspStop: (projectPath) => invoke('retro:lsp-stop', { projectPath }),
    saveScene: (sceneData) => invoke('retro:save-scene', sceneData),
    loadScene: (scenePath) => invoke('retro:load-scene', scenePath),
    exportScene: (sceneData) => invoke('retro:export-scene', sceneData),
    loadMarkdownFile: (filePath) => invoke('retro:load-markdown-file', { filePath }),
    loadContentTopics: () => invoke('retro:load-content-topics'),
    loadTutorials: () => invoke('retro:load-tutorials'),
    openExternalUrl: (url) => ipcRenderer.send('open-external-url', { url }),
    onHelpContentUpdated: (callback) => {
      const listener = () => callback()
      ipcRenderer.on('help-content-updated', listener)
      return () => ipcRenderer.removeListener('help-content-updated', listener)
    },
    detectCartridgeDevice: () => invoke('retro:detect-cartridge-device'),
    checkDevicePermissions: (devicePath) => invoke('retro:check-device-permissions', devicePath),
    getCurrentRomInfo: (projectPath) => invoke('retro:get-current-rom-info', projectPath),
    canPackageSteamLinux: (projectPath) => invoke('retro:can-package-steam-linux', projectPath),
    packageSteamLinux: (options) => invoke('retro:package-steam-linux', options),
    validateRomFile: (filePath) => invoke('retro:validate-rom-file', filePath),
    connectSerial: (devicePath) => invoke('retro:connect-serial', devicePath),
    disconnectSerial: (devicePath) => invoke('retro:disconnect-serial', devicePath),
    writeSerial: (devicePath, data) => invoke('retro:write-serial', devicePath, data),
    onTerminalData: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on('retro:terminal-data', listener)
      return () => ipcRenderer.removeListener('retro:terminal-data', listener)
    },
    onEmulatorClosed: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on('retro:emulator-closed', listener)
      return () => ipcRenderer.removeListener('retro:emulator-closed', listener)
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
    onBuildProgress: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on('retro:build-progress', listener)
      return () => ipcRenderer.removeListener('retro:build-progress', listener)
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
    },
    onPackageProgress: (callback) => {
      const listener = (_event, msg) => callback(msg)
      ipcRenderer.on('retro:package-progress', listener)
      return () => ipcRenderer.removeListener('retro:package-progress', listener)
    }
  },

  // Plugins API
  plugins: {
    execute: (pluginName, action, payload) => invoke('plugins:execute', { pluginName, action, payload }),
    emit: (eventName, payload) => ipcRenderer.send('plugins:emit', { eventName, payload }),
    on: (eventName, callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(`plugins:on:${eventName}`, listener)
      return () => ipcRenderer.removeListener(`plugins:on:${eventName}`, listener)
    }
  }
})
