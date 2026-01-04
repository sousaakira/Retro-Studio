import { sgdkSystemFunctions } from './sgdkAutocomplete'

export const sgdkDocumentation = {
  'VDP_init': {
    description: 'Inicializa o VDP',
    documentation: 'Deve ser chamado no início do programa.',
    example: 'VDP_init();',
    returns: 'void',
    params: []
  },
  'VDP_setScreenWidth320': {
    description: 'Define largura 320px',
    documentation: 'Configura resolução para 320 pixels.',
    example: 'VDP_setScreenWidth320();',
    returns: 'void',
    params: []
  },
  'VDP_setScreenHeight224': {
    description: 'Define altura 224px',
    documentation: 'Configura altura para 224 pixels (NTSC).',
    example: 'VDP_setScreenHeight224();',
    returns: 'void',
    params: []
  },
  'VDP_waitVSync': {
    description: 'Aguarda VSync',
    documentation: 'Aguarda sincronização vertical.',
    example: 'VDP_waitVSync();',
    returns: 'void',
    params: []
  },
  'PAL_setPalette': {
    description: 'Define paleta de cores',
    documentation: 'Carrega paleta inteira (16 cores).',
    example: 'PAL_setPalette(PAL0, my_palette.data, CPU);',
    returns: 'void',
    params: [
      { name: 'palette', type: 'u16', description: 'PAL0-PAL3' },
      { name: 'data', type: 'const u16*', description: 'Dados da paleta' },
      { name: 'transferMethod', type: 'u16', description: 'CPU ou DMA' }
    ]
  },
  'PAL_setColor': {
    description: 'Define cor individual',
    documentation: 'Define uma cor em um índice da paleta.',
    example: 'PAL_setColor(PAL0, 0, 0x0000);',
    returns: 'void',
    params: [
      { name: 'palette', type: 'u16', description: 'PAL0-PAL3' },
      { name: 'index', type: 'u16', description: 'Índice (0-15)' },
      { name: 'color', type: 'u16', description: 'Cor VDP' }
    ]
  },
  'SPR_init': {
    description: 'Inicializa sprites',
    documentation: 'Deve ser chamado antes de usar sprites.',
    example: 'SPR_init();',
    returns: 'void',
    params: []
  },
  'SPR_addSprite': {
    description: 'Adiciona sprite',
    documentation: 'Cria e adiciona sprite na tela.',
    example: 'Sprite* spr = SPR_addSprite(&sprite_def, 160, 120, NULL);',
    returns: 'Sprite*',
    params: [
      { name: 'spritedef', type: 'SpriteDefinition*', description: 'Definição' },
      { name: 'x', type: 's16', description: 'Pos X' },
      { name: 'y', type: 's16', description: 'Pos Y' },
      { name: 'animationData', type: 'AnimationData*', description: 'Animação' }
    ]
  },
  'SPR_setPosition': {
    description: 'Define posição sprite',
    documentation: 'Move sprite para posição.',
    example: 'SPR_setPosition(my_sprite, 200, 150);',
    returns: 'void',
    params: [
      { name: 'sprite', type: 'Sprite*', description: 'Ponteiro sprite' },
      { name: 'x', type: 's16', description: 'Nova pos X' },
      { name: 'y', type: 's16', description: 'Nova pos Y' }
    ]
  },
  'SPR_setFrame': {
    description: 'Define frame/animação',
    documentation: 'Muda frame visual do sprite.',
    example: 'SPR_setFrame(my_sprite, 2);',
    returns: 'void',
    params: [
      { name: 'sprite', type: 'Sprite*', description: 'Ponteiro' },
      { name: 'frame', type: 'u16', description: 'Índice frame' }
    ]
  },
  'SPR_setVisible': {
    description: 'Define visibilidade',
    documentation: 'Mostra ou esconde sprite.',
    example: 'SPR_setVisible(my_sprite, TRUE);',
    returns: 'void',
    params: [
      { name: 'sprite', type: 'Sprite*', description: 'Ponteiro' },
      { name: 'visible', type: 'u8', description: 'TRUE/FALSE' }
    ]
  },
  'SPR_releaseSprite': {
    description: 'Remove sprite',
    documentation: 'Remove sprite completamente.',
    example: 'SPR_releaseSprite(my_sprite);',
    returns: 'void',
    params: [
      { name: 'sprite', type: 'Sprite*', description: 'Ponteiro' }
    ]
  },
  'JOY_readJoypad': {
    description: 'Lê controle',
    documentation: 'Retorna estado do controle.',
    example: 'u16 input = JOY_readJoypad(JOY_1);',
    returns: 'u16',
    params: [
      { name: 'port', type: 'u16', description: 'JOY_1 ou JOY_2' }
    ]
  },
  'MAP_create': {
    description: 'Cria mapa scrolling',
    documentation: 'Cria objeto Map para scrolling.',
    example: 'Map* bga = MAP_create(&bga_map, BG_A, 0);',
    returns: 'Map*',
    params: [
      { name: 'mapDef', type: 'const MapDefinition*', description: 'Definição' },
      { name: 'plane', type: 'VDPPlane', description: 'BG_A ou BG_B' },
      { name: 'baseTile', type: 'u16', description: 'Tile base' }
    ]
  },
  'MAP_scrollTo': {
    description: 'Scroll para posição',
    documentation: 'Move câmera do mapa.',
    example: 'MAP_scrollTo(my_map, 100, 200);',
    returns: 'void',
    params: [
      { name: 'map', type: 'Map*', description: 'Objeto mapa' },
      { name: 'x', type: 'u32', description: 'Pos X' },
      { name: 'y', type: 'u32', description: 'Pos Y' }
    ]
  },
  'F16_sin': {
    description: 'Seno (fix16)',
    documentation: 'Calcula seno em formato fix16.',
    example: 'fix16 s = F16_sin(angle);',
    returns: 'fix16',
    params: [
      { name: 'angle', type: 'fix16', description: 'Ângulo' }
    ]
  },
  'F16_cos': {
    description: 'Cosseno (fix16)',
    documentation: 'Calcula cosseno em formato fix16.',
    example: 'fix16 c = F16_cos(angle);',
    returns: 'fix16',
    params: [
      { name: 'angle', type: 'fix16', description: 'Ângulo' }
    ]
  },
  'SYS_doVBlankProcess': {
    description: 'Processa VBlank',
    documentation: 'IMPORTANTE: Deve ser chamado ao final de cada frame.',
    example: 'while(1) { SYS_doVBlankProcess(); }',
    returns: 'void',
    params: []
  },
  'SYS_getCPULoad': {
    description: 'Obtém carga CPU',
    documentation: 'Retorna carga da CPU em porcentagem.',
    example: 'u16 load = SYS_getCPULoad();',
    returns: 'u16',
    params: []
  }
}

