import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { state } from '../state.js'
import { loadConfigFile } from '../utils.js'
import { resolveEmulatorPath, findRomOutput } from '../emulatorUtils.js'
import { parseCompilationOutput } from '../../utils/errorParser.js'

export function setupGameHandlers() {
  ipcMain.on('run-game', (event, result) => {
    const projectPath = result.path
    const toolkitPath = result.toolkitPath
    
    if (state.currentBuildProcess) {
      try { process.kill(-state.currentBuildProcess.pid, 'SIGTERM'); } catch(e) { state.currentBuildProcess.kill(); }
      state.currentBuildProcess = null;
    }
    if (state.emulatorProcess) {
      try { state.emulatorProcess.kill(); } catch(e) {}
      state.emulatorProcess = null;
    }

    const configData = loadConfigFile('emulator-config.json', { selectedEmulator: 'gen_sdl2' });
    let selectedEmulatorName = configData.selectedEmulator || 'gen_sdl2';

    if (!toolkitPath || !fs.existsSync(toolkitPath)) {
      event.reply('run-game-error', { message: 'Toolkit path inválido.' })
      return
    }

    if (!projectPath || !fs.existsSync(projectPath)) {
      event.reply('run-game-error', { message: 'Projeto inválido.' })
      return
    }

    const toolkitRunner = path.join(toolkitPath, 'dgen')
    const selectedEmulatorPath = resolveEmulatorPath(selectedEmulatorName)
    const defaultEmulator = selectedEmulatorPath || resolveEmulatorPath('gen_sdl2')

    const envMake = `MARSDEV="${toolkitPath}"`
    const buildCommand = `${envMake} make`

    if (state.mainWindow) {
      console.log(`[Build] Starting: ${buildCommand}`);
      state.mainWindow.webContents.send('terminal-incoming-data', `\r\n> Iniciando build: ${buildCommand}\r\n`);
    }

    let buildOutput = '';
    state.currentBuildProcess = spawn('sh', ['-c', `cd "${projectPath}" && ${buildCommand}`], {
      detached: true,
      cwd: projectPath
    });

    state.currentBuildProcess.stdout.on('data', (data) => {
      const text = data.toString();
      buildOutput += text;
      console.log(`[Build stdout] ${text.trim()}`);
      if (state.mainWindow) state.mainWindow.webContents.send('terminal-incoming-data', text.replace(/\n/g, '\r\n'));
    });

    state.currentBuildProcess.stderr.on('data', (data) => {
      const text = data.toString();
      buildOutput += text;
      console.log(`[Build stderr] ${text.trim()}`);
      if (state.mainWindow) state.mainWindow.webContents.send('terminal-incoming-data', text.replace(/\n/g, '\r\n'));
    });

    state.currentBuildProcess.on('close', (code) => {
      const wasKilled = state.currentBuildProcess === null;
      state.currentBuildProcess = null;
      
      if (wasKilled && code !== 0) return;

      const errors = parseCompilationOutput(buildOutput)
      if (errors.length > 0) {
        event.reply('compilation-errors', { errors, output: buildOutput })
      }
      
      if (code !== 0) {
        event.reply('run-game-error', { message: `Build falhou com código ${code}.` })
        return
      }

      const romPath = findRomOutput(projectPath)
      if (!romPath) {
        event.reply('run-game-error', { message: 'ROM não encontrada após o build.' })
        return
      }

      const emulatorToUse = defaultEmulator && fs.existsSync(defaultEmulator) ? defaultEmulator : toolkitRunner

    if (state.mainWindow) {
      const runCommand = `"${emulatorToUse}" "${romPath}"`;
      console.log(`[Emulator] Running: ${runCommand}`);
      state.mainWindow.webContents.send('terminal-incoming-data', `\r\n> Executando: ${runCommand}\r\n`);
    }

      try {
        state.emulatorProcess = spawn(emulatorToUse, [romPath], {
          cwd: projectPath,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        state.emulatorProcess.stdout.on('data', (data) => {
          const output = data.toString();
          console.log(`[Emulator stdout] ${output.trim()}`);
          if (state.mainWindow) state.mainWindow.webContents.send('terminal-incoming-data', output.replace(/\n/g, '\r\n'));
        });

        state.emulatorProcess.stderr.on('data', (data) => {
          const output = data.toString();
          console.log(`[Emulator stderr] ${output.trim()}`);
          if (state.mainWindow) state.mainWindow.webContents.send('terminal-incoming-data', output.replace(/\n/g, '\r\n'));
        });

        state.emulatorProcess.on('close', (code) => {
          state.emulatorProcess = null;
          event.reply('emulator-closed', { code });
        });

        state.emulatorProcess.on('error', (err) => {
          state.emulatorProcess = null;
          event.reply('run-game-error', { message: `Erro ao iniciar emulador: ${err.message}` });
        });

        event.reply('run-game-build-complete', { romPath, emulator: emulatorToUse });
      } catch (e) {
        event.reply('run-game-error', { message: `Falha ao disparar emulador: ${e.message}` });
      }
    })
  });
}
