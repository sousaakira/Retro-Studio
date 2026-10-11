// #70: "jogo gerado". A IDE escreve, em src/game/, o código que liga sala inicial, personagem,
// física, câmera e troca de sala; o main.c do projeto só chama esse código. Quem programa
// continua programando: o que é gerado fica em arquivos próprios e nunca dentro do main.c.
export const GAME_FORMAT = 'retro-studio.game'
export const GAME_ROLES = ['idle', 'walk', 'jump', 'fall']
export const GAME_DIRECTORY = 'src/game'
/** Módulos de runtime (arquivos em src/retro_runtime) que o código gerado usa. */
export const GAME_RUNTIME_FILES = ['retro_core.h', 'retro_world.h', 'retro_world_sgdk.h', 'retro_movement.h', 'retro_character.h', 'retro_character_sprite.h', 'retro_camera.h']
const BANNER = '/* Gerado pelo Retro Studio (modo Jogo → Jogador e início). Não edite este arquivo:\n * ele é refeito a cada exportação. Seu código fica em src/main.c e nos seus arquivos. */\n'
const identifier = text => String(text || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_')

export function createGameConfiguration() {
  return { format: GAME_FORMAT, version: 1, player: { character: '', animations: { idle: '', walk: '', jump: '', fall: '' } } }
}

export function validateGameConfiguration(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.format !== GAME_FORMAT || config.version !== 1) throw new Error('Configuração do jogo em formato desconhecido.')
  const player = config.player
  if (!player || typeof player !== 'object' || Array.isArray(player)) throw new Error('Configuração do jogo sem a seção do jogador.')
  if (typeof player.character !== 'string' || player.character.length > 200 || (player.character && !/^charsets\/[^/\\]+\.charset\.json$/.test(player.character))) throw new Error('O personagem do jogador precisa ser um projeto de personagem em charsets/.')
  if (!player.animations || typeof player.animations !== 'object' || Array.isArray(player.animations)) throw new Error('Configuração do jogo sem as animações do jogador.')
  for (const role of GAME_ROLES) if (typeof player.animations[role] !== 'string' || player.animations[role].length > 80) throw new Error('Animação inválida para "' + role + '".')
  for (const key of Object.keys(player.animations)) if (!GAME_ROLES.includes(key)) throw new Error('Animação desconhecida: ' + key + '.')
  return config
}

/**
 * O que o código gerado precisa saber do personagem escolhido, a partir do projeto do Charset
 * Maker já exportado. Devolve { player, problems }: com problemas, nada é gerado.
 */
