#ifndef RETRO_STUDIO_ENEMY_H
#define RETRO_STUDIO_ENEMY_H
#include "retro_core.h"
#include "retro_collision.h"
#include "retro_slopes.h"
#define RETRO_RUNTIME_ENEMY_VERSION 1
/* Inimigos: definições reutilizáveis (tipos) e instâncias colocadas nas salas.
 *
 * Coordenadas em pixels da sala, com a origem nos pés (como o Charset Maker);
 * posição e velocidade internas em Q8. As caixas das definições são relativas
 * aos pés, olhando para a direita; o runtime espelha ao virar.
 *
 * Memória: nenhuma alocação. O pool tem capacidade fixa (RETRO_ENEMY_POOL_MAX)
 * e o limite de inimigos ativos é escolhido no init (<= capacidade). O estado
 * por instância da sala ocupa RETRO_ENEMY_ROOM_SPAWN_MAX entradas.
 *
 * Tempo: tudo em ticks (1 tick = 1 quadro de vídeo). Pausar = não chamar
 * retroEnemyUpdate; nenhum temporizador avança e nenhuma animação muda.
 *
 * O host desenha: os ganchos activate/deactivate reservam e liberam o visual
 * (sprite de hardware) e retroEnemyUpdate só marca o papel de animação. */
#ifndef RETRO_ENEMY_POOL_MAX
#define RETRO_ENEMY_POOL_MAX 8
#endif
#ifndef RETRO_ENEMY_ROOM_SPAWN_MAX
#define RETRO_ENEMY_ROOM_SPAWN_MAX 32
#endif
#define RETRO_ENEMY_NO_ANIMATION ((uint16_t)0xFFFF)

/* Comportamentos. Novos comportamentos entram nesta tabela e em retro_enemy.c
 * (função de tick por id); definições com id desconhecido são recusadas. */
enum {RETRO_ENEMY_BEHAVIOR_NONE=0,RETRO_ENEMY_BEHAVIOR_GROUND_PATROL=1,RETRO_ENEMY_BEHAVIOR_COUNT};
/* Papéis de animação. A exportação resolve os ausentes com fallback explícito. */
enum {RETRO_ENEMY_ROLE_IDLE=0,RETRO_ENEMY_ROLE_WALK,RETRO_ENEMY_ROLE_ATTACK,
      RETRO_ENEMY_ROLE_HURT,RETRO_ENEMY_ROLE_DEATH,RETRO_ENEMY_ROLE_COUNT};
enum {RETRO_ENEMY_FREE=0,RETRO_ENEMY_PATROL,RETRO_ENEMY_PAUSE,RETRO_ENEMY_WINDUP,
      RETRO_ENEMY_STRIKE,RETRO_ENEMY_RECOVER,RETRO_ENEMY_HURT,RETRO_ENEMY_DYING};
/* Flags da definição. */
#define RETRO_ENEMY_TURN_AT_EDGES 1
#define RETRO_ENEMY_CAN_ATTACK 2
#define RETRO_ENEMY_TURN_AT_WALLS 4
/* Política de reaparecimento por instância. */
enum {RETRO_ENEMY_RESPAWN_ROOM=0,  /* volta ao reentrar na sala (ou respawn do jogador) */
      RETRO_ENEMY_RESPAWN_NEVER=1, /* derrotado fica derrotado até retroEnemyResetDefeated */
      RETRO_ENEMY_RESPAWN_DELAY=2};/* volta após respawnDelay ticks, fora da tela */
/* Resultado de retroEnemyHit. */
#define RETRO_ENEMY_HIT_TOUCHED 1   /* a caixa encostou num inimigo vivo */
#define RETRO_ENEMY_HIT_DAMAGED 2   /* pelo menos um recebeu dano */
#define RETRO_ENEMY_HIT_DEFEATED 4  /* pelo menos um foi derrotado */

typedef struct {
 uint16_t frameCount;
 const uint16_t *durations; /* ticks por quadro; NULL só com frameCount 0 */
 uint16_t animation;        /* índice no sprite, ou RETRO_ENEMY_NO_ANIMATION */
 uint8_t loop;
} RetroEnemyAnimation;

typedef struct {
 uint8_t behavior,flags;
 uint16_t health;
 RetroFixed speed;              /* Q8 pixels por tick */
 RetroFixed gravity,maxFall;    /* Q8 */
 uint16_t contactDamage,attackDamage;
 uint16_t detectionRange;       /* pixels à frente; 0 desliga o ataque */
 RetroRect body,hurt,attack;    /* relativos aos pés, olhando para a direita */
 uint16_t windupTicks,strikeTicks,recoveryTicks;
 uint16_t hurtTicks,invulnerableTicks,deathTicks,pauseTicks;
 RetroEnemyAnimation animations[RETRO_ENEMY_ROLE_COUNT];
 const void *visual;            /* do host (ex.: SpriteDefinition*), opaco aqui */
 uint16_t palette;              /* do host (ex.: PAL1) */
 int16_t frameWidth,frameHeight;/* célula do sprite, em pixels */
 int16_t anchorX,anchorY;       /* pés dentro da célula */
} RetroEnemyDefinition;

typedef struct {
 uint16_t uid;                  /* índice global estável (bit de derrota) */
 uint16_t definition;           /* índice em definitions */
 int16_t x,y;                   /* pés, pixels da sala */
 int16_t patrolLeft,patrolRight;/* limites dos pés; iguais = sem limites */
 uint16_t activation;           /* margem além da tela, em pixels */
 uint16_t respawnDelay;         /* ticks, só para RESPAWN_DELAY */
 uint8_t facingLeft,respawn;
} RetroEnemySpawn;

