"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const pty = require("node-pty");
const child_process = require("child_process");
const state = {
  mainWindow: null,
  ptyProcess: null,
  emulatorProcess: null,
  currentBuildProcess: null,
  currentEmulatorConfig: { selectedEmulator: "gen_sdl2" },
  helpWatcher: null
};
const CONFIG_DIR = path.join(electron.app.getPath("home"), ".retrostudio");
const EMULATORS_DIR = path.join(CONFIG_DIR, "emulators");
const TOOLKIT_DIR = path.join(CONFIG_DIR, "toolkit");
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!fs.existsSync(EMULATORS_DIR)) {
    fs.mkdirSync(EMULATORS_DIR, { recursive: true });
  }
  if (!fs.existsSync(TOOLKIT_DIR)) {
    fs.mkdirSync(TOOLKIT_DIR, { recursive: true });
  }
}
function saveConfigFile(filename, data) {
  try {
    ensureConfigDir();
    const filePath = path.join(CONFIG_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (error) {
    console.error(`Erro ao salvar arquivo de config ${filename}:`, error);
    return false;
  }
}
function loadConfigFile(filename, defaultValue = {}) {
  try {
    const filePath = path.join(CONFIG_DIR, filename);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (error) {
    console.error(`Erro ao carregar arquivo de config ${filename}:`, error);
  }
  return defaultValue;
}
function getAppPathSafe() {
  try {
    if (electron.app && typeof electron.app.getAppPath === "function") {
      return electron.app.getAppPath();
    }
  } catch (error) {
    console.warn("Não foi possível obter appPath:", error);
  }
  return null;
}
function copyDirectoryRecursive(source, destination) {
  const stats = fs.statSync(source);
  if (stats.isDirectory()) {
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(destination, { recursive: true });
    }
    const entries = fs.readdirSync(source);
    entries.forEach((entry) => {
      const srcPath = path.join(source, entry);
      const destPath = path.join(destination, entry);
      copyDirectoryRecursive(srcPath, destPath);
    });
    return;
  }
  fs.copyFileSync(source, destination);
}
function resolveProjectRoot(projectPath) {
  if (!projectPath) {
    throw new Error("Caminho do projeto não informado.");
  }
  const resolved = path.resolve(projectPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error("Projeto inválido ou inacessível.");
  }
  return resolved;
}
function ensurePathInsideProject(projectRoot, candidatePath) {
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedCandidate = path.resolve(candidatePath);
  if (!resolvedCandidate.startsWith(resolvedRoot)) {
    throw new Error("Operação fora do diretório do projeto.");
  }
  return resolvedCandidate;
}
function sanitizeEntryName(name) {
  if (!name || typeof name !== "string") {
    throw new Error("Nome inválido.");
  }
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Nome inválido.");
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("Nome não pode conter separadores de diretórios.");
  }
  return trimmed;
}
function ensureEntryExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error("Entrada não encontrada.");
  }
}
function buildUniqueName(baseName, existingNames) {
  if (!existingNames.has(baseName)) {
    return baseName;
  }
  const extensionIndex = baseName.lastIndexOf(".");
  const hasExtension = extensionIndex > 0;
  const namePart = hasExtension ? baseName.slice(0, extensionIndex) : baseName;
  const extensionPart = hasExtension ? baseName.slice(extensionIndex) : "";
  let counter = 1;
  let candidate = `${namePart} copy${extensionPart}`;
  while (existingNames.has(candidate)) {
    counter += 1;
    candidate = `${namePart} copy ${counter}${extensionPart}`;
  }
  return candidate;
}
function setupHelpWatcher(win) {
  if (state.helpWatcher) {
    try {
      state.helpWatcher.close();
    } catch (e) {
      console.error("[Help] Erro ao fechar watcher anterior:", e);
    }
  }
  const candidates = [
    path.join(electron.app.getAppPath(), "docs"),
    path.join(__dirname, "..", "..", "docs"),
    path.join(__dirname, "..", "docs"),
    path.join(process.cwd(), "docs")
  ];
  let docsDir = null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      docsDir = candidate;
      break;
    }
  }
  if (!docsDir) {
    console.warn("[Help] Diretório docs não encontrado para Hot Reload");
    return;
  }
  console.log("[Help] Configurando Hot Reload em:", docsDir);
  let timeout;
  try {
    const isLinux = process.platform === "linux";
    state.helpWatcher = fs.watch(docsDir, { recursive: !isLinux }, (eventType, filename) => {
      if (filename && filename.endsWith(".md")) {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          if (win && !win.isDestroyed()) {
            console.log(`[Help] Mudança detectada: ${filename}. Recarregando conteúdo...`);
            win.webContents.send("help-content-updated");
          }
        }, 500);
      }
    });
  } catch (err) {
    console.error("[Help] Falha ao iniciar watcher:", err);
  }
}
const isDevelopment$1 = process.env.NODE_ENV !== "production";
async function createWindow() {
  const iconPath = isDevelopment$1 ? path.join(process.cwd(), "public", "icon.png") : path.join(__dirname, "../dist", "icon.png");
  try {
    new electron.Tray(iconPath);
  } catch (e) {
    console.warn("Falha ao carregar ícone da bandeja:", e.message);
  }
  const cursorPoint = electron.screen.getCursorScreenPoint();
  const targetDisplay = electron.screen.getDisplayNearestPoint(cursorPoint);
  const { x: displayX, y: displayY, width: displayWidth, height: displayHeight } = targetDisplay.workArea;
  const windowWidth = 1500;
  const windowHeight = 867;
  const windowX = Math.floor(displayX + (displayWidth - windowWidth) / 2);
  const windowY = Math.floor(displayY + (displayHeight - windowHeight) / 2);
  const preloadPath = path.join(__dirname, "preload.js");
  state.mainWindow = new electron.BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: windowX,
    y: windowY,
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: preloadPath,
      devTools: true,
      sandbox: false
    },
    icon: iconPath,
    show: false
  });
  state.mainWindow.once("ready-to-show", () => {
    console.log("[Main] Event: ready-to-show");
    state.mainWindow.setPosition(windowX, windowY);
    state.mainWindow.show();
    if (isDevelopment$1) {
      console.log("[Main] Janela pronta - Abrindo DevTools");
      state.mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });
  setTimeout(() => {
    if (state.mainWindow && !state.mainWindow.isDestroyed() && !state.mainWindow.isVisible()) {
      console.warn("[Main] Timeout: ready-to-show demorou demais, mostrando janela forçadamente");
      state.mainWindow.show();
    }
  }, 5e3);
  setupHelpWatcher(state.mainWindow);
  state.mainWindow.on("maximize", () => {
    state.mainWindow.webContents.send("window-control-state", { isMaximized: true });
  });
  state.mainWindow.on("unmaximize", () => {
    state.mainWindow.webContents.send("window-control-state", { isMaximized: false });
  });
  state.mainWindow.webContents.on("devtools-opened", () => {
    state.mainWindow.webContents.send("status-message", { message: "DevTools Aberto", type: "info" });
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    console.log("[Main] Loading URL:", process.env.VITE_DEV_SERVER_URL);
    try {
      await state.mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
      console.log("[Main] URL loaded successfully");
    } catch (error) {
      console.error("[Main] Failed to load URL, falling back to local file:", error);
      state.mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    }
  } else {
    console.log("[Main] Loading local index.html");
    state.mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}
function setupAppMenu() {
  const menuTemplate = [
    { label: "RetroStudio", submenu: [{ role: "quit" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] }
  ];
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(menuTemplate));
  electron.globalShortcut.register("CommandOrControl+Shift+I", () => {
    if (state.mainWindow) {
      state.mainWindow.webContents.isDevToolsOpened() ? state.mainWindow.webContents.closeDevTools() : state.mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });
  electron.globalShortcut.register("F5", () => {
    if (state.mainWindow) state.mainWindow.webContents.reload();
  });
}
function setupFsHandlers() {
  electron.ipcMain.on("get-home", (event) => {
    const homeDirectory = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
    if (homeDirectory) {
      const caminhoNoHome = path.resolve(homeDirectory);
      const resultDir = navigateDirectory(path.join(caminhoNoHome));
      event.reply("send-directory", resultDir);
    } else {
      console.error("Não foi possível determinar o diretório home.");
    }
  });
  electron.ipcMain.on("current-path", (event) => {
    const resultDir = navigateDirectory(path.join(process.cwd()));
    event.reply("send-directory", resultDir);
  });
  electron.ipcMain.on("directory-navigate", (event, result) => {
    const resultDir = navigateDirectory(result.path);
    event.reply("send-directory", resultDir);
  });
  electron.ipcMain.on("back-directory-navigate", (event, result) => {
    const diretorioPai = path.resolve(result.path, "..");
    const resultDir = navigateDirectory(diretorioPai);
    event.reply("send-directory", resultDir);
  });
  electron.ipcMain.on("fs-create-entry", (event, payload) => {
    try {
      const { projectPath, targetDir, entryName, entryType, templatePath } = payload || {};
      const projectRoot = resolveProjectRoot(projectPath);
      const sanitizedName = sanitizeEntryName(entryName);
      const absoluteTargetDir = ensurePathInsideProject(projectRoot, targetDir);
      if (!["file", "folder"].includes(entryType)) {
        throw new Error("Tipo de entrada inválido.");
      }
      const destinationPath = path.join(absoluteTargetDir, sanitizedName);
      if (fs.existsSync(destinationPath)) {
        throw new Error("Já existe um item com esse nome.");
      }
      if (entryType === "folder") {
        fs.mkdirSync(destinationPath, { recursive: true });
      } else {
        if (templatePath) {
          const resolvedTemplate = ensurePathInsideProject(projectRoot, templatePath);
          fs.copyFileSync(resolvedTemplate, destinationPath);
        } else {
          fs.writeFileSync(destinationPath, "", "utf-8");
        }
      }
      sendFsResult(event, "create", { success: true, path: destinationPath });
    } catch (error) {
      console.error("fs-create-entry error:", error);
      sendFsResult(event, "create", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("fs-rename-entry", (event, payload) => {
    try {
      const { projectPath, targetPath, newName } = payload || {};
      const projectRoot = resolveProjectRoot(projectPath);
      const absoluteTargetPath = ensurePathInsideProject(projectRoot, targetPath);
      ensureEntryExists(absoluteTargetPath);
      const sanitizedName = sanitizeEntryName(newName);
      const destinationPath = path.join(path.dirname(absoluteTargetPath), sanitizedName);
      if (fs.existsSync(destinationPath)) {
        throw new Error("Já existe um item com esse nome.");
      }
      fs.renameSync(absoluteTargetPath, destinationPath);
      sendFsResult(event, "rename", { success: true, path: destinationPath, previousPath: absoluteTargetPath });
    } catch (error) {
      console.error("fs-rename-entry error:", error);
      sendFsResult(event, "rename", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("fs-delete-entry", (event, payload) => {
    try {
      const { projectPath, targetPath } = payload || {};
      const projectRoot = resolveProjectRoot(projectPath);
      const absoluteTargetPath = ensurePathInsideProject(projectRoot, targetPath);
      ensureEntryExists(absoluteTargetPath);
      const stats = fs.statSync(absoluteTargetPath);
      if (stats.isDirectory()) {
        fs.rmSync(absoluteTargetPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(absoluteTargetPath);
      }
      sendFsResult(event, "delete", { success: true, path: absoluteTargetPath });
    } catch (error) {
      console.error("fs-delete-entry error:", error);
      sendFsResult(event, "delete", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("fs-copy-entry", (event, payload) => {
    try {
      const { projectPath, sourcePath, targetDir } = payload || {};
      const projectRoot = resolveProjectRoot(projectPath);
      const absoluteSourcePath = ensurePathInsideProject(projectRoot, sourcePath);
      ensureEntryExists(absoluteSourcePath);
      const absoluteTargetDir = ensurePathInsideProject(projectRoot, targetDir);
      ensureEntryExists(absoluteTargetDir);
      const baseName = path.basename(absoluteSourcePath);
      const existingNames = new Set(fs.readdirSync(absoluteTargetDir));
      const newName = buildUniqueName(baseName, existingNames);
      const destinationPath = path.join(absoluteTargetDir, newName);
      copyEntryRecursive(absoluteSourcePath, destinationPath);
      sendFsResult(event, "copy", { success: true, path: destinationPath });
    } catch (error) {
      console.error("fs-copy-entry error:", error);
      sendFsResult(event, "copy", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("fs-move-entry", (event, payload) => {
    try {
      const { projectPath, sourcePath, targetDir } = payload || {};
      const projectRoot = resolveProjectRoot(projectPath);
      const absoluteSourcePath = ensurePathInsideProject(projectRoot, sourcePath);
      ensureEntryExists(absoluteSourcePath);
      const absoluteTargetDir = ensurePathInsideProject(projectRoot, targetDir);
      ensureEntryExists(absoluteTargetDir);
      const destinationPath = path.join(absoluteTargetDir, path.basename(absoluteSourcePath));
      if (fs.existsSync(destinationPath)) {
        throw new Error("Já existe um item com esse nome no destino.");
      }
      fs.renameSync(absoluteSourcePath, destinationPath);
      sendFsResult(event, "move", { success: true, path: destinationPath });
    } catch (error) {
      console.error("fs-move-entry error:", error);
      sendFsResult(event, "move", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("fs-open-with", (event, payload) => {
    try {
      const { projectPath, targetPath } = payload || {};
      const projectRoot = resolveProjectRoot(projectPath);
      const absoluteTargetPath = ensurePathInsideProject(projectRoot, targetPath);
      ensureEntryExists(absoluteTargetPath);
      electron.shell.openPath(absoluteTargetPath);
      sendFsResult(event, "open-with", { success: true, path: absoluteTargetPath });
    } catch (error) {
      console.error("fs-open-with error:", error);
      sendFsResult(event, "open-with", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("open-file", (event, pathFile) => {
    const result = lerConteudoArquivo(pathFile);
    event.reply("receive-file", result);
  });
  electron.ipcMain.on("save-file", (event, data) => {
    const filePath = data.path;
    const contentFile = data.cod;
    fs.writeFile(filePath, contentFile, "utf-8", (err) => {
      if (err) {
        console.error("Erro on save file: ", err);
      }
    });
  });
}
function navigateDirectory(caminho) {
  try {
    const stats = fs.statSync(caminho);
    if (stats.isDirectory() && (path.basename(caminho) === "out" || path.basename(caminho).startsWith("."))) {
      return null;
    }
    const item = {
      id: "" + Math.random(),
      label: path.basename(caminho),
      tipo: stats.isDirectory() ? "diretorio" : "arquivo",
      path: caminho,
      expanded: false
    };
    if (stats.isDirectory()) {
      const conteudo = fs.readdirSync(caminho).map((subItem) => {
        const subCaminho = path.join(caminho, subItem);
        try {
          const subStats = fs.statSync(subCaminho);
          if (subStats.isDirectory() && !subItem.startsWith(".")) {
            return {
              id: "" + Math.random(),
              label: subItem,
              tipo: "diretorio",
              path: subCaminho,
              expanded: false
            };
          }
        } catch (error) {
          return null;
        }
      });
      item.children = conteudo.filter(Boolean);
    }
    return item;
  } catch (error) {
    console.error("Erro on navigateDirectory: ", error);
    return null;
  }
}
function copyEntryRecursive(source, destination) {
  const stats = fs.statSync(source);
  if (stats.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    fs.readdirSync(source).forEach((entry) => {
      copyEntryRecursive(
        path.join(source, entry),
        path.join(destination, entry)
      );
    });
    return;
  }
  fs.copyFileSync(source, destination);
}
function sendFsResult(event, operation, payload = {}, requestId = null) {
  event.reply("fs-operation-result", {
    operation,
    requestId,
    ...payload
  });
}
function lerConteudoArquivo(caminhoArquivo) {
  try {
    if (!caminhoArquivo || typeof caminhoArquivo !== "string") {
      console.error("[lerConteudoArquivo] Caminho invalido");
      return null;
    }
    const caminho = caminhoArquivo.trim();
    if (caminho.startsWith("make:") || caminho.includes("***")) {
      console.error("[lerConteudoArquivo] Linha de erro, nao eh arquivo");
      return null;
    }
    if (!fs.existsSync(caminho)) {
      console.error("[lerConteudoArquivo] Arquivo nao encontrado:", caminho);
      return null;
    }
    console.log("[lerConteudoArquivo] Lendo:", caminho);
    return fs.readFileSync(caminho, "utf-8");
  } catch (error) {
    console.error("[lerConteudoArquivo] Erro:", error.message);
    return null;
  }
}
const TEMPLATE_DIRECTORIES = {
  "md-skeleton": "md-skeleton",
  "32x-skeleton": "32x-skeleton",
  "sgdk-skeleton": "sgdk-skeleton",
  "sgdk-stage9-sample": "sgdk-stage9-sample"
};
function resolveTemplateAbsolutePath(templateDir) {
  const candidates = [];
  const appPath = getAppPathSafe();
  const projectRoot = path.resolve(__dirname, "..");
  const resourcesPath = process.resourcesPath;
  candidates.push(path.join(TOOLKIT_DIR, "examples", templateDir));
  if (appPath) {
    candidates.push(path.join(appPath, "toolkit", "examples", templateDir));
    candidates.push(path.join(appPath, "src", "toolkit", "examples", templateDir));
    candidates.push(path.join(appPath, "..", "src", "toolkit", "examples", templateDir));
  }
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, "toolkit", "examples", templateDir));
    candidates.push(path.join(resourcesPath, "app.asar.unpacked", "toolkit", "examples", templateDir));
  }
  candidates.push(path.join(__dirname, "toolkit", "examples", templateDir));
  candidates.push(path.join(projectRoot, "src", "toolkit", "examples", templateDir));
  candidates.push(path.join(projectRoot, "toolkit", "examples", templateDir));
  candidates.push(path.join(process.cwd(), "toolkit", "examples", templateDir));
  candidates.push(path.join(process.cwd(), "src", "toolkit", "examples", templateDir));
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  console.warn(`Template "${templateDir}" não encontrado. Caminhos testados:`, candidates);
  return null;
}
function getTemplatePath(templateKey) {
  const key = TEMPLATE_DIRECTORIES[templateKey] ? templateKey : "md-skeleton";
  return {
    key,
    absolutePath: resolveTemplateAbsolutePath(TEMPLATE_DIRECTORIES[key])
  };
}
function lerDiretorio(caminho) {
  const stats = fs.statSync(caminho);
  if (stats.isDirectory() && (path.basename(caminho) === "out" || path.basename(caminho).startsWith("."))) {
    return null;
  }
  const item = {
    id: "" + Math.random(),
    label: path.basename(caminho),
    tipo: stats.isDirectory() ? "diretorio" : "arquivo",
    path: caminho,
    expanded: false
  };
  if (stats.isDirectory()) {
    const conteudo = fs.readdirSync(caminho).map((subItem) => {
      const subCaminho = path.join(caminho, subItem);
      if (path.basename(subCaminho) !== "out") {
        return lerDiretorio(subCaminho);
      }
      return null;
    }).filter(Boolean).sort((a, b) => {
      if (a.tipo === "diretorio" && b.tipo === "arquivo") {
        return -1;
      } else if (a.tipo === "arquivo" && b.tipo === "diretorio") {
        return 1;
      } else {
        return 0;
      }
    });
    item.children = conteudo;
  }
  return item;
}
function getProjectConfig(projectPath) {
  const configPath = path.join(projectPath, "retro-studio.json");
  let config = {
    name: path.basename(projectPath),
    template: "md-skeleton",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    resourcePath: "res",
    assets: []
  };
  try {
    if (fs.existsSync(configPath)) {
      const fileData = fs.readFileSync(configPath, "utf-8");
      const savedConfig = JSON.parse(fileData);
      config = { ...config, ...savedConfig };
    } else {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log("[IPC] retro-studio.json criado em:", projectPath);
    }
  } catch (error) {
    console.error("[IPC] Erro ao ler/criar retro-studio.json:", error);
  }
  return config;
}
function getResourcePath(projectPath) {
  const config = getProjectConfig(projectPath);
  return path.join(projectPath, config.resourcePath || "res");
}
function detectAssetType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if ([".pal", ".act"].includes(ext)) return "palette";
  if ([".wav", ".mp3", ".ogg", ".vgm", ".vgz"].includes(ext)) return "sound";
  if ([".json", ".res"].includes(ext)) return "tilemap";
  if ([".png", ".jpg", ".jpeg", ".gif", ".bmp"].includes(ext)) return null;
  return null;
}
function scanResourcesFolder(projectPath) {
  try {
    const resDir = getResourcePath(projectPath);
    const config = getProjectConfig(projectPath);
    if (!fs.existsSync(resDir)) {
      return {
        success: true,
        newAssets: [],
        unidentifiedAssets: []
      };
    }
    const getAllFiles = (dir) => {
      const files = [];
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        try {
          const stats = fs.statSync(fullPath);
          if (stats.isFile()) {
            files.push(fullPath);
          } else if (stats.isDirectory()) {
            files.push(...getAllFiles(fullPath));
          }
        } catch (e) {
          console.warn("[IPC] Erro ao acessar:", fullPath, e.message);
        }
      }
      return files;
    };
    const allFiles = getAllFiles(resDir);
    const existingPaths = (config.assets || []).map((a) => a.path);
    const newFiles = allFiles.filter((f) => {
      const relPath = path.relative(projectPath, f);
      return !existingPaths.includes(relPath);
    });
    const newAssets = [];
    const unidentifiedAssets = [];
    for (const fullPath of newFiles) {
      const filename = path.basename(fullPath);
      const stats = fs.statSync(fullPath);
      const detectedType = detectAssetType(filename);
      const assetInfo = {
        name: filename,
        size: stats.size,
        path: path.relative(projectPath, fullPath),
        createdAt: stats.birthtime && stats.birthtime.toISOString() || (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: stats.mtime && stats.mtime.toISOString() || (/* @__PURE__ */ new Date()).toISOString()
      };
      if (detectedType) {
        newAssets.push({
          ...assetInfo,
          type: detectedType,
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          metadata: detectedType === "palette" ? {} : {}
        });
      } else if ([".png", ".jpg", ".jpeg", ".gif", ".bmp"].includes(path.extname(filename).toLowerCase())) {
        unidentifiedAssets.push(assetInfo);
      }
    }
    console.log(`[IPC] Escaneo de recursos: ${newAssets.length} identificados, ${unidentifiedAssets.length} aguardando classificação`);
    return {
      success: true,
      newAssets,
      unidentifiedAssets
    };
  } catch (error) {
    console.error("[IPC] Erro ao escanear recursos:", error);
    return {
      success: false,
      error: error.message,
      newAssets: [],
      unidentifiedAssets: []
    };
  }
}
function setupProjectHandlers() {
  electron.ipcMain.on("req-projec", (event, result) => {
    const estrutura = lerDiretorio(result.path);
    const config = getProjectConfig(result.path);
    event.reply("read-files", { estrutura, config });
  });
  electron.ipcMain.on("get-project-config", (event, projectPath) => {
    const config = getProjectConfig(projectPath);
    event.reply("project-config", config);
  });
  electron.ipcMain.on("add-asset-to-config", (event, { projectPath, asset }) => {
    try {
      const config = getProjectConfig(projectPath);
      if (!config.assets) config.assets = [];
      const assetExists = config.assets.some((a) => a.id === asset.id);
      if (!assetExists) {
        config.assets.push(asset);
      }
      const configPath = path.join(projectPath, "retro-studio.json");
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      event.reply("add-asset-result", { success: true, config });
    } catch (error) {
      console.error("[IPC] Erro ao adicionar asset:", error);
      event.reply("add-asset-result", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("save-project-config", (event, { projectPath, config }) => {
    try {
      const configPath = path.join(projectPath, "retro-studio.json");
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      event.reply("save-project-config-result", { success: true });
    } catch (error) {
      console.error("[IPC] Erro ao salvar retro-studio.json:", error);
      event.reply("save-project-config-result", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("remove-asset-from-config", (event, { projectPath, assetId }) => {
    try {
      const config = getProjectConfig(projectPath);
      if (!config.assets) config.assets = [];
      config.assets = config.assets.filter((a) => a.id !== assetId);
      const configPath = path.join(projectPath, "retro-studio.json");
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      event.reply("remove-asset-result", { success: true });
    } catch (error) {
      console.error("[IPC] Erro ao remover asset:", error);
      event.reply("remove-asset-result", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("create-project", (event, projectData) => {
    try {
      const { name, path: basePath, template } = projectData;
      if (!name || !basePath) {
        event.returnValue = { success: false, error: "Name and path are required" };
        return;
      }
      const projectPath = path.join(basePath, name);
      if (fs.existsSync(projectPath)) {
        event.returnValue = { success: false, error: "Directory already exists" };
        return;
      }
      const { absolutePath, key } = getTemplatePath(template);
      if (!fs.existsSync(absolutePath)) {
        event.returnValue = { success: false, error: `Template "${key}" not found` };
        return;
      }
      fs.mkdirSync(projectPath, { recursive: true });
      copyDirectoryRecursive(absolutePath, projectPath);
      const scenesDir = path.join(projectPath, "scenes");
      if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
      const metadata = {
        name,
        template: key,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        resourcePath: "res",
        assets: []
      };
      fs.writeFileSync(path.join(projectPath, "retro-studio.json"), JSON.stringify(metadata, null, 2));
      event.returnValue = { success: true, path: projectPath };
    } catch (error) {
      console.error("Error creating project:", error);
      event.returnValue = { success: false, error: error.message };
    }
  });
  electron.ipcMain.on("scan-resources", (event, projectPath) => {
    try {
      const result = scanResourcesFolder(projectPath);
      event.reply("scan-resources-result", result);
    } catch (error) {
      console.error("[IPC] Erro no handler scan-resources:", error);
      event.reply("scan-resources-result", { success: false, error: error.message, newAssets: [], unidentifiedAssets: [] });
    }
  });
  electron.ipcMain.on("add-detected-assets", (event, { projectPath, assets }) => {
    try {
      const config = getProjectConfig(projectPath);
      if (!config.assets) config.assets = [];
      for (const asset of assets) {
        const exists = config.assets.some((a) => a.name === asset.name);
        if (!exists) config.assets.push(asset);
      }
      const configPath = path.join(projectPath, "retro-studio.json");
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      event.reply("add-detected-assets-result", { success: true, config });
    } catch (error) {
      console.error("[IPC] Erro ao adicionar assets detectados:", error);
      event.reply("add-detected-assets-result", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("copy-asset-to-project", (event, data) => {
    try {
      const { projectPath, filename, buffer } = data;
      const resDir = getResourcePath(projectPath);
      if (!fs.existsSync(resDir)) fs.mkdirSync(resDir, { recursive: true });
      const assetPath = path.join(resDir, filename);
      fs.writeFileSync(assetPath, Buffer.from(buffer));
      const relativePath = path.relative(projectPath, assetPath);
      event.reply("copy-asset-result", { success: true, assetPath: relativePath });
    } catch (error) {
      console.error("[IPC] Erro ao copiar asset:", error);
      event.reply("copy-asset-result", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("register-asset-resource", (event, data) => {
    try {
      const { projectPath, resourceEntry, assetName } = data;
      const resDir = getResourcePath(projectPath);
      const resourcesPath = path.join(resDir, "resources.res");
      if (!fs.existsSync(resourcesPath)) {
        if (!fs.existsSync(resDir)) fs.mkdirSync(resDir, { recursive: true });
        fs.writeFileSync(resourcesPath, "");
      }
      let content = fs.readFileSync(resourcesPath, "utf-8");
      const lines = content.split("\n");
      const newParts = resourceEntry.split(/\s+/);
      const newResName = newParts[1];
      let entryUpdated = false;
      const newLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2 && parts[1] === newResName) {
          entryUpdated = true;
          return resourceEntry;
        }
        return line;
      });
      if (entryUpdated) {
        fs.writeFileSync(resourcesPath, newLines.join("\n"));
      } else {
        if (content && !content.endsWith("\n")) content += "\n";
        content += resourceEntry + "\n";
        fs.writeFileSync(resourcesPath, content);
      }
      event.reply("register-asset-result", { success: true, message: `Asset "${assetName}" registrado com sucesso` });
    } catch (error) {
      console.error("[IPC] Erro ao registrar asset:", error);
      event.reply("register-asset-result", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("get-res-files", (event, projectPath) => {
    try {
      const resDir = getResourcePath(projectPath);
      if (!fs.existsSync(resDir)) {
        event.reply("get-res-files-result", { success: true, files: [] });
        return;
      }
      const getAllFiles = (dir) => {
        let files2 = [];
        if (!fs.existsSync(dir)) return [];
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const fullPath = path.join(dir, entry);
          const stats = fs.statSync(fullPath);
          if (stats.isFile()) {
            files2.push(path.relative(projectPath, fullPath));
          } else if (stats.isDirectory()) {
            files2.push(...getAllFiles(fullPath));
          }
        }
        return files2;
      };
      const files = getAllFiles(resDir);
      event.reply("get-res-files-result", { success: true, files });
    } catch (error) {
      console.error("[IPC] Erro ao obter arquivos recursivos:", error);
      event.reply("get-res-files-result", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("get-palette-colors", (event, data) => {
    try {
      const { projectPath, assetPath } = data;
      const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(projectPath, assetPath);
      if (!fs.existsSync(fullPath)) throw new Error("Arquivo de paleta não encontrado");
      const ext = path.extname(fullPath).toLowerCase();
      let colors = [];
      if (ext === ".pal") {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        if (lines.length > 0 && lines[0] && lines[0].trim().startsWith("JASC-PAL")) {
          const count = parseInt(lines[2]);
          for (let i = 0; i < count && 3 + i < lines.length; i++) {
            const parts = lines[3 + i].trim().split(/\s+/);
            if (parts.length >= 3) {
              const r = parseInt(parts[0]), g = parseInt(parts[1]), b = parseInt(parts[2]);
              const hex = `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
              colors.push({ r, g, b, hex });
            }
          }
        }
      } else if (ext === ".act") {
        const buffer = fs.readFileSync(fullPath);
        if (buffer.length >= 768) {
          for (let i = 0; i < 256; i++) {
            const r = buffer[i * 3], g = buffer[i * 3 + 1], b = buffer[i * 3 + 2];
            const hex = `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
            colors.push({ r, g, b, hex });
          }
        }
      }
      event.reply("get-palette-colors-result", { success: true, colors, assetPath });
    } catch (error) {
      console.error("[IPC] Erro ao extrair cores:", error);
      event.reply("get-palette-colors-result", { success: false, error: error.message });
    }
  });
  electron.ipcMain.handle("get-asset-preview", async (event, data) => {
    try {
      const { projectPath, assetPath } = data;
      const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(projectPath, assetPath);
      if (!fs.existsSync(fullPath)) return { success: false, error: "Arquivo não encontrado" };
      const ext = path.extname(fullPath).toLowerCase();
      if ([".png", ".jpg", ".jpeg", ".gif", ".bmp"].includes(ext)) {
        const buffer = fs.readFileSync(fullPath);
        const base64 = buffer.toString("base64");
        const mime = ext === ".png" ? "image/png" : "image/jpeg";
        return { success: true, assetPath, preview: `data:${mime};base64,${base64}` };
      }
      return { success: false, error: "Tipo não suportado" };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("get-palette-colors", async (event, data) => {
    try {
      const { projectPath, assetPath } = data;
      const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(projectPath, assetPath);
      if (!fs.existsSync(fullPath)) return { success: false, error: "Não encontrado" };
      const ext = path.extname(fullPath).toLowerCase();
      let colors = [];
      if (ext === ".pal") {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        if (lines.length > 0 && lines[0] && lines[0].trim().startsWith("JASC-PAL")) {
          const count = parseInt(lines[2]);
          for (let i = 0; i < count && 3 + i < lines.length; i++) {
            const parts = lines[3 + i].trim().split(/\s+/);
            if (parts.length >= 3) {
              colors.push({ r: parseInt(parts[0]), g: parseInt(parts[1]), b: parseInt(parts[2]), hex: `#${parts.slice(0, 3).map((x) => parseInt(x).toString(16).padStart(2, "0")).join("")}`.toUpperCase() });
            }
          }
        }
      }
      return { success: true, colors, assetPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.on("get-asset-preview", (event, data) => {
    try {
      const { projectPath, assetPath } = data;
      const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(projectPath, assetPath);
      if (!fs.existsSync(fullPath)) throw new Error("Arquivo não encontrado");
      const ext = path.extname(fullPath).toLowerCase();
      if ([".png", ".jpg", ".jpeg", ".gif", ".bmp"].includes(ext)) {
        const buffer = fs.readFileSync(fullPath);
        const base64 = buffer.toString("base64");
        const mime = ext === ".png" ? "image/png" : "image/jpeg";
        event.reply("get-asset-preview-result", { success: true, assetPath, preview: `data:${mime};base64,${base64}` });
      } else {
        event.reply("get-asset-preview-result", { success: false, assetPath, error: "Tipo de arquivo não suportado" });
      }
    } catch (error) {
      console.error("[IPC] Erro ao obter preview:", error);
      event.reply("get-asset-preview-result", { success: false, assetPath: data.assetPath, error: error.message });
    }
  });
  electron.ipcMain.on("rename-asset-file", (event, data) => {
    try {
      const { projectPath, oldFileName, newName, oldPath } = data;
      const resDir = getResourcePath(projectPath);
      let realOldFilePath = oldPath ? path.join(projectPath, oldPath) : path.join(resDir, oldFileName);
      if (!fs.existsSync(realOldFilePath)) {
        const getAllFiles = (dir) => {
          const files = [];
          const entries = fs.readdirSync(dir);
          for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            if (fs.statSync(fullPath).isFile()) {
              if (path.basename(fullPath) === oldFileName) files.push(fullPath);
            } else {
              files.push(...getAllFiles(fullPath));
            }
          }
          return files;
        };
        const foundFiles = getAllFiles(resDir);
        if (foundFiles.length > 0) realOldFilePath = foundFiles[0];
      }
      if (!realOldFilePath || !fs.existsSync(realOldFilePath)) {
        event.reply("rename-asset-result", { success: false, error: `Arquivo "${oldFileName}" não encontrado.` });
        return;
      }
      const extension = path.extname(realOldFilePath);
      const newFileName = newName.includes(".") ? newName : newName + extension;
      const newFilePath = path.join(path.dirname(realOldFilePath), newFileName);
      if (fs.existsSync(newFilePath)) {
        event.reply("rename-asset-result", { success: false, error: "Já existe um arquivo com este nome" });
        return;
      }
      fs.renameSync(realOldFilePath, newFilePath);
      const getAllResFiles = (dir) => {
        let results = [];
        const list = fs.readdirSync(dir);
        list.forEach((file) => {
          file = path.join(dir, file);
          if (fs.statSync(file).isDirectory()) results = results.concat(getAllResFiles(file));
          else if (file.endsWith(".res")) results.push(file);
        });
        return results;
      };
      const resFiles = getAllResFiles(resDir);
      resFiles.forEach((resFile) => {
        let content = fs.readFileSync(resFile, "utf-8");
        if (content.includes(oldFileName)) {
          content = content.split(oldFileName).join(newFileName);
          fs.writeFileSync(resFile, content);
        }
      });
      event.reply("rename-asset-result", { success: true, oldFileName, newFileName, newPath: path.relative(projectPath, newFilePath) });
    } catch (error) {
      console.error("[IPC] Erro ao renomear arquivo:", error);
      event.reply("rename-asset-result", { success: false, error: error.message });
    }
  });
  electron.ipcMain.handle("find-definition-in-project", async (event, { projectPath, symbolName }) => {
    try {
      if (!projectPath || !fs.existsSync(projectPath)) return null;
      const srcPath = path.join(projectPath, "src");
      if (!fs.existsSync(srcPath)) return null;
      const searchInDir = (dir) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stats = fs.statSync(fullPath);
          if (stats.isDirectory()) {
            const result = searchInDir(fullPath);
            if (result) return result;
          } else if (file.endsWith(".c") || file.endsWith(".h")) {
            const content = fs.readFileSync(fullPath, "utf-8");
            const funcRegex = new RegExp(`(?:^|\\n)\\s*(?:(?:static|inline|extern|volatile)\\s+)*(?:[\\w*]+\\s+)+${symbolName}\\s*\\([^)]*\\)\\s*\\{`, "m");
            const funcMatch = funcRegex.exec(content);
            if (funcMatch) {
              const linesBefore = content.substring(0, funcMatch.index).split("\n");
              return { path: fullPath, line: linesBefore.length, column: linesBefore[linesBefore.length - 1].length + 1 };
            }
            const defineRegex = new RegExp(`^\\s*#define\\s+${symbolName}\\b`, "m");
            const defineMatch = defineRegex.exec(content);
            if (defineMatch) {
              const linesBefore = content.substring(0, defineMatch.index).split("\n");
              return { path: fullPath, line: linesBefore.length, column: linesBefore[linesBefore.length - 1].indexOf(symbolName) + 1 };
            }
            const varRegex = new RegExp(`(?:^|\\n)\\s*(?:(?:static|extern|volatile|const)\\s+)*(?:[a-zA-Z_]\\w*\\*?\\s+)+${symbolName}\\s*(?:[=;|,])`, "m");
            const varMatch = varRegex.exec(content);
            if (varMatch) {
              const linesBefore = content.substring(0, varMatch.index).split("\n");
              return { path: fullPath, line: linesBefore.length, column: linesBefore[linesBefore.length - 1].indexOf(symbolName) + 1 };
            }
          }
        }
        return null;
      };
      return searchInDir(srcPath);
    } catch (error) {
      console.error("Error in find-definition-in-project:", error);
      return null;
    }
  });
}
function setupTerminalHandlers() {
  electron.ipcMain.on("stop-game", (event) => {
    if (state.currentBuildProcess) {
      try {
        process.kill(-state.currentBuildProcess.pid, "SIGTERM");
      } catch (e) {
        if (state.currentBuildProcess) state.currentBuildProcess.kill();
      }
      state.currentBuildProcess = null;
    }
    if (state.emulatorProcess) {
      try {
        state.emulatorProcess.kill();
      } catch (e) {
        console.error("Erro ao matar emulador:", e);
      }
      state.emulatorProcess = null;
    }
    event.reply("emulator-closed", { code: 0, interrupted: true });
  });
  electron.ipcMain.on("terminal-spawn", (event, { cwd }) => {
    if (state.ptyProcess) {
      try {
        state.ptyProcess.kill();
      } catch (e) {
        console.error("Erro ao encerrar PTY anterior:", e);
      }
    }
    const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
    try {
      state.ptyProcess = pty.spawn(shell, [], {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd: cwd || os.homedir(),
        env: process.env
      });
      state.ptyProcess.onData((data) => {
        if (state.mainWindow) {
          state.mainWindow.webContents.send("terminal-incoming-data", data);
        }
      });
      state.ptyProcess.onExit(({ exitCode }) => {
        if (state.mainWindow) {
          state.mainWindow.webContents.send("terminal-incoming-data", `\r
[Processo encerrado com código ${exitCode}]\r
`);
        }
        state.ptyProcess = null;
      });
    } catch (error) {
      console.error("Falha ao iniciar PTY:", error);
      event.reply("terminal-incoming-data", `\r
Erro ao iniciar terminal: ${error.message}\r
`);
    }
  });
  electron.ipcMain.on("terminal-write", (event, data) => {
    if (state.emulatorProcess) {
      try {
        state.emulatorProcess.stdin.write(data);
      } catch (e) {
        console.warn("Erro ao escrever no stdin do emulador:", e);
      }
    } else if (state.ptyProcess) {
      state.ptyProcess.write(data);
    }
  });
  electron.ipcMain.on("terminal-resize", (event, { cols, rows }) => {
    if (state.ptyProcess) {
      try {
        state.ptyProcess.resize(cols, rows);
      } catch (e) {
        console.warn("Erro ao redimensionar terminal:", e);
      }
    }
  });
}
const AVAILABLE_EMULATORS = {
  "gen_sdl2": ["toolkit", "emulators", "md", "gen_sdl2"],
  "blastem": ["toolkit", "emulators", "blastem", "blastem"],
  "picodrive": ["toolkit", "emulators", "PicoDrive", "picodrive"]
};
function resolveEmulatorPath(emulatorName = null) {
  const appPath = getAppPathSafe();
  const projectRoot = path.resolve(__dirname, "..");
  const resourcesPath = process.resourcesPath;
  const emulatorKey = emulatorName || "gen_sdl2";
  const relativePath = AVAILABLE_EMULATORS[emulatorKey] || AVAILABLE_EMULATORS["gen_sdl2"];
  const userEmulatorPath = path.join(EMULATORS_DIR, ...relativePath.slice(2));
  const candidateBuilders = [
    () => userEmulatorPath,
    () => appPath && path.join(appPath, ...relativePath),
    () => appPath && path.join(appPath, "src", ...relativePath),
    () => resourcesPath && path.join(resourcesPath, ...relativePath),
    () => resourcesPath && path.join(resourcesPath, "app.asar.unpacked", ...relativePath),
    () => path.join(__dirname, ...relativePath),
    () => path.join(projectRoot, "src", ...relativePath),
    () => path.join(projectRoot, ...relativePath),
    () => path.join(process.cwd(), ...relativePath),
    () => path.join(process.cwd(), "src", ...relativePath)
  ];
  for (const buildCandidate of candidateBuilders) {
    const candidate = buildCandidate();
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
function getAvailableEmulators() {
  const available = {};
  for (const [name] of Object.entries(AVAILABLE_EMULATORS)) {
    const resolvedPath = resolveEmulatorPath(name);
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      available[name] = resolvedPath;
    }
  }
  return available;
}
function findRomOutput(projectPath) {
  const preferredCandidates = [
    path.join(projectPath, "out", "rom.bin"),
    path.join(projectPath, "rom.bin"),
    path.join(projectPath, "out", "out.bin"),
    path.join(projectPath, "out.bin")
  ];
  for (const candidate of preferredCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  const scanDirs = [projectPath, path.join(projectPath, "out")];
  let latestRom = null;
  let latestTime = 0;
  scanDirs.forEach((dir) => {
    if (!dir || !fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir);
    entries.forEach((entry) => {
      if (!/\.(bin|32x)$/i.test(entry)) return;
      const entryPath = path.join(dir, entry);
      try {
        const stats = fs.statSync(entryPath);
        if (stats.isFile() && stats.mtimeMs >= latestTime) {
          latestRom = entryPath;
          latestTime = stats.mtimeMs;
        }
      } catch (err) {
        console.warn("Falha ao inspecionar ROM candidate:", entryPath, err);
      }
    });
  });
  return latestRom;
}
function setupEmulatorHandlers() {
  electron.ipcMain.on("get-available-emulators", (event) => {
    try {
      const available = getAvailableEmulators();
      event.reply("available-emulators", {
        success: true,
        emulators: Object.keys(available),
        paths: available
      });
    } catch (error) {
      console.error("Error getting available emulators:", error);
      event.reply("available-emulators", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("get-emulator-config", (event) => {
    const config = loadConfigFile("emulator-config.json", { selectedEmulator: "gen_sdl2" });
    event.reply("emulator-config", { success: true, config });
  });
  electron.ipcMain.on("set-emulator-config", (event, configData) => {
    const success = saveConfigFile("emulator-config.json", configData);
    event.reply("emulator-config-updated", { success });
  });
  electron.ipcMain.on("get-custom-emulator-paths", (event) => {
    const paths = loadConfigFile("custom-emulator-paths.json", { gen_sdl2: "", blastem: "" });
    event.reply("custom-emulator-paths", { success: true, paths });
  });
  electron.ipcMain.on("set-custom-emulator-paths", (event, paths) => {
    const success = saveConfigFile("custom-emulator-paths.json", paths);
    event.reply("custom-emulator-paths", { success, paths });
  });
  electron.ipcMain.on("browse-emulator-path", async (event, { emulator }) => {
    try {
      const result = await electron.dialog.showOpenDialog(state.mainWindow, {
        title: `Select ${emulator === "blastem" ? "BlastEm" : "Genesis SDL2"} Executable`,
        defaultPath: process.env.HOME,
        properties: ["openFile"],
        filters: [
          { name: "Executable Files", extensions: ["", "exe", "bin"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });
      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        event.reply("emulator-path-selected", {
          emulator,
          path: selectedPath,
          success: true
        });
      }
    } catch (error) {
      console.error("Error browsing for emulator path:", error);
      event.reply("emulator-path-selected", {
        emulator,
        success: false,
        error: error.message
      });
    }
  });
}
function setupSceneHandlers() {
  electron.ipcMain.on("save-scene", (event, sceneData) => {
    try {
      const sceneObj = sceneData.scene || sceneData;
      const projectPath = sceneData.projectPath || sceneObj.projectPath || sceneObj.path || __dirname;
      const sceneName = sceneObj.name || "scene";
      const nodes = sceneData.nodes || sceneObj.nodes || [];
      if (!projectPath || projectPath === __dirname) {
        console.error("No valid project path available for saving scene");
        event.reply("save-scene-result", { success: false, error: "Caminho do projeto inválido" });
        return;
      }
      const scenePath = path.join(projectPath, "scenes", `${sceneName}.json`);
      const sceneDir = path.dirname(scenePath);
      if (!fs.existsSync(sceneDir)) {
        fs.mkdirSync(sceneDir, { recursive: true });
      }
      const dataToSave = {
        ...sceneObj,
        nodes,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      fs.writeFile(scenePath, JSON.stringify(dataToSave, null, 2), "utf-8", (err) => {
        if (err) {
          console.error("Error saving scene file:", err);
          event.reply("save-scene-result", { success: false, error: err.message });
          return;
        }
        try {
          const config = getProjectConfig(projectPath);
          if (!config.assets) config.assets = [];
          const sceneId = `scene_${sceneName}`;
          const exists = config.assets.some((a) => a.id === sceneId || a.path === path.relative(projectPath, scenePath));
          if (!exists) {
            config.assets.push({
              id: sceneId,
              name: sceneName,
              type: "scene",
              path: path.relative(projectPath, scenePath),
              createdAt: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
          fs.writeFileSync(path.join(projectPath, "retro-studio.json"), JSON.stringify(config, null, 2));
        } catch (cfgErr) {
          console.error("Error updating retro-studio.json with scene:", cfgErr);
        }
        event.reply("save-scene-result", { success: true, path: scenePath });
      });
    } catch (error) {
      console.error("Error in save-scene handler:", error);
      event.reply("save-scene-result", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("load-scene", (event, scenePath) => {
    try {
      if (!fs.existsSync(scenePath)) {
        event.reply("load-scene-result", { success: false, error: "Arquivo não encontrado" });
        return;
      }
      const data = JSON.parse(fs.readFileSync(scenePath, "utf-8"));
      event.reply("load-scene-result", { success: true, scene: data });
    } catch (error) {
      console.error("Error loading scene:", error);
      event.reply("load-scene-result", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("export-scene", (event, sceneData) => {
    try {
      const projectPath = sceneData.projectPath || sceneData.path || process.cwd();
      let code = sceneData.code || `// Auto-generated scene code from Retro Studio
`;
      if (!sceneData.code) {
        code += `// Scene: ${sceneData.name}

`;
        code += `#include <genesis.h>

`;
        if (sceneData.nodes) {
          sceneData.nodes.filter((n) => n.type === "sprite").forEach((node, index) => {
            code += `// Sprite: ${node.name}
`;
            code += `Sprite sprite_${index};
`;
            code += `sprite_${index}.x = ${node.x};
`;
            code += `sprite_${index}.y = ${node.y};
`;
            code += `sprite_${index}.width = ${node.width || 16};
`;
            code += `sprite_${index}.height = ${node.height || 16};

`;
          });
        }
      }
      const exportPath = path.join(projectPath, "src", `scene_${sceneData.name || "main"}.c`);
      const exportDir = path.dirname(exportPath);
      if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
      fs.writeFileSync(exportPath, code, "utf-8");
      event.reply("export-scene-result", { success: true, path: exportPath });
    } catch (error) {
      console.error("Error in export-scene:", error);
      event.reply("export-scene-result", { success: false, error: error.message });
    }
  });
}
function setupUiHandlers() {
  electron.ipcMain.on("save-ui-settings", (event, settings) => {
    saveConfigFile("ui-settings.json", settings);
  });
  electron.ipcMain.handle("get-ui-settings", async () => {
    const settings = loadConfigFile("ui-settings.json", {});
    if (!settings.toolkitPath) {
      const defaultToolkitPath = path.join(TOOLKIT_DIR, "marsdev", "mars");
      if (fs.existsSync(defaultToolkitPath)) {
        settings.toolkitPath = defaultToolkitPath;
      }
    }
    return settings;
  });
  electron.ipcMain.on("window-control", (_event, action) => {
    if (!state.mainWindow) return;
    switch (action) {
      case "minimize":
        state.mainWindow.minimize();
        break;
      case "maximize":
        state.mainWindow.isMaximized() ? state.mainWindow.unmaximize() : state.mainWindow.maximize();
        break;
      case "close":
        state.mainWindow.close();
        break;
    }
  });
  electron.ipcMain.on("select-folder", (event) => {
    electron.dialog.showOpenDialog(state.mainWindow, {
      properties: ["openDirectory"]
    }).then((result) => {
      if (!result.canceled && result.filePaths.length > 0) {
        event.reply("folder-selected", { path: result.filePaths[0] });
      }
    });
  });
  electron.ipcMain.on("select-file", (event, options = {}) => {
    electron.dialog.showOpenDialog(state.mainWindow, {
      title: options.title || "Selecionar Arquivo",
      properties: ["openFile"],
      filters: options.filters || []
    }).then((result) => {
      if (!result.canceled && result.filePaths.length > 0) {
        event.reply("file-selected", { path: result.filePaths[0] });
      }
    });
  });
  electron.ipcMain.on("open-external-editor", (event, { editorPath, filePath }) => {
    if (!editorPath || !filePath) return;
    const { spawn } = require("child_process");
    spawn(editorPath, [filePath], { detached: true, stdio: "ignore" }).unref();
  });
  electron.ipcMain.on("open-external-url", (event, url) => {
    if (url) electron.shell.openExternal(url);
  });
}
const ERROR_PATTERNS = [
  // GCC: file.c:10:5: error: 'x' undeclared
  /^([^:]+):(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/,
  // Formato alternativo: file.c:10: error: message
  /^([^:]+):(\d+):\s*(error|warning|note):\s*(.+)$/,
  // Padrão genérico
  /^(.+?):(\d+):\s*(.+)$/
];
function parseErrorLine(line) {
  if (!line || typeof line !== "string") return null;
  for (const pattern of ERROR_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      const [, file, lineNum, ...rest] = match;
      let type = "error";
      let message = "";
      let column = 1;
      if (rest.length === 3) {
        column = parseInt(rest[0]);
        type = rest[1].toLowerCase();
        message = rest[2];
      } else if (rest.length === 2) {
        type = rest[0].toLowerCase();
        message = rest[1];
      } else {
        message = rest.join(":");
      }
      return {
        file: file.trim(),
        line: parseInt(lineNum),
        column,
        type,
        // 'error', 'warning', 'note'
        message: message.trim(),
        severity: type === "error" ? "error" : type === "warning" ? "warning" : "info"
      };
    }
  }
  return null;
}
function parseCompilationOutput(output) {
  if (!output) return [];
  const lines = output.split("\n");
  const errors = [];
  const seenErrors = /* @__PURE__ */ new Set();
  for (const line of lines) {
    const error = parseErrorLine(line);
    if (error) {
      const key = `${error.file}:${error.line}:${error.message}`;
      if (!seenErrors.has(key)) {
        errors.push(error);
        seenErrors.add(key);
      }
    }
  }
  return errors;
}
function setupGameHandlers() {
  electron.ipcMain.on("run-game", (event, result) => {
    const projectPath = result.path;
    const toolkitPath = result.toolkitPath;
    if (state.currentBuildProcess) {
      try {
        process.kill(-state.currentBuildProcess.pid, "SIGTERM");
      } catch (e) {
        state.currentBuildProcess.kill();
      }
      state.currentBuildProcess = null;
    }
    if (state.emulatorProcess) {
      try {
        state.emulatorProcess.kill();
      } catch (e) {
      }
      state.emulatorProcess = null;
    }
    const configData = loadConfigFile("emulator-config.json", { selectedEmulator: "gen_sdl2" });
    let selectedEmulatorName = configData.selectedEmulator || "gen_sdl2";
    if (!toolkitPath || !fs.existsSync(toolkitPath)) {
      event.reply("run-game-error", { message: "Toolkit path inválido." });
      return;
    }
    if (!projectPath || !fs.existsSync(projectPath)) {
      event.reply("run-game-error", { message: "Projeto inválido." });
      return;
    }
    const toolkitRunner = path.join(toolkitPath, "dgen");
    const selectedEmulatorPath = resolveEmulatorPath(selectedEmulatorName);
    const defaultEmulator = selectedEmulatorPath || resolveEmulatorPath("gen_sdl2");
    const envMake = `MARSDEV="${toolkitPath}"`;
    const buildCommand = `${envMake} make`;
    if (state.mainWindow) {
      state.mainWindow.webContents.send("terminal-incoming-data", `\r
> Iniciando build: ${buildCommand}\r
`);
    }
    let buildOutput = "";
    state.currentBuildProcess = child_process.spawn("sh", ["-c", `cd "${projectPath}" && ${buildCommand}`], {
      detached: true,
      cwd: projectPath
    });
    state.currentBuildProcess.stdout.on("data", (data) => {
      const text = data.toString();
      buildOutput += text;
      if (state.mainWindow) state.mainWindow.webContents.send("terminal-incoming-data", text.replace(/\n/g, "\r\n"));
    });
    state.currentBuildProcess.stderr.on("data", (data) => {
      const text = data.toString();
      buildOutput += text;
      if (state.mainWindow) state.mainWindow.webContents.send("terminal-incoming-data", text.replace(/\n/g, "\r\n"));
    });
    state.currentBuildProcess.on("close", (code) => {
      const wasKilled = state.currentBuildProcess === null;
      state.currentBuildProcess = null;
      if (wasKilled && code !== 0) return;
      const errors = parseCompilationOutput(buildOutput);
      if (errors.length > 0) {
        event.reply("compilation-errors", { errors, output: buildOutput });
      }
      if (code !== 0) {
        event.reply("run-game-error", { message: `Build falhou com código ${code}.` });
        return;
      }
      const romPath = findRomOutput(projectPath);
      if (!romPath) {
        event.reply("run-game-error", { message: "ROM não encontrada após o build." });
        return;
      }
      const emulatorToUse = defaultEmulator && fs.existsSync(defaultEmulator) ? defaultEmulator : toolkitRunner;
      if (state.mainWindow) {
        state.mainWindow.webContents.send("terminal-incoming-data", `\r
> Executando: "${emulatorToUse}" "${romPath}"\r
`);
      }
      try {
        state.emulatorProcess = child_process.spawn(emulatorToUse, [romPath], {
          cwd: projectPath,
          stdio: ["pipe", "pipe", "pipe"]
        });
        state.emulatorProcess.stdout.on("data", (data) => {
          if (state.mainWindow) state.mainWindow.webContents.send("terminal-incoming-data", data.toString().replace(/\n/g, "\r\n"));
        });
        state.emulatorProcess.stderr.on("data", (data) => {
          if (state.mainWindow) state.mainWindow.webContents.send("terminal-incoming-data", data.toString().replace(/\n/g, "\r\n"));
        });
        state.emulatorProcess.on("close", (code2) => {
          state.emulatorProcess = null;
          event.reply("emulator-closed", { code: code2 });
        });
        state.emulatorProcess.on("error", (err) => {
          state.emulatorProcess = null;
          event.reply("run-game-error", { message: `Erro ao iniciar emulador: ${err.message}` });
        });
        event.reply("run-game-build-complete", { romPath, emulator: emulatorToUse });
      } catch (e) {
        event.reply("run-game-error", { message: `Falha ao disparar emulador: ${e.message}` });
      }
    });
  });
}
function setupTutorialHandlers() {
  electron.ipcMain.on("load-markdown-file", (event, args) => {
    try {
      const { filePath } = args || {};
      if (!filePath) {
        event.reply("load-markdown-file-result", { success: false, error: "Caminho do arquivo não fornecido" });
        return;
      }
      let resolvedPath = filePath.startsWith("./") ? filePath.substring(2) : filePath;
      const candidates = [
        path.join(process.cwd(), "docs", "content", "SGDK.wiki", resolvedPath),
        path.join(process.cwd(), "docs", "tutorials", resolvedPath),
        path.join(__dirname, "..", "docs", "content", "SGDK.wiki", resolvedPath),
        path.join(__dirname, "..", "docs", "tutorials", resolvedPath),
        path.join(process.cwd(), resolvedPath),
        filePath
      ];
      let resolvedFile = null;
      for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          resolvedFile = candidate;
          break;
        }
      }
      if (!resolvedFile) {
        event.reply("load-markdown-file-result", { success: false, error: `Arquivo não encontrado: ${filePath}` });
        return;
      }
      const content = fs.readFileSync(resolvedFile, "utf-8");
      const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
      const match = content.match(frontmatterRegex);
      let title = path.basename(resolvedFile, ".md");
      let markdownContent = content;
      if (match) {
        const fm = match[1];
        const titleMatch = fm.match(/title:\s*(.+)/i);
        if (titleMatch) title = titleMatch[1].trim();
        markdownContent = content.replace(frontmatterRegex, "");
      }
      event.reply("load-markdown-file-result", { success: true, content: markdownContent, title });
    } catch (error) {
      console.error("[Help] Erro ao carregar arquivo Markdown:", error);
      event.reply("load-markdown-file-result", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("load-content-topics", async (event, args) => {
    try {
      const { dirPath } = args || {};
      let contentDir = dirPath;
      if (!contentDir) {
        const candidates = [
          path.join(electron.app.getAppPath(), "docs", "content"),
          path.join(__dirname, "..", "..", "docs", "content"),
          path.join(__dirname, "..", "docs", "content"),
          path.join(process.cwd(), "docs", "content")
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            contentDir = candidate;
            break;
          }
        }
      }
      if (!contentDir || !fs.existsSync(contentDir)) {
        event.reply("load-content-topics-result", { success: true, topics: [] });
        return;
      }
      const buildTree = (basePath, relativePath = "") => {
        const fullPath = path.join(basePath, relativePath);
        const items = fs.readdirSync(fullPath);
        const nodes = [];
        for (const item of items) {
          const itemRelativePath = path.join(relativePath, item);
          const itemFullPath = path.join(basePath, itemRelativePath);
          const stats = fs.statSync(itemFullPath);
          if (stats.isDirectory()) {
            const children = buildTree(basePath, itemRelativePath);
            if (children.length > 0) {
              let content = "", title = item.replace(/^\d+-/, "").replace(/-/g, " "), icon = "fas fa-folder";
              const indexPath = path.join(itemFullPath, "index.md");
              if (fs.existsSync(indexPath)) {
                const indexContent = fs.readFileSync(indexPath, "utf-8");
                const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
                const match = indexContent.match(frontmatterRegex);
                if (match) {
                  const fm = match[1];
                  const titleMatch = fm.match(/title:\s*(.+)/i);
                  if (titleMatch) title = titleMatch[1].trim();
                  const iconMatch = fm.match(/icon:\s*(.+)/i);
                  if (iconMatch) icon = iconMatch[1].trim();
                  content = indexContent.replace(frontmatterRegex, "");
                } else content = indexContent;
              }
              nodes.push({ id: `dir_${itemRelativePath.replace(/[\/\\]/g, "_")}`, title, icon, content, children: children.sort((a, b) => a.id.localeCompare(b.id)) });
            }
          } else if (item.endsWith(".md") && item !== "index.md") {
            const content = fs.readFileSync(itemFullPath, "utf-8");
            const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
            const match = content.match(frontmatterRegex);
            let metadata = { title: item.replace(".md", "").replace(/^\d+-/, "").replace(/-/g, " "), icon: "far fa-file-alt" };
            let markdownContent = content;
            if (match) {
              const fm = match[1];
              const titleMatch = fm.match(/title:\s*(.+)/i), iconMatch = fm.match(/icon:\s*(.+)/i);
              if (titleMatch) metadata.title = titleMatch[1].trim();
              if (iconMatch) metadata.icon = iconMatch[1].trim();
              markdownContent = content.replace(frontmatterRegex, "");
            }
            nodes.push({ id: `topic_${itemRelativePath.replace(/[\/\\]/g, "_")}`, title: metadata.title, icon: metadata.icon, content: markdownContent, children: [] });
          }
        }
        return nodes.sort((a, b) => a.id.localeCompare(b.id));
      };
      event.reply("load-content-topics-result", { success: true, topics: buildTree(contentDir) });
    } catch (error) {
      console.error("[Content] Erro ao carregar:", error);
      event.reply("load-content-topics-result", { success: false, error: error.message });
    }
  });
  electron.ipcMain.on("load-tutorials", async (event, args) => {
    try {
      const { dirPath } = args || {};
      let tutorialsDir = dirPath;
      if (!tutorialsDir) {
        const candidates = [
          path.join(electron.app.getAppPath(), "docs", "tutorials"),
          path.join(__dirname, "..", "..", "docs", "tutorials"),
          path.join(__dirname, "..", "docs", "tutorials"),
          path.join(process.cwd(), "docs", "tutorials")
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            tutorialsDir = candidate;
            break;
          }
        }
      }
      if (!tutorialsDir || !fs.existsSync(tutorialsDir)) {
        event.reply("load-tutorials-result", { success: true, tutorials: [] });
        return;
      }
      const files = fs.readdirSync(tutorialsDir).filter((f) => f.endsWith(".md"));
      const tutorials = [];
      for (const file of files) {
        const content = fs.readFileSync(path.join(tutorialsDir, file), "utf-8");
        const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
        const match = content.match(frontmatterRegex);
        let metadata = { title: file.replace(".md", ""), description: "", tags: [] };
        let markdownContent = content;
        if (match) {
          const fm = match[1];
          const titleMatch = fm.match(/title:\s*(.+)/i), descMatch = fm.match(/description:\s*(.+)/i), tagsMatch = fm.match(/tags:\s*\[([^\]]+)\]/i);
          if (titleMatch) metadata.title = titleMatch[1].trim();
          if (descMatch) metadata.description = descMatch[1].trim();
          if (tagsMatch) metadata.tags = tagsMatch[1].split(",").map((t) => t.trim().replace(/["']/g, "")).filter((t) => t);
          markdownContent = content.replace(frontmatterRegex, "");
        }
        tutorials.push({ id: `tutorial_${file.replace(".md", "")}`, title: metadata.title, description: metadata.description, tags: metadata.tags, content: markdownContent });
      }
      event.reply("load-tutorials-result", { success: true, tutorials });
    } catch (error) {
      console.error("[Tutorials] Erro ao carregar:", error);
      event.reply("load-tutorials-result", { success: false, error: error.message });
    }
  });
}
const isDevelopment = process.env.NODE_ENV !== "production";
console.log("DEVELOPMENT --------> ", isDevelopment);
if (isDevelopment) {
  electron.app.commandLine.appendSwitch("remote-debugging-port", "9222");
  console.log("[Main] Remote debugging enabled on port 9222");
}
electron.protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { secure: true, standard: true } }
]);
electron.app.on("window-all-closed", () => {
  if (state.ptyProcess) {
    try {
      state.ptyProcess.kill();
    } catch (e) {
      console.error("Erro ao encerrar PTY:", e);
    }
  }
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("activate", () => {
  if (state.mainWindow === null) createWindow();
});
electron.app.on("ready", async () => {
  console.log("[Main] App is ready. Initializing...");
  ensureConfigDir();
  electron.protocol.registerFileProtocol("app", (request, callback) => {
    let url = request.url.replace("app://./", "");
    url = url.replace("app://", "");
    const decodedUrl = decodeURIComponent(url);
    try {
      let filePath = path.join(__dirname, decodedUrl);
      if (fs.existsSync(filePath)) {
        return callback({ path: filePath });
      }
      filePath = path.join(__dirname, "..", decodedUrl);
      if (fs.existsSync(filePath)) {
        return callback({ path: filePath });
      }
      const baseName = path.basename(decodedUrl);
      filePath = path.join(__dirname, baseName);
      if (fs.existsSync(filePath)) {
        return callback({ path: filePath });
      }
      if (decodedUrl.includes("fonts/")) {
        const fontPath = path.join(__dirname, "fonts", baseName);
        if (fs.existsSync(fontPath)) {
          return callback({ path: fontPath });
        }
      }
      const resourcesPath = process.resourcesPath;
      if (resourcesPath) {
        filePath = path.join(resourcesPath, decodedUrl);
        if (fs.existsSync(filePath)) {
          return callback({ path: filePath });
        }
      }
      console.warn("[Protocol] File not found:", decodedUrl);
      callback({ error: -6 });
    } catch (error) {
      console.error("Protocol error:", error);
      callback({ error: -2 });
    }
  });
  electron.protocol.registerFileProtocol("custom", (request, callback) => {
    const url = request.url.replace("custom://", "");
    callback({ path: decodeURIComponent(url) });
  });
  setupFsHandlers();
  setupProjectHandlers();
  setupTerminalHandlers();
  setupEmulatorHandlers();
  setupSceneHandlers();
  setupUiHandlers();
  setupGameHandlers();
  setupTutorialHandlers();
  setupAppMenu();
  createWindow();
});
if (isDevelopment) {
  if (process.platform === "win32") {
    process.on("message", (data) => {
      if (data === "graceful-exit") {
        electron.app.quit();
      }
    });
  } else {
    process.on("SIGTERM", () => {
      electron.app.quit();
    });
  }
}
