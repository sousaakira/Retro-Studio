/**
 * Resumo da API SGDK para injetar no prompt da IA
 * Fonte: sgdkDocsData, sgdkAutocomplete - funções mais usadas (VDP, SPR, JOY, SYS, XGM)
 */

import fs from 'node:fs'
import path from 'node:path'

export function isSgdkProject(workspacePath) {
  if (!workspacePath || typeof workspacePath !== 'string') return false
  try {
    const makefileGen = path.join(workspacePath, 'makefile.gen')
    const resDir = path.join(workspacePath, 'res')
    return fs.existsSync(makefileGen) || fs.existsSync(resDir)
  } catch {
    return false
  }
}

const SGDK_API_ENTRIES = [
  '#include <genesis.h> - Header principal (use ângulos <>, nunca aspas)',
  'SYS_init() - Inicializa o sistema',
  'SYS_doVBlankProcess() - Processa VBlank (atualiza VDP, som, entrada)',
  'VDP_init() - Inicializa VDP',
  'VDP_setScreenWidth320() - Largura 320px',
  'VDP_setScreenHeight224() - Altura 224px',
  'VDP_setPlaneSize(width, height, updateAuto) - Tamanho do plano em tiles',
  'VDP_setPaletteColor(index, color) - Define cor na paleta',
  'VDP_setPaletteColors(index, palette, count) - Define paleta',
  'VDP_setScreenPalette(palette) - Paleta completa',
  'VDP_loadTileData(data, index, numTiles, wait) - Carrega tiles na VRAM',
  'VDP_loadTileSet(tileset, index, compression) - Carrega tileset',
  'VDP_setTileMapEx(plane, tilemap, compression, x, y) - Define tilemap',
  'VDP_setTileMapXY(plane, tileAttr, x, y) - Define tile em posição',
  'VDP_fillTileMapRect(plane, tileAttr, x, y, w, h) - Preenche área com tiles',
  'VDP_clearTileMapRect(plane, x, y, w, h) - Limpa área',
  'VDP_drawText(text, x, y) - Desenha texto',
  'VDP_drawTextEx(plane, text, tileAttr, x, y, cpu) - Texto com atributos',
  'VDP_clearText(x, y, length) - Limpa texto',
  'VDP_waitVSync() - Aguarda VSync',
  'SPR_init() - Inicializa motor de sprites',
  'SPR_addSprite(spritedef, x, y, attr) - Adiciona sprite',
  'SPR_setPosition(sprite, x, y) - Posição do sprite',
  'SPR_setAnim(sprite, animIndex) - Define animação',
  'SPR_update() - Atualiza todos os sprites',
  'VDP_allocateSprites(num) - Aloca sprites no hardware',
  'VDP_setSprite(index, x, y, size, tileAttr, link) - Sprite VDP direto',
  'JOY_readJoypad(port) - Lê controle (JOY_1, JOY_2)',
  'JOY_getJoypadPress(port) - Botões pressionados',
  'JOY_getJoypadState(port) - Estado atual',
  'BUTTON_UP, BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT - Direções',
  'BUTTON_A, BUTTON_B, BUTTON_C, BUTTON_START - Botões',
  'XGM_startPlay(music) - Inicia música XGM',
  'XGM_stopPlay() - Para música',
  'XGM2_play(&musicData) - Música XGM2',
  'XGM2_playPCM(id, channel, priority) - Efeito sonoro PCM',
  'PSG_setEnvelope(channel, volume) - Volume PSG',
  'PSG_setFrequency(channel, freq) - Frequência PSG',
  'MEM_alloc(size) - Aloca memória',
  'MEM_free(ptr) - Libera memória',
  'KDebug_Alert(msg) - Debug (BlastEm)',
  'VDP_setHorizontalScroll(plane, line, value) - Scroll horizontal',
  'VDP_setVerticalScroll(plane, line, value) - Scroll vertical',
  'DMA_queueDma(dmaEntry, priority) - DMA assíncrono',
  'PALETTE palette - Struct de paleta (16 cores)',
  'SpriteDefinition - Definição de sprite (.res)',
  'TILEMAP - Mapa de tiles (.res)'
]

const MAX_ENTRIES = 55
const MAX_CHARS = 2400

/**
 * Retorna bloco de texto com resumo da API SGDK para o prompt
 */
export function getSdkApiBlock() {
  const entries = SGDK_API_ENTRIES.slice(0, MAX_ENTRIES)
  let text = entries.join('\n')
  if (text.length > MAX_CHARS) {
    text = text.substring(0, MAX_CHARS) + '\n...'
  }
  return `\n\n--- API SGDK (resumo) ---\n${text}\n--- FIM API SGDK ---`
}