export function expandSGDKDocumentation() {
  try {
    if (sgdkSystemFunctions) {
      sgdkSystemFunctions.forEach(func => {
        if (!sgdkDocumentation[func.name]) {
          sgdkDocumentation[func.name] = {
            description: func.description,
            documentation: func.description,
            example: func.name + '();',
            returns: func.returns || 'void',
            params: []
          }
        }
      })
    }
  } catch (error) {
    console.warn('[SGDK] Erro expandir docs:', error.message)
  }
}

export function createSGDKHoverProvider(monaco) {
  console.log('[SGDK HOVER] Provider criado com', Object.keys(sgdkDocumentation).length, 'funções')
  
  return {
    provideHover(model, position) {
      // Validação de segurança para evitar erros de runtime
      if (!model || !position || position.lineNumber < 1 || position.lineNumber > model.getLineCount()) {
        return null
      }
      
      const line = model.getLineContent(position.lineNumber)
      const column = position.column - 1
      
      if (!line || column < 0) return null
      
      // Procurar palavra completa incluindo underscores
      let start = column
      let end = column
      
      // Expandir para trás
      while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1])) {
        start--
      }
      
      // Expandir para frente
      while (end < line.length && /[a-zA-Z0-9_]/.test(line[end])) {
        end++
      }
      
      if (start === end) return null
      
      const wordText = line.substring(start, end)
      console.log('[SGDK HOVER] Palavra completa:', wordText, '- Doc:', !!sgdkDocumentation[wordText])
      
      const doc = sgdkDocumentation[wordText]
      if (!doc) return null
      
      let markdown = '**' + wordText + '** - ' + doc.description + '\n\n'
      markdown += doc.documentation + '\n\n'
      
      if (doc.params && doc.params.length > 0) {
        markdown += '**Parâmetros:**\n'
        doc.params.forEach(p => {
          markdown += '- `' + p.name + '` (' + p.type + '): ' + p.description + '\n'
        })
        markdown += '\n'
      }
      
      markdown += '**Retorna:** `' + doc.returns + '`\n\n'
      markdown += '**Exemplo:**\n```c\n' + doc.example + '\n```'
      
      return {
        range: new monaco.Range(position.lineNumber, start + 1, position.lineNumber, end + 1),
        contents: [{ value: markdown }]
      }
    }
  }
}
