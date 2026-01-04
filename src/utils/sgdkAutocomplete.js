/**
 * SGDK Autocomplete Provider for Monaco Editor
 * Fornece sugestões de código, funções e tipos do SGDK
 */

export const sgdkCompletionProvider = {
  provideCompletionItems: (model, position) => {
    if (!model || !position || position.lineNumber < 1 || position.lineNumber > model.getLineCount()) {
      return { suggestions: [] }
    }
    const wordUntilPosition = model.getWordUntilPosition(position)
    const range = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: wordUntilPosition.startColumn,
      endColumn: wordUntilPosition.endColumn
    }

    return {
      suggestions: [
        // Funções de Sistema
        ...sgdkSystemFunctions.map(fn => ({
          label: fn.name,
          kind: 1, // Function
          documentation: fn.description,
          insertText: fn.snippet,
          insertTextRules: 4, // InsertAsSnippet
          range,
          detail: fn.returns
        })),
        
        // Tipos
        ...sgdkTypes.map(type => ({
          label: type.name,
          kind: 5, // Class
          documentation: type.description,
          insertText: type.name,
          range,
          detail: type.detail
        })),
        
        // Structs
        ...sgdkStructs.map(struct => ({
          label: struct.name,
          kind: 5, // Class
          documentation: struct.description,
          insertText: struct.name,
          range,
          detail: 'struct'
        })),
        
        // Constantes
        ...sgdkConstants.map(constant => ({
          label: constant.name,
          kind: 13, // Constant
          documentation: constant.description,
          insertText: constant.name,
          range,
          detail: constant.value
        })),
        
        // Keywords
        ...sgdkKeywords.map(keyword => ({
          label: keyword,
          kind: 14, // Keyword
          insertText: keyword,
          range
        }))
      ]
    }
  }
}

