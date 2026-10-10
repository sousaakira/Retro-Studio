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
    name: 'SYS_disableInts',
    snippet: 'SYS_disableInts()$0',
    description: 'Desliga as interrupções (reative com SYS_enableInts)',
    returns: 'void'
  },
  {
    name: 'SYS_doVBlankProcess',
    snippet: 'SYS_doVBlankProcess(${1:})$0',
    description: 'Processa VBlank - atualiza VDP, som e entrada',
    returns: 'bool'
  },
  {
    name: 'SYS_setVIntCallback',
    snippet: 'SYS_setVIntCallback(${1:callback})$0',
    description: 'Define callback de interrupção de VBlank',
    returns: 'void'
  },
  {
    name: 'SYS_setHIntCallback',
    snippet: 'SYS_setHIntCallback(${1:callback})$0',
    description: 'Define callback de interrupção de HBlank',
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
    snippet: 'VDP_setPlaneSize(${1:width}, ${2:height}, ${3:setupVram})$0',
    description: 'Define tamanho do plano (em tiles)',
    returns: 'void'
  },
  // Funções de Paleta
  // Funções de Tiles
  {
    name: 'VDP_loadTileData',
    snippet: 'VDP_loadTileData(${1:data}, ${2:index}, ${3:numTiles}, ${4:DMA})$0',
    description: 'Carrega dados de tiles para VRAM',
    returns: 'void'
  },
  {
    name: 'VDP_loadTileSet',
    snippet: 'VDP_loadTileSet(${1:tileset}, ${2:TILE_USER_INDEX}, ${3:DMA})$0',
    description: 'Carrega um tileset com compressão',
    returns: 'u16'
  },
  // Funções de Mapa de Tiles
  {
    name: 'VDP_setTileMapEx',
    snippet: 'VDP_setTileMapEx(${1:BG_A}, ${2:tilemap}, ${3:baseTile}, ${4:planeX}, ${5:planeY}, ${6:mapX}, ${7:mapY}, ${8:width}, ${9:height}, ${10:DMA})$0',
    description: 'Desenha uma região de um TileMap em um plano',
    returns: 'bool'
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
    snippet: 'VDP_drawTextEx(${1:plane}, ${2:"text"}, ${3:tileAttr}, ${4:x}, ${5:y}, ${6:DMA})$0',
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
    name: 'intToStr',
    snippet: 'intToStr(${1:value}, ${2:buffer}, ${3:minDigits})$0',
    description: 'Converte um inteiro em texto; desenhe com VDP_drawText',
    returns: 'u16'
  },
  // Funções de Sprite
  {
    name: 'SPR_addSprite',
    snippet: 'SPR_addSprite(${1:sprdef}, ${2:x}, ${3:y}, ${4:TILE_ATTR(PAL0, FALSE, FALSE, FALSE)})$0',
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
    snippet: 'SPR_getAnimationDone(${1:sprite})$0',
    description: 'Verifica se animação acabou',
    returns: 'bool'
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
    description: 'Reserva sprites de hardware; devolve o primeiro índice ou -1',
    returns: 's16'
  },
  {
    name: 'VDP_setSprite',
    snippet: 'VDP_setSprite(${1:index}, ${2:x}, ${3:y}, ${4:size}, ${5:tileAttr})$0',
    description: 'Define sprite VDP direto',
    returns: 'void'
  },
  // Funções de Input
  {
    name: 'JOY_readJoypad',
    snippet: 'JOY_readJoypad(${1:JOY_1})$0',
    description: 'Lê estado do controle',
    returns: 'u16'
  },
  {
    name: 'JOY_getJoypadType',
    snippet: 'JOY_getJoypadType(${1:JOY_1})$0',
    description: 'Tipo do controle ligado (JOY_TYPE_PAD3, JOY_TYPE_PAD6...)',
    returns: 'u8'
  },
  // Funções de Som - XGM2 (somente SGDK 2.x; no SGDK 1.81 use as funções XGM_)
  {
    name: 'XGM2_play',
    snippet: 'XGM2_play(${1:musicData})$0',
    description: 'Inicia reprodução de música (SGDK 2.x)',
    returns: 'void'
  },
  {
    name: 'XGM2_pause',
    snippet: 'XGM2_pause()$0',
    description: 'Pausa a música (SGDK 2.x)',
    returns: 'void'
  },
  {
    name: 'XGM2_resume',
    snippet: 'XGM2_resume()$0',
    description: 'Retoma a música (SGDK 2.x)',
    returns: 'void'
  },
  {
    name: 'XGM2_stop',
    snippet: 'XGM2_stop()$0',
    description: 'Para a música (SGDK 2.x)',
    returns: 'void'
  },
  {
    name: 'XGM2_playPCM',
    snippet: 'XGM2_playPCM(${1:sample}, ${2:length}, ${3:SOUND_PCM_CH2})$0',
    description: 'Reproduz um efeito sonoro PCM (SGDK 2.x)',
    returns: 'bool'
  },
  {
    name: 'XGM2_playPCMEx',
    snippet: 'XGM2_playPCMEx(${1:sample}, ${2:length}, ${3:SOUND_PCM_CH2}, ${4:priority}, ${5:FALSE}, ${6:FALSE})$0',
    description: 'Efeito PCM com prioridade, meia taxa e loop (SGDK 2.x)',
    returns: 'bool'
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
    returns: 'bool'
  },
  // Funções Matemáticas Fixed-Point
  {
    name: 'fix16ToInt',
    snippet: 'fix16ToInt(${1:value})$0',
    description: 'Converte fix16 para int',
    returns: 's16'
  },
  {
    name: 'intToFix16',
    snippet: 'intToFix16(${1:value})$0',
    description: 'Converte int para fix16',
    returns: 'fix16'
  },
  {
    name: 'fix16Mul',
    snippet: 'fix16Mul(${1:a}, ${2:b})$0',
    description: 'Multiplica dois fix16',
    returns: 'fix16'
  },
  {
    name: 'fix16Div',
    snippet: 'fix16Div(${1:a}, ${2:b})$0',
    description: 'Divide dois fix16',
    returns: 'fix16'
  },
  // Funções de DMA
  {
    name: 'DMA_allocateAndQueueDma',
    snippet: 'DMA_allocateAndQueueDma(${1:DMA_VRAM}, ${2:to}, ${3:len}, ${4:step})$0',
    description: 'Aloca e fila transferência DMA',
    returns: 'void*'
  },
  {
    name: 'DMA_doDma',
    snippet: 'DMA_doDma(${1:DMA_VRAM}, ${2:from}, ${3:to}, ${4:len}, ${5:step})$0',
    description: 'Executa transferência DMA imediata',
    returns: 'void'
  },
  {
    name: 'DMA_waitCompletion',
    snippet: 'DMA_waitCompletion(${1:})$0',
    description: 'Aguarda conclusão das transferências DMA pendentes',
    returns: 'void'
  },
  {
    name: 'XGM_startPlay',
    snippet: 'XGM_startPlay(${1:music})$0',
    description: 'Inicia reprodução de música XGM',
    returns: 'void'
  },
  {
    name: 'XGM_stopPlay',
    snippet: 'XGM_stopPlay(${1:})$0',
    description: 'Para a música XGM atual',
    returns: 'void'
  },
  {
    name: 'JOY_setEventHandler',
    snippet: 'JOY_setEventHandler(${1:handler})$0',
    description: 'Define handler de eventos do joypad',
    returns: 'void'
  },
  // Funções de Z80
  {
    name: 'Z80_setBusProtection',
    snippet: 'Z80_setBusProtection(${1:TRUE})$0',
    description: 'Liga ou desliga a proteção do barramento contra o Z80 durante DMA',
    returns: 'void'
  },
  // Funções de Paleta
  {
    name: 'PAL_setPalette',
    snippet: 'PAL_setPalette(${1:PAL0}, ${2:palette.data}, ${3:DMA})$0',
    description: 'Carrega uma paleta de 16 cores',
    returns: 'void'
  },
  {
    name: 'PAL_setColor',
    snippet: 'PAL_setColor(${1:index}, ${2:vdpColor})$0',
    description: 'Define cor individual na paleta',
    returns: 'void'
  },
  {
    name: 'PAL_setColors',
    snippet: 'PAL_setColors(${1:index}, ${2:colors}, ${3:count}, ${4:DMA})$0',
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
    snippet: 'PAL_fadeOut(${1:fromColor}, ${2:toColor}, ${3:numFrames}, ${4:async})$0',
    description: 'Desbota paleta para preto',
    returns: 'void'
  },
  {
    name: 'PAL_fadeIn',
    snippet: 'PAL_fadeIn(${1:fromColor}, ${2:toColor}, ${3:palette}, ${4:numFrames}, ${5:async})$0',
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
    name: 'sinFix16',
    snippet: 'sinFix16(${1:angle})$0',
    description: 'Seno em fix16; ângulo de 0 a 1023 (1024 = volta completa)',
    returns: 'fix16'
  },
  {
    name: 'cosFix16',
    snippet: 'cosFix16(${1:angle})$0',
    description: 'Cosseno em fix16; ângulo de 0 a 1023 (1024 = volta completa)',
    returns: 'fix16'
  },
  {
    name: 'sinFix32',
    snippet: 'sinFix32(${1:angle})$0',
    description: 'Seno em fix32; ângulo de 0 a 1023',
    returns: 'fix32'
  },
  {
    name: 'cosFix32',
    snippet: 'cosFix32(${1:angle})$0',
    description: 'Cosseno em fix32; ângulo de 0 a 1023',
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
    returns: 'u32'
  },
  {
    name: 'fix16Frac',
    snippet: 'fix16Frac(${1:value})$0',
    description: 'Parte fracionária de um fix16',
    returns: 'fix16'
  },
  {
    name: 'fix16Int',
    snippet: 'fix16Int(${1:value})$0',
    description: 'Parte inteira de um fix16 (continua fix16)',
    returns: 'fix16'
  },
  {
    name: 'fix16Round',
    snippet: 'fix16Round(${1:value})$0',
    description: 'Arredonda um fix16 (continua fix16)',
    returns: 'fix16'
  },
  {
    name: 'fix16ToRoundedInt',
    snippet: 'fix16ToRoundedInt(${1:value})$0',
    description: 'Converte fix16 em inteiro arredondado',
    returns: 's16'
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
    name: 'getTick',
    snippet: 'getTick()$0',
    description: 'Tempo desde o início, em ticks de 1/300 de segundo',
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
    fields: ['w', 'h', 'palette', 'numAnimation', 'animations', 'maxNumTile', 'maxNumSprite']
  },
  {
    name: 'Animation',
    description: 'Animação de um SpriteDefinition',
    fields: ['numFrame', 'loop', 'frames']
  },
  {
    name: 'TileSet',
    description: 'Conjunto de tiles',
    fields: ['compression', 'numTile', 'tiles']
  }
]

