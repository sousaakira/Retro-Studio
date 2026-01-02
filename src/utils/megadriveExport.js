/**
 * Mega Drive Export Utilities
 * Converts visual scene data to SGDK C code
 */

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
  
  // Generate sprite definitions
  spriteNodes.forEach((node) => {
    const spriteName = `sprite_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`
    code += `// Sprite: ${node.name || 'Unnamed'}\n`
    code += `Sprite ${spriteName};\n`
    code += `${spriteName}.x = ${node.x};\n`
    code += `${spriteName}.y = ${node.y};\n`
    code += `${spriteName}.width = ${node.width || 16};\n`
    code += `${spriteName}.height = ${node.height || 16};\n`
    
    if (node.properties?.spriteId) {
      code += `${spriteName}.spriteId = ${node.properties.spriteId};\n`
    }
    if (node.properties?.paletteId !== undefined) {
      code += `${spriteName}.paletteId = ${node.properties.paletteId};\n`
    }
    if (node.properties?.priority !== undefined) {
      code += `${spriteName}.priority = ${node.properties.priority};\n`
    }
    
    code += `\n`
  })
  
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
