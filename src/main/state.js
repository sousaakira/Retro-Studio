export const state = {
  mainWindow: null,
  ptyProcess: null,
  ptyProcesses: new Map(),
  emulatorProcess: null,
  currentBuildProcess: null,
  currentEmulatorConfig: { selectedEmulator: 'gen_sdl2' },
  helpWatcher: null
};
