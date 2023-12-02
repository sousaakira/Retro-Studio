/* eslint-disable no-unused-vars */
'use strict'

import { app, protocol, BrowserWindow, screen, ipcRenderer } from 'electron'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer'
const isDevelopment = process.env.NODE_ENV !== 'production'

//Executar comandos
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

ipcMain.on('get-home', (event, result) => {
  const homeDirectory = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
  if (homeDirectory) {
    const caminhoNoHome = path.resolve(homeDirectory);
    console.log(caminhoNoHome);
    const resultDir = navigateDirectory(path.join(caminhoNoHome))
    event.reply('send-directory', resultDir);
  } else {
    console.error('Não foi possível determinar o diretório home.');
  }
})

ipcMain.on('current-path', (event, result) => {
  console.log(result)
  console.log(path.join(__dirname))
  const resultDir = navigateDirectory(path.join(__dirname))
  event.reply('send-directory', resultDir);
})

ipcMain.on('directory-navigate', (event, result) => {
  const resultDir = navigateDirectory(result.path)
  event.reply('send-directory', resultDir);
})

ipcMain.on('back-directory-navigate', (event, result) => {

  console.log('navigate: ', result)

  const diretorioPai = path.resolve(result.path, '..');
  const resultDir = navigateDirectory(diretorioPai)
  event.reply('send-directory', resultDir);
})

function navigateDirectory(caminho) {
  try {
    const stats = fs.statSync(caminho);

    // Se o nome do diretório for "out" ou começar com ".", ignore
    if (stats.isDirectory() && (path.basename(caminho) === 'out' || path.basename(caminho).startsWith('.'))) {
      return null;
    }

    const item = {
      id: '' + Math.random(),
      label: path.basename(caminho),
      tipo: stats.isDirectory() ? 'diretorio' : 'arquivo',
      path: caminho,
      expanded: false,
    };

    if (stats.isDirectory()) {
      const conteudo = fs.readdirSync(caminho).map(subItem => {
        const subCaminho = path.join(caminho, subItem);

        try {
          const subStats = fs.statSync(subCaminho);

          // Adiciona apenas diretórios ao array conteudo
          if (subStats.isDirectory() && !subItem.startsWith('.')) {
            return {
              id: '' + Math.random(),
              label: subItem,
              tipo: 'diretorio',
              path: subCaminho,
              expanded: false,
            };
          }
        } catch (error) {
          // Ignora subdiretórios/arquivos inacessíveis
          return null;
        }
      });

      // Filtra e remove diretórios nulos (ignorados)
      item.children = conteudo.filter(Boolean);
    }

    return item;
  } catch (error) {
    console.log('Erro on navigateDirectory: ', error);
    return null;
  }
}




function lerDiretorio(caminho) {
  const stats = fs.statSync(caminho);

  // Se o nome do diretório for "out", ignore
  if (stats.isDirectory() && path.basename(caminho) === 'out') {
    return null;
  }

  const item = {
    id: '' + Math.random(),
    label: path.basename(caminho),
    tipo: stats.isDirectory() ? 'diretorio' : 'arquivo',
    path: caminho,
    expanded: false,
  };

  if (stats.isDirectory()) {
    const conteudo = fs.readdirSync(caminho).map(subItem => {
      const subCaminho = path.join(caminho, subItem);

      // Ignora diretórios com o nome "out"
      if (path.basename(subCaminho) !== 'out') {
        return lerDiretorio(subCaminho);
      }

      return null;
    });

    // Filtra e remove diretórios nulos (ignorados)
    item.children = conteudo.filter(Boolean);
  }

  return item;
}

ipcMain.on('req-projec', (event, result) => { 
  const estrutura = lerDiretorio(result.path); 
  event.reply('read-files', estrutura);
})

ipcMain.on('run-game', (payload) =>{

  console.log('run game')
  console.log(path.join(__dirname,'../'))
  // console.log('Starting: ',payload)
  comando(`cd /home/akira/sgdk-skeleton/ && make && cd ${path.join(__dirname, '../', 'src/toolkit/') } && ./dgen /home/akira/sgdk-skeleton/out/rom.bin`)

  // console.log(path)
  // comando('cd /home/akira/sgdk-skeleton/ && make && cd /mnt/45e9f903-a60c-4c5f-ae44-1c5f0b951ffb/Document/Desenvolvimentos/AkiraProjects/retro-studio/src/toolkit/ && ./dgen /home/akira/sgdk-skeleton/out/rom.bin ')
})

// Função para ler o conteúdo de um arquivo
function lerConteudoArquivo(caminhoArquivo) {
  console.log(caminhoArquivo)
  try {
    const conteudo = fs.readFileSync(caminhoArquivo, 'utf-8');
    return conteudo;
  } catch (error) {
    console.error('Erro ao ler o arquivo:', error);
    return null;
  }
}

ipcMain.on('open-file', (event, pathFile) =>{
  const result = lerConteudoArquivo(pathFile)
  event.reply('receive-file', result)
})

/** Save file */
ipcMain.on('save-file', (event,data) => {
  console.log('Salvando aquivo: ')
  const filePath = data.path
  const contentFile = data.cod


  fs.writeFile(filePath,contentFile, 'utf-8', (err) => {
    if(err){
      console.log('Erro on save file: ', err)
      return
    }
    console.log('File saved susscees')
  })
  console.log(data)
})

function comando(cmd){
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`Erro ao executar o comando: ${error}`);
      return;
    }
    console.log(`Saída do comando: ${stdout}`);
  });
}

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } }
])

async function createWindow() {
  const displays = screen.getAllDisplays();
  const targetDisplay = displays[1];
  const { width, height } = targetDisplay.workAreaSize;

  // Create the browser window.
  const win = new BrowserWindow({
    height: 867,
    width: 1500,
    minHeight: 300,
    minWidth: 300,
    x: width / 2,
    y: height / 2,
    webPreferences: {
      enableRemoteModule: false,
      // eslint-disable-next-line no-undef
      preload: path.resolve(__static, 'preload.js'),
      // Use pluginOptions.nodeIntegration, leave this alone
      // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html#node-integration for more info
      nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
      contextIsolation: !process.env.ELECTRON_NODE_INTEGRATION
    }
  })

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    // Load the url of the dev server if in development mode
    await win.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
    if (!process.env.IS_TEST) win.webContents.openDevTools()
  } else {
    createProtocol('app')
    // Load the index.html when not in development
    win.loadURL('app://./index.html')
  }
}

// Registrar um esquema de protocolo personalizado para carregar arquivos locais
app.whenReady().then(() => {
  protocol.registerFileProtocol('custom', (request, callback) => {
    const url = request.url.replace('custom://', '');
    // const filePath = path.join(__dirname, 'res', url);

    console.log('>>url  ', url)
    // console.log('>> ', url)
    callback({ path: url });
  });
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  if (isDevelopment && !process.env.IS_TEST) {
    // Install Vue Devtools
    try {
      await installExtension(VUEJS3_DEVTOOLS)
    } catch (e) {
      console.error('Vue Devtools failed to install:', e.toString())
    }
  }
  createWindow()
})

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', (data) => {
      if (data === 'graceful-exit') {
        app.quit()
      }
    })
  } else {
    process.on('SIGTERM', () => {
      app.quit()
    })
  }
}
