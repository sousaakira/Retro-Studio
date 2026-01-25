import { ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { getProjectConfig } from '../projectUtils.js'

export function setupSceneHandlers() {
  ipcMain.on('save-scene', (event, sceneData) => {
    try {
      // Get scene object and project path
      const sceneObj = sceneData.scene || sceneData
      const projectPath = sceneData.projectPath || sceneObj.projectPath || sceneObj.path || __dirname
      const sceneName = sceneObj.name || 'scene'
      const nodes = sceneData.nodes || sceneObj.nodes || []
      
      if (!projectPath || projectPath === __dirname) {
        console.error('No valid project path available for saving scene')
        event.reply('save-scene-result', { success: false, error: 'Caminho do projeto inválido' })
        return
      }

      const scenePath = path.join(projectPath, 'scenes', `${sceneName}.json`)
      const sceneDir = path.dirname(scenePath)
      
      if (!fs.existsSync(sceneDir)) {
        fs.mkdirSync(sceneDir, { recursive: true })
      }

      const dataToSave = {
        ...sceneObj,
        nodes: nodes,
        updatedAt: new Date().toISOString()
      }

      fs.writeFile(scenePath, JSON.stringify(dataToSave, null, 2), 'utf-8', (err) => {
        if (err) {
          console.error('Error saving scene file:', err)
          event.reply('save-scene-result', { success: false, error: err.message })
          return
        }
        
        try {
          const config = getProjectConfig(projectPath)
          if (!config.assets) config.assets = []
          const sceneId = `scene_${sceneName}`
          const exists = config.assets.some(a => a.id === sceneId || a.path === path.relative(projectPath, scenePath))
          
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
        } catch (cfgErr) {
          console.error('Error updating retro-studio.json with scene:', cfgErr)
        }

        event.reply('save-scene-result', { success: true, path: scenePath })
      })
    } catch (error) {
      console.error('Error in save-scene handler:', error)
      event.reply('save-scene-result', { success: false, error: error.message })
    }
  })

  ipcMain.on('load-scene', (event, scenePath) => {
    try {
      if (!fs.existsSync(scenePath)) {
        event.reply('load-scene-result', { success: false, error: 'Arquivo não encontrado' })
        return
      }
      const data = JSON.parse(fs.readFileSync(scenePath, 'utf-8'))
      event.reply('load-scene-result', { success: true, scene: data })
    } catch (error) {
      console.error('Error loading scene:', error)
      event.reply('load-scene-result', { success: false, error: error.message })
    }
  })

  ipcMain.on('export-scene', (event, sceneData) => {
    try {
      const projectPath = sceneData.projectPath || sceneData.path || process.cwd()
      let code = sceneData.code || `// Auto-generated scene code from Retro Studio\n`
      if (!sceneData.code) {
        code += `// Scene: ${sceneData.name}\n\n`
        code += `#include <genesis.h>\n\n`
        if (sceneData.nodes) {
          sceneData.nodes.filter(n => n.type === 'sprite').forEach((node, index) => {
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
      event.reply('export-scene-result', { success: true, path: exportPath })
    } catch (error) {
      console.error('Error in export-scene:', error)
      event.reply('export-scene-result', { success: false, error: error.message })
    }
  })
}