export function resolveGamePlayer(config, charset) {
  const problems = []
  if (!config.player.character) return { player: null, problems: ['Escolha o personagem do jogador.'] }
  if (!charset || !Array.isArray(charset.animations)) return { player: null, problems: ['O personagem escolhido não foi encontrado em ' + config.player.character + '.'] }
  const name = String(charset.characterName || '').toLowerCase().replace(/[^a-z0-9_]/g, '_')
  const header = String(charset.exportedHeaderName || ''), resource = String(charset.exportedResourceName || '')
  if (!name || !header || !resource || !charset.exportedFileName) problems.push('O personagem ainda não foi exportado. Abra-o no modo Personagens e clique em Exportar.')
  else if (header !== name + '_animations.h') problems.push('O personagem mudou de nome depois da última exportação. Exporte-o de novo no modo Personagens.')
  if (resource && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(resource)) problems.push('Nome de sprite inválido no personagem: ' + resource + '.')
  const names = charset.animations.map(animation => String(animation.name || ''))
  if (!names.length) problems.push('O personagem não tem animações.')
  const animations = {}
  for (const role of GAME_ROLES) {
    const chosen = config.player.animations[role]
    if (!chosen) continue
    if (!names.includes(chosen)) problems.push('A animação "' + chosen + '" não existe mais no personagem.')
    else animations[role] = chosen
  }
  if (!config.player.animations.idle) problems.push('Escolha a animação de "parado" (as outras são opcionais e usam a de parado quando faltam).')
  // Quadro do personagem: do projeto ou, em projetos por recortes, do maior quadro das animações.
  const frames = charset.animations.flatMap(animation => [animation, ...(Array.isArray(animation.frames) ? animation.frames : [])])
  const size = key => Number(charset['crop' + key] || charset['frame' + key]) || Math.max(0, ...frames.map(frame => Number(frame['frame' + key] || frame[key.toLowerCase()]) || 0))
  const width = size('Width'), height = size('Height')
  if (!problems.length && (!width || !height)) problems.push('Não foi possível descobrir o tamanho do quadro do personagem. Exporte-o de novo no modo Personagens.')
  // Caixa de colisão (relativa aos pés): a do Charset Maker, se couber no quadro; senão, metade da largura e quase toda a altura.
  const box = charset.bodyBox, integer = value => Number.isInteger(value)
  const custom = box && [box.x, box.y, box.width, box.height].every(integer) && box.width > 0 && box.height > 0 && box.width <= width && box.height <= height
  const body = custom ? { x: box.x, y: box.y, width: box.width, height: box.height } : { x: -Math.round(width / 4), y: -Math.max(1, height - 2), width: Math.max(1, Math.round(width / 2)), height: Math.max(1, height - 2) }
  if (problems.length) return { player: null, problems }
  const prefix = identifier(name), macro = role => prefix + '_ANIM_' + identifier(animations[role] || animations.idle)
  // Reserva de VRAM para sprites: o quadro do jogador com folga (quadros podem usar mais de um sprite).
  const tiles = Math.max(128, Math.ceil(width / 8) * Math.ceil(height / 8) * 2 + 32)
  return { problems, player: { name, prefix, header, resource, definition: name + '_character_definition', tiles: Math.min(tiles, 1024), body, bodyFromCharacter: !!custom,
    animations: Object.fromEntries(GAME_ROLES.map(role => [role, macro(role)])), roles: Object.fromEntries(GAME_ROLES.map(role => [role, animations[role] || ''])) } }
}

