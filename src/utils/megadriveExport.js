/**
 * Mega Drive Export Utilities
 * Converts visual scene data to SGDK C code
 */

/**
 * Convert scene nodes to SGDK background calls
 */
export function exportBackgroundsToCode(nodes) {
  let code = `// Auto-generated background definitions\n\n`
  
  const bgNodes = nodes.filter(n => n.type === 'background')
  
  if (bgNodes.length === 0) {
    return code + `// No backgrounds in scene\n`
  }
  
  bgNodes.forEach((node) => {
    const bgResName = node.properties?.backgroundId 
      ? node.properties.backgroundId.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
      : 'NULL'
    
    const plane = node.properties?.plane || 'BG_B'
    
    code += `// Background: ${node.name || 'Unnamed'}\n`
    if (bgResName !== 'NULL') {
      code += `VDP_drawImage(${plane}, &${bgResName}, ${node.x / 8}, ${node.y / 8});\n`
    } else {
      code += `// [Warning] No resource assigned to this background\n`
    }
    code += `\n`
  })
  
  return code
}

/**
 * Convert scene nodes to SGDK sprite definitions
 */
export function exportSpritesToCode(nodes) {
  let code = `// Auto-generated sprite definitions\n\n`
  code += `#include <genesis.h>\n\n`
  
  const spriteNodes = nodes.filter(n => n.type === 'sprite')
  
  if (spriteNodes.length === 0) {
    return code + `// No sprites in scene\n`
  }
  
  // 1. Declare sprite pointers
  code += `// Sprite Pointers\n`
  spriteNodes.forEach((node) => {
    const spriteName = `sprite_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`
    code += `Sprite* ${spriteName};\n`
  })
  code += `\n`

  // 2. Generate initialization function
  code += `void load_sprites() {\n`
  spriteNodes.forEach((node) => {
    const spriteName = `sprite_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`
    const resName = node.properties?.spriteId 
      ? node.properties.spriteId.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
      : 'NULL'
    
    const palette = node.properties?.paletteId || 'PAL0'
    
    code += `    // Sprite: ${node.name || 'Unnamed'}\n`
    if (resName !== 'NULL') {
      code += `    ${spriteName} = SPR_addSprite(&${resName}, ${node.x}, ${node.y}, TILE_ATTR(${palette}, TRUE, FALSE, FALSE));\n`
      
      if (node.properties?.animIndex !== undefined) {
        code += `    SPR_setAnim(${spriteName}, ${node.properties.animIndex});\n`
      }
      if (node.properties?.frameIndex !== undefined) {
        code += `    SPR_setFrame(${spriteName}, ${node.properties.frameIndex});\n`
      }
    } else {
      code += `    // [Warning] No resource assigned to ${spriteName}\n`
    }
    code += `\n`
  })
  code += `}\n`
  
  return code
}

/**
 * Convert palette to Mega Drive format
 * Mega Drive uses 15-bit RGB (5 bits per channel)
 */
export function exportPaletteToCode(palette) {
  if (!palette || !palette.colors) {
    return `// No palette data\n`
  }
  
  let code = `// Palette: ${palette.name || 'Unnamed'}\n`
  code += `const u16 palette_${palette.id.replace(/[^a-zA-Z0-9]/g, '_')}[] = {\n`
  
  const colors = []
  palette.colors.forEach((hex, index) => {
    const rgb = hexToMegaDriveRGB(hex)
    // Mega Drive format: 0b0BBB_BBGG_GGGR_RRRR
    const mdColor = (rgb.b << 9) | (rgb.g << 5) | rgb.r
    colors.push(`    0x${mdColor.toString(16).padStart(4, '0')}  // Color ${index}: ${hex}`)
  })
  
  code += colors.join(',\n')
  code += `\n};\n\n`
  
  return code
}

/**
 * Convert hex color to Mega Drive RGB (5 bits per channel)
 */
function hexToMegaDriveRGB(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  
  return {
    r: Math.floor(r / 8),  // 0-31
    g: Math.floor(g / 8),  // 0-31
    b: Math.floor(b / 8)  // 0-31
  }
}

/**
 * Convert tile data to Mega Drive tile format
 * Mega Drive tiles are 8x8 pixels, 4 bits per pixel (16 colors)
 */
export function exportTileToCode(tile) {
  if (!tile || !tile.data) {
    return `// No tile data\n`
  }
  
  let code = `// Tile: ${tile.name || 'Unnamed'}\n`
  code += `const u32 tile_${tile.id.replace(/[^a-zA-Z0-9]/g, '_')}[] = {\n`
  
  // Mega Drive tiles are stored as 32-bit words
  // Each word contains 8 pixels (4 bits each)
  const tileData = []
  
  for (let y = 0; y < 8; y++) {
    let word = 0
    for (let x = 0; x < 8; x++) {
      const index = y * 8 + x
      const colorIndex = tile.data[index] || 0
      // Each pixel is 4 bits, so we pack 8 pixels into 32 bits
      word |= (colorIndex & 0xF) << ((7 - x) * 4)
    }
    tileData.push(`    0x${word.toString(16).padStart(8, '0')}`)
  }
  
  code += tileData.join(',\n')
  code += `\n};\n\n`
  
  return code
}

/**
 * Export complete scene to SGDK code
 */
export function exportSceneToCode(sceneData) {
  let code = `// Auto-generated scene code from Retro Studio\n`
  code += `// Scene: ${sceneData.name || 'Unnamed'}\n`
  code += `// Generated: ${new Date().toISOString()}\n\n`
  code += `#include <genesis.h>\n\n`
  
  // Export palettes
  if (sceneData.resources?.palettes) {
    code += `// ========== PALETTES ==========\n\n`
    sceneData.resources.palettes.forEach(palette => {
      code += exportPaletteToCode(palette)
    })
  }
  
  // Export tiles
  if (sceneData.resources?.tiles) {
    code += `// ========== TILES ==========\n\n`
    sceneData.resources.tiles.forEach(tile => {
      code += exportTileToCode(tile)
    })
  }
  
  // Export backgrounds
  if (sceneData.nodes) {
    code += `// ========== BACKGROUNDS ==========\n\n`
    code += exportBackgroundsToCode(sceneData.nodes)
  }
  
  // Export sprites
  if (sceneData.nodes) {
    code += `// ========== SPRITES ==========\n\n`
    code += exportSpritesToCode(sceneData.nodes)
  }
  
  // Main scene function
  code += `// ========== SCENE FUNCTION ==========\n\n`
  code += `void initScene_${sceneData.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'main'}(void) {\n`
  code += `    // Initialize scene\n`
  code += `    // TODO: Add initialization code\n`
  code += `}\n\n`
  
  code += `void updateScene_${sceneData.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'main'}(void) {\n`
  code += `    // Update scene\n`
  code += `    // TODO: Add update code\n`
  code += `}\n`
  
  return code
}