typedef struct RetroEnemy {
 const RetroEnemyDefinition *def;
 const RetroEnemySpawn *spawn;
 RetroBody body;
 RetroFixed velocityY;
 RetroAnimation animation;
 uint16_t health,timer,invulnerable,lastHit,spawnIndex;
 uint8_t state,facingLeft,grounded,role,roleChanged,frameChanged;
 void *visual;                  /* do host: sprite reservado na ativação */
} RetroEnemy;

typedef struct RetroEnemyPool RetroEnemyPool;
typedef struct {
 /* Reserva o visual. Devolver 0 adia a ativação (ex.: sem VRAM ou sprites). */
 uint8_t (*activate)(void *context,RetroEnemy *enemy);
 void (*deactivate)(void *context,RetroEnemy *enemy);
 void *context;
} RetroEnemyHooks;

struct RetroEnemyPool {
 RetroEnemy actors[RETRO_ENEMY_POOL_MAX];
 uint8_t spawnState[RETRO_ENEMY_ROOM_SPAWN_MAX];
 uint16_t spawnTimer[RETRO_ENEMY_ROOM_SPAWN_MAX];
 const RetroEnemyDefinition *definitions;
 uint16_t definitionCount;
 const RetroEnemySpawn *spawns;
 uint16_t spawnCount;
 uint8_t *defeated;             /* bits por uid; do host, sobrevive à troca de sala */
 uint16_t defeatedCount;        /* quantidade de uids cobertos por defeated */
 const RetroCollider *colliders;
 uint16_t colliderCount;
 const RetroSlope *slopes;
 uint16_t slopeCount;
 int16_t roomWidth,roomHeight;
 RetroRect target;              /* caixa do alvo (jogador) para detecção */
 uint8_t targetEnabled,maxActive,activeCount,deferred;
 RetroEnemyHooks hooks;
};

enum {RETRO_ENEMY_OK=0,RETRO_ENEMY_INVALID=1,RETRO_ENEMY_TOO_MANY=2};
/* maxActive é limitado a RETRO_ENEMY_POOL_MAX. defeated pode ser NULL (sem
 * persistência de RESPAWN_NEVER entre salas). Não ativa nada. */
uint8_t retroEnemyInit(RetroEnemyPool *pool,const RetroEnemyDefinition *definitions,
 uint16_t definitionCount,uint8_t maxActive,uint8_t *defeated,uint16_t defeatedCount,
 RetroEnemyHooks hooks);
/* Troca de sala: libera todos os visuais e carrega as instâncias da sala.
 * spawns pode ser NULL com count 0 (sala sem inimigos). Instâncias com
 * referência inválida fazem a sala ser recusada (RETRO_ENEMY_INVALID). */
uint8_t retroEnemyEnterRoom(RetroEnemyPool *pool,const RetroEnemySpawn *spawns,uint16_t count,
 const RetroCollider *colliders,uint16_t colliderCount,const RetroSlope *slopes,uint16_t slopeCount,
 int16_t roomWidth,int16_t roomHeight);
/* Libera todos os visuais e esquece a sala (saída do jogo, troca de modo). */
void retroEnemyClear(RetroEnemyPool *pool);
/* Esquece as derrotas de RESPAWN_NEVER (novo jogo). */
void retroEnemyResetDefeated(RetroEnemyPool *pool);
/* Alvo da detecção (jogador). enabled=0 suspende a detecção. */
void retroEnemySetTarget(RetroEnemyPool *pool,const RetroRect *box,uint8_t enabled);
/* Um tick: ativa/desativa pela câmera (canto superior esquerdo + tamanho da
 * tela), aplica o comportamento e avança animações e temporizadores. */
void retroEnemyUpdate(RetroEnemyPool *pool,int16_t cameraX,int16_t cameraY,
 int16_t screenWidth,int16_t screenHeight);
/* Dano por caixa do mundo. serial != 0 impede atingir o mesmo inimigo duas
 * vezes com o mesmo golpe; first=1 para no primeiro inimigo tocado (projétil).
 * Inimigos invulneráveis contam como tocados, sem dano. */
uint8_t retroEnemyHit(RetroEnemyPool *pool,const RetroRect *box,uint16_t damage,uint16_t serial,uint8_t first);
/* Maior dano que a caixa recebe por contato (corpo) ou golpe ativo; 0 = nenhum. */
uint16_t retroEnemyTouch(const RetroEnemyPool *pool,const RetroRect *box);
/* Caixas atuais em pixels do mundo; devolvem 0 quando não se aplicam. */
uint8_t retroEnemyBodyRect(const RetroEnemy *enemy,RetroRect *out);
uint8_t retroEnemyHurtRect(const RetroEnemy *enemy,RetroRect *out);
uint8_t retroEnemyAttackRect(const RetroEnemy *enemy,RetroRect *out);
/* Animação a mostrar (já com fallback); RETRO_ENEMY_NO_ANIMATION = esconder. */
uint16_t retroEnemyAnimation(const RetroEnemy *enemy);
int16_t retroEnemyX(const RetroEnemy *enemy);
int16_t retroEnemyY(const RetroEnemy *enemy);
uint16_t retroEnemyActiveCount(const RetroEnemyPool *pool);
#endif
