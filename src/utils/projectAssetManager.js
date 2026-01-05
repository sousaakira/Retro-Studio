/**
 * Project Asset Manager
 * Gerencia cópia de assets para pasta res/ e registro em resources.res
 */

/**
 * Gera entrada para resources.res baseado no tipo de asset
 */
export function generateResourceEntry(asset) {
  const filename = asset.name.replace(/\.\w+$/, '') // Remove extensão
  
  const typeMap = {
    sprite: 'IMAGE',
    tile: 'IMAGE',
    tilemap: 'TILEMAP',
    palette: 'PALETTE',
    sound: 'SOUND',
    background: 'IMAGE'
  }
  
  const type = typeMap[asset.type] || 'IMAGE'
  const resourceName = filename.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  
  return `${type} ${resourceName} "${asset.name}" 0`
}

/**
 * Copia arquivo para pasta res/ do projeto
 */
export async function copyAssetToProject(file, projectPath) {
  try {
    // Usar IPC para copiar arquivo de forma segura
    return new Promise((resolve, reject) => {
      // Ler arquivo como ArrayBuffer
      const reader = new FileReader()
      
      reader.onload = (e) => {
        const buffer = new Uint8Array(e.target.result)
        
        // Enviar para background.js copiar
        window.ipc?.send('copy-asset-to-project', {
          projectPath,
          filename: file.name,
          buffer: Array.from(buffer)
        })
        
        // Listener para resposta
        const handler = (result) => {
          window.ipc?.off?.('copy-asset-result', handler)
          if (result.success) {
            resolve(result.assetPath)
          } else {
            reject(new Error(result.error))
          }
        }
        window.ipc?.on('copy-asset-result', handler)
      }
      
      reader.onerror = () => reject(new Error('Falha ao ler arquivo'))
      reader.readAsArrayBuffer(file)
    })
  } catch (error) {
    console.error('[projectAssetManager] Erro ao copiar asset:', error)
    throw error
  }
}

/**
 * Registra asset no resources.res
 */
export async function registerAssetInResources(projectPath, asset) {
  try {
    const resourceEntry = generateResourceEntry(asset)
    
    return new Promise((resolve, reject) => {
      window.ipc?.send('register-asset-resource', {
        projectPath,
        resourceEntry,
        assetName: asset.name
      })
      
      const handler = (result) => {
        window.ipc?.off?.('register-asset-result', handler)
        if (result.success) {
          resolve(result)
        } else {
          reject(new Error(result.error))
        }
      }
      window.ipc?.on('register-asset-result', handler)
    })
  } catch (error) {
    console.error('[projectAssetManager] Erro ao registrar asset:', error)
    throw error
  }
}

/**
 * Copia asset para projeto e registra no resources.res
 */
export async function importAssetToProject(file, projectPath, asset) {
  try {
    console.log('[projectAssetManager] Importando asset:', {
      file: file.name,
      project: projectPath,
      assetType: asset.type
    })
    
    // 1. Copiar arquivo para res/
    const assetPath = await copyAssetToProject(file, projectPath)
    asset.path = assetPath
    
    // 2. Registrar no resources.res
    await registerAssetInResources(projectPath, asset)
    
    console.log('[projectAssetManager] Asset importado com sucesso:', assetPath)
    return { success: true, path: assetPath }
  } catch (error) {
    console.error('[projectAssetManager] Erro na importação:', error)
    throw error
  }
}