// Funções do SGDK com snippets
export const sgdkSystemFunctions = [
  // Funções de Sistema
  {
    name: 'SYS_init',
    snippet: 'SYS_init(${1:})$0',
    description: 'Inicializa o sistema',
    returns: 'void'
  },
  {
    name: 'SYS_doVBlankProcess',
    snippet: 'SYS_doVBlankProcess(${1:})$0',
    description: 'Processa VBlank - atualiza VDP, som e entrada',
    returns: 'void'
  },
  {
    name: 'VDP_init',
    snippet: 'VDP_init(${1:})$0',
    description: 'Inicializa VDP para estado padrão',
    returns: 'void'
  },
  {
    name: 'VDP_setScreenWidth320',
    snippet: 'VDP_setScreenWidth320(${1:})$0',
    description: 'Define largura da tela em 320 pixels',
    returns: 'void'
  },
  {
    name: 'VDP_setScreenHeight224',
    snippet: 'VDP_setScreenHeight224(${1:})$0',
    description: 'Define altura da tela em 224 pixels',
    returns: 'void'
  },
  {
    name: 'VDP_setPlaneSize',
    snippet: 'VDP_setPlaneSize(${1:width}, ${2:height}, ${3:updateAuto})$0',
    description: 'Define tamanho do plano (em tiles)',
    returns: 'void'
  },
  // Funções de Paleta
  {
    name: 'VDP_setPaletteColor',
    snippet: 'VDP_setPaletteColor(${1:colorIndex}, ${2:vdpColor})$0',
    description: 'Define uma cor na paleta',
    returns: 'void'
  },
  {
    name: 'VDP_setScreenPalette',
    snippet: 'VDP_setScreenPalette(${1:palette})$0',
    description: 'Define a paleta de cores completa',
    returns: 'void'
  },
  {
    name: 'VDP_getPaletteColor',
    snippet: 'VDP_getPaletteColor(${1:colorIndex})$0',
    description: 'Obtém uma cor da paleta',
    returns: 'u16'
  },
  // Funções de Tiles
  {
    name: 'VDP_loadTileData',
    snippet: 'VDP_loadTileData(${1:data}, ${2:index}, ${3:numTiles}, ${4:wait})$0',
    description: 'Carrega dados de tiles para VRAM',
    returns: 'void'
  },
  {
    name: 'VDP_loadTileSet',
    snippet: 'VDP_loadTileSet(${1:tileset}, ${2:index}, ${3:compression})$0',
    description: 'Carrega um tileset com compressão',
    returns: 'u16'
  },
  // Funções de Mapa de Tiles
  {
    name: 'VDP_setTileMapEx',
    snippet: 'VDP_setTileMapEx(${1:plane}, ${2:tilemap}, ${3:compression}, ${4:offsetx}, ${5:offsety})$0',
    description: 'Define um mapa de tiles',
    returns: 'void'
  },
  {
    name: 'VDP_setTileMapXY',
    snippet: 'VDP_setTileMapXY(${1:plane}, ${2:tileAttr}, ${3:x}, ${4:y})$0',
    description: 'Define um tile em posição específica',
    returns: 'void'
  },
  {
    name: 'VDP_fillTileMapRect',
    snippet: 'VDP_fillTileMapRect(${1:plane}, ${2:tileAttr}, ${3:x}, ${4:y}, ${5:width}, ${6:height})$0',
    description: 'Preenche área retangular com tiles',
    returns: 'void'
  },
  {
    name: 'VDP_clearTileMapRect',
    snippet: 'VDP_clearTileMapRect(${1:plane}, ${2:x}, ${3:y}, ${4:width}, ${5:height})$0',
    description: 'Limpa área retangular',
    returns: 'void'
  },
  // Funções de Texto
  {
    name: 'VDP_drawText',
    snippet: 'VDP_drawText(${1:"text"}, ${2:x}, ${3:y})$0',
    description: 'Desenha texto na tela',
    returns: 'void'
  },
  {
    name: 'VDP_drawTextEx',
    snippet: 'VDP_drawTextEx(${1:plane}, ${2:"text"}, ${3:tileAttr}, ${4:x}, ${5:y}, ${6:cpu})$0',
    description: 'Desenha texto com atributos customizados',
    returns: 'void'
  },
  {
    name: 'VDP_clearText',
    snippet: 'VDP_clearText(${1:x}, ${2:y}, ${3:length})$0',
    description: 'Limpa texto em posição',
    returns: 'void'
  },
  {
    name: 'VDP_drawIntEx',
    snippet: 'VDP_drawIntEx(${1:value}, ${2:x}, ${3:y}, ${4:fillZero}, ${5:length})$0',
    description: 'Desenha número inteiro',
    returns: 'void'
  },
  // Funções de Sprite
  {
    name: 'SPR_addSprite',
    snippet: 'SPR_addSprite(${1:sprdef}, ${2:x}, ${3:y}, ${4:animationData})$0',
    description: 'Adiciona um sprite na tela',
    returns: 'Sprite*'
  },
  {
    name: 'SPR_setPosition',
    snippet: 'SPR_setPosition(${1:sprite}, ${2:x}, ${3:y})$0',
    description: 'Define posição de sprite',
    returns: 'void'
  },
  {
    name: 'SPR_setAnim',
    snippet: 'SPR_setAnim(${1:sprite}, ${2:animationIndex})$0',
    description: 'Define animação de sprite',
    returns: 'void'
  },
  {
    name: 'SPR_update',
    snippet: 'SPR_update(${1:})$0',
    description: 'Atualiza todos os sprites',
    returns: 'void'
  },
  {
    name: 'SPR_getAnimationDone',
    snippet: 'SPR_getAnimationDone(${1:spriteIndex})$0',
    description: 'Verifica se animação acabou',
    returns: 'u8'
  },
  {
    name: 'SPR_getUsedVDPSprite',
    snippet: 'SPR_getUsedVDPSprite(${1:})$0',
    description: 'Obtém número de sprites VDP usados',
    returns: 'u16'
  },
  {
    name: 'VDP_allocateSprites',
    snippet: 'VDP_allocateSprites(${1:num})$0',
    description: 'Aloca sprites no hardware',
    returns: 'void'
  },
  {
    name: 'VDP_setSprite',
    snippet: 'VDP_setSprite(${1:index}, ${2:x}, ${3:y}, ${4:size}, ${5:tileAttr}, ${6:link})$0',
    description: 'Define sprite VDP direto',
    returns: 'void'
  },
  // Funções de Input
  {
    name: 'JOY_readJoypad',
    snippet: 'JOY_readJoypad(${1:port})$0',
    description: 'Lê estado do controle',
    returns: 'u16'
  },
  {
    name: 'JOY_getJoypadPress',
    snippet: 'JOY_getJoypadPress(${1:port})$0',
    description: 'Lê botões pressionados',
    returns: 'u16'
  },
  // Funções de Som - XGM2
  {
    name: 'XGM2_play',
    snippet: 'XGM2_play(${1:&musicData})$0',
    description: 'Inicia reprodução de música',
    returns: 'void'
  },
  {
    name: 'XGM2_pausePlay',
    snippet: 'XGM2_pausePlay(${1:})$0',
    description: 'Pausa música',
    returns: 'void'
  },
  {
    name: 'XGM2_resumePlay',
    snippet: 'XGM2_resumePlay(${1:})$0',
    description: 'Retoma música',
    returns: 'void'
  },
  {
    name: 'XGM2_stopPlay',
    snippet: 'XGM2_stopPlay(${1:})$0',
    description: 'Para música',
    returns: 'void'
  },
  {
    name: 'XGM2_playPCM',
    snippet: 'XGM2_playPCM(${1:id}, ${2:channel}, ${3:priority})$0',
    description: 'Reproduz efeito sonoro PCM',
    returns: 'void'
  },
  {
    name: 'XGM2_setPCM',
    snippet: 'XGM2_setPCM(${1:id}, ${2:sample}, ${3:length})$0',
    description: 'Define amostra PCM',
    returns: 'void'
  },
  // Funções de Som - PSG
  {
    name: 'PSG_setEnvelope',
    snippet: 'PSG_setEnvelope(${1:channel}, ${2:volume})$0',
    description: 'Define envelope PSG',
    returns: 'void'
  },
  {
    name: 'PSG_setFrequency',
    snippet: 'PSG_setFrequency(${1:channel}, ${2:frequency})$0',
    description: 'Define frequência PSG',
    returns: 'void'
  },
  // Funções de Memória
  {
    name: 'MEM_alloc',
    snippet: 'MEM_alloc(${1:size})$0',
    description: 'Aloca memória',
    returns: 'void*'
  },
  {
    name: 'MEM_free',
    snippet: 'MEM_free(${1:ptr})$0',
    description: 'Libera memória',
    returns: 'void'
  },
  // Funções de Sincronização
  {
    name: 'VDP_waitVSync',
    snippet: 'VDP_waitVSync(${1:})$0',
    description: 'Aguarda VSync',
    returns: 'void'
  },
  // Funções Matemáticas Fixed-Point
  {
    name: 'fix16ToInt',
    snippet: 'fix16ToInt(${1:value})$0',
    description: 'Converte fix16 para int',
    returns: 'int'
  },
  {
    name: 'intToFix16',
    snippet: 'intToFix16(${1:value})$0',
    description: 'Converte int para fix16',
    returns: 'fix16'
  },
  {
    name: 'FMUL',
    snippet: 'FMUL(${1:a}, ${2:b})$0',
    description: 'Multiplica dois fix16',
    returns: 'fix16'
  },
  {
    name: 'FDIV',
    snippet: 'FDIV(${1:a}, ${2:b})$0',
    description: 'Divide dois fix16',
    returns: 'fix16'
  },
  // Funções de DMA
  {
    name: 'DMA_allocateAndQueueDma',
    snippet: 'DMA_allocateAndQueueDma(${1:source}, ${2:destination}, ${3:size}, ${4:method})$0',
    description: 'Aloca e fila transferência DMA',
    returns: 'u16*'
  },
  // Funções de Z80
  {
    name: 'Z80_useBusProtection',
    snippet: 'Z80_useBusProtection(${1:enable})$0',
    description: 'Ativa proteção do barramento Z80',
    returns: 'void'
  },
  // Funções de Paleta
  {
    name: 'PAL_setPalette',
    snippet: 'PAL_setPalette(${1:palette}, ${2:data}, ${3:transferMethod})$0',
    description: 'Define paleta completa',
    returns: 'void'
  },
  {
    name: 'PAL_setColor',
    snippet: 'PAL_setColor(${1:palette}, ${2:index}, ${3:vdpColor})$0',
    description: 'Define cor individual na paleta',
    returns: 'void'
  },
  {
    name: 'PAL_setColors',
    snippet: 'PAL_setColors(${1:palette}, ${2:colors}, ${3:count}, ${4:transferMethod})$0',
    description: 'Define múltiplas cores',
    returns: 'void'
  },
  {
    name: 'PAL_getColor',
    snippet: 'PAL_getColor(${1:index})$0',
    description: 'Obtém cor da paleta',
    returns: 'u16'
  },
  {
    name: 'PAL_getPalette',
    snippet: 'PAL_getPalette(${1:palette}, ${2:dest})$0',
    description: 'Obtém paleta inteira',
    returns: 'void'
  },
  {
    name: 'PAL_fadeOut',
    snippet: 'PAL_fadeOut(${1:startIndex}, ${2:endIndex}, ${3:numFrames}, ${4:sync})$0',
    description: 'Desbota paleta para preto',
    returns: 'void'
  },
  {
    name: 'PAL_fadeIn',
    snippet: 'PAL_fadeIn(${1:startIndex}, ${2:endIndex}, ${3:palette}, ${4:numFrames}, ${5:sync})$0',
    description: 'Desbota de preto para paleta',
    returns: 'void'
  },
  // Funções de MAP (Scrolling)
  {
    name: 'MAP_create',
    snippet: 'MAP_create(${1:&mapDef}, ${2:plane}, ${3:baseTile})$0',
    description: 'Cria objeto de mapa para scrolling',
    returns: 'Map*'
  },
  {
    name: 'MAP_scrollTo',
    snippet: 'MAP_scrollTo(${1:map}, ${2:x}, ${3:y})$0',
    description: 'Scroll para posição do mapa',
    returns: 'void'
  },
  {
    name: 'MAP_getTile',
    snippet: 'MAP_getTile(${1:map}, ${2:x}, ${3:y})$0',
    description: 'Obtém tile no mapa',
    returns: 'u16'
  },
  {
    name: 'MAP_getMetaTile',
    snippet: 'MAP_getMetaTile(${1:map}, ${2:x}, ${3:y})$0',
    description: 'Obtém meta-tile no mapa',
    returns: 'u16'
  },
  // Funções Matemáticas
  {
    name: 'F16_sin',
    snippet: 'F16_sin(${1:angle})$0',
    description: 'Seno (fix16)',
    returns: 'fix16'
  },
  {
    name: 'F16_cos',
    snippet: 'F16_cos(${1:angle})$0',
    description: 'Cosseno (fix16)',
    returns: 'fix16'
  },
  {
    name: 'F16_tan',
    snippet: 'F16_tan(${1:angle})$0',
    description: 'Tangente (fix16)',
    returns: 'fix16'
  },
  {
    name: 'F16_atan',
    snippet: 'F16_atan(${1:value})$0',
    description: 'Arctangente (fix16)',
    returns: 'fix16'
  },
  {
    name: 'F16_atan2',
    snippet: 'F16_atan2(${1:y}, ${2:x})$0',
    description: 'Arctangente 2 (fix16)',
    returns: 'fix16'
  },
  {
    name: 'F32_sin',
    snippet: 'F32_sin(${1:angle})$0',
    description: 'Seno (fix32)',
    returns: 'fix32'
  },
  {
    name: 'F32_cos',
    snippet: 'F32_cos(${1:angle})$0',
    description: 'Cosseno (fix32)',
    returns: 'fix32'
  },
  {
    name: 'abs',
    snippet: 'abs(${1:value})$0',
    description: 'Valor absoluto',
    returns: 'int'
  },
  {
    name: 'getApproximatedDistance',
    snippet: 'getApproximatedDistance(${1:dx}, ${2:dy})$0',
    description: 'Distância aproximada (rápida)',
    returns: 'u16'
  },
  {
    name: 'F16_mul',
    snippet: 'F16_mul(${1:a}, ${2:b})$0',
    description: 'Multiplica fix16',
    returns: 'fix16'
  },
  {
    name: 'F16_div',
    snippet: 'F16_div(${1:a}, ${2:b})$0',
    description: 'Divide fix16',
    returns: 'fix16'
  },
  {
    name: 'F16_frac',
    snippet: 'F16_frac(${1:value})$0',
    description: 'Parte fracionária (fix16)',
    returns: 'fix16'
  },
  {
    name: 'F16_int',
    snippet: 'F16_int(${1:value})$0',
    description: 'Parte inteira (fix16)',
    returns: 'fix16'
  },
  {
    name: 'F16_round',
    snippet: 'F16_round(${1:value})$0',
    description: 'Arredonda (fix16)',
    returns: 'fix16'
  },
  {
    name: 'F16_toRoundedInt',
    snippet: 'F16_toRoundedInt(${1:value})$0',
    description: 'Converte para int arredondado',
    returns: 'int'
  },
  {
    name: 'random',
    snippet: 'random(${1:})$0',
    description: 'Número aleatório',
    returns: 'u16'
  },
  {
    name: 'setRandomSeed',
    snippet: 'setRandomSeed(${1:seed})$0',
    description: 'Define seed do aleatório',
    returns: 'void'
  },
  // Funções de Sistema
  {
    name: 'SYS_getCPULoad',
    snippet: 'SYS_getCPULoad(${1:})$0',
    description: 'Obtém carga da CPU',
    returns: 'u16'
  },
  {
    name: 'SYS_getUptime',
    snippet: 'SYS_getUptime(${1:})$0',
    description: 'Obtém tempo em frames',
    returns: 'u32'
  }
]