const FILES = {
  'game.h': () => BANNER + `#ifndef GAME_H
#define GAME_H
#include <genesis.h>

/* Como usar, em src/main.c:
 *
 *   gameInit();                 // vídeo, sala inicial e jogador
 *   while (TRUE) {
 *       gameUpdate();           // controle, física, salas e câmera deste quadro
 *       // ... seu código (inimigos, itens, HUD, regras) ...
 *       gameEndFrame();         // desenha os sprites, espera o VBlank, avança a animação
 *   }
 */
void gameInit(void);
void gameUpdate(void);
void gameEndFrame(void);

/* Para o seu código consultar o estado do jogo. */
s16 gamePlayerX(void);            /* pés do jogador, em pixels da sala */
s16 gamePlayerY(void);
u8 gamePlayerOnGround(void);
u8 gamePlayerFacingLeft(void);
Sprite *gamePlayerSprite(void);
s16 gameCameraX(void);            /* canto superior esquerdo da tela, em pixels da sala */
s16 gameCameraY(void);
u16 gameRoomId(void);             /* ID numérico da sala atual (os de generated/world_config.h) */
u16 gameButtonsHeld(void);        /* botões do controle 1: segurados e apertados neste quadro */
u16 gameButtonsPressed(void);

/* Mostra a mensagem e para o jogo: use para erros que não deveriam acontecer. */
void gameFail(const char *message);
#endif
`,
  'game_internal.h': () => BANNER + `#ifndef GAME_INTERNAL_H
#define GAME_INTERNAL_H
/* Ligações entre os módulos gerados. Cada arquivo cuida de um assunto:
 *   game.c         ordem das coisas a cada quadro
 *   game_world.c   salas, saídas e checkpoints
 *   game_player.c  física, animação e sprite do jogador
 *   game_camera.c  câmera
 *   game_audio.c   música da sala */
#include "game.h"
#include "retro_runtime/retro_movement.h"

/* A sala atual, do jeito que o jogador e a câmera precisam vê-la. */
typedef struct {
    u16 id;
    s16 width, height;
    const RetroCollider *colliders; u16 colliderCount;
    const RetroSlope *slopes; u16 slopeCount;
} GameRoom;

void gameWorldInit(void);
const GameRoom *gameWorldRoom(void);
/* Saídas e checkpoints sob os pés do jogador. Devolve 1 se trocou de sala. */
u8 gameWorldTriggers(s16 x, s16 y);
u8 gameWorldRespawn(void);
void gameWorldScroll(s16 x, s16 y);

void gamePlayerInit(void);
void gamePlayerEnterRoom(const GameRoom *room, s16 x, s16 y, u8 facingLeft);
void gamePlayerUpdate(const GameRoom *room, u16 held, u16 pressed);
void gamePlayerDraw(s16 cameraX, s16 cameraY);
void gamePlayerAnimate(void);
RetroFixed gamePlayerFixedX(void);
RetroFixed gamePlayerFixedY(void);

void gameCameraInit(void);
void gameCameraEnterRoom(const GameRoom *room, RetroFixed x, RetroFixed y, u8 facingLeft);
/* Devolve 0 quando a câmera não tem posição válida neste quadro. */
u8 gameCameraUpdate(RetroFixed x, RetroFixed y, u8 facingLeft, s16 *cameraX, s16 *cameraY);

void gameAudioInit(void);
void gameAudioTick(void);
void gameAudioEnterRoom(u16 room);
#endif
`,
  'game_config.h': player => BANNER + `#ifndef GAME_CONFIG_H
#define GAME_CONFIG_H
/* O que foi escolhido em "Jogador e início". */
#include "resources.h"
#include "retro_runtime/retro_character_sprite.h"
#include "${player.header}"

#define GAME_PLAYER_SPRITE ${player.resource}
#define GAME_PLAYER_DEFINITION ${player.definition}
/* Animação de cada situação. Situação sem animação própria usa a de parado. */
#define GAME_PLAYER_ANIM_IDLE ${player.animations.idle}
#define GAME_PLAYER_ANIM_WALK ${player.animations.walk}
#define GAME_PLAYER_ANIM_JUMP ${player.animations.jump}
#define GAME_PLAYER_ANIM_FALL ${player.animations.fall}
/* Caixa de colisão do jogador, relativa aos pés (${player.bodyFromCharacter ? 'definida no Charset Maker' : 'padrão: o personagem não tem uma definida no Charset Maker'}). */
#define GAME_PLAYER_BODY_X (${player.body.x})
#define GAME_PLAYER_BODY_Y (${player.body.y})
#define GAME_PLAYER_BODY_WIDTH ${player.body.width}
#define GAME_PLAYER_BODY_HEIGHT ${player.body.height}
/* Tiles de VRAM reservados para sprites. */
#define GAME_SPRITE_TILES ${player.tiles}
#endif
`,
  'game.c': () => BANNER + `#include "game_internal.h"
#include "retro_runtime/retro_core.h"

static RetroInput input = {0};
static s16 cameraX, cameraY;
static u8 roomChanged;

void gameFail(const char *message) {
    VDP_drawText(message, 1, 1);
    while (TRUE) SYS_doVBlankProcess();
}

void gameInit(void) {
    /* Vídeo: 320 de largura, planos de 64x32 tiles com scroll por plano. */
    VDP_setScreenWidth320();
    VDP_setPlaneSize(64, 32, TRUE);
    VDP_setScrollingMode(HSCROLL_PLANE, VSCROLL_PLANE);
    DMA_setBufferSize(8192);
    DMA_setMaxQueueSize(64);
    DMA_setMaxTransferSize(7200);
    DMA_setAutoFlush(TRUE);
    JOY_init();

    gameAudioInit();
    gameCameraInit();
    gamePlayerInit();
    /* Carrega a sala inicial e põe o jogador no ponto de entrada. */
    gameWorldInit();
}

void gameUpdate(void) {
    const GameRoom *room;
    retroInputUpdate(&input, JOY_readJoypad(JOY_1));
    gameAudioTick();

    /* START volta ao último checkpoint (ou ao início da sala). */
    roomChanged = (input.pressed & BUTTON_START) ? gameWorldRespawn() : 0;
    room = gameWorldRoom();
    if (!roomChanged && room) {
        gamePlayerUpdate(room, input.held, input.pressed);
        roomChanged = gameWorldTriggers(gamePlayerX(), gamePlayerY());
        /* Caiu para fora da sala (buraco sem chão): volta ao último checkpoint ou à entrada. */
        if (!roomChanged && gamePlayerY() > room->height + 64) roomChanged = gameWorldRespawn();
    }
    if (gameCameraUpdate(gamePlayerFixedX(), gamePlayerFixedY(), gamePlayerFacingLeft(), &cameraX, &cameraY))
        gameWorldScroll(cameraX, cameraY);
    gamePlayerDraw(cameraX, cameraY);
}

void gameEndFrame(void) {
    SPR_update();
    SYS_doVBlankProcess();
    /* A animação avança depois do quadro desenhado. */
    if (!roomChanged) gamePlayerAnimate();
}

s16 gameCameraX(void) { return cameraX; }
s16 gameCameraY(void) { return cameraY; }
u16 gameButtonsHeld(void) { return input.held; }
u16 gameButtonsPressed(void) { return input.pressed; }
`,
  'game_world.c': () => BANNER + `#include "game_internal.h"
#include "resources.h"
#include "retro_runtime/retro_world_sgdk.h"
#include "generated/world_config.h"
#include "generated/world_maps.h"

static RetroWorld world = {0};
static RetroWorldSgdk bridge = {0};
static GameRoom current;
static u8 hasRoom;
static u16 lastCheckpoint = RETRO_ID_NONE;

/* Chamado sempre que uma sala fica ativa: no início, ao atravessar uma saída e ao
 * voltar para o checkpoint. */
static void roomActivated(void *context, const RetroWorld *value) {
    u16 i;
    (void)context;
    hasRoom = 0;
    for (i = 0; i < RETRO_WORLD_MAP_COUNT; i++) {
        if (retroWorldMapGeometry[i].room != value->room->id) continue;
        current.id = value->room->id;
        current.width = (s16)value->room->width;
        current.height = (s16)value->room->height;
        current.colliders = retroWorldMapGeometry[i].colliders;
        current.colliderCount = retroWorldMapGeometry[i].colliderCount;
        current.slopes = retroWorldMapGeometry[i].slopes;
        current.slopeCount = retroWorldMapGeometry[i].slopeCount;
        hasRoom = 1;
        break;
    }
    if (!hasRoom) return;
    gamePlayerEnterRoom(&current, value->x, value->y, value->facing);
    gameCameraEnterRoom(&current, gamePlayerFixedX(), gamePlayerFixedY(), value->facing);
    gameAudioEnterRoom(current.id);
}

/* Saídas com condição (porta trancada, item necessário): por enquanto nenhuma condição é
 * considerada satisfeita. */
static u8 exitCondition(void *context, u16 id) { (void)context; (void)id; return 0; }

static u8 inside(const RetroRect *area, s16 x, s16 y) {
    return x >= area->x && x < area->x + area->width && y >= area->y && y < area->y + area->height;
}

void gameWorldInit(void) {
    if (retroWorldSgdkInit(&bridge, &world, &retroProjectWorld, retroWorldMapBindings, RETRO_WORLD_MAP_COUNT,
                           roomActivated, exitCondition, 0) != RETRO_WORLD_OK) gameFail("SALA INICIAL NAO CARREGOU");
    if (!hasRoom) gameFail("SALA INICIAL SEM MAPA EXPORTADO");
}

const GameRoom *gameWorldRoom(void) { return hasRoom ? &current : 0; }
u16 gameRoomId(void) { return hasRoom ? current.id : RETRO_ID_NONE; }
u8 gameWorldRespawn(void) { return retroWorldRespawn(&world) == RETRO_WORLD_OK; }
void gameWorldScroll(s16 x, s16 y) { retroWorldSgdkScroll(&bridge, x, y); }

u8 gameWorldTriggers(s16 x, s16 y) {
    u16 i;
    for (i = 0; (s16)i < (s16)RETRO_PROJECT_WORLD_CHECKPOINT_COUNT; i++) {
        const RetroWorldTrigger *trigger = &retroProjectWorldCheckpointAreas[i];
        if (trigger->room == world.room->id && inside(&trigger->area, x, y) && lastCheckpoint != trigger->id &&
            retroWorldCheckpoint(&world, trigger->id) == RETRO_WORLD_OK) lastCheckpoint = trigger->id;
    }
    for (i = 0; (s16)i < (s16)RETRO_PROJECT_WORLD_EXIT_COUNT; i++) {
        const RetroWorldTrigger *trigger = &retroProjectWorldExitAreas[i];
        if (trigger->room == world.room->id && inside(&trigger->area, x, y) &&
            retroWorldExitThrough(&world, trigger->id) == RETRO_WORLD_OK) return 1;
    }
    return 0;
}
`,
  'game_player.c': () => BANNER + `#include "game_internal.h"
#include "game_config.h"

/* Física exportada em "Física e sala de testes"; sem ela, os valores padrão do módulo. */
#if defined(__has_include) && __has_include("generated/movement_config.h")
#include "generated/movement_config.h"
#define GAME_HAS_PHYSICS 1
#else
#define GAME_HAS_PHYSICS 0
#endif

/* A física testa cada colisor várias vezes por quadro. Num mapa com dezenas de colisores isso
 * custa mais que um quadro inteiro no Mega Drive, então a cada quadro só os colisores perto do
 * jogador são entregues a ela. A margem cobre a maior velocidade que a física aceita (32 px por
 * quadro) com folga; o resultado é o mesmo de testar todos. */
#define GAME_NEAR_MARGIN 48
#define GAME_NEAR_MAX 24
static RetroCollider nearColliders[GAME_NEAR_MAX];

static RetroMovement movement = {0};
static RetroMovementConfig physics;
static RetroMovementResult lastResult;
static RetroCharacter character = {0};
static RetroCharacterSprite characterSprite = {0};
static Sprite *sprite;
static u16 currentAnimation;

/* Condições usadas por transições de animação desenhadas no Charset Maker: 1 = subindo, 2 = caindo. */
static u8 animationCondition(void *context, u16 predicate) {
    (void)context;
    return predicate == 1 ? movement.velocityY < 0 : predicate == 2 ? movement.velocityY >= 0 : 0;
}

void gamePlayerInit(void) {
    RetroCharacterHost host = {0, animationCondition, 0, 0, 0};
#if GAME_HAS_PHYSICS
    physics = IS_PAL_SYSTEM ? retroProjectMovementPal : retroProjectMovementNtsc;
#else
    retroMovementPreset(&physics);
#endif
    SPR_initEx(GAME_SPRITE_TILES);
    PAL_setPalette(PAL1, GAME_PLAYER_SPRITE.palette->data, DMA);
    sprite = SPR_addSprite(&GAME_PLAYER_SPRITE, 0, 0, TILE_ATTR(PAL1, TRUE, FALSE, FALSE));
    if (!sprite) gameFail("SEM VRAM PARA O JOGADOR");
    currentAnimation = GAME_PLAYER_ANIM_IDLE;
    if (!retroCharacterInit(&character, &GAME_PLAYER_DEFINITION, GAME_PLAYER_ANIM_IDLE, &host) ||
        !retroCharacterSpriteAttach(&characterSprite, &character, sprite)) gameFail("PERSONAGEM NAO INICIOU");
    retroCharacterSpritePriority(&characterSprite, TRUE);
    SPR_update();
    SYS_doVBlankProcess();
}

void gamePlayerEnterRoom(const GameRoom *room, s16 x, s16 y, u8 facingLeft) {
    RetroBody body;
    u16 i;
    /* Entrada desenhada um pouco dentro do chão: o jogador começa em cima dele, não afundado. */
    for (i = 0; i < room->colliderCount; i++) {
        const RetroRect *box = &room->colliders[i].box;
        if (box->width > 0 && x >= box->x && x < box->x + box->width && y > box->y && y <= box->y + box->height && y - box->y <= 16) y = box->y;
    }
    body.x = (RetroFixed)x * RETRO_FIXED_ONE;
    body.y = (RetroFixed)y * RETRO_FIXED_ONE;
    body.box.x = GAME_PLAYER_BODY_X; body.box.y = GAME_PLAYER_BODY_Y;
    body.box.width = GAME_PLAYER_BODY_WIDTH; body.box.height = GAME_PLAYER_BODY_HEIGHT;
    body.mask = 0xFFFF;
    retroMovementInit(&movement, &body);
    movement.facing = movement.movementFacing = facingLeft;
    lastResult.conditions = 0; lastResult.invalid = 0;
    currentAnimation = GAME_PLAYER_ANIM_IDLE;
    retroCharacterSetState(&character, GAME_PLAYER_ANIM_IDLE);
}

/* Copia para nearColliders os colisores ao alcance do jogador neste quadro. Devolve quantos; se
 * não couberem todos, devolve 0xFFFF e a física usa a lista inteira (mais lento, mas correto). */
static u16 collidersNearPlayer(const GameRoom *room) {
    s16 left = gamePlayerX() + GAME_PLAYER_BODY_X - GAME_NEAR_MARGIN;
    s16 top = gamePlayerY() + GAME_PLAYER_BODY_Y - GAME_NEAR_MARGIN;
    s16 right = left + GAME_PLAYER_BODY_WIDTH + 2 * GAME_NEAR_MARGIN;
    s16 bottom = top + GAME_PLAYER_BODY_HEIGHT + 2 * GAME_NEAR_MARGIN;
    u16 i, count = 0;
    for (i = 0; i < room->colliderCount; i++) {
        const RetroRect *box = &room->colliders[i].box;
        if (box->x >= right || box->x + box->width <= left || box->y >= bottom || box->y + box->height <= top) continue;
        if (count == GAME_NEAR_MAX) return 0xFFFF;
        nearColliders[count++] = room->colliders[i];
    }
    return count;
}

void gamePlayerUpdate(const GameRoom *room, u16 held, u16 pressed) {
    RetroMovementInput controls = {0, 0};
    u16 near = collidersNearPlayer(room);
    RetroFixed minimum = -(RetroFixed)GAME_PLAYER_BODY_X * RETRO_FIXED_ONE;
    RetroFixed maximum = ((RetroFixed)room->width - GAME_PLAYER_BODY_X - GAME_PLAYER_BODY_WIDTH) * RETRO_FIXED_ONE;

    /* Controle: esquerda/direita andam, B ou C pulam, baixo desce de plataformas atravessáveis. */
    controls.axis = (signed char)(((held & BUTTON_RIGHT) ? 1 : 0) - ((held & BUTTON_LEFT) ? 1 : 0));
    if (held & (BUTTON_B | BUTTON_C)) controls.buttons |= RETRO_MOVE_JUMP_HELD;
    if (pressed & (BUTTON_B | BUTTON_C)) controls.buttons |= RETRO_MOVE_JUMP_PRESSED;
    if (held & BUTTON_DOWN) controls.buttons |= RETRO_MOVE_DROP_HELD;

    /* Física e colisão contra o terreno da sala; o jogador não sai pelos lados. */
    if (near == 0xFFFF) lastResult = retroMovementTick(&movement, &physics, controls, room->colliders, room->colliderCount, room->slopes, room->slopeCount);
    else lastResult = retroMovementTick(&movement, &physics, controls, nearColliders, near, room->slopes, room->slopeCount);
    if (movement.body.x < minimum) { movement.body.x = minimum; movement.velocityX = 0; }
    if (movement.body.x > maximum) { movement.body.x = maximum; movement.velocityX = 0; }
}

void gamePlayerDraw(s16 cameraX, s16 cameraY) {
    retroCharacterSpriteFacing(&characterSprite, movement.facing, 0);
    retroCharacterSpritePosition(&characterSprite, gamePlayerX(), gamePlayerY(), cameraX, cameraY);
}

void gamePlayerAnimate(void) {
    u32 conditions;
    if (lastResult.invalid) return;
    /* bit 1 = no chão, bit 2 = andando. */
    conditions = (lastResult.conditions & ~2UL) | (movement.velocityX ? 2UL : 0UL);
    if (!GAME_PLAYER_DEFINITION.transitionCount) {
        /* Personagem sem transições desenhadas: a animação segue a situação do jogador. */
        u16 wanted = !(conditions & 1UL) ? (movement.velocityY < 0 ? GAME_PLAYER_ANIM_JUMP : GAME_PLAYER_ANIM_FALL)
                   : (conditions & 2UL) ? GAME_PLAYER_ANIM_WALK : GAME_PLAYER_ANIM_IDLE;
        if (wanted != currentAnimation) { currentAnimation = wanted; retroCharacterSetState(&character, wanted); return; }
    }
    retroCharacterTick(&character, conditions);
}

RetroFixed gamePlayerFixedX(void) { return movement.body.x; }
RetroFixed gamePlayerFixedY(void) { return movement.body.y; }
s16 gamePlayerX(void) { return (s16)(movement.body.x / RETRO_FIXED_ONE); }
s16 gamePlayerY(void) { return (s16)(movement.body.y / RETRO_FIXED_ONE); }
u8 gamePlayerOnGround(void) { return (u8)(lastResult.conditions & 1UL); }
u8 gamePlayerFacingLeft(void) { return movement.facing; }
Sprite *gamePlayerSprite(void) { return sprite; }
`,
  'game_camera.c': () => BANNER + `#include "game_internal.h"

/* Com a câmera exportada no editor de Câmera, usa os perfis e as regiões de lá.
 * Sem ela, a tela simplesmente acompanha o jogador, sem sair da sala. */
#if defined(__has_include) && __has_include("generated/camera_config.h")
#include "retro_runtime/retro_camera.h"
#include "generated/camera_config.h"

static RetroCamera camera;
static const RetroCameraConfig *framing;

void gameCameraInit(void) {
    framing = IS_PAL_SYSTEM ? &retroProjectCameraPal : &retroProjectCameraNtsc;
    retroCameraInit(&camera, 320, 224);
}

void gameCameraEnterRoom(const GameRoom *room, RetroFixed x, RetroFixed y, u8 facingLeft) {
    const RetroCameraRegion *regions = 0;
    u16 i, count = 0;
    for (i = 0; (s16)i < (s16)RETRO_PROJECT_CAMERA_ROOM_COUNT; i++) {
        if (retroProjectCameraRooms[i].room != room->id) continue;
        regions = retroProjectCameraRooms[i].regions;
        count = retroProjectCameraRooms[i].count;
        break;
    }
    retroCameraEnterRoom(&camera, framing, room->width, room->height, regions, count, x, y, (signed char)(facingLeft ? -1 : 1));
}

u8 gameCameraUpdate(RetroFixed x, RetroFixed y, u8 facingLeft, s16 *cameraX, s16 *cameraY) {
    RetroCameraResult view = retroCameraTick(&camera, framing, x, y, (signed char)(facingLeft ? -1 : 1));
    if (view.invalid) return 0;
    *cameraX = view.x; *cameraY = view.y;
    return 1;
}
#else
static s16 roomWidth, roomHeight;

static s16 follow(s16 target, s16 view, s16 limit) {
    s16 value = target - view / 2;
    if (value > limit - view) value = limit - view;
    return value < 0 ? 0 : value;
}

void gameCameraInit(void) { roomWidth = 320; roomHeight = 224; }

void gameCameraEnterRoom(const GameRoom *room, RetroFixed x, RetroFixed y, u8 facingLeft) {
    (void)x; (void)y; (void)facingLeft;
    roomWidth = room->width; roomHeight = room->height;
}

u8 gameCameraUpdate(RetroFixed x, RetroFixed y, u8 facingLeft, s16 *cameraX, s16 *cameraY) {
    (void)facingLeft;
    *cameraX = follow((s16)(x / RETRO_FIXED_ONE), 320, roomWidth);
    /* Os pés ficam um pouco abaixo do meio da tela. */
    *cameraY = follow((s16)(y / RETRO_FIXED_ONE) - 32, 224, roomHeight);
    return 1;
}
#endif
`,
  'game_audio.c': () => BANNER + `#include "game_internal.h"

/* Com o áudio exportado no editor de Áudio, cada sala toca a música escolhida para ela.
 * Sem ele, o jogo fica sem som e este arquivo não faz nada. */
#if defined(__has_include) && __has_include("generated/audio_sgdk.h")
#include "generated/audio_sgdk.h"

static RetroAudio audio;

void gameAudioInit(void) {
    RetroAudioDriver driver = retroAudioSgdkDriver(&retroProjectAudioSgdk);
    if (!retroAudioInit(&audio, &driver, RETRO_PROJECT_AUDIO_MUSIC_COUNT, retroProjectAudioEffects,
                        RETRO_PROJECT_AUDIO_EFFECT_COUNT, RETRO_PROJECT_AUDIO_CHANNELS)) gameFail("AUDIO NAO INICIOU");
}

void gameAudioTick(void) { retroAudioTick(&audio); }

/* Salas com a mesma música não reiniciam a faixa. */
void gameAudioEnterRoom(u16 room) {
    retroAudioRoomMusic(&audio, retroAudioRoomTrack(retroProjectAudioRooms, RETRO_PROJECT_AUDIO_ROOM_COUNT, room));
}
#else
void gameAudioInit(void) {}
void gameAudioTick(void) {}
void gameAudioEnterRoom(u16 room) { (void)room; }
#endif
`
}

