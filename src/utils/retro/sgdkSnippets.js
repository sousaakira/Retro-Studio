/**
 * SGDK Code Snippets para Monaco Editor
 * Fornece templates de código comuns
 */

export const sgdkSnippets = [
  {
    label: 'sgdk:main',
    detail: 'Main function template',
    kind: 15, // Snippet
    documentation: 'Template básico de função main para SGDK',
    insertText: `int main(bool hardReset)
{
    // hardReset == FALSE após soft reset (evitar reinicializar assets se quiser)

    VDP_drawText("Hello Mega Drive!", 10, 12);

    while (TRUE)
    {
        // lógica do frame

        // sempre no fim do frame
        SYS_doVBlankProcess();
    }

    return 0;
}`,
    range: null
  },
  {
    label: 'sgdk:sprite_init',
    detail: 'Initialize sprite template',
    kind: 15,
    documentation: 'Template para inicializar um sprite',
    insertText: `// Em res/resources.res (o rescomp gera o SpriteDefinition; quadros de 4x4 tiles):
//   SPRITE player_sprite "player.png" 4 4 FAST 6

// Iniciar o motor de sprites uma vez
SPR_init();

// Paleta do sprite e criação na tela
PAL_setPalette(PAL1, player_sprite.palette->data, DMA);
Sprite* spr = SPR_addSprite(&player_sprite, 160, 120, TILE_ATTR(PAL1, FALSE, FALSE, FALSE));

// Uma vez por quadro, antes de SYS_doVBlankProcess()
SPR_update();`,
    range: null
  },
  {
    label: 'sgdk:input',
    detail: 'Input handling template',
    kind: 15,
    documentation: 'Template para leitura de entrada',
    insertText: `u16 input = JOY_readJoypad(JOY_1);

if (input & BUTTON_UP) {
    // Botão para cima pressionado
}

if (input & BUTTON_DOWN) {
    // Botão para baixo pressionado
}

if (input & BUTTON_LEFT) {
    // Botão para esquerda pressionado
}

if (input & BUTTON_RIGHT) {
    // Botão para direita pressionado
}

if (input & BUTTON_A) {
    // Botão A pressionado
}

if (input & BUTTON_B) {
    // Botão B pressionado
}

if (input & BUTTON_C) {
    // Botão C pressionado
}

if (input & BUTTON_START) {
    // Botão Start pressionado
}`,
    range: null
  },
  {
    label: 'sgdk:vdp_palette',
    detail: 'Set palette template',
    kind: 15,
    documentation: 'Template para definir paleta de cores',
    insertText: `// Definir paleta de cores
// Índice global da cor: banco * 16 + cor (0 a 63)
PAL_setColor(0, RGB24_TO_VDPCOLOR(0x000000)); // Cor preta (fundo)
PAL_setColor(1, RGB24_TO_VDPCOLOR(0xFFFFFF)); // Cor branca
PAL_setColor(2, RGB24_TO_VDPCOLOR(0xFF0000)); // Cor vermelha
PAL_setColor(3, RGB24_TO_VDPCOLOR(0x00FF00)); // Cor verde
PAL_setColor(4, RGB24_TO_VDPCOLOR(0x0000FF)); // Cor azul`,
    range: null
  },
  {
    label: 'sgdk:vdp_text',
    detail: 'Draw text template',
    kind: 15,
    documentation: 'Template para desenhar texto',
    insertText: `// Desenhar texto na tela
VDP_drawText("Hello World!", 10, 5);
VDP_drawText("Score: 0", 20, 10);
char scoreText[8];
intToStr(score, scoreText, 6);
VDP_drawText(scoreText, 27, 10);`,
    range: null
  },
  {
    label: 'sgdk:memory_alloc',
    detail: 'Memory allocation template',
    kind: 15,
    documentation: 'Template para alocação de memória',
    insertText: `// Alocar memória
u8* buffer = (u8*) MEM_alloc(1024);

if (buffer == NULL) {
    // Erro ao alocar memória
    return;
}

// Usar buffer...

// Liberar memória
MEM_free(buffer);
buffer = NULL;`,
    range: null
  },
  {
    label: 'sgdk:fixed_point',
    detail: 'Fixed-point math template',
    kind: 15,
    documentation: 'Template para matemática de ponto fixo',
    insertText: `// Conversão de inteiro para fix16
fix16 posX = intToFix16(160);
fix16 posY = intToFix16(120);

// Aritmética com fix16
fix16 velocityX = fix16Mul(posX, intToFix16(2));

// Conversão de fix16 para inteiro
u16 screenX = fix16ToInt(posX);
u16 screenY = fix16ToInt(posY);`,
    range: null
  },
  {
    label: 'sgdk:debug_print',
    detail: 'Debug print template',
    kind: 15,
    documentation: 'Template para debug com prints',
    insertText: `// Debug: Imprimir valores na tela
char debugText[20];
sprintf(debugText, "X:%d Y:%d", (int)posX, (int)posY);
VDP_drawText(debugText, 2, 26);`,
    range: null
  },
  {
    label: 'sgdk:sound_play',
    detail: 'Play sound template',
    kind: 15,
    documentation: 'Template para reproduzir som',
    insertText: `// Efeito sonoro (driver XGM do SGDK 1.81): registre o sample uma vez (IDs 64 a 255)...
XGM_setPCM(64, sfx_jump, sizeof(sfx_jump));
// ...e toque com prioridade em um canal PCM (o canal 1 costuma ficar com a música)
XGM_startPlayPCM(64, 1, SOUND_PCM_CH2);

// Reproduzir música (recurso XGM)
XGM_startPlay(music_level1);

// Parar música
XGM_stopPlay();`,
    range: null
  },
  {
    label: 'sgdk:tilemap',
    detail: 'Load tilemap template',
    kind: 15,
    documentation: 'Template para carregar mapa de tiles',
    insertText: `// Carregar tileset a partir do primeiro tile livre para o jogo
u16 tileIndex = TILE_USER_INDEX;
VDP_loadTileSet(&tiles_tileset, tileIndex, DMA);

// Desenhar o mapa: (plano, mapa, tile base, x/y no plano, x/y no mapa, largura, altura, transferência)
VDP_setTileMapEx(BG_A, &level_tilemap, TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, tileIndex), 0, 0, 0, 0, 40, 28, DMA);

// Outro plano, desenhado a partir da célula (10, 5)
VDP_setTileMapEx(BG_B, &background_tilemap, TILE_ATTR_FULL(PAL1, FALSE, FALSE, FALSE, tileIndex), 10, 5, 0, 0, 20, 10, DMA);`,
    range: null
  },
  // ===== NOVOS SNIPPETS PROFISSIONAIS =====
  {
    label: 'sgdk:game_loop',
    detail: 'Complete game loop',
    kind: 15,
    documentation: 'Loop principal completo com VBlank e input',
    insertText: `int main() {
    SPR_init();
    
    // Carregar recursos
    PAL_setPalette(PAL0, palette.data, CPU);
    VDP_loadTileSet(&tiles, TILE_USER_INDEX, DMA);
    
    // Game loop
    u16 quit = 0;
    while (!quit) {
        // Leitura de entrada
        u16 input = JOY_readJoypad(JOY_1);
        if (input & BUTTON_START) quit = 1;
        
        // Lógica do jogo
        updateGame();
        
        // Renderização
        SPR_update();
        
        // VBlank sync
        SYS_doVBlankProcess();
    }
    
    return 0;
}`,
    range: null
  },
  {
    label: 'sgdk:sprite_animation',
    detail: 'Sprite animation example',
    kind: 15,
    documentation: 'Template para animar sprites',
    insertText: `// As animações vêm da imagem: cada linha de quadros da folha é uma animação.
// Em res/resources.res: SPRITE player_sprite "player.png" 4 4 FAST 6
#define ANIM_IDLE 0
#define ANIM_WALK 1

// Adicionar o sprite
Sprite* player = SPR_addSprite(&player_sprite, 160, 120, TILE_ATTR(PAL1, FALSE, FALSE, FALSE));

// Mudar animação (índice da linha na folha)
SPR_setAnim(player, ANIM_WALK);

// Espelhar para andar à esquerda
SPR_setHFlip(player, TRUE);

// Atualizar sprites uma vez por quadro
SPR_update();`,
    range: null
  },
  {
    label: 'sgdk:collision',
    detail: 'Basic collision detection',
    kind: 15,
    documentation: 'Detecção de colisão simples',
    insertText: `// Colisão simples (retângulos)
bool checkCollision(s16 x1, s16 y1, u16 w1, u16 h1,
                    s16 x2, s16 y2, u16 w2, u16 h2) {
    return !(x1 + w1 < x2 || x2 + w2 < x1 ||
             y1 + h1 < y2 || y2 + h2 < y1);
}

// Usar:
if (checkCollision(playerX, playerY, 16, 16,
                   enemyX, enemyY, 16, 16)) {
    // Colisão detectada!
    handleCollision();
}`,
    range: null
  },
  {
    label: 'sgdk:physics',
    detail: 'Simple physics system',
    kind: 15,
    documentation: 'Sistema de física básico',
    insertText: `// Variáveis de física
fix16 posX = intToFix16(160);
fix16 posY = intToFix16(120);
fix16 velX = 0;
fix16 velY = 0;
fix16 gravity = FIX16(0.2);

// Update física
void updatePhysics() {
    // Aplicar gravidade
    velY = fix16Add(velY, gravity);
    
    // Aplicar velocidade
    posX = fix16Add(posX, velX);
    posY = fix16Add(posY, velY);
    
    // Limitar posição
    if (fix16ToInt(posY) > 224) {
        posY = intToFix16(224);
        velY = 0; // Pulo cancelado
    }
}

// Pulo
void jump() {
    velY = FIX16(-5);
}`,
    range: null
  },
  {
    label: 'sgdk:parallax',
    detail: 'Parallax scrolling',
    kind: 15,
    documentation: 'Efeito de parallax scrolling',
    insertText: `// Parallax scrolling com dois planos
fix16 cameraX = 0;
fix16 bgScrollX = 0;

// Update camera
void updateCamera(fix16 targetX) {
    cameraX = targetX;
    
    // Background se move mais lentamente
    bgScrollX = fix16Div(cameraX, intToFix16(2));
}

// Renderizar
void renderParallax() {
    // Plano A (próximo) se move rápido
    VDP_setHorizontalScroll(BG_A, fix16ToInt(cameraX));
    
    // Plano B (fundo) se move lento
    VDP_setHorizontalScroll(BG_B, fix16ToInt(bgScrollX));
}`,
    range: null
  },
  {
    label: 'sgdk:state_machine',
    detail: 'Game state machine',
    kind: 15,
    documentation: 'Máquina de estados para controlar fases',
    insertText: `// Estados do jogo
typedef enum {
    STATE_MENU,
    STATE_PLAYING,
    STATE_PAUSE,
    STATE_GAMEOVER
} GameState;

GameState gameState = STATE_MENU;

// Update baseado em estado
void updateGame() {
    switch (gameState) {
        case STATE_MENU:
            updateMenu();
            break;
        case STATE_PLAYING:
            updateGameplay();
            break;
        case STATE_PAUSE:
            updatePause();
            break;
        case STATE_GAMEOVER:
            updateGameover();
            break;
    }
}

// Mudar estado
void setGameState(GameState newState) {
    gameState = newState;
}`,
    range: null
  },
  {
    label: 'sgdk:music_system',
    detail: 'Music and SFX system',
    kind: 15,
    documentation: 'Sistema de música e efeitos sonoros',
    insertText: `// Reproduzir música
void playMusic(const u8* musicData) {
    XGM_startPlay(musicData);
}

// Parar música
void stopMusic() {
    XGM_stopPlay();
}

// Efeito sonoro: registre cada sample uma vez (IDs 64 a 255) com XGM_setPCM
void playSFX(u8 id) {
    XGM_startPlayPCM(id, 1, SOUND_PCM_CH2);
}

// Exemplo de uso:
XGM_setPCM(64, sfx_jump, sizeof(sfx_jump));
playMusic(bgm_level1);
playSFX(64);

// Checar se música está tocando
u8 isMusicPlaying() {
    return XGM_isPlaying();
}`,
    range: null
  },
  {
    label: 'sgdk:fade_effect',
    detail: 'Fade in/out effect',
    kind: 15,
    documentation: 'Efeito de fade in/out',
    insertText: `// Fade para preto
void fadeOut(u16 numFrames) {
    PAL_fadeOut(0, 63, numFrames, FALSE); // FALSE: só retorna quando o fade termina
}

// Fade de preto
void fadeIn(const u16* palette, u16 numFrames) {
    PAL_fadeIn(0, 63, palette, numFrames, FALSE);
}

// Uso:
fadeOut(60);        // 1 segundo (60 frames)
fadeIn(myPalette, 60);

// Alternativa: mudar paleta instantaneamente
void paletteSwitch(const u16* palette) {
    PAL_setPalette(PAL0, palette, DMA);
}`,
    range: null
  },
  {
    label: 'sgdk:camera_system',
    detail: 'Camera system',
    kind: 15,
    documentation: 'Sistema de câmera para scrolling',
    insertText: `// Sistema de câmera
struct Camera {
    fix16 x;
    fix16 y;
    u16 width;
    u16 height;
} camera = {0, 0, 320, 224};

// Seguir alvo
void followTarget(fix16 targetX, fix16 targetY) {
    // Smooth camera follow
    camera.x = fix16Add(camera.x, fix16Div(fix16Sub(targetX, camera.x), intToFix16(8)));
    camera.y = fix16Add(camera.y, fix16Div(fix16Sub(targetY, camera.y), intToFix16(8)));
    
    // Limitar câmera aos limites do mapa
    if (camera.x < 0) camera.x = 0;
    if (camera.y < 0) camera.y = 0;
}

// Aplicar câmera
void applyCamera() {
    VDP_setHorizontalScroll(BG_A, fix16ToInt(camera.x));
    VDP_setVerticalScroll(BG_A, fix16ToInt(camera.y));
}`,
    range: null
  },
  {
    label: 'sgdk:tile_collision_map',
    detail: 'Tile-based collision',
    kind: 15,
    documentation: 'Colisão baseada em tiles',
    insertText: `// Mapa de colisão (0=passável, 1=bloqueado)
const u8 collisionMap[] = {
    1,1,1,1,1,1,1,1,
    1,0,0,0,0,0,0,1,
    1,0,0,0,0,0,0,1,
    1,1,0,0,1,0,1,1
};

// Checar colisão em tile
bool isTileBlocked(u16 tileX, u16 tileY) {
    u16 mapWidth = 8;
    u16 index = tileY * mapWidth + tileX;
    return collisionMap[index] == 1;
}

// Movimento com colisão
bool canMoveTo(s16 x, s16 y, u16 width, u16 height) {
    u16 tileSize = 16;
    u16 x1 = x / tileSize;
    u16 y1 = y / tileSize;
    u16 x2 = (x + width - 1) / tileSize;
    u16 y2 = (y + height - 1) / tileSize;
    
    for (u16 ty = y1; ty <= y2; ty++) {
        for (u16 tx = x1; tx <= x2; tx++) {
            if (isTileBlocked(tx, ty)) return FALSE;
        }
    }
    return TRUE;
}`,
    range: null
  },
  {
    label: 'sgdk:vblank_handler',
    detail: 'VBlank interrupt handler',
    kind: 15,
    documentation: 'Handler customizado para VBlank interrupt',
    insertText: `// Handler de VBlank customizado
void myVBlankHandler() {
    // Atualizar contadores
    frameCounter++;
    
    // Mantenha curto: a fila de DMA e os sprites são enviados pelo próprio
    // SYS_doVBlankProcess(), chamado no laço principal (nunca daqui de dentro)
}

// Registrar handler no main
int main() {
    SYS_setVBlankCallback(myVBlankHandler);
    
    // Resto do código...
    return 0;
}`,
    range: null
  },
  {
    label: 'sgdk:dma_operations',
    detail: 'DMA queue operations',
    kind: 15,
    documentation: 'Operações de DMA para transferências rápidas',
    insertText: `// Fila de DMA
void loadLargeTileset() {
    // Enfileirar a transferência: (destino, origem, endereço na VRAM, tamanho em words, passo)
    DMA_queueDma(DMA_VRAM, (void*) tiledata_ptr, TILE_USER_INDEX * 32, tiledata_words, 2);
    
    // A fila de DMA é enviada no próximo VBlank
    SYS_doVBlankProcess();
}

// Flush da fila DMA
void flushDMA() {
    DMA_flushQueue();
    VDP_waitVSync();
}`,
    range: null
  },
  {
    label: 'sgdk:bitmask_operations',
    detail: 'Bitwise operations',
    kind: 15,
    documentation: 'Operações com bits para flags e estados',
    insertText: `// Flags usando bitwise
typedef enum {
    FLAG_ALIVE = (1 << 0),
    FLAG_JUMPING = (1 << 1),
    FLAG_HURTING = (1 << 2),
    FLAG_INVINCIBLE = (1 << 3),
    FLAG_MOVING = (1 << 4)
} EntityFlags;

u16 entityFlags = 0;

// Definir flag
void setFlag(u16* flags, u16 flag) {
    *flags |= flag;
}

// Remover flag
void clearFlag(u16* flags, u16 flag) {
    *flags &= ~flag;
}

// Checar flag
bool hasFlag(u16 flags, u16 flag) {
    return (flags & flag) != 0;
}

// Usar:
setFlag(&entityFlags, FLAG_JUMPING);
if (hasFlag(entityFlags, FLAG_JUMPING)) {
    // Está pulando
}`,
    range: null
  },
  {
    label: 'sgdk:animation_state_machine',
    detail: 'Animation state machine',
    kind: 15,
    documentation: 'Máquina de estados para animações',
    insertText: `// Estados de animação
typedef enum {
    ANIM_STATE_IDLE,
    ANIM_STATE_WALK,
    ANIM_STATE_JUMP,
    ANIM_STATE_FALL,
    ANIM_STATE_DASH
} AnimationState;

typedef struct {
    Sprite* sprite;
    AnimationState animState;
    AnimationState prevAnimState;
} Entity;

Entity player;

// Mudar animação
void setAnimationState(Entity* entity, AnimationState newState) {
    if (entity->animState != newState) {
        entity->prevAnimState = entity->animState;
        entity->animState = newState;
        
        // Aplicar nova animação baseado em estado
        switch (newState) {
            case ANIM_STATE_IDLE:
                SPR_setAnim(entity->sprite, ANIM_IDLE);
                break;
            case ANIM_STATE_WALK:
                SPR_setAnim(entity->sprite, ANIM_WALK);
                break;
            case ANIM_STATE_JUMP:
                SPR_setAnim(entity->sprite, ANIM_JUMP);
                break;
            // ...
        }
    }
}`,
    range: null
  },
  {
    label: 'sgdk:level_loader',
    detail: 'Level loading system',
    kind: 15,
    documentation: 'Sistema de carregamento de níveis',
    insertText: `// Sistema de carregamento de nível
typedef struct {
    const TileMap* tilemap;
    const TileSet* tileset;
    const Palette* palette;
    const u8* collisionData;
    u16 width;
    u16 height;
} Level;

// Dados dos níveis
const Level levels[] = {
    {
        .tilemap = &level1_tilemap,
        .tileset = &level1_tiles,
        .palette = &level1_palette,
        .collisionData = level1_collision,
        .width = 320,
        .height = 224
    },
    // Mós níveis...
};

// Carregar nível
void loadLevel(u16 levelIndex) {
    const Level* level = &levels[levelIndex];
    
    // Limpar tela
    VDP_clearPlane(BG_A, TRUE);
    VDP_clearPlane(BG_B, TRUE);
    
    // Carregar recursos
    PAL_setPalette(PAL0, level->palette->data, DMA);
    VDP_loadTileSet(level->tileset, TILE_USER_INDEX, DMA);
    VDP_setTileMapEx(BG_A, level->tilemap, TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, TILE_USER_INDEX), 0, 0, 0, 0, 40, 28, DMA);
    
    // Reset do jogo
    playerX = 160;
    playerY = 120;
}`,
    range: null
  },
  {
    label: 'sgdk:score_system',
    detail: 'Score and HUD system',
    kind: 15,
    documentation: 'Sistema de pontuação e HUD',
    insertText: `// Sistema de pontuação
u32 score = 0;
u32 lives = 3;
u32 level = 1;

// Atualizar pontuação
void addScore(u32 points) {
    score += points;
    if (score > 999999) score = 999999; // Max
    updateHUD();
}

// Redesenhar HUD
void updateHUD() {
    // Limpar área HUD
    VDP_clearTileMapRect(BG_B, 0, 0, 40, 3);
    
    // Desenhar pontuação
    char scoreText[20];
    sprintf(scoreText, "SCORE:%06ld", score);
    VDP_drawText(scoreText, 1, 1);
    
    // Desenhar vidas
    char livesText[20];
    sprintf(livesText, "LIVES:%ld", lives);
    VDP_drawText(livesText, 20, 1);
    
    // Desenhar level
    char levelText[20];
    sprintf(levelText, "LEVEL:%ld", level);
    VDP_drawText(levelText, 30, 1);
}

// Perder vida
void loseLife() {
    lives--;
    if (lives == 0) {
        gameState = STATE_GAMEOVER;
    } else {
        resetLevel();
    }
    updateHUD();
}`,
    range: null
  }
];

/**
 * Registra snippets no Monaco Editor
 */
export function registerSGDKSnippets(monaco) {
  const disposables = []
  sgdkSnippets.forEach(snippet => {
    disposables.push(monaco.languages.registerCompletionItemProvider('c', {
      triggerCharacters: [':'],
      provideCompletionItems: (model, position) => {
        if (!model || !position || position.lineNumber < 1 || position.lineNumber > model.getLineCount()) {
          return null;
        }
        const lineText = model.getLineContent(position.lineNumber);
        const match = lineText.match(/sgdk:(\w*)$/);
        
        if (!match) return null;
        
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - match[1].length - 6,
          endColumn: position.column
        };

        return {
          suggestions: [snippet].map(s => ({
            label: s.label,
            kind: s.kind,
            documentation: s.documentation,
            insertText: s.insertText,
            insertTextRules: 4, // InsertAsSnippet
            range,
            detail: s.detail
          }))
        };
      }
    }))
  })
  return disposables
}
