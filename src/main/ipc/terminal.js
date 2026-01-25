import { ipcMain } from 'electron'
import os from 'os'
import pty from 'node-pty'
import { state } from '../state.js'

export function setupTerminalHandlers() {
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

  ipcMain.on('terminal-spawn', (event, { cwd }) => {
    if (state.ptyProcess) {
      try {
        state.ptyProcess.kill();
      } catch (e) {
        console.error('Erro ao encerrar PTY anterior:', e);
      }
    }

    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');

    try {
      state.ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: cwd || os.homedir(),
        env: process.env
      });

      state.ptyProcess.onData((data) => {
        if (state.mainWindow) {
          state.mainWindow.webContents.send('terminal-incoming-data', data);
        }
      });

      state.ptyProcess.onExit(({ exitCode }) => {
        if (state.mainWindow) {
          state.mainWindow.webContents.send('terminal-incoming-data', `\r\n[Processo encerrado com código ${exitCode}]\r\n`);
        }
        state.ptyProcess = null;
      });
    } catch (error) {
      console.error('Falha ao iniciar PTY:', error);
      event.reply('terminal-incoming-data', `\r\nErro ao iniciar terminal: ${error.message}\r\n`);
    }
  });

  ipcMain.on('terminal-write', (event, data) => {
    if (state.emulatorProcess) {
      try {
        state.emulatorProcess.stdin.write(data);
      } catch (e) {
        console.warn('Erro ao escrever no stdin do emulador:', e);
      }
    } else if (state.ptyProcess) {
      state.ptyProcess.write(data);
    }
  });

  ipcMain.on('terminal-resize', (event, { cols, rows }) => {
    if (state.ptyProcess) {
      try {
        state.ptyProcess.resize(cols, rows);
      } catch (e) {
        console.warn('Erro ao redimensionar terminal:', e);
      }
    }
  });
}
