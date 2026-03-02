import fs from 'fs'
import path from 'path'
import os from 'os'
import { ipcMain } from 'electron'

class PluginManager {
    constructor() {
        this.plugins = new Map()
        // Pasta de plugins no diretório config do usuário
        const homeDir = os.homedir()
        this.pluginsDir = path.join(homeDir, '.config', 'retro-studio', 'plugins')
        if (process.platform === 'win32') {
            this.pluginsDir = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'retro-studio', 'plugins')
        }
    }

    init() {
        try {
            if (!fs.existsSync(this.pluginsDir)) {
                fs.mkdirSync(this.pluginsDir, { recursive: true })
            }
            this.loadPlugins()
            this.setupIPC()
        } catch (e) {
            console.error('[PluginManager] Falha ao inicializar:', e)
        }
    }

    loadPlugins() {
        try {
            const folders = fs.readdirSync(this.pluginsDir)
            for (const folder of folders) {
                const pluginPath = path.join(this.pluginsDir, folder)
                const stat = fs.statSync(pluginPath)

                if (stat.isDirectory()) {
                    const indexFile = path.join(pluginPath, 'index.js')
                    if (fs.existsSync(indexFile)) {
                        try {
                            import(`file://${indexFile}`).then(module => {
                                const plugin = module.default
                                if (plugin && typeof plugin.init === 'function') {
                                    plugin.init({ ipcMain, pluginsDir: this.pluginsDir, broadcastEvent: this.broadcastEvent.bind(this) })
                                    this.plugins.set(folder, plugin)
                                    console.log(`[PluginManager] Plugin carregado: ${folder}`)
                                }
                            }).catch(err => {
                                console.error(`[PluginManager] Erro no import do plugin ${folder}:`, err)
                            })
                        } catch (err) {
                            console.error(`[PluginManager] Erro ao carregar plugin ${folder}:`, err)
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[PluginManager] Erro ao ler pasta de plugins:', e)
        }
    }

    setupIPC() {
        // API centralizada para frontend triggar ações no backend do plugin
        ipcMain.handle('plugins:execute', async (event, { pluginName, action, payload }) => {
            const plugin = this.plugins.get(pluginName)
            if (plugin && typeof plugin.execute === 'function') {
                try {
                    return await plugin.execute(action, payload)
                } catch (e) {
                    return { success: false, error: e.message }
                }
            }
            return { success: false, error: `Plugin ${pluginName} não encontrado ou sem execute().` }
        })

        // API para comunicação broadcast de eventos customizados do frontend
        ipcMain.on('plugins:emit', (event, { eventName, payload }) => {
            // Reflete pro frontend via canais on. Todos que escutarem receberão.
            event.sender.send(`plugins:on:${eventName}`, payload)
        })
    }

    // Método para pacotes backend enviarem eventos pro frontend
    broadcastEvent(win, eventName, payload) {
        if (win && !win.isDestroyed()) {
            win.webContents.send(`plugins:on:${eventName}`, payload)
        }
    }
}

export const pluginManager = new PluginManager()
