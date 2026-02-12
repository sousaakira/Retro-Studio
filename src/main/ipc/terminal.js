import { ipcMain } from 'electron'
import os from 'os'
import fs from 'fs'
import pty from 'node-pty'
import { state } from '../state.js'

export function setupTerminalHandlers() {
  // Stop game handler (existing functionality)
  ipcMain.on('stop-game', (event) => {
    if (state.currentBuildProcess) {
      try {
        process.kill(-state.currentBuildProcess.pid, 'SIGTERM');
      } catch (e) {
        if (state.currentBuildProcess) state.currentBuildProcess.kill();
      }
      state.currentBuildProcess = null;
    }

    if (state.emulatorProcess) {
      try {
        state.emulatorProcess.kill();
      } catch (e) {
        console.error('Erro ao matar emulador:', e);
      }
      state.emulatorProcess = null;
    }

    event.reply('emulator-closed', { code: 0, interrupted: true });
  });

  // Spawn terminal - simple single terminal approach
  ipcMain.on('terminal-spawn', (event, { cwd, terminalId }) => {
    console.log(`[Terminal] Spawning terminal ${terminalId} in ${cwd}`);
    
    // Only cleanup if PTY is not running or is stuck
    if (state.ptyProcess) {
      try {
        // Check if PTY is still alive by trying to write
        state.ptyProcess.write('');
        // If we get here, PTY is alive, just update the cwd for future commands
        console.log('[Terminal] PTY already running, reusing existing process');
        event.reply('terminal-spawned', { success: true, terminalId, reused: true });
        return;
      } catch (e) {
        // PTY is dead, clean up
        console.log('[Terminal] PTY is dead, cleaning up');
        try {
          state.ptyProcess.kill();
        } catch (e2) {}
        state.ptyProcess = null;
      }
    }

    // Determine shell based on platform
    const shell = process.platform === 'win32' 
      ? 'powershell.exe' 
      : (process.env.SHELL || '/bin/bash');

    // Use provided cwd or fall back to home directory
    let validCwd = cwd;
    if (!validCwd || !validCwd.trim()) {
      validCwd = os.homedir();
    }
    
    // Check if directory exists
    try {
      if (!fs.existsSync(validCwd)) {
        console.warn(`[Terminal] CWD does not exist: ${validCwd}, using home directory`);
        validCwd = os.homedir();
      }
    } catch (e) {
      console.warn('[Terminal] Error checking CWD:', e);
      validCwd = os.homedir();
    }
    
    console.log(`[Terminal] Using shell: ${shell}, cwd: ${validCwd}`);

    try {
      state.ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: validCwd,
        env: process.env
      });

      // Handle data output from PTY
      state.ptyProcess.onData((data) => {
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send('terminal-incoming-data', data);
        }
      });

      // Handle process exit
      state.ptyProcess.onExit(({ exitCode }) => {
        console.log(`[Terminal] Process exited with code ${exitCode}`);
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send('terminal-incoming-data', 
            `\r\n[Processo encerrado com código ${exitCode}]\r\n`);
        }
        state.ptyProcess = null;
      });

      console.log('[Terminal] PTY spawned successfully');
      event.reply('terminal-spawned', { success: true, terminalId });
      
    } catch (error) {
      console.error('[Terminal] Failed to spawn PTY:', error);
      event.reply('terminal-spawned', { success: false, error: error.message });
    }
  });

  // Write data to terminal
  ipcMain.on('terminal-write', (event, data) => {
    // Handle both string and object formats for compatibility
    const writeData = typeof data === 'object' ? data.data : data;
    
    if (!writeData) return;
    
    // Handle emulator process (legacy support)
    if (state.emulatorProcess) {
      try {
        state.emulatorProcess.stdin.write(writeData);
      } catch (e) {
        console.warn('Erro ao escrever no stdin do emulador:', e);
      }
      return;
    }
    
    // Handle PTY process
    if (state.ptyProcess) {
      try {
        state.ptyProcess.write(writeData);
      } catch (e) {
        console.warn('Erro ao escrever no PTY:', e);
      }
    }
  });

  // Resize terminal
  ipcMain.on('terminal-resize', (event, { cols, rows }) => {
    if (state.ptyProcess) {
      try {
        state.ptyProcess.resize(cols, rows);
      } catch (e) {
        console.warn('Erro ao redimensionar terminal:', e);
      }
    }
  });

  // Cleanup terminal
  ipcMain.on('terminal-cleanup', (event) => {
    if (state.ptyProcess) {
      try {
        state.ptyProcess.kill();
        console.log('[Terminal] PTY killed');
      } catch (e) {
        console.warn('Erro ao encerrar PTY:', e);
      }
      state.ptyProcess = null;
    }
  });
}