// Tipos de dados SGDK
export const sgdkTypes = [
  {
    name: 'u8',
    description: 'Unsigned 8-bit integer',
    detail: 'unsigned char (0-255)'
  },
  {
    name: 'u16',
    description: 'Unsigned 16-bit integer',
    detail: 'unsigned short (0-65535)'
  },
  {
    name: 'u32',
    description: 'Unsigned 32-bit integer',
    detail: 'unsigned long (0-4294967295)'
  },
  {
    name: 's8',
    description: 'Signed 8-bit integer',
    detail: 'signed char (-128-127)'
  },
  {
    name: 's16',
    description: 'Signed 16-bit integer',
    detail: 'signed short (-32768-32767)'
  },
  {
    name: 's32',
    description: 'Signed 32-bit integer',
    detail: 'signed long'
  },
  {
    name: 'fix16',
    description: 'Fixed-point 16-bit',
    detail: 'Para cálculos de ponto fixo'
  },
  {
    name: 'fix32',
    description: 'Fixed-point 32-bit',
    detail: 'Para cálculos de ponto fixo de precisão maior'
  },
  {
    name: 'Sprite',
    description: 'Estrutura de sprite',
    detail: 'Representa um sprite na tela'
  },
  {
    name: 'Image',
    description: 'Imagem/Tileset',
    detail: 'Dados de imagem/gráficos'
  },
  {
    name: 'VDPSprite',
    description: 'Estrutura de sprite VDP',
    detail: 'Sprite no hardware VDP'
  },
  {
    name: 'Palette',
    description: 'Paleta de cores',
    detail: 'Conjunto de cores'
  },
  {
    name: 'TileMap',
    description: 'Mapa de tiles',
    detail: 'Dados do mapa de tiles'
  },
  {
    name: 'Map',
    description: 'Objeto de mapa para scrolling',
    detail: 'Controla scrolling de large maps'
  },
  {
    name: 'Vect3D_f16',
    description: 'Vetor 3D com fix16',
    detail: 'Para cálculos 3D'
  },
  {
    name: 'Mat3D_f16',
    description: 'Matriz 3D com fix16',
    detail: 'Para transformações 3D'
  },
  {
    name: 'Collision',
    description: 'Estrutura de colisão',
    detail: 'Para detecção de colisão'
  }
]

