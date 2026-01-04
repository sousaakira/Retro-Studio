// public/preload.js

const { contextBridge, ipcRenderer } = require('electron');
const validChannels = [
  'READ_FILE',
  'WRITE_FILE',
  'run-game',
  'read-files',
  'req-projec',
  'open-file',
  'receive-file',
  'save-file',
  'current-path',
  'send-directory',
  'directory-navigate',
  'back-directory-navigate',
  'get-home',
  'save-scene',
  'load-scene',
  'export-scene',
  'select-folder',
  'folder-selected',
  'create-project',
  'window-control',
  'window-control-state',
  'fs-create-entry',
  'fs-rename-entry',
  'fs-delete-entry',
  'fs-copy-entry',
  'fs-move-entry',
  'fs-open-with',
  'fs-operation-result',
  'run-game-error',
  'run-game-build-complete',
  'emulator-closed',
  'available-emulators',
  'emulator-config',
  'emulator-config-updated',
  'get-available-emulators',
  'get-emulator-config',
  'set-emulator-config',
  'get-custom-emulator-paths',
  'set-custom-emulator-paths',
  'custom-emulator-paths',
  'browse-emulator-path',
  'emulator-path-selected',
  'copy-asset-to-project',
  'copy-asset-result',
  'register-asset-resource',
  'register-asset-result',
  'compilation-errors',
  'rename-asset-file',
  'rename-asset-result',
  'get-res-files',
  'get-res-files-result',
  'get-project-config',
  'project-config',
  'save-project-config',
  'save-project-config-result',
  'add-asset-to-config',
  'add-asset-result',
  'remove-asset-from-config',
  'remove-asset-result',
  'scan-resources',
  'scan-resources-result',
  'add-detected-assets',
  'add-detected-assets-result',
  'get-asset-preview',
  'get-asset-preview-result',
  'get-palette-colors',
  'get-palette-colors-result',
  'load-tutorials',
  'load-tutorials-result',
  'load-content-topics',
  'load-content-topics-result',
  'help-content-updated',
  'open-external-url',
  'load-markdown-file',
  'load-markdown-file-result'
];
const validSyncChannels = ['create-project'];

contextBridge.exposeInMainWorld(
    'ipc', {
    send: (channel, data) => {
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
    sendSync: (channel, data) => {
      if (validSyncChannels.includes(channel)) {
        return ipcRenderer.sendSync(channel, data);
      }
      return null;
    },
    on: (channel, func) => {
      if (validChannels.includes(channel)) {
        // Strip event as it includes `sender` and is a security risk
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    },
    once: (channel, func) => {
      if (validChannels.includes(channel)) {
        // Strip event as it includes `sender` and is a security risk
        ipcRenderer.once(channel, (event, ...args) => func(...args));
      }
    },
    off: (channel, func) => {
      if (validChannels.includes(channel)) {
        ipcRenderer.off(channel, func);
      }
    },
    removeListener: (channel, func) => {
      if (validChannels.includes(channel)) {
        ipcRenderer.removeListener(channel, func);
      }
    }
  },
);