/** Arquivos gerados em src/game/ para o jogador resolvido: { 'src/game/game.c': texto, ... }. */
export function compileGameHost(player) {
  if (!player) throw new Error('Jogador não resolvido.')
  return Object.fromEntries(Object.entries(FILES).map(([name, build]) => [GAME_DIRECTORY + '/' + name, build(player)]))
}
export const GAME_HOST_FILES = Object.keys(FILES).map(name => GAME_DIRECTORY + '/' + name)

/** main.c curto que usa o jogo gerado. Só é escrito quando o main.c ainda é o do modelo. */
export const GAME_MAIN = `/* Jogo do Retro Studio.
 *
 * A sala inicial, o jogador, a física, a câmera e a troca de sala vêm de src/game/, que a
 * IDE gera a partir do que você configura no modo Jogo (cartão "Jogador e início").
 * Este arquivo é seu: a IDE não o reescreve. Programe o que quiser nos pontos marcados
 * ou em arquivos novos dentro de src/. As funções disponíveis estão em src/game/game.h. */
#include <genesis.h>
#include "game/game.h"

int main(bool hardReset) {
    (void)hardReset;

    gameInit();
    /* Seu código de início aqui (carregar HUD, criar inimigos...). */

    while (TRUE) {
        gameUpdate();
        /* Seu código de cada quadro aqui (inimigos, itens, regras do jogo...). */

        gameEndFrame();
    }
    return 0;
}
`
/** O que acrescentar em um main.c próprio para usar o jogo gerado. */
export const GAME_MAIN_SNIPPET = '#include "game/game.h"\n\n/* no início de main(): */\ngameInit();\n\n/* no laço principal, a cada quadro: */\ngameUpdate();\n/* ... seu código ... */\ngameEndFrame();\n'
