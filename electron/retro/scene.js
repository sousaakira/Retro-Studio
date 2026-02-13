import { ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { getProjectConfig } from './projectUtils.js'

export function setupSceneHandlers() {
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
      const projectPath = sceneData.projectPath || sceneData.path || process.cwd()
      let code = sceneData.code || `// Auto-generated scene code\n`
      if (!sceneData.code) {
        code += `// Scene: ${sceneData.name}\n\n`
        code += `#include <genesis.h>\n\n`
        if (sceneData.nodes) {
          sceneData.nodes
            .filter((n) => n.type === 'sprite')
            .forEach((node, index) => {
              code += `// Sprite: ${node.name}\n`
              code += `Sprite sprite_${index};\n`
              code += `sprite_${index}.x = ${node.x};\n`
              code += `sprite_${index}.y = ${node.y};\n`
              code += `sprite_${index}.width = ${node.width || 16};\n`
              code += `sprite_${index}.height = ${node.height || 16};\n\n`
            })
        }
      }
      const exportPath = path.join(projectPath, 'src', `scene_${sceneData.name || 'main'}.c`)
      const exportDir = path.dirname(exportPath)
      if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true })
      fs.writeFileSync(exportPath, code, 'utf-8')
      return { success: true, path: exportPath }
    } catch (error) {
      console.error('[Retro] export-scene error:', error)
      return { success: false, error: error.message }
    }
  })
}
