import { ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { getProjectConfig } from './projectUtils.js'
import { exportSceneForProject } from './sceneExport.js'

export function setupSceneHandlers(resolveWorkspace) {
  ipcMain.handle('retro:save-scene', async (_event, sceneData) => {
    try {
      const sceneObj = sceneData.scene || sceneData
      const projectPath = sceneData.projectPath || sceneObj.projectPath || sceneObj.path
      const sceneName = sceneObj.name || 'scene'
      const nodes = sceneData.nodes ?? sceneObj.nodes ?? []

      if (!projectPath) {
        return { success: false, error: 'Caminho do projeto inválido' }
      }

      const scenePath = path.join(projectPath, 'scenes', `${sceneName}.json`)
      const sceneDir = path.dirname(scenePath)

      if (!fs.existsSync(sceneDir)) {
        fs.mkdirSync(sceneDir, { recursive: true })
      }

      const dataToSave = {
        ...sceneObj,
        nodes,
        updatedAt: new Date().toISOString()
      }

      fs.writeFileSync(scenePath, JSON.stringify(dataToSave, null, 2), 'utf-8')

      const config = getProjectConfig(projectPath)
      if (!config.assets) config.assets = []
      const sceneId = `scene_${sceneName}`
      const exists = config.assets.some(
        (a) => a.id === sceneId || a.path === path.relative(projectPath, scenePath)
      )
      if (!exists) {
        config.assets.push({
          id: sceneId,
          name: sceneName,
          type: 'scene',
          path: path.relative(projectPath, scenePath),
          createdAt: new Date().toISOString()
        })
      }
      fs.writeFileSync(path.join(projectPath, 'retro-studio.json'), JSON.stringify(config, null, 2))

      return { success: true, path: scenePath }
    } catch (error) {
      console.error('[Retro] save-scene error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:load-scene', async (_event, scenePath) => {
    try {
      if (!fs.existsSync(scenePath)) {
        return { success: false, error: 'Arquivo não encontrado' }
      }
      const data = JSON.parse(fs.readFileSync(scenePath, 'utf-8'))
      return { success: true, scene: data }
    } catch (error) {
      console.error('[Retro] load-scene error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:export-scene', async (_event, sceneData) => {
    try {
      if (typeof resolveWorkspace !== 'function') throw new Error('No workspace selected')
      return exportSceneForProject(resolveWorkspace(), sceneData)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}