// Constantes do SGDK
export const sgdkConstants = [
  // Planos
  {
    name: 'WINDOW',
    description: 'Plano da janela; substitui parte de BG_A, sem scroll próprio',
    value: '2'
  },
  {
    name: 'BG_A',
    description: 'Plano de fundo A',
    value: '0'
  },
  {
    name: 'BG_B',
    description: 'Plano de fundo B',
    value: '1'
  },
  // Botões do Controle
  {
    name: 'BUTTON_UP',
    description: 'Botão para cima',
    value: '0x0001'
  },
  {
    name: 'BUTTON_DOWN',
    description: 'Botão para baixo',
    value: '0x0002'
  },
  {
    name: 'BUTTON_LEFT',
    description: 'Botão para esquerda',
    value: '0x0004'
  },
  {
    name: 'BUTTON_RIGHT',
    description: 'Botão para direita',
    value: '0x0008'
  },
  {
    name: 'BUTTON_A',
    description: 'Botão A',
    value: '0x0040'
  },
  {
    name: 'BUTTON_B',
    description: 'Botão B',
    value: '0x0010'
  },
  {
    name: 'BUTTON_C',
    description: 'Botão C',
    value: '0x0020'
  },
  {
    name: 'BUTTON_START',
    description: 'Botão Start',
    value: '0x0080'
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
    name: 'SPRITE_SIZE',
    description: 'Tamanho de sprite de hardware em tiles (1 a 4 por eixo)',
    value: 'SPRITE_SIZE(w, h)'
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
  // PSG
  {
    name: 'PSG_ENVELOPE_MAX',
    description: 'Volume máximo de um canal do PSG',
    value: '0'
  },
  {
    name: 'PSG_ENVELOPE_MIN',
    description: 'Canal do PSG em silêncio',
    value: '15'
  },
  {
    name: 'PSG_NOISE_TYPE_WHITE',
    description: 'Ruído branco no canal 3 do PSG',
    value: '1'
  },
  {
    name: 'PSG_NOISE_TYPE_PERIODIC',
    description: 'Ruído periódico no canal 3 do PSG',
    value: '0'
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
    value: 'TILE_ATTR(pal, prio, flipV, flipH)'
  },
  {
    name: 'TILE_ATTR_FULL',
    description: 'Macro de atributo completo',
    value: 'TILE_ATTR_FULL(pal, prio, flipV, flipH, tile)'
  },
  // RGB
  {
    name: 'RGB24_TO_VDPCOLOR',
    description: 'Converte RGB24 para VDP',
    value: 'RGB24_TO_VDPCOLOR(rgb24)'
  },
  {
    name: 'RGB8_8_8_TO_VDPCOLOR',
    description: 'Converte componentes RGB de 8 bits para cor do VDP',
    value: 'RGB8_8_8_TO_VDPCOLOR(r, g, b)'
  }
]

// Keywords do SGDK
export const sgdkKeywords = [
  'include',
  'volatile',
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
  'RGB24_TO_VDPCOLOR'
]

// Chamada legível de um snippet: "NOME(a, b)" sem os marcadores ${n:...}.
export const snippetCall = snippet => snippet.replace(/\$0$/, '').replace(/\$\{\d+:([^}]*)\}/g, '$1')
export const snippetParameters = snippet => [...snippet.matchAll(/\$\{\d+:([^}]+)\}/g)].map(match => match[1])

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
        label: snippetCall(func.snippet),
        documentation: func.description,
        parameters: snippetParameters(func.snippet).map(label => ({ label }))
      }],
      activeSignature: 0,
      activeParameter: 0
    }
  }
}
