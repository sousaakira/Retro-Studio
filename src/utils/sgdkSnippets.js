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
    insertText: `int main() {
    SYS_init();
    
    // Seu código aqui
    
    while (1) {
        VDP_waitVSync();
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
    insertText: `// Carregar tileset
u16 tileIndex = VDP_loadTileSet(&sprite_tileset, 0, COMPRESSION_NONE);

// Criar definição de sprite
SpriteDefinition sprDef = {
    .width = sprite_width,
    .height = sprite_height,
    .numFrames = num_frames,
    .tiles = sprite_tiles,
    .animations = sprite_animations
};

// Adicionar sprite na tela
Sprite* spr = SPR_addSprite(&sprDef, 160, 120, NULL);`,
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
VDP_setPaletteColor(0, RGB24_TO_VDPCOLOR(0x000000)); // Cor preta
VDP_setPaletteColor(1, RGB24_TO_VDPCOLOR(0xFFFFFF)); // Cor branca
VDP_setPaletteColor(2, RGB24_TO_VDPCOLOR(0xFF0000)); // Cor vermelha
VDP_setPaletteColor(3, RGB24_TO_VDPCOLOR(0x00FF00)); // Cor verde
VDP_setPaletteColor(4, RGB24_TO_VDPCOLOR(0x0000FF)); // Cor azul`,
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
VDP_drawIntEx(score, 27, 10, FALSE, 6);`,
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
fix16 velocityX = FMUL(posX, intToFix16(2));

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
    insertText: `// Reproduzir som
SND_play(SFX_JUMP);

// Reproduzir música
SND_play(MUSIC_LEVEL1);

// Parar música
SND_stopMusic();`,
    range: null
  },
  {
    label: 'sgdk:tilemap',
    detail: 'Load tilemap template',
    kind: 15,
    documentation: 'Template para carregar mapa de tiles',
    insertText: `// Carregar tileset
u16 tileIndex = VDP_loadTileSet(&tiles_tileset, 0, COMPRESSION_NONE);

// Carregar mapa de tiles
VDP_setTileMapEx(VDP_PLANE_A, &level_tilemap, COMPRESSION_NONE, 0, 0);

// Alternativa com posição de offset
VDP_setTileMapEx(VDP_PLANE_B, &background_tilemap, COMPRESSION_NONE, 10, 5);`,
    range: null
  },
  // ===== NOVOS SNIPPETS PROFISSIONAIS =====
  {
    label: 'sgdk:game_loop',
    detail: 'Complete game loop',
    kind: 15,
    documentation: 'Loop principal completo com VBlank e input',
    insertText: `int main() {
    SYS_init();
    VDP_init();
    SPR_init();
    
    // Carregar recursos
    PAL_setPalette(PAL0, palette.data, CPU);
    VDP_loadTileSet(&tiles, 0, COMPRESSION_NONE);
    
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
    insertText: `// Definir animações
Animation animations[2] = {
    {
        .numFrames = 4,
        .frames = sprite_anim_walk_frames,
        .duration = 4
    },
    {
        .numFrames = 1,
        .frames = sprite_anim_idle_frames,
        .duration = 0
    }
};

AnimationData animData = {
    .numAnimations = 2,
    .animations = animations
};

// Adicionar sprite com animação
Sprite* player = SPR_addSprite(&playerDef, 160, 120, &animData);

// Mudar animação
SPR_setAnimationEx(player, ANIM_WALK, FALSE, TRUE, 4);

// Atualizar sprites
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
    velY = F16_add(velY, gravity);
    
    // Aplicar velocidade
    posX = F16_add(posX, velX);
    posY = F16_add(posY, velY);
    
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
    bgScrollX = F16_div(cameraX, intToFix16(2));
}

// Renderizar
void renderParallax() {
    // Plano A (próximo) se move rápido
    VDP_setHorizontalScroll(VDP_PLANE_A, fix16ToInt(cameraX));
    
    // Plano B (fundo) se move lento
    VDP_setHorizontalScroll(VDP_PLANE_B, fix16ToInt(bgScrollX));
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

// Efeito sonoro
void playSFX(const u8* sfxData) {
    XGM2_play(sfxData);
}

// Exemplo de uso:
playMusic(bgm_level1);
playSFX(sfx_jump);

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
    PAL_fadeOut(0, 63, numFrames, TRUE);
}

// Fade de preto
void fadeIn(const u16* palette, u16 numFrames) {
    PAL_fadeIn(0, 63, palette, numFrames, TRUE);
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
    camera.x = F16_add(camera.x, F16_div(F16_sub(targetX, camera.x), intToFix16(8)));
    camera.y = F16_add(camera.y, F16_div(F16_sub(targetY, camera.y), intToFix16(8)));
    
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
    
    // Processar DMA
    DMA_queue();
    
    // Chamar handler padrão
    SYS_doVBlankProcess();
}

// Registrar handler no main
int main() {
    SYS_setVBlankHandler(&myVBlankHandler);
    
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
    // Alocar e enfileirar transferências
    u16* dmaQueue = DMA_allocateAndQueueDma(
        VRAM,
        tiledata_ptr,
        tiledata_size
    );
    
    // Outras operações podem acontecer enquanto DMA processa
    
    // Aguardar conclusão
    while (DMA_isWorking()) {
        VDP_waitVSync();
    }
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

struct Entity {
    Sprite* sprite;
    AnimationState animState;
    AnimationState prevAnimState;
} player;

// Mudar animação
void setAnimationState(Entity* entity, AnimationState newState) {
    if (entity->animState != newState) {
        entity->prevAnimState = entity->animState;
        entity->animState = newState;
        
        // Aplicar nova animação baseado em estado
        switch (newState) {
            case ANIM_STATE_IDLE:
                SPR_setAnimationEx(entity->sprite, ANIM_IDLE, FALSE, TRUE, 4);
                break;
            case ANIM_STATE_WALK:
                SPR_setAnimationEx(entity->sprite, ANIM_WALK, FALSE, TRUE, 4);
                break;
            case ANIM_STATE_JUMP:
                SPR_setAnimationEx(entity->sprite, ANIM_JUMP, FALSE, FALSE, 0);
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
    Level* level = &levels[levelIndex];
    
    // Limpar tela
    VDP_clearPlane(BG_A);
    VDP_clearPlane(BG_B);
    
    // Carregar recursos
    PAL_setPalette(PAL0, level->palette->data, DMA);
    VDP_loadTileSet(level->tileset, 0, COMPRESSION_NONE);
    VDP_setTileMapEx(BG_A, level->tilemap, COMPRESSION_NONE, 0, 0);
    
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
    VDP_fillTileRect(BG_B, 0, 0, 40, 3);
    
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
  sgdkSnippets.forEach(snippet => {
    monaco.languages.registerCompletionItemProvider('c', {
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
    })
  });
}