// Structs SGDK
export const sgdkStructs = [
  {
    name: 'SpriteDefinition',
    description: 'Define as propriedades de um sprite',
    fields: ['width', 'height', 'numFrames', 'tiles', 'animations']
  },
  {
    name: 'AnimationData',
    description: 'Dados de animação de sprite',
    fields: ['frameIndices', 'numFrames', 'duration']
  },
  {
    name: 'TileSet',
    description: 'Conjunto de tiles',
    fields: ['tiles', 'numTiles', 'compression']
  }
]

// Constantes do SGDK
export const sgdkConstants = [
  // Planos
  {
    name: 'VDP_PLANE_A',
    description: 'Plano A',
    value: '0'
  },
  {
    name: 'VDP_PLANE_B',
    description: 'Plano B',
    value: '1'
  },
  {
    name: 'VDP_PLANE_WINDOW',
    description: 'Janela VDP',
    value: '2'
  },
  {
    name: 'VDP_PLANE_SPRITE',
    description: 'Plano de sprites',
    value: '3'
  },
  {
    name: 'BG_A',
    description: 'Background A (alias)',
    value: 'VDP_PLANE_A'
  },
  {
    name: 'BG_B',
    description: 'Background B (alias)',
    value: 'VDP_PLANE_B'
  },
  // Botões do Controle
  {
    name: 'BUTTON_UP',
    description: 'Botão para cima',
    value: 'BIT_UP'
  },
  {
    name: 'BUTTON_DOWN',
    description: 'Botão para baixo',
    value: 'BIT_DOWN'
  },
  {
    name: 'BUTTON_LEFT',
    description: 'Botão para esquerda',
    value: 'BIT_LEFT'
  },
  {
    name: 'BUTTON_RIGHT',
    description: 'Botão para direita',
    value: 'BIT_RIGHT'
  },
  {
    name: 'BUTTON_A',
    description: 'Botão A',
    value: 'BIT_A'
  },
  {
    name: 'BUTTON_B',
    description: 'Botão B',
    value: 'BIT_B'
  },
  {
    name: 'BUTTON_C',
    description: 'Botão C',
    value: 'BIT_C'
  },
  {
    name: 'BUTTON_START',
    description: 'Botão Start',
    value: 'BIT_START'
  },
  // Portas de Controle
  {
    name: 'JOY_1',
    description: 'Porta 1 do controle',
    value: '0'
  },
  {
    name: 'JOY_2',
    description: 'Porta 2 do controle',
    value: '1'
  },
  // Tamanho de Sprite
  {
    name: 'SPRITE_SIZE_1x1',
    description: 'Tamanho 1x1 tiles',
    value: '0'
  },
  {
    name: 'SPRITE_SIZE_1x2',
    description: 'Tamanho 1x2 tiles',
    value: '1'
  },
  {
    name: 'SPRITE_SIZE_2x1',
    description: 'Tamanho 2x1 tiles',
    value: '2'
  },
  {
    name: 'SPRITE_SIZE_2x2',
    description: 'Tamanho 2x2 tiles',
    value: '3'
  },
  {
    name: 'SPRITE_SIZE_2x3',
    description: 'Tamanho 2x3 tiles',
    value: '4'
  },
  {
    name: 'SPRITE_SIZE_2x4',
    description: 'Tamanho 2x4 tiles',
    value: '5'
  },
  {
    name: 'SPRITE_SIZE_3x2',
    description: 'Tamanho 3x2 tiles',
    value: '6'
  },
  {
    name: 'SPRITE_SIZE_3x3',
    description: 'Tamanho 3x3 tiles',
    value: '7'
  },
  {
    name: 'SPRITE_SIZE_3x4',
    description: 'Tamanho 3x4 tiles',
    value: '8'
  },
  {
    name: 'SPRITE_SIZE_4x2',
    description: 'Tamanho 4x2 tiles',
    value: '9'
  },
  {
    name: 'SPRITE_SIZE_4x3',
    description: 'Tamanho 4x3 tiles',
    value: '10'
  },
  {
    name: 'SPRITE_SIZE_4x4',
    description: 'Tamanho 4x4 tiles',
    value: '11'
  },
  // Paletas
  {
    name: 'PAL0',
    description: 'Paleta 0',
    value: '0'
  },
  {
    name: 'PAL1',
    description: 'Paleta 1',
    value: '1'
  },
  {
    name: 'PAL2',
    description: 'Paleta 2',
    value: '2'
  },
  {
    name: 'PAL3',
    description: 'Paleta 3',
    value: '3'
  },
  // Compressão
  {
    name: 'COMPRESSION_NONE',
    description: 'Sem compressão',
    value: '0'
  },
  {
    name: 'COMPRESSION_APLIB',
    description: 'Compressão APLIB',
    value: '1'
  },
  {
    name: 'COMPRESSION_LZ4W',
    description: 'Compressão LZ4W',
    value: '2'
  },
  // Canais PSG
  {
    name: 'PSG_TONE_CHN0',
    description: 'Canal PSG Tone 0',
    value: '0'
  },
  {
    name: 'PSG_TONE_CHN1',
    description: 'Canal PSG Tone 1',
    value: '1'
  },
  {
    name: 'PSG_TONE_CHN2',
    description: 'Canal PSG Tone 2',
    value: '2'
  },
  {
    name: 'PSG_NOISE_CHN',
    description: 'Canal PSG Noise',
    value: '3'
  },
  // Macros úteis
  {
    name: 'TRUE',
    description: 'Verdadeiro',
    value: '1'
  },
  {
    name: 'FALSE',
    description: 'Falso',
    value: '0'
  },
  {
    name: 'CPU',
    description: 'Use CPU',
    value: '0'
  },
  {
    name: 'DMA',
    description: 'Use DMA',
    value: '1'
  },
  // MácrosMath
  {
    name: 'FIX16',
    description: 'Converte para fix16',
    value: 'FIX16(value)'
  },
  {
    name: 'FIX32',
    description: 'Converte para fix32',
    value: 'FIX32(value)'
  },
  // Tipos de Transferência
  {
    name: 'TILE_ATTR',
    description: 'Macro de atributo de tile',
    value: 'TILE_ATTR(pal, prio, flip, tile)'
  },
  {
    name: 'TILE_ATTR_FULL',
    description: 'Macro de atributo completo',
    value: 'TILE_ATTR_FULL(pal, prio, vflip, hflip, tile)'
  },
  // RGB
  {
    name: 'RGB24_TO_VDPCOLOR',
    description: 'Converte RGB24 para VDP',
    value: 'RGB24_TO_VDPCOLOR(rgb24)'
  },
  {
    name: 'RGB16_TO_VDPCOLOR',
    description: 'Converte RGB16 para VDP',
    value: 'RGB16_TO_VDPCOLOR(rgb16)'
  },
  // Sincronização
  {
    name: 'FALSE',
    description: 'Falso (não sincro)',
    value: '0'
  },
  {
    name: 'TRUE',
    description: 'Verdadeiro (sincro)',
    value: '1'
  }
]

// Keywords do SGDK
export const sgdkKeywords = [
  'include',
  'include_res',
  'far',
  'near',
  'volatile',
  '__asm__',
  'attribute',
  'static',
  'extern',
  'const',
  'typedef',
  'struct',
  'union',
  'enum',
  'TILE_ATTR_FULL',
  'SPRITE_SIZE',
  'TILE_ATTR',
  'RGB24_TO_VDPCOLOR',
  'RGB16_TO_VDPCOLOR'
]

// Signature help para funções
export const sgdkSignatureProvider = {
  provideSignatureHelp: (model, position) => {
    if (!model || !position || position.lineNumber < 1 || position.lineNumber > model.getLineCount()) {
      return null
    }
    const lineText = model.getLineContent(position.lineNumber)
    const match = lineText.match(/(\w+)\s*\(\s*$/);
    
    if (!match) return null;
    
    const functionName = match[1];
    const func = sgdkSystemFunctions.find(f => f.name === functionName);
    
    if (!func) return null;
    
    return {
      signatures: [{
        label: `${func.name}()`,
        documentation: func.description,
        parameters: []
      }],
      activeSignature: 0,
      activeParameter: 0
    }
  }
}
